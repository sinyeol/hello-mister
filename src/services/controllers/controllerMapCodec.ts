import { consoleCoreBySlug } from '../../data/consoleCores';

// Encode/decode the MiSTer .map payload. Decoded from real 6B (0ca3:0024) maps + live HID capture:
//  - 64 uint16 LE = 32 LOGICAL slots, each [primary, secondary]. 0 = unassigned.
//  - Button code = evdev EV_KEY code directly (0x120 + (HID joystick button usage - 1)); high byte 0x01.
//  - Analog axis (lever) = 0x0300 | (axisIndex*2 + sign); sign 0=neg/1=pos. Left=0x0300 Right=0x0301 Up=0x0302 Down=0x0303.
//  - Slots 0-3 are Right, Left, Down, Up; slots 4+ are core-defined buttons.

export const LOGICAL_SLOT_COUNT = 32;

export const DIRECTION_CODE: Record<'up' | 'down' | 'left' | 'right', number> = {
  left: 0x0300,
  right: 0x0301,
  up: 0x0302,
  down: 0x0303,
};

export interface LogicalSlot {
  index: number;
  primary: number;
  secondary: number;
}

export function toLogicalSlots(codes: number[]): LogicalSlot[] {
  const slots: LogicalSlot[] = [];
  for (let i = 0; i < LOGICAL_SLOT_COUNT; i += 1) {
    slots.push({ index: i, primary: codes[i * 2] ?? 0, secondary: codes[i * 2 + 1] ?? 0 });
  }
  return slots;
}

export function fromLogicalSlots(slots: LogicalSlot[]): number[] {
  const codes = new Array(64).fill(0);
  for (const slot of slots) {
    codes[slot.index * 2] = slot.primary & 0xffff;
    // The second uint16 is an OPTIONAL alt binding; real MiSTer-OSD maps leave it 0 for a single binding. Writing the
    // primary code again breaks HAT/axis directions on MiSTer (the axis code in the alt slot corrupts the binding),
    // though buttons tolerate it. The app has no alt-binding UI, so always write 0 to match real maps.
    codes[slot.index * 2 + 1] = 0;
  }
  return codes;
}

export function isButtonCode(code: number): boolean {
  return code >= 0x100 && code < 0x200;
}

export function decodeAxisCode(code: number): { axis: number; sign: number } | null {
  if ((code & 0xff00) !== 0x0300) return null;
  const low = code & 0xff;
  return { axis: low >> 1, sign: low & 1 };
}

export type SlotKind = 'empty' | 'direction' | 'button' | 'other';

export function classifyCode(code: number): { kind: SlotKind; label: string } {
  if (!code) return { kind: 'empty', label: '비움' };
  const axis = decodeAxisCode(code);
  if (axis) {
    // axis 0 = ABS_X, 1 = ABS_Y (analog stick); 16 = ABS_HAT0X, 17 = ABS_HAT0Y (d-pad as axes, e.g. XInput).
    const horizontal = axis.axis === 0 || axis.axis === 16;
    const vertical = axis.axis === 1 || axis.axis === 17;
    const name = horizontal ? (axis.sign ? '오른쪽 →' : '왼쪽 ←') : vertical ? (axis.sign ? '아래 ↓' : '위 ↑') : `축${axis.axis}${axis.sign ? '+' : '-'}`;
    return { kind: 'direction', label: name };
  }
  if (isButtonCode(code)) return { kind: 'button', label: `evdev 0x${code.toString(16)}` };
  return { kind: 'other', label: `0x${code.toString(16)}` };
}

// Standard slot 0-3 meaning (Right, Left, Down, Up) — same across cores.
export const DIRECTION_SLOTS: { slot: number; fn: 'up' | 'down' | 'left' | 'right'; label: string }[] = [
  { slot: 0, fn: 'right', label: '오른쪽 →' },
  { slot: 1, fn: 'left', label: '왼쪽 ←' },
  { slot: 2, fn: 'down', label: '아래 ↓' },
  { slot: 3, fn: 'up', label: '위 ↑' },
];

// Build a label for every logical slot. Arcade MRA names (slots 4+i) take priority, then known console-core layouts
// (from the console catalog), else a generic "버튼 N". Slots 0-3 are always the lever directions.
export function buildSlotLabels(coreName: string, arcadeNames?: string[]): Record<number, string> {
  const labels: Record<number, string> = {};
  for (const d of DIRECTION_SLOTS) labels[d.slot] = d.label;
  const consoleNames = consoleCoreBySlug(coreName)?.slots;
  const source = arcadeNames && arcadeNames.length ? arcadeNames : consoleNames;
  for (let i = 0; i < LOGICAL_SLOT_COUNT - DIRECTION_SLOTS.length; i += 1) {
    const slot = DIRECTION_SLOTS.length + i;
    const name = source?.[i];
    labels[slot] = name && name !== '-' ? name : name === '-' ? '(미사용)' : `버튼 ${i + 1}`;
  }
  return labels;
}
