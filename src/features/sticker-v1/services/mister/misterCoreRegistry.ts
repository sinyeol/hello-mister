import type { MiSTerScanEntryKind } from '@sticker-v1/types';
import { normalizeName } from '@sticker-v1/utils/normalizeName';

export interface MiSTerCoreExtensionRule {
  systemId: string;
  displayName: string;
  platformGroup?: 'Console' | 'Computer' | 'Arcade' | 'Other';
  playableExtensions: string[];
  folderRomsetAllowed: boolean;
  biosFilenames: string[];
  ignoredExtensions: string[];
  ignoredFilenames: string[];
  sourceDocsNote: string;
}

export const misterCoreExtensionRegistry: MiSTerCoreExtensionRule[] = [
  {
    systemId: 'neogeo',
    displayName: 'Neo Geo',
    platformGroup: 'Arcade',
    playableExtensions: ['neo', 'zip'],
    folderRomsetAllowed: true,
    biosFilenames: ['neogeo.zip'],
    ignoredExtensions: ['xml', 'txt', 'dat'],
    ignoredFilenames: ['romsets.xml'],
    sourceDocsNote: 'NeoGeo MiSTer cores commonly use .neo files, zipped romsets, and neogeo.zip as BIOS.',
  },
];

// Comprehensive MiSTer ROM/launch extensions across all common cores. The previous short list dropped
// many real platforms (N64 .z64, 32X .32x, Atari .a26/.a52, Game & Watch .gnw, NeoGeo Pocket .ngp,
// WonderSwan .ws, Lynx .lnx, MiSTer shortcuts .mgl, computer disk/tape formats, …) — that is the root
// cause of "a newly installed core's games are not found by the scan".
export const fallbackPlayableExtensions = new Set([
  // launch shortcuts / arcade
  'mra', 'mgl',
  // Nintendo
  'nes', 'fds', 'unf', 'unif', 'nsf',
  'sfc', 'smc', 'swc', 'fig', 'bs', 'bsx', 'dx2',
  'gb', 'gbc', 'sgb',
  'gba', 'srm',
  'n64', 'z64', 'v64',
  'min', 'vb',
  'gw', 'gnw',
  // Sega
  'sms', 'sg', 'sc', 'sgx',
  'gg',
  'md', 'gen', 'smd', 'mdx',
  '32x',
  'sat',
  // NEC
  'pce',
  // SNK
  'neo', 'ngp', 'ngc', 'npc',
  // Bandai
  'ws', 'wsc',
  // Atari
  'a26', 'a52', 'a78', 'lnx', 'lyx', 'j64', 'jag', 'car', 'a0', 'e0', 'e1', 'e2',
  // other consoles
  'col', 'int', 'vec', 'o2', 'sv', 'pv', 'crv', 'avt',
  // discs
  'cue', 'chd', 'iso', 'pbp', 'mds', 'mdf', 'ccd',
  // computers (disk / tape / cart)
  'd64', 'd71', 'd81', 't64', 'prg', 'crt', 'g64', 'nib', 'tap', 'tzx', 'cdt',
  'adf', 'adz', 'hdf', 'hdz', 'lha',
  'st', 'msa', 'dim', 'stx', 'ipf',
  'dsk', 'do', 'po', 'woz', '2mg',
  'cas', 'wav', 'cdm',
  // generic / image containers
  'rom', 'bin', 'img', 'ima', 'vhd', 'hd', 'hdv',
  // compressed romsets
  'zip', '7z',
]);

// Files that are never games: configs, saves, art, databases, cores, OS junk. Used to reject
// unknown extensions while still letting genuinely-new ROM extensions through inside a game root.
export const ignoredFileExtensions = new Set([
  'ini', 'cfg', 'conf', 'txt', 'dat', 'xml', 'json', 'toml', 'yml', 'yaml', 'md', 'log', 'csv', 'tsv', 'nfo',
  'sav', 'srm', 'eep', 'eeprom', 'nv', 'nvm', 'brm', 'sram', 'state', 'pal', 'ovr', 'lic', 'key', 'sub',
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'svg', 'webp', 'tif', 'tiff', 'pdf',
  'sh', 'py', 'js', 'lua', 'bat', 'exe', 'dll', 'so', 'mra_old',
  'rbf', 'core', 'ds_store', 'thumbs', 'old', 'bak', 'tmp', 'sum', 'md5', 'sha', 'sha1', 'sha256',
]);

const gameRootHints = ['/games/', '/_console', '/_computer', '/_arcade', '/media/usb', '/media/network', '/cifs/'];

// A path is a probable game if its extension is a known ROM/launch type, OR it has an unknown
// (non-junk) extension but lives inside a recognized game root — so brand-new cores work automatically.
export function isLikelyPlayablePath(path: string): boolean {
  const fileName = path.split('/').pop() ?? '';
  // Reject dotfiles and macOS AppleDouble junk (._foo) — real MiSTer games never start with '.'.
  if (fileName.startsWith('.')) return false;
  const ext = extensionFromPath(path);
  if (!ext) return false;
  if (ignoredFileExtensions.has(ext)) return false;
  if (fallbackPlayableExtensions.has(ext)) return true;
  const lower = path.toLowerCase();
  return gameRootHints.some((hint) => lower.includes(hint));
}

export function extensionFromPath(path: string) {
  const fileName = path.split('/').pop() ?? '';
  return fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() ?? '' : '';
}

// Flat arcade .mra (directly under /media/fat/_Arcade) all classify as systemId "Arcade" from the path alone,
// so a newly installed arcade core (e.g. IGS PGM) is invisible as its own platform. The .mra's <rbf> names the
// core/hardware, so we map that to a friendly platform name; unknown cores fall back to the raw <rbf> value
// (still distinct per hardware). Only applied to the generic arcade buckets — real _Arcade/<Hardware>/ folders
// already produce a per-hardware systemId from the path and are left untouched.
const knownArcadeCorePlatform: Record<string, string> = {
  igspgm: 'IGS PGM',
  neogeo: 'Neo Geo',
  jtcps1: 'CPS-1',
  jtcps15: 'CPS-1.5',
  jtcps2: 'CPS-2',
  jts16: 'Sega System 16',
  jts16b: 'Sega System 16B',
  jtoutrun: 'Sega OutRun',
  jtgng: "Ghosts 'n Goblins",
  jt1942: 'Capcom 1942',
  jt1943: 'Capcom 1943',
  jtcontra: 'Konami Contra',
  jtkicker: 'Konami Kicker',
  jtbubl: 'Bubble Bobble',
  jttora: 'Toaplan',
  jtpang: 'Capcom Pang',
};

const genericArcadeSystemIds = new Set(['arcade', 'alternatives', 'organized']);

export function isGenericArcadeSystemId(systemId: string) {
  return genericArcadeSystemIds.has(systemId.trim().toLowerCase());
}

export function arcadeCorePlatformName(rbf: string): string {
  const key = rbf.trim().toLowerCase();
  return knownArcadeCorePlatform[key] ?? rbf.trim();
}

export function fileNameFromPath(path: string) {
  return path.split('/').pop()?.toLowerCase() ?? path.toLowerCase();
}

export function coreRuleForSystem(systemId: string, path = '') {
  const normalized = normalizeName(`${systemId} ${path}`);
  return misterCoreExtensionRegistry.find((rule) => {
    const system = normalizeName(rule.systemId);
    const display = normalizeName(rule.displayName);
    return normalized.includes(system) || normalized.includes(display);
  });
}

function isImmediateFolderRomsetPath(path: string) {
  const parts = path.split('/').filter(Boolean);
  const gamesIndex = parts.indexOf('games');
  if (gamesIndex !== -1) return parts.length - gamesIndex - 2 === 1;
  const menuIndex = parts.findIndex((part) => part === '_Console' || part === '_Computer' || part === '_Arcade');
  if (menuIndex !== -1) return parts.length - menuIndex - 2 === 1;
  return false;
}

export function classifyMiSTerPath(path: string, systemId: string): {
  kind: MiSTerScanEntryKind;
  playable: boolean;
  bios?: boolean;
  firmware?: boolean;
  systemFile?: boolean;
  ignored?: boolean;
  reason: string;
} {
  const ext = extensionFromPath(path);
  const fileName = fileNameFromPath(path);
  const normalizedPath = normalizeName(path);
  const rule = coreRuleForSystem(systemId, path);

  if (rule?.ignoredFilenames.includes(fileName) || rule?.ignoredExtensions.includes(ext)) {
    return { kind: 'unknown', playable: false, ignored: true, reason: 'ignored by system registry' };
  }
  if (/^boot([._-]|$)/i.test(fileName) || (fileName.startsWith('boot') && ['rom', 'bin', 'zip'].includes(ext))) {
    return { kind: 'system', playable: false, systemFile: true, reason: 'boot/system file' };
  }
  if (rule?.biosFilenames.includes(fileName) || normalizedPath.split(' ').some((token) => token === 'bios')) {
    return { kind: 'bios', playable: false, bios: true, reason: 'BIOS/system file' };
  }
  if (normalizedPath.split(' ').some((token) => token === 'firmware')) {
    return { kind: 'firmware', playable: false, firmware: true, reason: 'firmware file' };
  }
  if (normalizedPath.split(' ').some((token) => token === 'system')) {
    return { kind: 'system', playable: false, systemFile: true, reason: 'system file' };
  }
  if (ext === 'mra') return { kind: 'mra', playable: true, reason: 'Arcade MRA' };
  if (!ext && rule?.folderRomsetAllowed && isImmediateFolderRomsetPath(path)) {
    return { kind: 'folder', playable: true, reason: `${rule.displayName} folder romset` };
  }
  if (rule?.playableExtensions.includes(ext)) return { kind: 'rom', playable: true, reason: `${rule.displayName} playable extension .${ext}` };
  if (fallbackPlayableExtensions.has(ext)) return { kind: 'rom', playable: true, reason: `playable extension .${ext}` };
  if (isLikelyPlayablePath(path)) return { kind: 'rom', playable: true, reason: `probable game in core folder (.${ext})` };
  return { kind: 'unknown', playable: false, ignored: true, reason: `unsupported extension .${ext || 'none'}` };
}
