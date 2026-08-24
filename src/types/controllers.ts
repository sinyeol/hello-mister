import type { ActiveMisterProfile } from './mister';

export type ControllerConfigFileType =
  | 'gamecontrollerdb'
  | 'global-input'
  | 'core-input'
  | 'joystick-map'
  | 'script'
  | 'other-config';

export type ControllerSourceKind = 'remote' | 'backup' | 'local';

export interface ControllerConfigFile {
  id: string;
  fileName: string;
  path: string;
  folderPath: string;
  sizeBytes: number;
  modifiedAt?: string;
  type: ControllerConfigFileType;
  typeLabel: string;
  source: ControllerSourceKind;
  targetProfileId?: string;
  targetAlias?: string;
  targetHost?: string;
  canBackup: boolean;
  canRestoreTarget: boolean;
}

export interface ControllerCandidateFolder {
  path: string;
  label: string;
  status: 'read' | 'failed';
  itemCount?: number;
  message?: string;
}

export interface ControllerScanFailure {
  path: string;
  message: string;
  errorCode?: string;
}

export type ControllerInventoryStatus = 'ready' | 'empty' | 'partial' | 'error' | 'timeout';

export interface ControllerInventoryProfileSummary {
  alias?: string;
  host?: string;
  port?: number;
}

export interface ControllerInventoryDiagnostics {
  activeProfile?: ControllerInventoryProfileSummary & { profileId?: string };
  candidateRoots: string[];
  scannedRoots: string[];
  failedRoots: ControllerScanFailure[];
  errors: ControllerScanFailure[];
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  status: ControllerInventoryStatus;
}

export interface ControllerInventoryResult {
  ok: boolean;
  status: ControllerInventoryStatus;
  profileId?: string;
  alias?: string;
  host?: string;
  port?: number;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  scannedAt: string;
  scannedRoots?: string[];
  candidateRoots?: string[];
  candidateFolders: ControllerCandidateFolder[];
  files: ControllerConfigFile[];
  failedPaths: ControllerScanFailure[];
  errors?: ControllerScanFailure[];
  summary: {
    scannedFolderCount: number;
    candidateFileCount: number;
    failedPathCount: number;
  };
  diagnostics?: ControllerInventoryDiagnostics;
  message: string;
  errorCode?: string;
}

export interface ControllerReadFileResult {
  ok: boolean;
  profileId?: string;
  file?: ControllerConfigFile;
  content: string;
  preview?: ControllerFilePreview;
  bytesBase64?: string;
  sha256?: string;
  readAt: string;
  message: string;
  errorCode?: string;
}

export type ControllerFilePreviewMode = 'text' | 'hex';

export interface ControllerFilePreview {
  mode: ControllerFilePreviewMode;
  byteCount: number;
  shownBytes: number;
  truncated: boolean;
  text?: string;
  hex?: string;
  decimalBytes?: string;
  message?: string;
}

export interface ControllerBackupEntry {
  path: string;
  fileName: string;
  sourcePath: string;
  sizeBytes: number;
  createdAt?: string;
  location: 'remote' | 'local';
}

export interface ControllerBackupListResult {
  ok: boolean;
  profileId?: string;
  sourcePath?: string;
  backups: ControllerBackupEntry[];
  message: string;
  errorCode?: string;
}

export interface ControllerBackupPreviewResult {
  ok: boolean;
  profileId?: string;
  sourcePath?: string;
  backup?: ControllerBackupEntry;
  content: string;
  preview?: ControllerFilePreview;
  bytesBase64?: string;
  sha256?: string;
  readAt: string;
  message: string;
  errorCode?: string;
}

export interface ControllerOperationResult {
  ok: boolean;
  profileId?: string;
  sourcePath?: string;
  targetPath?: string;
  backupPath?: string;
  localBackupPath?: string;
  backups?: ControllerBackupEntry[];
  message: string;
  errorCode?: string;
}

export interface ControllerRestoreRequest {
  profileId?: string;
  sourcePath: string;
  backupPath: string;
  confirmed: boolean;
}

export interface ControllerBackupRequest {
  profileId?: string;
  sourcePath: string;
}

export interface ControllerConnectedDevice {
  name: string;
  vid: string;
  pid: string;
  controllerKeyPrefix: string;
  handlers: string;
  phys?: string;
  basePhys?: string;
  eventPath?: string;
  jsPath?: string;
  hidrawPath?: string;
}

export interface ControllerInputEvent {
  monitorId: string;
  kind: 'button' | 'axis' | 'hat' | 'closed';
  source?: 'evdev' | 'js' | 'hidraw';
  code?: number;
  codeHex?: string;
  evdevCode?: number;
  pressed?: boolean;
  value?: number;
  dir?: number | string;
  label?: string;
}

export interface ControllerMonitorResult {
  ok: boolean;
  monitorId: string;
  eventPath?: string;
  message?: string;
  errorCode?: string;
}

export interface ControllerReferenceEntry {
  fn: string;
  label: string;
  kind: 'button' | 'axis' | 'hat';
  usage?: number;
  evdevCode?: number;
  dir?: number | string;
  raw?: string;
  pos?: string; // visual Vewlix slot a button was captured into (b1..b8, start, coin). Capture aid only; ignored by .map generation.
}

export interface ControllerReference {
  vid: string;
  pid: string;
  name: string;
  updatedAt: string;
  entries: ControllerReferenceEntry[];
}

export interface ControllerCoreMapSummary {
  game: string;
  version: string;
  fileName: string;
  path: string;
  sizeBytes: number;
}

export interface ControllerListMapsResult {
  ok: boolean;
  profileId?: string;
  maps: ControllerCoreMapSummary[];
  message: string;
  errorCode?: string;
}

export interface ControllerReadMapResult {
  ok: boolean;
  profileId?: string;
  path?: string;
  byteLength?: number;
  codes: number[];
  message: string;
  errorCode?: string;
}

export interface ControllerMapWithCodes {
  game: string;
  version: string;
  fileName: string;
  path: string;
  codes: number[];
}

export interface ControllerReadAllMapsResult {
  ok: boolean;
  profileId?: string;
  maps: ControllerMapWithCodes[];
  message: string;
  errorCode?: string;
}

export interface ControllerArcadeButtonsResult {
  ok: boolean;
  profileId?: string;
  game?: string;
  mraPath?: string;
  names?: string[];
  message: string;
  errorCode?: string;
}

export interface ArcadeGameMeta {
  name?: string;
  count?: number;
  names: string[];
}

export interface ControllerArcadeIndexResult {
  ok: boolean;
  profileId?: string;
  index: Record<string, ArcadeGameMeta>;
  count?: number;
  message: string;
  errorCode?: string;
}

export interface ControllerWriteMapResult {
  ok: boolean;
  profileId?: string;
  path?: string;
  created?: boolean;
  backupPath?: string;
  message: string;
  errorCode?: string;
}

export interface ControllerWriteMapsItem {
  game?: string;
  path?: string;
  codes: number[];
}

export interface ControllerWriteMapsResult {
  ok: boolean;
  profileId?: string;
  created?: number;
  overwritten?: number;
  unchanged?: number;
  failed?: number;
  backedUp?: number;
  message: string;
  errorCode?: string;
}

export interface ControllerConnectedDevicesResult {
  ok: boolean;
  profileId?: string;
  devices: ControllerConnectedDevice[];
  message: string;
  errorCode?: string;
}

export interface ControllerInputCapsResult {
  ok: boolean;
  profileId?: string;
  buttonBase?: number; // real evdev button base from the kernel (0x120 joystick / 0x130 gamepad)
  hasHat?: boolean; // device exposes ABS_HAT0X/Y (digital d-pad)
  hasAnalog?: boolean; // device exposes ABS_X/Y (analog stick)
  message: string;
  errorCode?: string;
}

export interface ControllerClonePlanItem {
  game: string;
  sourceFileName: string;
  sourcePath: string;
  targetFileName: string;
  targetPath: string;
  targetExists: boolean;
  sizeBytes: number;
}

export interface ControllerCloneResult {
  ok: boolean;
  profileId?: string;
  dryRun?: boolean;
  plan: ControllerClonePlanItem[];
  createCount?: number;
  overwriteCount?: number;
  created?: number;
  overwritten?: number;
  backedUp?: number;
  message: string;
  errorCode?: string;
}

export interface ControllerAutoMapResult {
  ok: boolean;
  profileId?: string;
  dryRun?: boolean;
  targetVersion?: string;
  sharedCores?: string[];
  distinctSourceCodes?: number;
  coresToGenerate?: number;
  created?: number;
  overwritten?: number;
  backedUp?: number;
  partial?: number;
  skippedEmpty?: number;
  uncoveredCodeCount?: number;
  message: string;
  errorCode?: string;
}

export interface ControllerPreset {
  presetId: string;
  name: string;
  description: string;
  targetSystem: string;
  buttonLayout: string[];
  notes: string;
  status: 'ready-structure-only' | 'blocked-unverified-file-structure';
}

export interface ControllerPageModel {
  activeProfile?: ActiveMisterProfile;
  inventory?: ControllerInventoryResult;
  selectedFile?: ControllerConfigFile;
}
