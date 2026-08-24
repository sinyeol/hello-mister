import { DIRECTION_CODE, DIRECTION_SLOTS } from './controllerMapCodec';
import type { ControllerCodeProfile } from './controllerCodeProfile';

// A per-controller "role template": which reference button (evdev code) plays each logical role. Applied per game by
// reading that game's MRA button names and placing the role's code at the game's actual slot — so ONE template fills
// every game correctly regardless of how each game lays out its buttons / Start / Coin.

export const ACTION_ROLE_COUNT = 8;

export interface RoleTemplate {
  actions: (number | undefined)[]; // evdev code per action button (index 0 = action 1)
  start?: number;
  coin?: number;
}

const key = (vid: string, pid: string) => `hello-mister-v2:role-template:${vid}_${pid}`.toLowerCase();

export function loadRoleTemplate(vid: string, pid: string): RoleTemplate {
  try {
    const raw = window.localStorage.getItem(key(vid, pid));
    if (raw) {
      const parsed = JSON.parse(raw) as RoleTemplate;
      if (Array.isArray(parsed.actions)) return { actions: parsed.actions.slice(0, ACTION_ROLE_COUNT), start: parsed.start, coin: parsed.coin };
    }
  } catch { /* ignore */ }
  return { actions: new Array(ACTION_ROLE_COUNT).fill(undefined) };
}

export function saveRoleTemplate(vid: string, pid: string, template: RoleTemplate): void {
  try { window.localStorage.setItem(key(vid, pid), JSON.stringify(template)); } catch { /* ignore */ }
}

const RE_START = /^start/i;
const RE_COIN = /^coin/i;
// Non-gameplay names that we leave unassigned (the user usually doesn't bind these on a stick).
const RE_SYSTEM = /pause|service|test|tilt|^core |dip|credit/i;

// Classify how many real action buttons a name list needs (excludes directions, dashes, Start/Coin/system).
export function actionButtonCount(names: string[]): number {
  let n = 0;
  for (const name of names) {
    if (!name || name === '-') continue;
    if (RE_START.test(name) || RE_COIN.test(name) || RE_SYSTEM.test(name)) continue;
    n += 1;
  }
  return n;
}

// Generate the 64 uint16 codes for one game from its MRA names + the role template. Directions come from the learned
// code profile when available (real analog 0x03xx or hat 0x02xx for this controller), else the default analog X/Y
// encoding; each subsequent name maps to slot 4+i. Button codes come straight from the template (already in this
// controller's real evdev code space once the reference is calibrated).
export function generateGameCodes(names: string[], template: RoleTemplate, profile?: ControllerCodeProfile): number[] {
  // Each logical slot = [primary, alt]. Real MiSTer maps leave alt=0 (single binding); duplicating the code into alt
  // breaks HAT/axis directions, so alt is always 0 here.
  const codes = new Array(64).fill(0);
  for (const d of DIRECTION_SLOTS) {
    codes[d.slot * 2] = profile?.directions[d.fn] ?? DIRECTION_CODE[d.fn];
  }
  let actionIdx = 0;
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    const slot = DIRECTION_SLOTS.length + i;
    let code = 0;
    if (!name || name === '-') code = 0;
    else if (RE_START.test(name)) code = template.start ?? 0;
    else if (RE_COIN.test(name)) code = template.coin ?? 0;
    else if (RE_SYSTEM.test(name)) code = 0;
    else { code = template.actions[actionIdx] ?? 0; actionIdx += 1; }
    codes[slot * 2] = code;
  }
  return codes;
}

// --- Console cores --------------------------------------------------------------------------------------------------
// Consoles have FIXED, NAMED button layouts (from the console catalog), unlike arcade games. So instead of "action N in
// order", the console template maps each canonical console button NAME → a reference button. One template then fills
// EVERY console core by matching its slot names. Covers Nintendo/Sega/NeoGeo naming; rarer names (PCE I/II, Atari Fire,
// PSX Cross…) are left unmapped in bulk (map those cores manually).

export const CONSOLE_ROLES = ['A', 'B', 'C', 'D', 'X', 'Y', 'Z', 'L', 'R', 'Select', 'Start', 'Mode'] as const;

export type ConsoleRoleTemplate = Record<string, number | undefined>; // role name → reference button evdev code

const consoleKey = (vid: string, pid: string) => `hello-mister-v2:console-role-template:${vid}_${pid}`.toLowerCase();

export function loadConsoleRoleTemplate(vid: string, pid: string): ConsoleRoleTemplate {
  try {
    const raw = window.localStorage.getItem(consoleKey(vid, pid));
    if (raw) { const parsed = JSON.parse(raw); if (parsed && typeof parsed === 'object') return parsed as ConsoleRoleTemplate; }
  } catch { /* ignore */ }
  return {};
}

export function saveConsoleRoleTemplate(vid: string, pid: string, template: ConsoleRoleTemplate): void {
  try { window.localStorage.setItem(consoleKey(vid, pid), JSON.stringify(template)); } catch { /* ignore */ }
}

// A few obvious aliases so number/roman-named pads still match the canonical A/B set.
const CONSOLE_ROLE_ALIAS: Record<string, string> = { '1': 'A', '2': 'B', i: 'A', ii: 'B' };

// Resolve a console core's slot NAME to a template role code (case-insensitive + aliases). 0 if uncovered.
export function consoleRoleCode(name: string, template: ConsoleRoleTemplate): number {
  const n = String(name || '').trim();
  if (!n || n === '-') return 0;
  let role = (CONSOLE_ROLES as readonly string[]).find((r) => r.toLowerCase() === n.toLowerCase());
  if (!role) role = CONSOLE_ROLE_ALIAS[n.toLowerCase()];
  return role ? (template[role] ?? 0) : 0;
}

// Generate the 64 codes for one console core from its fixed slot names + the console template. Directions from the code
// profile (else default analog); buttons by name match; alt uint16 = 0.
export function generateConsoleCodes(slots: string[], template: ConsoleRoleTemplate, profile?: ControllerCodeProfile): number[] {
  const codes = new Array(64).fill(0);
  for (const d of DIRECTION_SLOTS) codes[d.slot * 2] = profile?.directions[d.fn] ?? DIRECTION_CODE[d.fn];
  for (let i = 0; i < slots.length; i += 1) {
    codes[(DIRECTION_SLOTS.length + i) * 2] = consoleRoleCode(slots[i], template);
  }
  return codes;
}
