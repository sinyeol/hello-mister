import type {
  RomFsCapabilityCheckRequest,
  RomFsCapabilityResult,
  RomFsCopyLocalToMisterRequest,
  RomFsCopyMisterToLocalRequest,
  RomFsCopyMisterToMisterRequest,
  RomFsCreateLocalFolderRequest,
  RomFsCreateRemoteFolderRequest,
  RomFsDeleteRemoteRequest,
  RomFsEntry,
  RomFsListLocalTreeFolderResult,
  RomFsListLocalFolderResult,
  RomFsListRemoteResult,
  RomFsLocalTreeRootsResult,
  RomFsMoveRemoteRequest,
  RomFsOperationResult,
  RomFsRenameRemoteRequest,
  RomFsRestoreRemoteRequest,
  RomFsTrashRemoteRequest,
} from '../../types/rom';

const desktop = () => window.helloMisterDesktop;

export const ROM_FS_QUICK_PATHS = ['/', '/media', '/media/fat', '/media/fat/games', '/media/fat/_Arcade'] as const;
export const ROM_FS_ALLOWED_ROOTS = ROM_FS_QUICK_PATHS;

export function formatRomFsBytes(bytes = 0): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatRomFsEntryType(entry: Pick<RomFsEntry, 'type'>): string {
  if (entry.type === 'directory') return '폴더';
  if (entry.type === 'file') return '파일';
  return '알 수 없음';
}

export function formatRomFsExtension(entry: Pick<RomFsEntry, 'type' | 'extension' | 'name'>): string {
  if (entry.type === 'directory') return '폴더';
  const explicit = entry.extension?.trim().replace(/^\./, '').toLowerCase();
  const inferred = entry.name.includes('.') ? entry.name.split('.').pop()?.trim().toLowerCase() : '';
  const extension = explicit || inferred;
  return extension ? `.${extension}` : '-';
}

export function summarizeRomFsSelection(entries: Pick<RomFsEntry, 'sizeBytes'>[]): { count: number; totalBytes: number } {
  return {
    count: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + Number(entry.sizeBytes || 0), 0),
  };
}

export function selectRomFsRange(entries: Pick<RomFsEntry, 'id'>[], anchorId: string | undefined, targetId: string): string[] {
  const targetIndex = entries.findIndex((entry) => entry.id === targetId);
  if (targetIndex < 0) return [];
  const anchorIndex = anchorId ? entries.findIndex((entry) => entry.id === anchorId) : targetIndex;
  const safeAnchorIndex = anchorIndex < 0 ? targetIndex : anchorIndex;
  const start = Math.min(safeAnchorIndex, targetIndex);
  const end = Math.max(safeAnchorIndex, targetIndex);
  return entries.slice(start, end + 1).map((entry) => entry.id);
}

export function formatRomFsStatus(result?: Pick<RomFsOperationResult, 'status' | 'message'>): string {
  if (!result) return '대기';
  const labels: Record<string, string> = {
    queued: '대기',
    running: '진행 중',
    completed: '완료',
    failed: '실패',
    cancelled: '취소됨',
    partial: '일부 완료',
    skipped: '건너뜀',
  };
  return `${labels[result.status] || result.status} - ${result.message}`;
}

export function formatRomFsCapability(result?: Pick<RomFsCapabilityResult, 'status' | 'message'>): string {
  if (!result) return 'MiSTer 파일 권한 확인 전';
  const labels: Record<string, string> = {
    'not-connected': '연결 안 됨',
    checking: 'MiSTer 파일 권한 확인 중',
    readable: 'MiSTer 파일 읽기 가능',
    'read-write': 'MiSTer 파일 읽기/쓰기 가능',
    'write-denied': 'MiSTer 파일 읽기 가능, 쓰기 작업 허용',
    failed: 'MiSTer 파일 권한 확인 실패',
  };
  return labels[result.status] || result.message || result.status;
}

export function formatMisterDisplayName(profile?: { alias?: string; ipAddress?: string }): string {
  if (!profile) return 'MiSTer 연결 없음';
  const alias = profile.alias?.trim();
  const ipAddress = profile.ipAddress?.trim();
  if (alias && ipAddress && alias !== ipAddress) return `${alias} @ ${ipAddress}`;
  if (ipAddress) return `MiSTer @ ${ipAddress}`;
  return alias || 'MiSTer';
}

export function formatRomFsConnectionSummary(
  profile: { alias?: string; ipAddress?: string } | undefined,
  capability?: Pick<RomFsCapabilityResult, 'status' | 'message'>,
  checking = false,
): string {
  if (!profile) return 'MiSTer 연결 필요';
  if (checking) return 'MiSTer 연결됨 · 파일 권한 확인 중';
  return `MiSTer 연결됨 · ${formatRomFsCapability(capability)}`;
}

export function shouldShowRomFsEntry(
  entry: Pick<RomFsEntry, 'name'>,
  options: { showInternal?: boolean; isTrashView?: boolean } = {},
): boolean {
  if (options.showInternal) return true;
  if (entry.name === '.hello-mister-rw-check') return false;
  if (entry.name === '.hello-mister-trash') return Boolean(options.isTrashView);
  return true;
}

export function isRomFsWriteReady(activeProfileId?: string): boolean {
  return Boolean(activeProfileId && desktop());
}

export async function listRemoteRomFolder(profileId: string | undefined, path: string): Promise<RomFsListRemoteResult> {
  const api = desktop();
  if (!api?.romFsListRemote) return { ok: false, path, entries: [], message: 'Electron ROM 파일 관리 IPC를 사용할 수 없습니다.' };
  return api.romFsListRemote({ profileId, path });
}

export async function checkRomFsCapability(request: RomFsCapabilityCheckRequest = {}): Promise<RomFsCapabilityResult> {
  const api = desktop();
  if (!api?.romFsCheckCapability) {
    return {
      ok: false,
      status: 'failed',
      canRead: false,
      canWrite: false,
      checkedAt: new Date().toISOString(),
      errorCode: 'ROM_FS_IPC_UNAVAILABLE',
      message: '브라우저 fallback에서는 MiSTer 파일 쓰기 권한을 확인할 수 없습니다. Electron 앱에서 실행하세요.',
    };
  }
  return api.romFsCheckCapability(request);
}

export async function selectLocalRomFolder(): Promise<{ ok: boolean; cancelled?: boolean; folderPath?: string; message: string }> {
  const api = desktop();
  if (!api?.romFsSelectLocalFolder) return { ok: false, message: 'Electron 파일 선택 기능을 사용할 수 없습니다.' };
  return api.romFsSelectLocalFolder();
}

export async function listLocalRomFolder(folderPath: string): Promise<RomFsListLocalFolderResult> {
  const api = desktop();
  if (!api?.romFsListLocalFolder) return { ok: false, folderPath, entries: [], message: 'Electron PC 폴더 탐색 기능을 사용할 수 없습니다.' };
  return api.romFsListLocalFolder({ folderPath });
}

export async function listLocalRomTreeRoots(): Promise<RomFsLocalTreeRootsResult> {
  const api = desktop();
  if (!api?.romFsListLocalTreeRoots) return { ok: false, roots: [], message: 'Electron PC 폴더 트리 기능을 사용할 수 없습니다.' };
  return api.romFsListLocalTreeRoots();
}

export async function listLocalRomTreeFolder(folderPath: string, depth = 0): Promise<RomFsListLocalTreeFolderResult> {
  const api = desktop();
  if (!api?.romFsListLocalTreeFolder) return { ok: false, folderPath, children: [], message: 'Electron PC 폴더 트리 기능을 사용할 수 없습니다.' };
  return api.romFsListLocalTreeFolder({ folderPath, depth });
}

export async function copyLocalToMister(request: RomFsCopyLocalToMisterRequest): Promise<RomFsOperationResult> {
  const api = desktop();
  if (!api?.romFsCopyLocalToMister) return failedOperation('localToMisterCopy', 'Electron ROM 복사 IPC를 사용할 수 없습니다.');
  return api.romFsCopyLocalToMister(request);
}

export async function copyMisterToLocal(request: RomFsCopyMisterToLocalRequest): Promise<RomFsOperationResult> {
  const api = desktop();
  if (!api?.romFsCopyMisterToLocal) return failedOperation('misterToLocalCopy', 'Electron ROM 복사 IPC를 사용할 수 없습니다.');
  return api.romFsCopyMisterToLocal(request);
}

export async function copyMisterToMister(request: RomFsCopyMisterToMisterRequest): Promise<RomFsOperationResult> {
  const api = desktop();
  if (!api?.romFsCopyMisterToMister) return failedOperation('misterToMisterCopy', 'Electron ROM 복사 IPC를 사용할 수 없습니다.');
  return api.romFsCopyMisterToMister(request);
}

export async function moveRemoteRom(request: RomFsMoveRemoteRequest): Promise<RomFsOperationResult> {
  const api = desktop();
  if (!api?.romFsMoveRemote) return failedOperation('moveRemote', 'Electron ROM 이동 IPC를 사용할 수 없습니다.');
  return api.romFsMoveRemote(request);
}

export async function renameRemoteRom(request: RomFsRenameRemoteRequest): Promise<RomFsOperationResult> {
  const api = desktop();
  if (!api?.romFsRenameRemote) return failedOperation('renameRemote', 'Electron ROM 이름 변경 IPC를 사용할 수 없습니다.');
  return api.romFsRenameRemote(request);
}

export async function trashRemoteRom(request: RomFsTrashRemoteRequest): Promise<RomFsOperationResult> {
  const api = desktop();
  if (!api?.romFsTrashRemote) return failedOperation('trashRemote', 'Electron ROM 휴지통 IPC를 사용할 수 없습니다.');
  return api.romFsTrashRemote(request);
}

export async function deleteRemoteRom(request: RomFsDeleteRemoteRequest): Promise<RomFsOperationResult> {
  const api = desktop();
  if (!api?.romFsDeleteRemote) return failedOperation('deleteRemote', 'Electron ROM 영구 삭제 IPC를 사용할 수 없습니다.');
  return api.romFsDeleteRemote(request);
}

export async function restoreRemoteRom(request: RomFsRestoreRemoteRequest): Promise<RomFsOperationResult> {
  const api = desktop();
  if (!api?.romFsRestoreRemote) return failedOperation('restoreRemote', 'Electron ROM 복구 IPC를 사용할 수 없습니다.');
  return api.romFsRestoreRemote(request);
}

export async function createRemoteRomFolder(request: RomFsCreateRemoteFolderRequest): Promise<RomFsOperationResult> {
  const api = desktop();
  if (!api?.romFsCreateRemoteFolder) return failedOperation('createFolderRemote', 'Electron ROM 폴더 생성 IPC를 사용할 수 없습니다.');
  return api.romFsCreateRemoteFolder(request);
}

export async function createLocalRomFolder(request: RomFsCreateLocalFolderRequest): Promise<RomFsOperationResult> {
  const api = desktop();
  if (!api?.romFsCreateLocalFolder) return failedOperation('createFolderLocal', 'Electron PC 폴더 생성 IPC를 사용할 수 없습니다.');
  return api.romFsCreateLocalFolder(request);
}

function failedOperation(operationType: RomFsOperationResult['operationType'], message: string): RomFsOperationResult {
  const now = new Date().toISOString();
  return {
    ok: false,
    operationType,
    status: 'failed',
    startedAt: now,
    finishedAt: now,
    fileCount: 0,
    totalBytes: 0,
    errorCode: 'ROM_FS_IPC_UNAVAILABLE',
    message,
  };
}
