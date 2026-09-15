import { normalizeName } from './normalizeName';

const platformAliases = new Map<string, string>([
  ['neo geo', 'neogeo'],
  ['neogeo', 'neogeo'],
  ['neo-geo', 'neogeo'],
  ['arcade', 'arcade'],
  ['_arcade', 'arcade'],
  ['pgm', 'pgm'],
  ['igs pgm', 'pgm'],
  ['poly game master', 'pgm'],
  ['polygame master', 'pgm'],
  ['poly-game-master', 'pgm'],
  ['cps 1', 'cps1'],
  ['cps1', 'cps1'],
  ['cps-1', 'cps1'],
  ['cps 1 5', 'cps15'],
  ['cps15', 'cps15'],
  ['cps-1.5', 'cps15'],
  ['cps 2', 'cps2'],
  ['cps2', 'cps2'],
  ['cps-2', 'cps2'],
  ['cps 3', 'cps3'],
  ['cps3', 'cps3'],
  ['cps-3', 'cps3'],
  ['mega drive', 'genesis'],
  ['megadrive', 'genesis'],
  ['genesis', 'genesis'],
  ['super nintendo', 'snes'],
  ['super nintendo entertainment system', 'snes'],
  ['snes', 'snes'],
  ['nintendo entertainment system', 'nes'],
  ['nes', 'nes'],
  ['pc engine', 'pce'],
  ['pcengine', 'pce'],
  ['pce', 'pce'],
  ['tgfx16', 'pce'],
  ['turbografx16', 'pce'],
  ['turbografx 16', 'pce'],
  ['turbo grafx 16', 'pce'],
  ['turbografx-16', 'pce'],
]);

export interface PlatformIdentityInput {
  platformKey?: string;
  platformGroup?: string;
  systemId?: string;
  folderName?: string;
  coreFolderName?: string;
  displayName?: string;
  aliases?: string[];
  sourceRoots?: string[];
}

export function normalizePlatformAliasKey(value: string | undefined) {
  if (!value) return '';
  const normalized = normalizeName(value.replace(/[/\\]+/g, ' '));
  const compact = normalized.replace(/\s+/g, '');
  return platformAliases.get(normalized)
    ?? platformAliases.get(compact)
    ?? compact;
}

// MiSTer menu roots that hold many platforms at once. A folder name like "_Arcade" says which MENU a file sits in,
// not which platform it is, so it must not become an identity key: otherwise every rbf-split arcade core found
// directly under _Arcade (e.g. jtcps3 -> CPS-3) would collide with the generic "Arcade" platform and never show up
// as a new platform.
const menuRootFolderKeys = new Set(['arcade', 'console', 'computer', 'other', 'utility', 'games']);

function isMenuRootFolder(value: string | undefined) {
  return Boolean(value) && menuRootFolderKeys.has(normalizePlatformAliasKey(value));
}

export function platformIdentityKeys(input: PlatformIdentityInput) {
  const platformKeyTail = input.platformKey?.split('/').pop();
  const values = [
    input.systemId,
    isMenuRootFolder(input.folderName) ? undefined : input.folderName,
    isMenuRootFolder(input.coreFolderName) ? undefined : input.coreFolderName,
    input.displayName,
    platformKeyTail,
    input.platformKey,
    ...(input.aliases ?? []),
    ...(input.sourceRoots ?? []),
  ];
  return Array.from(new Set(values.map(normalizePlatformAliasKey).filter(Boolean)));
}
