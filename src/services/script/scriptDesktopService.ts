import type {
  ScriptFsBackupListResult,
  ScriptFsBackupPreviewResult,
  ScriptFsCapabilityResult,
  ScriptFsListResult,
  ScriptFsOperationResult,
  ScriptFsReadResult,
  ScriptFsRunLogResult,
  ScriptFsRunResult,
  ScriptFsTrashListResult,
  ScriptRunChunk,
  ScriptRunDone,
  ScriptRunMode,
} from '../../types/script';

function desktop() {
  return window.helloMisterDesktop;
}

const unavailable = 'Electron 스크립트 API를 사용할 수 없습니다.';

export const ScriptDesktopService = {
  async checkCapability(profileId?: string): Promise<ScriptFsCapabilityResult> {
    const api = desktop();
    if (!api?.scriptFsCheckCapability) {
      return { ok: false, profileId, state: profileId ? 'writeCheckFailed' : 'disconnected', canRead: false, canWrite: false, checkedAt: new Date().toISOString(), message: unavailable, errorCode: 'SCRIPT_FS_API_UNAVAILABLE' };
    }
    return api.scriptFsCheckCapability({ profileId });
  },

  async listRemote(profileId?: string): Promise<ScriptFsListResult> {
    const api = desktop();
    if (!api?.scriptFsListRemote) return { ok: false, files: [], cachedAt: new Date().toISOString(), message: unavailable, errorCode: 'SCRIPT_FS_API_UNAVAILABLE' };
    return api.scriptFsListRemote({ profileId });
  },

  async readRemote(profileId: string | undefined, fileName: string): Promise<ScriptFsReadResult> {
    const api = desktop();
    if (!api?.scriptFsReadRemote) return { ok: false, fileName, path: '', content: '', sizeBytes: 0, readAt: new Date().toISOString(), message: unavailable, errorCode: 'SCRIPT_FS_API_UNAVAILABLE' };
    return api.scriptFsReadRemote({ profileId, fileName });
  },

  async writeRemote(profileId: string | undefined, fileName: string, content: string): Promise<ScriptFsOperationResult> {
    const api = desktop();
    if (!api?.scriptFsWriteRemote) return { ok: false, fileName, message: unavailable, errorCode: 'SCRIPT_FS_API_UNAVAILABLE' };
    return api.scriptFsWriteRemote({ profileId, fileName, content, confirmed: true });
  },

  async createBackup(profileId: string | undefined, fileName: string): Promise<ScriptFsBackupListResult> {
    const api = desktop();
    if (!api?.scriptFsCreateBackup) return { ok: false, fileName, backups: [], message: unavailable, errorCode: 'SCRIPT_FS_API_UNAVAILABLE' };
    return api.scriptFsCreateBackup({ profileId, fileName });
  },

  async listBackups(profileId: string | undefined, fileName: string): Promise<ScriptFsBackupListResult> {
    const api = desktop();
    if (!api?.scriptFsListBackups) return { ok: false, fileName, backups: [], message: unavailable, errorCode: 'SCRIPT_FS_API_UNAVAILABLE' };
    return api.scriptFsListBackups({ profileId, fileName });
  },

  async previewBackup(profileId: string | undefined, fileName: string, backupPath: string): Promise<ScriptFsBackupPreviewResult> {
    const api = desktop();
    if (!api?.scriptFsPreviewBackup) return { ok: false, fileName, backupPath, content: '', sizeBytes: 0, readAt: new Date().toISOString(), message: unavailable, errorCode: 'SCRIPT_FS_API_UNAVAILABLE' };
    return api.scriptFsPreviewBackup({ profileId, fileName, backupPath });
  },

  async restoreBackup(profileId: string | undefined, fileName: string, backupPath: string): Promise<ScriptFsOperationResult> {
    const api = desktop();
    if (!api?.scriptFsRestoreBackup) return { ok: false, fileName, message: unavailable, errorCode: 'SCRIPT_FS_API_UNAVAILABLE' };
    return api.scriptFsRestoreBackup({ profileId, fileName, backupPath, confirmed: true });
  },

  async deleteBackup(profileId: string | undefined, fileName: string, backupPath: string): Promise<ScriptFsOperationResult> {
    const api = desktop();
    if (!api?.scriptFsDeleteBackup) return { ok: false, fileName, message: unavailable, errorCode: 'SCRIPT_FS_API_UNAVAILABLE' };
    return api.scriptFsDeleteBackup({ profileId, fileName, backupPath, confirmed: true });
  },

  async trash(profileId: string | undefined, fileName: string): Promise<ScriptFsOperationResult> {
    const api = desktop();
    if (!api?.scriptFsTrash) return { ok: false, fileName, message: unavailable, errorCode: 'SCRIPT_FS_API_UNAVAILABLE' };
    return api.scriptFsTrash({ profileId, fileName, confirmed: true });
  },

  async listTrash(profileId?: string): Promise<ScriptFsTrashListResult> {
    const api = desktop();
    if (!api?.scriptFsListTrash) return { ok: false, entries: [], message: unavailable, errorCode: 'SCRIPT_FS_API_UNAVAILABLE' };
    return api.scriptFsListTrash({ profileId });
  },

  async restoreTrashed(profileId: string | undefined, trashPath: string, targetFileName: string): Promise<ScriptFsOperationResult> {
    const api = desktop();
    if (!api?.scriptFsRestoreTrashed) return { ok: false, fileName: targetFileName, message: unavailable, errorCode: 'SCRIPT_FS_API_UNAVAILABLE' };
    return api.scriptFsRestoreTrashed({ profileId, trashPath, targetFileName, confirmed: true });
  },

  async deleteTrashed(profileId: string | undefined, trashPath: string): Promise<ScriptFsOperationResult> {
    const api = desktop();
    if (!api?.scriptFsDeleteTrashed) return { ok: false, message: unavailable, errorCode: 'SCRIPT_FS_API_UNAVAILABLE' };
    return api.scriptFsDeleteTrashed({ profileId, trashPath, confirmed: true });
  },

  async emptyTrash(profileId?: string): Promise<ScriptFsOperationResult> {
    const api = desktop();
    if (!api?.scriptFsEmptyTrash) return { ok: false, message: unavailable, errorCode: 'SCRIPT_FS_API_UNAVAILABLE' };
    return api.scriptFsEmptyTrash({ profileId, confirmed: true });
  },

  async exportLocal(profileId: string | undefined, fileName: string): Promise<ScriptFsOperationResult> {
    const api = desktop();
    if (!api?.scriptFsExportLocal) return { ok: false, fileName, message: unavailable, errorCode: 'SCRIPT_FS_API_UNAVAILABLE' };
    return api.scriptFsExportLocal({ profileId, fileName });
  },

  async importLocal(profileId?: string): Promise<ScriptFsOperationResult> {
    const api = desktop();
    if (!api?.scriptFsImportLocal) return { ok: false, message: unavailable, errorCode: 'SCRIPT_FS_API_UNAVAILABLE' };
    return api.scriptFsImportLocal({ profileId, confirmed: true });
  },

  async run(profileId: string | undefined, fileName: string, runId: string, mode: ScriptRunMode = 'foreground'): Promise<ScriptFsRunResult> {
    const api = desktop();
    if (!api?.scriptFsRun) return { ok: false, runId, message: unavailable, errorCode: 'SCRIPT_FS_API_UNAVAILABLE' };
    return api.scriptFsRun({ profileId, fileName, runId, confirmed: true, mode });
  },

  async readRunLog(profileId: string | undefined, logPath: string): Promise<ScriptFsRunLogResult> {
    const api = desktop();
    if (!api?.scriptFsReadRunLog) return { ok: false, logPath, content: '', message: unavailable, errorCode: 'SCRIPT_FS_API_UNAVAILABLE' };
    return api.scriptFsReadRunLog({ profileId, logPath });
  },

  async copyToDevice(profileId: string | undefined, targetProfileId: string, fileName: string): Promise<ScriptFsOperationResult> {
    const api = desktop();
    if (!api?.scriptFsCopyToDevice) return { ok: false, fileName, message: unavailable, errorCode: 'SCRIPT_FS_API_UNAVAILABLE' };
    return api.scriptFsCopyToDevice({ profileId, targetProfileId, fileName, confirmed: true });
  },

  async installFromUrl(profileId: string | undefined, fileName: string, url: string): Promise<ScriptFsOperationResult> {
    const api = desktop();
    if (!api?.scriptFsInstallFromUrl) return { ok: false, fileName, message: unavailable, errorCode: 'SCRIPT_FS_API_UNAVAILABLE' };
    return api.scriptFsInstallFromUrl({ profileId, fileName, url, confirmed: true });
  },

  onRunChunk(callback: (payload: ScriptRunChunk) => void): () => void {
    const api = desktop();
    return api?.onScriptRunChunk ? api.onScriptRunChunk(callback) : () => undefined;
  },

  onRunDone(callback: (payload: ScriptRunDone) => void): () => void {
    const api = desktop();
    return api?.onScriptRunDone ? api.onScriptRunDone(callback) : () => undefined;
  },
};
