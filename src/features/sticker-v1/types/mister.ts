import type { EntityId, ISODateString } from './shared';

export type MiSTerAuthMethod = 'password' | 'private-key' | 'agent';
export type MiSTerConnectionProtocol = 'ssh-sftp' | 'smb';
export type MiSTerConnectionStatus = 'idle' | 'testing' | 'connected' | 'failed' | 'unavailable';
export type MiSTerPathStatus = 'unknown' | 'exists' | 'missing' | 'unavailable';
export type MiSTerPlatformGroup = 'Console' | 'Computer' | 'Arcade' | 'Organized' | 'Network' | 'USB' | 'Other';
export type MiSTerScanEntryKind = 'rom' | 'mra' | 'folder' | 'script' | 'bios' | 'firmware' | 'system' | 'unknown';
export type MiSTerLaunchMode = 'launch-title' | 'relative-path' | 'absolute-path';
export type MiSTerPathResolutionSource = 'resolvedMiSTerPath' | 'importedAbsolutePath' | 'platformMapping' | 'relativePathMode' | 'missing';
export type MiSTerImageMatchState = 'matched' | 'ambiguous' | 'unmatched';
export type TagWriteMode = 'text-export' | 'mister-reader';
export type TagWriteJobStatus = 'draft' | 'ready' | 'writing' | 'verified' | 'failed';

export interface MiSTerConnectionConfig {
  host: string;
  port: number;
  username: string;
  protocol: MiSTerConnectionProtocol;
  authMethod: MiSTerAuthMethod;
  password?: string;
  privateKeyPath?: string;
}

export interface MiSTerConnectionState {
  config: MiSTerConnectionConfig;
  connectionId?: string;
  bridgeUrl?: string;
  bridgeEnabled?: boolean;
  status: MiSTerConnectionStatus;
  lastTestedAt?: ISODateString;
  message?: string;
  zaparooInstalled?: boolean;
  zaparooCommand?: string;
  zaparooCommandStatus?: 'unknown' | 'found' | 'missing';
  requiredPaths: Record<string, MiSTerPathStatus>;
}

export type MiSTerBridgeScanRootStatusValue = 'scanned' | 'missing' | 'error';

export interface MiSTerBridgeScanRootStatus {
  root: string;
  status: MiSTerBridgeScanRootStatusValue;
  fileCount: number;
  rawFilesScanned?: number;
  tinyFileSkippedCount?: number;
  extensionSkippedCount?: number;
  ignoredDirectorySkippedCount?: number;
  tinyFileExamples?: string[];
  message?: string;
  resolvedRoots?: string[];
}

export interface MiSTerBridgeScanSummary {
  scannedRoots: number;
  missingRoots: number;
  errorRoots: number;
  fileCount: number;
  rawFilesScanned?: number;
  skippedFiles?: number;
  tinyFileSkippedCount?: number;
  extensionSkippedCount?: number;
  ignoredDirectorySkippedCount?: number;
  executableGames?: number;
  nonExecutableEntries?: number;
  mergedGames?: number;
  config?: MiSTerScanFilterConfigSummary;
}

export interface MiSTerScanFilterConfig {
  version: number;
  misterScan: {
    minGameFileSizeBytes: number;
    roots: string[];
    ignoredDirectories: string[];
    includedExtensions: string[];
    excludedExtensions: string[];
    tinyFileAllowedExtensions?: string[];
    skipFilesAtOrBelowBytes: number;
    platformImportMode?: 'selectedOnly';
    newPlatformBehavior?: 'ask' | 'addDisabled' | 'addEnabled' | 'ignore';
  };
}

export interface MiSTerScanFilterConfigSummary {
  version: number;
  source: string;
  path?: string;
  lastSavedAt?: string;
  minGameFileSizeBytes: number;
  includedExtensionCount: number;
  ignoredDirectoryCount: number;
}

export interface MiSTerImageCandidate {
  assetId: EntityId;
  name: string;
  kind: string;
  sourcePath?: string;
  sourceLabel?: string;
  score: number;
  reason: string;
}

export interface MiSTerImageMatchResult {
  state: MiSTerImageMatchState;
  assetId?: EntityId;
  candidates: MiSTerImageCandidate[];
  reason?: string;
  aliasApplied?: boolean;
}

export interface MiSTerScanEntry {
  id: EntityId;
  source: 'mister';
  platformGroup: MiSTerPlatformGroup;
  systemId: string;
  folderName: string;
  folderPath: string;
  relativePath: string;
  absolutePath: string;
  title: string;
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
  imageMatch?: MiSTerImageMatchResult;
  hasCard: boolean;
  linkedCardId?: EntityId;
  imageMatched: boolean;
  launchReady: boolean;
  playable?: boolean;
  bios?: boolean;
  firmware?: boolean;
  systemFile?: boolean;
  ignored?: boolean;
  classificationReason?: string;
  pathValid?: boolean;
  aliasApplied?: boolean;
  scannedAt: ISODateString;
}

export interface MiSTerLibraryCache {
  entries: MiSTerScanEntry[];
  platformGroups: string[];
  systemIds: string[];
  folderNames: string[];
  lastSyncedAt?: ISODateString;
  scanStatus: 'idle' | 'scanning' | 'ready' | 'failed';
  message?: string;
}

export interface MiSTerLaunchPreview {
  entryId: EntityId;
  title: string;
  mode: MiSTerLaunchMode;
  text: string;
  reason?: string;
  byteLength: number;
  valid: boolean;
  warnings: string[];
  originalLibraryPath?: string;
  resolvedMiSTerPath?: string;
  nfcPayload?: string;
  resolutionSource?: MiSTerPathResolutionSource;
  validationStatus?: 'valid' | 'warning' | 'invalid';
}

export interface AliasRule {
  id: EntityId;
  scope: 'game-title' | 'rom-name' | 'platform' | 'system';
  from: string;
  to: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface MatchOverride {
  id: EntityId;
  entryId?: EntityId;
  imageMatchKey: string;
  assetId: EntityId;
  reason: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface MiSTerMappingState {
  aliases: AliasRule[];
  overrides: MatchOverride[];
}

export interface TagWritePayload {
  tagType: 'NTAG215';
  launchText: string;
  byteLength: number;
  valid: boolean;
  warnings: string[];
}

export interface TagWriteJob {
  id: EntityId;
  entryId?: EntityId;
  mode: TagWriteMode;
  payload: TagWritePayload;
  status: TagWriteJobStatus;
  logs: string[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface MiSTerState {
  connection: MiSTerConnectionState;
  library: MiSTerLibraryCache;
  mapping: MiSTerMappingState;
  tagJobs: TagWriteJob[];
}

export interface MiSTerCardMetadata {
  misterSource: 'mister';
  zaparooLibraryEntryId?: EntityId;
  misterPlatformGroup: MiSTerPlatformGroup;
  misterSystemId: string;
  misterFolderPath: string;
  misterRelativePath: string;
  misterAbsolutePath: string;
  misterLaunchText: string;
  originalLibraryPath?: string;
  resolvedMiSTerPath?: string;
  nfcPayload?: string;
  nfcPayloadSource?: MiSTerPathResolutionSource;
}
