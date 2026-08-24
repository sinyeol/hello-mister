import type { MiSTerPlatformGroup } from '@sticker-v1/types';

export interface MiSTerPlatformCatalogItem {
  platformKey: string;
  displayName: string;
  systemId: string;
  coreFolderName: string;
  platformGroup: MiSTerPlatformGroup;
  defaultImportEnabled: boolean;
  knownExtensions: string[];
  sourceNote: string;
  custom?: boolean;
  platformId?: string;
  aliases?: string[];
  sourceRoots?: string[];
  scanDepth?: number;
  recursive?: boolean;
  coreRoot?: string;
  launchTemplate?: string;
  parentSystem?: string;
  type?: 'default' | 'custom' | 'classification-folder';
  cardCategory?: string;
  ignored?: boolean;
  disabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

function key(platformGroup: MiSTerPlatformGroup, systemId: string) {
  return `${platformGroup}/${systemId}`;
}

const sourceNote = 'MiSTer Downloader/core folder convention. Extensions are overridable per core.';

export const misterPlatformCatalog: MiSTerPlatformCatalogItem[] = [
  { platformKey: key('Arcade', 'Arcade'), displayName: 'Arcade', systemId: 'Arcade', coreFolderName: '_Arcade', platformGroup: 'Arcade', defaultImportEnabled: true, knownExtensions: ['.mra'], sourceNote },
  { platformKey: key('Console', 'NES'), displayName: 'Nintendo Entertainment System', systemId: 'NES', coreFolderName: 'NES', platformGroup: 'Console', defaultImportEnabled: true, knownExtensions: ['.nes', '.fds', '.zip'], sourceNote },
  { platformKey: key('Console', 'SNES'), displayName: 'Super Nintendo', systemId: 'SNES', coreFolderName: 'SNES', platformGroup: 'Console', defaultImportEnabled: true, knownExtensions: ['.sfc', '.smc', '.bs', '.zip'], sourceNote },
  { platformKey: key('Console', 'Genesis'), displayName: 'Genesis / Mega Drive', systemId: 'Genesis', coreFolderName: 'Genesis', platformGroup: 'Console', defaultImportEnabled: true, knownExtensions: ['.md', '.gen', '.bin', '.zip'], sourceNote },
  { platformKey: key('Console', 'MegaCD'), displayName: 'Mega CD / Sega CD', systemId: 'MegaCD', coreFolderName: 'MegaCD', platformGroup: 'Console', defaultImportEnabled: true, knownExtensions: ['.cue', '.chd', '.bin'], sourceNote },
  { platformKey: key('Console', 'NeoGeo'), displayName: 'Neo Geo', systemId: 'NeoGeo', coreFolderName: 'NeoGeo', platformGroup: 'Console', defaultImportEnabled: true, knownExtensions: ['.neo', '.zip'], sourceNote },
  { platformKey: key('Console', 'PC Engine'), displayName: 'PC Engine / TurboGrafx-16', systemId: 'PC Engine', coreFolderName: 'TGFX16', platformGroup: 'Console', defaultImportEnabled: true, knownExtensions: ['.pce', '.cue', '.chd', '.zip'], sourceNote },
  { platformKey: key('Console', 'Game Boy'), displayName: 'Game Boy', systemId: 'Game Boy', coreFolderName: 'Gameboy', platformGroup: 'Console', defaultImportEnabled: true, knownExtensions: ['.gb', '.gbc', '.zip'], sourceNote },
  { platformKey: key('Console', 'GBA'), displayName: 'Game Boy Advance', systemId: 'GBA', coreFolderName: 'GBA', platformGroup: 'Console', defaultImportEnabled: true, knownExtensions: ['.gba', '.zip'], sourceNote },
  { platformKey: key('Console', 'PlayStation'), displayName: 'PlayStation', systemId: 'PlayStation', coreFolderName: 'PSX', platformGroup: 'Console', defaultImportEnabled: true, knownExtensions: ['.cue', '.chd', '.pbp'], sourceNote },
  { platformKey: key('Console', 'Saturn'), displayName: 'Saturn', systemId: 'Saturn', coreFolderName: 'Saturn', platformGroup: 'Console', defaultImportEnabled: true, knownExtensions: ['.cue', '.chd'], sourceNote },
  { platformKey: key('Computer', 'AO486'), displayName: 'AO486 / PC', systemId: 'AO486', coreFolderName: 'AO486', platformGroup: 'Computer', defaultImportEnabled: false, knownExtensions: ['.vhd', '.img'], sourceNote },
  { platformKey: key('Computer', 'Amiga'), displayName: 'Amiga', systemId: 'Amiga', coreFolderName: 'Amiga', platformGroup: 'Computer', defaultImportEnabled: true, knownExtensions: ['.adf', '.hdf', '.lha', '.zip'], sourceNote },
  { platformKey: key('Computer', 'Atari ST'), displayName: 'Atari ST', systemId: 'Atari ST', coreFolderName: 'AtariST', platformGroup: 'Computer', defaultImportEnabled: true, knownExtensions: ['.st', '.msa', '.zip'], sourceNote },
  { platformKey: key('Computer', 'C64'), displayName: 'Commodore 64', systemId: 'C64', coreFolderName: 'C64', platformGroup: 'Computer', defaultImportEnabled: true, knownExtensions: ['.d64', '.t64', '.crt', '.prg', '.zip'], sourceNote },
  { platformKey: key('Other', 'Scripts'), displayName: 'Scripts', systemId: 'Scripts', coreFolderName: 'Scripts', platformGroup: 'Other', defaultImportEnabled: false, knownExtensions: ['.sh'], sourceNote },
];

export const misterPlatformCatalogByKey = new Map(misterPlatformCatalog.map((item) => [item.platformKey, item]));
