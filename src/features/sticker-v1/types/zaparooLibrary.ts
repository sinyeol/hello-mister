import type {
  MiSTerImageMatchState,
  MiSTerLaunchMode,
  MiSTerPathResolutionSource,
  MiSTerPlatformGroup,
  MiSTerScanEntryKind,
} from './mister';
import type { EntityId, ISODateString } from './shared';
import type { MiSTerPlatformCatalogItem } from '@sticker-v1/data/misterPlatformCatalog';

export type MiSTerLibraryScanSource = 'bridge-scan' | 'path-list' | 'file-import';

export interface MiSTerLibraryProfile {
  deviceId: EntityId;
  deviceName: string;
  alias?: string;
  host?: string;
  username?: string;
  port?: number;
  lastSyncAt: ISODateString;
  entryCount: number;
  mergedEntryCount?: number;
  playableEntryCount?: number;
  nonPlayableEntryCount?: number;
  importDisabledPlatformKeys?: string[];
  platforms: string[];
  scanSource: MiSTerLibraryScanSource;
  entryIds: EntityId[];
  // Stable identity (preferred over host-based deviceId) so a MiSTer keeps its library across IP changes.
  stableDeviceId?: EntityId;
  aliasDeviceIds?: EntityId[];
  hostname?: string;
  macAddress?: string;
  // SD card CID (unique per physical microSD) — preferred device identity, set on scan/merge.
  sdCid?: string;
}

export interface ZaparooLibrarySourceRef {
  deviceId: EntityId;
  sourceEntryId: EntityId;
  absolutePath: string;
  relativePath: string;
  launchValue: string;
  originalLibraryPath?: string;
  resolvedMiSTerPath?: string;
  nfcPayload?: string;
  nfcPayloadSource?: MiSTerPathResolutionSource;
  scannedAt: ISODateString;
}

export interface ZaparooLibraryEntry {
  id: EntityId;
  sourceDevices: EntityId[];
  sourceRefs: ZaparooLibrarySourceRef[];
  platformGroup: MiSTerPlatformGroup;
  systemId: string;
  folderName: string;
  relativePath: string;
  absolutePath: string;
  title: string;
  normalizedTitle: string;
  romName: string;
  region?: string;
  disc?: string;
  kind: MiSTerScanEntryKind;
  launchMode: MiSTerLaunchMode;
  launchValue: string;
  originalLibraryPath?: string;
  resolvedMiSTerPath?: string;
  nfcPayload?: string;
  nfcPayloadSource?: MiSTerPathResolutionSource;
  imageMatchKey: string;
  imageMatchState: MiSTerImageMatchState;
  imageAssetId?: EntityId;
  genre?: string;
  releaseYear?: string;
  orientation?: 'horizontal' | 'vertical' | 'unknown';
  manufacturer?: string;
  developer?: string;
  metadataSource?: 'scan' | 'external' | 'manual';
  koTitle?: string;
  koTitleSource?: string;
  koTitleConfidence?: number;
  linkedCardIds: EntityId[];
  latestCardId?: EntityId;
  hasCard: boolean;
  launchReady: boolean;
  playable?: boolean;
  bios?: boolean;
  firmware?: boolean;
  systemFile?: boolean;
  ignored?: boolean;
  classificationReason?: string;
  pathValid?: boolean;
  // false when a per-device refresh found the entry gone from every source device but a linked card keeps it alive.
  available?: boolean;
  unavailableSince?: ISODateString;
  aliasApplied?: boolean;
  lastSyncedAt: ISODateString;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface ZaparooLibraryState {
  activeProfileId?: EntityId;
  profiles: MiSTerLibraryProfile[];
  entries: ZaparooLibraryEntry[];
  hiddenPlatformKeys?: string[];
  importDisabledPlatformKeys?: string[];
  importEnabledPlatformKeys?: string[];
  customPlatformCatalog?: MiSTerPlatformCatalogItem[];
  ignoredUnknownPlatformKeys?: string[];
  classificationFolderPlatformKeys?: string[];
  backups?: ZaparooLibraryBackup[];
  updatedAt?: ISODateString;
}

export interface ZaparooLibraryBackup {
  id: EntityId;
  createdAt: ISODateString;
  entryCount: number;
  profileCount: number;
  reason: 'manual' | 'auto-merge' | 'restore-point';
  state: ZaparooLibraryState;
}
