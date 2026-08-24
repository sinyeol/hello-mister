// Catalog of MiSTer console/computer cores for controller mapping. Unlike arcade games (per-MRA, variable button
// names), each console core has a FIXED button layout, so we can label slots and offer per-core map creation directly.
//
// `slug` is the EXACT core name MiSTer uses in the map filename `<slug>_input_<vid>_<pid>_v<N>.map`. The slugs in the
// first block were confirmed from a real device's config/inputs dump (docs/controller-map-analysis); the rest are the
// well-known MiSTer core names. `slots` are the button names for logical slots 4+ (slot 4 = slots[0]); directions
// (slots 0-3) are always the lever and are seeded separately. Slot ORDER is best-known MiSTer "Define buttons" order —
// verify once on the device; a wrong new-map slug only creates an unused file (no overwrite).

export interface ConsoleCore {
  slug: string;
  label: string;
  slots: string[];
}

export const CONSOLE_CORES: ConsoleCore[] = [
  // --- confirmed from device ---
  { slug: 'NES', label: '닌텐도 NES / 패미컴', slots: ['A', 'B', 'Select', 'Start', 'Turbo A', 'Turbo B'] },
  { slug: 'SNES', label: '슈퍼 닌텐도 SNES', slots: ['A', 'B', 'X', 'Y', 'L', 'R', 'Select', 'Start'] },
  { slug: 'Genesis', label: '메가드라이브 / 제네시스 (구 코어명)', slots: ['A', 'B', 'C', 'Start', 'X', 'Y', 'Z', 'Mode'] },
  { slug: 'MegaDrive', label: '메가드라이브 / 제네시스', slots: ['A', 'B', 'C', 'Start', 'X', 'Y', 'Z', 'Mode'] },
  { slug: 'MegaCD', label: '메가 CD', slots: ['A', 'B', 'C', 'Start', 'X', 'Y', 'Z', 'Mode'] },
  { slug: 'S32X', label: '세가 32X', slots: ['A', 'B', 'C', 'Start', 'X', 'Y', 'Z', 'Mode'] },
  { slug: 'SMS', label: '세가 마스터 시스템', slots: ['1', '2', 'Pause'] },
  { slug: 'GAMEBOY', label: '게임보이 / 컬러', slots: ['A', 'B', 'Select', 'Start'] },
  { slug: 'GBA', label: '게임보이 어드밴스', slots: ['A', 'B', 'L', 'R', 'Select', 'Start'] },
  { slug: 'TGFX16', label: 'PC엔진 / 터보그래픽스-16', slots: ['I', 'II', 'Select', 'Run', 'III', 'IV', 'V', 'VI'] },
  { slug: 'Atari2600', label: '아타리 2600', slots: ['Fire', 'Fire 2', 'Reset', 'Select', 'Pause'] },
  { slug: 'AtariLynx', label: '아타리 링스', slots: ['A', 'B', 'Option 1', 'Option 2', 'Pause'] },
  { slug: 'MSX1', label: 'MSX', slots: ['A', 'B'] },
  // --- common MiSTer cores (verify slug on device before creating new maps) ---
  { slug: 'GameGear', label: '게임 기어', slots: ['1', '2', 'Start'] },
  { slug: 'NEOGEO', label: '네오지오 (AES)', slots: ['A', 'B', 'C', 'D', 'Start', 'Select'] },
  { slug: 'N64', label: '닌텐도 64', slots: ['A', 'B', 'C-Up', 'C-Down', 'C-Left', 'C-Right', 'L', 'R', 'Z', 'Start'] },
  { slug: 'PSX', label: '플레이스테이션', slots: ['Cross', 'Circle', 'Square', 'Triangle', 'L1', 'R1', 'L2', 'R2', 'L3', 'R3', 'Select', 'Start'] },
  { slug: 'Saturn', label: '세가 새턴', slots: ['A', 'B', 'C', 'X', 'Y', 'Z', 'L', 'R', 'Start'] },
  { slug: 'Atari7800', label: '아타리 7800', slots: ['Fire 1', 'Fire 2', 'Pause', 'Select', 'Reset'] },
];

const bySlug = new Map(CONSOLE_CORES.map((core) => [core.slug.toLowerCase(), core]));

export function consoleCoreBySlug(slug: string): ConsoleCore | undefined {
  return bySlug.get(String(slug || '').toLowerCase());
}

export function isConsoleCoreSlug(slug: string): boolean {
  return bySlug.has(String(slug || '').toLowerCase());
}
