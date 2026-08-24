import { requiredMiSTerPaths } from '@sticker-v1/services/mister/misterPersistence';
import { parseMiSTerPathList } from '@sticker-v1/services/mister/misterScan';
import { arcadeCorePlatformName, isGenericArcadeSystemId } from '@sticker-v1/services/mister/misterCoreRegistry';
import defaultScanFilterConfig from '@sticker-v1/config/defaultMisterScanFilters.json';
import { normalizeName } from '@sticker-v1/utils/normalizeName';
import { ZaparooApiClient } from '../../../../services/zaparoo/zaparooApiClient';
import type { MiSTerPlatformCatalogItem } from '@sticker-v1/data/misterPlatformCatalog';
import type { ActiveMisterProfile, MisterRemoteFingerprint, RemoteErrorCode } from '../../../../types/mister';
import type {
  MiSTerConnectionConfig,
  MiSTerConnectionState,
  MiSTerBridgeScanRootStatus,
  MiSTerBridgeScanSummary,
  MiSTerScanFilterConfig,
  MiSTerScanFilterConfigSummary,
  MiSTerScanEntry,
  TagWriteJob,
  TagWritePayload,
} from '@sticker-v1/types';

export type MiSTerBridgeConnectionResult = Pick<MiSTerConnectionState, 'status' | 'message' | 'zaparooInstalled' | 'requiredPaths' | 'connectionId' | 'zaparooCommand' | 'zaparooCommandStatus'> & {
  ok?: boolean;
};

export interface MiSTerBridgeScanResult {
  ok: boolean;
  entries: MiSTerScanEntry[];
  sessionId?: string;
  paths?: string[];
  rootStatuses?: MiSTerBridgeScanRootStatus[];
  summary?: MiSTerBridgeScanSummary;
  config?: MiSTerScanFilterConfigSummary;
  message?: string;
  customPlatformDiagnostics?: CustomPlatformScanDiagnostics;
}

export interface CustomPlatformScanDiagnostics {
  sourceRoots: string[];
  scanDepth: number;
  recursive: boolean;
  foldersScanned: number;
  totalFiles: number;
  mraFiles: number;
  extensionAcceptedFiles: number;
  extensionExcludedFiles: number;
  folderExcludedFiles: number;
  depthLimitedFolders: number;
  duplicateFullPathFiles: number;
  unsupportedFiles: number;
  finalCandidateFiles: number;
  failedFolders: number;
  truncated: boolean;
  reasonCounts: Record<string, number>;
  excludedExtensionCounts: Record<string, number>;
  examples: string[];
}

export interface MiSTerBridgeTagWriteResult {
  ok: boolean;
  job: TagWriteJob;
  message?: string;
}

export interface MiSTerBridgeClient {
  testConnection(config: MiSTerConnectionConfig): Promise<MiSTerBridgeConnectionResult>;
  disconnect(connectionId: string): Promise<{ ok: boolean; disconnected: boolean; message?: string }>;
  scanLibrary(config: MiSTerConnectionConfig, connectionId?: string): Promise<MiSTerBridgeScanResult>;
  scanCustomPlatformSource(config: MiSTerConnectionConfig, item: MiSTerPlatformCatalogItem, connectionId?: string): Promise<MiSTerBridgeScanResult>;
  launchGame(config: MiSTerConnectionConfig, launchText: string, connectionId?: string): Promise<{ ok: boolean; message: string; stdout?: string; stderr?: string }>;
  writeTag(config: MiSTerConnectionConfig, payload: TagWritePayload, connectionId?: string): Promise<MiSTerBridgeTagWriteResult>;
  readTag(config: MiSTerConnectionConfig, connectionId?: string): Promise<{ ok: boolean; readText?: string; message: string }>;
  verifyTag(config: MiSTerConnectionConfig, payload: TagWritePayload, connectionId?: string): Promise<{ ok: boolean; readText?: string; message: string }>;
}

export interface MiSTerScanFilterConfigResult {
  ok: boolean;
  config: MiSTerScanFilterConfig;
  source: string;
  path?: string;
  lastSavedAt?: string;
}

const browserScanFilterSettingsKey = 'misterScanFilters';
const browserSettingsDbName = 'zaparoo-app-settings';
const browserSettingsStoreName = 'settings';

function migrateBrowserScanFilterConfig(config?: Partial<MiSTerScanFilterConfig> | null): MiSTerScanFilterConfig {
  const defaults = defaultScanFilterConfig as MiSTerScanFilterConfig;
  const incoming = (config?.misterScan ?? {}) as Partial<MiSTerScanFilterConfig['misterScan']>;
  const normalizeExtensions = (values?: string[]) =>
    (values && values.length > 0 ? values : []).map((value) => {
      const normalized = String(value).trim().toLowerCase();
      return normalized.startsWith('.') ? normalized : `.${normalized}`;
    }).filter((value) => value !== '.');
  return {
    version: defaults.version,
    misterScan: {
      ...defaults.misterScan,
      ...incoming,
      roots: incoming.roots?.length ? incoming.roots : defaults.misterScan.roots,
      ignoredDirectories: incoming.ignoredDirectories?.length ? incoming.ignoredDirectories : defaults.misterScan.ignoredDirectories,
      includedExtensions: normalizeExtensions(incoming.includedExtensions).length
        ? normalizeExtensions(incoming.includedExtensions)
        : defaults.misterScan.includedExtensions,
      excludedExtensions: normalizeExtensions(incoming.excludedExtensions).length
        ? normalizeExtensions(incoming.excludedExtensions)
        : defaults.misterScan.excludedExtensions,
      tinyFileAllowedExtensions: normalizeExtensions(incoming.tinyFileAllowedExtensions).length
        ? normalizeExtensions(incoming.tinyFileAllowedExtensions)
        : defaults.misterScan.tinyFileAllowedExtensions,
      skipFilesAtOrBelowBytes: Number(incoming.skipFilesAtOrBelowBytes ?? incoming.minGameFileSizeBytes ?? defaults.misterScan.skipFilesAtOrBelowBytes),
      minGameFileSizeBytes: Number(incoming.skipFilesAtOrBelowBytes ?? incoming.minGameFileSizeBytes ?? defaults.misterScan.skipFilesAtOrBelowBytes),
      platformImportMode: incoming.platformImportMode ?? defaults.misterScan.platformImportMode,
      newPlatformBehavior: incoming.newPlatformBehavior ?? defaults.misterScan.newPlatformBehavior,
    },
  };
}

function openBrowserSettingsDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available.'));
      return;
    }
    const request = indexedDB.open(browserSettingsDbName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(browserSettingsStoreName)) {
        request.result.createObjectStore(browserSettingsStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getBrowserSetting<T>(key: string) {
  const db = await openBrowserSettingsDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const request = db.transaction(browserSettingsStoreName, 'readonly').objectStore(browserSettingsStoreName).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

async function setBrowserSetting<T>(key: string, value: T) {
  const db = await openBrowserSettingsDb();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(browserSettingsStoreName, 'readwrite').objectStore(browserSettingsStoreName).put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

async function loadBrowserScanFilterConfig(): Promise<MiSTerScanFilterConfigResult> {
  const now = new Date().toISOString();
  try {
    const saved = await getBrowserSetting<{ config: MiSTerScanFilterConfig; lastSavedAt?: string }>(browserScanFilterSettingsKey);
    if (saved?.config) {
      const config = migrateBrowserScanFilterConfig(saved.config);
      if (saved.config.version !== config.version) {
        await setBrowserSetting(browserScanFilterSettingsKey, { config, lastSavedAt: now });
        return { ok: true, config, source: 'indexedDbFallback', lastSavedAt: now };
      }
      return { ok: true, config, source: 'indexedDbFallback', lastSavedAt: saved.lastSavedAt };
    }
    const config = migrateBrowserScanFilterConfig(defaultScanFilterConfig as MiSTerScanFilterConfig);
    await setBrowserSetting(browserScanFilterSettingsKey, { config, lastSavedAt: now });
    return { ok: true, config, source: 'indexedDbFallback', lastSavedAt: now };
  } catch {
    const raw = localStorage.getItem('zaparoo.mister.scanFilters.v1');
    let parsed: { config?: MiSTerScanFilterConfig; lastSavedAt?: string } | undefined;
    try {
      parsed = raw ? JSON.parse(raw) as { config?: MiSTerScanFilterConfig; lastSavedAt?: string } : undefined;
    } catch {
      parsed = undefined;
    }
    const config = migrateBrowserScanFilterConfig(parsed?.config ?? defaultScanFilterConfig as MiSTerScanFilterConfig);
    localStorage.setItem('zaparoo.mister.scanFilters.v1', JSON.stringify({ config, lastSavedAt: parsed?.lastSavedAt ?? now }));
    return { ok: true, config, source: 'indexedDbFallback', lastSavedAt: parsed?.lastSavedAt ?? now };
  }
}

async function saveBrowserScanFilterConfig(config: MiSTerScanFilterConfig): Promise<MiSTerScanFilterConfigResult> {
  const migrated = migrateBrowserScanFilterConfig(config);
  const lastSavedAt = new Date().toISOString();
  try {
    await setBrowserSetting(browserScanFilterSettingsKey, { config: migrated, lastSavedAt });
  } catch {
    localStorage.setItem('zaparoo.mister.scanFilters.v1', JSON.stringify({ config: migrated, lastSavedAt }));
  }
  return { ok: true, config: migrated, source: 'indexedDbFallback', lastSavedAt };
}

function bridgeBaseUrl() {
  return localStorage.getItem('zaparoo.mister.bridgeUrl.v1') || 'http://127.0.0.1:37321';
}

function helloMisterDesktopApi() {
  return typeof window !== 'undefined' ? window.helloMisterDesktop : undefined;
}

function remotePathExists(fingerprint: MisterRemoteFingerprint, targetPath: string) {
  return fingerprint.pathStatuses.some((item) => item.path === targetPath && item.exists);
}

function scanFailureMessage(errorCode?: RemoteErrorCode, fallback?: string) {
  if (errorCode === 'AUTH_FAILED') return 'MiSTer 인증에 실패했습니다. 저장된 비밀번호를 확인하세요.';
  if (errorCode === 'HOST_KEY_MISMATCH') return 'MiSTer 신뢰 키가 변경되어 연결을 차단했습니다.';
  if (errorCode === 'REMOTE_PATH_MISSING' || errorCode === 'NOT_MISTER') return 'MiSTer의 /media/fat/games 또는 /media/fat/_Arcade 폴더를 읽지 못했습니다.';
  if (errorCode === 'NETWORK_TIMEOUT' || errorCode === 'CONNECTION_REFUSED' || errorCode === 'SSH_NEGOTIATION_FAILED') {
    return 'MiSTer가 응답하지 않습니다(꺼져 있거나 네트워크에 없을 수 있음). 전원·네트워크를 확인하고 MiSTer 연결 메뉴에서 다시 연결하세요.';
  }
  return fallback || 'MiSTer의 /media/fat/games 또는 /media/fat/_Arcade 폴더를 읽지 못했습니다.';
}

function activeProfileFromFingerprint(activeProfile: ActiveMisterProfile, fingerprint: MisterRemoteFingerprint): ActiveMisterProfile {
  return {
    ...activeProfile,
    connectedAt: fingerprint.checkedAt,
    sessionId: fingerprint.sessionId,
    readOnlySummary: fingerprint.message,
    mediaFatOk: remotePathExists(fingerprint, '/media/fat'),
    gamesOk: remotePathExists(fingerprint, '/media/fat/games'),
    misterIniOk: remotePathExists(fingerprint, '/media/fat/MiSTer.ini'),
    lastErrorCode: fingerprint.error?.code,
  };
}

type ReadOnlySessionResolution =
  | {
      ok: true;
      sessionId: string;
      activeProfile?: ActiveMisterProfile;
      reconnected: boolean;
    }
  | {
      ok: false;
      message: string;
      errorCode?: RemoteErrorCode;
      sessionId?: undefined;
      activeProfile?: undefined;
      reconnected?: false;
    };

const desktopLibraryScanRoots = ['/media/fat/games', '/media/fat/_Arcade'] as const;

function normalizedCustomExtensions(values?: string[]) {
  return (values ?? [])
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean)
    .map((value) => (value.startsWith('.') ? value : `.${value}`));
}

function extensionFromRemotePath(path: string) {
  const fileName = path.split('/').pop() ?? path;
  const match = fileName.match(/(\.[^.\\/]+)$/);
  return match?.[1]?.toLowerCase() ?? '';
}

function fileNameFromRemotePath(path: string) {
  return path.split('/').filter(Boolean).pop() ?? path;
}

function parentFolderNameFromRemotePath(path: string) {
  const parts = path.split('/').filter(Boolean);
  return parts[Math.max(0, parts.length - 2)] ?? '';
}

function titleFromCustomPlatformPath(path: string) {
  const fileName = fileNameFromRemotePath(path);
  const parentFolderName = parentFolderNameFromRemotePath(path);
  const baseName = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^(game|default|index|rom)$/i.test(baseName) && parentFolderName) {
    return parentFolderName.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return baseName || parentFolderName || fileName;
}

function relativePathFromCustomSource(path: string, sourceRoots: string[]) {
  const normalizedPath = path.replace(/\\/g, '/');
  const root = sourceRoots.find((candidate) => {
    const normalizedRoot = candidate.replace(/\\/g, '/').replace(/\/+$/g, '');
    return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
  });
  if (!root) return normalizedPath.replace(/^\/media\/fat\/?/, '');
  return normalizedPath.slice(root.replace(/\\/g, '/').replace(/\/+$/g, '').length).replace(/^\/+/, '');
}

function customPlatformEntryFromRemoteFile(
  entry: { name: string; path: string; sizeBytes?: number; modifiedAt?: string },
  item: MiSTerPlatformCatalogItem,
  sourceRoots: string[],
  index: number,
): MiSTerScanEntry {
  const absolutePath = entry.path.replace(/\\/g, '/').replace(/\/+/g, '/');
  const title = titleFromCustomPlatformPath(absolutePath);
  const extension = extensionFromRemotePath(absolutePath);
  const launchText = (item.launchTemplate || '**launch:{misterPath}').replace('{misterPath}', absolutePath);
  return {
    id: `mister_custom_${normalizeName(absolutePath).replace(/\s+/g, '_')}_${index}`,
    source: 'mister',
    platformGroup: item.platformGroup,
    systemId: item.displayName,
    folderName: item.coreFolderName || item.displayName,
    folderPath: absolutePath.split('/').slice(0, -1).join('/'),
    relativePath: relativePathFromCustomSource(absolutePath, sourceRoots),
    absolutePath,
    title,
    romName: fileNameFromRemotePath(absolutePath),
    kind: extension === '.mra' ? 'mra' : 'rom',
    launchMode: 'absolute-path',
    launchValue: launchText,
    resolvedMiSTerPath: absolutePath,
    nfcPayload: launchText,
    nfcPayloadSource: 'resolvedMiSTerPath',
    imageMatchKey: normalizeName(`${title} ${fileNameFromRemotePath(absolutePath)}`),
    hasCard: false,
    imageMatched: false,
    launchReady: true,
    playable: true,
    bios: false,
    firmware: false,
    systemFile: false,
    ignored: false,
    classificationReason: extension === '.mra'
      ? 'custom platform MRA candidate; core and metadata checks are warnings only'
      : `custom platform candidate by extension ${extension || '(no extension)'}`,
    pathValid: true,
    scannedAt: new Date().toISOString(),
  };
}

function incrementRecord(record: Record<string, number>, key: string, amount = 1) {
  record[key] = (record[key] ?? 0) + amount;
}

function desktopScanRootForPath(targetPath: string) {
  return targetPath === '/media/fat/_Arcade' || targetPath.startsWith('/media/fat/_Arcade/')
    ? '/media/fat/_Arcade'
    : '/media/fat/games';
}

async function getDesktopActiveProfile() {
  return helloMisterDesktopApi()?.getActiveMisterProfile?.().catch(() => undefined);
}

async function reconnectActiveProfileFromSafeStorage(activeProfile?: ActiveMisterProfile): Promise<ReadOnlySessionResolution> {
  const api = helloMisterDesktopApi();
  if (!api?.fingerprintSavedMisterProfile || !activeProfile?.profileId) {
    return {
      ok: false,
      message: 'MiSTer 연결이 필요합니다. 먼저 MiSTer 연결 메뉴에서 연결하세요.',
    };
  }
  const fingerprint = await api.fingerprintSavedMisterProfile({ profileId: activeProfile.profileId });
  if (!fingerprint.ok || !fingerprint.sessionId) {
    return {
      ok: false,
      message: scanFailureMessage(fingerprint.error?.code, fingerprint.message),
      errorCode: fingerprint.error?.code,
    };
  }
  const nextActiveProfile = activeProfileFromFingerprint(activeProfile, fingerprint);
  await api.setActiveMisterProfile?.(nextActiveProfile).catch(() => undefined);
  return {
    ok: true,
    sessionId: fingerprint.sessionId,
    activeProfile: nextActiveProfile,
    reconnected: true,
  };
}

async function resolveReadOnlySession(connectionId?: string): Promise<ReadOnlySessionResolution> {
  if (connectionId) return { ok: true, sessionId: connectionId, reconnected: false };
  const activeProfile = await getDesktopActiveProfile();
  if (!activeProfile) {
    return {
      ok: false,
      message: 'MiSTer 연결이 필요합니다. 먼저 MiSTer 연결 메뉴에서 연결하세요.',
    };
  }
  if (activeProfile.sessionId) {
    return { ok: true, sessionId: activeProfile.sessionId, activeProfile, reconnected: false };
  }
  return reconnectActiveProfileFromSafeStorage(activeProfile);
}

function requiredPathsFromFingerprint(fingerprint?: { pathStatuses?: Array<{ path: string; exists: boolean }> }) {
  const statuses = new Map((fingerprint?.pathStatuses ?? []).map((status) => [status.path, status.exists]));
  return Object.fromEntries(
    requiredMiSTerPaths.map((targetPath) => {
      if (statuses.has(targetPath)) return [targetPath, statuses.get(targetPath) ? 'exists' : 'missing'];
      return [targetPath, 'unknown'];
    }),
  ) as MiSTerConnectionState['requiredPaths'];
}

async function ensureTrustedHostKey(config: MiSTerConnectionConfig) {
  const api = helloMisterDesktopApi();
  if (!api?.inspectSshHostKey) return { ok: true };
  const check = await api.inspectSshHostKey({ host: config.host, port: config.port || 22 });
  if (check.status === 'trusted' || check.status === 'trusted-now') return { ok: true };
  if (check.status === 'mismatch') {
    return {
      ok: false,
      message: '이 IP의 SSH 장치 신뢰 키가 이전 기록과 다릅니다. 연결을 차단했습니다. 고급 모드에서 신뢰 키를 확인하세요.',
    };
  }
  if (check.status === 'new' && check.fingerprint && check.keyType && api.trustSshHostKey) {
    const allow = window.confirm(
      `새 MiSTer 장치 신뢰 키를 등록합니다.\n\nIP: ${config.host}:${config.port || 22}\nKey: ${check.keyType}\nFingerprint: ${check.fingerprint}\n\n실제 MiSTer IP가 맞으면 확인을 누르세요.`,
    );
    if (!allow) return { ok: false, message: '사용자가 새 SSH 장치 신뢰 키 등록을 취소했습니다.' };
    const trusted = await api.trustSshHostKey({
      host: config.host,
      port: config.port || 22,
      fingerprint: check.fingerprint,
      keyType: check.keyType,
    });
    return trusted.ok
      ? { ok: true }
      : { ok: false, message: trusted.message || 'SSH 장치 신뢰 키를 등록하지 못했습니다.' };
  }
  return { ok: false, message: check.message || 'SSH 장치 신뢰 키를 확인하지 못했습니다.' };
}

function disabledTagJob(payload: TagWritePayload, message: string): TagWriteJob {
  const now = new Date().toISOString();
  return {
    id: `tag_job_disabled_${Date.now()}`,
    mode: 'mister-reader',
    payload,
    status: 'failed',
    logs: [message],
    createdAt: now,
    updatedAt: now,
  };
}

function zaparooTargetFromConnection(config: MiSTerConnectionConfig) {
  return {
    host: config.host,
    port: 7497,
    endpoint: '/api/v0.1',
  };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${bridgeBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => undefined) as { message?: string } | undefined;
  if (!response.ok) throw new Error(payload?.message ?? `MiSTer bridge request failed: ${response.status}`);
  return payload as T;
}

export class HttpMiSTerBridgeClient implements MiSTerBridgeClient {
  async testConnection(config: MiSTerConnectionConfig) {
    const api = helloMisterDesktopApi();
    if (api?.fingerprintMister) {
      if (!config.host.trim()) {
        return {
          ok: false,
          status: 'failed' as const,
          message: 'MiSTer IP가 필요합니다.',
          zaparooInstalled: false,
          requiredPaths: Object.fromEntries(requiredMiSTerPaths.map((path) => [path, 'unknown' as const])),
        };
      }
      const trust = await ensureTrustedHostKey(config);
      if (!trust.ok) {
        return {
          ok: false,
          status: 'failed' as const,
          message: trust.message,
          zaparooInstalled: false,
          requiredPaths: Object.fromEntries(requiredMiSTerPaths.map((path) => [path, 'unknown' as const])),
        };
      }
      const fingerprint = await api.fingerprintMister({
        profileId: `sticker-v1:${config.host}:${config.port || 22}`,
        host: config.host,
        port: config.port || 22,
        username: config.username || 'root',
        password: config.authMethod === 'password' ? config.password ?? '1' : config.password,
      });
      if (fingerprint.ok && fingerprint.sessionId && api.setActiveMisterProfile) {
        await api.setActiveMisterProfile({
          profileId: `sticker-v1:${config.host}:${config.port || 22}`,
          alias: config.host,
          ipAddress: config.host,
          port: config.port || 22,
          username: config.username || 'root',
          connectedAt: new Date().toISOString(),
          sessionId: fingerprint.sessionId,
          hostKeyStatus: fingerprint.hostKey?.status,
          readOnlySummary: fingerprint.message,
          mediaFatOk: fingerprint.pathStatuses.some((item) => item.path === '/media/fat' && item.exists),
          gamesOk: fingerprint.pathStatuses.some((item) => item.path === '/media/fat/games' && item.exists),
          misterIniOk: fingerprint.pathStatuses.some((item) => item.path === '/media/fat/MiSTer.ini' && item.exists),
          lastErrorCode: fingerprint.error?.code,
        });
      }
      return {
        ok: fingerprint.ok,
        status: fingerprint.ok ? 'connected' as const : 'failed' as const,
        message: fingerprint.message,
        zaparooInstalled: undefined,
        requiredPaths: requiredPathsFromFingerprint(fingerprint),
        connectionId: fingerprint.sessionId,
        zaparooCommandStatus: 'unknown' as const,
      };
    }
    return postJson<MiSTerBridgeConnectionResult>('/mister/test-connection', {
      config,
      requiredPaths: requiredMiSTerPaths,
    });
  }

  async disconnect(connectionId: string) {
    return postJson<{ ok: boolean; disconnected: boolean; message?: string }>('/mister/disconnect', { connectionId });
  }

  async scanLibrary(config: MiSTerConnectionConfig, connectionId?: string): Promise<MiSTerBridgeScanResult> {
    const api = helloMisterDesktopApi();
    if (api?.listRemoteGames) {
      let session = await resolveReadOnlySession(connectionId);
      if (!session.ok) {
        const sessionMessage = session.message;
        return {
          ok: false,
          entries: [],
          paths: [],
          rootStatuses: desktopLibraryScanRoots.map((root) => ({
            root,
            status: 'error' as const,
            fileCount: 0,
            rawFilesScanned: 0,
            message: sessionMessage,
          })),
          summary: {
            scannedRoots: 0,
            missingRoots: 0,
            errorRoots: desktopLibraryScanRoots.length,
            fileCount: 0,
            rawFilesScanned: 0,
            skippedFiles: 0,
            executableGames: 0,
            nonExecutableEntries: 0,
            mergedGames: 0,
          },
          message: sessionMessage,
        };
      }

      const remoteFiles: Array<{ name: string; path: string; sizeBytes?: number; modifiedAt?: string }> = [];
      const rootStats = new Map<typeof desktopLibraryScanRoots[number], { folderCount: number; readFailures: number; rawFilesScanned: number }>(
        desktopLibraryScanRoots.map((root) => [root, { folderCount: 0, readFailures: 0, rawFilesScanned: 0 }]),
      );
      let scanOk = false;
      let usedFastScan = false;
      let scanErrorCode: RemoteErrorCode | undefined;
      let scanMessage: string | undefined;

      // Fast path: one read-only SSH `find` over the roots returns every game file in ~2-3s, instead of one
      // SFTP round-trip per core folder (minutes on a full SD card). On any failure it falls through to the
      // SFTP walk below (which does its own reconnect-and-retry), so this stays simple and side-effect free.
      if (api.listRemoteGameFilesFast) {
        try {
          let fast = await api.listRemoteGameFilesFast(session.sessionId);
          // The session id can be stale (e.g. the active-profile sessionId persisted across an app restart, or an
          // evicted pooled connection). Reconnect once via the saved active profile and retry, so the fast path
          // self-heals instead of silently dropping to the slow SFTP walk (or failing outright).
          if (!fast.ok && !session.reconnected) {
            const activeProfile = session.activeProfile ?? await getDesktopActiveProfile();
            const retrySession = await reconnectActiveProfileFromSafeStorage(activeProfile);
            if (retrySession.ok) {
              session = retrySession;
              fast = await api.listRemoteGameFilesFast(session.sessionId);
            } else {
              scanErrorCode = retrySession.errorCode;
              scanMessage = retrySession.message;
            }
          }
          if (fast.ok && Array.isArray(fast.paths) && fast.paths.length > 0) {
            for (const path of fast.paths) {
              remoteFiles.push({ name: path.split('/').pop() ?? path, path });
              const stats = rootStats.get(desktopScanRootForPath(path));
              if (stats) stats.rawFilesScanned += 1;
            }
            scanOk = true;
            usedFastScan = true;
          } else if (!fast.ok) {
            scanErrorCode = fast.errorCode as RemoteErrorCode | undefined;
            scanMessage = fast.message;
          }
        } catch {
          // Ignore and fall back to the SFTP walk below.
        }
      }

      // Fallback: per-folder SFTP listing (older desktop adapters without the fast find endpoint).
      if (!usedFastScan) {
        // countFiles:false skips reading every core folder just to count files — the scan reads each folder's
        // files separately, so the count would be a wasted full read of folders that hold full ROM sets.
        let result = await api.listRemoteGames(session.sessionId, { countFiles: false });
        if (!result.ok && !session.reconnected) {
          const activeProfile = session.activeProfile ?? await getDesktopActiveProfile();
          const retrySession = await reconnectActiveProfileFromSafeStorage(activeProfile);
          if (retrySession.ok) {
            session = retrySession;
            result = await api.listRemoteGames(session.sessionId, { countFiles: false });
          }
        }
        scanOk = result.ok;
        scanErrorCode = result.errorCode;
        scanMessage = result.message;
        if (result.ok && api.listRemoteGameFolderFiles) {
          const listFolderFiles = api.listRemoteGameFolderFiles;
          // Folder file listings dominate scan time (one SFTP round-trip each). Run them in bounded-concurrency
          // batches over the pooled connection instead of strictly sequentially.
          const concurrency = 6;
          for (let offset = 0; offset < result.items.length; offset += concurrency) {
            const batch = result.items.slice(offset, offset + concurrency);
            const batchSessionId = session.sessionId ?? '';
            const batchResults = await Promise.all(batch.map((folder) => listFolderFiles(
              batchSessionId,
              folder.path,
              // Games are often organized in subfolders (e.g. /games/SNES/USA/...), so scan a few levels deep
              // instead of only the core-folder top level (which silently dropped whole subfolder libraries).
              folder.path.startsWith('/media/fat/_Arcade/') ? { scanDepth: 2, recursive: false, maxFiles: 4000 } : { scanDepth: 3, recursive: false, maxFiles: 4000 },
            ).then((folderResult) => ({ folder, folderResult }))));
            for (const { folder, folderResult } of batchResults) {
              const root = desktopScanRootForPath(folder.path);
              const stats = rootStats.get(root);
              if (stats) stats.folderCount += 1;
              if (!folderResult.ok) {
                if (stats) stats.readFailures += 1;
                continue;
              }
              if (stats) stats.rawFilesScanned += folderResult.items.length;
              remoteFiles.push(...folderResult.items);
            }
          }
        }
      }
      let entries = parseMiSTerPathList(remoteFiles.map((item) => item.path).join('\n'));
      // Split the flat _Arcade bucket into per-hardware platforms from each .mra's <rbf> core name, so a newly
      // installed arcade core (e.g. IGS PGM) shows as its own platform. Real _Arcade/<Hardware>/ folders already
      // get a per-hardware systemId from the path and are left untouched (isGenericArcadeSystemId guard).
      if (api.listRemoteArcadeCores && entries.some((entry) => entry.platformGroup === 'Arcade' && isGenericArcadeSystemId(entry.systemId))) {
        try {
          const arcade = await api.listRemoteArcadeCores(session.sessionId ?? '');
          if (arcade?.ok && arcade.cores) {
            const cores = arcade.cores;
            entries = entries.map((entry) => {
              if (entry.platformGroup !== 'Arcade' || !isGenericArcadeSystemId(entry.systemId)) return entry;
              const rbf = cores[entry.absolutePath];
              return rbf ? { ...entry, systemId: arcadeCorePlatformName(rbf) } : entry;
            });
          }
        } catch {
          // Keep the generic arcade classification if the rbf read fails.
        }
      }
      const executableGames = entries.filter((entry) => entry.playable !== false && !entry.bios && !entry.firmware && !entry.systemFile && !entry.ignored).length;
      const rootStatuses: MiSTerBridgeScanRootStatus[] = desktopLibraryScanRoots.map((root) => {
        const stats = rootStats.get(root) ?? { folderCount: 0, readFailures: 0, rawFilesScanned: 0 };
        const rootEntries = entries.filter((entry) => desktopScanRootForPath(entry.absolutePath) === root);
        return {
          root,
          status: scanOk ? 'scanned' : 'error',
          fileCount: rootEntries.length,
          rawFilesScanned: stats.rawFilesScanned,
          tinyFileSkippedCount: 0,
          extensionSkippedCount: 0,
          ignoredDirectorySkippedCount: 0,
          message: stats.readFailures > 0
            ? `${root} 폴더 일부(${stats.readFailures}개)를 읽지 못했습니다.`
            : `${root} 파일 ${stats.rawFilesScanned}개를 확인했습니다.`,
        };
      });
      const errorRoots = scanOk ? rootStatuses.filter((root) => root.status === 'error').length : desktopLibraryScanRoots.length;
      const summary: MiSTerBridgeScanSummary = {
        scannedRoots: scanOk ? rootStatuses.length : 0,
        missingRoots: 0,
        errorRoots,
        fileCount: entries.length,
        rawFilesScanned: remoteFiles.length,
        skippedFiles: 0,
        tinyFileSkippedCount: 0,
        extensionSkippedCount: 0,
        ignoredDirectorySkippedCount: 0,
        executableGames,
        nonExecutableEntries: Math.max(0, entries.length - executableGames),
        mergedGames: 0,
      };
      return {
        ok: scanOk,
        sessionId: session.sessionId,
        entries,
        paths: remoteFiles.map((item) => item.path),
        rootStatuses,
        summary,
        message: scanOk
          ? `${usedFastScan ? 'SSH find' : 'v2 read-only SSH adapter'}로 /media/fat/games 및 /media/fat/_Arcade의 파일 ${remoteFiles.length}개를 확인했습니다.`
          : scanFailureMessage(scanErrorCode, scanMessage),
      };
    }
    const result = await postJson<{
      ok: boolean;
      paths?: string[];
      entries?: MiSTerScanEntry[];
      rootStatuses?: MiSTerBridgeScanRootStatus[];
      summary?: MiSTerBridgeScanSummary;
      config?: MiSTerScanFilterConfigSummary;
      message?: string;
    }>('/mister/scan-library', {
      ...(connectionId ? { connectionId } : { config }),
    });
    const entries = result.entries ?? parseMiSTerPathList((result.paths ?? []).join('\n'));
    return {
      ok: result.ok,
      entries,
      paths: result.paths,
      rootStatuses: result.rootStatuses,
      summary: result.summary,
      config: result.config,
      message: result.message,
    };
  }

  async scanCustomPlatformSource(config: MiSTerConnectionConfig, item: MiSTerPlatformCatalogItem, connectionId?: string): Promise<MiSTerBridgeScanResult> {
    void config;
    const api = helloMisterDesktopApi();
    const sourceRoots = (item.sourceRoots ?? []).map((root) => root.trim().replace(/\/+$/g, '')).filter(Boolean);
    const knownExtensions = normalizedCustomExtensions(item.knownExtensions);
    if (sourceRoots.length === 0) {
      return {
        ok: false,
        entries: [],
        paths: [],
        rootStatuses: [],
        summary: {
          scannedRoots: 0,
          missingRoots: 0,
          errorRoots: 0,
          fileCount: 0,
          rawFilesScanned: 0,
          skippedFiles: 0,
          executableGames: 0,
          nonExecutableEntries: 0,
          mergedGames: 0,
        },
        message: `${item.displayName} sourceRoot가 설정되지 않았습니다.`,
      };
    }
    if (!api?.listRemoteGameFolderFiles) {
      return {
        ok: false,
        entries: [],
        paths: [],
        rootStatuses: sourceRoots.map((root) => ({
          root,
          status: 'error' as const,
          fileCount: 0,
          rawFilesScanned: 0,
          message: '커스텀 플랫폼 sourceRoot 직접 스캔은 Hello Mister v2 desktop read-only adapter가 필요합니다.',
        })),
        summary: {
          scannedRoots: 0,
          missingRoots: 0,
          errorRoots: sourceRoots.length,
          fileCount: 0,
          rawFilesScanned: 0,
          skippedFiles: 0,
          executableGames: 0,
          nonExecutableEntries: 0,
          mergedGames: 0,
        },
        message: '커스텀 플랫폼 sourceRoot 직접 스캔을 사용할 수 없습니다.',
      };
    }

    let session = await resolveReadOnlySession(connectionId);
    if (!session.ok) {
      const sessionMessage = session.message;
      return {
        ok: false,
        entries: [],
        paths: [],
        rootStatuses: sourceRoots.map((root) => ({
          root,
          status: 'error' as const,
          fileCount: 0,
          rawFilesScanned: 0,
          message: sessionMessage,
        })),
        summary: {
          scannedRoots: 0,
          missingRoots: 0,
          errorRoots: sourceRoots.length,
          fileCount: 0,
          rawFilesScanned: 0,
          skippedFiles: 0,
          executableGames: 0,
          nonExecutableEntries: 0,
          mergedGames: 0,
        },
        message: sessionMessage,
      };
    }

    const uniqueAcceptedFiles: Array<{ name: string; path: string; sizeBytes?: number; modifiedAt?: string }> = [];
    const acceptedPathKeys = new Set<string>();
    const rootStatuses: MiSTerBridgeScanRootStatus[] = [];
    let errorRoots = 0;
    const diagnostics: CustomPlatformScanDiagnostics = {
      sourceRoots,
      scanDepth: item.recursive ? 3 : Math.max(1, Math.min(3, Number(item.scanDepth ?? 2))),
      recursive: item.recursive ?? false,
      foldersScanned: 0,
      totalFiles: 0,
      mraFiles: 0,
      extensionAcceptedFiles: 0,
      extensionExcludedFiles: 0,
      folderExcludedFiles: 0,
      depthLimitedFolders: 0,
      duplicateFullPathFiles: 0,
      unsupportedFiles: 0,
      finalCandidateFiles: 0,
      failedFolders: 0,
      truncated: false,
      reasonCounts: {},
      excludedExtensionCounts: {},
      examples: [],
    };
    const scanDepth = item.recursive ? 3 : Math.max(1, Math.min(3, Number(item.scanDepth ?? 2)));
    const maxFiles = item.recursive ? 5000 : 2000;

    for (const sourceRoot of sourceRoots) {
      let result = await api.listRemoteGameFolderFiles(session.sessionId, sourceRoot, {
        scanDepth,
        recursive: item.recursive ?? false,
        maxFiles,
      });
      if (!result.ok && !session.reconnected) {
        const activeProfile = session.activeProfile ?? await getDesktopActiveProfile();
        const retrySession = await reconnectActiveProfileFromSafeStorage(activeProfile);
        if (retrySession.ok) {
          session = retrySession;
          result = await api.listRemoteGameFolderFiles(session.sessionId, sourceRoot, {
            scanDepth,
            recursive: item.recursive ?? false,
            maxFiles,
          });
        }
      }
      if (!result.ok) {
        errorRoots += 1;
        diagnostics.failedFolders += 1;
        incrementRecord(diagnostics.reasonCounts, 'readError');
        rootStatuses.push({
          root: sourceRoot,
          status: 'error',
          fileCount: 0,
          rawFilesScanned: 0,
          message: result.message || `${sourceRoot}를 읽지 못했습니다.`,
        });
        continue;
      }
      diagnostics.foldersScanned += result.foldersScanned ?? 1;
      diagnostics.totalFiles += result.items.length;
      diagnostics.folderExcludedFiles += result.excludedFiles ?? 0;
      diagnostics.depthLimitedFolders += result.depthLimitedFolders ?? 0;
      diagnostics.failedFolders += result.failedFolders ?? 0;
      diagnostics.truncated = diagnostics.truncated || Boolean(result.truncated);
      if (result.excludedFiles) incrementRecord(diagnostics.reasonCounts, 'folderExcluded', result.excludedFiles);
      if (result.depthLimitedFolders) incrementRecord(diagnostics.reasonCounts, 'depthLimit', result.depthLimitedFolders);
      if (result.failedFolders) incrementRecord(diagnostics.reasonCounts, 'readError', result.failedFolders);
      let rootAcceptedFiles = 0;
      let rootExtensionExcludedFiles = 0;
      result.items.forEach((entry) => {
        const extension = extensionFromRemotePath(entry.path);
        if (extension === '.mra') diagnostics.mraFiles += 1;
        if (knownExtensions.length > 0 && !knownExtensions.includes(extension)) {
          diagnostics.extensionExcludedFiles += 1;
          rootExtensionExcludedFiles += 1;
          incrementRecord(diagnostics.reasonCounts, 'extensionExcluded');
          incrementRecord(diagnostics.excludedExtensionCounts, extension || '(no extension)');
          return;
        }
        diagnostics.extensionAcceptedFiles += 1;
        const pathKey = entry.path.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
        if (acceptedPathKeys.has(pathKey)) {
          diagnostics.duplicateFullPathFiles += 1;
          incrementRecord(diagnostics.reasonCounts, 'duplicateFullPath');
          return;
        }
        acceptedPathKeys.add(pathKey);
        rootAcceptedFiles += 1;
        uniqueAcceptedFiles.push(entry);
      });
      rootStatuses.push({
        root: sourceRoot,
        status: 'scanned',
        fileCount: rootAcceptedFiles,
        rawFilesScanned: result.items.length,
        extensionSkippedCount: rootExtensionExcludedFiles,
        ignoredDirectorySkippedCount: result.excludedFiles ?? 0,
        message: `${sourceRoot}에서 전체 파일 ${result.items.length}개를 확인했습니다. 현재 확장자 필터 통과 ${uniqueAcceptedFiles.length}개, 깊이 제한 폴더 ${result.depthLimitedFolders ?? 0}개입니다.`,
      });
    }

    const entries = uniqueAcceptedFiles.map((entry, index) => customPlatformEntryFromRemoteFile(entry, item, sourceRoots, index));
    diagnostics.unsupportedFiles = 0;
    diagnostics.finalCandidateFiles = entries.length;
    diagnostics.examples = entries.slice(0, 5).map((entry) => entry.absolutePath);
    const skippedFiles = diagnostics.extensionExcludedFiles
      + diagnostics.folderExcludedFiles
      + diagnostics.duplicateFullPathFiles
      + diagnostics.unsupportedFiles;
    return {
      ok: errorRoots === 0 || entries.length > 0,
      sessionId: session.sessionId,
      entries,
      paths: uniqueAcceptedFiles.map((entry) => entry.path),
      rootStatuses,
      summary: {
        scannedRoots: sourceRoots.length - errorRoots,
        missingRoots: 0,
        errorRoots,
        fileCount: entries.length,
        rawFilesScanned: diagnostics.totalFiles,
        skippedFiles,
        executableGames: entries.length,
        nonExecutableEntries: 0,
        mergedGames: 0,
      },
      customPlatformDiagnostics: diagnostics,
      message: entries.length > 0
        ? `${item.displayName} sourceRoot 직접 스캔에서 전체 파일 ${diagnostics.totalFiles}개 중 최종 후보 ${entries.length}개를 찾았습니다.`
        : `${item.displayName} sourceRoot 직접 스캔 후보가 없습니다. 선택한 폴더 바로 아래에는 대상 파일이 없을 수 있습니다. 스캔 범위를 2단계 이상으로 변경해 보세요.`,
    };
  }

  async getScanFilterConfig() {
    try {
      return await postJson<MiSTerScanFilterConfigResult>('/mister/scan-filter-config', { action: 'load' });
    } catch {
      return loadBrowserScanFilterConfig();
    }
  }

  async resetScanFilterConfig() {
    try {
      return await postJson<MiSTerScanFilterConfigResult>('/mister/scan-filter-config', { action: 'reset' });
    } catch {
      return saveBrowserScanFilterConfig(defaultScanFilterConfig as MiSTerScanFilterConfig);
    }
  }

  async saveScanFilterConfig(config: MiSTerScanFilterConfig) {
    try {
      return await postJson<MiSTerScanFilterConfigResult>('/mister/scan-filter-config', { action: 'save', config });
    } catch {
      return saveBrowserScanFilterConfig(config);
    }
  }

  async openScanFilterConfigFolder() {
    return postJson<{ ok: boolean; message?: string }>('/mister/scan-filter-config', { action: 'open-folder' });
  }

  async writeTag(config: MiSTerConnectionConfig, payload: TagWritePayload, connectionId?: string) {
    if (helloMisterDesktopApi()) {
      const now = new Date().toISOString();
      if (!config.host) {
        const message = 'MiSTer 연결이 필요합니다.';
        return { ok: false, job: disabledTagJob(payload, message), message };
      }
      if (!payload.valid) {
        const message = payload.warnings.join(' ') || 'NFC payload가 유효하지 않습니다.';
        return { ok: false, job: disabledTagJob(payload, message), message };
      }
      const client = new ZaparooApiClient();
      const target = zaparooTargetFromConnection(config);
      const readers = await client.listReaders(target);
      if (!readers.ok) {
        const message = readers.message || 'Zaparoo NFC reader 상태를 확인하지 못했습니다.';
        return { ok: false, job: disabledTagJob(payload, message), message };
      }
      if (readers.readers.length === 0) {
        const message = 'NFC 리더가 연결되지 않았습니다. MiSTer USB NFC 리더 연결과 Zaparoo readers 상태를 확인하세요.';
        return { ok: false, job: disabledTagJob(payload, message), message };
      }
      const result = await client.writeReader(payload.launchText, target);
      return {
        ok: result.ok,
        job: {
          id: `tag_job_zaparoo_${Date.now()}`,
          mode: 'mister-reader' as const,
          payload,
          status: result.ok ? 'verified' as const : 'failed' as const,
          logs: [result.message],
          createdAt: now,
          updatedAt: new Date().toISOString(),
        },
        message: result.message,
      };
    }
    return postJson<MiSTerBridgeTagWriteResult>('/mister/tag/write', connectionId ? { connectionId, payload } : { config, payload });
  }

  async launchGame(config: MiSTerConnectionConfig, launchText: string, connectionId?: string) {
    if (helloMisterDesktopApi()) {
      if (!connectionId) return { ok: false, message: 'MiSTer 연결이 필요합니다. MiSTer 연결 메뉴에서 먼저 연결하세요.' };
      if (!launchText.trim()) return { ok: false, message: '실행 경로가 없습니다. 게임 리스트와 카드를 다시 연결하세요.' };
      const result = await new ZaparooApiClient().runZapScript(launchText, zaparooTargetFromConnection(config), { allowFallbackRun: true });
      return {
        ok: result.ok,
        message: result.diagnostics?.userMessage ?? result.message,
        stdout: result.endpoint,
        stderr: result.error?.message,
        diagnostics: result.diagnostics,
      };
    }
    return postJson<{ ok: boolean; message: string; stdout?: string; stderr?: string }>('/mister/game/launch', connectionId ? { connectionId, launchText } : { config, launchText });
  }

  async readTag(config: MiSTerConnectionConfig, connectionId?: string) {
    if (helloMisterDesktopApi()) {
      return { ok: false, message: 'Hello Mister v2.1 안전 정책상 MiSTer NFC 읽기는 아직 잠겨 있습니다.' };
    }
    return postJson<{ ok: boolean; readText?: string; message: string }>('/mister/tag/read', connectionId ? { connectionId } : { config });
  }

  async verifyTag(config: MiSTerConnectionConfig, payload: TagWritePayload, connectionId?: string) {
    if (helloMisterDesktopApi()) {
      return { ok: false, message: 'Hello Mister v2.1 안전 정책상 MiSTer NFC 검증은 아직 잠겨 있습니다.' };
    }
    return postJson<{ ok: boolean; readText?: string; message: string }>('/mister/tag/verify', connectionId ? { connectionId, payload } : { config, payload });
  }
}

export function setMiSTerBridgeUrl(url: string) {
  localStorage.setItem('zaparoo.mister.bridgeUrl.v1', url);
}

export function getMiSTerBridgeUrl() {
  return bridgeBaseUrl();
}
