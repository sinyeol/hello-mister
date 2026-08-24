import type {
  ControllerArcadeButtonsResult,
  ControllerArcadeIndexResult,
  ControllerAutoMapResult,
  ControllerBackupListResult,
  ControllerBackupPreviewResult,
  ControllerBackupRequest,
  ControllerCloneResult,
  ControllerConnectedDevicesResult,
  ControllerInputCapsResult,
  ControllerFilePreview,
  ControllerInputEvent,
  ControllerInventoryResult,
  ControllerListMapsResult,
  ControllerMonitorResult,
  ControllerOperationResult,
  ControllerReadAllMapsResult,
  ControllerReadFileResult,
  ControllerReadMapResult,
  ControllerRestoreRequest,
  ControllerWriteMapResult,
  ControllerWriteMapsItem,
  ControllerWriteMapsResult,
} from '../../types/controllers';

const legacyPreviewByteLimit = 512;

function isBinaryControllerPath(remotePath: string) {
  return /\.map$/i.test(remotePath) || /joystick/i.test(remotePath);
}

function hasSuspiciousDecodedContent(content: string) {
  if (!content) return false;
  const replacementCount = (content.match(/\uFFFD/g) || []).length;
  let controlCount = 0;
  for (const char of content) {
    const code = char.charCodeAt(0);
    if (code < 32 && !['\n', '\r', '\t'].includes(char)) controlCount += 1;
  }
  return replacementCount > 0 || controlCount / Math.max(content.length, 1) > 0.12;
}

function decodedStringToPreviewBytes(content: string) {
  const bytes: number[] = [];
  for (let index = 0; index < content.length && bytes.length < legacyPreviewByteLimit; index += 1) {
    const code = content.charCodeAt(index);
    if (code === 0xfffd) {
      bytes.push(0xef, 0xbf, 0xbd);
    } else if (code <= 0xff) {
      bytes.push(code);
    } else {
      bytes.push((code >> 8) & 0xff, code & 0xff);
    }
  }
  return bytes.slice(0, legacyPreviewByteLimit);
}

function formatHexRows(bytes: number[]) {
  const rows: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const row = bytes.slice(offset, offset + 16);
    const hex = row.map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
    const ascii = row.map((byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.')).join('');
    rows.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(47, ' ')}  ${ascii}`);
  }
  return rows.join('\n');
}

function createLegacyDecodedControllerPreview(content: string): ControllerFilePreview {
  const bytes = decodedStringToPreviewBytes(content);
  return {
    mode: 'hex',
    byteCount: content.length,
    shownBytes: bytes.length,
    truncated: content.length > bytes.length,
    hex: formatHexRows(bytes),
    decimalBytes: bytes.map((byte) => String(byte)).join(' '),
    message: '이 파일은 바이너리 형식에 가까운 컨트롤러 매핑 파일입니다. 현재 실행 중인 앱이 정확한 byte preview metadata를 반환하지 않아 깨진 텍스트 대신 legacy decoded byte preview를 표시합니다. 앱을 최신 빌드로 완전히 재시작하면 원본 byte 기준 미리보기가 표시됩니다.',
  };
}

function withLegacyPreviewIfNeeded(result: ControllerReadFileResult, remotePath: string): ControllerReadFileResult {
  if (!result.ok || result.preview) return result;
  if (!isBinaryControllerPath(remotePath) && !hasSuspiciousDecodedContent(result.content)) return result;
  const preview = createLegacyDecodedControllerPreview(result.content);
  return {
    ...result,
    preview,
    content: preview.hex || '',
    message: result.message || '컨트롤러 파일을 안전한 byte preview로 표시합니다.',
  };
}

function unavailableInventory(): ControllerInventoryResult {
  const now = new Date().toISOString();
  const error = {
    path: 'desktop',
    message: 'Electron 환경에서만 컨트롤러 설정 파일을 읽을 수 있습니다.',
    errorCode: 'CONTROLLER_FS_DESKTOP_UNAVAILABLE',
  };
  return {
    ok: false,
    status: 'error',
    scannedAt: now,
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    candidateRoots: [],
    scannedRoots: [],
    candidateFolders: [],
    files: [],
    failedPaths: [error],
    errors: [error],
    summary: {
      scannedFolderCount: 0,
      candidateFileCount: 0,
      failedPathCount: 1,
    },
    diagnostics: {
      candidateRoots: [],
      scannedRoots: [],
      failedRoots: [error],
      errors: [error],
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      status: 'error',
    },
    message: error.message,
    errorCode: 'CONTROLLER_FS_DESKTOP_UNAVAILABLE',
  };
}

export const controllerDesktopService = {
  async scanInventory(profileId?: string): Promise<ControllerInventoryResult> {
    if (!window.helloMisterDesktop?.controllerFsScanInventory) return unavailableInventory();
    return window.helloMisterDesktop.controllerFsScanInventory({ profileId });
  },

  async readFile(profileId: string | undefined, path: string): Promise<ControllerReadFileResult> {
    const readControllerFile = window.helloMisterDesktop?.controllerFsReadControllerFile;
    const readLegacyFile = window.helloMisterDesktop?.controllerFsReadFile;
    if (!readControllerFile && !readLegacyFile) {
      return {
        ok: false,
        content: '',
        readAt: new Date().toISOString(),
        message: 'Electron 환경에서만 파일 내용을 볼 수 있습니다.',
        errorCode: 'CONTROLLER_FS_DESKTOP_UNAVAILABLE',
      };
    }
    if (readControllerFile) {
      try {
        const result = await readControllerFile({ profileId, path });
        return withLegacyPreviewIfNeeded(result, path);
      } catch (error) {
        if (!readLegacyFile || !/No handler registered for ['"]controllerFs:readControllerFile['"]/i.test(String(error))) throw error;
      }
    }
    const result = await readLegacyFile!({ profileId, path });
    return withLegacyPreviewIfNeeded(result, path);
  },

  async createBackup(request: ControllerBackupRequest): Promise<ControllerOperationResult> {
    if (!window.helloMisterDesktop?.controllerFsCreateBackup) {
      return {
        ok: false,
        sourcePath: request.sourcePath,
        message: 'Electron 환경에서만 백업을 만들 수 있습니다.',
        errorCode: 'CONTROLLER_FS_DESKTOP_UNAVAILABLE',
      };
    }
    return window.helloMisterDesktop.controllerFsCreateBackup(request);
  },

  async listBackups(profileId: string | undefined, sourcePath: string): Promise<ControllerBackupListResult> {
    if (!window.helloMisterDesktop?.controllerFsListBackups) {
      return {
        ok: false,
        sourcePath,
        backups: [],
        message: 'Electron 환경에서만 백업 목록을 볼 수 있습니다.',
        errorCode: 'CONTROLLER_FS_DESKTOP_UNAVAILABLE',
      };
    }
    return window.helloMisterDesktop.controllerFsListBackups({ profileId, sourcePath });
  },

  async readBackup(profileId: string | undefined, sourcePath: string, backupPath: string): Promise<ControllerBackupPreviewResult> {
    if (!window.helloMisterDesktop?.controllerFsReadBackup) {
      return {
        ok: false,
        sourcePath,
        content: '',
        readAt: new Date().toISOString(),
        message: 'Electron 환경에서만 백업 미리보기를 볼 수 있습니다.',
        errorCode: 'CONTROLLER_FS_DESKTOP_UNAVAILABLE',
      };
    }
    return window.helloMisterDesktop.controllerFsReadBackup({ profileId, sourcePath, backupPath });
  },

  async restoreBackup(request: ControllerRestoreRequest): Promise<ControllerOperationResult> {
    if (!window.helloMisterDesktop?.controllerFsRestoreBackup) {
      return {
        ok: false,
        sourcePath: request.sourcePath,
        targetPath: request.sourcePath,
        message: 'Electron 환경에서만 백업을 복원할 수 있습니다.',
        errorCode: 'CONTROLLER_FS_DESKTOP_UNAVAILABLE',
      };
    }
    return window.helloMisterDesktop.controllerFsRestoreBackup(request);
  },

  async listConnectedDevices(profileId?: string): Promise<ControllerConnectedDevicesResult> {
    if (!window.helloMisterDesktop?.controllerFsListConnectedDevices) {
      return { ok: false, devices: [], message: 'Electron 환경에서만 연결된 컨트롤러를 확인할 수 있습니다.', errorCode: 'CONTROLLER_FS_DESKTOP_UNAVAILABLE' };
    }
    return window.helloMisterDesktop.controllerFsListConnectedDevices({ profileId });
  },

  async readInputCaps(profileId: string | undefined, vid: string, pid: string): Promise<ControllerInputCapsResult> {
    if (!window.helloMisterDesktop?.controllerFsReadInputCaps) {
      return { ok: false, message: 'Electron 환경에서만 evdev 정보를 읽을 수 있습니다.', errorCode: 'CONTROLLER_FS_DESKTOP_UNAVAILABLE' };
    }
    return window.helloMisterDesktop.controllerFsReadInputCaps({ profileId, vid, pid });
  },

  async cloneMappings(request: { profileId?: string; source: { vid: string; pid: string; version: string }; target: { vid: string; pid: string }; dryRun?: boolean; confirmed?: boolean }): Promise<ControllerCloneResult> {
    if (!window.helloMisterDesktop?.controllerFsCloneMappings) {
      return { ok: false, plan: [], message: 'Electron 환경에서만 컨트롤러 매핑을 복제할 수 있습니다.', errorCode: 'CONTROLLER_FS_DESKTOP_UNAVAILABLE' };
    }
    return window.helloMisterDesktop.controllerFsCloneMappings(request);
  },

  async autoMap(request: { profileId?: string; source: { vid: string; pid: string; version: string }; target: { vid: string; pid: string }; onlyGames?: string[]; dryRun?: boolean; confirmed?: boolean }): Promise<ControllerAutoMapResult> {
    if (!window.helloMisterDesktop?.controllerFsAutoMap) {
      return { ok: false, message: 'Electron 환경에서만 자동 매핑을 할 수 있습니다.', errorCode: 'CONTROLLER_FS_DESKTOP_UNAVAILABLE' };
    }
    return window.helloMisterDesktop.controllerFsAutoMap(request);
  },

  async startInputMonitor(profileId: string | undefined, eventPath: string, monitorId: string): Promise<ControllerMonitorResult> {
    if (!window.helloMisterDesktop?.controllerFsStartInputMonitor) {
      return { ok: false, monitorId, message: 'Electron 환경에서만 입력 모니터를 쓸 수 있습니다.', errorCode: 'CONTROLLER_FS_DESKTOP_UNAVAILABLE' };
    }
    return window.helloMisterDesktop.controllerFsStartInputMonitor({ profileId, eventPath, monitorId });
  },

  async stopInputMonitor(monitorId: string): Promise<{ ok: boolean }> {
    if (!window.helloMisterDesktop?.controllerFsStopInputMonitor) return { ok: false };
    return window.helloMisterDesktop.controllerFsStopInputMonitor({ monitorId });
  },

  async listMaps(profileId: string | undefined, vid: string, pid: string): Promise<ControllerListMapsResult> {
    if (!window.helloMisterDesktop?.controllerFsListMaps) {
      return { ok: false, maps: [], message: 'Electron 환경에서만 코어 맵을 볼 수 있습니다.', errorCode: 'CONTROLLER_FS_DESKTOP_UNAVAILABLE' };
    }
    return window.helloMisterDesktop.controllerFsListMaps({ profileId, vid, pid });
  },

  async readMap(profileId: string | undefined, path: string): Promise<ControllerReadMapResult> {
    if (!window.helloMisterDesktop?.controllerFsReadMap) {
      return { ok: false, codes: [], message: 'Electron 환경에서만 맵을 읽을 수 있습니다.', errorCode: 'CONTROLLER_FS_DESKTOP_UNAVAILABLE' };
    }
    return window.helloMisterDesktop.controllerFsReadMap({ profileId, path });
  },

  async readAllMaps(profileId: string | undefined, vid: string, pid: string): Promise<ControllerReadAllMapsResult> {
    if (!window.helloMisterDesktop?.controllerFsReadAllMaps) {
      return { ok: false, maps: [], message: 'Electron 환경에서만 맵을 읽을 수 있습니다.', errorCode: 'CONTROLLER_FS_DESKTOP_UNAVAILABLE' };
    }
    return window.helloMisterDesktop.controllerFsReadAllMaps({ profileId, vid, pid });
  },

  async writeMap(request: { profileId?: string; path?: string; game?: string; vid?: string; pid?: string; version?: string; codes: number[] }): Promise<ControllerWriteMapResult> {
    if (!window.helloMisterDesktop?.controllerFsWriteMap) {
      return { ok: false, message: 'Electron 환경에서만 맵을 저장할 수 있습니다.', errorCode: 'CONTROLLER_FS_DESKTOP_UNAVAILABLE' };
    }
    return window.helloMisterDesktop.controllerFsWriteMap(request);
  },

  async writeMaps(request: { profileId?: string; vid?: string; pid?: string; version?: string; items: ControllerWriteMapsItem[] }): Promise<ControllerWriteMapsResult> {
    if (!window.helloMisterDesktop?.controllerFsWriteMaps) {
      return { ok: false, message: 'Electron 환경에서만 맵을 저장할 수 있습니다.', errorCode: 'CONTROLLER_FS_DESKTOP_UNAVAILABLE' };
    }
    return window.helloMisterDesktop.controllerFsWriteMaps(request);
  },

  async readArcadeButtons(profileId: string | undefined, game: string): Promise<ControllerArcadeButtonsResult> {
    if (!window.helloMisterDesktop?.controllerFsReadArcadeButtons) {
      return { ok: false, message: 'Electron 환경에서만 아케이드 버튼 이름을 볼 수 있습니다.', errorCode: 'CONTROLLER_FS_DESKTOP_UNAVAILABLE' };
    }
    return window.helloMisterDesktop.controllerFsReadArcadeButtons({ profileId, game });
  },

  async readArcadeIndex(profileId: string | undefined): Promise<ControllerArcadeIndexResult> {
    if (!window.helloMisterDesktop?.controllerFsReadArcadeIndex) {
      return { ok: false, index: {}, message: 'Electron 환경에서만 아케이드 인덱스를 만들 수 있습니다.', errorCode: 'CONTROLLER_FS_DESKTOP_UNAVAILABLE' };
    }
    return window.helloMisterDesktop.controllerFsReadArcadeIndex({ profileId });
  },

  onInputEvent(callback: (payload: ControllerInputEvent) => void): () => void {
    return window.helloMisterDesktop?.onControllerInputEvent ? window.helloMisterDesktop.onControllerInputEvent(callback) : () => undefined;
  },
};
