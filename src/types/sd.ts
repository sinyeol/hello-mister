export type SdWizardStep = 'mode' | 'image' | 'drive' | 'flash' | 'wifi' | 'boot';

export type MrFusionVariant = 'mr-fusion' | 'ms-fusion';

export interface MrFusionImage {
  source: 'download' | 'local';
  fileName: string;
  url?: string;
  localPath?: string;
  checksum?: string;
  sizeBytes?: number;
  variant?: MrFusionVariant;
  tag?: string;
  verified: boolean;
}

export interface MrFusionDownloadProgress {
  phase: 'resolve' | 'download' | 'verify' | 'extract' | 'done' | 'error';
  message: string;
  receivedBytes?: number;
  totalBytes?: number;
  percent?: number;
  variant?: MrFusionVariant;
}

export interface MrFusionDownloadResult {
  ok: boolean;
  cancelled?: boolean;
  image?: MrFusionImage;
  message: string;
  logs: string[];
}

export interface SdCardDrive {
  id: string;
  label: string;
  mountPoint: string;
  sizeGb: number;
  freeGb?: number;
  fileSystem?: string;
  removable: boolean;
  systemDisk: boolean;
  selectable?: boolean;
  selectionReason?: string;
  diskNumber?: number;
  busType?: string;
  healthStatus?: string;
  driveLetter?: string;
  volumeName?: string;
}

export interface SdFlashRequest {
  image: MrFusionImage;
  targetDrive: SdCardDrive;
  typedConfirmation: string;
  dryRun: boolean;
}

export interface SdFlashProgress {
  phase: 'validate' | 'prepare' | 'elevating' | 'clearing' | 'writing' | 'verifying' | 'finalizing' | 'done' | 'error';
  message: string;
  writtenBytes?: number;
  totalBytes?: number;
  percent?: number;
}

export interface SdFlashResult {
  ok: boolean;
  dryRun: boolean;
  cancelled?: boolean;
  message: string;
  logs: string[];
}

export interface SdWifiStageRequest {
  mountPoint: string;
  ssid: string;
  password: string;
  countryCode?: string;
}

export interface SdWifiStageResult {
  ok: boolean;
  message: string;
  filePath?: string;
}

export interface SdWriteIniRequest {
  mountPoint: string;
  content: string;
}

export interface SdWriteIniResult {
  ok: boolean;
  message: string;
  filePath?: string;
}

export interface SdEjectRequest {
  driveLetter?: string;
  mountPoint?: string;
}

export interface SdEjectResult {
  ok: boolean;
  message: string;
}

export interface MrFusionStagedFile {
  id: string;
  label: string;
  targetPath: string;
  status: '대기' | '준비됨' | 'dry-run';
}

export interface SdStructureCheckItem {
  key: 'MiSTer.ini' | 'games' | 'Scripts' | 'config' | 'linux';
  label: string;
  path: string;
  exists: boolean;
  type: 'file' | 'folder';
}

export interface SdStructureCheckResult {
  driveId: string;
  mountPoint: string;
  checkedAt: string;
  ok: boolean;
  items: SdStructureCheckItem[];
  message: string;
  error?: string;
}

export interface LocalImageHashResult {
  ok: boolean;
  algorithm: 'sha256';
  filePath?: string;
  hash?: string;
  message: string;
}
