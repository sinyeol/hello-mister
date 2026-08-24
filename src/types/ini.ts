export type IniRiskLevel = '안전' | '주의' | '위험';

export interface IniEditableValue {
  key: string;
  label: string;
  value: string;
  description: string;
  locked?: boolean;
}

export interface IniPreset {
  id: string;
  name: string;
  fileNameCandidate: string;
  purpose: string;
  description: string;
  riskLevel: IniRiskLevel;
  values: IniEditableValue[];
  todo: string;
}

export interface IniProfile {
  id: string;
  fileName: string;
  displayName: string;
  source: '기본' | '대체' | '커스텀' | '프리셋';
  updatedAt?: string;
}

export interface IniApplyPlan {
  presetId: string;
  mode: '현재 MiSTer.ini로 적용' | '대체 INI로 저장';
  targetPath: string;
  backupPath: string;
  dryRun: boolean;
  rebootAfterApply: boolean;
}

export type IniDiffKind = '추가' | '변경' | '삭제' | '동일';

export interface IniDiffEntry {
  key: string;
  before?: string;
  after?: string;
  kind: IniDiffKind;
  riskLevel: IniRiskLevel;
  description: string;
}

export interface IniExportResult {
  ok: boolean;
  cancelled?: boolean;
  filePath?: string;
  message: string;
}

export type MisterIniPresetSlot = 'main' | 'alt1' | 'alt2' | 'alt3' | 'custom';
export type MisterIniFileKind = MisterIniPresetSlot | 'alt';
export type MisterIniControlKind = 'boolean' | 'number' | 'text' | 'select';
export type MisterIniFileSource = 'remote' | 'local-import' | 'upload-ready' | 'cache' | 'missing-remote';
export type MisterIniValueType = 'boolean' | 'number' | 'enum' | 'text' | 'hex' | 'videoMode';
export type MisterIniRiskLevel = 'normal' | 'caution' | 'danger';
export type MisterIniHelpSource = 'official-docs' | 'official-mister-ini' | 'official-ini-settings-sh' | 'unknown';

export interface MisterIniAllowedValue {
  value: string;
  labelKo: string;
  descriptionKo?: string;
}

export interface MisterIniValueRange {
  min?: number;
  max?: number;
  unit?: string;
}

export interface MisterIniFileMetadata {
  profileId: string;
  fileName: string;
  displayName?: string;
  presetSlot?: MisterIniPresetSlot;
  notes?: string;
  localContent?: string;
  localSizeBytes?: number;
  localImportedAt?: string;
  source?: MisterIniFileSource;
  updatedAt: string;
}

export interface MisterIniRemoteFile {
  listId?: string;
  fileName: string;
  path: string;
  displayName?: string;
  source: MisterIniFileSource;
  sizeBytes: number;
  modifiedAt?: string;
  kind: MisterIniFileKind;
  isDefault: boolean;
  altNumber?: number;
  custom: boolean;
  backupCount: number;
  targetProfileId?: string;
  targetAlias?: string;
  targetHost?: string;
  metadata?: MisterIniFileMetadata;
}

export interface MisterIniIndexDebug {
  profileId?: string;
  profileAlias?: string;
  host?: string;
  rawMediaFatItemCount: number;
  remoteIniCandidateCount: number;
  metadataCount: number;
  cacheCount: number;
  finalListCount: number;
  excludedItemCount: number;
  excludedReasons: Record<string, number>;
}

export interface MisterIniIndex {
  ok: boolean;
  profileId?: string;
  profileAlias?: string;
  host?: string;
  files: MisterIniRemoteFile[];
  debug?: MisterIniIndexDebug;
  cachedAt: string;
  message: string;
  errorCode?: string;
}

export interface MisterIniReadResult {
  ok: boolean;
  profileId?: string;
  fileName: string;
  path: string;
  content: string;
  sizeBytes: number;
  readAt: string;
  message: string;
  errorCode?: string;
}

export interface MisterIniParsedLine {
  type: 'section' | 'setting' | 'comment' | 'blank' | 'raw';
  lineNumber: number;
  raw: string;
  section?: string;
  key?: string;
  value?: string;
  inlineComment?: string;
  commentDelimiter?: ';' | '#';
  comment?: string;
  help?: string;
}

export interface MisterIniSetting {
  id: string;
  section: string;
  key: string;
  label?: string;
  labelEn?: string;
  labelKo?: string;
  value: string;
  originalValue: string;
  inlineComment?: string;
  rawLine?: string;
  lineNumber: number;
  help?: string;
  catalogHelp?: string;
  descriptionKo?: string;
  whenToUseKo?: string;
  valueGuideKo?: string;
  recommendedKo?: string;
  warningKo?: string;
  helpSource?: MisterIniHelpSource;
  controlKind: MisterIniControlKind;
  valueType?: MisterIniValueType;
  options?: string[];
  optionLabels?: Record<string, string>;
  allowedValues?: MisterIniAllowedValue[];
  range?: MisterIniValueRange;
  examples?: string[];
  riskLevel?: MisterIniRiskLevel;
  placeholder?: string;
  category: 'video' | 'audio' | 'controller' | 'network-system' | 'other';
  changed: boolean;
}

export interface MisterIniSection {
  id: string;
  name: string;
  lineNumber: number;
  settings: MisterIniSetting[];
}

export interface MisterIniDocument {
  fileName: string;
  content: string;
  lines: MisterIniParsedLine[];
  sections: MisterIniSection[];
  parseWarnings: string[];
}

export interface MisterIniBackupEntry {
  path: string;
  fileName: string;
  sourceFileName: string;
  sizeBytes: number;
  createdAt?: string;
  location: 'remote' | 'local';
}

export interface MisterIniTrashEntry {
  path: string;
  fileName: string;
  originalFileName: string;
  kind?: 'ini' | 'backup';
  sizeBytes: number;
  movedAt?: string;
}

export interface MisterIniBackupListResult {
  ok: boolean;
  profileId?: string;
  fileName: string;
  backups: MisterIniBackupEntry[];
  message: string;
  errorCode?: string;
}

export interface MisterIniBackupPreviewResult {
  ok: boolean;
  profileId?: string;
  fileName: string;
  backupPath: string;
  content: string;
  sizeBytes: number;
  readAt: string;
  message: string;
  errorCode?: string;
}

export interface MisterIniTrashListResult {
  ok: boolean;
  profileId?: string;
  entries: MisterIniTrashEntry[];
  message: string;
  errorCode?: string;
}

export interface MisterIniOperationResult {
  ok: boolean;
  profileId?: string;
  fileName?: string;
  path?: string;
  backupPath?: string;
  backups?: MisterIniBackupEntry[];
  message: string;
  errorCode?: string;
  phase?: string;
  detail?: {
    operation?: string;
    phase?: string;
    sanitizedDetail?: string;
    safeDetail?: unknown;
  };
}

export type MisterIniWriteCapabilityState =
  | 'disconnected'
  | 'connectedReadOnly'
  | 'connectedWritable'
  | 'writeCheckFailed';

export interface MisterIniWriteCapabilityResult {
  ok: boolean;
  profileId?: string;
  state: MisterIniWriteCapabilityState;
  canRead: boolean;
  canWrite: boolean;
  checkedAt: string;
  targetPath?: string;
  message: string;
  errorCode?: string;
  phase?: string;
  detail?: {
    operation?: string;
    phase?: string;
    remotePath?: string;
    sanitizedDetail?: string;
  };
}

export interface MisterIniLocalImportResult extends MisterIniOperationResult {
  content?: string;
  originalFileName?: string;
  suggestedRemoteFileName?: string;
  sizeBytes?: number;
}

export interface MisterIniWriteRequest {
  profileId?: string;
  fileName: string;
  content: string;
  confirmed: boolean;
}

export interface MisterIniTrashRequest {
  profileId?: string;
  fileName: string;
  confirmed: boolean;
}

export interface MisterIniRestoreRequest {
  profileId?: string;
  fileName: string;
  backupPath: string;
  confirmed: boolean;
}

export interface MisterIniDeleteBackupRequest {
  profileId?: string;
  fileName: string;
  backupPath: string;
  confirmed: boolean;
}

export interface MisterIniRestoreTrashRequest {
  profileId?: string;
  trashPath: string;
  targetFileName: string;
  confirmed: boolean;
}

export interface MisterIniDeleteTrashRequest {
  profileId?: string;
  trashPath: string;
  confirmed: boolean;
}

export interface MisterIniMetadataStore {
  schemaVersion: 1;
  profileId: string;
  updatedAt: string;
  files: MisterIniFileMetadata[];
}
