import type {
  MisterIniBackupListResult,
  MisterIniBackupPreviewResult,
  MisterIniDeleteBackupRequest,
  MisterIniDeleteTrashRequest,
  MisterIniIndex,
  MisterIniLocalImportResult,
  MisterIniMetadataStore,
  MisterIniOperationResult,
  MisterIniReadResult,
  MisterIniRestoreRequest,
  MisterIniRestoreTrashRequest,
  MisterIniTrashListResult,
  MisterIniTrashRequest,
  MisterIniWriteCapabilityResult,
  MisterIniWriteRequest,
} from '../../types/ini';

function desktop() {
  return window.helloMisterDesktop;
}

export const MisterIniDesktopService = {
  async checkWriteCapability(profileId?: string): Promise<MisterIniWriteCapabilityResult> {
    const api = desktop();
    if (!api?.iniFsCheckWriteCapability) {
      return {
        ok: false,
        profileId,
        state: profileId ? 'writeCheckFailed' : 'disconnected',
        canRead: false,
        canWrite: false,
        checkedAt: new Date().toISOString(),
        message: 'Electron INI 쓰기 권한 확인 API를 사용할 수 없습니다.',
        errorCode: 'INI_FS_API_UNAVAILABLE',
      };
    }
    return api.iniFsCheckWriteCapability({ profileId });
  },

  async listRemoteIni(profileId?: string): Promise<MisterIniIndex> {
    const api = desktop();
    if (!api?.iniFsListRemoteIni) return { ok: false, files: [], cachedAt: new Date().toISOString(), message: 'Electron INI 파일 API를 사용할 수 없습니다.', errorCode: 'INI_FS_API_UNAVAILABLE' };
    return api.iniFsListRemoteIni({ profileId });
  },

  async readRemoteIni(profileId: string | undefined, fileName: string): Promise<MisterIniReadResult> {
    const api = desktop();
    if (!api?.iniFsReadRemoteIni) {
      return { ok: false, fileName, path: '', content: '', sizeBytes: 0, readAt: new Date().toISOString(), message: 'Electron INI 읽기 API를 사용할 수 없습니다.', errorCode: 'INI_FS_API_UNAVAILABLE' };
    }
    return api.iniFsReadRemoteIni({ profileId, fileName });
  },

  async writeRemoteIniWithBackup(request: MisterIniWriteRequest): Promise<MisterIniOperationResult> {
    const api = desktop();
    if (!api?.iniFsWriteRemoteIniWithBackup) return { ok: false, fileName: request.fileName, message: 'Electron INI 저장 API를 사용할 수 없습니다.', errorCode: 'INI_FS_API_UNAVAILABLE' };
    return api.iniFsWriteRemoteIniWithBackup(request);
  },

  async createBackup(profileId: string | undefined, fileName: string): Promise<MisterIniBackupListResult> {
    const api = desktop();
    if (!api?.iniFsCreateBackup) return { ok: false, fileName, backups: [], message: 'Electron INI 백업 생성 API를 사용할 수 없습니다.', errorCode: 'INI_FS_API_UNAVAILABLE' };
    return api.iniFsCreateBackup({ profileId, fileName });
  },

  async listBackups(profileId: string | undefined, fileName: string): Promise<MisterIniBackupListResult> {
    const api = desktop();
    if (!api?.iniFsListBackups) return { ok: false, fileName, backups: [], message: 'Electron INI 백업 API를 사용할 수 없습니다.', errorCode: 'INI_FS_API_UNAVAILABLE' };
    return api.iniFsListBackups({ profileId, fileName });
  },

  async previewBackup(profileId: string | undefined, fileName: string, backupPath: string): Promise<MisterIniBackupPreviewResult> {
    const api = desktop();
    if (!api?.iniFsPreviewBackup) {
      return {
        ok: false,
        fileName,
        backupPath,
        content: '',
        sizeBytes: 0,
        readAt: new Date().toISOString(),
        message: 'Electron INI 백업 미리보기 API를 사용할 수 없습니다.',
        errorCode: 'INI_FS_API_UNAVAILABLE',
      };
    }
    return api.iniFsPreviewBackup({ profileId, fileName, backupPath });
  },

  async restoreBackup(request: MisterIniRestoreRequest): Promise<MisterIniOperationResult> {
    const api = desktop();
    if (!api?.iniFsRestoreBackup) return { ok: false, fileName: request.fileName, message: 'Electron INI 백업 복원 API를 사용할 수 없습니다.', errorCode: 'INI_FS_API_UNAVAILABLE' };
    return api.iniFsRestoreBackup(request);
  },

  async deleteBackup(request: MisterIniDeleteBackupRequest): Promise<MisterIniOperationResult> {
    const api = desktop();
    if (!api?.iniFsDeleteBackup) return { ok: false, fileName: request.fileName, message: 'Electron INI 백업 삭제 API를 사용할 수 없습니다.', errorCode: 'INI_FS_API_UNAVAILABLE' };
    return api.iniFsDeleteBackup(request);
  },

  async trashIni(request: MisterIniTrashRequest): Promise<MisterIniOperationResult> {
    const api = desktop();
    if (!api?.iniFsTrashIni) return { ok: false, fileName: request.fileName, message: 'Electron INI 휴지통 API를 사용할 수 없습니다.', errorCode: 'INI_FS_API_UNAVAILABLE' };
    return api.iniFsTrashIni(request);
  },

  async listTrash(profileId?: string): Promise<MisterIniTrashListResult> {
    const api = desktop();
    if (!api?.iniFsListTrash) return { ok: false, entries: [], message: 'Electron INI 휴지통 목록 API를 사용할 수 없습니다.', errorCode: 'INI_FS_API_UNAVAILABLE' };
    return api.iniFsListTrash({ profileId });
  },

  async restoreTrashedIni(request: MisterIniRestoreTrashRequest): Promise<MisterIniOperationResult> {
    const api = desktop();
    if (!api?.iniFsRestoreTrashedIni) return { ok: false, fileName: request.targetFileName, message: 'Electron INI 휴지통 복구 API를 사용할 수 없습니다.', errorCode: 'INI_FS_API_UNAVAILABLE' };
    return api.iniFsRestoreTrashedIni(request);
  },

  async deleteTrashedIni(request: MisterIniDeleteTrashRequest): Promise<MisterIniOperationResult> {
    const api = desktop();
    if (!api?.iniFsDeleteTrashedIni) return { ok: false, message: 'Electron INI 휴지통 영구 삭제 API를 사용할 수 없습니다.', errorCode: 'INI_FS_API_UNAVAILABLE' };
    return api.iniFsDeleteTrashedIni(request);
  },

  async emptyTrash(profileId?: string): Promise<MisterIniOperationResult> {
    const api = desktop();
    if (!api?.iniFsEmptyTrash) return { ok: false, message: 'Electron INI 휴지통 비우기 API를 사용할 수 없습니다.', errorCode: 'INI_FS_API_UNAVAILABLE' };
    return api.iniFsEmptyTrash({ profileId, confirmed: true });
  },

  async loadMetadata(profileId?: string): Promise<MisterIniMetadataStore> {
    const api = desktop();
    return api?.iniFsLoadMetadata
      ? api.iniFsLoadMetadata({ profileId })
      : { schemaVersion: 1, profileId: profileId || 'browser-fallback', updatedAt: new Date().toISOString(), files: [] };
  },

  async saveMetadata(store: MisterIniMetadataStore): Promise<MisterIniMetadataStore> {
    const api = desktop();
    return api?.iniFsSaveMetadata ? api.iniFsSaveMetadata(store) : store;
  },

  async exportIniLocal(profileId: string | undefined, fileName: string): Promise<MisterIniOperationResult> {
    const api = desktop();
    if (!api?.iniFsExportIniLocal) return { ok: false, fileName, message: 'Electron INI 내보내기 API를 사용할 수 없습니다.', errorCode: 'INI_FS_API_UNAVAILABLE' };
    return api.iniFsExportIniLocal({ profileId, fileName });
  },

  async importIniLocal(profileId: string | undefined, targetFileName?: string): Promise<MisterIniLocalImportResult> {
    const api = desktop();
    if (!api?.iniFsImportIniLocal) return { ok: false, fileName: targetFileName, message: 'Electron INI 가져오기 API를 사용할 수 없습니다.', errorCode: 'INI_FS_API_UNAVAILABLE' };
    return api.iniFsImportIniLocal({ profileId, targetFileName });
  },
};
