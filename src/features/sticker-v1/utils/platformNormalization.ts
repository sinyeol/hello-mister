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

export function platformIdentityKeys(input: PlatformIdentityInput) {
  const platformKeyTail = input.platformKey?.split('/').pop();
  const values = [
    input.systemId,
    input.folderName,
    input.coreFolderName,
    input.displayName,
    platformKeyTail,
    input.platformKey,
    ...(input.aliases ?? []),
    ...(input.sourceRoots ?? []),
  ];
  return Array.from(new Set(values.map(normalizePlatformAliasKey).filter(Boolean)));
}
