import type { EntityId, ISODateString } from './shared';

export type AssetKind =
  | 'box-front'
  | 'fanart-box-front'
  | 'clear-logo'
  | 'platform-logo'
  | 'marquee'
  | 'wheel'
  | 'flyer'
  | 'screenshot'
  | 'disc'
  | 'background'
  | 'card-back'
  | 'unknown';

export type AssetFileFormat = 'png' | 'jpg' | 'jpeg' | 'webp' | 'svg' | 'unknown';

export interface LocalAsset {
  id: EntityId;
  sourceId?: EntityId;
  sourceLabel?: string;
  kind: AssetKind;
  name: string;
  normalizedName: string;
  path?: string;
  originalPath?: string;
  platform?: string;
  assetType?: 'Clear Logo' | 'Box - Front' | 'Fanart - Front' | 'Background' | string;
  normalizedFileName?: string;
  file?: File;
  objectUrl?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  format?: AssetFileFormat;
  importedAt?: ISODateString;
  stableAssetKey?: string;
}

export interface AssetReference {
  assetId?: EntityId;
  cacheKey?: string;
  stableKey: string;
  stableAssetKey?: string;
  kind: AssetKind;
  name: string;
  filename?: string;
  originalFilename?: string;
  displayName?: string;
  normalizedName: string;
  path?: string;
  originalPath?: string;
  platform?: string;
  assetType?: string;
  normalizedFileName?: string;
  sourceId?: EntityId;
  sourceLabel?: string;
  mimeType?: string;
  width?: number;
  height?: number;
}

export interface AssetLibraryFolder {
  kind: AssetKind;
  displayName: string;
  files: LocalAsset[];
}

export interface AssetLibrary {
  id: EntityId;
  rootName?: string;
  folders: Partial<Record<AssetKind, AssetLibraryFolder>>;
  assetsById: Record<EntityId, LocalAsset>;
  loadedAt?: ISODateString;
}

export type AssetSourceStatus =
  | 'connected'
  | 'restored'
  | 'unavailable'
  | 'disabled'
  | 'needs-reconnect'
  | 'ready'
  | 'scanning'
  | 'needs-refresh'
  | 'error';
export type AssetSourcePersistence = 'directory-handle' | 'file-list-metadata';
export type AssetSourceScanMode = 'launchbox-optimized' | 'manual-folder';

export interface AssetSourceMetadata {
  id: EntityId;
  label: string;
  folderPath?: string;
  path?: string;
  rootPath?: string;
  directoryPath?: string;
  location?: string;
  config?: Partial<Record<'folderPath' | 'path' | 'rootPath' | 'directoryPath' | 'location', string>>;
  role?: AssetKind | 'mixed';
  status: AssetSourceStatus;
  persistence: AssetSourcePersistence;
  scanMode?: AssetSourceScanMode;
  scanSignature?: string;
  scanChanged?: boolean;
  scanError?: string;
  lastLoadedAt?: ISODateString;
  assetCount: number;
}

export interface AssetSource extends AssetSourceMetadata {
  files?: File[];
  handle?: FileSystemDirectoryHandle;
}

export type AssetMatchWarning =
  | 'NO_HERO'
  | 'NO_TITLE_IMAGE'
  | 'LOW_RES_TITLE'
  | 'UNREADABLE_TITLE'
  | 'NO_BACK_IMAGE';

export interface AssetMatchCandidate {
  assetId: EntityId;
  kind: AssetKind;
  normalizedName: string;
  score: number;
  reason: string;
}

export interface AssetMatchResult {
  gameId: EntityId;
  categoryId: EntityId;
  heroImageAssetId?: EntityId;
  titleImageAssetId?: EntityId;
  backImageAssetId?: EntityId;
  fallbackTextTitle: string;
  sourceAssetIds: EntityId[];
  candidates: AssetMatchCandidate[];
  mameMatch?: {
    used: boolean;
    state?: 'confirmed' | 'ambiguous' | 'unmatched';
    reason:
      | 'matched by rom_name'
      | 'matched by parent_rom'
      | 'matched by display_title'
      | 'matched by alias'
      | 'matched by user override'
      | 'fell back to generic matching';
    romName?: string;
    parentRom?: string;
    displayTitle?: string;
    alias?: string;
    candidates?: MameCandidate[];
  };
  matchConfidence?: number;
  titleMode: 'IMAGE' | 'TEXT';
  warnings: AssetMatchWarning[];
  manuallyEdited?: boolean;
}

export type MatchedAssets = AssetMatchResult;

export interface MameMappingEntry {
  romName: string;
  title: string;
  category?: string;
  genre?: string;
  year?: string;
  manufacturer?: string;
  source?: string;
  normalizedRomName: string;
  normalizedTitle: string;
  normalizedAliases: string[];
}

export interface MameMasterRow {
  romName: string;
  displayTitle: string;
  parentRom: string;
  isClone: boolean;
  category: string;
  normalizedRomName: string;
  normalizedDisplayTitle: string;
  normalizedParentRom?: string;
}

export interface MameAliasRow {
  romName: string;
  alias: string;
  aliasNormalized: string;
  aliasType: string;
  priority: number;
  normalizedRomName: string;
}

export interface MameMachine {
  romName: string;
  displayTitle: string;
  parentRom?: string;
  isClone: boolean;
  year?: string;
  manufacturer?: string;
  players?: string;
  rotation?: string;
  category: string;
  normalizedRomName: string;
  normalizedDisplayTitle: string;
  normalizedParentRom?: string;
  normalizedAliases: string[];
}

export interface MameCandidate {
  romName: string;
  displayTitle: string;
  parentRom?: string;
  category: string;
  manufacturer?: string;
  year?: string;
  score: number;
  reason:
    | 'rom_name match'
    | 'parent_rom fallback'
    | 'display_title match'
    | 'alias match'
    | 'fuzzy similarity'
    | 'user override';
}

export interface MameDatasetMeta {
  id: string;
  sourceFileName: string;
  version?: string;
  machineCount: number;
  cloneCount: number;
  loadedAt: ISODateString;
  status: 'ready' | 'not-ready' | 'error';
  error?: string;
}

export interface MameUserOverride {
  key: string;
  gameTitle: string;
  categoryId: string;
  romName: string;
  updatedAt: ISODateString;
}

export interface MameIndexes {
  romName: Record<string, string>;
  parentRom: Record<string, string[]>;
  displayTitle: Record<string, string[]>;
  alias: Record<string, string[]>;
}

export interface MameMappingDataset {
  meta?: MameDatasetMeta;
  machines: MameMachine[];
  indexes: MameIndexes;
  userOverrides: Record<string, MameUserOverride>;
  masterRows: MameMasterRow[];
  aliasRows: MameAliasRow[];
  masterLoadedAt?: ISODateString;
  aliasesLoadedAt?: ISODateString;
  masterFileName?: string;
  aliasesFileName?: string;
  masterError?: string;
  aliasesError?: string;
}
