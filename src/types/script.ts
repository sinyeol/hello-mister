export interface ScriptFsCapabilityResult {
  ok: boolean;
  profileId?: string;
  state: 'disconnected' | 'connectedReadOnly' | 'connectedWritable' | 'writeCheckFailed';
  canRead: boolean;
  canWrite: boolean;
  checkedAt: string;
  message: string;
  errorCode?: string;
}

export interface ScriptFsFile {
  listId?: string;
  fileName: string;
  path: string;
  source: 'remote' | 'missing-remote';
  sizeBytes: number;
  modifiedAt?: string;
  backupCount: number;
  targetProfileId?: string;
  targetAlias?: string;
  targetHost?: string;
}

export interface ScriptFsListResult {
  ok: boolean;
  profileId?: string;
  files: ScriptFsFile[];
  cachedAt: string;
  message: string;
  errorCode?: string;
}

export interface ScriptFsReadResult {
  ok: boolean;
  profileId?: string;
  fileName: string;
  path: string;
  content: string;
  binary?: boolean;
  sizeBytes: number;
  readAt: string;
  message: string;
  errorCode?: string;
}

export interface ScriptFsBackupEntry {
  path: string;
  fileName: string;
  sourceFileName: string;
  sizeBytes: number;
  createdAt?: string;
}

export interface ScriptFsBackupListResult {
  ok: boolean;
  profileId?: string;
  fileName: string;
  backups: ScriptFsBackupEntry[];
  message: string;
  errorCode?: string;
}

export interface ScriptFsBackupPreviewResult {
  ok: boolean;
  fileName: string;
  backupPath: string;
  content: string;
  sizeBytes: number;
  readAt: string;
  message: string;
  errorCode?: string;
}

export interface ScriptFsTrashEntry {
  path: string;
  fileName: string;
  originalFileName: string;
  kind?: 'script' | 'backup';
  sizeBytes: number;
  movedAt?: string;
}

export interface ScriptFsTrashListResult {
  ok: boolean;
  profileId?: string;
  entries: ScriptFsTrashEntry[];
  message: string;
  errorCode?: string;
}

export interface ScriptFsOperationResult {
  ok: boolean;
  profileId?: string;
  fileName?: string;
  path?: string;
  backupPath?: string;
  backups?: ScriptFsBackupEntry[];
  message: string;
  errorCode?: string;
}

export type ScriptRunMode = 'foreground' | 'background';

export interface ScriptFsRunResult {
  ok: boolean;
  runId: string;
  profileId?: string;
  exitCode?: number | null;
  background?: boolean;
  logPath?: string;
  message: string;
  errorCode?: string;
}

export interface ScriptFsRunLogResult {
  ok: boolean;
  profileId?: string;
  logPath: string;
  content: string;
  sizeBytes?: number;
  message: string;
  errorCode?: string;
}

export interface ScriptRunChunk {
  runId: string;
  text: string;
}

export interface ScriptRunDone {
  runId: string;
  exitCode: number | null;
  ok: boolean;
}
