import type { ControllerReference, ControllerReferenceEntry } from '../../types/controllers';

// The reference is a complete inventory of one controller's physical inputs, captured live via raw HID and persisted
// by VID:PID. It records the 4 lever directions and EVERY button (count auto-detected by pressing them all) — but no
// game roles. Which captured button becomes A/B/Start/Coin is decided per-core in step 3, because games differ in
// which buttons they use. The captured HID field (kind/usage/dir) is canonical; evdevCode is advisory.

export interface DirectionFunction {
  fn: 'up' | 'down' | 'left' | 'right';
  label: string;
}

export const DIRECTION_FUNCTIONS: DirectionFunction[] = [
  { fn: 'up', label: '위 ↑' },
  { fn: 'down', label: '아래 ↓' },
  { fn: 'left', label: '왼쪽 ←' },
  { fn: 'right', label: '오른쪽 →' },
];

// Visual capture positions for the graphic (Vewlix-style) capture aid: 8 action buttons + Start/Coin. Each position
// holds ONE physical button. These are layout slots, not game roles — which button is A/B/Start/Coin is still decided
// per-core in step 3. Order matters: it drives "연속 캡처" auto-advance.
export interface ButtonPosition {
  id: string;
  label: string;
}

export const BUTTON_POSITIONS: ButtonPosition[] = [
  { id: 'b1', label: '1' },
  { id: 'b2', label: '2' },
  { id: 'b3', label: '3' },
  { id: 'b4', label: '4' },
  { id: 'b5', label: '5' },
  { id: 'b6', label: '6' },
  { id: 'b7', label: '7' },
  { id: 'b8', label: '8' },
  { id: 'start', label: 'Start' },
  { id: 'coin', label: 'Coin' },
];

// Place a captured physical button at a visual position, keeping the invariant: one physical button ↔ one position.
// Drops any existing entry at the same position (replace) OR for the same physical button elsewhere (move), then appends.
export function assignButtonToPosition(
  buttons: ControllerReferenceEntry[],
  entry: ControllerReferenceEntry,
  pos: string,
): ControllerReferenceEntry[] {
  const key = buttonEntryKey(entry);
  const kept = buttons.filter((b) => b.pos !== pos && buttonEntryKey(b) !== key);
  return [...kept, { ...entry, pos }];
}

// XInput (Xbox) controllers are vendor-specific (Linux xpad driver) — NOT exposed via raw HID, so the live monitor
// can't read them and live reference capture is impossible. Their layout is a FIXED standard though, so we provide a
// built-in reference with the real evdev codes (confirmed from a real OSD-made 045e map). Buttons are non-linear
// (A=0x130,B=0x131,X=0x133,Y=0x134,LB=0x136,RB=0x137,Back=0x13a,Start=0x13b,Guide=0x13c,LS=0x13d,RS=0x13e); triggers
// LT/RT are analog axes (0x0305/0x030b); directions use the analog left stick (0x03xx). usage is left undefined so the
// labels (A/B/…) survive and the code-profile button-base transform is skipped (these are already real codes).
export function isXInputDevice(vid: string, name = ''): boolean {
  return String(vid).toLowerCase() === '045e' || /x-?box|xinput/i.test(name);
}

// XInput exposes BOTH a d-pad (ABS_HAT0X/Y → analog axes 16/17 → 0x032x) and an analog left stick (ABS_X/Y → 0x030x).
// Arcade levers on a GP2040 in Xbox mode are usually wired to the d-pad. Confirmed from real device maps.
export type XInputLever = 'dpad' | 'stick';
export function xinputDirections(lever: XInputLever): { right: number; left: number; down: number; up: number } {
  return lever === 'dpad'
    ? { right: 0x0321, left: 0x0320, down: 0x0323, up: 0x0322 }
    : { right: 0x0301, left: 0x0300, down: 0x0303, up: 0x0302 };
}

export function buildXInputReference(vid: string, pid: string, name: string, lever: XInputLever = 'dpad'): ControllerReference {
  const d = xinputDirections(lever);
  const btn = (pos: string, label: string, evdevCode: number): ControllerReferenceEntry => ({ fn: pos, label, kind: 'button', evdevCode, pos });
  const dir = (fn: string, label: string, code: number): ControllerReferenceEntry => ({ fn, label, kind: 'axis', evdevCode: code, dir: 0, raw: `0x${code.toString(16)}` });
  return {
    vid,
    pid,
    name,
    updatedAt: new Date().toISOString(),
    entries: [
      dir('up', '위 ↑', d.up), dir('down', '아래 ↓', d.down), dir('left', '왼쪽 ←', d.left), dir('right', '오른쪽 →', d.right),
      btn('b1', 'A', 0x130), btn('b2', 'B', 0x131), btn('b3', 'X', 0x133), btn('b4', 'Y', 0x134),
      btn('b5', 'LB', 0x136), btn('b6', 'RB', 0x137), btn('b7', 'LT', 0x0305), btn('b8', 'RT', 0x030b),
      btn('start', 'Start', 0x13b), btn('coin', 'Back', 0x13a),
      { fn: 'guide', label: 'Guide', kind: 'button', evdevCode: 0x13c },
      { fn: 'ls', label: 'LS', kind: 'button', evdevCode: 0x13d },
      { fn: 'rs', label: 'RS', kind: 'button', evdevCode: 0x13e },
    ],
  };
}

// Stable key that identifies a captured button across re-presses (dedup during free capture).
export function buttonEntryKey(entry: ControllerReferenceEntry): string {
  return entry.evdevCode != null ? `e${entry.evdevCode}` : `u${entry.usage}:${entry.raw ?? ''}`;
}

const referenceKey = (vid: string, pid: string) => `hello-mister-v2:controller-reference:${vid}_${pid}`.toLowerCase();

export function loadControllerReference(vid: string, pid: string): ControllerReference | undefined {
  try {
    const raw = window.localStorage.getItem(referenceKey(vid, pid));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as ControllerReference;
    if (!Array.isArray(parsed.entries)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function saveControllerReference(reference: ControllerReference): void {
  try {
    window.localStorage.setItem(referenceKey(reference.vid, reference.pid), JSON.stringify(reference));
  } catch {
    /* storage unavailable */
  }
}

// Buttons are labelled by their HID usage number so the live monitor, reference, and editor all show the SAME number
// for the same physical button (the monitor sends `버튼 <usage>`).
export function referenceButtonLabel(entry: ControllerReferenceEntry): string {
  return entry.usage != null ? `버튼 ${entry.usage}` : (entry.label || '버튼');
}

export function describeReferenceEntry(entry: ControllerReferenceEntry): string {
  if (entry.kind === 'button') return referenceButtonLabel(entry);
  if (entry.kind === 'hat') return `햇 ${entry.dir}`;
  return `축 ${entry.raw || entry.usage} ${entry.dir}`;
}

export function splitReference(reference: ControllerReference | undefined) {
  const directions: Record<string, ControllerReferenceEntry> = {};
  const buttons: ControllerReferenceEntry[] = [];
  for (const entry of reference?.entries ?? []) {
    if (entry.fn === 'up' || entry.fn === 'down' || entry.fn === 'left' || entry.fn === 'right') directions[entry.fn] = entry;
    else buttons.push({ ...entry, label: referenceButtonLabel(entry) }); // normalise old capture-order labels to usage-based
  }
  return { directions, buttons };
}
