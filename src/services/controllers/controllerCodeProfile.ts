import { DIRECTION_SLOTS } from './controllerMapCodec';
import { controllerDesktopService } from './controllerDesktopService';

// MiSTer .map codes are controller-specific in two ways the live HID monitor CANNOT see (evdev is grabbed, so we only
// read raw HID usage and must guess the evdev code):
//   - Button base: a JOYSTICK's buttons sit at evdev 0x120+ (BTN_JOYSTICK), a GAME PAD's at 0x130+ (BTN_GAMEPAD).
//   - Directions: an analog stick encodes as 0x03xx, a digital d-pad/HAT as 0x02xx.
// The monitor assumes joystick+analog (0x120 / 0x03xx) — correct for the 6B stick, WRONG for gamepad/hat pads (e.g.
// HORI Pokken / GP2040), whose generated maps then look filled in the app but read empty on MiSTer.
//
// We LEARN the real codes from the controller's OWN existing maps (the ones MiSTer's OSD wrote, which are by definition
// correct) and apply them to generation. Slots 0-3 are always the lever directions; slots 4+ are buttons.

export const REFERENCE_BUTTON_BASE = 0x120; // what the live monitor assumes — the base we migrate AWAY from

// MiSTer .map direction codes (slot order right/left/down/up). HAT0 values decoded from a real MiSTer-OSD map
// (ABS_HAT0X/Y d-pad); analog values are the standard ABS_X/Y encoding. Used when building a profile from evdev caps.
export const HAT0_DIRECTIONS = { right: 0x02c3, left: 0x02c2, down: 0x02c1, up: 0x02c0 };
export const ANALOG_DIRECTIONS = { right: 0x0301, left: 0x0300, down: 0x0303, up: 0x0302 };

export interface ControllerCodeProfile {
  buttonBase: number; // real evdev base for this controller's buttons (0x120 joystick, 0x130 gamepad, …)
  directions: { right: number; left: number; down: number; up: number }; // real slot 0-3 codes (analog 0x03xx or hat 0x02xx)
}

const key = (vid: string, pid: string) => `hello-mister-v2:controller-code-profile:${vid}_${pid}`.toLowerCase();

export function loadCodeProfile(vid: string, pid: string): ControllerCodeProfile | undefined {
  try {
    const raw = window.localStorage.getItem(key(vid, pid));
    if (!raw) return undefined;
    const p = JSON.parse(raw) as ControllerCodeProfile;
    if (typeof p.buttonBase === 'number' && p.directions && typeof p.directions.right === 'number') return p;
  } catch { /* ignore */ }
  return undefined;
}

export function saveCodeProfile(vid: string, pid: string, profile: ControllerCodeProfile): void {
  try { window.localStorage.setItem(key(vid, pid), JSON.stringify(profile)); } catch { /* ignore */ }
}

export function clearCodeProfile(vid: string, pid: string): void {
  try { window.localStorage.removeItem(key(vid, pid)); } catch { /* ignore */ }
}

// BEST ground truth: MiSTer's own controller-setup map `input_<vid>_<pid>_v<n>.map` (no game prefix) — written by
// MiSTer's "Define buttons" wizard with the user's ACTUAL lever + buttons, so its codes are exactly what MiSTer reads.
// Returns the real direction codes (slots 0-3) + button base, for ANY controller (HID/XInput/…). null if absent.
export async function learnProfileFromBaseMap(
  profileId: string | undefined,
  vid: string,
  pid: string,
  version = 'v3',
): Promise<ControllerCodeProfile | null> {
  const path = `/media/fat/config/inputs/input_${vid.toLowerCase()}_${pid.toLowerCase()}_${version.toLowerCase()}.map`;
  const res = await controllerDesktopService.readMap(profileId, path);
  const c = res.ok ? res.codes : null;
  if (!c || c.length < 8 || !c[0]) return null; // slot 0 (right) must be set
  const directions = { right: c[0] & 0xffff, left: c[2] & 0xffff, down: c[4] & 0xffff, up: c[6] & 0xffff };
  const blocks = new Map<number, number>();
  for (let slot = 4; slot < 32; slot += 1) {
    const code = (c[slot * 2] ?? 0) & 0xffff;
    if (code >= 0x100 && code < 0x200) blocks.set(code & 0xfff0, (blocks.get(code & 0xfff0) || 0) + 1);
  }
  let buttonBase = REFERENCE_BUTTON_BASE;
  let best = 0;
  for (const [b, n] of blocks) if (n > best) { buttonBase = b; best = n; }
  return { buttonBase, directions };
}

// Pick the most-voted value, but PREFER values that pass `prefer` — those can only have come from a real MiSTer-OSD
// map (the app/live-monitor never writes them), so even a single real map outvotes many app-generated (wrong) ones.
function pickPreferred(votes: Map<number, number>, prefer: (v: number) => boolean): number | undefined {
  const entries = [...votes.entries()];
  const preferred = entries.filter(([v]) => prefer(v));
  const pool = preferred.length ? preferred : entries;
  return pool.sort((a, b) => b[1] - a[1])[0]?.[0];
}

// Learn the profile from a sample of existing maps (each = 64 uint16 codes). Returns null if there isn't enough signal
// (e.g. no buttons mapped yet). Robust to a mix of real OSD maps and broken app-generated ones: directions prefer a HAT
// encoding (0x02xx) over the analog default (0x03xx); button base prefers any block other than the monitor default
// (0x120). So if even one real map is present, its (correct) codes win.
export function learnCodeProfile(maps: number[][]): ControllerCodeProfile | null {
  const dirVotes = [new Map<number, number>(), new Map<number, number>(), new Map<number, number>(), new Map<number, number>()];
  const baseVotes = new Map<number, number>();
  let sawButton = false;
  for (const codes of maps) {
    if (!Array.isArray(codes) || codes.length < 8) continue;
    for (let slot = 0; slot < 4; slot += 1) {
      const c = (codes[slot * 2] ?? 0) & 0xffff;
      if (c) dirVotes[slot].set(c, (dirVotes[slot].get(c) || 0) + 1);
    }
    for (let slot = 4; slot < 32; slot += 1) {
      const c = (codes[slot * 2] ?? 0) & 0xffff;
      if (c >= 0x100 && c < 0x200) { baseVotes.set(c & 0xfff0, (baseVotes.get(c & 0xfff0) || 0) + 1); sawButton = true; }
    }
  }
  const dirAt = (fn: 'right' | 'left' | 'down' | 'up') => {
    const slot = DIRECTION_SLOTS.find((d) => d.fn === fn)?.slot ?? 0;
    return pickPreferred(dirVotes[slot], (v) => (v & 0xff00) === 0x0200); // prefer HAT over analog default
  };
  const right = dirAt('right');
  const left = dirAt('left');
  const down = dirAt('down');
  const up = dirAt('up');
  const buttonBase = pickPreferred(baseVotes, (v) => v !== REFERENCE_BUTTON_BASE); // prefer a non-default (real) base
  if (!sawButton || buttonBase == null || right == null || left == null || down == null || up == null) return null;
  return { buttonBase, directions: { right, left, down, up } };
}
