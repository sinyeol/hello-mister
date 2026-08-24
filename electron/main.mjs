import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import net from 'node:net';
import dns from 'node:dns';
import os from 'node:os';
import path from 'node:path';
import ssh2 from 'ssh2';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify, TextDecoder } from 'node:util';
import { CONTROLLER_FS_CHANNELS } from './controller-ipc-channels.mjs';

// 같은 userData를 두 인스턴스가 동시에 열면 IndexedDB(LevelDB)가 잠겨 라이브러리가 빈 것처럼 보입니다.
// 두 번째 실행은 즉시 종료하고 기존 창을 포커스해 데이터 손상/유실 착시를 막습니다.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  const existing = BrowserWindow.getAllWindows()[0];
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
  }
});

// MiSTer network I/O is inherently flaky (power-off mid-connect, dropped sockets). A stray emitter 'error' or
// rejected promise must never present Electron's fatal "main process" dialog and kill the whole app — log and continue.
process.on('uncaughtException', (error) => {
  console.error('[Hello Mister] uncaughtException (앱 유지):', error);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Hello Mister] unhandledRejection (앱 유지):', reason);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appName = 'Hello Mister v2.1';
const execFileAsync = promisify(execFile);
const profileFileName = 'mister-device-profiles.json';
const profileSummaryFileName = 'mister-profile-summary.json';
const profileCredentialFileName = 'mister-profile-credentials.json';
const { Client, utils: sshUtils } = ssh2;
const sshSessions = new Map();
// Reused SSH clients keyed by sessionId so a multi-step scan does ONE handshake instead of one per folder.
const sshClientPool = new Map();
let activeMisterProfile;
const zaparooTokenReadControllers = new Map();
const registeredControllerIpcChannels = new Set();
const knownHostFileName = 'known-ssh-hosts.json';
const knownHostHistoryFileName = 'known-ssh-host-history.json';
const taskLogFileName = 'task-log.json';
const romPlanFileName = 'saved-rom-plans.json';
const stickerImageLibraryFileName = 'sticker-image-library.json';
const stickerTemplatesFileName = 'sticker-templates.json';
const stickerCardsFileName = 'sticker-cards.json';
const stickerSheetsFileName = 'sticker-sheets.json';
const secretKeyPattern = /password|privateKey|passphrase|token|secret|credential|rawCommand/i;
const appDataFileDefinitions = [
  { id: 'profiles', label: '장치 프로필', category: 'profiles', segments: ['profiles', profileFileName] },
  { id: 'known-hosts', label: '신뢰한 SSH 호스트', category: 'ssh', segments: ['profiles', knownHostFileName] },
  { id: 'known-host-history', label: 'SSH host key 변경 이력', category: 'ssh', segments: ['profiles', knownHostHistoryFileName] },
  { id: 'profile-summary', label: 'MiSTer 프로필 summary cache', category: 'profiles', segments: ['profiles', profileSummaryFileName] },
  { id: 'profile-credentials', label: '암호화된 MiSTer 비밀번호', category: 'profiles', segments: ['profiles', profileCredentialFileName] },
  { id: 'task-log', label: '작업 로그', category: 'logs', segments: ['logs', taskLogFileName] },
  { id: 'saved-rom-plans', label: '저장된 ROM dry-run 계획', category: 'rom', segments: ['rom', romPlanFileName] },
  { id: 'sticker-image-library', label: '스티커 이미지 라이브러리', category: 'stickers', segments: ['stickers', stickerImageLibraryFileName] },
  { id: 'sticker-templates', label: '스티커 템플릿', category: 'stickers', segments: ['stickers', stickerTemplatesFileName] },
  { id: 'sticker-cards', label: '스티커 카드', category: 'stickers', segments: ['stickers', stickerCardsFileName] },
  { id: 'sticker-sheets', label: '스티커 시트', category: 'stickers', segments: ['stickers', stickerSheetsFileName] },
  { id: 'dry-run-validation-records', label: 'ROM dry-run 검증 기록', category: 'review', segments: ['rom', 'dry-run-validation-records.json'], optionalBrowserFallback: true },
  { id: 'simulated-transfer-records', label: '전송 시뮬레이션 기록', category: 'review', segments: ['rom', 'simulated-transfer-records.json'], optionalBrowserFallback: true },
  { id: 'review-checklists', label: '검토 체크리스트', category: 'review', segments: ['review', 'desktop-review-checklists.json'], optionalBrowserFallback: true },
];

const remotePaths = {
  mediaFat: '/media/fat',
  games: '/media/fat/games',
  arcade: '/media/fat/_Arcade',
  scripts: '/media/fat/Scripts',
  misterIni: '/media/fat/MiSTer.ini',
  downloaderIni: '/media/fat/downloader.ini',
  config: '/media/fat/config',
  linux: '/media/fat/linux',
  zaparooConfig: '/media/fat/zaparoo/config.toml',
};

const romFsQuickPaths = ['/', remotePaths.mediaFat, remotePaths.games, remotePaths.arcade];
const romFsTrashFolderName = '.hello-mister-trash';
const romFsLocalFolderGrants = new Set();


function safeExportFilename(filename, fallback = 'hello-mister-export') {
  const base = String(filename || fallback)
    .split('')
    .map((char) => (char.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(char) ? '-' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/[ .]+$/g, '')
    .trim();
  return base || fallback;
}

function normalizeBytePayload(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (Array.isArray(bytes)) return Uint8Array.from(bytes);
  return new Uint8Array();
}

function saveDialogFilters(mimeType, filename) {
  if (mimeType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) return [{ name: 'PDF', extensions: ['pdf'] }];
  if (mimeType === 'image/png' || filename.toLowerCase().endsWith('.png')) return [{ name: 'PNG image', extensions: ['png'] }];
  if (mimeType === 'application/zip' || filename.toLowerCase().endsWith('.zip')) return [{ name: 'ZIP archive', extensions: ['zip'] }];
  if (mimeType === 'image/svg+xml' || filename.toLowerCase().endsWith('.svg')) return [{ name: 'SVG', extensions: ['svg'] }];
  return [{ name: 'All files', extensions: ['*'] }];
}

function mimeTypeForImagePath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.svg') return 'image/svg+xml';
  if (extension === '.bmp') return 'image/bmp';
  return undefined;
}

async function imageResponseToDataUrl(response, fallbackPath = '') {
  const headerMimeType = response.headers.get('content-type')?.split(';')[0]?.trim();
  const mimeType = headerMimeType?.startsWith('image/') ? headerMimeType : mimeTypeForImagePath(fallbackPath);
  if (!mimeType) return { ok: false, error: 'Remote resource is not an image.' };
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > 100 * 1024 * 1024) return { ok: false, error: 'Image file is too large to inline for export.' };
  const bytes = Buffer.from(arrayBuffer);
  return { ok: true, dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`, mimeType, size: bytes.length };
}
function rendererUrl() {
  return process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL;
}

async function createWindow() {
  // 패키징본은 exe 리소스 아이콘을 쓰고, dev 실행은 build/icon.ico가 있을 때만 지정(기본 Electron 아이콘 방지).
  const devIconPath = path.join(__dirname, '..', 'build', 'icon.ico');
  const window = new BrowserWindow({
    title: appName,
    ...(existsSync(devIconPath) ? { icon: devIconPath } : {}),
    width: 1360,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devUrl = rendererUrl();
  if (devUrl) {
    await window.loadURL(devUrl);
    return;
  }

  await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

function appDataPath(...segments) {
  return path.join(app.getPath('userData'), ...segments);
}

const cardImageFolderName = 'card-images';

// Base folder the dropped card images are archived into: an image folder inside the app's own folder.
// In dev that is the project root; in a packaged build it is the (writable) install dir next to the exe
// (app.getAppPath() points at the read-only asar there, so fall back to the exe directory).
function cardImageBaseDir() {
  const appRoot = app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath();
  return path.join(appRoot, cardImageFolderName);
}

function sanitizeCardImageBaseName(name) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.\s]+$/g, '')
    .slice(0, 120);
  return cleaned || 'card-image';
}

async function uniqueCardImagePath(dir, baseName, ext) {
  const safeExt = ext.startsWith('.') ? ext : `.${ext}`;
  let candidate = path.join(dir, `${baseName}${safeExt}`);
  for (let n = 2; n <= 9999; n += 1) {
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
    candidate = path.join(dir, `${baseName} (${n})${safeExt}`);
  }
  return candidate;
}

function relativeAppDataPath(segments) {
  return segments.join('/');
}

async function inspectAppDataFile(definition) {
  const filePath = appDataPath(...definition.segments);
  const now = new Date().toISOString();
  try {
    const stat = await fs.stat(filePath);
    let secretSanitizeStatus = 'ok';
    let message = '파일이 있으며 secret 계열 키가 감지되지 않았습니다.';
    try {
      const text = await fs.readFile(filePath, 'utf8');
      if (secretKeyPattern.test(text)) {
        secretSanitizeStatus = 'needs-review';
        message = 'secret 계열 키 이름이 감지되어 수동 확인이 필요합니다.';
      }
    } catch {
      secretSanitizeStatus = 'not-readable';
      message = '파일 상태는 확인했지만 내용을 읽어 sanitize 상태를 확인하지 못했습니다.';
    }
    return {
      id: definition.id,
      label: definition.label,
      category: definition.category,
      relativePath: relativeAppDataPath(definition.segments),
      exists: true,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime ? stat.mtime.toISOString() : now,
      secretSanitizeStatus,
      message,
    };
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      return {
        id: definition.id,
        label: definition.label,
        category: definition.category,
        relativePath: relativeAppDataPath(definition.segments),
        exists: false,
        secretSanitizeStatus: 'not-readable',
        message: '파일 상태를 확인하지 못했습니다.',
      };
    }
    return {
      id: definition.id,
      label: definition.label,
      category: definition.category,
      relativePath: relativeAppDataPath(definition.segments),
      exists: false,
      secretSanitizeStatus: definition.optionalBrowserFallback ? 'browser-fallback' : 'missing',
      message: definition.optionalBrowserFallback
        ? '현재 항목은 브라우저/localStorage fallback 저장소를 사용할 수 있어 appData 파일이 없을 수 있습니다.'
        : '아직 생성되지 않았습니다.',
    };
  }
}

async function getAppDataStorageStatus() {
  const files = await Promise.all(appDataFileDefinitions.map(inspectAppDataFile));
  return {
    appDataPath: app.getPath('userData'),
    checkedAt: new Date().toISOString(),
    files,
    message: 'appData 저장소를 읽기 전용으로 확인했습니다. 삭제나 초기화는 수행하지 않았습니다.',
  };
}

function getRuntimeEnvironment() {
  return {
    mode: 'electron',
    appName,
    appVersion: app.getVersion(),
    appDataPath: app.getPath('userData'),
    electronApiAvailable: true,
    readOnlyIpcAvailable: true,
    romTransferLocked: true,
    unsafeCommandIpcExposed: false,
    safetyMode: 'dry-run',
    checkedAt: new Date().toISOString(),
  };
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn('[Hello Mister] JSON read failed:', filePath, error);
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function sanitizeProfile(profile) {
  return {
    id: String(profile.id || `profile-${Date.now()}`),
    alias: profile.alias ? String(profile.alias) : undefined,
    // 호스트네임이 없거나 스톡 기본값('MiSTer')이면 기존 별칭을 승격(멱등·비파괴). 렌더러 sanitizeProfile와 동일.
    hostname: (() => {
      const host = profile.hostname ? String(profile.hostname).trim() : '';
      const alias = profile.alias ? String(profile.alias).trim() : '';
      return host && host !== 'MiSTer' ? host : (alias || host || undefined);
    })(),
    ipAddress: String(profile.ipAddress || ''),
    macAddress: profile.macAddress ? String(profile.macAddress) : undefined,
    sdCid: profile.sdCid ? String(profile.sdCid) : undefined,
    methods: Array.isArray(profile.methods) ? profile.methods.filter((method) => ['ssh', 'sftp', 'smb', 'http', 'ftp'].includes(method)) : [],
    status: profile.status || '저장됨',
    lastSeenAt: profile.lastSeenAt || new Date().toISOString(),
    fingerprint: profile.fingerprint,
    defaultDevice: Boolean(profile.defaultDevice || profile.isDefault),
    port: Number(profile.port || 22),
    username: profile.username ? String(profile.username).trim() || 'root' : 'root',
    passwordMode: ['defaultMisterPassword', 'promptEachRun', 'customSessionOnly', 'savedSafeStorage'].includes(profile.passwordMode) ? profile.passwordMode : 'defaultMisterPassword',
    passwordSaved: Boolean(profile.passwordSaved),
    passwordStorageStatus: profile.passwordStorageStatus ? String(profile.passwordStorageStatus) : undefined,
    autoConnect: false,
    isDefault: Boolean(profile.defaultDevice || profile.isDefault),
    lastConnectedAt: profile.lastConnectedAt ? String(profile.lastConnectedAt) : undefined,
    lastFailedAt: profile.lastFailedAt ? String(profile.lastFailedAt) : undefined,
    lastErrorCode: profile.lastErrorCode ? String(profile.lastErrorCode) : undefined,
    hostKeyStatus: profile.hostKeyStatus ? String(profile.hostKeyStatus) : undefined,
    readOnlySummary: profile.readOnlySummary ? String(profile.readOnlySummary) : undefined,
  };
}

function sanitizeActiveMisterProfile(profile = {}) {
  if (!profile.profileId || !profile.ipAddress) return undefined;
  return {
    profileId: String(profile.profileId),
    alias: profile.alias ? String(profile.alias) : undefined,
    hostname: profile.hostname ? String(profile.hostname) : undefined,
    ipAddress: String(profile.ipAddress),
    port: Number(profile.port || 22),
    username: profile.username ? String(profile.username).trim() || 'root' : 'root',
    connectedAt: profile.connectedAt ? String(profile.connectedAt) : new Date().toISOString(),
    sessionId: profile.sessionId ? String(profile.sessionId) : undefined,
    hostKeyStatus: profile.hostKeyStatus ? String(profile.hostKeyStatus) : undefined,
    readOnlySummary: profile.readOnlySummary ? String(profile.readOnlySummary) : undefined,
    mediaFatOk: Boolean(profile.mediaFatOk),
    gamesOk: Boolean(profile.gamesOk),
    misterIniOk: Boolean(profile.misterIniOk),
    lastErrorCode: profile.lastErrorCode ? String(profile.lastErrorCode) : undefined,
    macAddress: profile.macAddress ? String(profile.macAddress) : undefined,
    sdCid: profile.sdCid ? String(profile.sdCid) : undefined,
    identityWarning: profile.identityWarning ? String(profile.identityWarning) : undefined,
  };
}

function setActiveMisterProfile(profile) {
  activeMisterProfile = sanitizeActiveMisterProfile(profile);
  return activeMisterProfile;
}

function clearActiveMisterProfile(profileId) {
  if (profileId && activeMisterProfile?.profileId !== String(profileId)) {
    return { ok: true, cleared: false, profile: activeMisterProfile, message: '다른 MiSTer가 활성 상태라 유지했습니다.' };
  }
  const hadActiveProfile = Boolean(activeMisterProfile);
  activeMisterProfile = undefined;
  return { ok: true, cleared: hadActiveProfile, message: hadActiveProfile ? '활성 MiSTer 연결 표시를 지웠습니다.' : '활성 MiSTer 연결 표시가 없습니다.' };
}

const zaparooDefaultPort = 7497;
const zaparooDefaultEndpoint = '/api/v0.1';

function sanitizeZaparooTarget(target = {}) {
  const source = target?.host || activeMisterProfile?.ipAddress || '';
  const host = String(source)
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .split(':')[0]
    .trim();
  if (!host) return undefined;
  const endpoint = String(target?.endpoint || zaparooDefaultEndpoint).startsWith('/')
    ? String(target?.endpoint || zaparooDefaultEndpoint)
    : `/${target?.endpoint || zaparooDefaultEndpoint}`;
  return {
    host,
    port: Number(target?.port || zaparooDefaultPort),
    endpoint,
  };
}

function zaparooEndpointUrl(target, pathOverride) {
  const pathPart = pathOverride || target.endpoint || zaparooDefaultEndpoint;
  return `http://${target.host}:${target.port || zaparooDefaultPort}${pathPart}`;
}

function stripTomlComment(line) {
  let quote;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === '"' || char === "'") && line[index - 1] !== '\\') {
      quote = quote === char ? undefined : quote || char;
    }
    if (!quote && char === '#') return line.slice(0, index);
  }
  return line;
}

function tomlSectionBody(text, sectionName) {
  const body = [];
  let active = false;
  for (const line of String(text || '').split(/\r?\n/)) {
    const heading = stripTomlComment(line).trim().match(/^\[([^\]]+)\]$/);
    if (heading) {
      active = heading[1].trim() === sectionName;
      continue;
    }
    if (active) body.push(line);
  }
  return body.join('\n');
}

function parseTomlArray(section, key) {
  const match = String(section || '').match(new RegExp(`${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm'));
  if (!match) {
    const malformed = new RegExp(`(^|\\n)\\s*${key}\\s*=`, 'm').test(String(section || ''));
    return {
      present: malformed,
      values: [],
      count: 0,
      empty: true,
      parseError: malformed ? `${key} 배열을 해석하지 못했습니다.` : undefined,
    };
  }
  const values = match[1]
    .split(/\r?\n|,/)
    .map((item) => stripTomlComment(item).trim())
    .map((item) => item.replace(/^['"]|['"]$/g, '').trim())
    .filter(Boolean);
  return { present: true, values, count: values.length, empty: values.length === 0 };
}

function localIpv4Candidates() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === 'IPv4' && !item.internal)
    .map((item) => item.address)
    .filter(Boolean);
}

function ipv4ToNumber(ip) {
  const parts = String(ip).split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
  return parts.reduce((acc, part) => ((acc << 8) + part) >>> 0, 0);
}

function ipMatchesCidr(ip, cidr) {
  const [base, prefixText] = String(cidr).split('/');
  const prefix = Number(prefixText);
  const ipNumber = ipv4ToNumber(ip);
  const baseNumber = ipv4ToNumber(base);
  if (ipNumber === undefined || baseNumber === undefined || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipNumber & mask) === (baseNumber & mask);
}

function allowedIpMatchState(values, candidates) {
  if (!values.length) return 'unrestricted';
  if (!candidates.length) return 'unknown';
  const normalizedValues = values.map((value) => String(value).trim());
  const hasMatch = candidates.some((candidate) => normalizedValues.some((value) => (
    value === candidate
    || value === '*'
    || value === '0.0.0.0/0'
    || value === '0.0.0.0'
    || (value.includes('/') && ipMatchesCidr(candidate, value))
  )));
  return hasMatch ? 'matched' : 'not-matched';
}

function zaparooConfigGuidance({ serviceFound, allowRun, allowedIps, allowedIpMatch }) {
  const guidance = [];
  if (!serviceFound) {
    guidance.push('[service] 섹션을 찾지 못했습니다. Zaparoo Web UI 또는 config.toml에서 service 설정을 확인하세요.');
  }
  if (!allowRun.present || allowRun.empty) {
    guidance.push('config.toml의 [service] allow_run이 비어 있거나 없습니다. 원격 실행이 차단될 수 있습니다.');
  } else {
    guidance.push(`allow_run 패턴 ${allowRun.count}개를 확인했습니다. 실행하려는 ZapScript 전체와 매칭되어야 합니다.`);
  }
  if (allowedIps.present && !allowedIps.empty) {
    guidance.push(`allowed_ips 제한 ${allowedIps.count}개가 있습니다. 현재 PC IP가 허용 범위인지 확인하세요.`);
    if (allowedIpMatch === 'not-matched') guidance.push('현재 PC IPv4 후보가 allowed_ips 항목과 직접 매칭되지 않았습니다.');
  }
  guidance.push('앱은 config.toml을 자동 수정하지 않습니다. 설정 변경 후 Zaparoo Core를 재시작하거나 reload해야 할 수 있습니다.');
  return guidance;
}

function parseZaparooConfigToml(text) {
  const service = tomlSectionBody(text, 'service');
  const serviceFound = service.trim().length > 0;
  const allowRun = parseTomlArray(service, 'allow_run');
  const allowedIps = parseTomlArray(service, 'allowed_ips');
  const parseFailed = Boolean(allowRun.parseError || allowedIps.parseError);
  const localIpCandidates = localIpv4Candidates();
  const allowedIpMatch = allowedIps.present ? allowedIpMatchState(allowedIps.values, localIpCandidates) : 'not-checked';
  const guidance = zaparooConfigGuidance({ serviceFound, allowRun, allowedIps, allowedIpMatch });
  return {
    ok: !parseFailed,
    status: parseFailed ? 'parse-failed' : 'found',
    path: remotePaths.zaparooConfig,
    serviceFound,
    allowRun,
    allowedIps,
    allowedIpsLimited: allowedIps.present && !allowedIps.empty,
    localIpCandidates,
    allowedIpMatch,
    guidance,
    checkedAt: new Date().toISOString(),
    rawPreview: String(text || '').slice(0, 4000),
    message: parseFailed
      ? 'Zaparoo config.toml을 읽었지만 일부 설정을 해석하지 못했습니다.'
      : serviceFound
        ? `Zaparoo config.toml을 읽었습니다. allow_run ${allowRun.count}개, allowed_ips ${allowedIps.count}개 항목을 확인했습니다.`
        : 'Zaparoo config.toml은 읽었지만 [service] 섹션을 찾지 못했습니다.',
  };
}


const zaparooConfigBackupDirectory = '/media/fat/zaparoo/backups';
const zaparooRecommendedAllowRun = ['**launch:/media/fat/(games|_Arcade)/.*'];

function zaparooConfigBackupFileName(date = new Date()) {
  const stamp = date.toISOString().replace(/[-:]/g, '').replace(/T/, '-').slice(0, 15);
  return 'config.toml.' + stamp + '.bak';
}

function firstUsableLocalIp(targetHost) {
  // Exclude loopback and link-local/APIPA (169.254.x) — those would put a bogus allowed_ips into Zaparoo and
  // block the PC from reaching the API (the real cause of "Zaparoo 확인 필요" after applying the config).
  const candidates = localIpv4Candidates().filter((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !ip.startsWith('127.') && !ip.startsWith('169.254.'));
  if (targetHost && /^\d+\.\d+\.\d+\.\d+$/.test(String(targetHost))) {
    const targetPrefix = String(targetHost).split('.').slice(0, 3).join('.') + '.';
    const sameSubnet = candidates.find((ip) => ip.startsWith(targetPrefix));
    if (sameSubnet) return sameSubnet;
  }
  return candidates[0] || localIpv4Candidates().find((ip) => !ip.startsWith('127.')) || '';
}

function hostForSession(sessionId) {
  return sshSessions.get(sessionId)?.host;
}

function subnet24ForIp(ip) {
  const parts = String(ip || '').split('.');
  return parts.length === 4 ? parts[0] + '.' + parts[1] + '.' + parts[2] + '.0/24' : '';
}

function createZaparooConfigRecommendation(mode = 'single-ip', targetHost) {
  const localIp = firstUsableLocalIp(targetHost);
  const subnet = subnet24ForIp(localIp);
  return {
    mode,
    apiPort: 7497,
    apiListen: '0.0.0.0',
    allowedIps: mode === 'open' ? [] : mode === 'subnet-24' ? (subnet ? [subnet] : []) : (localIp ? [localIp] : []),
    allowRun: [...zaparooRecommendedAllowRun],
    localIp: localIp || undefined,
    subnet: subnet || undefined,
    notes: [
      mode === 'subnet-24' ? '?? PC? ?? /24 subnet? ???? ?? ?????.' : '?? PC IP 1?? ???? ??? ?????.',
      '/media/fat/games? /media/fat/_Arcade ?? ??? ?? ?????.',
      '?? ?? ?? ???? ?? ??? ?????.',
    ],
  };
}

function quoteTomlString(value) {
  return "'" + String(value).replace(/'/g, "\\'") + "'";
}

function doubleQuoteTomlString(value) {
  return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function formatTomlStringArray(values) {
  if (!values.length) return '[]';
  return '[\n  ' + values.map(quoteTomlString).join(',\n  ') + '\n]';
}

function valueForZaparooConfigKey(key, recommendation) {
  if (key === 'api_port') return String(recommendation.apiPort);
  if (key === 'api_listen') return doubleQuoteTomlString(recommendation.apiListen);
  if (key === 'allowed_ips') return formatTomlStringArray(recommendation.allowedIps);
  if (key === 'allow_run') return formatTomlStringArray(recommendation.allowRun);
  return '[service]';
}

function zaparooConfigKeyLine(key, recommendation) {
  return key + ' = ' + valueForZaparooConfigKey(key, recommendation);
}

function findTomlServiceRange(lines) {
  let start = -1;
  let end = lines.length;
  for (let index = 0; index < lines.length; index += 1) {
    const heading = stripTomlComment(lines[index]).trim().match(/^\[([^\]]+)\]$/);
    if (!heading) continue;
    if (heading[1].trim() === 'service') {
      start = index;
      continue;
    }
    if (start >= 0) {
      end = index;
      break;
    }
  }
  return { start, end };
}

function currentTomlConfigValue(lines, start, end, key) {
  const collected = [];
  let collecting = false;
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index];
    if (!collecting && new RegExp('^\\s*' + key + '\\s*=').test(stripTomlComment(line))) {
      collected.push(line.trim());
      collecting = line.includes('[') && !line.includes(']');
      continue;
    }
    if (collecting) {
      collected.push(line.trim());
      if (line.includes(']')) break;
    }
  }
  return collected.join('\n');
}

function upsertTomlConfigKey(lines, range, key, recommendation, changes) {
  const next = zaparooConfigKeyLine(key, recommendation);
  const before = currentTomlConfigValue(lines, range.start, range.end, key);
  if (before) {
    if (before === next) {
      changes.push({ key, action: 'unchanged', before, after: next });
      return range;
    }
    const keyPattern = new RegExp('^\\s*' + key + '\\s*=');
    for (let index = range.start + 1; index < range.end; index += 1) {
      if (!keyPattern.test(stripTomlComment(lines[index]))) continue;
      let deleteEnd = index + 1;
      if (lines[index].includes('[') && !lines[index].includes(']')) {
        while (deleteEnd < range.end && !lines[deleteEnd - 1].includes(']')) deleteEnd += 1;
      }
      const replacement = next.split('\n');
      lines.splice(index, deleteEnd - index, ...replacement);
      const delta = replacement.length - (deleteEnd - index);
      changes.push({ key, action: 'update', before, after: next });
      return { start: range.start, end: range.end + delta };
    }
  }
  const insertion = next.split('\n');
  lines.splice(range.end, 0, ...insertion);
  changes.push({ key, action: 'add', after: next });
  return { start: range.start, end: range.end + insertion.length };
}

function zaparooConfigDiffPreview(changes) {
  return changes
    .filter((change) => change.action !== 'unchanged')
    .map((change) => {
      if (change.key === '[service]') return '+ [service]';
      return ['# ' + change.key + ': ' + change.action, change.before ? '- ' + change.before : undefined, '+ ' + change.after].filter(Boolean).join('\n');
    })
    .join('\n\n') || '???? ????.';
}

function buildZaparooConfigPatchPlan(currentConfigText, mode = 'single-ip', date = new Date(), targetHost) {
  const recommendation = createZaparooConfigRecommendation(mode === 'subnet-24' ? 'subnet-24' : mode === 'open' ? 'open' : 'single-ip', targetHost);
  const lines = String(currentConfigText || '').split(/\r?\n/);
  const changes = [];
  let range = findTomlServiceRange(lines);
  if (range.start < 0) {
    if (lines.length && lines.at(-1)?.trim()) lines.push('');
    range = { start: lines.length, end: lines.length + 1 };
    lines.push('[service]');
    changes.push({ key: '[service]', action: 'add', after: '[service]' });
  }
  for (const key of ['api_port', 'api_listen', 'allowed_ips', 'allow_run']) range = upsertTomlConfigKey(lines, range, key, recommendation, changes);
  const backupFileName = zaparooConfigBackupFileName(date);
  const nextPreview = lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  const changed = changes.some((change) => change.action !== 'unchanged');
  return {
    ok: true,
    path: remotePaths.zaparooConfig,
    recommendation,
    changes,
    diffPreview: zaparooConfigDiffPreview(changes),
    nextPreview,
    changed,
    backupFileName,
    remoteBackupPath: zaparooConfigBackupDirectory + '/' + backupFileName,
    localBackupRelativePath: 'backups/zaparoo/' + backupFileName,
    safetyMessages: [
      '이 변경은 Zaparoo config.toml의 [service] 설정과 API run 실행 관련 항목만 수정합니다.',
      '적용 전 백업을 먼저 만듭니다.',
      '적용 후에는 Zaparoo Core reload 또는 재시작이 필요할 수 있습니다.',
      '문제가 생기면 백업한 Zaparoo config.toml로 언제든지 복원할 수 있습니다.',
    ],
    message: changed ? '적용할 설정 변경안을 준비했습니다.' : '변경할 설정 항목이 없습니다.',
  };
}

function isAllowedZaparooConfigWritePath(remotePath) {
  return remotePath === remotePaths.zaparooConfig || /^\/media\/fat\/zaparoo\/backups\/config\.toml\.\d{8}-\d{6}\.bak$/.test(String(remotePath));
}

function validateZaparooConfigApplyBackups(options) {
  if (!options.confirmed) return { ok: false, message: '확인 없이 설정을 적용할 수 없습니다.' };
  if (!options.localBackupOk && !options.remoteBackupOk) return { ok: false, message: '적용 전 Zaparoo config.toml을 백업하지 못했습니다.' };
  if (!options.remoteBackupOk && !options.allowLocalBackupOnly) {
    return { ok: false, requiresLocalBackupOnlyConfirmation: true, message: '원격 백업에 실패했습니다. 로컬 백업만으로 진행하려면 추가 확인이 필요합니다.' };
  }
  return { ok: true, message: '백업 검증을 통과했습니다.' };
}

function zaparooSettingsReloadFailureMessage() {
  return '설정은 적용했지만 Zaparoo Core reload에 실패했습니다. Zaparoo Core를 재시작하거나 MiSTer를 재부팅한 뒤 다시 확인하세요.';
}

function zaparooRunFailureMessage(code) {
  const messages = {
    API_OFFLINE: 'Zaparoo API에 연결할 수 없습니다. MiSTer에서 Zaparoo Core가 실행 중인지 확인하세요.',
    API_ENDPOINT_FAILED: 'Zaparoo API endpoint /api/v0.1이 응답하지 않습니다.',
    RUN_METHOD_FAILED: 'Zaparoo Core API는 응답했지만 run 실행 요청이 실패했습니다.',
    RUN_ENDPOINT_FAILED: '/run/ fallback 호출이 실패했습니다. Zaparoo v2.11 이후 원격 /run/ 실행에는 allow_run 규칙이 필요할 수 있습니다.',
    ALLOW_RUN_MISSING: 'config.toml의 [service] allow_run이 비어 있거나 없습니다. 원격 실행이 차단될 수 있습니다.',
    ALLOW_RUN_BLOCKED: '현재 실행 경로가 allow_run 규칙과 맞지 않을 수 있습니다.',
    ALLOWED_IPS_BLOCKED: 'allowed_ips 설정 때문에 이 PC의 API 요청이 차단될 수 있습니다.',
    LAUNCH_PATH_MISSING: '실행할 ZapScript 또는 게임 경로가 없습니다.',
    MEDIA_NOT_MATCHED: 'Zaparoo media database에서 실행할 게임을 확정하지 못했습니다.',
    UNKNOWN_ZAPAROO_ERROR: 'Zaparoo 실행 실패 원인을 분류하지 못했습니다.',
  };
  return messages[code] || messages.UNKNOWN_ZAPAROO_ERROR;
}

function zaparooErrorText(...values) {
  const safeData = (data) => {
    if (!data) return '';
    try {
      return JSON.stringify(data);
    } catch {
      return String(data);
    }
  };
  return values
    .flatMap((value) => {
      if (!value) return [];
      if (value instanceof Error) return [value.message, value.code, safeData(value.data)];
      if (typeof value === 'object') {
        return [
          value.message,
          value.method,
          value.endpoint,
          value.error?.message,
          value.error?.code,
          safeData(value.error?.data),
        ];
      }
      return [String(value)];
    })
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function isNetworkFailure(text) {
  return /failed to fetch|econnrefused|etimedout|timeout|abort|network|enotfound|ehostunreach|econnreset/.test(text);
}

function isForbiddenFailure(text) {
  return /allow_run|not allowed|blocked|forbidden|denied|http 403|\b403\b/.test(text);
}

function isApiEndpointFailure(text) {
  return /\/api\/v0\.1|api http 404|api http 405|api http 501|endpoint/.test(text);
}

function classifyZaparooRunFailure(context = {}) {
  const methodText = zaparooErrorText(context.error, context.methodResult);
  const fallbackText = zaparooErrorText(context.fallbackResult);
  const combined = `${methodText} ${fallbackText}`;
  const configDiagnostics = context.configDiagnostics;

  if (isNetworkFailure(methodText) && (!context.fallbackResult || isNetworkFailure(fallbackText))) return 'API_OFFLINE';
  if (isApiEndpointFailure(methodText) && !isForbiddenFailure(methodText)) return 'API_ENDPOINT_FAILED';

  if (isForbiddenFailure(combined)) {
    if (configDiagnostics?.status === 'found' && configDiagnostics.allowedIps.present && !configDiagnostics.allowedIps.empty) {
      return 'ALLOWED_IPS_BLOCKED';
    }
    if (configDiagnostics?.status === 'found' && (!configDiagnostics.allowRun.present || configDiagnostics.allowRun.empty)) {
      return 'ALLOW_RUN_MISSING';
    }
    return 'ALLOW_RUN_BLOCKED';
  }

  if (context.fallbackResult && (/\/run\/|http 404|\b404\b/.test(fallbackText))) return 'RUN_ENDPOINT_FAILED';
  if (configDiagnostics?.status === 'found' && (!configDiagnostics.allowRun.present || configDiagnostics.allowRun.empty)) return 'ALLOW_RUN_MISSING';
  if (context.methodResult && !context.fallbackResult) return 'RUN_METHOD_FAILED';
  if (context.methodResult) return 'RUN_METHOD_FAILED';
  return 'UNKNOWN_ZAPAROO_ERROR';
}

function zaparooFailure(message, target, method, error) {
  const errorMessage = error instanceof Error ? error.message : String(error || message);
  const lower = errorMessage.toLowerCase();
  const hint = lower.includes('403') || lower.includes('allow_run') || lower.includes('not allowed') || lower.includes('forbidden')
    ? ' Zaparoo 실행이 차단되었을 수 있습니다. Zaparoo 설정의 [service] allow_run 규칙을 확인하세요.'
    : '';
  return {
    ok: false,
    target,
    endpoint: target ? zaparooEndpointUrl(target) : undefined,
    method,
    message: `${message}${hint}`,
    error: {
      code: error?.code,
      message: `${errorMessage}${hint}`,
      data: error?.data,
    },
    checkedAt: new Date().toISOString(),
  };
}

async function zaparooJsonRpc(targetInput, method, params, timeoutMs = 5000) {
  const target = sanitizeZaparooTarget(targetInput);
  if (!target) throw new Error('MiSTer IP가 없어 Zaparoo API를 호출할 수 없습니다.');
  const controller = new globalThis.AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  const payload = params === undefined
    ? { jsonrpc: '2.0', id: crypto.randomUUID(), method }
    : { jsonrpc: '2.0', id: crypto.randomUUID(), method, params };
  try {
    const response = await globalThis.fetch(zaparooEndpointUrl(target), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    if (!response.ok) {
      const error = new Error(`Zaparoo API HTTP ${response.status}`);
      error.data = body;
      throw error;
    }
    if (body?.error) {
      const error = new Error(body.error.message || 'Zaparoo JSON-RPC error');
      error.code = body.error.code;
      error.data = body.error.data;
      throw error;
    }
    return {
      ok: true,
      target,
      endpoint: zaparooEndpointUrl(target),
      method,
      result: body?.result,
      message: `Zaparoo ${method} 호출이 완료되었습니다.`,
      checkedAt: new Date().toISOString(),
    };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function zaparooMediaItems(result) {
  const rawItems = Array.isArray(result)
    ? result
    : Array.isArray(result?.items)
      ? result.items
      : Array.isArray(result?.results)
        ? result.results
        : result
          ? [result]
          : [];
  return rawItems.map((item, index) => {
    const record = item && typeof item === 'object' ? item : {};
    const name = String(record.name || record.title || record.label || '');
    return {
      id: String(record.id || record.uuid || `${name || 'media'}-${index}`),
      name,
      title: String(record.title || record.name || ''),
      system: record.system ? String(record.system) : undefined,
      systemId: record.systemId ? String(record.systemId) : record.system ? String(record.system) : undefined,
      path: record.path ? String(record.path) : record.file ? String(record.file) : undefined,
      zapScript: record.zapScript ? String(record.zapScript) : record.zapscript ? String(record.zapscript) : undefined,
      tags: Array.isArray(record.tags) ? record.tags.map(String) : undefined,
      raw: item,
    };
  });
}

async function zaparooVersion(target) {
  try {
    return await zaparooJsonRpc(target, 'version');
  } catch (error) {
    return zaparooFailure('Zaparoo version을 확인하지 못했습니다.', sanitizeZaparooTarget(target), 'version', error);
  }
}

async function zaparooHealth(target) {
  try {
    return await zaparooJsonRpc(target, 'health');
  } catch (error) {
    return zaparooFailure('Zaparoo health를 확인하지 못했습니다.', sanitizeZaparooTarget(target), 'health', error);
  }
}

async function zaparooReaders(target) {
  try {
    const result = await zaparooJsonRpc(target, 'readers');
    return {
      ...result,
      readers: zaparooMediaItems(result.result),
      message: 'Zaparoo NFC reader 목록을 확인했습니다.',
    };
  } catch (error) {
    return {
      ...zaparooFailure('Zaparoo NFC reader 목록을 확인하지 못했습니다.', sanitizeZaparooTarget(target), 'readers', error),
      readers: [],
    };
  }
}

async function zaparooStatus(target) {
  const safeTarget = sanitizeZaparooTarget(target);
  if (!safeTarget) {
    return {
      ok: false,
      message: 'MiSTer IP가 없어 Zaparoo API 상태를 확인할 수 없습니다.',
      readers: [],
      checkedAt: new Date().toISOString(),
    };
  }
  const [version, health, readers] = await Promise.all([
    zaparooVersion(safeTarget),
    zaparooHealth(safeTarget),
    zaparooReaders(safeTarget),
  ]);
  const ok = Boolean(version.ok || health.ok);
  return {
    ok,
    target: safeTarget,
    endpoint: zaparooEndpointUrl(safeTarget),
    version: version.result,
    health: health.result,
    readers: readers.readers || [],
    message: ok ? 'Zaparoo Core API에 연결되었습니다.' : 'Zaparoo Core API가 응답하지 않습니다. MiSTer의 Zaparoo 설치와 포트 7497을 확인하세요.',
    error: ok ? undefined : (health.error || version.error),
    checkedAt: new Date().toISOString(),
  };
}

async function zaparooSearchMedia(request = {}) {
  try {
    const result = await zaparooJsonRpc(request.target, 'media.search', { query: String(request.query || '') });
    return { ...result, items: zaparooMediaItems(result.result), message: 'Zaparoo media.search 결과를 받았습니다.' };
  } catch (error) {
    return { ...zaparooFailure('Zaparoo media.search에 실패했습니다.', sanitizeZaparooTarget(request.target), 'media.search', error), items: [] };
  }
}

async function zaparooBrowseMedia(request = {}) {
  try {
    const params = request.path ? { path: String(request.path) } : {};
    const result = await zaparooJsonRpc(request.target, 'media.browse', params);
    return { ...result, items: zaparooMediaItems(result.result), message: 'Zaparoo media.browse 결과를 받았습니다.' };
  } catch (error) {
    return { ...zaparooFailure('Zaparoo media.browse에 실패했습니다.', sanitizeZaparooTarget(request.target), 'media.browse', error), items: [] };
  }
}

async function zaparooLookupMedia(request = {}) {
  try {
    const result = await zaparooJsonRpc(request.target, 'media.lookup', { system: String(request.system || ''), name: String(request.name || '') });
    const items = zaparooMediaItems(result.result);
    return { ...result, item: items[0], items, message: 'Zaparoo media.lookup 결과를 받았습니다.' };
  } catch (error) {
    return { ...zaparooFailure('Zaparoo media.lookup에 실패했습니다.', sanitizeZaparooTarget(request.target), 'media.lookup', error), items: [] };
  }
}

// Zaparoo ZapScript uses "^" as its escape character and treats "," (argument separator) and
// "|" (part of the "||" command separator) as control characters. Raw MiSTer game paths very often
// contain commas — e.g. "Daiku no Gensan (Japan, M84 hardware).mra" — so an unescaped "**launch:"
// payload is split at the comma by the ZapScript engine, the path is truncated, and the launch
// silently fails (success:false in tokens.history) even though the card was written/read correctly.
// Verified live (2026-06-25, Zaparoo 2.14.1): "(Japan^, M84 hardware)" launches, "(Japan, ...)" and
// "(Japan\, ...)" do not. Escape "^" first so the carets we add are not re-escaped. We only touch
// "**launch:" payloads and bare absolute paths; "@System/Name" style zapScripts are left untouched.
function escapeZapScriptLaunchPath(value) {
  const escapePath = (p) => p.replace(/\^/g, '^^').replace(/,/g, '^,').replace(/\|/g, '^|');
  const launchPrefix = '**launch:';
  if (value.startsWith(launchPrefix)) return launchPrefix + escapePath(value.slice(launchPrefix.length));
  if (value.startsWith('/')) return escapePath(value);
  return value;
}

async function zaparooRun(request = {}) {
  const zapScript = String(request.zapScript || '').trim();
  const launchText = escapeZapScriptLaunchPath(zapScript);
  const target = sanitizeZaparooTarget(request.target);
  if (!zapScript) {
    const diagnostics = {
      code: 'LAUNCH_PATH_MISSING',
      userMessage: zaparooRunFailureMessage('LAUNCH_PATH_MISSING'),
    };
    return {
      ok: false,
      target,
      method: 'run',
      zapScript,
      message: diagnostics.userMessage,
      diagnostics,
      error: { message: '실행할 ZapScript가 없습니다.' },
      checkedAt: new Date().toISOString(),
    };
  }
  let configDiagnostics;
  const withDiagnostics = (result, error) => {
    const code = classifyZaparooRunFailure({ error, methodResult: result, configDiagnostics });
    const diagnostics = {
      code,
      userMessage: `${zaparooRunFailureMessage(code)} 앱은 /media/fat/zaparoo/config.toml을 자동 수정하지 않습니다.`,
      config: configDiagnostics,
      methodResult: result?.method === 'run' ? result : undefined,
      fallbackResult: result?.method === '/run/' ? result : undefined,
    };
    return {
      ...result,
      message: diagnostics.userMessage,
      diagnostics,
    };
  };
  try {
    const result = await zaparooJsonRpc(target, 'run', { text: launchText });
    return { ...result, zapScript, fallbackUsed: false, message: 'Zaparoo Core API로 게임 실행 요청을 보냈습니다.' };
  } catch (rpcError) {
    configDiagnostics = await readZaparooConfigDiagnostics().catch(() => undefined);
    if (!request.allowFallbackRun || !target) {
      return withDiagnostics({ ...zaparooFailure('Zaparoo run 호출에 실패했습니다.', target, 'run', rpcError), zapScript }, rpcError);
    }
    const methodResult = zaparooFailure('Zaparoo run 호출에 실패했습니다.', target, 'run', rpcError);
    try {
      const runPath = `/run/${encodeURIComponent(launchText)}`;
      const response = await globalThis.fetch(zaparooEndpointUrl(target, runPath), { method: 'GET' });
      const text = await response.text().catch(() => '');
      if (!response.ok) {
        const error = new Error(`Zaparoo /run/ HTTP ${response.status} ${text}`.trim());
        throw error;
      }
      return {
        ok: true,
        target,
        endpoint: zaparooEndpointUrl(target, runPath),
        method: '/run/',
        result: text,
        zapScript,
        fallbackUsed: true,
        message: 'Zaparoo /run/ fallback으로 게임 실행 요청을 보냈습니다.',
        checkedAt: new Date().toISOString(),
      };
    } catch (fallbackError) {
      const fallbackResult = zaparooFailure('Zaparoo run과 /run/ fallback이 모두 실패했습니다.', target, '/run/', fallbackError);
      const code = classifyZaparooRunFailure({ methodResult, fallbackResult, configDiagnostics });
      const diagnostics = {
        code,
        userMessage: `${zaparooRunFailureMessage(code)} 앱은 /media/fat/zaparoo/config.toml을 자동 수정하지 않습니다.`,
        config: configDiagnostics,
        methodResult,
        fallbackResult,
      };
      return {
        ...fallbackResult,
        zapScript,
        message: diagnostics.userMessage,
        diagnostics,
      };
    }
  }
}

async function zaparooWriteReader(request = {}) {
  const text = String(request.text || '').trim();
  if (!text) {
    return {
      ok: false,
      method: 'readers.write',
      text,
      message: 'NFC 카드에 쓸 ZapScript가 없습니다.',
      error: { message: 'NFC 카드에 쓸 ZapScript가 없습니다.' },
      checkedAt: new Date().toISOString(),
    };
  }
  const launchText = escapeZapScriptLaunchPath(text);
  try {
    const result = await zaparooJsonRpc(request.target, 'readers.write', { text: launchText });
    return { ...result, text, message: 'Zaparoo readers.write 요청을 보냈습니다. 카드 리더 상태를 확인하세요.' };
  } catch (error) {
    return { ...zaparooFailure('Zaparoo readers.write에 실패했습니다.', sanitizeZaparooTarget(request.target), 'readers.write', error), text };
  }
}

function zaparooTokenResult(fields) {
  return {
    ok: Boolean(fields.ok),
    target: fields.target,
    endpoint: fields.endpoint,
    method: fields.method || 'tokens.added',
    status: fields.status || (fields.ok ? 'tagDetected' : 'error'),
    code: fields.code,
    text: fields.text,
    rawEventPreview: fields.rawEventPreview,
    timeoutMs: fields.timeoutMs,
    fallbackUsed: fields.fallbackUsed,
    requestId: fields.requestId,
    message: fields.message || (fields.ok ? 'NFC 태그를 감지했습니다.' : 'NFC 태그를 읽지 못했습니다.'),
    error: fields.error,
    checkedAt: new Date().toISOString(),
  };
}

function parseZaparooSseEventBlock(block) {
  const dataLines = [];
  const eventLines = [];
  for (const rawLine of String(block || '').replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) eventLines.push(line.slice('event:'.length).trim());
    if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trimStart());
  }
  const rawData = dataLines.join('\n');
  let data = rawData;
  if (rawData) {
    try {
      data = JSON.parse(rawData);
    } catch {
      data = rawData;
    }
  }
  return { event: eventLines[0], data, raw: String(block || '') };
}

function objectRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function firstTokenString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function isZaparooTokensAddedEvent(parsed) {
  const root = objectRecord(parsed) || {};
  const data = objectRecord(root.data) || root;
  const params = objectRecord(data.params) || {};
  const eventName = firstTokenString(root.event, data.event, data.type, data.method, params.event, params.type);
  return eventName === 'tokens.added';
}

function extractZaparooTokenText(value) {
  if (typeof value === 'string') return value.trim() || undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractZaparooTokenText(item);
      if (found) return found;
    }
    return undefined;
  }
  const record = objectRecord(value);
  if (!record) return undefined;
  const direct = firstTokenString(record.text, record.payload, record.value, record.zapScript, record.zapscript);
  if (direct) return direct;
  for (const key of ['params', 'result', 'token', 'tag', 'data', 'tokens', 'history', 'item', 'last']) {
    const found = extractZaparooTokenText(record[key]);
    if (found) return found;
  }
  return undefined;
}

function rawEventPreview(value) {
  try {
    return JSON.stringify(value).slice(0, 1200);
  } catch {
    return String(value || '').slice(0, 1200);
  }
}

async function zaparooTokenHistoryFallback(target, requestId, timeoutMs, cause) {
  for (const method of ['tokens', 'tokens.history']) {
    try {
      const result = await zaparooJsonRpc(target, method, undefined, Math.min(timeoutMs || 5000, 5000));
      const text = extractZaparooTokenText(result.result);
      if (text) {
        return zaparooTokenResult({
          ok: true,
          target,
          endpoint: zaparooEndpointUrl(target),
          method,
          status: 'tagDetected',
          text,
          requestId,
          timeoutMs,
          fallbackUsed: method,
          message: 'Zaparoo token history에서 NFC 태그 내용을 확인했습니다.',
          rawEventPreview: rawEventPreview(result.result),
        });
      }
    } catch {
      // Try the next fixed token history method.
    }
  }
  return zaparooTokenResult({
    ok: false,
    target,
    endpoint: zaparooEndpointUrl(target),
    method: 'tokens.added',
    status: 'error',
    code: 'ZAPAROO_TOKENS_UNAVAILABLE',
    requestId,
    timeoutMs,
    message: 'Zaparoo token event 구독과 token history fallback을 사용할 수 없습니다.',
    error: { message: cause instanceof Error ? cause.message : String(cause || 'token read unavailable') },
  });
}

async function zaparooReadTokenOnce(request = {}) {
  const target = sanitizeZaparooTarget(request.target);
  const requestId = String(request.requestId || crypto.randomUUID());
  const timeoutMs = Math.max(1000, Math.min(Number(request.timeoutMs || 20000), 60000));
  if (!target) {
    return zaparooTokenResult({
      ok: false,
      status: 'error',
      code: 'ZAPAROO_EVENTS_UNAVAILABLE',
      requestId,
      timeoutMs,
      message: 'MiSTer IP가 없어 NFC 태그 이벤트를 구독할 수 없습니다.',
    });
  }

  const endpoint = zaparooEndpointUrl(target, `${target.endpoint || zaparooDefaultEndpoint}/events`);
  const controller = new globalThis.AbortController();
  const state = { cancelled: false, timedOut: false };
  zaparooTokenReadControllers.set(requestId, { controller, state });
  const timer = globalThis.setTimeout(() => {
    state.timedOut = true;
    controller.abort();
  }, timeoutMs);
  let streamReader;

  try {
    const response = await globalThis.fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`Zaparoo events HTTP ${response.status}`);
    }

    const decoder = new TextDecoder();
    streamReader = response.body.getReader();
    let buffer = '';
    while (true) {
      const { done, value } = await streamReader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        const parsed = parseZaparooSseEventBlock(block);
        if (!isZaparooTokensAddedEvent(parsed)) continue;
        const text = extractZaparooTokenText(parsed.data);
        if (!text) {
          return zaparooTokenResult({
            ok: false,
            target,
            endpoint,
            method: 'tokens.added',
            status: 'error',
            code: 'NFC_TOKEN_TEXT_MISSING',
            requestId,
            timeoutMs,
            message: '태그를 감지했지만 읽을 텍스트를 찾지 못했습니다.',
            rawEventPreview: rawEventPreview(parsed),
          });
        }
        return zaparooTokenResult({
          ok: true,
          target,
          endpoint,
          method: 'tokens.added',
          status: 'tagDetected',
          text,
          requestId,
          timeoutMs,
          message: '태그를 감지했습니다.',
          rawEventPreview: rawEventPreview(parsed),
        });
      }
    }
    throw new Error('Zaparoo events stream closed before tokens.added.');
  } catch (error) {
    if (state.cancelled) {
      return zaparooTokenResult({
        ok: false,
        target,
        endpoint,
        method: 'tokens.added',
        status: 'cancelled',
        code: 'NFC_READ_CANCELLED',
        requestId,
        timeoutMs,
        message: '읽기를 취소했습니다.',
      });
    }
    if (state.timedOut || error?.name === 'AbortError') {
      return zaparooTokenResult({
        ok: false,
        target,
        endpoint,
        method: 'tokens.added',
        status: 'timeout',
        code: 'NFC_READ_TIMEOUT',
        requestId,
        timeoutMs,
        message: '태그를 감지하지 못했습니다. 태그를 뗐다가 다시 올려주세요.',
      });
    }
    return zaparooTokenHistoryFallback(target, requestId, timeoutMs, error);
  } finally {
    if (streamReader) await streamReader.cancel().catch(() => undefined);
    globalThis.clearTimeout(timer);
    zaparooTokenReadControllers.delete(requestId);
  }
}

function zaparooCancelTokenRead(request = {}) {
  const requestId = String(request.requestId || request || '');
  const entry = zaparooTokenReadControllers.get(requestId);
  if (!entry) return { ok: false, message: '진행 중인 NFC 읽기 요청이 없습니다.' };
  entry.state.cancelled = true;
  entry.controller.abort();
  return { ok: true, message: 'NFC 읽기를 취소했습니다.' };
}

function safePasswordStorageAvailable() {
  try {
    return Boolean(safeStorage.isEncryptionAvailable());
  } catch {
    return false;
  }
}

function profileCredentialPath() {
  return appDataPath('profiles', profileCredentialFileName);
}

function sanitizeCredentialEntry(entry = {}) {
  return {
    id: String(entry.id || ''),
    cipherText: String(entry.cipherText || ''),
    updatedAt: entry.updatedAt || new Date().toISOString(),
  };
}

async function loadProfileCredentialEntries() {
  const entries = await readJsonFile(profileCredentialPath(), []);
  return Array.isArray(entries) ? entries.map(sanitizeCredentialEntry).filter((entry) => entry.id && entry.cipherText) : [];
}

async function saveProfileCredentialEntries(entries) {
  const safeEntries = Array.isArray(entries) ? entries.map(sanitizeCredentialEntry).filter((entry) => entry.id && entry.cipherText) : [];
  await writeJsonFile(profileCredentialPath(), safeEntries);
  return safeEntries;
}

async function saveProfilePassword(profileId, password) {
  const id = String(profileId || '');
  if (!id) return { ok: false, saved: false, storageAvailable: safePasswordStorageAvailable(), message: '프로필 ID가 없습니다.' };
  if (!safePasswordStorageAvailable()) return { ok: false, saved: false, storageAvailable: false, message: '이 환경에서는 Electron safeStorage 암호화를 사용할 수 없어 비밀번호를 저장하지 않았습니다.' };
  const cipherText = safeStorage.encryptString(String(password ?? '1')).toString('base64');
  const entries = await loadProfileCredentialEntries();
  const next = [{ id, cipherText, updatedAt: new Date().toISOString() }, ...entries.filter((entry) => entry.id !== id)];
  await saveProfileCredentialEntries(next);
  return { ok: true, saved: true, storageAvailable: true, message: '비밀번호를 Electron safeStorage로 암호화해 저장했습니다.' };
}

async function loadProfilePassword(profileId) {
  if (!safePasswordStorageAvailable()) return undefined;
  const entry = (await loadProfileCredentialEntries()).find((item) => item.id === String(profileId || ''));
  if (!entry) return undefined;
  try {
    return safeStorage.decryptString(Buffer.from(entry.cipherText, 'base64'));
  } catch {
    return undefined;
  }
}

async function getProfilePasswordStatus(profileId) {
  const storageAvailable = safePasswordStorageAvailable();
  const saved = storageAvailable && Boolean((await loadProfileCredentialEntries()).find((item) => item.id === String(profileId || '')));
  return {
    ok: true,
    saved,
    storageAvailable,
    message: !storageAvailable ? 'safeStorage를 사용할 수 없어 비밀번호를 저장하지 않습니다.' : saved ? '암호화된 비밀번호가 저장되어 있습니다.' : '저장된 비밀번호가 없습니다.',
  };
}

async function deleteProfilePassword(profileId) {
  const id = String(profileId || '');
  const entries = await loadProfileCredentialEntries();
  await saveProfileCredentialEntries(entries.filter((entry) => entry.id !== id));
  return { ok: true, message: '저장된 암호화 비밀번호를 삭제했습니다.' };
}

async function fingerprintStoredProfile(request = {}) {
  const profileId = String(request.profileId || '');
  const profiles = await readJsonFile(appDataPath('profiles', profileFileName), []);
  const profile = (Array.isArray(profiles) ? profiles.map(sanitizeProfile) : []).find((item) => item.id === profileId);
  if (!profile) return failedFingerprintFromError({ profileId, host: '', port: 22, username: 'root' }, remoteError('UNKNOWN_REMOTE_ERROR', '저장된 MiSTer 프로필을 찾지 못했습니다.'));
  const password = request.passwordOverride ? String(request.passwordOverride) : (await loadProfilePassword(profileId)) || '1';
  return runFingerprint({
    profileId,
    host: profile.ipAddress,
    port: profile.port || 22,
    username: profile.username || 'root',
    password,
  });
}

function sanitizeProfileSummary(summary = {}) {
  const now = new Date().toISOString();
  return {
    profileId: String(summary.profileId || ''),
    alias: summary.alias ? String(summary.alias) : undefined,
    host: String(summary.host || ''),
    port: Number(summary.port || 22),
    hostname: summary.hostname ? String(summary.hostname) : undefined,
    mac: summary.mac ? String(summary.mac) : undefined,
    lastSeen: summary.lastSeen ? String(summary.lastSeen) : undefined,
    lastSuccessfulReadAt: summary.lastSuccessfulReadAt ? String(summary.lastSuccessfulReadAt) : undefined,
    lastFailedReadAt: summary.lastFailedReadAt ? String(summary.lastFailedReadAt) : undefined,
    lastErrorCode: summary.lastErrorCode ? String(summary.lastErrorCode) : undefined,
    lastErrorMessageSanitized: summary.lastErrorMessageSanitized ? String(summary.lastErrorMessageSanitized) : undefined,
    hostKeyTrustStatus: summary.hostKeyTrustStatus ? String(summary.hostKeyTrustStatus) : undefined,
    fingerprintSummary: summary.fingerprintSummary ? String(summary.fingerprintSummary) : undefined,
    mediaFatStatus: typeof summary.mediaFatStatus === 'boolean' ? summary.mediaFatStatus : undefined,
    gamesFolderStatus: typeof summary.gamesFolderStatus === 'boolean' ? summary.gamesFolderStatus : undefined,
    scriptsFolderStatus: typeof summary.scriptsFolderStatus === 'boolean' ? summary.scriptsFolderStatus : undefined,
    misterIniStatus: typeof summary.misterIniStatus === 'boolean' ? summary.misterIniStatus : undefined,
    downloaderIniStatus: typeof summary.downloaderIniStatus === 'boolean' ? summary.downloaderIniStatus : undefined,
    storageSummary: summary.storageSummary ? String(summary.storageSummary) : undefined,
    gameFolderCount: Number.isFinite(Number(summary.gameFolderCount)) ? Number(summary.gameFolderCount) : undefined,
    scriptCount: Number.isFinite(Number(summary.scriptCount)) ? Number(summary.scriptCount) : undefined,
    readOnlyTestStatus: summary.readOnlyTestStatus ? String(summary.readOnlyTestStatus) : 'unknown',
    readOnlyTestDurationMs: Number.isFinite(Number(summary.readOnlyTestDurationMs)) ? Number(summary.readOnlyTestDurationMs) : undefined,
    updatedAt: summary.updatedAt || now,
  };
}

async function loadProfileSummaries() {
  const entries = await readJsonFile(appDataPath('profiles', profileSummaryFileName), []);
  return Array.isArray(entries)
    ? entries.map(sanitizeProfileSummary).filter((summary) => summary.profileId && summary.host)
    : [];
}

async function saveProfileSummaries(summaries) {
  const sanitized = Array.isArray(summaries) ? summaries.map(sanitizeProfileSummary).filter((summary) => summary.profileId && summary.host) : [];
  await writeJsonFile(appDataPath('profiles', profileSummaryFileName), sanitized);
  return sanitized;
}

async function upsertProfileSummary(summary) {
  const summaries = await loadProfileSummaries();
  const sanitized = sanitizeProfileSummary({ ...summary, updatedAt: summary.updatedAt || new Date().toISOString() });
  const next = [sanitized, ...summaries.filter((item) => item.profileId !== sanitized.profileId)];
  return saveProfileSummaries(next);
}

async function clearProfileSummary(profileId) {
  const summaries = await loadProfileSummaries();
  const next = summaries.filter((summary) => summary.profileId !== profileId);
  return saveProfileSummaries(next);
}

function remoteError(code, detail = '') {
  const messages = {
    NETWORK_TIMEOUT: '기기가 꺼져 있거나 네트워크에 없습니다(응답 시간 초과). 전원과 IP를 확인한 뒤 다시 연결하세요.',
    CONNECTION_REFUSED: '기기가 SSH 연결을 거부했습니다. MiSTer에서 SSH(원격 접속)가 켜져 있는지 확인하세요.',
    HOST_KEY_UNTRUSTED: '처음 보는 SSH 호스트 키입니다. fingerprint를 확인한 뒤 신뢰해야 합니다.',
    HOST_KEY_MISMATCH: '이 IP의 SSH 호스트 키가 이전에 저장된 값과 다릅니다. 장치가 바뀌었거나 보안 문제가 있을 수 있습니다.',
    AUTH_FAILED: '인증에 실패했습니다. 사용자명 또는 비밀번호를 확인하세요.',
    SSH_NEGOTIATION_FAILED: 'SSH handshake에 실패했습니다. 장치의 SSH 설정을 확인하세요.',
    SFTP_UNAVAILABLE: 'SSH 접속은 되었지만 SFTP 파일 조회를 사용할 수 없습니다.',
    REMOTE_PATH_MISSING: '필수 원격 경로를 찾지 못했습니다.',
    NOT_MISTER: 'SSH 접속은 되었지만 /media/fat 구조가 확인되지 않아 MiSTer로 확정할 수 없습니다.',
    READ_PERMISSION_DENIED: '읽기 권한이 부족합니다.',
    COMMAND_BLOCKED: '위험하거나 허용되지 않은 명령이 차단되었습니다.',
    UNKNOWN_REMOTE_ERROR: '연결에 실패했습니다. 기기가 꺼져 있거나 응답하지 않을 수 있습니다. 전원·네트워크를 확인한 뒤 다시 연결하세요.',
  };
  return { code, message: messages[code] || messages.UNKNOWN_REMOTE_ERROR, detail: String(detail || '') };
}

function classifySshError(error) {
  if (error?.code && [
    'NETWORK_TIMEOUT',
    'CONNECTION_REFUSED',
    'HOST_KEY_UNTRUSTED',
    'HOST_KEY_MISMATCH',
    'AUTH_FAILED',
    'SSH_NEGOTIATION_FAILED',
    'SFTP_UNAVAILABLE',
    'REMOTE_PATH_MISSING',
    'NOT_MISTER',
    'READ_PERMISSION_DENIED',
    'COMMAND_BLOCKED',
    'UNKNOWN_REMOTE_ERROR',
  ].includes(error.code)) return remoteError(error.code, error?.detail || error?.message || '');
  const text = String(error?.message || error || '');
  if (/timed out|timeout|readyTimeout|ETIMEDOUT|EHOSTUNREACH|EHOSTDOWN|ENETUNREACH|ENOTFOUND|getaddrinfo|no route to host|network is unreachable|not reachable/i.test(text)) return remoteError('NETWORK_TIMEOUT', text);
  if (/ECONNREFUSED|Connection refused/i.test(text)) return remoteError('CONNECTION_REFUSED', text);
  if (/All configured authentication methods failed|authentication|Permission denied/i.test(text)) return remoteError('AUTH_FAILED', text);
  if (/host key.*mismatch|HOST_KEY_MISMATCH/i.test(text)) return remoteError('HOST_KEY_MISMATCH', text);
  if (/host key.*untrusted|HOST_KEY_UNTRUSTED/i.test(text)) return remoteError('HOST_KEY_UNTRUSTED', text);
  if (/SFTP|subsystem/i.test(text)) return remoteError('SFTP_UNAVAILABLE', text);
  if (/permission denied/i.test(text)) return remoteError('READ_PERMISSION_DENIED', text);
  if (/handshake|negotiation|kex/i.test(text)) return remoteError('SSH_NEGOTIATION_FAILED', text);
  return remoteError('UNKNOWN_REMOTE_ERROR', text);
}

function knownHostId(host, port) {
  return `${String(host).trim().toLowerCase()}:${Number(port || 22)}`;
}

function sanitizeKnownHost(entry) {
  const now = new Date().toISOString();
  return {
    id: knownHostId(entry.host, entry.port),
    host: String(entry.host || '').trim(),
    port: Number(entry.port || 22),
    fingerprint: String(entry.fingerprint || ''),
    keyType: String(entry.keyType || 'unknown'),
    firstSeen: entry.firstSeen || now,
    lastSeen: entry.lastSeen || now,
    profileId: entry.profileId ? String(entry.profileId) : undefined,
    alias: entry.alias ? String(entry.alias) : undefined,
  };
}

function sanitizeKnownHostHistory(entry = {}) {
  const now = new Date().toISOString();
  const cleanAction = ['detected', 'trusted', 'removed', 'replaced'].includes(entry.action) ? entry.action : 'detected';
  return {
    id: String(entry.id || `host-history-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
    host: String(entry.host || '').trim(),
    port: Number(entry.port || 22),
    oldFingerprint: entry.oldFingerprint ? String(entry.oldFingerprint) : undefined,
    newFingerprint: entry.newFingerprint ? String(entry.newFingerprint) : undefined,
    oldKeyType: entry.oldKeyType ? String(entry.oldKeyType) : undefined,
    newKeyType: entry.newKeyType ? String(entry.newKeyType) : undefined,
    detectedAt: entry.detectedAt || now,
    profileId: entry.profileId ? String(entry.profileId) : undefined,
    alias: entry.alias ? String(entry.alias) : undefined,
    reason: entry.reason ? String(entry.reason) : undefined,
    action: cleanAction,
  };
}

async function loadKnownHostHistory() {
  const entries = await readJsonFile(appDataPath('profiles', knownHostHistoryFileName), []);
  return Array.isArray(entries)
    ? entries.map(sanitizeKnownHostHistory).filter((entry) => entry.host && (entry.oldFingerprint || entry.newFingerprint)).slice(0, 200)
    : [];
}

async function saveKnownHostHistory(entries) {
  const sanitized = entries.map(sanitizeKnownHostHistory).slice(0, 200);
  await writeJsonFile(appDataPath('profiles', knownHostHistoryFileName), sanitized);
  return sanitized;
}

async function appendKnownHostHistory(entry) {
  const current = await loadKnownHostHistory();
  const next = [sanitizeKnownHostHistory(entry), ...current].slice(0, 200);
  await saveKnownHostHistory(next);
  return next;
}

async function loadKnownHosts() {
  const entries = await readJsonFile(appDataPath('profiles', knownHostFileName), []);
  return Array.isArray(entries) ? entries.map(sanitizeKnownHost).filter((entry) => entry.host && entry.fingerprint) : [];
}

async function saveKnownHosts(entries) {
  await writeJsonFile(appDataPath('profiles', knownHostFileName), entries.map(sanitizeKnownHost));
  return entries.map(sanitizeKnownHost);
}

async function findKnownHost(host, port) {
  const entries = await loadKnownHosts();
  return entries.find((entry) => entry.id === knownHostId(host, port));
}

function parseHostKey(rawKey) {
  let keyType = 'unknown';
  try {
    const parsed = sshUtils.parseKey(rawKey);
    const key = Array.isArray(parsed) ? parsed[0] : parsed;
    if (key && !(key instanceof Error) && key.type) keyType = key.type;
  } catch {
    keyType = 'unknown';
  }
  const digest = crypto.createHash('sha256').update(rawKey).digest('base64').replace(/=+$/, '');
  return { keyType, fingerprint: `${keyType.toUpperCase()} SHA256:${digest}` };
}

function hostKeyMessage(status) {
  if (status === 'trusted') return '신뢰된 SSH 호스트 키입니다.';
  if (status === 'new') return '처음 보는 SSH 호스트 키입니다. fingerprint를 확인하고 신뢰해야 합니다.';
  if (status === 'mismatch') return '저장된 SSH 호스트 키와 현재 키가 다릅니다. 기본적으로 연결을 중단합니다.';
  if (status === 'trusted-now') return '이 SSH 호스트 키를 신뢰 목록에 저장했습니다.';
  if (status === 'removed') return '저장된 SSH 호스트 키 신뢰 항목을 제거했습니다.';
  return 'SSH 호스트 키 확인 전입니다.';
}

function compareHostKey(host, port, hostKey, knownHost) {
  if (!knownHost) {
    return { ok: false, status: 'new', host, port, ...hostKey, message: hostKeyMessage('new'), error: remoteError('HOST_KEY_UNTRUSTED') };
  }
  if (knownHost.fingerprint !== hostKey.fingerprint) {
    return { ok: false, status: 'mismatch', host, port, ...hostKey, knownHost, message: hostKeyMessage('mismatch'), error: remoteError('HOST_KEY_MISMATCH') };
  }
  return { ok: true, status: 'trusted', host, port, ...hostKey, knownHost, message: hostKeyMessage('trusted') };
}

async function finalizeHostKeyCheck(result, request = {}) {
  if (result.status === 'mismatch' && result.knownHost && result.fingerprint) {
    await appendKnownHostHistory({
      host: result.host,
      port: result.port,
      oldFingerprint: result.knownHost.fingerprint,
      newFingerprint: result.fingerprint,
      oldKeyType: result.knownHost.keyType,
      newKeyType: result.keyType,
      profileId: request.profileId || result.knownHost.profileId,
      alias: request.alias || result.knownHost.alias,
      reason: 'host-key-mismatch-detected',
      action: 'detected',
    });
  }
  const history = (await loadKnownHostHistory())
    .filter((entry) => entry.host === result.host && entry.port === result.port)
    .slice(0, 20);
  return { ...result, history };
}

function maskSensitive(text, credential = {}) {
  let output = String(text || '');
  for (const secret of [credential.password, credential.privateKey, credential.passphrase]) {
    // Only mask secrets long enough to be meaningful. Masking a 1-3 char password (e.g. "1") would replace
    // EVERY such substring in legitimate output — file names ("ver. 105" -> "ver. [secret]05"), MAC/hostname
    // digits, etc. — corrupting scan paths and the NFC launch payload. A 1-3 char password has no real secrecy.
    if (secret && String(secret).length >= 4) output = output.split(String(secret)).join('[secret]');
  }
  return output;
}

function sanitizeCredentialInput(input = {}) {
  return {
    profileId: input.profileId ? String(input.profileId) : undefined,
    host: String(input.host || '').trim(),
    port: Number(input.port || 22),
    username: String(input.username || '').trim(),
    password: input.password ? String(input.password) : undefined,
    privateKey: input.privateKey ? String(input.privateKey) : undefined,
    passphrase: input.passphrase ? String(input.passphrase) : undefined,
  };
}

function publicSessionState(session) {
  return {
    sessionId: session.sessionId,
    host: session.host,
    port: session.port,
    username: session.username,
    createdAt: session.createdAt,
    lastUsedAt: session.lastUsedAt,
    hasPassword: Boolean(session.password),
    hasPrivateKey: Boolean(session.privateKey),
  };
}

function rememberSession(credential) {
  const now = new Date().toISOString();
  const sessionId = credential.profileId || `${credential.host}:${credential.port}:${credential.username}`;
  const session = {
    sessionId,
    host: credential.host,
    port: credential.port,
    username: credential.username,
    password: credential.password,
    privateKey: credential.privateKey,
    passphrase: credential.passphrase,
    createdAt: sshSessions.get(sessionId)?.createdAt || now,
    lastUsedAt: now,
  };
  sshSessions.set(sessionId, session);
  return session;
}

function getSession(sessionId) {
  const session = sshSessions.get(sessionId);
  if (!session) throw new Error('세션 인증 정보가 없습니다. 읽기 전용 연결을 다시 실행하세요.');
  session.lastUsedAt = new Date().toISOString();
  sshSessions.set(sessionId, session);
  return session;
}

function validateCredential(credential) {
  if (!credential.host) throw new Error('host/IP가 필요합니다.');
  if (!credential.username) throw new Error('username이 필요합니다.');
  if (!credential.password && !credential.privateKey) throw new Error('session-only password 또는 private key가 필요합니다.');
  if (credential.port < 1 || credential.port > 65535) throw new Error('SSH port 범위가 올바르지 않습니다.');
}

async function inspectHostKey(request = {}) {
  const host = String(request.host || '').trim();
  const port = Number(request.port || 22);
  if (!host) return { ok: false, status: 'unchecked', host, port, message: 'host/IP가 필요합니다.', error: remoteError('UNKNOWN_REMOTE_ERROR', 'missing-host') };
  const knownHost = await findKnownHost(host, port);
  return new Promise((resolve) => {
    const client = new Client();
    let captured;
    let settled = false;
    const finish = async (result) => {
      if (settled) return;
      settled = true;
      client.destroy();
      resolve(await finalizeHostKeyCheck(result, request));
    };
    client.on('error', (error) => {
      if (captured) {
        finish(compareHostKey(host, port, captured, knownHost));
        return;
      }
      const classified = classifySshError(error);
      finish({ ok: false, status: 'unchecked', host, port, message: classified.message, error: classified });
    });
    client.on('close', () => {
      if (captured) finish(compareHostKey(host, port, captured, knownHost));
    });
    client.connect({
      host,
      port,
      username: 'host-key-check',
      readyTimeout: 6000,
      hostVerifier: (rawKey) => {
        captured = parseHostKey(rawKey);
        return false;
      },
    });
  });
}

async function trustHostKey(request = {}) {
  const host = String(request.host || '').trim();
  const port = Number(request.port || 22);
  const fingerprint = String(request.fingerprint || '');
  const keyType = String(request.keyType || 'unknown');
  if (!host || !fingerprint) {
    return { ok: false, status: 'unchecked', host, port, fingerprint, keyType, message: '저장할 host key 정보가 부족합니다.', error: remoteError('UNKNOWN_REMOTE_ERROR', 'missing-host-key') };
  }
  const entries = await loadKnownHosts();
  const existing = entries.find((entry) => entry.id === knownHostId(host, port));
  if (existing && existing.fingerprint !== fingerprint) {
    await appendKnownHostHistory({
      host,
      port,
      oldFingerprint: existing.fingerprint,
      newFingerprint: fingerprint,
      oldKeyType: existing.keyType,
      newKeyType: keyType,
      profileId: request.profileId || existing.profileId,
      alias: request.alias || existing.alias,
      reason: 'replace-blocked-remove-old-trust-first',
      action: 'detected',
    });
    const history = (await loadKnownHostHistory()).filter((entry) => entry.host === host && entry.port === port).slice(0, 20);
    return {
      ok: false,
      status: 'mismatch',
      host,
      port,
      fingerprint,
      keyType,
      knownHost: existing,
      history,
      message: '저장된 SSH 호스트 키와 다릅니다. 기존 신뢰를 먼저 제거한 뒤 새 키를 신뢰하세요.',
      error: remoteError('HOST_KEY_MISMATCH'),
    };
  }
  const now = new Date().toISOString();
  const entry = sanitizeKnownHost({
    host,
    port,
    fingerprint,
    keyType,
    profileId: request.profileId,
    alias: request.alias,
    firstSeen: existing?.firstSeen || now,
    lastSeen: now,
  });
  const next = [...entries.filter((item) => item.id !== entry.id), entry].sort((a, b) => a.host.localeCompare(b.host));
  await saveKnownHosts(next);
  await appendKnownHostHistory({
    host,
    port,
    oldFingerprint: existing?.fingerprint,
    newFingerprint: fingerprint,
    oldKeyType: existing?.keyType,
    newKeyType: keyType,
    profileId: request.profileId,
    alias: request.alias,
    reason: existing ? 'known-host-trust-refreshed' : 'new-known-host-trusted',
    action: 'trusted',
  });
  const history = (await loadKnownHostHistory()).filter((item) => item.host === host && item.port === port).slice(0, 20);
  return { ok: true, status: 'trusted-now', host, port, fingerprint, keyType, knownHost: entry, history, message: hostKeyMessage('trusted-now') };
}

async function removeKnownHost({ host, port }) {
  const entries = await loadKnownHosts();
  const removed = entries.find((entry) => entry.id === knownHostId(host, port));
  const next = entries.filter((entry) => entry.id !== knownHostId(host, port));
  await saveKnownHosts(next);
  if (removed) {
    await appendKnownHostHistory({
      host: removed.host,
      port: removed.port,
      oldFingerprint: removed.fingerprint,
      oldKeyType: removed.keyType,
      profileId: removed.profileId,
      alias: removed.alias,
      reason: 'known-host-trust-removed-by-user',
      action: 'removed',
    });
  }
  return { ok: true, message: hostKeyMessage('removed'), entries: next };
}

async function createSshClient(session) {
  const knownHost = await findKnownHost(session.host, session.port);
  let currentHostKey;
  return new Promise((resolve, reject) => {
    const client = new Client();
    // ssh2 can emit 'error' more than once (e.g. "Connection lost before handshake" followed by a socket error
    // when a MiSTer powers off mid-connect). A `once` listener would be consumed by the first emit, leaving the
    // second with no listener -> uncaughtException -> fatal Electron dialog. Use a persistent listener with a
    // settled guard so we resolve/reject exactly once but a registered error listener always stays attached.
    let settled = false;
    const settle = (action) => {
      if (settled) return;
      settled = true;
      action();
    };
    const config = {
      host: session.host,
      port: session.port,
      username: session.username,
      readyTimeout: 8000,
      // Keep pooled connections alive between scan steps so they are not torn down mid-scan.
      keepaliveInterval: 15000,
      keepaliveCountMax: 3,
    };
    if (session.password) config.password = session.password;
    if (session.privateKey) config.privateKey = session.privateKey;
    if (session.passphrase) config.passphrase = session.passphrase;
    config.hostVerifier = (rawKey) => {
      currentHostKey = parseHostKey(rawKey);
      const checked = compareHostKey(session.host, session.port, currentHostKey, knownHost);
      if (!checked.ok) {
        if (checked.status === 'mismatch' && knownHost) {
          appendKnownHostHistory({
            host: session.host,
            port: session.port,
            oldFingerprint: knownHost.fingerprint,
            newFingerprint: currentHostKey.fingerprint,
            oldKeyType: knownHost.keyType,
            newKeyType: currentHostKey.keyType,
            profileId: knownHost.profileId,
            alias: knownHost.alias,
            reason: 'connection-blocked-host-key-mismatch',
            action: 'detected',
          }).catch((error) => console.warn('[Hello Mister] host key history write failed:', error));
        }
        const error = new Error(checked.error?.message || checked.message);
        error.code = checked.error?.code;
        settle(() => reject(error));
        return false;
      }
      return true;
    };

    client.once('ready', async () => {
      if (knownHost && currentHostKey) {
        await trustHostKey({ ...knownHost, fingerprint: currentHostKey.fingerprint, keyType: currentHostKey.keyType });
      }
      settle(() => resolve(client));
    });
    client.on('error', (error) => {
      settle(() => {
        if (error.code === 'HOST_KEY_UNTRUSTED' || error.code === 'HOST_KEY_MISMATCH') {
          reject(error);
          return;
        }
        reject(new Error(maskSensitive(error.message, session)));
      });
    });
    client.connect(config);
  });
}

function commandContainsForbiddenToken(command) {
  return /(^|\s)(rm|mv|cp|dd|mkfs|parted|fdisk|reboot|shutdown|halt|poweroff|sync|chmod|chown|mount|umount|wget|curl|bash|sh|source)(\s|$)/.test(command)
    || />|>>|\|\s*(rm|mv|cp|dd|mkfs|parted|fdisk|reboot|shutdown|halt|poweroff|sync|chmod|chown|mount|umount|wget|curl|bash|sh|source)\b/.test(command)
    || /\.\/|\/media\/fat\/Scripts\/.*\.sh/.test(command);
}

function assertReadOnlyCommand(command) {
  const allowedPrefixes = [
    'cat /etc/hostname',
    'cat /sys/block/mmcblk0/device/cid',
    'test -d /media/fat',
    'test -f /media/fat/MiSTer.ini',
    'test -f /media/fat/downloader.ini',
    'test -d /media/fat/games',
    'test -d /media/fat/Scripts',
    'test -d /media/fat/config',
    'test -d /media/fat/linux',
    'df -k /media/fat',
    'uname -a',
    'date',
    'ip -o link',
    'find /media/fat',
  ];
  if (commandContainsForbiddenToken(command)) throw new Error(`금지된 명령이 차단되었습니다: ${command}`);
  if (!allowedPrefixes.some((prefix) => command.startsWith(prefix))) throw new Error(`허용되지 않은 읽기 명령입니다: ${command}`);
}

function execReadOnly(client, action, command, credential, { maskOutput = true } = {}) {
  assertReadOnlyCommand(command);
  const started = Date.now();
  // Data-returning commands (file lists, .mra <rbf>) pass maskOutput:false: their stdout is game paths, never
  // the password, and masking it would corrupt any path that happens to contain the password string.
  const maskOut = (value) => (maskOutput ? maskSensitive(value, credential) : String(value || ''));
  return new Promise((resolve) => {
    client.exec(command, (error, stream) => {
      if (error) {
        resolve({ action, exitCode: 1, stdout: '', stderr: maskSensitive(error.message, credential), durationMs: Date.now() - started });
        return;
      }
      let stdout = '';
      let stderr = '';
      let exitCode = 0;
      stream.on('close', (code) => {
        exitCode = typeof code === 'number' ? code : exitCode;
        resolve({
          action,
          exitCode,
          stdout: maskOut(stdout.trim()),
          stderr: maskSensitive(stderr.trim(), credential),
          durationMs: Date.now() - started,
        });
      });
      stream.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
      });
      stream.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });
    });
  });
}

function sftpClient(client) {
  // Reuse ONE SFTP channel per (pooled) client. Opening a fresh channel on every call leaked channels on the
  // reused connection and hit the MiSTer's session limit (SFTP_UNAVAILABLE). ssh2 pipelines concurrent requests
  // on a single SFTP channel, so the parallel scan still works over one channel.
  if (client.__pooledSftp) return Promise.resolve(client.__pooledSftp);
  if (client.__pooledSftpPromise) return client.__pooledSftpPromise;
  client.__pooledSftpPromise = new Promise((resolve, reject) => {
    client.sftp((error, sftp) => {
      client.__pooledSftpPromise = undefined;
      if (error) {
        reject(error);
        return;
      }
      client.__pooledSftp = sftp;
      const clear = () => { if (client.__pooledSftp === sftp) client.__pooledSftp = undefined; };
      sftp.on('close', clear);
      sftp.on('error', clear);
      resolve(sftp);
    });
  });
  return client.__pooledSftpPromise;
}

function sftpStat(sftp, targetPath) {
  return new Promise((resolve) => {
    sftp.stat(targetPath, (error, attrs) => {
      if (error) resolve(undefined);
      else resolve(attrs);
    });
  });
}

function sftpReadDir(sftp, targetPath) {
  return new Promise((resolve) => {
    sftp.readdir(targetPath, (error, list) => {
      if (error) resolve([]);
      else resolve(list || []);
    });
  });
}

// Incremental directory read that STOPS after maxEntries instead of transferring the whole directory. Critical
// for folders holding full ROM sets (thousands of files), where a plain readdir transfers every entry.
function sftpReadDirLimited(sftp, targetPath, maxEntries) {
  if (!maxEntries || maxEntries <= 0) return sftpReadDir(sftp, targetPath);
  return new Promise((resolve) => {
    sftp.opendir(targetPath, (openError, handle) => {
      if (openError || !handle) {
        resolve([]);
        return;
      }
      const collected = [];
      const finish = () => sftp.close(handle, () => resolve(collected));
      const readNext = () => {
        sftp.readdir(handle, (readError, list) => {
          if (readError || !list || list.length === 0) {
            finish();
            return;
          }
          for (const item of list) {
            collected.push(item);
            if (collected.length >= maxEntries) {
              finish();
              return;
            }
          }
          readNext();
        });
      };
      readNext();
    });
  });
}

function sftpReadFile(sftp, targetPath, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    sftp.readFile(targetPath, (error, buffer) => {
      if (error) {
        reject(error);
        return;
      }
      const limited = buffer.length > maxBytes ? buffer.subarray(0, maxBytes) : buffer;
      resolve(limited.toString('utf8'));
    });
  });
}

function sftpReadBuffer(sftp, targetPath, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    sftp.readFile(targetPath, (error, buffer) => {
      if (error) {
        reject(error);
        return;
      }
      const limited = buffer.length > maxBytes ? buffer.subarray(0, maxBytes) : buffer;
      resolve(Buffer.from(limited));
    });
  });
}

function sftpWriteZaparooConfigFile(sftp, targetPath, content) {
  return new Promise((resolve, reject) => {
    if (!isAllowedZaparooConfigWritePath(targetPath)) {
      reject(new Error('Zaparoo config ?? ???? ???? ?? ?? ?? ?????.'));
      return;
    }
    sftp.writeFile(targetPath, Buffer.from(String(content || ''), 'utf8'), (error) => {
      if (error) reject(error);
      else resolve(true);
    });
  });
}

function pathStatusFromAttrs(label, targetPath, attrs) {
  return {
    path: targetPath,
    label,
    exists: Boolean(attrs),
    type: !attrs ? 'missing' : attrs.isDirectory?.() ? 'directory' : attrs.isFile?.() ? 'file' : 'unknown',
  };
}

function parseMacAddress(ipLinkOutput) {
  const matches = String(ipLinkOutput || '').match(/link\/ether\s+([0-9a-f:]{17})/i);
  return matches?.[1]?.toUpperCase();
}

// The SD CID is 32 hex chars (e.g. 1b534d4546385335301d4467c4a19727). Keep only hex and require the full
// length so partial/garbage reads are ignored; lower-cased for stable comparison.
function parseSdCid(cidOutput) {
  const hex = String(cidOutput || '').trim().toLowerCase().replace(/[^0-9a-f]/g, '');
  return hex.length === 32 ? hex : undefined;
}

function parseStorage(dfOutput) {
  const lines = String(dfOutput || '').split(/\r?\n/).filter(Boolean);
  const row = lines.find((line) => line.includes('/media/fat')) || lines[1];
  if (!row) return { mountPath: '/media/fat', raw: dfOutput };
  const parts = row.trim().split(/\s+/);
  const usePercent = Number(String(parts[4] || '').replace('%', ''));
  return {
    mountPath: parts[5] || '/media/fat',
    sizeKb: Number(parts[1]) || undefined,
    usedKb: Number(parts[2]) || undefined,
    availableKb: Number(parts[3]) || undefined,
    usePercent: Number.isFinite(usePercent) ? usePercent : undefined,
    raw: dfOutput,
  };
}

async function runFingerprint(credentialInput) {
  const credential = sanitizeCredentialInput(credentialInput);
  validateCredential(credential);
  const session = rememberSession(credential);
  const started = Date.now();
  const client = await createSshClient(session);
  try {
    const commands = [];
    const run = async (action, command) => {
      const result = await execReadOnly(client, action, command, session);
      commands.push(result);
      return result;
    };

    const [hostname, df, uname, dateResult, macResult, cidResult] = await Promise.all([
      run('read-hostname', 'cat /etc/hostname'),
      run('read-media-fat-storage', 'df -k /media/fat'),
      run('read-kernel', 'uname -a'),
      run('read-time', 'date'),
      run('read-mac-candidates', 'ip -o link'),
      // SD card CID: unique per physical microSD (even cloned ones), so it identifies the device when the
      // MAC is the shared MiSTer default. Read the boot SD's CID (mmcblk0). No shell redirect — execReadOnly
      // captures stderr and tolerates a non-zero exit (missing file -> empty stdout -> no CID), and a redirect
      // ('>') is a forbidden token in the read-only command guard.
      run('read-sd-cid', 'cat /sys/block/mmcblk0/device/cid'),
    ]);

    const sftp = await sftpClient(client);
    const pathStatuses = await Promise.all([
      ['mediaFat', 'media/fat', remotePaths.mediaFat],
      ['games', 'games', remotePaths.games],
      ['scripts', 'Scripts', remotePaths.scripts],
      ['misterIni', 'MiSTer.ini', remotePaths.misterIni],
      ['downloaderIni', 'downloader.ini', remotePaths.downloaderIni],
      ['config', 'config', remotePaths.config],
      ['linux', 'linux', remotePaths.linux],
    ].map(async ([, label, targetPath]) => pathStatusFromAttrs(label, targetPath, await sftpStat(sftp, targetPath))));

    const hasMediaFat = pathStatuses.find((item) => item.path === remotePaths.mediaFat)?.exists;
    const ok = Boolean(hasMediaFat);
    return {
      ok,
      sessionId: session.sessionId,
      host: session.host,
      ipAddress: session.host,
      hostname: hostname.stdout || undefined,
      macAddress: parseMacAddress(macResult.stdout),
      sdCid: parseSdCid(cidResult.stdout),
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      pathStatuses,
      storage: parseStorage(df.stdout),
      osInfo: uname.stdout,
      kernelInfo: uname.stdout,
      remoteTime: dateResult.stdout,
      message: ok ? '읽기 전용 fingerprint가 완료되었습니다.' : 'SSH는 연결되었지만 /media/fat 구조를 확인하지 못했습니다.',
      commands,
    };
  } finally {
    client.end();
  }
}

function failedFingerprintFromError(credentialInput, error) {
  const credential = sanitizeCredentialInput(credentialInput);
  const classified = classifySshError(error);
  return {
    ok: false,
    host: credential.host,
    ipAddress: credential.host,
    checkedAt: new Date().toISOString(),
    latencyMs: 0,
    pathStatuses: [],
    message: classified.message,
    error: classified,
    commands: [],
  };
}

function releasePooledClient(sessionId) {
  const pooled = sshClientPool.get(sessionId);
  if (pooled) {
    sshClientPool.delete(sessionId);
    try { pooled.client.end(); } catch { /* already closed */ }
  }
}

async function acquireSshClient(session) {
  const pooled = sshClientPool.get(session.sessionId);
  if (pooled) return pooled.client;
  const client = await createSshClient(session);
  const entry = { client };
  // Evict on close/error so the next call reconnects; the error handler also prevents an unhandled 'error'.
  const evict = () => { if (sshClientPool.get(session.sessionId) === entry) sshClientPool.delete(session.sessionId); };
  client.on('close', evict);
  client.on('error', evict);
  sshClientPool.set(session.sessionId, entry);
  return client;
}

async function withSessionClient(sessionId, callback) {
  const session = getSession(sessionId);
  const client = await acquireSshClient(session);
  try {
    // Keep the connection pooled on success so a multi-step scan reuses one handshake.
    return await callback(client, session);
  } catch (error) {
    // Stop reusing a connection that errored, but do NOT end() it here: concurrent operations may still be
    // using the same pooled client. The client's own close/error handler evicts it when it truly dies.
    sshClientPool.delete(sessionId);
    throw error;
  }
}

async function readRemoteIni(sessionId) {
  return withSessionClient(sessionId, async (client) => {
    const sftp = await sftpClient(client);
    const attrs = await sftpStat(sftp, remotePaths.misterIni);
    if (!attrs?.isFile?.()) {
      return {
        ok: false,
        sessionId,
        path: remotePaths.misterIni,
        content: '',
        readAt: new Date().toISOString(),
        sizeBytes: 0,
        message: '원격 MiSTer.ini를 찾지 못했습니다.',
      };
    }
    const content = await sftpReadFile(sftp, remotePaths.misterIni, 512 * 1024);
    return {
      ok: true,
      sessionId,
      path: remotePaths.misterIni,
      content,
      readAt: new Date().toISOString(),
      sizeBytes: attrs.size || Buffer.byteLength(content),
      message: '원격 MiSTer.ini를 읽었습니다. 원격에는 아무것도 쓰지 않았습니다.',
    };
  });
}

async function readZaparooConfigDiagnostics(sessionId) {
  const targetSessionId = sessionId || activeMisterProfile?.sessionId;
  if (!targetSessionId) {
    return {
      ok: false,
      status: 'not-checked',
      path: remotePaths.zaparooConfig,
      serviceFound: false,
      allowRun: { present: false, values: [], count: 0, empty: true },
      allowedIps: { present: false, values: [], count: 0, empty: true },
      checkedAt: new Date().toISOString(),
      message: 'MiSTer 연결 세션이 없어 Zaparoo config.toml을 확인할 수 없습니다.',
    };
  }
  try {
    return await withSessionClient(targetSessionId, async (client) => {
      const sftp = await sftpClient(client);
      const attrs = await sftpStat(sftp, remotePaths.zaparooConfig);
      if (!attrs?.isFile?.()) {
        return {
          ok: false,
          status: 'missing',
          path: remotePaths.zaparooConfig,
          serviceFound: false,
          allowRun: { present: false, values: [], count: 0, empty: true },
          allowedIps: { present: false, values: [], count: 0, empty: true },
          checkedAt: new Date().toISOString(),
          message: 'Zaparoo config.toml을 찾을 수 없습니다.',
        };
      }
      const content = await sftpReadFile(sftp, remotePaths.zaparooConfig, 256 * 1024);
      return parseZaparooConfigToml(content);
    });
  } catch (error) {
    return {
      ok: false,
      status: 'read-failed',
      path: remotePaths.zaparooConfig,
      serviceFound: false,
      allowRun: { present: false, values: [], count: 0, empty: true },
      allowedIps: { present: false, values: [], count: 0, empty: true },
      checkedAt: new Date().toISOString(),
      message: 'Zaparoo config.toml을 읽지 못했습니다. 원격 파일은 수정하지 않았습니다.',
      error: { message: error instanceof Error ? error.message : String(error) },
    };
  }
}


async function readZaparooConfigTextForApply(sessionId) {
  const targetSessionId = sessionId || activeMisterProfile?.sessionId;
  if (!targetSessionId) throw new Error('MiSTer ?? ??? ?? Zaparoo config.toml? ??? ? ????.');
  return withSessionClient(targetSessionId, async (client) => {
    const sftp = await sftpClient(client);
    const attrs = await sftpStat(sftp, remotePaths.zaparooConfig);
    if (!attrs?.isFile?.()) return { sessionId: targetSessionId, content: '', exists: false };
    return { sessionId: targetSessionId, content: await sftpReadFile(sftp, remotePaths.zaparooConfig, 256 * 1024), exists: true };
  });
}

async function zaparooPreviewConfigApply(request = {}) {
  try {
    const current = await readZaparooConfigTextForApply(request.sessionId);
    return buildZaparooConfigPatchPlan(current.content, request.mode, undefined, hostForSession(current.sessionId));
  } catch (error) {
    const recommendation = createZaparooConfigRecommendation(request.mode, hostForSession(request.sessionId));
    return {
      ok: false,
      path: remotePaths.zaparooConfig,
      recommendation,
      changes: [],
      diffPreview: '',
      nextPreview: '',
      changed: false,
      backupFileName: '',
      remoteBackupPath: '',
      localBackupRelativePath: '',
      safetyMessages: [],
      message: error instanceof Error ? error.message : 'Zaparoo config ?? ??? ??? ?????.',
    };
  }
}

async function zaparooApplyConfigPatch(request = {}) {
  const confirmed = Boolean(request.confirmed);
  const targetSessionId = request.sessionId || activeMisterProfile?.sessionId;
  let remoteBackupError;
  if (!confirmed) {
    return {
      ok: false,
      path: remotePaths.zaparooConfig,
      remoteBackupOk: false,
      localBackupOk: false,
      applied: false,
      reloadAttempted: false,
      reloadOk: false,
      message: '??? ?? ??? ??? ? ????.',
    };
  }
  try {
    const current = await readZaparooConfigTextForApply(targetSessionId);
    const plan = buildZaparooConfigPatchPlan(current.content, request.mode, undefined, hostForSession(current.sessionId));
    const localBackupPath = appDataPath('backups', 'zaparoo', plan.backupFileName);
    let localBackupOk = false;
    let remoteBackupOk = false;
    try {
      await fs.mkdir(path.dirname(localBackupPath), { recursive: true });
      await fs.writeFile(localBackupPath, current.content, 'utf8');
      localBackupOk = true;
    } catch {
      localBackupOk = false;
    }
    await withSessionClient(current.sessionId, async (client) => {
      const sftp = await sftpClient(client);
      try {
        await sftpWriteZaparooConfigFile(sftp, plan.remoteBackupPath, current.content);
        remoteBackupOk = true;
      } catch (error) {
        remoteBackupError = error;
      }
      const validation = validateZaparooConfigApplyBackups({
        confirmed: true,
        localBackupOk,
        remoteBackupOk,
        allowLocalBackupOnly: Boolean(request.allowLocalBackupOnly),
      });
      if (!validation.ok) {
        const blocked = new Error(validation.message);
        blocked.requiresLocalBackupOnlyConfirmation = validation.requiresLocalBackupOnlyConfirmation;
        throw blocked;
      }
      await sftpWriteZaparooConfigFile(sftp, remotePaths.zaparooConfig, plan.nextPreview);
    });
    let reloadOk = false;
    let reloadMessage = '';
    try {
      const reload = await zaparooJsonRpc(sanitizeZaparooTarget(), 'settings.reload');
      reloadOk = Boolean(reload.ok);
      reloadMessage = reload.message;
    } catch {
      reloadMessage = zaparooSettingsReloadFailureMessage();
    }
    const verification = await readZaparooConfigDiagnostics(current.sessionId);
    return {
      ok: true,
      path: remotePaths.zaparooConfig,
      plan,
      localBackupPath,
      remoteBackupPath: remoteBackupOk ? plan.remoteBackupPath : undefined,
      remoteBackupOk,
      localBackupOk,
      applied: true,
      reloadAttempted: true,
      reloadOk,
      reloadMessage: reloadOk ? reloadMessage : zaparooSettingsReloadFailureMessage(),
      verification,
      message: reloadOk ? '?? ??? ???? Zaparoo Core reload?? ??????.' : zaparooSettingsReloadFailureMessage(),
    };
  } catch (error) {
    const preview = await zaparooPreviewConfigApply({ sessionId: targetSessionId, mode: request.mode }).catch(() => undefined);
    return {
      ok: false,
      path: remotePaths.zaparooConfig,
      plan: preview?.ok ? preview : undefined,
      remoteBackupOk: false,
      localBackupOk: false,
      applied: false,
      reloadAttempted: false,
      reloadOk: false,
      requiresLocalBackupOnlyConfirmation: Boolean(error?.requiresLocalBackupOnlyConfirmation),
      message: error instanceof Error ? error.message : 'Zaparoo config.toml ??? ??????.',
      error: {
        message: error instanceof Error ? error.message : String(error),
        data: remoteBackupError ? { remoteBackup: remoteBackupError instanceof Error ? remoteBackupError.message : String(remoteBackupError) } : undefined,
      },
    };
  }
}

async function listGameFolders(sessionId, options = {}) {
  // countFiles reads every core folder fully just to count files — skip it for the library scan (the scan reads
  // each folder's files separately anyway). The ROM manager keeps the count by leaving countFiles default.
  const countFiles = options.countFiles !== false;
  return withSessionClient(sessionId, async (client) => {
    const sftp = await sftpClient(client);
    const entries = await sftpReadDir(sftp, remotePaths.games);
    const folders = [];
    const safeOneLevelFolders = (items) => items.filter((item) => {
      const name = String(item.filename || '');
      return item.attrs?.isDirectory?.()
        && name
        && name !== '.'
        && name !== '..'
        && !name.startsWith('.')
        && !/[\\/]/.test(name);
    });
    const gameSubfolders = safeOneLevelFolders(entries).slice(0, 200);
    const gameFolderInfos = await mapWithConcurrency(gameSubfolders, 8, async (entry) => {
      const folderPath = `${remotePaths.games}/${entry.filename}`;
      const children = countFiles ? await sftpReadDir(sftp, folderPath) : [];
      return {
        name: entry.filename,
        path: folderPath,
        fileCount: countFiles ? children.filter((item) => item.attrs?.isFile?.()).length : undefined,
        sizeBytes: entry.attrs?.size,
        modifiedAt: entry.attrs?.mtime ? new Date(entry.attrs.mtime * 1000).toISOString() : undefined,
      };
    });
    folders.push(...gameFolderInfos);
    const arcadeEntries = await sftpReadDir(sftp, remotePaths.arcade);
    if (arcadeEntries.length > 0) {
      const rootAttrs = await sftpStat(sftp, remotePaths.arcade);
      folders.push({
        name: '_Arcade',
        path: remotePaths.arcade,
        fileCount: arcadeEntries.filter((item) => item.attrs?.isFile?.()).length,
        sizeBytes: rootAttrs?.size,
        modifiedAt: rootAttrs?.mtime ? new Date(rootAttrs.mtime * 1000).toISOString() : undefined,
      });
    }
    const arcadeSubfolders = safeOneLevelFolders(arcadeEntries).slice(0, 200);
    const arcadeFolderInfos = await mapWithConcurrency(arcadeSubfolders, 8, async (entry) => {
      const folderPath = `${remotePaths.arcade}/${entry.filename}`;
      const children = countFiles ? await sftpReadDir(sftp, folderPath) : [];
      return {
        name: entry.filename,
        path: folderPath,
        fileCount: countFiles ? children.filter((item) => item.attrs?.isFile?.()).length : undefined,
        sizeBytes: entry.attrs?.size,
        modifiedAt: entry.attrs?.mtime ? new Date(entry.attrs.mtime * 1000).toISOString() : undefined,
      };
    });
    folders.push(...arcadeFolderInfos);
    return {
      ok: true,
      sessionId,
      items: folders,
      readAt: new Date().toISOString(),
      message: 'games 및 _Arcade 1단계 폴더 목록을 읽었습니다. 깊은 ROM 스캔은 수행하지 않았습니다.',
    };
  });
}

function isSafeRemoteGameFolderPath(targetPath) {
  const value = String(targetPath || '');
  if (!value || value.includes('\0') || value.includes('..')) return false;
  return /^\/media\/fat\/games\/[^/\\]+$/i.test(value)
    || /^\/media\/fat\/_Arcade$/i.test(value)
    || /^\/media\/fat\/_Arcade\/[^/\\]+$/i.test(value);
}

function normalizeRemoteGameScanOptions(options = {}) {
  const requestedDepth = Number(options.scanDepth);
  const scanDepth = Number.isFinite(requestedDepth)
    ? Math.min(3, Math.max(1, Math.floor(requestedDepth)))
    : 1;
  const recursive = Boolean(options.recursive);
  const requestedMaxFiles = Number(options.maxFiles);
  const maxFiles = Number.isFinite(requestedMaxFiles)
    ? Math.min(5000, Math.max(1, Math.floor(requestedMaxFiles)))
    : 1000;
  return { scanDepth, recursive, maxFiles };
}

function isSafeRemoteChildName(name) {
  const value = String(name || '');
  return Boolean(value)
    && value !== '.'
    && value !== '..'
    && !value.startsWith('.')
    && !value.includes('\0')
    && !value.includes('..')
    && !/[\\/]/.test(value);
}

async function listRemoteGameFilesFast({ sessionId } = {}) {
  return withSessionClient(sessionId, async (client, session) => {
    // One read-only `find` over the game roots returns every file path in a single round-trip
    // (~2-3s for a full SD card) instead of one SFTP listing per core folder. Frontend filters extensions.
    const command = 'find /media/fat/games /media/fat/_Arcade -maxdepth 8 -type f';
    const result = await execReadOnly(client, 'list-game-files-fast', command, session, { maskOutput: false });
    // `find` exits non-zero if one root is missing (e.g. no _Arcade) but still streams the other root's
    // paths, so treat any stdout as success; only an empty stdout with a non-zero exit is a real failure.
    if (result.exitCode !== 0 && !result.stdout) {
      return {
        ok: false,
        sessionId,
        paths: [],
        readAt: new Date().toISOString(),
        durationMs: result.durationMs,
        message: result.stderr || 'find 명령으로 게임 파일을 읽지 못했습니다.',
        errorCode: 'COMMAND_FAILED',
      };
    }
    const paths = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return { ok: true, sessionId, paths, readAt: new Date().toISOString(), durationMs: result.durationMs };
  });
}

async function listRemoteArcadeCores({ sessionId } = {}) {
  return withSessionClient(sessionId, async (client, session) => {
    // Read each arcade .mra's <rbf> (core/hardware name) in one pass. MiSTer ships busybox grep (no --include),
    // so use find -exec grep. Read-only. Lets the app split the flat _Arcade bucket into per-hardware platforms.
    const command = "find /media/fat/_Arcade -name '*.mra' -exec grep -Hm1 '<rbf' {} +";
    const result = await execReadOnly(client, 'list-arcade-cores', command, session, { maskOutput: false });
    const cores = {};
    if (result.stdout) {
      for (const line of result.stdout.split(/\r?\n/)) {
        const match = line.match(/^(.+?\.mra):\s*<rbf>\s*([^<\s]+)/i);
        if (match) cores[match[1]] = match[2];
      }
    }
    return { ok: result.exitCode === 0 || Object.keys(cores).length > 0, sessionId, cores, readAt: new Date().toISOString(), durationMs: result.durationMs };
  });
}

async function listRemoteGameFolderFiles({ sessionId, folderPath, options }) {
  if (!isSafeRemoteGameFolderPath(folderPath)) {
    return {
      ok: false,
      sessionId,
      items: [],
      readAt: new Date().toISOString(),
      message: '허용된 /media/fat/games/<CORE>, /media/fat/_Arcade, /media/fat/_Arcade/<FOLDER> 폴더만 조회할 수 있습니다.',
      errorCode: 'COMMAND_BLOCKED',
    };
  }
  const scanOptions = normalizeRemoteGameScanOptions(options);
  return withSessionClient(sessionId, async (client) => {
    const sftp = await sftpClient(client);
    const files = [];
    const folders = [{ path: folderPath, depth: 1 }];
    let foldersScanned = 0;
    let failedFolders = 0;
    let excludedFiles = 0;
    let depthLimitedFolders = 0;
    let truncated = false;

    while (folders.length > 0) {
      const current = folders.shift();
      if (!current) break;
      // Stop reading after maxFiles entries instead of transferring an entire huge ROM folder.
      const entries = await sftpReadDirLimited(sftp, current.path, scanOptions.maxFiles);
      foldersScanned += 1;
      if (entries.length === 0) {
        if (current.path !== folderPath) failedFolders += 1;
        continue;
      }
      for (const entry of entries) {
        const name = String(entry.filename || '');
        if (!isSafeRemoteChildName(name)) {
          excludedFiles += 1;
          continue;
        }
        const entryPath = `${current.path}/${name}`;
        if (entry.attrs?.isFile?.()) {
          files.push({
            name,
            path: entryPath,
            sizeBytes: entry.attrs?.size,
            modifiedAt: entry.attrs?.mtime ? new Date(entry.attrs.mtime * 1000).toISOString() : undefined,
          });
          if (files.length >= scanOptions.maxFiles) {
            truncated = true;
            break;
          }
        } else if (entry.attrs?.isDirectory?.()) {
          if (scanOptions.recursive || current.depth < scanOptions.scanDepth) {
            folders.push({ path: entryPath, depth: current.depth + 1 });
          } else {
            depthLimitedFolders += 1;
          }
        }
      }
      if (truncated) break;
    }
    return {
      ok: true,
      sessionId,
      items: files,
      readAt: new Date().toISOString(),
      foldersScanned,
      failedFolders,
      excludedFiles,
      depthLimitedFolders,
      scanDepth: scanOptions.scanDepth,
      recursive: scanOptions.recursive,
      truncated,
      message: `${folderPath}의 ${scanOptions.recursive ? '전체 하위' : `${scanOptions.scanDepth}단계`} 파일 목록을 읽었습니다. 다운로드나 수정은 수행하지 않았습니다.`,
    };
  });
}

async function listScriptFiles(sessionId) {
  return withSessionClient(sessionId, async (client) => {
    const sftp = await sftpClient(client);
    const entries = await sftpReadDir(sftp, remotePaths.scripts);
    const scripts = entries
      .filter((item) => item.attrs?.isFile?.() && item.filename.toLowerCase().endsWith('.sh'))
      .slice(0, 300)
      .map((entry) => ({
        name: entry.filename,
        path: `${remotePaths.scripts}/${entry.filename}`,
        sizeBytes: entry.attrs?.size,
        modifiedAt: entry.attrs?.mtime ? new Date(entry.attrs.mtime * 1000).toISOString() : undefined,
      }));
    return {
      ok: true,
      sessionId,
      items: scripts,
      readAt: new Date().toISOString(),
      message: 'Scripts 폴더의 .sh 파일 목록을 읽었습니다. 실행은 수행하지 않았습니다.',
    };
  });
}

function isSafeScriptPath(targetPath) {
  return /^\/media\/fat\/Scripts\/[^/\\]+\.sh$/i.test(String(targetPath || ''));
}

async function readScriptFile({ sessionId, path: scriptPath }) {
  if (!isSafeScriptPath(scriptPath)) {
    return {
      ok: false,
      sessionId,
      items: { name: '', path: scriptPath, contentPreview: '' },
      readAt: new Date().toISOString(),
      message: '허용된 Scripts 폴더의 .sh 파일만 읽을 수 있습니다.',
      error: 'unsafe-script-path',
    };
  }
  return withSessionClient(sessionId, async (client) => {
    const sftp = await sftpClient(client);
    const attrs = await sftpStat(sftp, scriptPath);
    if (!attrs?.isFile?.()) {
      return {
        ok: false,
        sessionId,
        items: { name: path.posix.basename(scriptPath), path: scriptPath, contentPreview: '' },
        readAt: new Date().toISOString(),
        message: '스크립트 파일을 찾지 못했습니다.',
      };
    }
    const contentPreview = await sftpReadFile(sftp, scriptPath, 64 * 1024);
    return {
      ok: true,
      sessionId,
      items: {
        name: path.posix.basename(scriptPath),
        path: scriptPath,
        sizeBytes: attrs.size,
        modifiedAt: attrs.mtime ? new Date(attrs.mtime * 1000).toISOString() : undefined,
        contentPreview,
      },
      readAt: new Date().toISOString(),
      message: '스크립트를 읽기 전용으로 열었습니다. 실행하지 않았습니다.',
    };
  });
}

// ---------------------------------------------------------------------------
// Script (.sh) file manager — mirrors the INI manager, scoped to /media/fat/Scripts.
// Supports view/edit/save, manual numbered .bak backups, trash/restore/empty, PC export/import, and Run.
// ---------------------------------------------------------------------------
const scriptsBaseDir = remotePaths.scripts; // /media/fat/Scripts
const scriptsBackupRoot = '/media/fat/.hello-mister-backups/scripts';
const scriptsTrashRoot = '/media/fat/.hello-mister-trash/scripts';
const scriptsLogDir = `${remotePaths.scripts}/.hello-mister-logs`;
// Only these hosts are allowed as recommended-script download sources.
const scriptDownloadHosts = new Set(['raw.githubusercontent.com', 'gist.githubusercontent.com', 'github.com', 'objects.githubusercontent.com']);

function createScriptFsError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sanitizeScriptFsMessage(error) {
  return String(error?.message || error || '스크립트 파일 작업에 실패했습니다.').replace(/password|privateKey|passphrase|token/gi, '[secret]');
}

function normalizeScriptRemotePath(targetPath) {
  const raw = String(targetPath || '').replace(/\\/g, '/');
  const parts = [];
  for (const segment of raw.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return `/${parts.join('/')}`;
}

function assertAllowedScriptFileName(fileName) {
  const name = String(fileName || '').trim();
  if (!/^[^/\\]+\.sh$/i.test(name) || name.includes('..')) {
    throw createScriptFsError('SCRIPT_FS_INVALID_FILENAME', '허용되지 않는 스크립트 파일명입니다(.sh 파일만 가능).');
  }
  return name;
}

function scriptRemotePath(fileName) {
  return `${scriptsBaseDir}/${assertAllowedScriptFileName(fileName)}`;
}

function assertScriptRootWritePath(targetPath) {
  const normalized = normalizeScriptRemotePath(targetPath);
  if (path.posix.dirname(normalized) !== scriptsBaseDir) {
    throw createScriptFsError('SCRIPT_FS_PATH_BLOCKED', 'Scripts 폴더의 .sh 파일에만 쓸 수 있습니다.');
  }
  assertAllowedScriptFileName(path.posix.basename(normalized));
  return normalized;
}

// Backups live at {backupRoot}/{fileName}/{fileName} - NN.bak; trashed items at {trashRoot}/{stamp}-{...}.
function scriptBackupFileName(fileName, number) {
  return `${fileName} - ${String(number).padStart(2, '0')}.bak`;
}

function parseScriptBackupNumber(fileName, backupFileName) {
  const escaped = String(fileName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(backupFileName || '').match(new RegExp(`^${escaped} - ([0-9]{1,4})\\.bak$`, 'i'));
  return match ? Number(match[1]) : undefined;
}

function scriptTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-');
}

function parseScriptTrashName(trashFileName) {
  const stripped = String(trashFileName || '').match(/^[0-9]{8}-[0-9]{6}-(.+)$/i);
  if (!stripped) throw createScriptFsError('SCRIPT_FS_TRASH_PATH_BLOCKED', '안전한 스크립트 휴지통 형식이 아닙니다.');
  const rest = stripped[1];
  const backup = rest.match(/^(.+) - [0-9]{1,4}\.bak$/i);
  if (backup) return { kind: 'backup', originalFileName: assertAllowedScriptFileName(backup[1]), trashedName: rest };
  return { kind: 'script', originalFileName: assertAllowedScriptFileName(rest), trashedName: rest };
}

function assertScriptTrashWritePath(trashPath) {
  const normalized = normalizeScriptRemotePath(trashPath);
  if (path.posix.dirname(normalized) !== scriptsTrashRoot) {
    throw createScriptFsError('SCRIPT_FS_TRASH_PATH_BLOCKED', '스크립트 휴지통 경로가 아닙니다.');
  }
  parseScriptTrashName(path.posix.basename(normalized));
  return normalized;
}

function assertScriptBackupWritePath(fileName, backupPath) {
  const normalizedFile = assertAllowedScriptFileName(fileName);
  const normalized = normalizeScriptRemotePath(backupPath);
  const expectedPrefix = `${scriptsBackupRoot}/${normalizedFile}/`;
  if (!normalized.startsWith(expectedPrefix) || parseScriptBackupNumber(normalizedFile, path.posix.basename(normalized)) === undefined) {
    throw createScriptFsError('SCRIPT_FS_BACKUP_PATH_BLOCKED', '선택한 백업 경로가 해당 스크립트의 백업 폴더 밖입니다.');
  }
  return normalized;
}

async function sftpMkdirRecursiveScripts(sftp, targetPath) {
  const normalized = normalizeScriptRemotePath(targetPath);
  if (!(normalized === scriptsBaseDir || normalized === scriptsBackupRoot || normalized === scriptsTrashRoot
    || normalized.startsWith(`${scriptsBackupRoot}/`) || normalized.startsWith(`${scriptsTrashRoot}/`))) {
    throw createScriptFsError('SCRIPT_FS_MKDIR_BLOCKED', '스크립트 백업/휴지통 폴더 밖에는 폴더를 만들 수 없습니다.');
  }
  const parts = normalized.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = `${current}/${part}`;
    if (current === '/media' || current === '/media/fat') continue;
    if (!(await sftpLstat(sftp, current))) await sftpMkdirOne(sftp, current);
  }
  return normalized;
}

function scriptBackupEntryFromRemote(fileName, entry) {
  return {
    path: `${scriptsBackupRoot}/${fileName}/${entry.filename}`,
    fileName: entry.filename,
    sourceFileName: fileName,
    sizeBytes: Number(entry.attrs?.size || 0),
    createdAt: entry.attrs?.mtime ? new Date(Number(entry.attrs.mtime) * 1000).toISOString() : undefined,
  };
}

async function nextScriptBackupNumber(sftp, fileName) {
  const normalizedFile = assertAllowedScriptFileName(fileName);
  const backupDir = `${scriptsBackupRoot}/${normalizedFile}`;
  if (!(await sftpLstat(sftp, backupDir))) return 1;
  const numbers = (await sftpReadDir(sftp, backupDir))
    .map((entry) => parseScriptBackupNumber(normalizedFile, entry.filename))
    .filter((number) => number !== undefined);
  return (numbers.length ? Math.max(...numbers) : 0) + 1;
}

async function listScriptBackupsForSftp(sftp, fileName) {
  const normalizedFile = assertAllowedScriptFileName(fileName);
  const backupDir = `${scriptsBackupRoot}/${normalizedFile}`;
  if (!(await sftpLstat(sftp, backupDir))) return [];
  return (await sftpReadDir(sftp, backupDir))
    .map((entry) => ({ entry, number: parseScriptBackupNumber(normalizedFile, entry.filename) }))
    .filter((item) => item.number !== undefined)
    .sort((a, b) => b.number - a.number)
    .map((item) => scriptBackupEntryFromRemote(normalizedFile, item.entry));
}

async function backupScriptFile(sftp, fileName, content) {
  const normalizedFile = assertAllowedScriptFileName(fileName);
  const backupDir = `${scriptsBackupRoot}/${normalizedFile}`;
  await sftpMkdirRecursiveScripts(sftp, backupDir);
  const number = await nextScriptBackupNumber(sftp, normalizedFile);
  const backupPath = assertScriptBackupWritePath(normalizedFile, `${backupDir}/${scriptBackupFileName(normalizedFile, number)}`);
  await sftpWriteUtf8File(sftp, backupPath, content);
  return backupPath;
}

async function writeLocalScriptBackup(profileId, fileName, content) {
  const localPath = appDataPath('backups', 'scripts', String(profileId || 'unknown'), fileName, `${scriptTimestamp()}.sh`);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, content, 'utf8');
  return localPath;
}

function scriptFileEntryFromRemote(entry, backupCount, profile) {
  const fileName = entry.filename;
  return {
    listId: `remote:${fileName}`,
    fileName,
    path: `${scriptsBaseDir}/${fileName}`,
    source: 'remote',
    sizeBytes: Number(entry.attrs?.size || 0),
    modifiedAt: entry.attrs?.mtime ? new Date(Number(entry.attrs.mtime) * 1000).toISOString() : undefined,
    backupCount,
    targetProfileId: profile?.id,
    targetAlias: profile?.alias,
    targetHost: profile?.ipAddress,
  };
}

function scriptBackupOnlyFile(fileName, backupCount, profile) {
  return {
    listId: `backup-only:${fileName}`,
    fileName,
    path: '',
    source: 'missing-remote',
    sizeBytes: 0,
    backupCount,
    targetProfileId: profile?.id,
    targetAlias: profile?.alias,
    targetHost: profile?.ipAddress,
  };
}

function scriptTrashEntryFromRemote(entry) {
  const fileName = entry.filename;
  let kind = 'script';
  let originalFileName = fileName.replace(/^[0-9]{8}-[0-9]{6}-/, '');
  try {
    const parsed = parseScriptTrashName(fileName);
    kind = parsed.kind;
    originalFileName = parsed.originalFileName;
  } catch { /* keep fallback */ }
  return {
    path: `${scriptsTrashRoot}/${fileName}`,
    fileName,
    originalFileName,
    kind,
    sizeBytes: Number(entry.attrs?.size || 0),
    movedAt: entry.attrs?.mtime ? new Date(Number(entry.attrs.mtime) * 1000).toISOString() : undefined,
  };
}

async function scriptFsCheckCapability(request = {}) {
  const checkedAt = new Date().toISOString();
  if (!request?.profileId && !activeMisterProfile?.profileId) {
    return { ok: false, state: 'disconnected', canRead: false, canWrite: false, checkedAt, message: 'MiSTer 연결 필요', errorCode: 'SCRIPT_FS_NO_ACTIVE_PROFILE' };
  }
  try {
    return await withRomFsClient(request.profileId, async ({ profile, sftp }) => {
      await sftpReadDir(sftp, scriptsBaseDir);
      const checkPath = `${scriptsBaseDir}/.hello-mister-write-check-${Date.now()}.sh`;
      try {
        await sftpWriteUtf8File(sftp, checkPath, '# hello-mister write check\n');
        await sftpUnlink(sftp, checkPath).catch(() => undefined);
        return { ok: true, profileId: profile.id, state: 'connectedWritable', canRead: true, canWrite: true, checkedAt, message: '스크립트 읽기/쓰기 가능' };
      } catch {
        return { ok: true, profileId: profile.id, state: 'connectedReadOnly', canRead: true, canWrite: false, checkedAt, message: '스크립트 읽기만 가능' };
      }
    });
  } catch (error) {
    return { ok: false, state: 'writeCheckFailed', canRead: false, canWrite: false, checkedAt, message: sanitizeScriptFsMessage(error), errorCode: error.code || 'SCRIPT_FS_WRITE_CAPABILITY_FAILED' };
  }
}

async function scriptFsListRemote(request = {}) {
  try {
    return await withRomFsClient(request.profileId, async ({ profile, sftp }) => {
      const rawEntries = await sftpReadDir(sftp, scriptsBaseDir);
      const files = [];
      const presentNames = new Set();
      for (const entry of rawEntries) {
        if (!entry.attrs?.isFile?.() || !/\.sh$/i.test(entry.filename)) continue;
        const backupCount = (await listScriptBackupsForSftp(sftp, entry.filename)).length;
        files.push(scriptFileEntryFromRemote(entry, backupCount, profile));
        presentNames.add(entry.filename.toLowerCase());
      }
      // Scripts that only have backups (original deleted) so they can still be reopened/restored.
      if (await sftpLstat(sftp, scriptsBackupRoot)) {
        for (const dir of (await sftpReadDir(sftp, scriptsBackupRoot)).filter((entry) => entry.attrs?.isDirectory?.())) {
          let scriptName;
          try { scriptName = assertAllowedScriptFileName(dir.filename); } catch { continue; }
          if (presentNames.has(scriptName.toLowerCase())) continue;
          const backupCount = (await listScriptBackupsForSftp(sftp, scriptName)).length;
          if (backupCount === 0) continue;
          files.push(scriptBackupOnlyFile(scriptName, backupCount, profile));
          presentNames.add(scriptName.toLowerCase());
        }
      }
      files.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true }));
      return { ok: true, profileId: profile.id, files, cachedAt: new Date().toISOString(), message: `${files.length}개 스크립트를 읽었습니다.` };
    });
  } catch (error) {
    return { ok: false, files: [], cachedAt: new Date().toISOString(), message: sanitizeScriptFsMessage(error), errorCode: error.code || 'SCRIPT_FS_LIST_FAILED' };
  }
}

function looksBinaryScriptBuffer(buffer) {
  const length = Math.min(buffer.length, 8000);
  if (length === 0) return false;
  if (buffer.length >= 4 && buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) return true; // ELF
  let suspicious = 0;
  for (let index = 0; index < length; index += 1) {
    const byte = buffer[index];
    if (byte === 0) return true;
    if (byte < 9 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / length > 0.1;
}

async function scriptFsReadRemote(request = {}) {
  const fileName = (() => { try { return assertAllowedScriptFileName(request.fileName); } catch { return String(request.fileName || ''); } })();
  try {
    return await withRomFsClient(request.profileId, async ({ profile, sftp }) => {
      const targetPath = scriptRemotePath(fileName);
      const attrs = await sftpLstat(sftp, targetPath);
      if (!attrs?.isFile?.()) throw createScriptFsError('SCRIPT_FS_NOT_FOUND', '선택한 스크립트를 찾지 못했습니다.');
      const buffer = await sftpReadBuffer(sftp, targetPath, 1024 * 1024);
      const binary = looksBinaryScriptBuffer(buffer);
      return {
        ok: true,
        profileId: profile.id,
        fileName,
        path: targetPath,
        binary,
        content: binary ? '' : buffer.toString('utf8'),
        sizeBytes: attrs.size || buffer.length,
        readAt: new Date().toISOString(),
        message: binary ? '바이너리 파일입니다(편집/미리보기 불가). 실행·백업·내보내기만 가능합니다.' : '스크립트를 읽었습니다.',
      };
    });
  } catch (error) {
    return { ok: false, fileName, path: '', content: '', binary: false, sizeBytes: 0, readAt: new Date().toISOString(), message: sanitizeScriptFsMessage(error), errorCode: error.code || 'SCRIPT_FS_READ_FAILED' };
  }
}

async function scriptFsWriteRemote(request = {}) {
  const fileName = (() => { try { return assertAllowedScriptFileName(request.fileName); } catch { return String(request.fileName || ''); } })();
  if (!request.confirmed) return { ok: false, fileName, message: '저장 전 확인이 필요합니다.', errorCode: 'SCRIPT_FS_CONFIRMATION_REQUIRED' };
  try {
    return await withRomFsClient(request.profileId, async ({ profile, sftp }) => {
      const targetPath = scriptRemotePath(fileName);
      const attrs = await sftpLstat(sftp, targetPath);
      const currentContent = attrs?.isFile?.() ? await sftpReadFile(sftp, targetPath, 1024 * 1024) : '';
      // No automatic remote backup on save (manual backups only); keep a silent local PC copy.
      await writeLocalScriptBackup(profile.id, fileName, currentContent).catch(() => undefined);
      await sftpWriteUtf8File(sftp, assertScriptRootWritePath(targetPath), String(request.content ?? ''));
      const verification = await sftpReadFile(sftp, targetPath, 1024 * 1024);
      if (verification !== String(request.content ?? '')) throw createScriptFsError('SCRIPT_FS_VERIFY_FAILED', '저장 후 검증에 실패했습니다.');
      const backups = await listScriptBackupsForSftp(sftp, fileName);
      return { ok: true, profileId: profile.id, fileName, path: targetPath, backups, message: '스크립트를 저장하고 검증했습니다. (자동 백업 없음 — 필요하면 수동 백업)' };
    });
  } catch (error) {
    return { ok: false, fileName, message: sanitizeScriptFsMessage(error), errorCode: error.code || 'SCRIPT_FS_WRITE_FAILED' };
  }
}

async function scriptFsCreateBackup(request = {}) {
  const fileName = (() => { try { return assertAllowedScriptFileName(request.fileName); } catch { return String(request.fileName || ''); } })();
  try {
    return await withRomFsClient(request.profileId, async ({ profile, sftp }) => {
      const targetPath = scriptRemotePath(fileName);
      const attrs = await sftpLstat(sftp, targetPath);
      if (!attrs?.isFile?.()) throw createScriptFsError('SCRIPT_FS_NOT_FOUND', '백업할 스크립트를 찾지 못했습니다.');
      const content = await sftpReadFile(sftp, targetPath, 1024 * 1024);
      const backupPath = await backupScriptFile(sftp, fileName, content);
      await writeLocalScriptBackup(profile.id, fileName, content).catch(() => undefined);
      const backups = await listScriptBackupsForSftp(sftp, fileName);
      return { ok: true, profileId: profile.id, fileName, path: backupPath, backups, message: `백업을 만들었습니다: ${path.posix.basename(backupPath)}` };
    });
  } catch (error) {
    return { ok: false, fileName, backups: [], message: sanitizeScriptFsMessage(error), errorCode: error.code || 'SCRIPT_FS_BACKUP_CREATE_FAILED' };
  }
}

async function scriptFsListBackups(request = {}) {
  const fileName = (() => { try { return assertAllowedScriptFileName(request.fileName); } catch { return String(request.fileName || ''); } })();
  try {
    return await withRomFsClient(request.profileId, async ({ profile, sftp }) => {
      const backups = await listScriptBackupsForSftp(sftp, fileName);
      return { ok: true, profileId: profile.id, fileName, backups, message: `${backups.length}개 백업을 읽었습니다.` };
    });
  } catch (error) {
    return { ok: false, fileName, backups: [], message: sanitizeScriptFsMessage(error), errorCode: error.code || 'SCRIPT_FS_BACKUP_LIST_FAILED' };
  }
}

async function scriptFsPreviewBackup(request = {}) {
  const fileName = (() => { try { return assertAllowedScriptFileName(request.fileName); } catch { return String(request.fileName || ''); } })();
  try {
    return await withRomFsClient(request.profileId, async ({ profile, sftp }) => {
      const backupPath = assertScriptBackupWritePath(fileName, request.backupPath);
      const attrs = await sftpLstat(sftp, backupPath);
      if (!attrs?.isFile?.()) throw createScriptFsError('SCRIPT_FS_BACKUP_NOT_FOUND', '백업 파일을 찾지 못했습니다.');
      const content = await sftpReadFile(sftp, backupPath, 1024 * 1024);
      return { ok: true, profileId: profile.id, fileName, backupPath, content, sizeBytes: attrs.size || Buffer.byteLength(content), readAt: new Date().toISOString(), message: '백업 미리보기를 읽었습니다.' };
    });
  } catch (error) {
    return { ok: false, fileName, backupPath: String(request.backupPath || ''), content: '', sizeBytes: 0, readAt: new Date().toISOString(), message: sanitizeScriptFsMessage(error), errorCode: error.code || 'SCRIPT_FS_BACKUP_PREVIEW_FAILED' };
  }
}

async function scriptFsRestoreBackup(request = {}) {
  const fileName = (() => { try { return assertAllowedScriptFileName(request.fileName); } catch { return String(request.fileName || ''); } })();
  if (!request.confirmed) return { ok: false, fileName, message: '백업 불러오기 전 확인이 필요합니다.', errorCode: 'SCRIPT_FS_CONFIRMATION_REQUIRED' };
  try {
    return await withRomFsClient(request.profileId, async ({ profile, sftp }) => {
      const backupPath = assertScriptBackupWritePath(fileName, request.backupPath);
      const backupContent = await sftpReadFile(sftp, backupPath, 1024 * 1024);
      const targetPath = scriptRemotePath(fileName);
      const currentAttrs = await sftpLstat(sftp, targetPath);
      let currentBackupPath;
      if (currentAttrs?.isFile?.()) {
        currentBackupPath = await backupScriptFile(sftp, fileName, await sftpReadFile(sftp, targetPath, 1024 * 1024));
      }
      await sftpWriteUtf8File(sftp, assertScriptRootWritePath(targetPath), backupContent);
      const backups = await listScriptBackupsForSftp(sftp, fileName);
      return { ok: true, profileId: profile.id, fileName, path: targetPath, backupPath: currentBackupPath, backups, message: currentBackupPath ? '선택한 백업을 불러왔습니다. 기존 파일은 먼저 백업했습니다.' : '선택한 백업을 원본 스크립트로 복원했습니다.' };
    });
  } catch (error) {
    return { ok: false, fileName, message: sanitizeScriptFsMessage(error), errorCode: error.code || 'SCRIPT_FS_RESTORE_FAILED' };
  }
}

async function scriptFsDeleteBackup(request = {}) {
  const fileName = (() => { try { return assertAllowedScriptFileName(request.fileName); } catch { return String(request.fileName || ''); } })();
  if (!request.confirmed) return { ok: false, fileName, message: '백업 삭제 전 확인이 필요합니다.', errorCode: 'SCRIPT_FS_CONFIRMATION_REQUIRED' };
  try {
    return await withRomFsClient(request.profileId, async ({ profile, sftp }) => {
      const backupPath = assertScriptBackupWritePath(fileName, request.backupPath);
      const attrs = await sftpLstat(sftp, backupPath);
      if (!attrs?.isFile?.()) throw createScriptFsError('SCRIPT_FS_BACKUP_NOT_FOUND', '삭제할 백업을 찾지 못했습니다.');
      await sftpMkdirRecursiveScripts(sftp, scriptsTrashRoot);
      const trashPath = assertScriptTrashWritePath(`${scriptsTrashRoot}/${scriptTimestamp()}-${path.posix.basename(backupPath)}`);
      await sftpRename(sftp, backupPath, trashPath);
      const backups = await listScriptBackupsForSftp(sftp, fileName);
      return { ok: true, profileId: profile.id, fileName, path: trashPath, backups, message: '스크립트 백업을 휴지통으로 이동했습니다.' };
    });
  } catch (error) {
    return { ok: false, fileName, message: sanitizeScriptFsMessage(error), errorCode: error.code || 'SCRIPT_FS_BACKUP_DELETE_FAILED' };
  }
}

async function scriptFsTrash(request = {}) {
  const fileName = (() => { try { return assertAllowedScriptFileName(request.fileName); } catch { return String(request.fileName || ''); } })();
  if (!request.confirmed) return { ok: false, fileName, message: '삭제 전 확인이 필요합니다.', errorCode: 'SCRIPT_FS_CONFIRMATION_REQUIRED' };
  try {
    return await withRomFsClient(request.profileId, async ({ profile, sftp }) => {
      const sourcePath = scriptRemotePath(fileName);
      const attrs = await sftpLstat(sftp, sourcePath);
      if (!attrs?.isFile?.()) throw createScriptFsError('SCRIPT_FS_NOT_FOUND', '휴지통으로 옮길 스크립트를 찾지 못했습니다.');
      await sftpMkdirRecursiveScripts(sftp, scriptsTrashRoot);
      const trashPath = assertScriptTrashWritePath(`${scriptsTrashRoot}/${scriptTimestamp()}-${fileName}`);
      await sftpRename(sftp, sourcePath, trashPath);
      return { ok: true, profileId: profile.id, fileName, path: trashPath, message: '스크립트를 휴지통으로 이동했습니다.' };
    });
  } catch (error) {
    return { ok: false, fileName, message: sanitizeScriptFsMessage(error), errorCode: error.code || 'SCRIPT_FS_TRASH_FAILED' };
  }
}

async function scriptFsListTrash(request = {}) {
  try {
    return await withRomFsClient(request.profileId, async ({ profile, sftp }) => {
      if (!(await sftpLstat(sftp, scriptsTrashRoot))) return { ok: true, profileId: profile.id, entries: [], message: '휴지통이 비어 있습니다.' };
      const entries = (await sftpReadDir(sftp, scriptsTrashRoot))
        .filter((entry) => /^[0-9]{8}-[0-9]{6}-.+\.(sh|bak)$/i.test(entry.filename))
        .map(scriptTrashEntryFromRemote)
        .sort((a, b) => b.fileName.localeCompare(a.fileName));
      return { ok: true, profileId: profile.id, entries, message: `${entries.length}개 휴지통 항목을 읽었습니다.` };
    });
  } catch (error) {
    return { ok: false, entries: [], message: sanitizeScriptFsMessage(error), errorCode: error.code || 'SCRIPT_FS_TRASH_LIST_FAILED' };
  }
}

async function scriptFsRestoreTrashed(request = {}) {
  const targetFileName = (() => { try { return assertAllowedScriptFileName(request.targetFileName); } catch { return String(request.targetFileName || ''); } })();
  if (!request.confirmed) return { ok: false, fileName: targetFileName, message: '휴지통 복구 전 확인이 필요합니다.', errorCode: 'SCRIPT_FS_CONFIRMATION_REQUIRED' };
  try {
    return await withRomFsClient(request.profileId, async ({ profile, sftp }) => {
      const trashPath = assertScriptTrashWritePath(request.trashPath);
      const trashAttrs = await sftpLstat(sftp, trashPath);
      if (!trashAttrs?.isFile?.()) throw createScriptFsError('SCRIPT_FS_TRASH_NOT_FOUND', '복구할 휴지통 항목을 찾지 못했습니다.');
      const parsed = parseScriptTrashName(path.posix.basename(trashPath));
      if (parsed.kind === 'backup') {
        const originalPath = scriptRemotePath(parsed.originalFileName);
        if (!(await sftpLstat(sftp, originalPath))?.isFile?.()) {
          await sftpRename(sftp, trashPath, assertScriptRootWritePath(originalPath));
          return { ok: true, profileId: profile.id, fileName: parsed.originalFileName, path: originalPath, message: `원본 스크립트가 없어 백업을 ${parsed.originalFileName} 원본으로 복원했습니다.` };
        }
        const backupDir = `${scriptsBackupRoot}/${parsed.originalFileName}`;
        await sftpMkdirRecursiveScripts(sftp, backupDir);
        const number = await nextScriptBackupNumber(sftp, parsed.originalFileName);
        const restorePath = assertScriptBackupWritePath(parsed.originalFileName, `${backupDir}/${scriptBackupFileName(parsed.originalFileName, number)}`);
        await sftpRename(sftp, trashPath, restorePath);
        return { ok: true, profileId: profile.id, fileName: parsed.originalFileName, path: restorePath, message: `백업을 복원했습니다: ${path.posix.basename(restorePath)}` };
      }
      const targetPath = scriptRemotePath(targetFileName);
      const existing = await sftpLstat(sftp, targetPath);
      let backupPath;
      if (existing?.isFile?.()) backupPath = await backupScriptFile(sftp, targetFileName, await sftpReadFile(sftp, targetPath, 1024 * 1024));
      await sftpRename(sftp, trashPath, assertScriptRootWritePath(targetPath));
      return { ok: true, profileId: profile.id, fileName: targetFileName, path: targetPath, backupPath, message: backupPath ? '휴지통 스크립트를 복구했습니다. 기존 파일은 먼저 백업했습니다.' : '휴지통 스크립트를 복구했습니다.' };
    });
  } catch (error) {
    return { ok: false, fileName: targetFileName, message: sanitizeScriptFsMessage(error), errorCode: error.code || 'SCRIPT_FS_TRASH_RESTORE_FAILED' };
  }
}

async function scriptFsDeleteTrashed(request = {}) {
  if (!request.confirmed) return { ok: false, message: '휴지통 영구 삭제 전 확인이 필요합니다.', errorCode: 'SCRIPT_FS_CONFIRMATION_REQUIRED' };
  try {
    return await withRomFsClient(request.profileId, async ({ profile, sftp }) => {
      const trashPath = assertScriptTrashWritePath(request.trashPath);
      const attrs = await sftpLstat(sftp, trashPath);
      if (!attrs?.isFile?.()) throw createScriptFsError('SCRIPT_FS_TRASH_NOT_FOUND', '영구 삭제할 휴지통 항목을 찾지 못했습니다.');
      await sftpUnlink(sftp, trashPath);
      return { ok: true, profileId: profile.id, path: trashPath, message: '휴지통 항목을 영구 삭제했습니다.' };
    });
  } catch (error) {
    return { ok: false, message: sanitizeScriptFsMessage(error), errorCode: error.code || 'SCRIPT_FS_TRASH_DELETE_FAILED' };
  }
}

async function scriptFsEmptyTrash(request = {}) {
  if (!request.confirmed) return { ok: false, message: '휴지통 비우기 전 확인이 필요합니다.', errorCode: 'SCRIPT_FS_CONFIRMATION_REQUIRED' };
  try {
    return await withRomFsClient(request.profileId, async ({ profile, sftp }) => {
      if (!(await sftpLstat(sftp, scriptsTrashRoot))) return { ok: true, profileId: profile.id, deletedCount: 0, message: '휴지통이 이미 비어 있습니다.' };
      const entries = (await sftpReadDir(sftp, scriptsTrashRoot)).filter((entry) => /^[0-9]{8}-[0-9]{6}-.+\.(sh|bak)$/i.test(entry.filename));
      let deletedCount = 0;
      for (const entry of entries) {
        await sftpUnlink(sftp, assertScriptTrashWritePath(`${scriptsTrashRoot}/${entry.filename}`));
        deletedCount += 1;
      }
      return { ok: true, profileId: profile.id, deletedCount, message: `휴지통에서 ${deletedCount}개 항목을 영구 삭제했습니다.` };
    });
  } catch (error) {
    return { ok: false, message: sanitizeScriptFsMessage(error), errorCode: error.code || 'SCRIPT_FS_TRASH_EMPTY_FAILED' };
  }
}

async function scriptFsExportLocal(request = {}) {
  const fileName = (() => { try { return assertAllowedScriptFileName(request.fileName); } catch { return String(request.fileName || ''); } })();
  const read = await scriptFsReadRemote({ profileId: request.profileId, fileName });
  if (!read.ok) return { ok: false, fileName, message: read.message, errorCode: read.errorCode };
  const result = await dialog.showSaveDialog({ title: '스크립트를 PC에 저장', defaultPath: fileName, filters: [{ name: 'Shell script', extensions: ['sh'] }] });
  if (result.canceled || !result.filePath) return { ok: false, fileName, message: '스크립트 내보내기가 취소되었습니다.', errorCode: 'SCRIPT_FS_EXPORT_CANCELLED' };
  await fs.writeFile(result.filePath, read.content, 'utf8');
  return { ok: true, fileName, path: result.filePath, message: `스크립트를 PC에 저장했습니다: ${result.filePath}` };
}

async function scriptFsImportLocal(request = {}) {
  const result = await dialog.showOpenDialog({ title: 'PC 스크립트 가져오기', properties: ['openFile'], filters: [{ name: 'Shell script', extensions: ['sh'] }] });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, message: '스크립트 가져오기가 취소되었습니다.', errorCode: 'SCRIPT_FS_IMPORT_CANCELLED' };
  const localPath = result.filePaths[0];
  let fileName;
  try { fileName = assertAllowedScriptFileName(path.basename(localPath)); } catch { return { ok: false, message: '가져올 수 없는 스크립트 파일명입니다(.sh).', errorCode: 'SCRIPT_FS_INVALID_LOCAL_FILENAME' }; }
  const content = await fs.readFile(localPath, 'utf8');
  if (!request.confirmed) return { ok: false, fileName, message: '가져오기 저장 전 확인이 필요합니다.', errorCode: 'SCRIPT_FS_CONFIRMATION_REQUIRED' };
  try {
    return await withRomFsClient(request.profileId, async ({ profile, sftp }) => {
      const targetPath = scriptRemotePath(request.targetFileName ? assertAllowedScriptFileName(request.targetFileName) : fileName);
      await sftpWriteUtf8File(sftp, assertScriptRootWritePath(targetPath), content);
      const backups = await listScriptBackupsForSftp(sftp, path.posix.basename(targetPath));
      return { ok: true, profileId: profile.id, fileName: path.posix.basename(targetPath), path: targetPath, backups, message: `PC 스크립트를 ${path.posix.basename(targetPath)}로 가져왔습니다.` };
    });
  } catch (error) {
    return { ok: false, fileName, message: sanitizeScriptFsMessage(error), errorCode: error.code || 'SCRIPT_FS_IMPORT_FAILED' };
  }
}

async function scriptFsRun(request = {}, event) {
  const runId = String(request.runId || `run-${Date.now()}`);
  let fileName;
  try { fileName = assertAllowedScriptFileName(request.fileName); } catch (error) { return { ok: false, runId, message: sanitizeScriptFsMessage(error), errorCode: 'SCRIPT_FS_INVALID_FILENAME' }; }
  if (!request.confirmed) return { ok: false, runId, message: '스크립트 실행 전 확인이 필요합니다.', errorCode: 'SCRIPT_FS_CONFIRMATION_REQUIRED' };
  const send = (channel, payload) => { try { event?.sender?.send(channel, payload); } catch { /* renderer gone */ } };
  const quote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
  if (request.mode === 'background') {
    // Detach with setsid so the script keeps running on the MiSTer even if this app disconnects; output goes to a
    // log file that can be re-read later. Good for long jobs like update_all.sh.
    try {
      return await withRomFsClient(request.profileId, async ({ profile, client, sftp }) => {
        const scriptPath = scriptRemotePath(fileName);
        if (!(await sftpLstat(sftp, scriptPath))?.isFile?.()) throw createScriptFsError('SCRIPT_FS_NOT_FOUND', '실행할 스크립트를 찾지 못했습니다.');
        const logPath = `${scriptsLogDir}/${fileName}-${scriptTimestamp()}.log`;
        const command = `mkdir -p ${quote(scriptsLogDir)}; chmod +x ${quote(scriptPath)} 2>/dev/null; setsid ${quote(scriptPath)} < /dev/null > ${quote(logPath)} 2>&1 & echo BG_OK`;
        return await new Promise((resolve) => {
          client.exec(command, (error, stream) => {
            if (error) { resolve({ ok: false, runId, message: sanitizeScriptFsMessage(error), errorCode: 'SCRIPT_FS_RUN_FAILED' }); return; }
            let out = '';
            const collect = (buffer) => { out += buffer.toString('utf8'); };
            stream.on('data', collect);
            if (stream.stderr) stream.stderr.on('data', collect);
            stream.on('close', () => {
              const ok = out.includes('BG_OK');
              resolve({ ok, runId, profileId: profile.id, background: true, logPath, message: ok ? `백그라운드로 실행을 시작했습니다. 연결이 끊겨도 미스터에서 계속됩니다.` : `백그라운드 실행 시작을 확인하지 못했습니다: ${out.trim()}` });
            });
          });
        });
      });
    } catch (error) {
      return { ok: false, runId, message: sanitizeScriptFsMessage(error), errorCode: error.code || 'SCRIPT_FS_RUN_FAILED' };
    }
  }
  try {
    return await withRomFsClient(request.profileId, async ({ profile, client, sftp }) => {
      const scriptPath = scriptRemotePath(fileName);
      if (!(await sftpLstat(sftp, scriptPath))?.isFile?.()) throw createScriptFsError('SCRIPT_FS_NOT_FOUND', '실행할 스크립트를 찾지 못했습니다.');
      send('scriptFs:run:chunk', { runId, text: `$ ${scriptPath}\n` });
      // Run via the script's own shebang (chmod +x first so non-executable scripts still run). stderr is merged
      // into stdout and stdin is fed from /dev/null so the command can't hang waiting for input. No pty: MiSTer's
      // dropbear is unreliable allocating one for exec, which left runs hung with no output. The read-only command
      // guard is intentionally bypassed here because the user explicitly chose to run this script.
      const quoted = `'${scriptPath.replace(/'/g, "'\\''")}'`;
      const command = `chmod +x ${quoted} 2>/dev/null; ${quoted} < /dev/null 2>&1`;
      return await new Promise((resolve) => {
        client.exec(command, (error, stream) => {
          if (error) {
            send('scriptFs:run:done', { runId, exitCode: null, ok: false });
            resolve({ ok: false, runId, message: sanitizeScriptFsMessage(error), errorCode: 'SCRIPT_FS_RUN_FAILED' });
            return;
          }
          const onChunk = (buffer) => send('scriptFs:run:chunk', { runId, text: buffer.toString('utf8') });
          stream.on('data', onChunk);
          if (stream.stderr) stream.stderr.on('data', onChunk);
          stream.on('close', (code) => {
            const exitCode = typeof code === 'number' ? code : null;
            send('scriptFs:run:done', { runId, exitCode, ok: exitCode === 0 });
            resolve({ ok: exitCode === 0, runId, profileId: profile.id, exitCode, message: `스크립트 실행 종료 (코드 ${exitCode ?? '?'})` });
          });
        });
      });
    });
  } catch (error) {
    send('scriptFs:run:done', { runId, exitCode: null, ok: false });
    return { ok: false, runId, message: sanitizeScriptFsMessage(error), errorCode: error.code || 'SCRIPT_FS_RUN_FAILED' };
  }
}

async function scriptFsCopyToDevice(request = {}) {
  const fileName = (() => { try { return assertAllowedScriptFileName(request.fileName); } catch { return String(request.fileName || ''); } })();
  const targetProfileId = String(request.targetProfileId || '');
  if (!targetProfileId) return { ok: false, fileName, message: '대상 MiSTer를 선택하세요.', errorCode: 'SCRIPT_FS_NO_TARGET' };
  if (targetProfileId === String(request.profileId || '')) return { ok: false, fileName, message: '같은 MiSTer로는 전송할 수 없습니다.', errorCode: 'SCRIPT_FS_SAME_TARGET' };
  if (!request.confirmed) return { ok: false, fileName, message: '전송 전 확인이 필요합니다.', errorCode: 'SCRIPT_FS_CONFIRMATION_REQUIRED' };
  try {
    const content = await withRomFsClient(request.profileId, async ({ sftp }) => {
      const sourcePath = scriptRemotePath(fileName);
      if (!(await sftpLstat(sftp, sourcePath))?.isFile?.()) throw createScriptFsError('SCRIPT_FS_NOT_FOUND', '전송할 스크립트를 찾지 못했습니다.');
      return await sftpReadBuffer(sftp, sourcePath, 4 * 1024 * 1024);
    });
    return await withRomFsClient(targetProfileId, async ({ profile, sftp }) => {
      const destPath = scriptRemotePath(fileName);
      await sftpMkdirRecursiveScripts(sftp, scriptsBaseDir);
      await sftpWriteBuffer(sftp, assertScriptRootWritePath(destPath), content);
      return { ok: true, profileId: profile.id, fileName, path: destPath, message: `${fileName}를 대상 MiSTer로 전송했습니다.` };
    });
  } catch (error) {
    return { ok: false, fileName, message: sanitizeScriptFsMessage(error), errorCode: error.code || 'SCRIPT_FS_COPY_FAILED' };
  }
}

async function scriptFsInstallFromUrl(request = {}) {
  const fileName = (() => { try { return assertAllowedScriptFileName(request.fileName); } catch { return String(request.fileName || ''); } })();
  if (!request.confirmed) return { ok: false, fileName, message: '설치 전 확인이 필요합니다.', errorCode: 'SCRIPT_FS_CONFIRMATION_REQUIRED' };
  let url;
  try { url = new URL(String(request.url || '')); } catch { return { ok: false, fileName, message: '잘못된 다운로드 URL입니다.', errorCode: 'SCRIPT_FS_BAD_URL' }; }
  if (url.protocol !== 'https:' || !scriptDownloadHosts.has(url.hostname)) {
    return { ok: false, fileName, message: '허용되지 않은 다운로드 출처입니다(GitHub만 허용).', errorCode: 'SCRIPT_FS_URL_BLOCKED' };
  }
  try {
    const response = await globalThis.fetch(url.href, { redirect: 'follow' });
    if (!response.ok) return { ok: false, fileName, message: `다운로드 실패: HTTP ${response.status}`, errorCode: 'SCRIPT_FS_DOWNLOAD_FAILED' };
    const text = await response.text();
    if (!text.trim() || /^\s*<(?:!doctype|html)/i.test(text)) return { ok: false, fileName, message: '스크립트 내용을 받지 못했습니다(HTML 응답).', errorCode: 'SCRIPT_FS_DOWNLOAD_INVALID' };
    return await withRomFsClient(request.profileId, async ({ profile, sftp }) => {
      const destPath = scriptRemotePath(fileName);
      const exists = Boolean((await sftpLstat(sftp, destPath))?.isFile?.());
      await sftpMkdirRecursiveScripts(sftp, scriptsBaseDir);
      await sftpWriteUtf8File(sftp, assertScriptRootWritePath(destPath), text);
      return { ok: true, profileId: profile.id, fileName, path: destPath, message: exists ? `${fileName}를 최신 내용으로 덮어썼습니다.` : `${fileName}를 설치했습니다.` };
    });
  } catch (error) {
    return { ok: false, fileName, message: sanitizeScriptFsMessage(error), errorCode: error.code || 'SCRIPT_FS_INSTALL_FAILED' };
  }
}

function assertScriptLogPath(logPath) {
  const normalized = normalizeScriptRemotePath(logPath);
  if (!(normalized.startsWith(`${scriptsLogDir}/`) && /\.log$/i.test(normalized))) {
    throw createScriptFsError('SCRIPT_FS_LOG_PATH_BLOCKED', '스크립트 실행 로그 경로가 아닙니다.');
  }
  return normalized;
}

async function scriptFsReadRunLog(request = {}) {
  try {
    return await withRomFsClient(request.profileId, async ({ profile, sftp }) => {
      const logPath = assertScriptLogPath(request.logPath);
      const attrs = await sftpLstat(sftp, logPath);
      if (!attrs?.isFile?.()) return { ok: true, profileId: profile.id, logPath, content: '', message: '아직 로그가 없습니다(시작 중).' };
      const content = await sftpReadFile(sftp, logPath, 200 * 1024);
      return { ok: true, profileId: profile.id, logPath, content, sizeBytes: attrs.size || Buffer.byteLength(content), message: '로그를 읽었습니다.' };
    });
  } catch (error) {
    return { ok: false, logPath: String(request.logPath || ''), content: '', message: sanitizeScriptFsMessage(error), errorCode: error.code || 'SCRIPT_FS_LOG_READ_FAILED' };
  }
}

function stripSecretsFromDiagnostic(diagnostic = {}) {
  return JSON.parse(JSON.stringify(diagnostic, (key, value) => {
    if (/password|privateKey|passphrase|token|secret|credential/i.test(key)) return '[removed]';
    if (/private.*path|key.*path/i.test(key) && typeof value === 'string') return path.basename(value);
    return value;
  }));
}

function stripSecrets(value = {}) {
  return JSON.parse(JSON.stringify(value, (key, innerValue) => {
    if (secretKeyPattern.test(key)) return '[removed]';
    if (/private.*path|key.*path/i.test(key) && typeof innerValue === 'string') return path.basename(innerValue);
    return innerValue;
  }));
}

function sanitizeTaskLog(task = {}) {
  const now = new Date().toISOString();
  const safe = stripSecrets(task);
  const logs = Array.isArray(safe.logs) ? safe.logs.map((log) => ({
    at: log?.at || now,
    message: String(log?.message || '').replace(/password|privateKey|passphrase|token/ig, '[secret]'),
  })) : [];
  const createdAt = safe.createdAt || now;
  const finishedAt = safe.finishedAt || safe.completedAt;
  return {
    id: String(safe.id || `task-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
    title: String(safe.title || '작업'),
    description: String(safe.description || ''),
    category: safe.category || 'dry-run',
    riskLevel: safe.riskLevel || '안전',
    dryRun: Boolean(safe.dryRun),
    readOnly: safe.readOnly !== false,
    status: String(safe.status || '대기'),
    preview: safe.preview,
    logs,
    createdAt,
    startedAt: safe.startedAt || createdAt,
    completedAt: safe.completedAt,
    finishedAt,
    durationMs: Number.isFinite(Number(safe.durationMs)) ? Number(safe.durationMs) : undefined,
    targetProfileId: safe.targetProfileId ? String(safe.targetProfileId) : undefined,
    targetAlias: safe.targetAlias ? String(safe.targetAlias) : undefined,
    targetHost: safe.targetHost ? String(safe.targetHost) : undefined,
    resultSummary: safe.resultSummary ? String(safe.resultSummary) : undefined,
    errorCode: safe.errorCode ? String(safe.errorCode) : undefined,
    sanitizedErrorMessage: safe.sanitizedErrorMessage ? String(safe.sanitizedErrorMessage) : undefined,
  };
}

function sanitizeSavedRomPlan(plan = {}) {
  const safe = stripSecrets(plan);
  const metadata = safe.metadata || {};
  const dryRunResult = safe.dryRunResult || {};
  const planBody = dryRunResult.plan || {};
  return {
    metadata: {
      id: String(metadata.id || planBody.planId || `rom-plan-${Date.now()}`),
      schemaVersion: 1,
      createdAt: String(metadata.createdAt || planBody.createdAt || new Date().toISOString()),
      updatedAt: String(metadata.updatedAt || new Date().toISOString()),
      title: String(metadata.title || 'ROM dry-run 계획'),
      targetAlias: metadata.targetAlias ? String(metadata.targetAlias) : undefined,
      targetHost: metadata.targetHost ? String(metadata.targetHost) : undefined,
      fileCount: Number.isFinite(Number(metadata.fileCount)) ? Number(metadata.fileCount) : Array.isArray(planBody.perFilePlan) ? planBody.perFilePlan.length : 0,
      totalSizeBytes: Number.isFinite(Number(metadata.totalSizeBytes)) ? Number(metadata.totalSizeBytes) : Number(planBody.totalSizeBytes || 0),
      dryRun: true,
      readOnly: true,
    },
    dryRunResult: {
      ...dryRunResult,
      dryRun: true,
      readOnly: true,
      plan: {
        ...planBody,
        targetBasePath: '/media/fat/games',
        dryRun: true,
        readOnly: true,
        schemaVersion: 1,
      },
    },
    folderPolicy: safe.folderPolicy,
    backupPlan: safe.backupPlan,
    finalConfirmation: safe.finalConfirmation,
  };
}

async function loadSavedRomPlans() {
  const entries = await readJsonFile(appDataPath('rom', romPlanFileName), []);
  return Array.isArray(entries) ? entries.map(sanitizeSavedRomPlan).slice(0, 50) : [];
}

async function saveSavedRomPlan(plan = {}) {
  const current = await loadSavedRomPlans();
  const safe = sanitizeSavedRomPlan(plan);
  const next = [safe, ...current.filter((item) => item.metadata.id !== safe.metadata.id)].slice(0, 50);
  await writeJsonFile(appDataPath('rom', romPlanFileName), next);
  return next;
}

async function deleteSavedRomPlan(planId) {
  const current = await loadSavedRomPlans();
  const next = current.filter((item) => item.metadata.id !== planId);
  await writeJsonFile(appDataPath('rom', romPlanFileName), next);
  return next;
}

async function loadTaskLogs() {
  const entries = await readJsonFile(appDataPath('logs', taskLogFileName), []);
  return Array.isArray(entries) ? entries.map(sanitizeTaskLog).slice(0, 100) : [];
}

async function saveTaskLogs(tasks = []) {
  const safeTasks = Array.isArray(tasks) ? tasks.map(sanitizeTaskLog).slice(0, 100) : [];
  await writeJsonFile(appDataPath('logs', taskLogFileName), safeTasks);
  return safeTasks;
}

function ipToInt(ip) {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) + Number(octet)) >>> 0, 0);
}

function intToIp(value) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

function isPrivateIpv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isLinkLocal(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 169 && b === 254;
}

function isVirtualAdapterName(name) {
  return /virtual|vmware|vbox|hyper-v|loopback|wsl|docker|bluetooth|pseudo|tunnel/i.test(name);
}

function toSubnetBase(address, netmask) {
  const base = (ipToInt(address) & ipToInt(netmask || '255.255.255.0')) >>> 0;
  return intToIp(base);
}

function collectNetworkInterfaces() {
  const interfaces = os.networkInterfaces();
  const rows = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const address of addresses || []) {
      if (address.family !== 'IPv4') continue;
      const skipped = address.internal || isLinkLocal(address.address) || !isPrivateIpv4(address.address);
      const subnetBase = toSubnetBase(address.address, address.netmask);
      rows.push({
        id: `${name}-${address.address}`,
        name,
        address: address.address,
        netmask: address.netmask,
        family: 'IPv4',
        cidr: `${subnetBase}/24`,
        subnetBase,
        subnetLabel: `${subnetBase}/24`,
        candidateCount: 254,
        privateRange: isPrivateIpv4(address.address),
        virtual: isVirtualAdapterName(name),
        skipped,
        skipReason: skipped ? (address.internal ? 'loopback/internal' : isLinkLocal(address.address) ? 'link-local' : 'private IPv4 대역 아님') : undefined,
      });
    }
  }
  return rows;
}

function buildHostsForSubnet(subnetBase) {
  const base = ipToInt(subnetBase);
  return Array.from({ length: 254 }, (_, index) => intToIp(base + index + 1));
}

function probePort(ipAddress, port, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const finish = (open, error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        ipAddress,
        port,
        open,
        latencyMs: Date.now() - started,
        error: error ? String(error) : undefined,
      });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false, 'timeout'));
    socket.once('error', (error) => finish(false, error.code || error.message));
    socket.connect(port, ipAddress);
  });
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

function methodsForPorts(openPorts) {
  const methods = [];
  if (openPorts.includes(22)) methods.push('ssh', 'sftp');
  if (openPorts.includes(445)) methods.push('smb');
  if (openPorts.includes(80)) methods.push('http');
  return methods;
}

// 스캔 후보의 실제 호스트네임을 인증 없이 해석한다(IP만으로 구분 불가 문제 해결).
// 1) 역DNS(빠름, UniFi 등은 DHCP 이름을 PTR로 제공) → 2) NetBIOS(MiSTer는 Samba라 이름 등록, 화면이 죽어도 조회 가능).
function reverseDnsLookup(ipAddress) {
  return new Promise((resolve) => {
    let done = false;
    const timer = globalThis.setTimeout(() => { if (!done) { done = true; resolve(undefined); } }, 1500);
    try {
      dns.reverse(ipAddress, (err, names) => {
        if (done) return;
        done = true;
        globalThis.clearTimeout(timer);
        if (err || !Array.isArray(names) || !names.length) return resolve(undefined);
        const first = String(names[0] || '').replace(/\.$/, '').split('.')[0].trim();
        resolve(first && !/^\d+$/.test(first) ? first : undefined);
      });
    } catch {
      if (!done) { done = true; globalThis.clearTimeout(timer); resolve(undefined); }
    }
  });
}

async function netbiosName(ipAddress) {
  if (process.platform !== 'win32') return undefined;
  try {
    const { stdout } = await execFileAsync('nbtstat', ['-A', ipAddress], { windowsHide: true, timeout: 3000, maxBuffer: 1024 * 256 });
    // 워크스테이션 이름은 <00> UNIQUE 항목. <00> GROUP(워크그룹)은 제외.
    const match = String(stdout).match(/^\s*([^\s<]+)\s*<00>\s+UNIQUE/m);
    if (match && match[1]) return match[1].trim();
  } catch { /* nbtstat 없음/실패 */ }
  return undefined;
}

async function resolveCandidateHostname(ipAddress) {
  const dnsName = await reverseDnsLookup(ipAddress);
  if (dnsName) return { hostname: dnsName, hostnameSource: 'dns' };
  const nb = await netbiosName(ipAddress);
  if (nb) return { hostname: nb, hostnameSource: 'netbios' };
  return { hostname: undefined, hostnameSource: undefined };
}

async function scanCandidates(options = {}) {
  const startedAt = new Date().toISOString();
  const interfaces = collectNetworkInterfaces();
  const selected = interfaces.find((item) => item.id === options.interfaceId) || interfaces.find((item) => !item.skipped && !item.virtual) || interfaces.find((item) => !item.skipped);
  if (!selected) {
    return {
      interfaces,
      candidates: [],
      scannedHostCount: 0,
      scannedPortCount: 0,
      startedAt,
      finishedAt: new Date().toISOString(),
      logs: ['검색 가능한 private IPv4 인터페이스가 없습니다.'],
    };
  }

  const ports = Array.isArray(options.ports) && options.ports.length ? options.ports : [22, 445, 80];
  const timeoutMs = Math.max(120, Math.min(Number(options.timeoutMs) || 220, 2500));
  const concurrency = Math.max(4, Math.min(Number(options.concurrency) || 48, 96));
  const hosts = buildHostsForSubnet(selected.subnetBase);
  const candidates = [];

  await mapWithConcurrency(hosts, concurrency, async (ipAddress) => {
    const probeResults = await Promise.all(ports.map((port) => probePort(ipAddress, port, timeoutMs)));
    const openPorts = probeResults.filter((result) => result.open).map((result) => result.port);
    if (openPorts.includes(22) || openPorts.includes(445)) {
      candidates.push({
        id: `scan-${ipAddress}`,
        ipAddress,
        hostname: undefined,
        openPorts,
        methods: methodsForPorts(openPorts),
        confidence: openPorts.includes(22) && openPorts.includes(445) ? '높음' : '보통',
        source: '서브넷 검색',
        status: '후보',
        probeResults,
        scannedAt: new Date().toISOString(),
      });
    }
  });

  // 찾은 후보(소수)에 한해 실제 호스트네임을 해석해 IP만으로 구분 못 하는 문제를 해결한다.
  await Promise.all(candidates.map(async (candidate) => {
    const resolved = await resolveCandidateHostname(candidate.ipAddress);
    candidate.hostname = resolved.hostname;
    candidate.hostnameSource = resolved.hostnameSource;
  }));

  candidates.sort((a, b) => a.ipAddress.localeCompare(b.ipAddress, undefined, { numeric: true }));
  return {
    interfaces,
    selectedInterface: selected,
    candidates,
    scannedHostCount: hosts.length,
    scannedPortCount: hosts.length * ports.length,
    startedAt,
    finishedAt: new Date().toISOString(),
    logs: [
      `${selected.subnetLabel} 범위에서 ${hosts.length}개 IP를 확인했습니다.`,
      `포트: ${ports.join(', ')}, timeout=${timeoutMs}ms, concurrency=${concurrency}`,
      'SSH 인증 및 fingerprint 확인은 아직 별도 연결 단계로 보류됩니다.',
    ],
  };
}

async function runPowerShellJson(command) {
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 4,
  });
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  return JSON.parse(trimmed);
}

function normalizeDrive(row) {
  // PowerShell이 이미 "F:" 형태로 보내므로 끝의 콜론/역슬래시를 먼저 제거해 "F::" 중복을 막는다.
  const rawLetter = String(row.DriveLetter || '').replace(/[:\\]+$/, '');
  const driveLetter = rawLetter ? `${rawLetter}:` : (row.DeviceID || '');
  const mountPoint = driveLetter ? (driveLetter.endsWith('\\') ? driveLetter : `${driveLetter}\\`) : '';
  // 설치된 MiSTer 카드는 작은 부트 파티션만 드라이브 문자를 얻어 볼륨 크기가 0.1GB처럼 보인다.
  // 굽기는 디스크 전체를 덮어쓰므로, 표시 용량은 물리 디스크 크기(DiskSize)를 우선한다.
  const diskBytes = Number(row.DiskSize || 0);
  const volumeBytes = Number(row.Size || 0);
  const sizeGb = Number((((diskBytes || volumeBytes) / 1024 / 1024 / 1024) || 0).toFixed(1));
  const freeGb = Number(((Number(row.FreeSpace || 0) / 1024 / 1024 / 1024) || 0).toFixed(1));
  const busType = row.BusType ? String(row.BusType) : 'Unknown';
  const removable = Boolean(row.Removable) || Number(row.DriveType) === 2 || /usb|sd|mmc/i.test(busType);
  const systemDisk = String(driveLetter).toUpperCase().startsWith(String(process.env.SystemDrive || 'C:').toUpperCase());
  const plausibleSize = sizeGb > 0 && sizeGb <= 1024;
  const selectable = removable && !systemDisk && plausibleSize;
  return {
    id: `${driveLetter || 'drive'}-${row.DiskNumber ?? 'unknown'}`,
    label: row.VolumeName || row.FileSystemLabel || `${driveLetter || '드라이브'} 볼륨`,
    mountPoint,
    driveLetter,
    volumeName: row.VolumeName || row.FileSystemLabel || '',
    sizeGb,
    freeGb,
    fileSystem: row.FileSystem || 'Unknown',
    removable,
    systemDisk,
    selectable,
    selectionReason: selectable ? '선택 가능: removable/USB 계열이며 시스템 드라이브가 아닙니다.' : systemDisk ? '시스템 드라이브는 선택할 수 없습니다.' : removable ? '용량 정보를 확인할 수 없습니다.' : 'removable/USB 계열이 아니라 기본 선택 대상에서 제외됩니다.',
    diskNumber: typeof row.DiskNumber === 'number' ? row.DiskNumber : undefined,
    busType,
    healthStatus: row.HealthStatus || row.Status || 'Unknown',
  };
}

async function listWindowsDrives() {
  if (process.platform !== 'win32') return [];
  const command = `
    $ErrorActionPreference = 'SilentlyContinue'
    $items = @()
    foreach ($v in Get-Volume | Where-Object { $_.DriveLetter }) {
      $p = Get-Partition -DriveLetter $v.DriveLetter
      $d = $null
      if ($p) { $d = Get-Disk -Number $p.DiskNumber }
      $logical = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($v.DriveLetter):'"
      $items += [pscustomobject]@{
        DriveLetter = "$($v.DriveLetter):"
        VolumeName = $v.FileSystemLabel
        FileSystem = $v.FileSystem
        Size = $v.Size
        FreeSpace = $v.SizeRemaining
        DiskSize = if ($d) { $d.Size } else { $null }
        DriveType = $logical.DriveType
        DiskNumber = $p.DiskNumber
        BusType = if ($d) { "$($d.BusType)" } else { "Unknown" }
        HealthStatus = if ($v.HealthStatus) { "$($v.HealthStatus)" } else { "Unknown" }
        Removable = if ($d) { $d.BusType -in @('USB','SD','MMC') } else { $logical.DriveType -eq 2 }
      }
    }
    $items | ConvertTo-Json -Depth 4
  `;
  const rows = await runPowerShellJson(command);
  return (Array.isArray(rows) ? rows : [rows]).filter(Boolean).map(normalizeDrive);
}

async function inspectSdStructure({ mountPoint, driveId }) {
  const root = String(mountPoint || '').replace(/\//g, '\\');
  const normalizedRoot = root.endsWith('\\') ? root : `${root}\\`;
  const specs = [
    ['MiSTer.ini', 'MiSTer.ini', 'file'],
    ['games', 'games', 'folder'],
    ['Scripts', 'Scripts', 'folder'],
    ['config', 'config', 'folder'],
    ['linux', 'linux', 'folder'],
  ];
  const items = await Promise.all(specs.map(async ([key, label, type]) => {
    const target = path.join(normalizedRoot, label);
    let exists = false;
    try {
      const stat = await fs.stat(target);
      exists = type === 'file' ? stat.isFile() : stat.isDirectory();
    } catch {
      exists = false;
    }
    return { key, label, path: target, exists, type };
  }));
  const required = items.filter((item) => ['MiSTer.ini', 'games'].includes(item.key));
  const ok = required.every((item) => item.exists);
  return {
    driveId,
    mountPoint: normalizedRoot,
    checkedAt: new Date().toISOString(),
    ok,
    items,
    message: ok ? 'MiSTer SD 카드 구조로 보입니다.' : '필수 항목이 부족합니다. 읽기 전용 검사만 수행했습니다.',
  };
}

function sha256File(filePath) {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', (error) => resolve({ ok: false, algorithm: 'sha256', filePath, message: error.message }));
    stream.on('end', () => resolve({ ok: true, algorithm: 'sha256', filePath, hash: hash.digest('hex'), message: 'SHA-256 계산 완료' }));
  });
}

// ---------------------------------------------------------------------------
// SD 카드 셋업 마법사 (Mr. Fusion) — 다운로드 + 검증 + 실제 플래시(관리자 권한) + WiFi 사전설정
// ---------------------------------------------------------------------------

const MR_FUSION_SOURCES = {
  'mr-fusion': { repo: 'MiSTer-devel/mr-fusion', label: 'Mr. Fusion (공식)' },
  'ms-fusion': { repo: 'theypsilon/ms-fusion', label: 'Ms. Fusion (첫 부팅 update_all 포함)' },
};

// 다운로드/작업 파일은 userData(C:\AppData)가 아니라 앱 폴더 하위에 둔다(card-images와 동일 규칙).
// dev=프로젝트 루트, packaged=exe 옆 설치 폴더.
function appOwnSubdir(name) {
  const appRoot = app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath();
  return path.join(appRoot, name);
}

function sdImageCacheDir() {
  return appOwnSubdir('sd-images');
}

function psQuote(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function isDriveSelectableForMrFusionHost(drive) {
  if (!drive) return false;
  if (drive.systemDisk) return false;
  if (!drive.removable && !/usb|sd|mmc/i.test(drive.busType || '')) return false;
  if (!(drive.sizeGb > 0 && drive.sizeGb <= 1024)) return false;
  return true;
}

// "F", "F:", "F::", "F:\\" → 모두 "F" 로 통일(대소문자/콜론 무시).
function canonicalDriveLetter(value) {
  return String(value || '').replace(/[:\\]+$/, '').trim().toUpperCase();
}

async function resolveDriveByLetter(driveLetter) {
  const wanted = canonicalDriveLetter(driveLetter);
  if (!wanted) return undefined;
  const drives = await listWindowsDrives();
  return drives.find((d) => canonicalDriveLetter(d.driveLetter) === wanted);
}

async function extractZipWindows(zipPath, destDir) {
  const cmd = `Expand-Archive -LiteralPath ${psQuote(zipPath)} -DestinationPath ${psQuote(destDir)} -Force`;
  await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], {
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 8,
  });
}

function sdImageSidecarPath(imgPath) {
  return `${imgPath}.meta.json`;
}

async function readSdImageSidecar(imgPath) {
  try {
    return JSON.parse(await fs.readFile(sdImageSidecarPath(imgPath), 'utf8'));
  } catch {
    return undefined;
  }
}

// 최신 릴리스를 확인하고, "같은 버전"의 로컬 이미지가 이미 있는지 + SHA-256이 저장해 둔 값과 일치하는지 알려준다.
// - local-verified: 같은 태그·크기·SHA가 모두 일치하는 로컬 이미지가 있음 → UI는 다시 받지 않고 재사용 여부를 물어본다.
// - changed: 같은 태그인데 로컬 SHA가 달라짐(손상) → 다시 받아야 함.
// - none: 로컬에 준비된 이미지가 없음 → 받아야 함.
async function resolveMrFusionImage(event, options = {}) {
  const variant = options.variant === 'ms-fusion' ? 'ms-fusion' : 'mr-fusion';
  const source = MR_FUSION_SOURCES[variant];
  const emit = (payload) => { try { event?.sender?.send('sd:download:progress', { variant, ...payload }); } catch { /* renderer gone */ } };
  try {
    if (process.platform !== 'win32') throw new Error('이미지 확인은 Windows에서 동작합니다.');
    emit({ phase: 'resolve', message: '최신 릴리스 정보를 확인합니다…' });
    const apiRes = await globalThis.fetch(`https://api.github.com/repos/${source.repo}/releases/latest`, {
      headers: { 'User-Agent': 'Hello-Mister', Accept: 'application/vnd.github+json' },
    });
    if (!apiRes.ok) throw new Error(`GitHub API HTTP ${apiRes.status}`);
    const release = await apiRes.json();
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const asset = assets.find((a) => /\.img\.zip$/i.test(a.name)) || assets.find((a) => /\.zip$/i.test(a.name)) || assets[0];
    if (!asset) throw new Error('릴리스에서 이미지 자산을 찾지 못했습니다.');
    const tag = release.tag_name || '';
    const imgName = asset.name.replace(/\.zip$/i, '');
    const imgPath = path.join(sdImageCacheDir(), imgName);

    let imgStat = null;
    try { imgStat = await fs.stat(imgPath); } catch { /* not extracted */ }
    const meta = imgStat ? await readSdImageSidecar(imgPath) : undefined;
    if (!imgStat || !meta || meta.tag !== tag || Number(meta.assetSize) !== Number(asset.size)) {
      return { ok: true, status: 'none', variant, tag, assetName: asset.name, assetSize: asset.size };
    }

    emit({ phase: 'verify', message: '로컬 이미지 SHA-256을 확인합니다…' });
    const sha = await sha256File(imgPath);
    if (!sha.ok || sha.hash !== meta.imgSha) {
      return { ok: true, status: 'changed', variant, tag, message: '로컬 파일의 SHA가 달라 새로 받습니다.' };
    }
    emit({ phase: 'done', message: '로컬 이미지 확인 완료', percent: 100 });
    return {
      ok: true,
      status: 'local-verified',
      variant,
      tag,
      image: {
        source: 'download',
        variant,
        tag,
        fileName: imgName,
        localPath: imgPath,
        sizeBytes: imgStat.size,
        checksum: sha.hash,
        verified: true,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ phase: 'error', message });
    return { ok: false, status: 'error', variant, message };
  }
}

async function downloadMrFusionImage(event, options = {}) {
  const variant = options.variant === 'ms-fusion' ? 'ms-fusion' : 'mr-fusion';
  const source = MR_FUSION_SOURCES[variant];
  const logs = [];
  const emit = (payload) => { try { event?.sender?.send('sd:download:progress', { variant, ...payload }); } catch { /* renderer gone */ } };
  try {
    if (process.platform !== 'win32') throw new Error('이미지 다운로드/압축 해제는 Windows에서 동작합니다.');
    emit({ phase: 'resolve', message: '최신 릴리스 정보를 확인합니다…' });
    const apiRes = await globalThis.fetch(`https://api.github.com/repos/${source.repo}/releases/latest`, {
      headers: { 'User-Agent': 'Hello-Mister', Accept: 'application/vnd.github+json' },
    });
    if (!apiRes.ok) throw new Error(`GitHub API HTTP ${apiRes.status}`);
    const release = await apiRes.json();
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const asset = assets.find((a) => /\.img\.zip$/i.test(a.name)) || assets.find((a) => /\.zip$/i.test(a.name)) || assets[0];
    if (!asset) throw new Error('릴리스에서 이미지 자산을 찾지 못했습니다.');
    const tag = release.tag_name || '';
    logs.push(`${source.label} ${tag} · ${asset.name} (${asset.size} bytes)`);

    await fs.mkdir(sdImageCacheDir(), { recursive: true });
    const zipPath = path.join(sdImageCacheDir(), asset.name);
    const expectedImgName = asset.name.replace(/\.zip$/i, '');
    let imgPath = path.join(sdImageCacheDir(), expectedImgName);

    let needDownload = true;
    if (!options.force) {
      try {
        const st = await fs.stat(zipPath);
        if (asset.size && st.size === asset.size) needDownload = false;
      } catch { /* not cached */ }
    }

    if (needDownload) {
      emit({ phase: 'download', message: '이미지를 다운로드합니다…', receivedBytes: 0, totalBytes: asset.size, percent: 0 });
      const dlRes = await globalThis.fetch(asset.browser_download_url, { headers: { 'User-Agent': 'Hello-Mister' } });
      if (!dlRes.ok || !dlRes.body) throw new Error(`다운로드 HTTP ${dlRes.status}`);
      const total = Number(dlRes.headers.get('content-length')) || asset.size || 0;
      const tmpPath = `${zipPath}.part`;
      const out = createWriteStream(tmpPath);
      const reader = dlRes.body.getReader();
      let received = 0;
      let lastPct = -1;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
          received += chunk.length;
          const pct = total ? Math.floor((received / total) * 100) : undefined;
          if (pct !== lastPct) {
            lastPct = pct;
            emit({ phase: 'download', message: `다운로드 중… ${pct ?? ''}%`, receivedBytes: received, totalBytes: total, percent: pct });
          }
        }
      } finally {
        await new Promise((res, rej) => out.end((err) => (err ? rej(err) : res())));
      }
      const st = await fs.stat(tmpPath);
      if (asset.size && st.size !== asset.size) {
        await fs.rm(tmpPath, { force: true });
        throw new Error(`크기 불일치: 받은 ${st.size} / 기대 ${asset.size}`);
      }
      await fs.rm(zipPath, { force: true }).catch(() => {});
      await fs.rename(tmpPath, zipPath);
      logs.push('다운로드 완료 · 크기 일치 확인');
    } else {
      logs.push('캐시된 이미지 재사용 (크기 일치)');
    }

    emit({ phase: 'extract', message: '이미지 압축을 해제합니다…' });
    await fs.rm(imgPath, { force: true }).catch(() => {});
    await extractZipWindows(zipPath, sdImageCacheDir());
    try {
      await fs.stat(imgPath);
    } catch {
      const entries = await fs.readdir(sdImageCacheDir());
      const found = entries.find((name) => /\.img$/i.test(name));
      if (!found) throw new Error('압축 해제 후 .img 파일을 찾지 못했습니다.');
      imgPath = path.join(sdImageCacheDir(), found);
    }
    const imgStat = await fs.stat(imgPath);
    logs.push(`이미지 준비됨: ${path.basename(imgPath)} (${imgStat.size} bytes)`);

    emit({ phase: 'verify', message: '무결성(SHA-256)을 계산합니다…' });
    const sha = await sha256File(imgPath);
    // 같은 버전 재사용 판단을 위해 태그·크기·SHA를 사이드카로 저장한다.
    try {
      await fs.writeFile(
        sdImageSidecarPath(imgPath),
        JSON.stringify({ tag, assetName: asset.name, assetSize: asset.size, imgName: path.basename(imgPath), imgSha: sha.ok ? sha.hash : undefined }),
        'utf8',
      );
    } catch { /* sidecar is best-effort */ }

    emit({ phase: 'done', message: '이미지 준비 완료', percent: 100 });
    return {
      ok: true,
      message: `${source.label} ${tag} 이미지를 준비했습니다.`,
      logs,
      image: {
        source: 'download',
        variant,
        tag,
        fileName: path.basename(imgPath),
        localPath: imgPath,
        url: asset.browser_download_url,
        sizeBytes: imgStat.size,
        checksum: sha.ok ? sha.hash : undefined,
        verified: true,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ phase: 'error', message });
    return { ok: false, message: `다운로드 실패: ${message}`, logs };
  }
}

// 관리자 권한으로 실행되는 워커 스크립트. 대상 디스크를 다시 검증한 뒤에만 파괴적 작업을 수행한다.
// (1) Get-Disk로 removable/비-시스템/비-부팅 확인, (2) 사용자가 확인한 드라이브 문자가 실제로 그 디스크에
// 있는지 교차검증, (3) Clear-Disk로 파티션 정리(마운트 해제), (4) \\.\PhysicalDriveN 에 원시 기록.
function buildFlashWorkerScript() {
  return [
    'param(',
    '  [int]$DiskNumber,',
    '  [string]$ImagePath,',
    '  [string]$DriveLetter,',
    '  [string]$ProgressFile,',
    '  [string]$ResultFile',
    ')',
    "$ErrorActionPreference = 'Stop'",
    'function Save-Progress($phase, $msg, $written, $total) {',
    '  if ($total -gt 0) { $pct = [math]::Floor(($written / $total) * 100) } else { $pct = 0 }',
    '  $o = [pscustomobject]@{ phase = $phase; message = $msg; writtenBytes = $written; totalBytes = $total; percent = $pct }',
    '  try { $o | ConvertTo-Json -Compress | Out-File -LiteralPath $ProgressFile -Encoding utf8 -Force } catch {}',
    '}',
    'function Save-Result($ok, $msg, $logs) {',
    '  $o = [pscustomobject]@{ ok = $ok; message = $msg; logs = $logs }',
    '  try { $o | ConvertTo-Json -Compress | Out-File -LiteralPath $ResultFile -Encoding utf8 -Force } catch {}',
    '  if ($ok) { exit 0 } else { exit 1 }',
    '}',
    'try {',
    "  Save-Progress 'validate' 'verify target disk' 0 0",
    '  $disk = Get-Disk -Number $DiskNumber',
    "  if ($null -eq $disk) { Save-Result $false ('disk not found: ' + $DiskNumber) @() }",
    "  if ($disk.IsSystem) { Save-Result $false 'refused: system disk' @() }",
    "  if ($disk.IsBoot) { Save-Result $false 'refused: boot disk' @() }",
    "  if (@('USB','SD','MMC') -notcontains [string]$disk.BusType) { Save-Result $false ('refused: non-removable bus ' + $disk.BusType) @() }",
    '  if ($disk.Size -le 0 -or $disk.Size -gt 1199999999999) { Save-Result $false (\'refused: implausible size \' + $disk.Size) @() }',
    "  $L = $DriveLetter.TrimEnd(':')",
    '  $vol = Get-Partition -DiskNumber $DiskNumber -ErrorAction SilentlyContinue | Get-Volume -ErrorAction SilentlyContinue | Where-Object { [string]$_.DriveLetter -eq $L }',
    "  if ($null -eq $vol) { Save-Result $false ('refused: drive ' + $L + ' not on disk ' + $DiskNumber) @() }",
    '  $img = Get-Item -LiteralPath $ImagePath',
    '  $total = [int64]$img.Length',
    "  Save-Progress 'clearing' 'clearing partitions' 0 $total",
    '  try { Set-Disk -Number $DiskNumber -IsReadOnly $false -ErrorAction SilentlyContinue } catch {}',
    '  try { Set-Disk -Number $DiskNumber -IsOffline $false -ErrorAction SilentlyContinue } catch {}',
    '  try { Clear-Disk -Number $DiskNumber -RemoveData -RemoveOEM -Confirm:$false } catch {}',
    '  Start-Sleep -Milliseconds 800',
    "  Save-Progress 'writing' 'writing image' 0 $total",
    "  $devPath = '\\\\.\\PhysicalDrive' + $DiskNumber",
    '  $src = [System.IO.File]::OpenRead($ImagePath)',
    '  $dst = New-Object System.IO.FileStream($devPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)',
    '  try {',
    '    $bufSize = 4194304',
    '    $buf = New-Object byte[] $bufSize',
    '    $written = [int64]0',
    '    $lastPct = -1',
    '    while ($true) {',
    '      $read = $src.Read($buf, 0, $bufSize)',
    '      if ($read -le 0) { break }',
    '      $writeLen = $read',
    '      $rem = $read % 512',
    '      if ($rem -ne 0) {',
    '        $writeLen = $read + (512 - $rem)',
    '        for ($z = $read; $z -lt $writeLen; $z++) { $buf[$z] = 0 }',
    '      }',
    '      $dst.Write($buf, 0, $writeLen)',
    '      $written = $written + $read',
    '      if ($total -gt 0) { $pct = [math]::Floor(($written / $total) * 100) } else { $pct = 0 }',
    "      if ($pct -ne $lastPct) { $lastPct = $pct; Save-Progress 'writing' ('writing image ' + $pct + '%') $written $total }",
    '    }',
    '    $dst.Flush()',
    '  } finally {',
    '    $dst.Dispose()',
    '    $src.Dispose()',
    '  }',
    "  Save-Progress 'finalizing' 'finalizing' $total $total",
    '  try { Get-Disk -Number $DiskNumber | Update-Disk } catch {}',
    '  Start-Sleep -Milliseconds 800',
    '  # Mr. Fusion 첫 부팅 설치는 카드에 미리 넣어둔 wpa_supplicant.conf / Scripts 를 미스터로 자동 복사한다.',
    '  # 그래서 FAT(MRFUSION) 파티션은 마운트된 채로 두어 Wi‑Fi/스크립트를 넣을 수 있게 하고,',
    '  # 리눅스(비-FAT) 파티션의 드라이브 문자만 제거해 “포맷하시겠습니까?” 팝업만 막는다.',
    '  try {',
    '    Get-Partition -DiskNumber $DiskNumber -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter } | ForEach-Object {',
    '      $pletter = [string]$_.DriveLetter',
    '      $pvol = $_ | Get-Volume -ErrorAction SilentlyContinue',
    "      if ($pletter -and ($null -eq $pvol -or $pvol.FileSystem -notmatch 'FAT')) {",
    "        try { $_ | Remove-PartitionAccessPath -AccessPath ($pletter + ':\\') -ErrorAction SilentlyContinue } catch {}",
    '      }',
    '    }',
    '  } catch {}',
    "  Save-Result $true 'image written successfully' @(('wrote ' + $total + ' bytes'), 'kept MRFUSION mounted; removed non-FAT drive letters to avoid format popup')",
    '} catch {',
    "  Save-Result $false ('error: ' + $_.Exception.Message) @()",
    '}',
    '',
  ].join('\r\n');
}

async function flashSdImage(event, request = {}) {
  const emit = (payload) => { try { event?.sender?.send('sd:flash:progress', payload); } catch { /* renderer gone */ } };
  const logs = [];
  const dryRun = Boolean(request.dryRun);
  const imagePath = String(request.image?.localPath || request.imagePath || '');
  const targetDrive = request.targetDrive || {};
  const typed = String(request.typedConfirmation || '').trim();
  try {
    emit({ phase: 'validate', message: '대상 카드를 다시 확인합니다…' });
    if (process.platform !== 'win32') throw new Error('실제 플래시는 Windows에서만 지원됩니다.');
    if (!imagePath) throw new Error('이미지가 준비되지 않았습니다.');
    const imgStat = await fs.stat(imagePath).catch(() => null);
    if (!imgStat || !imgStat.isFile()) throw new Error('이미지 파일을 찾을 수 없습니다.');

    const wantLetter = canonicalDriveLetter(targetDrive.driveLetter || targetDrive.mountPoint || '');
    if (!wantLetter) throw new Error('대상 드라이브 문자를 확인할 수 없습니다.');
    const fresh = await resolveDriveByLetter(wantLetter);
    if (!fresh) throw new Error(`드라이브 ${wantLetter}: 를 다시 찾지 못했습니다. 카드를 다시 넣고 시도하세요.`);
    if (fresh.systemDisk) throw new Error('시스템 디스크에는 쓸 수 없습니다.');
    if (!isDriveSelectableForMrFusionHost(fresh)) throw new Error('선택한 드라이브가 removable SD/USB가 아니라 차단했습니다.');
    if (typeof fresh.diskNumber !== 'number') throw new Error('대상 물리 디스크 번호를 확인할 수 없습니다.');
    const typedNorm = canonicalDriveLetter(typed);
    if (typedNorm !== wantLetter) throw new Error('확인 문구가 대상 드라이브 문자와 일치하지 않습니다.');

    logs.push(`대상: ${fresh.driveLetter} · PhysicalDrive${fresh.diskNumber} · ${fresh.busType} · ${fresh.sizeGb}GB`);
    logs.push(`이미지: ${path.basename(imagePath)} (${imgStat.size} bytes)`);

    if (dryRun) {
      emit({ phase: 'done', message: 'dry-run 검증 완료', percent: 100 });
      return {
        ok: true,
        dryRun: true,
        message: 'dry-run 완료: 대상·이미지·확인 문구가 유효합니다. 실제 쓰기는 하지 않았습니다.',
        logs: [...logs, '실제 포맷, 파티션 변경, 쓰기 작업은 수행하지 않았습니다.'],
      };
    }

    emit({ phase: 'prepare', message: '관리자 권한 작업을 준비합니다…' });
    const workDir = appOwnSubdir('sd-flash');
    await fs.mkdir(workDir, { recursive: true });
    const stamp = `${Date.now()}-${Math.floor(imgStat.size % 100000)}`;
    const progressFile = path.join(workDir, `progress-${stamp}.json`);
    const resultFile = path.join(workDir, `result-${stamp}.json`);
    const workerPs1 = path.join(workDir, `flash-worker-${stamp}.ps1`);
    await fs.writeFile(progressFile, '{}', 'utf8').catch(() => {});
    await fs.rm(resultFile, { force: true }).catch(() => {});
    await fs.writeFile(workerPs1, buildFlashWorkerScript(), 'utf8');

    emit({ phase: 'elevating', message: '관리자 권한 동의(UAC)를 기다립니다…' });
    // 모든 배열 요소를 single-quote 해야 PowerShell이 @(...) 를 문자열 배열로 파싱한다(플래그명 포함).
    const argList = [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', workerPs1,
      '-DiskNumber', String(fresh.diskNumber),
      '-ImagePath', imagePath,
      '-DriveLetter', wantLetter,
      '-ProgressFile', progressFile,
      '-ResultFile', resultFile,
    ].map(psQuote).join(', ');
    const launcherCommand = [
      "$ErrorActionPreference = 'Stop';",
      'try {',
      `  $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -PassThru -Wait -ArgumentList ${argList};`,
      '  exit $p.ExitCode',
      '} catch {',
      '  exit 1223',
      '}',
    ].join(' ');

    const readProgress = async () => {
      try {
        const raw = (await fs.readFile(progressFile, 'utf8')).replace(/^\uFEFF/, '').trim();
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.phase) emit(parsed);
      } catch { /* not ready */ }
    };
    const pollTimer = globalThis.setInterval(() => { void readProgress(); }, 300);

    let launcherExit = 0;
    try {
      await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', launcherCommand], {
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
    } catch (error) {
      launcherExit = typeof error?.code === 'number' ? error.code : 1;
    } finally {
      globalThis.clearInterval(pollTimer);
    }
    await readProgress();

    let result;
    try {
      result = JSON.parse((await fs.readFile(resultFile, 'utf8')).replace(/^\uFEFF/, '').trim());
    } catch { /* no result file */ }
    await fs.rm(workerPs1, { force: true }).catch(() => {});
    await fs.rm(progressFile, { force: true }).catch(() => {});
    await fs.rm(resultFile, { force: true }).catch(() => {});

    if (launcherExit === 1223 && !result) {
      emit({ phase: 'error', message: '관리자 권한 요청이 취소되었습니다.' });
      return { ok: false, dryRun: false, cancelled: true, message: '관리자 권한 요청이 취소되어 굽기를 진행하지 않았습니다.', logs };
    }
    if (result && result.ok) {
      emit({ phase: 'done', message: '굽기 완료', percent: 100 });
      return { ok: true, dryRun: false, message: result.message || 'Mr. Fusion 이미지를 카드에 구웠습니다.', logs: [...logs, ...(result.logs || [])] };
    }
    let message = (result && result.message) || (launcherExit ? `워커 종료 코드 ${launcherExit}` : '알 수 없는 오류로 굽기에 실패했습니다.');
    // 쓰기/읽기 전용/액세스 거부류 오류면 잠금 스위치·쓰기 보호 안내를 덧붙인다.
    if (/write|read-?only|읽기 전용|쓰기|액세스|거부|denied|protect|보호/i.test(message)) {
      message += ' — 카드가 쓰기 보호(읽기 전용) 상태일 수 있습니다. ① SD 어댑터의 잠금(LOCK) 스위치를 푸세요. ② 카드를 뺐다 다시 꽂으세요. ③ Windows에 “포맷하시겠습니까?” 창이 뜨면 포맷하지 말고 닫으세요.';
    }
    emit({ phase: 'error', message });
    return { ok: false, dryRun: false, message: `굽기 실패: ${message}`, logs: [...logs, ...((result && result.logs) || [])] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ phase: 'error', message });
    return { ok: false, dryRun, message: `${dryRun ? 'dry-run ' : ''}실패: ${message}`, logs };
  }
}

async function writeWpaSupplicant(request = {}) {
  try {
    const root = String(request.mountPoint || '').replace(/\//g, '\\');
    const normalizedRoot = root.endsWith('\\') ? root : `${root}\\`;
    const ssid = String(request.ssid || '').trim();
    const psk = String(request.password || '');
    if (!ssid) throw new Error('Wi‑Fi SSID가 비어 있습니다.');
    const country = (String(request.countryCode || '').trim().toUpperCase().slice(0, 2)) || 'US';
    const escaped = (value) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const lines = [
      `country=${country}`,
      'ctrl_interface=/run/wpa_supplicant',
      'update_config=1',
      '',
      'network={',
      `    ssid="${escaped(ssid)}"`,
      psk ? `    psk="${escaped(psk)}"` : '    key_mgmt=NONE',
      '    scan_ssid=1',
      '}',
      '',
    ];
    const content = lines.join('\n');
    // 두 위치에 모두 쓴다(둘 다 무해):
    // - 카드 루트: 갓 구운 Mr. Fusion 카드용. Mr. Fusion이 첫 부팅 설치 때 "루트의" wpa_supplicant.conf 를 미스터로 복사한다(공식 방식). linux/ 에만 두면 못 찾아 Wi‑Fi가 적용되지 않는다.
    // - linux/: 이미 설치를 끝낸 카드용. /etc/network/interfaces 가 /media/fat/linux/wpa_supplicant.conf 를 직접 읽는다.
    const rootTarget = path.join(normalizedRoot, 'wpa_supplicant.conf');
    await fs.writeFile(rootTarget, content, 'utf8');
    try {
      const linuxDir = path.join(normalizedRoot, 'linux');
      await fs.mkdir(linuxDir, { recursive: true });
      await fs.writeFile(path.join(linuxDir, 'wpa_supplicant.conf'), content, 'utf8');
    } catch { /* linux/ 쓰기는 best-effort (갓 구운 카드는 루트만으로 충분) */ }
    return { ok: true, message: 'Wi‑Fi 설정을 카드에 저장했습니다(루트 + linux). 첫 부팅 때 미스터로 자동 적용됩니다.', filePath: rootTarget };
  } catch (error) {
    return { ok: false, message: `Wi‑Fi 설정 저장 실패: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// 선택한 영상 출력 프리셋 내용을 카드의 FAT 루트에 MiSTer.ini 로 기록한다(비파괴, 관리자 권한 불필요).
// 부팅 후 설치가 끝난 카드를 다시 꽂아 쓰면 바로 적용된다. 기존 MiSTer.ini는 .bak 로 백업.
async function writeMisterIni(request = {}) {
  try {
    const root = String(request.mountPoint || '').replace(/\//g, '\\');
    const normalizedRoot = root.endsWith('\\') ? root : `${root}\\`;
    const content = String(request.content || '');
    if (!normalizedRoot || normalizedRoot.length < 2) throw new Error('대상 카드 경로가 올바르지 않습니다.');
    if (!content.trim()) throw new Error('MiSTer.ini 내용이 비어 있습니다.');
    const target = path.join(normalizedRoot, 'MiSTer.ini');
    try {
      await fs.access(target);
      await fs.copyFile(target, path.join(normalizedRoot, `MiSTer.ini.bak-${Date.now()}`));
    } catch { /* 기존 파일 없음 → 백업 불필요 */ }
    await fs.writeFile(target, content.replace(/\r?\n/g, '\r\n'), 'utf8');
    return { ok: true, message: `MiSTer.ini를 카드에 저장했습니다: ${target}`, filePath: target };
  } catch (error) {
    return { ok: false, message: `MiSTer.ini 저장 실패: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function cardScriptsDir(mountPoint) {
  const root = String(mountPoint || '').replace(/\//g, '\\');
  const normalizedRoot = root.endsWith('\\') ? root : `${root}\\`;
  if (!normalizedRoot || normalizedRoot.length < 2) throw new Error('대상 카드 경로가 올바르지 않습니다.');
  return path.join(normalizedRoot, 'Scripts');
}

// 추천 MiSTer 스크립트(raw .sh)를 받아 카드의 Scripts 폴더에 넣는다(미스터 Scripts 메뉴에서 실행). LF 유지.
async function installMisterScriptToCard(request = {}) {
  try {
    const fileName = String(request.fileName || '').replace(/[\\/]/g, '');
    const url = String(request.url || '');
    if (!/\.sh$/i.test(fileName)) throw new Error('올바른 스크립트 파일명이 아닙니다.');
    if (!/^https:\/\//i.test(url)) throw new Error('허용되지 않는 URL입니다.');
    const scriptsDir = cardScriptsDir(request.mountPoint);
    await fs.mkdir(scriptsDir, { recursive: true });
    const res = await globalThis.fetch(url, { headers: { 'User-Agent': 'Hello-Mister' } });
    if (!res.ok) throw new Error(`다운로드 HTTP ${res.status}`);
    const text = (await res.text()).replace(/\r\n/g, '\n'); // MiSTer 스크립트는 LF 유지
    if (!text.trim()) throw new Error('빈 스크립트를 받았습니다.');
    const dest = path.join(scriptsDir, fileName);
    await fs.writeFile(dest, text, 'utf8');
    return { ok: true, message: `${fileName}를 카드 Scripts 폴더에 넣었습니다.`, filePath: dest };
  } catch (error) {
    return { ok: false, message: `스크립트 넣기 실패: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// Zaparoo(TapTo) Core 설치 스크립트를 카드 Scripts 폴더에 넣는다. MiSTer용 릴리스 zip 안에는 자체 설치 스크립트
// zaparoo.sh(바이너리 내장) 하나가 들어 있어, 그것을 카드에 복사하고 미스터에서 한 번 실행하면 설치가 끝난다.
async function installZaparooToCard(event, request = {}) {
  const emit = (payload) => { try { event?.sender?.send('sd:script:progress', { task: 'zaparoo', ...payload }); } catch { /* renderer gone */ } };
  try {
    if (process.platform !== 'win32') throw new Error('Windows에서 동작합니다.');
    const scriptsDir = cardScriptsDir(request.mountPoint);
    await fs.mkdir(scriptsDir, { recursive: true });
    emit({ phase: 'resolve', message: 'Zaparoo 최신 릴리스를 확인합니다…' });
    const apiRes = await globalThis.fetch('https://api.github.com/repos/ZaparooProject/zaparoo-core/releases/latest', {
      headers: { 'User-Agent': 'Hello-Mister', Accept: 'application/vnd.github+json' },
    });
    if (!apiRes.ok) throw new Error(`GitHub API HTTP ${apiRes.status}`);
    const release = await apiRes.json();
    const asset = (release.assets || []).find((a) => /zaparoo-mister_arm.*\.zip$/i.test(a.name));
    if (!asset) throw new Error('MiSTer용 Zaparoo 자산(zaparoo-mister_arm…zip)을 찾지 못했습니다.');
    const tag = release.tag_name || '';

    const cacheDir = appOwnSubdir('sd-zaparoo');
    await fs.mkdir(cacheDir, { recursive: true });
    const zipPath = path.join(cacheDir, asset.name);
    let needDownload = true;
    try { const st = await fs.stat(zipPath); if (asset.size && st.size === asset.size) needDownload = false; } catch { /* not cached */ }
    if (needDownload) {
      emit({ phase: 'download', message: '다운로드 중…', receivedBytes: 0, totalBytes: asset.size, percent: 0 });
      const dl = await globalThis.fetch(asset.browser_download_url, { headers: { 'User-Agent': 'Hello-Mister' } });
      if (!dl.ok || !dl.body) throw new Error(`다운로드 HTTP ${dl.status}`);
      const total = Number(dl.headers.get('content-length')) || asset.size || 0;
      const tmp = `${zipPath}.part`;
      const out = createWriteStream(tmp);
      const reader = dl.body.getReader();
      let received = 0;
      let lastPct = -1;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
          received += chunk.length;
          const pct = total ? Math.floor((received / total) * 100) : undefined;
          if (pct !== lastPct) { lastPct = pct; emit({ phase: 'download', message: `다운로드 중… ${pct ?? ''}%`, receivedBytes: received, totalBytes: total, percent: pct }); }
        }
      } finally {
        await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
      }
      const st = await fs.stat(tmp);
      if (asset.size && st.size !== asset.size) { await fs.rm(tmp, { force: true }); throw new Error(`크기 불일치: ${st.size}/${asset.size}`); }
      await fs.rm(zipPath, { force: true }).catch(() => {});
      await fs.rename(tmp, zipPath);
    }
    emit({ phase: 'extract', message: '압축을 해제합니다…' });
    const extractDir = path.join(cacheDir, 'extract');
    await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {});
    await extractZipWindows(zipPath, extractDir);
    let srcScript = path.join(extractDir, 'zaparoo.sh');
    try {
      await fs.stat(srcScript);
    } catch {
      const entries = await fs.readdir(extractDir);
      const found = entries.find((name) => /zaparoo\.sh$/i.test(name));
      if (!found) throw new Error('압축 해제 후 zaparoo.sh를 찾지 못했습니다.');
      srcScript = path.join(extractDir, found);
    }
    const dest = path.join(scriptsDir, 'zaparoo.sh');
    await fs.copyFile(srcScript, dest);
    emit({ phase: 'done', message: '완료', percent: 100 });
    return { ok: true, message: `Zaparoo ${tag} 설치 스크립트를 카드에 넣었습니다. 미스터 Scripts 메뉴에서 zaparoo 를 한 번 실행하세요.`, filePath: dest };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ phase: 'error', message });
    return { ok: false, message: `Zaparoo 설치 스크립트 넣기 실패: ${message}` };
  }
}

// removable 카드를 안전하게 꺼낸다(Shell COM Eject verb, 관리자 권한 불필요·best-effort).
async function ejectDrive(request = {}) {
  try {
    if (process.platform !== 'win32') throw new Error('꺼내기는 Windows에서만 지원됩니다.');
    const letter = String(request.driveLetter || request.mountPoint || '').replace(/[:\\]+$/, '').trim().toUpperCase();
    if (!letter) throw new Error('대상 드라이브 문자를 확인할 수 없습니다.');
    const cmd = [
      "$ErrorActionPreference='Stop';",
      '$sh = New-Object -ComObject Shell.Application;',
      '$drv = $sh.Namespace(17).ParseName(' + psQuote(`${letter}:`) + ');',
      "if ($null -eq $drv) { Write-Output 'NOTFOUND'; exit 2 }",
      "$drv.InvokeVerb('Eject');",
      'Start-Sleep -Milliseconds 800;',
      "Write-Output 'OK'",
    ].join(' ');
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { windowsHide: true, maxBuffer: 1024 * 256 });
    if (/NOTFOUND/.test(stdout)) return { ok: false, message: `드라이브 ${letter}: 를 찾지 못했습니다.` };
    return { ok: true, message: `${letter}: 안전 꺼내기 명령을 보냈습니다. 카드를 분리하세요.` };
  } catch (error) {
    return { ok: false, message: `꺼내기 실패: ${error instanceof Error ? error.message : String(error)} (쓰기가 끝났다면 수동으로 분리해도 됩니다)` };
  }
}

// PC가 현재 볼 수 있는 주변 Wi‑Fi SSID 목록을 반환한다(수동 입력 오타 방지용).
// netsh 출력은 OEM 코드페이지라 chcp 65001로 UTF-8 전환 후 읽어 한글 SSID도 보존한다.
async function scanWifiNetworks() {
  try {
    if (process.platform !== 'win32') return { ok: false, networks: [], message: 'Wi‑Fi 검색은 Windows에서만 지원됩니다.' };
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'chcp 65001 > $null; netsh wlan show networks mode=ssid'],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
    );
    const networks = [];
    const seen = new Set();
    for (const line of String(stdout).split(/\r?\n/)) {
      const match = line.match(/^\s*SSID\s+\d+\s*:\s*(.+?)\s*$/);
      if (match && match[1] && !seen.has(match[1])) {
        seen.add(match[1]);
        networks.push(match[1]);
      }
    }
    if (!networks.length) {
      if (/no wireless|무선 인터페이스|인터페이스가 없|There is no/i.test(stdout)) {
        return { ok: false, networks: [], message: '이 PC에서 무선 어댑터를 찾지 못했습니다. SSID를 직접 입력하세요.' };
      }
      return { ok: false, networks: [], message: '주변 Wi‑Fi를 찾지 못했습니다. SSID를 직접 입력하세요.' };
    }
    return { ok: true, networks, message: `주변 Wi‑Fi ${networks.length}개를 찾았습니다.` };
  } catch (error) {
    return { ok: false, networks: [], message: `Wi‑Fi 검색 실패: ${error instanceof Error ? error.message : String(error)}` };
  }
}

const romFileExtensions = ['zip', 'nes', 'fds', 'sfc', 'smc', 'bs', 'md', 'gen', 'smd', 'sms', 'gg', 'gb', 'gbc', 'gba', 'pce', 'ngp', 'ngc', 'chd', 'cue', 'bin', 'iso', 'vhd', 'rom'];

function createLocalRomId(filePath) {
  return `rom-${crypto.createHash('sha1').update(filePath).digest('hex').slice(0, 16)}`;
}

async function localRomMetadata(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) return undefined;
  const extension = path.extname(filePath).toLowerCase();
  return {
    id: createLocalRomId(filePath),
    fileName: path.basename(filePath),
    filePath,
    parentFolder: path.dirname(filePath),
    extension,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime ? stat.mtime.toISOString() : undefined,
    hashStatus: 'not-calculated',
  };
}

async function scanRomFolder(rootPath, options = {}) {
  const maxFiles = Math.max(1, Math.min(Number(options.maxFiles) || 500, 2000));
  const recursive = Boolean(options.recursive);
  const warnings = [];
  const items = [];
  const queue = [rootPath];
  while (queue.length && items.length < maxFiles) {
    const folder = queue.shift();
    const entries = await fs.readdir(folder, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        if (recursive) queue.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase().replace(/^\./, '');
      if (!romFileExtensions.includes(extension)) continue;
      const metadata = await localRomMetadata(fullPath);
      if (metadata) items.push(metadata);
      if (items.length >= maxFiles) {
        warnings.push(`파일 ${maxFiles}개까지만 읽었습니다. 대량 파일 검사는 다음 단계에서 별도 최적화가 필요합니다.`);
        break;
      }
    }
    if (!recursive) break;
  }
  if (items.length >= 500) warnings.push('500개 이상 파일이 선택되었습니다. 대량 파일 검사 경고를 확인하세요.');
  return {
    ok: true,
    sourceType: 'folder',
    rootPath,
    items,
    warnings,
    message: `${items.length}개 ROM 후보를 읽었습니다. 실제 복사는 수행하지 않았습니다.`,
  };
}

function registerControllerIpc() {
  const registerControllerHandler = (channel, handler) => {
    if (registeredControllerIpcChannels.has(channel)) return;
    if (typeof ipcMain.removeHandler === 'function') {
      try {
        ipcMain.removeHandler(channel);
      } catch {
        // No previously registered handler.
      }
    }
    ipcMain.handle(channel, handler);
    registeredControllerIpcChannels.add(channel);
  };

  registerControllerHandler(CONTROLLER_FS_CHANNELS.scanInventory, (_event, request) => controllerFsScanInventory(request));
  registerControllerHandler(CONTROLLER_FS_CHANNELS.readFile, (_event, request) => controllerFsReadFile(request));
  registerControllerHandler(CONTROLLER_FS_CHANNELS.readControllerFile, (_event, request) => controllerFsReadFile(request));
  registerControllerHandler(CONTROLLER_FS_CHANNELS.createBackup, (_event, request) => controllerFsCreateBackup(request));
  registerControllerHandler(CONTROLLER_FS_CHANNELS.listBackups, (_event, request) => controllerFsListBackups(request));
  registerControllerHandler(CONTROLLER_FS_CHANNELS.readBackup, (_event, request) => controllerFsReadBackup(request));
  registerControllerHandler(CONTROLLER_FS_CHANNELS.restoreBackup, (_event, request) => controllerFsRestoreBackup(request));
  registerControllerHandler(CONTROLLER_FS_CHANNELS.listConnectedDevices, (_event, request) => controllerFsListConnectedDevices(request));
  registerControllerHandler(CONTROLLER_FS_CHANNELS.readInputCaps, (_event, request) => controllerFsReadInputCaps(request));
  registerControllerHandler(CONTROLLER_FS_CHANNELS.cloneMappings, (_event, request) => controllerFsCloneMappings(request));
  registerControllerHandler(CONTROLLER_FS_CHANNELS.autoMap, (_event, request) => controllerFsAutoMap(request));
  registerControllerHandler(CONTROLLER_FS_CHANNELS.startInputMonitor, (event, request) => controllerFsStartInputMonitor(request, event));
  registerControllerHandler(CONTROLLER_FS_CHANNELS.stopInputMonitor, (_event, request) => controllerFsStopInputMonitor(request));
  registerControllerHandler(CONTROLLER_FS_CHANNELS.listMaps, (_event, request) => controllerFsListMaps(request));
  registerControllerHandler(CONTROLLER_FS_CHANNELS.readMap, (_event, request) => controllerFsReadMap(request));
  registerControllerHandler(CONTROLLER_FS_CHANNELS.readAllMaps, (_event, request) => controllerFsReadAllMaps(request));
  registerControllerHandler(CONTROLLER_FS_CHANNELS.writeMap, (_event, request) => controllerFsWriteMap(request));
  registerControllerHandler(CONTROLLER_FS_CHANNELS.writeMaps, (_event, request) => controllerFsWriteMaps(request));
  registerControllerHandler(CONTROLLER_FS_CHANNELS.readArcadeButtons, (_event, request) => controllerFsReadArcadeButtons(request));
  registerControllerHandler(CONTROLLER_FS_CHANNELS.readArcadeIndex, (_event, request) => controllerFsReadArcadeIndex(request));
}

function registerIpc() {
  
  ipcMain.handle('zaparoo:save-and-open-pdf', async (_event, payload) => {
    const filename = safeExportFilename(payload?.filename, 'hello-mister-card-stickers.pdf');
    const exportsDir = appDataPath('exports', 'pdf');
    await fs.mkdir(exportsDir, { recursive: true });
    const filePath = path.join(exportsDir, filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
    const bytes = normalizeBytePayload(payload?.bytes);
    await fs.writeFile(filePath, Buffer.from(bytes));
    const openError = await shell.openPath(filePath);
    return { ok: openError.length === 0, path: filePath, error: openError || undefined };
  });
  ipcMain.handle('zaparoo:save-file', async (_event, payload) => {
    try {
      const mimeType = typeof payload?.mimeType === 'string' ? payload.mimeType : 'application/octet-stream';
      const filename = safeExportFilename(payload?.filename, 'hello-mister-export');
      const bytes = normalizeBytePayload(payload?.bytes);
      if (bytes.byteLength === 0) return { ok: false, error: 'No file data was generated.' };
      const exportsDir = appDataPath('exports');
      await fs.mkdir(exportsDir, { recursive: true });
      const result = await dialog.showSaveDialog({ defaultPath: path.join(exportsDir, filename), filters: saveDialogFilters(mimeType, filename) });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      await fs.mkdir(path.dirname(result.filePath), { recursive: true });
      await fs.writeFile(result.filePath, Buffer.from(bytes));
      return { ok: true, path: result.filePath, size: bytes.byteLength };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('zaparoo:open-file', async (_event, payload) => {
    try {
      const filePath = typeof payload?.filePath === 'string' ? payload.filePath : '';
      if (!filePath) return { ok: false, error: 'Missing file path.' };
      const openError = await shell.openPath(filePath);
      return { ok: openError.length === 0, error: openError || undefined };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('zaparoo:capture-html-png', async (_event, payload) => {
    let captureWindow;
    try {
      const html = typeof payload?.html === 'string' ? payload.html : '';
      const width = Math.max(1, Math.min(9000, Math.round(Number(payload?.width) || 1)));
      const height = Math.max(1, Math.min(9000, Math.round(Number(payload?.height) || 1)));
      if (!html) return { ok: false, error: 'Missing capture HTML.' };
      captureWindow = new BrowserWindow({
        show: false,
        width,
        height,
        useContentSize: true,
        webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
      });
      await captureWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await captureWindow.webContents.executeJavaScript(`Promise.all([document.fonts?.ready?.catch(() => undefined), new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))])`);
      const image = await captureWindow.webContents.capturePage({ x: 0, y: 0, width, height });
      const bytes = image.toPNG();
      return { ok: true, bytes, size: bytes.length };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (captureWindow && !captureWindow.isDestroyed()) captureWindow.destroy();
    }
  });
  ipcMain.handle('zaparoo:read-file-data-url', async (_event, payload) => {
    try {
      const requestedPath = typeof payload?.filePath === 'string' ? payload.filePath : '';
      if (!requestedPath) return { ok: false, error: 'Missing file path.' };
      const filePath = path.resolve(requestedPath);
      const mimeType = mimeTypeForImagePath(filePath);
      if (!mimeType) return { ok: false, error: 'Unsupported image file type.' };
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) return { ok: false, error: 'Path is not a file.' };
      if (stat.size > 100 * 1024 * 1024) return { ok: false, error: 'Image file is too large to inline for export.' };
      const bytes = await fs.readFile(filePath);
      return { ok: true, dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`, mimeType, size: bytes.length };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('zaparoo:fetch-image-data-url', async (_event, payload) => {
    try {
      const requestedUrl = typeof payload?.url === 'string' ? payload.url : '';
      if (!requestedUrl) return { ok: false, error: 'Missing image URL.' };
      const parsed = new URL(requestedUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, error: 'Only HTTP image URLs can be fetched through this bridge.' };
      const response = await globalThis.fetch(parsed.href, { redirect: 'follow' });
      if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
      return imageResponseToDataUrl(response, parsed.pathname);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('app:runtime-environment', () => getRuntimeEnvironment());
  ipcMain.handle('app:data-status', () => getAppDataStorageStatus());
  ipcMain.handle('app:open-data-folder', async () => {
    const target = app.getPath('userData');
    const error = await shell.openPath(target);
    if (error) return { ok: false, path: target, message: `앱 데이터 폴더를 열지 못했습니다. ${error}` };
    return { ok: true, path: target, message: `앱 데이터 폴더를 열었습니다. ${target}` };
  });
  ipcMain.handle('app:open-external', async (_event, rawUrl) => {
    const target = String(rawUrl || '').trim();
    if (!/^https?:\/\//i.test(target)) {
      return { ok: false, message: 'http/https URL만 외부 브라우저로 열 수 있습니다.' };
    }
    try {
      await shell.openExternal(target);
      return { ok: true, url: target };
    } catch (error) {
      return { ok: false, url: target, message: `외부 브라우저를 열지 못했습니다. ${error instanceof Error ? error.message : String(error)}` };
    }
  });
  ipcMain.handle('app:save-card-image', async (_event, payload) => {
    try {
      const rawName = String(payload?.fileName || '').trim();
      const bytes = payload?.bytes;
      if (!bytes || !bytes.length) return { ok: false, message: '저장할 이미지 데이터가 없습니다.' };
      const ext = (path.extname(rawName) || '.png').toLowerCase();
      const baseName = sanitizeCardImageBaseName(payload?.baseName || path.basename(rawName, path.extname(rawName)) || 'card-image');
      const folder = cardImageBaseDir();
      await fs.mkdir(folder, { recursive: true });
      const target = await uniqueCardImagePath(folder, baseName, ext);
      await fs.writeFile(target, Buffer.from(bytes));
      return { ok: true, path: target, folder, fileName: path.basename(target) };
    } catch (error) {
      return { ok: false, message: `이미지 저장 실패: ${error instanceof Error ? error.message : String(error)}` };
    }
  });
  ipcMain.handle('mister:list-network-interfaces', () => collectNetworkInterfaces());
  ipcMain.handle('mister:scan-candidates', (_event, options) => scanCandidates(options));
  ipcMain.handle('mister:probe-reachable', async (_event, request) => {
    const host = String(request?.host || '').trim();
    if (!host) return { ok: false, open: false };
    const result = await probePort(host, Number(request?.port) || 22, Number(request?.timeoutMs) || 2500);
    return { ok: true, open: Boolean(result.open), latencyMs: result.latencyMs };
  });
  ipcMain.handle('mister:profiles:load', async () => {
    const profiles = await readJsonFile(appDataPath('profiles', profileFileName), []);
    return Array.isArray(profiles) ? profiles.map(sanitizeProfile) : [];
  });
  ipcMain.handle('mister:active-profile:get', async () => activeMisterProfile);
  ipcMain.handle('mister:active-profile:set', async (_event, profile) => setActiveMisterProfile(profile));
  ipcMain.handle('mister:active-profile:clear', async (_event, profileId) => clearActiveMisterProfile(profileId));
  ipcMain.handle('mister:profiles:save', async (_event, profile) => {
    const filePath = appDataPath('profiles', profileFileName);
    const profiles = await readJsonFile(filePath, []);
    const passwordStatus = await getProfilePasswordStatus(profile.id);
    const sanitized = sanitizeProfile({ ...profile, passwordSaved: passwordStatus.saved, passwordStorageStatus: passwordStatus.saved ? 'stored' : passwordStatus.storageAvailable ? 'missing' : 'unavailable' });
    const next = [...(Array.isArray(profiles) ? profiles : []).filter((item) => item.id !== sanitized.id), sanitized].map(sanitizeProfile);
    await writeJsonFile(filePath, next);
    const summaries = await loadProfileSummaries();
    const existingSummary = summaries.find((summary) => summary.profileId === sanitized.id);
    if (existingSummary) {
      await upsertProfileSummary({
        ...existingSummary,
        alias: sanitized.alias,
        host: sanitized.ipAddress,
        hostname: sanitized.hostname || existingSummary.hostname,
        mac: sanitized.macAddress || existingSummary.mac,
      });
    }
    return next;
  });
  ipcMain.handle('mister:profiles:password:save', async (_event, request) => saveProfilePassword(request?.profileId, request?.password));
  ipcMain.handle('mister:profiles:password:status', async (_event, request) => getProfilePasswordStatus(request?.profileId));
  ipcMain.handle('mister:profiles:password:delete', async (_event, request) => deleteProfilePassword(request?.profileId));
  ipcMain.handle('mister:profiles:set-default', async (_event, profileId) => {
    const filePath = appDataPath('profiles', profileFileName);
    const profiles = await readJsonFile(filePath, []);
    const next = (Array.isArray(profiles) ? profiles : []).map((item) => sanitizeProfile({ ...item, defaultDevice: item.id === profileId, isDefault: item.id === profileId }));
    await writeJsonFile(filePath, next);
    return next;
  });
  ipcMain.handle('mister:profiles:delete', async (_event, request) => {
    const profileId = String(request?.profileId || '');
    const options = request?.options || {};
    const filePath = appDataPath('profiles', profileFileName);
    const profiles = await readJsonFile(filePath, []);
    const sanitized = Array.isArray(profiles) ? profiles.map(sanitizeProfile) : [];
    const removed = sanitized.find((profile) => profile.id === profileId);
    const next = sanitized
      .filter((profile) => profile.id !== profileId)
      .map((profile) => sanitizeProfile({ ...profile, defaultDevice: false, isDefault: false, autoConnect: false }));
    await writeJsonFile(filePath, next);
    await clearProfileSummary(profileId);
    await deleteProfilePassword(profileId);
    sshSessions.delete(profileId);
    releasePooledClient(profileId);
    clearActiveMisterProfile(profileId);
    if (removed && options.removeKnownHost) {
      await removeKnownHost({ host: removed.ipAddress, port: removed.port || 22 });
    }
    return next;
  });
  ipcMain.handle('mister:profiles:summaries:load', async () => loadProfileSummaries());
  ipcMain.handle('mister:profiles:summaries:save', async (_event, summary) => upsertProfileSummary(summary));
  ipcMain.handle('mister:profiles:summaries:clear', async (_event, profileId) => clearProfileSummary(profileId));
  ipcMain.handle('zaparoo:status', async (_event, request) => zaparooStatus(request?.target));
  ipcMain.handle('zaparoo:version', async (_event, request) => zaparooVersion(request?.target ?? request));
  ipcMain.handle('zaparoo:health', async (_event, request) => zaparooHealth(request?.target ?? request));
  ipcMain.handle('zaparoo:media-search', async (_event, request) => zaparooSearchMedia(request));
  ipcMain.handle('zaparoo:media-browse', async (_event, request) => zaparooBrowseMedia(request));
  ipcMain.handle('zaparoo:media-lookup', async (_event, request) => zaparooLookupMedia(request));
  ipcMain.handle('zaparoo:run', async (_event, request) => zaparooRun(request));
  ipcMain.handle('zaparoo:readers', async (_event, request) => zaparooReaders(request?.target ?? request));
  ipcMain.handle('zaparoo:readers-write', async (_event, request) => zaparooWriteReader(request));
  ipcMain.handle('zaparoo:token-read-once', async (_event, request) => zaparooReadTokenOnce(request));
  ipcMain.handle('zaparoo:token-read-cancel', async (_event, request) => zaparooCancelTokenRead(request));
  ipcMain.handle('zaparoo:config:diagnose', async (_event, request) => readZaparooConfigDiagnostics(request?.sessionId));
  ipcMain.handle('zaparoo:config:preview-apply', async (_event, request) => zaparooPreviewConfigApply(request));
  ipcMain.handle('zaparoo:config:apply', async (_event, request) => zaparooApplyConfigPatch(request));
  ipcMain.handle('mister:ssh:inspect-host-key', async (_event, request) => inspectHostKey(request));
  ipcMain.handle('mister:ssh:trust-host-key', async (_event, request) => trustHostKey(request));
  ipcMain.handle('mister:ssh:remove-known-host', async (_event, request) => removeKnownHost(request));
  ipcMain.handle('mister:ssh:list-known-hosts', async () => loadKnownHosts());
  ipcMain.handle('mister:ssh:list-known-host-history', async () => loadKnownHostHistory());
  ipcMain.handle('mister:ssh:fingerprint', async (_event, credential) => {
    try {
      return await runFingerprint(credential);
    } catch (error) {
      return failedFingerprintFromError(credential, error);
    }
  });
  ipcMain.handle('mister:ssh:fingerprint-profile', async (_event, request) => {
    try {
      return await fingerprintStoredProfile(request);
    } catch (error) {
      return failedFingerprintFromError({ profileId: request?.profileId, host: '', port: 22, username: 'root' }, error);
    }
  });
  ipcMain.handle('mister:ssh:fingerprint-session', async (_event, sessionId) => {
    const session = getSession(sessionId);
    const credential = {
      profileId: session.sessionId,
      host: session.host,
      port: session.port,
      username: session.username,
      password: session.password,
      privateKey: session.privateKey,
      passphrase: session.passphrase,
    };
    try {
      return await runFingerprint(credential);
    } catch (error) {
      return failedFingerprintFromError(credential, error);
    }
  });
  ipcMain.handle('mister:ssh:clear-session', async (_event, sessionId) => {
    const existed = sshSessions.delete(sessionId);
    releasePooledClient(sessionId);
    return { ok: true, message: existed ? '세션 인증 정보를 메모리에서 지웠습니다.' : '이미 지워졌거나 존재하지 않는 세션입니다.' };
  });
  ipcMain.handle('mister:ssh:list-sessions', async () => Array.from(sshSessions.values()).map(publicSessionState));
  ipcMain.handle('mister:remote:read-ini', async (_event, sessionId) => {
    try {
      return await readRemoteIni(sessionId);
    } catch (error) {
      const classified = classifySshError(error);
      return { ok: false, sessionId, path: remotePaths.misterIni, content: '', readAt: new Date().toISOString(), sizeBytes: 0, message: classified.message, error: classified };
    }
  });
  ipcMain.handle('mister:remote:list-games', async (_event, sessionId, options) => {
    try {
      return await listGameFolders(sessionId, options);
    } catch (error) {
      const classified = classifySshError(error);
      return { ok: false, sessionId, items: [], readAt: new Date().toISOString(), message: classified.message, error: classified.message, errorCode: classified.code };
    }
  });
  ipcMain.handle('mister:remote:list-game-folder-files', async (_event, request) => {
    try {
      return await listRemoteGameFolderFiles(request);
    } catch (error) {
      const classified = classifySshError(error);
      return { ok: false, sessionId: request.sessionId, items: [], readAt: new Date().toISOString(), message: classified.message, error: classified.message, errorCode: classified.code };
    }
  });
  ipcMain.handle('mister:remote:list-game-files-fast', async (_event, request) => {
    try {
      return await listRemoteGameFilesFast(request);
    } catch (error) {
      const classified = classifySshError(error);
      return { ok: false, sessionId: request?.sessionId, paths: [], readAt: new Date().toISOString(), message: classified.message, errorCode: classified.code };
    }
  });
  ipcMain.handle('mister:remote:list-arcade-cores', async (_event, request) => {
    try {
      return await listRemoteArcadeCores(request);
    } catch (error) {
      const classified = classifySshError(error);
      return { ok: false, sessionId: request?.sessionId, cores: {}, readAt: new Date().toISOString(), message: classified.message, errorCode: classified.code };
    }
  });
  ipcMain.handle('mister:remote:list-scripts', async (_event, sessionId) => {
    try {
      return await listScriptFiles(sessionId);
    } catch (error) {
      const classified = classifySshError(error);
      return { ok: false, sessionId, items: [], readAt: new Date().toISOString(), message: classified.message, error: classified.message, errorCode: classified.code };
    }
  });
  ipcMain.handle('mister:remote:read-script', async (_event, request) => {
    try {
      return await readScriptFile(request);
    } catch (error) {
      const classified = classifySshError(error);
      return { ok: false, sessionId: request.sessionId, items: { name: '', path: request.path, contentPreview: '' }, readAt: new Date().toISOString(), message: classified.message, error: classified.message, errorCode: classified.code };
    }
  });
  ipcMain.handle('diagnostics:save-package', async (_event, diagnostic) => {
    const safeDiagnostic = stripSecretsFromDiagnostic(diagnostic);
    const result = await dialog.showSaveDialog({
      title: '진단 패키지 저장',
      defaultPath: `hello-mister-diagnostic-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true, message: '진단 패키지 저장이 취소되었습니다.' };
    await fs.writeFile(result.filePath, JSON.stringify(safeDiagnostic, null, 2), 'utf8');
    return { ok: true, filePath: result.filePath, message: `진단 패키지를 저장했습니다: ${result.filePath}` };
  });
  ipcMain.handle('tasks:load', async () => loadTaskLogs());
  ipcMain.handle('tasks:save', async (_event, tasks) => saveTaskLogs(tasks));
  ipcMain.handle('tasks:clear', async () => {
    await saveTaskLogs([]);
    return { ok: true, message: '작업 로그를 비웠습니다.' };
  });
  ipcMain.handle('tasks:export', async (_event, tasks) => {
    const safeTasks = Array.isArray(tasks) ? tasks.map(sanitizeTaskLog).slice(0, 100) : [];
    const result = await dialog.showSaveDialog({
      title: '작업 로그 내보내기',
      defaultPath: `hello-mister-task-log-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true, message: '작업 로그 내보내기가 취소되었습니다.' };
    await fs.writeFile(result.filePath, JSON.stringify(safeTasks, null, 2), 'utf8');
    return { ok: true, filePath: result.filePath, message: `작업 로그를 저장했습니다: ${result.filePath}` };
  });
  ipcMain.handle('sd:list-drives', () => listWindowsDrives());
  ipcMain.handle('sd:inspect-structure', (_event, request) => inspectSdStructure(request));
  ipcMain.handle('sd:resolve-mr-fusion', (event, options) => resolveMrFusionImage(event, options));
  ipcMain.handle('sd:download-mr-fusion', (event, options) => downloadMrFusionImage(event, options));
  ipcMain.handle('sd:flash-image', (event, request) => flashSdImage(event, request));
  ipcMain.handle('sd:write-wpa-supplicant', (_event, request) => writeWpaSupplicant(request));
  ipcMain.handle('sd:write-mister-ini', (_event, request) => writeMisterIni(request));
  ipcMain.handle('sd:install-mister-script', (_event, request) => installMisterScriptToCard(request));
  ipcMain.handle('sd:install-zaparoo', (event, request) => installZaparooToCard(event, request));
  ipcMain.handle('sd:eject-drive', (_event, request) => ejectDrive(request));
  ipcMain.handle('sd:scan-wifi-networks', () => scanWifiNetworks());
  ipcMain.handle('file:select-mr-fusion-image', async () => {
    // 다운로드 캐시(sd-images) 폴더가 있으면 거기서 바로 열린다.
    let defaultPath;
    try {
      await fs.access(sdImageCacheDir());
      defaultPath = sdImageCacheDir();
    } catch { /* 폴더 없으면 기본 위치 */ }
    const result = await dialog.showOpenDialog({
      title: 'Mr. Fusion 이미지 선택',
      defaultPath,
      properties: ['openFile'],
      filters: [{ name: 'Mr. Fusion 이미지', extensions: ['img', 'zip', 'xz'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
    return { cancelled: false, filePath: result.filePaths[0], fileName: path.basename(result.filePaths[0]) };
  });
  ipcMain.handle('rom:select-files', async () => {
    const result = await dialog.showOpenDialog({
      title: 'ROM 파일 선택',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'ROM 후보 파일', extensions: romFileExtensions }, { name: '모든 파일', extensions: ['*'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, cancelled: true, sourceType: 'files', items: [], warnings: [], message: 'ROM 파일 선택이 취소되었습니다.' };
    for (const filePath of result.filePaths) rememberRomFsLocalGrant(path.dirname(filePath));
    const items = (await Promise.all(result.filePaths.map((filePath) => localRomMetadata(filePath)))).filter(Boolean);
    const warnings = [];
    if (items.length >= 500) warnings.push('500개 이상 파일이 선택되었습니다. 대량 파일 검사 경고를 확인하세요.');
    return { ok: true, cancelled: false, sourceType: 'files', items, warnings, message: `${items.length}개 ROM 후보를 읽었습니다. 실제 복사는 수행하지 않았습니다.` };
  });
  ipcMain.handle('rom:select-folder', async (_event, options = {}) => {
    const result = await dialog.showOpenDialog({
      title: 'ROM 폴더 선택',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, cancelled: true, sourceType: 'folder', items: [], warnings: [], message: 'ROM 폴더 선택이 취소되었습니다.' };
    rememberRomFsLocalGrant(result.filePaths[0]);
    return scanRomFolder(result.filePaths[0], options);
  });
  ipcMain.handle('rom:select-backup-folder', async () => {
    const result = await dialog.showOpenDialog({
      title: 'ROM backup folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, cancelled: true, message: '백업 폴더 선택이 취소되었습니다.' };
    return { ok: true, folderPath: result.filePaths[0], message: '백업 위치를 dry-run 계획에만 반영했습니다. 실제 백업은 수행하지 않았습니다.' };
  });
  ipcMain.handle('stickers:select-image-files', async () => {
    const result = await dialog.showOpenDialog({
      title: '스티커 이미지 파일 선택',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '이미지 파일', extensions: stickerImageExtensions }, { name: '모든 파일', extensions: ['*'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, cancelled: true, sourceType: 'files', items: [], warnings: [], message: '이미지 파일 선택이 취소되었습니다.' };
    const items = (await Promise.all(result.filePaths.map((filePath) => localStickerImageMetadata(filePath)))).filter(Boolean);
    const warnings = [];
    if (items.length >= 300) warnings.push('300개 이상 이미지가 선택되었습니다. 썸네일 표시가 느릴 수 있습니다.');
    return { ok: true, cancelled: false, sourceType: 'files', items, warnings, message: `${items.length}개 이미지 후보를 읽었습니다. 원본 파일은 수정하지 않았습니다.` };
  });
  ipcMain.handle('stickers:select-image-folder', async (_event, options = {}) => {
    const result = await dialog.showOpenDialog({
      title: '스티커 이미지 폴더 선택',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, cancelled: true, sourceType: 'folder', items: [], warnings: [], message: '이미지 폴더 선택이 취소되었습니다.' };
    return scanStickerImageFolder(result.filePaths[0], options);
  });
  ipcMain.handle('stickers:images:load', () => loadStickerStore('images'));
  ipcMain.handle('stickers:images:save', (_event, store) => saveStickerStore('images', store));
  ipcMain.handle('stickers:templates:load', () => loadStickerStore('templates'));
  ipcMain.handle('stickers:templates:save', (_event, store) => saveStickerStore('templates', store));
  ipcMain.handle('stickers:cards:load', () => loadStickerStore('cards'));
  ipcMain.handle('stickers:cards:save', (_event, store) => saveStickerStore('cards', store));
  ipcMain.handle('stickers:sheets:load', () => loadStickerStore('sheets'));
  ipcMain.handle('stickers:sheets:save', (_event, store) => saveStickerStore('sheets', store));
  ipcMain.handle('rom:plans:load', async () => loadSavedRomPlans());
  ipcMain.handle('rom:plans:save', async (_event, plan) => saveSavedRomPlan(plan));
  ipcMain.handle('rom:plans:delete', async (_event, planId) => deleteSavedRomPlan(planId));
  ipcMain.handle('file:sha256', (_event, filePath) => sha256File(filePath));
  ipcMain.handle('file:save-text', async (_event, options) => {
    const result = await dialog.showSaveDialog({
      title: '파일로 내보내기',
      defaultPath: options.defaultPath,
      filters: options.filters || [{ name: '텍스트 파일', extensions: ['txt'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true, message: '저장이 취소되었습니다.' };
    await fs.writeFile(result.filePath, options.content, 'utf8');
    return { ok: true, filePath: result.filePath, message: `파일을 저장했습니다: ${result.filePath}` };
  });
  ipcMain.handle('romFs:listRemote', (_event, request) => romFsListRemote(request));
  ipcMain.handle('romFs:statRemote', (_event, request) => romFsStatRemote(request));
  ipcMain.handle('romFs:checkCapability', (_event, request) => romFsCheckCapability(request));
  ipcMain.handle('romFs:selectLocalFolder', () => romFsSelectLocalFolder());
  ipcMain.handle('romFs:listLocalFolder', (_event, request) => romFsListLocalFolder(request));
  ipcMain.handle('romFs:listLocalTreeRoots', () => romFsListLocalTreeRoots());
  ipcMain.handle('romFs:listLocalTreeFolder', (_event, request) => romFsListLocalTreeFolder(request));
  ipcMain.handle('romFs:copyLocalToMister', (_event, request) => romFsCopyLocalToMister(request));
  ipcMain.handle('romFs:copyMisterToLocal', (_event, request) => romFsCopyMisterToLocal(request));
  ipcMain.handle('romFs:copyMisterToMister', (_event, request) => romFsCopyMisterToMister(request));
  ipcMain.handle('romFs:moveRemote', (_event, request) => romFsMoveRemote(request));
  ipcMain.handle('romFs:renameRemote', (_event, request) => romFsRenameRemote(request));
  ipcMain.handle('romFs:trashRemote', (_event, request) => romFsTrashRemote(request));
  ipcMain.handle('romFs:deleteRemote', (_event, request) => romFsDeleteRemote(request));
  ipcMain.handle('romFs:restoreRemote', (_event, request) => romFsRestoreRemote(request));
  ipcMain.handle('romFs:createRemoteFolder', (_event, request) => romFsCreateRemoteFolder(request));
  ipcMain.handle('romFs:createLocalFolder', (_event, request) => romFsCreateLocalFolder(request));
  ipcMain.handle('iniFs:checkWriteCapability', (_event, request) => iniFsCheckWriteCapability(request));
  ipcMain.handle('iniFs:listRemoteIni', (_event, request) => iniFsListRemoteIni(request));
  ipcMain.handle('iniFs:readRemoteIni', (_event, request) => iniFsReadRemoteIni(request));
  ipcMain.handle('iniFs:writeRemoteIniWithBackup', (_event, request) => iniFsWriteRemoteIniWithBackup(request));
  ipcMain.handle('iniFs:createBackup', (_event, request) => iniFsCreateBackup(request));
  ipcMain.handle('iniFs:listBackups', (_event, request) => iniFsListBackups(request));
  ipcMain.handle('iniFs:previewBackup', (_event, request) => iniFsPreviewBackup(request));
  ipcMain.handle('iniFs:deleteBackup', (_event, request) => iniFsDeleteBackup(request));
  ipcMain.handle('iniFs:restoreBackup', (_event, request) => iniFsRestoreBackup(request));
  ipcMain.handle('iniFs:trashIni', (_event, request) => iniFsTrashIni(request));
  ipcMain.handle('iniFs:listTrash', (_event, request) => iniFsListTrash(request));
  ipcMain.handle('iniFs:restoreTrashedIni', (_event, request) => iniFsRestoreTrashedIni(request));
  ipcMain.handle('iniFs:deleteTrashedIni', (_event, request) => iniFsDeleteTrashedIni(request));
  ipcMain.handle('iniFs:emptyTrash', (_event, request) => iniFsEmptyTrash(request));
  ipcMain.handle('iniFs:exportIniLocal', (_event, request) => iniFsExportIniLocal(request));
  ipcMain.handle('iniFs:importIniLocal', (_event, request) => iniFsImportIniLocal(request));
  ipcMain.handle('iniFs:metadata:load', (_event, request) => loadIniMetadata(request?.profileId || activeMisterProfile?.profileId));
  ipcMain.handle('iniFs:metadata:save', (_event, store) => saveIniMetadata(store));

  ipcMain.handle('scriptFs:checkCapability', (_event, request) => scriptFsCheckCapability(request));
  ipcMain.handle('scriptFs:listRemote', (_event, request) => scriptFsListRemote(request));
  ipcMain.handle('scriptFs:readRemote', (_event, request) => scriptFsReadRemote(request));
  ipcMain.handle('scriptFs:writeRemote', (_event, request) => scriptFsWriteRemote(request));
  ipcMain.handle('scriptFs:createBackup', (_event, request) => scriptFsCreateBackup(request));
  ipcMain.handle('scriptFs:listBackups', (_event, request) => scriptFsListBackups(request));
  ipcMain.handle('scriptFs:previewBackup', (_event, request) => scriptFsPreviewBackup(request));
  ipcMain.handle('scriptFs:restoreBackup', (_event, request) => scriptFsRestoreBackup(request));
  ipcMain.handle('scriptFs:deleteBackup', (_event, request) => scriptFsDeleteBackup(request));
  ipcMain.handle('scriptFs:trash', (_event, request) => scriptFsTrash(request));
  ipcMain.handle('scriptFs:listTrash', (_event, request) => scriptFsListTrash(request));
  ipcMain.handle('scriptFs:restoreTrashed', (_event, request) => scriptFsRestoreTrashed(request));
  ipcMain.handle('scriptFs:deleteTrashed', (_event, request) => scriptFsDeleteTrashed(request));
  ipcMain.handle('scriptFs:emptyTrash', (_event, request) => scriptFsEmptyTrash(request));
  ipcMain.handle('scriptFs:exportLocal', (_event, request) => scriptFsExportLocal(request));
  ipcMain.handle('scriptFs:importLocal', (_event, request) => scriptFsImportLocal(request));
  ipcMain.handle('scriptFs:run', (event, request) => scriptFsRun(request, event));
  ipcMain.handle('scriptFs:readRunLog', (_event, request) => scriptFsReadRunLog(request));
  ipcMain.handle('scriptFs:copyToDevice', (_event, request) => scriptFsCopyToDevice(request));
  ipcMain.handle('scriptFs:installFromUrl', (_event, request) => scriptFsInstallFromUrl(request));
  registerControllerIpc();
}

const controllerCandidateDirs = [
  '/media/fat',
  '/media/fat/config',
  '/media/fat/config/inputs',
  '/media/fat/config/input',
  '/media/fat/config/joystick',
  '/media/fat/config/joysticks',
  '/media/fat/config/controllers',
  '/media/fat/config/gamecontrollerdb',
  '/media/fat/Scripts',
];
const controllerBackupRoot = '/media/fat/.hello-mister-backups/controllers';
const controllerTrashRoot = '/media/fat/.hello-mister-trash/controllers';
const controllerReadRoots = ['/media/fat', '/media/fat/config', '/media/fat/Scripts', controllerBackupRoot];
const controllerScanTimeoutMs = 30_000;
const controllerFolderReadTimeoutMs = 5_000;

function createControllerFsError(code, message, detail) {
  const error = new Error(message);
  error.code = code;
  if (detail) error.detail = detail;
  return error;
}

function sanitizeControllerFsMessage(error) {
  return String(error?.message || error || '컨트롤러 설정 파일 작업에 실패했습니다.').replace(/password|privateKey|passphrase|token/gi, '[secret]');
}

function controllerScanNow() {
  return new Date().toISOString();
}

function controllerScanDuration(startedAt, finishedAt) {
  return Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
}

function controllerTimeout(promise, ms, message, code) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = globalThis.setTimeout(() => reject(createControllerFsError(code, message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => globalThis.clearTimeout(timer));
}

function summarizeControllerInventoryStatus(files, scannedRoots, failedPaths, errors) {
  if (scannedRoots.length > 0 && failedPaths.length > 0) return 'partial';
  if (scannedRoots.length === 0 && failedPaths.length > 0) return 'error';
  if (errors.length > 0) return 'error';
  if (files.length === 0) return 'empty';
  return 'ready';
}

function controllerInventoryMessage(status, files, failedPaths) {
  if (status === 'ready') return '컨트롤러 설정 파일을 불러왔습니다.';
  if (status === 'empty') return '컨트롤러 관련 후보 파일을 찾지 못했습니다. 개발자 상세에서 스캔 경로를 확인하세요.';
  if (status === 'partial') return '일부 경로를 읽지 못했습니다. 발견한 파일과 실패 경로를 확인하세요.';
  if (status === 'timeout') return '컨트롤러 설정 파일 읽기가 시간 초과되었습니다. 연결 상태를 확인하고 다시 시도하세요.';
  if (failedPaths.length > 0) return failedPaths[0].message;
  return '컨트롤러 설정 파일을 읽지 못했습니다.';
}

function controllerInventoryResult({ ok, status, profile, startedAt, finishedAt, candidateFolders = [], files = [], failedPaths = [], errors = [], errorCode }) {
  const scannedRoots = candidateFolders.filter((folder) => folder.status === 'read').map((folder) => folder.path);
  const durationMs = controllerScanDuration(startedAt, finishedAt);
  const message = controllerInventoryMessage(status, files, failedPaths);
  return {
    ok,
    status,
    profileId: profile?.id,
    alias: profile?.alias,
    host: profile?.ipAddress,
    port: profile?.port,
    startedAt,
    finishedAt,
    durationMs,
    scannedAt: finishedAt,
    candidateRoots: controllerCandidateDirs,
    scannedRoots,
    candidateFolders,
    files,
    failedPaths,
    errors,
    summary: {
      scannedFolderCount: scannedRoots.length,
      candidateFileCount: files.length,
      failedPathCount: failedPaths.length,
    },
    diagnostics: {
      activeProfile: profile ? {
        profileId: profile.id,
        alias: profile.alias,
        host: profile.ipAddress,
        port: profile.port,
      } : undefined,
      candidateRoots: controllerCandidateDirs,
      scannedRoots,
      failedRoots: failedPaths,
      errors,
      startedAt,
      finishedAt,
      durationMs,
      status,
    },
    message,
    errorCode,
  };
}

function normalizeControllerRemotePath(input) {
  const raw = String(input || '').trim().replace(/\\/g, '/');
  if (!raw.startsWith('/')) throw createControllerFsError('CONTROLLER_FS_PATH_BLOCKED', '원격 경로는 /media/fat 아래의 절대 경로여야 합니다.');
  const normalized = path.posix.normalize(raw);
  if (normalized.includes('\0') || normalized.split('/').includes('..')) {
    throw createControllerFsError('CONTROLLER_FS_PATH_BLOCKED', '원격 경로에 안전하지 않은 문자가 포함되어 있습니다.');
  }
  if (!normalized.startsWith('/media/fat')) {
    throw createControllerFsError('CONTROLLER_FS_PATH_BLOCKED', '컨트롤러 관리는 /media/fat 아래 경로만 읽을 수 있습니다.');
  }
  return normalized;
}

function isPathUnderControllerRoot(targetPath, root) {
  const normalized = normalizeControllerRemotePath(targetPath);
  return normalized === root || normalized.startsWith(`${root}/`);
}

function isControllerCandidateFileName(fileName) {
  return /^gamecontrollerdb/i.test(fileName)
    || /controller/i.test(fileName)
    || /joystick/i.test(fileName)
    || /input/i.test(fileName)
    || /\.(map|cfg|ini|txt)$/i.test(fileName);
}

function controllerFileKind(fileName, folderPath = '') {
  const haystack = `${folderPath}/${fileName}`.toLowerCase();
  if (/gamecontrollerdb/.test(haystack)) return { type: 'gamecontrollerdb', label: 'GameControllerDB' };
  if (/scripts/.test(haystack)) return { type: 'script', label: '스크립트 참고 파일' };
  if (/\.(map)$/i.test(fileName) || /joystick/.test(haystack)) return { type: 'joystick-map', label: '조이스틱 매핑' };
  if (/core|_input|input_/.test(haystack)) return { type: 'core-input', label: '코어별 입력 설정' };
  if (/input|controller/.test(haystack)) return { type: 'global-input', label: '기본 입력 설정' };
  return { type: 'other-config', label: '기타 설정 파일' };
}

function assertControllerReadPath(targetPath) {
  const normalized = normalizeControllerRemotePath(targetPath);
  const allowed = controllerReadRoots.some((root) => isPathUnderControllerRoot(normalized, root));
  if (!allowed) throw createControllerFsError('CONTROLLER_FS_PATH_BLOCKED', '컨트롤러 관리 읽기 범위 밖의 파일입니다.');
  const base = path.posix.basename(normalized);
  if (!isControllerCandidateFileName(base) && !isPathUnderControllerRoot(normalized, controllerBackupRoot)) {
    throw createControllerFsError('CONTROLLER_FS_NOT_CONTROLLER_FILE', '컨트롤러 관련 후보 파일만 읽을 수 있습니다.');
  }
  return normalized;
}

function assertControllerRestoreTargetPath(targetPath) {
  const normalized = assertControllerReadPath(targetPath);
  if (!isPathUnderControllerRoot(normalized, '/media/fat/config')) {
    throw createControllerFsError('CONTROLLER_FS_RESTORE_TARGET_BLOCKED', '복원 대상은 /media/fat/config 아래의 컨트롤러 관련 파일로 제한됩니다.');
  }
  return normalized;
}

function controllerBackupStem(sourcePath) {
  const normalized = assertControllerReadPath(sourcePath);
  return normalized.replace(/^\/media\/fat\/?/i, '').replace(/[^A-Za-z0-9._()-]+/g, '__').replace(/^_+|_+$/g, '') || 'controller-file';
}

function assertControllerBackupPath(sourcePath, backupPath) {
  const stem = controllerBackupStem(sourcePath);
  const normalized = normalizeControllerRemotePath(backupPath);
  const expectedRoot = `${controllerBackupRoot}/${stem}`;
  if (!normalized.startsWith(`${expectedRoot}/`)) {
    throw createControllerFsError('CONTROLLER_FS_BACKUP_PATH_BLOCKED', '선택한 백업 파일이 해당 컨트롤러 파일의 백업 폴더 밖에 있습니다.');
  }
  const backupName = path.posix.basename(normalized);
  if (!/^(?:[0-9]{8}-[0-9]{6}-.+\.bak|[0-9]{8}-[0-9]{6}__.+\.bak)$/i.test(backupName)) {
    throw createControllerFsError('CONTROLLER_FS_BACKUP_PATH_BLOCKED', '선택한 백업 파일명이 안전한 형식이 아닙니다.');
  }
  return normalized;
}

function controllerTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-');
}

function controllerBackupMetadataPath(backupPath) {
  const normalized = normalizeControllerRemotePath(backupPath);
  if (!isPathUnderControllerRoot(normalized, controllerBackupRoot)) {
    throw createControllerFsError('CONTROLLER_FS_BACKUP_PATH_BLOCKED', '컨트롤러 백업 metadata 경로가 허용 범위 밖입니다.');
  }
  return `${normalized}.json`;
}

function buildControllerHexRows(buffer) {
  const rows = [];
  for (let offset = 0; offset < buffer.length; offset += 16) {
    const row = buffer.subarray(offset, offset + 16);
    const hex = [...row].map((byte) => byte.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ');
    const ascii = [...row].map((byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.')).join('');
    rows.push(`${offset.toString(16).padStart(8, '0')}  ${hex}  |${ascii}|`);
  }
  return rows.join('\n');
}

function isMostlyPrintableControllerBuffer(buffer) {
  if (buffer.length === 0) return true;
  if (buffer.includes(0)) return false;
  let printable = 0;
  for (const byte of buffer) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 128) printable += 1;
  }
  return printable / buffer.length >= 0.85;
}

function buildControllerFilePreview(buffer, fileName) {
  const bytes = Buffer.from(buffer);
  const byteCount = bytes.length;
  const forceHex = /\.map$/i.test(fileName);
  const shouldUseText = !forceHex && isMostlyPrintableControllerBuffer(bytes.subarray(0, Math.min(byteCount, 4096)));
  if (shouldUseText) {
    const shownBytes = Math.min(byteCount, 16 * 1024);
    const shown = bytes.subarray(0, shownBytes);
    return {
      mode: 'text',
      byteCount,
      shownBytes,
      truncated: shownBytes < byteCount,
      text: shown.toString('utf8'),
      message: shownBytes < byteCount ? '큰 파일이라 앞부분만 표시합니다.' : '텍스트 미리보기입니다.',
    };
  }
  const shownBytes = Math.min(byteCount, 512);
  const shown = bytes.subarray(0, shownBytes);
  return {
    mode: 'hex',
    byteCount,
    shownBytes,
    truncated: shownBytes < byteCount,
    hex: buildControllerHexRows(shown),
    decimalBytes: [...shown.subarray(0, Math.min(shown.length, 128))].join(' '),
    message: /\.map$/i.test(fileName)
      ? '조이스틱 매핑 파일은 공식 구조를 확인하기 전까지 의미를 추정하지 않고 byte/hex로 표시합니다.'
      : '바이너리처럼 보이는 파일이라 byte/hex로 표시합니다.',
  };
}

function controllerPreviewContent(preview) {
  if (!preview) return '';
  return preview.mode === 'text' ? preview.text || '' : preview.hex || '';
}

function controllerSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function sftpMkdirRecursiveController(sftp, targetPath) {
  const normalized = normalizeControllerRemotePath(targetPath).replace(/\/+$/g, '');
  if (!(normalized === controllerBackupRoot || normalized === controllerTrashRoot || normalized.startsWith(`${controllerBackupRoot}/`) || normalized.startsWith(`${controllerTrashRoot}/`))) {
    throw createControllerFsError('CONTROLLER_FS_MKDIR_BLOCKED', '컨트롤러 백업/휴지통 폴더 밖에는 원격 폴더를 만들 수 없습니다.');
  }
  const parts = normalized.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = `${current}/${part}`;
    if (current === '/media' || current === '/media/fat') continue;
    const existing = await sftpLstat(sftp, current);
    if (!existing) await sftpMkdirOne(sftp, current);
  }
  return normalized;
}

function controllerFileFromEntry(entry, folderPath, profile) {
  const filePath = `${folderPath.replace(/\/+$/g, '')}/${entry.filename}`;
  const kind = controllerFileKind(entry.filename, folderPath);
  return {
    id: `controller:${profile?.id || 'active'}:${filePath}`,
    fileName: entry.filename,
    path: filePath,
    folderPath,
    sizeBytes: Number(entry.attrs?.size || 0),
    modifiedAt: entry.attrs?.mtime ? new Date(Number(entry.attrs.mtime) * 1000).toISOString() : undefined,
    type: kind.type,
    typeLabel: kind.label,
    source: 'remote',
    targetProfileId: profile?.id,
    targetAlias: profile?.alias,
    targetHost: profile?.ipAddress,
    canBackup: true,
    canRestoreTarget: filePath.startsWith('/media/fat/config/'),
  };
}

async function resolveControllerFsProfile(profileId) {
  return resolveRomFsProfile(profileId);
}

async function withControllerFsClient(profileId, callback) {
  const { profile, session } = await resolveControllerFsProfile(profileId);
  const client = await createSshClient(session);
  try {
    const sftp = await sftpClient(client);
    return await callback({ profile, session, client, sftp });
  } finally {
    client.end();
  }
}

async function scanControllerFolder(sftp, profile, folderPath, depth, state) {
  const targetPath = normalizeControllerRemotePath(folderPath);
  try {
    const entries = await controllerTimeout(
      sftpReadDir(sftp, targetPath),
      controllerFolderReadTimeoutMs,
      `${targetPath} 경로 읽기가 시간 초과되었습니다.`,
      'CONTROLLER_FS_FOLDER_TIMEOUT',
    );
    state.candidateFolders.push({ path: targetPath, label: path.posix.basename(targetPath) || targetPath, status: 'read', itemCount: entries.length });
    for (const entry of entries) {
      if (entry.filename === '.' || entry.filename === '..' || entry.filename.startsWith('.hello-mister-')) continue;
      const entryPath = `${targetPath}/${entry.filename}`;
      if (entry.attrs?.isFile?.() && isControllerCandidateFileName(entry.filename)) {
        if (!state.filesByPath.has(entryPath)) state.filesByPath.set(entryPath, controllerFileFromEntry(entry, targetPath, profile));
      }
      if (depth > 0 && entry.attrs?.isDirectory?.()) {
        await scanControllerFolder(sftp, profile, entryPath, depth - 1, state);
      }
    }
  } catch (error) {
    state.failedPaths.push({ path: targetPath, message: sanitizeControllerFsMessage(error), errorCode: error.code || 'CONTROLLER_FS_READ_FAILED' });
    state.candidateFolders.push({ path: targetPath, label: path.posix.basename(targetPath) || targetPath, status: 'failed', message: sanitizeControllerFsMessage(error) });
  }
}

async function controllerFsScanInventory(request = {}) {
  const startedAt = controllerScanNow();
  try {
    return await controllerTimeout(withControllerFsClient(request.profileId, async ({ profile, sftp }) => {
      const state = { filesByPath: new Map(), candidateFolders: [], failedPaths: [], errors: [] };
      for (const folderPath of controllerCandidateDirs) {
        const depth = folderPath === '/media/fat' ? 0 : 1;
        await scanControllerFolder(sftp, profile, folderPath, depth, state);
      }
      const files = [...state.filesByPath.values()].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
      const scannedRoots = state.candidateFolders.filter((folder) => folder.status === 'read').map((folder) => folder.path);
      const status = summarizeControllerInventoryStatus(files, scannedRoots, state.failedPaths, state.errors);
      const finishedAt = controllerScanNow();
      return controllerInventoryResult({
        ok: status !== 'error',
        status,
        profile,
        startedAt,
        finishedAt,
        candidateFolders: state.candidateFolders,
        files,
        failedPaths: state.failedPaths,
        errors: state.errors,
        errorCode: status === 'error' ? 'CONTROLLER_FS_SCAN_FAILED' : undefined,
      });
    }), controllerScanTimeoutMs, '컨트롤러 설정 파일 읽기가 시간 초과되었습니다.', 'CONTROLLER_FS_SCAN_TIMEOUT');
  } catch (error) {
    const finishedAt = controllerScanNow();
    const failure = { path: '/media/fat', message: sanitizeControllerFsMessage(error), errorCode: error.code || 'CONTROLLER_FS_SCAN_FAILED' };
    return controllerInventoryResult({
      ok: false,
      status: error.code === 'CONTROLLER_FS_SCAN_TIMEOUT' ? 'timeout' : 'error',
      profile: undefined,
      startedAt,
      finishedAt,
      candidateFolders: [],
      files: [],
      failedPaths: [failure],
      errors: [failure],
      errorCode: error.code || 'CONTROLLER_FS_SCAN_FAILED',
    });
  }
}

async function controllerFsReadFile(request = {}) {
  const readAt = new Date().toISOString();
  try {
    const targetPath = assertControllerReadPath(request.path);
    return await withControllerFsClient(request.profileId, async ({ profile, sftp }) => {
      const attrs = await sftpLstat(sftp, targetPath);
      if (!attrs?.isFile?.()) throw createControllerFsError('CONTROLLER_FS_NOT_FOUND', '선택한 컨트롤러 설정 파일을 찾지 못했습니다.');
      const buffer = await sftpReadBuffer(sftp, targetPath, 1024 * 1024);
      const preview = buildControllerFilePreview(buffer, path.posix.basename(targetPath));
      const file = controllerFileFromEntry({ filename: path.posix.basename(targetPath), attrs }, path.posix.dirname(targetPath), profile);
      return {
        ok: true,
        profileId: profile.id,
        file,
        content: controllerPreviewContent(preview),
        preview,
        bytesBase64: buffer.toString('base64'),
        sha256: controllerSha256(buffer),
        readAt,
        message: '컨트롤러 관련 파일을 read-only로 읽었습니다.',
      };
    });
  } catch (error) {
    return { ok: false, content: '', readAt, message: sanitizeControllerFsMessage(error), errorCode: error.code || 'CONTROLLER_FS_READ_FAILED' };
  }
}

function backupEntryFromControllerRemote(sourcePath, entry) {
  const stem = controllerBackupStem(sourcePath);
  const backupPath = `${controllerBackupRoot}/${stem}/${entry.filename}`;
  return {
    path: backupPath,
    fileName: entry.filename,
    sourcePath,
    sizeBytes: Number(entry.attrs?.size || 0),
    createdAt: entry.attrs?.mtime ? new Date(Number(entry.attrs.mtime) * 1000).toISOString() : undefined,
    location: 'remote',
  };
}

async function listControllerBackupsForSftp(sftp, sourcePath) {
  const stem = controllerBackupStem(sourcePath);
  const backupDir = `${controllerBackupRoot}/${stem}`;
  let rawEntries = [];
  try {
    rawEntries = await sftpReadDir(sftp, backupDir);
  } catch (error) {
    if (error?.code === 2) return [];
    throw error;
  }
  const entries = rawEntries
    .filter((entry) => /^(?:[0-9]{8}-[0-9]{6}-.+\.bak|[0-9]{8}-[0-9]{6}__.+\.bak)$/i.test(entry.filename))
    .map((entry) => backupEntryFromControllerRemote(sourcePath, entry))
    .sort((a, b) => String(b.fileName).localeCompare(String(a.fileName)));
  return entries;
}

async function pruneControllerBackups(sftp, sourcePath, keep = 10) {
  const backups = await listControllerBackupsForSftp(sftp, sourcePath);
  for (const oldBackup of backups.slice(keep)) {
    await sftpUnlink(sftp, oldBackup.path).catch(() => undefined);
  }
  return backups.slice(0, keep);
}

async function writeLocalControllerBackup(profileId, sourcePath, content) {
  const stem = controllerBackupStem(sourcePath);
  const localPath = appDataPath('backups', 'controllers', String(profileId || 'unknown'), stem, `${controllerTimestamp()}.bak`);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, Buffer.from(content));
  return localPath;
}

async function sftpWriteControllerBackupFile(sftp, remotePath, content) {
  const normalized = normalizeControllerRemotePath(remotePath);
  if (!isPathUnderControllerRoot(normalized, controllerBackupRoot)) {
    throw createControllerFsError('CONTROLLER_FS_BACKUP_PATH_BLOCKED', '컨트롤러 백업 폴더 밖에는 백업 파일을 쓸 수 없습니다.');
  }
  await sftpWriteBuffer(sftp, normalized, content);
  return normalized;
}

async function sftpWriteControllerRestoreFile(sftp, remotePath, content) {
  const normalized = assertControllerRestoreTargetPath(remotePath);
  await sftpWriteBuffer(sftp, normalized, content);
  return normalized;
}

async function writeControllerBackupMetadata(sftp, backupPath, metadata) {
  const metadataPath = controllerBackupMetadataPath(backupPath);
  await sftpWriteControllerBackupFile(sftp, metadataPath, Buffer.from(JSON.stringify(metadata, null, 2), 'utf8'));
  return metadataPath;
}

async function backupControllerFile(sftp, sourcePath, content, profile, sourceAttrs) {
  const stem = controllerBackupStem(sourcePath);
  const backupDir = `${controllerBackupRoot}/${stem}`;
  await sftpMkdirRecursiveController(sftp, backupDir);
  const createdAt = controllerTimestamp();
  const backupPath = `${backupDir}/${createdAt}__${path.posix.basename(sourcePath)}.bak`;
  const buffer = Buffer.from(content);
  await sftpWriteControllerBackupFile(sftp, backupPath, buffer);
  const metadata = {
    originalPath: sourcePath,
    fileName: path.posix.basename(sourcePath),
    sizeBytes: buffer.length,
    modifiedAt: sourceAttrs?.mtime ? new Date(Number(sourceAttrs.mtime) * 1000).toISOString() : undefined,
    backupCreatedAt: new Date().toISOString(),
    sourceProfile: profile ? { profileId: profile.id, alias: profile.alias, host: profile.ipAddress } : undefined,
    sha256: controllerSha256(buffer),
  };
  await writeControllerBackupMetadata(sftp, backupPath, metadata).catch(() => undefined);
  return backupPath;
}

async function controllerFsCreateBackup(request = {}) {
  try {
    const sourcePath = assertControllerReadPath(request.sourcePath);
    return await withControllerFsClient(request.profileId, async ({ profile, sftp }) => {
      const attrs = await sftpLstat(sftp, sourcePath);
      if (!attrs?.isFile?.()) throw createControllerFsError('CONTROLLER_FS_NOT_FOUND', '백업할 컨트롤러 설정 파일을 찾지 못했습니다.');
      const content = await sftpReadBuffer(sftp, sourcePath, Number.POSITIVE_INFINITY);
      const backupPath = await backupControllerFile(sftp, sourcePath, content, profile, attrs);
      const localBackupPath = await writeLocalControllerBackup(profile.id, sourcePath, content).catch(() => undefined);
      const backups = await pruneControllerBackups(sftp, sourcePath, 10);
      return { ok: true, profileId: profile.id, sourcePath, backupPath, localBackupPath, backups, message: '컨트롤러 설정 파일을 백업했습니다.' };
    });
  } catch (error) {
    return { ok: false, sourcePath: request.sourcePath, message: sanitizeControllerFsMessage(error), errorCode: error.code || 'CONTROLLER_FS_BACKUP_FAILED' };
  }
}

async function controllerFsListBackups(request = {}) {
  try {
    const sourcePath = assertControllerReadPath(request.sourcePath);
    return await withControllerFsClient(request.profileId, async ({ profile, sftp }) => {
      const backups = await listControllerBackupsForSftp(sftp, sourcePath);
      return { ok: true, profileId: profile.id, sourcePath, backups, message: `${backups.length}개 컨트롤러 백업을 읽었습니다.` };
    });
  } catch (error) {
    return { ok: false, sourcePath: request.sourcePath, backups: [], message: sanitizeControllerFsMessage(error), errorCode: error.code || 'CONTROLLER_FS_BACKUP_LIST_FAILED' };
  }
}

async function controllerFsReadBackup(request = {}) {
  const readAt = new Date().toISOString();
  try {
    const sourcePath = assertControllerReadPath(request.sourcePath);
    const backupPath = assertControllerBackupPath(sourcePath, request.backupPath);
    return await withControllerFsClient(request.profileId, async ({ profile, sftp }) => {
      const attrs = await sftpLstat(sftp, backupPath);
      if (!attrs?.isFile?.()) throw createControllerFsError('CONTROLLER_FS_BACKUP_NOT_FOUND', '선택한 컨트롤러 백업을 찾지 못했습니다.');
      const buffer = await sftpReadBuffer(sftp, backupPath, 1024 * 1024);
      const preview = buildControllerFilePreview(buffer, path.posix.basename(sourcePath));
      const backup = backupEntryFromControllerRemote(sourcePath, { filename: path.posix.basename(backupPath), attrs });
      return {
        ok: true,
        profileId: profile.id,
        sourcePath,
        backup,
        content: controllerPreviewContent(preview),
        preview,
        bytesBase64: buffer.toString('base64'),
        sha256: controllerSha256(buffer),
        readAt,
        message: '컨트롤러 백업을 read-only로 미리보기했습니다.',
      };
    });
  } catch (error) {
    return { ok: false, sourcePath: request.sourcePath, content: '', readAt, message: sanitizeControllerFsMessage(error), errorCode: error.code || 'CONTROLLER_FS_BACKUP_READ_FAILED' };
  }
}

async function controllerFsRestoreBackup(request = {}) {
  if (!request.confirmed) return { ok: false, sourcePath: request.sourcePath, targetPath: request.sourcePath, message: '복원 전 확인이 필요합니다.', errorCode: 'CONTROLLER_FS_CONFIRMATION_REQUIRED' };
  try {
    const targetPath = assertControllerRestoreTargetPath(request.sourcePath);
    const backupPath = assertControllerBackupPath(targetPath, request.backupPath);
    return await withControllerFsClient(request.profileId, async ({ profile, sftp }) => {
      const backupAttrs = await sftpLstat(sftp, backupPath);
      if (!backupAttrs?.isFile?.()) throw createControllerFsError('CONTROLLER_FS_BACKUP_NOT_FOUND', '선택한 컨트롤러 백업을 찾지 못했습니다.');
      const backupContent = await sftpReadBuffer(sftp, backupPath, Number.POSITIVE_INFINITY);
      const currentAttrs = await sftpLstat(sftp, targetPath);
      if (!currentAttrs?.isFile?.()) throw createControllerFsError('CONTROLLER_FS_RESTORE_TARGET_NOT_FOUND', '복원 전 현재 컨트롤러 파일을 찾지 못해 자동 백업을 만들 수 없습니다.');
      const currentContent = await sftpReadBuffer(sftp, targetPath, Number.POSITIVE_INFINITY);
      const currentBackupPath = await backupControllerFile(sftp, targetPath, currentContent, profile, currentAttrs);
      await writeLocalControllerBackup(profile.id, targetPath, currentContent).catch(() => undefined);
      await sftpWriteControllerRestoreFile(sftp, targetPath, backupContent);
      const verification = await sftpReadBuffer(sftp, targetPath, Number.POSITIVE_INFINITY);
      if (!verification.equals(backupContent)) throw createControllerFsError('CONTROLLER_FS_RESTORE_VERIFY_FAILED', '복원 후 파일 검증에 실패했습니다.');
      const backups = await pruneControllerBackups(sftp, targetPath, 10);
      return { ok: true, profileId: profile.id, sourcePath: backupPath, targetPath, backupPath: currentBackupPath, backups, message: '컨트롤러 백업을 복원했습니다. 기존 파일은 복원 전에 다시 백업했습니다.' };
    });
  } catch (error) {
    return { ok: false, sourcePath: request.backupPath, targetPath: request.sourcePath, message: sanitizeControllerFsMessage(error), errorCode: error.code || 'CONTROLLER_FS_RESTORE_FAILED' };
  }
}

const controllerInputsDir = '/media/fat/config/inputs';
const controllerInputMapNameRe = /^(.+)_input_([0-9a-f]{4})_([0-9a-f]{4})_(v[0-9]+)\.map$/i;

function execCollectOutput(client, command) {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) { reject(error); return; }
      let out = '';
      let err = '';
      stream.on('data', (buffer) => { out += buffer.toString('utf8'); });
      if (stream.stderr) stream.stderr.on('data', (buffer) => { err += buffer.toString('utf8'); });
      stream.on('close', (code) => {
        if ((typeof code === 'number' ? code : 0) === 0 || out) resolve(out);
        else reject(new Error(err || `명령이 코드 ${code}로 종료되었습니다.`));
      });
    });
  });
}

// Parse /proc/bus/input/devices into connected controllers (VID/PID/name). Joystick devices have a `jsN` handler.
function parseProcInputDevices(text) {
  const devices = [];
  for (const block of String(text || '').split(/\n\s*\n/)) {
    const id = block.match(/Vendor=([0-9a-f]{4})\s+Product=([0-9a-f]{4})/i);
    if (!id) continue;
    const name = block.match(/N:\s*Name="([^"]*)"/i);
    const handlers = block.match(/H:\s*Handlers=([^\n]*)/i);
    const handlerText = handlers ? handlers[1].trim() : '';
    if (!/\bjs\d+\b/.test(handlerText)) continue; // joysticks/gamepads only
    const eventMatch = handlerText.match(/\bevent(\d+)\b/);
    const jsMatch = handlerText.match(/\bjs(\d+)\b/);
    const physMatch = block.match(/P:\s*Phys=([^\n]*)/i);
    const phys = physMatch ? physMatch[1].trim() : '';
    devices.push({
      name: name ? name[1] : '(이름 없음)',
      vid: id[1].toLowerCase(),
      pid: id[2].toLowerCase(),
      controllerKeyPrefix: `${id[1].toUpperCase()}_${id[2].toUpperCase()}`,
      handlers: handlerText,
      phys,
      // Physical USB path without the /inputN interface suffix — distinguishes two separate identical controllers
      // (different basePhys) from one composite device that exposes several input interfaces (same basePhys).
      basePhys: phys.replace(/\/input\d+$/i, ''),
      eventPath: eventMatch ? `/dev/input/event${eventMatch[1]}` : undefined,
      jsPath: jsMatch ? `/dev/input/js${jsMatch[1]}` : undefined,
    });
  }
  // Collapse the multiple input interfaces of ONE physical device (same basePhys), but keep separate physical
  // controllers — including two identical models (1P/2P) which differ only by USB path.
  const seen = new Set();
  return devices.filter((device) => {
    const key = device.basePhys || `${device.vid}_${device.pid}_${device.name}_${device.eventPath || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Enumerate /dev/hidrawN nodes with their VID/PID (from sysfs uevent) so we can offer raw-HID monitoring, which keeps
// working even while MiSTer holds the evdev grab. HID_ID format: BUS:VVVVVVVV:PPPPPPPP.
async function enumerateHidrawDevices(client) {
  const out = await execCollectOutput(client, 'for h in /sys/class/hidraw/hidraw*; do n=$(basename "$h"); id=$(grep -h HID_ID "$h/device/uevent" 2>/dev/null); ph=$(grep -h HID_PHYS "$h/device/uevent" 2>/dev/null); echo "$n|$id|$ph"; done').catch(() => '');
  const list = [];
  for (const line of String(out || '').split('\n')) {
    const parts = line.split('|');
    const m = (parts[1] || '').match(/HID_ID=[0-9a-f]+:([0-9a-f]{8}):([0-9a-f]{8})/i);
    if (!m || !/^hidraw\d+$/.test(parts[0])) continue;
    const phys = (parts[2] || '').replace(/^HID_PHYS=/i, '').trim();
    list.push({ node: parts[0], vid: m[1].slice(-4).toLowerCase(), pid: m[2].slice(-4).toLowerCase(), basePhys: phys.replace(/\/input\d+$/i, '') });
  }
  return list;
}

async function controllerFsListConnectedDevices(request = {}) {
  try {
    return await withControllerFsClient(request.profileId, async ({ profile, client }) => {
      const text = await execCollectOutput(client, 'cat /proc/bus/input/devices');
      const devices = parseProcInputDevices(text);
      const hidraws = await enumerateHidrawDevices(client);
      const usedHidraw = new Set();
      for (const device of devices) {
        // Prefer an exact physical-path match (correct when two identical controllers are present), then fall back to
        // an unused VID:PID match so each device still gets its own node.
        let match = device.basePhys ? hidraws.find((h) => h.basePhys && h.basePhys === device.basePhys && !usedHidraw.has(h.node)) : undefined;
        if (!match) match = hidraws.find((h) => h.vid === device.vid && h.pid === device.pid && !usedHidraw.has(h.node));
        if (match) { device.hidrawPath = `/dev/${match.node}`; usedHidraw.add(match.node); }
      }
      return { ok: true, profileId: profile.id, devices, debugRaw: request.debug ? text : undefined, message: `연결된 컨트롤러 ${devices.length}개를 확인했습니다.` };
    });
  } catch (error) {
    return { ok: false, devices: [], message: sanitizeControllerFsMessage(error), errorCode: error.code || 'CONTROLLER_FS_DEVICES_FAILED' };
  }
}

// Parse a /proc bitmap field ("ffff0000 0 0 …", printed HIGH word first, 32-bit words) into a Set of set bit indices.
function parseProcBitmap(text) {
  const set = new Set();
  if (!text) return set;
  const words = text.trim().split(/\s+/).map((w) => parseInt(w, 16) >>> 0);
  const n = words.length;
  for (let i = 0; i < n; i += 1) {
    const word = words[i];
    const wordIndex = n - 1 - i; // rightmost printed word = bits 0-31
    for (let b = 0; b < 32; b += 1) if (word & (1 << b)) set.add(wordIndex * 32 + b);
  }
  return set;
}

// Read the kernel's evdev capabilities for a controller (works even while MiSTer EVIOCGRAB-grabs evdev — /proc is
// static). Reveals the REAL button base (BTN_JOYSTICK 0x120 vs BTN_GAMEPAD 0x130) and whether the lever is a digital
// HAT or analog axes — things the raw-HID monitor cannot know. Lets us build a correct .map code profile WITHOUT
// needing a pre-existing real map.
async function controllerFsReadInputCaps(request = {}) {
  const vid = String(request.vid || '').toLowerCase();
  const pid = String(request.pid || '').toLowerCase();
  if (!/^[0-9a-f]{4}$/.test(vid) || !/^[0-9a-f]{4}$/.test(pid)) return { ok: false, message: '컨트롤러 고유번호가 올바르지 않습니다.', errorCode: 'CONTROLLER_FS_BAD_TARGET' };
  try {
    return await withControllerFsClient(request.profileId, async ({ profile, client }) => {
      const text = await execCollectOutput(client, 'cat /proc/bus/input/devices');
      const block = String(text || '').split(/\n\s*\n/).find((b) => new RegExp(`Vendor=${vid}\\s+Product=${pid}`, 'i').test(b) && /B:\s*KEY=/i.test(b));
      if (!block) return { ok: false, profileId: profile.id, message: '이 컨트롤러의 evdev 정보를 찾지 못했습니다(연결 확인).', errorCode: 'CONTROLLER_FS_NO_EVDEV' };
      const keyBits = parseProcBitmap((block.match(/B:\s*KEY=([0-9a-f ]+)/i) || [])[1]);
      const absBits = parseProcBitmap((block.match(/B:\s*ABS=([0-9a-f ]+)/i) || [])[1]);
      // Lowest set button code → its 16-aligned base. Prefer the gamepad/joystick ranges (0x120-0x13f), then BTN_MISC.
      let buttonBase = null;
      for (let code = 0x120; code < 0x140 && buttonBase == null; code += 1) if (keyBits.has(code)) buttonBase = code & 0xfff0;
      if (buttonBase == null) for (let code = 0x100; code < 0x120 && buttonBase == null; code += 1) if (keyBits.has(code)) buttonBase = code & 0xfff0;
      const hasHat = absBits.has(0x10) && absBits.has(0x11); // ABS_HAT0X / ABS_HAT0Y (d-pad)
      const hasAnalog = absBits.has(0x00) && absBits.has(0x01); // ABS_X / ABS_Y (stick)
      return { ok: true, profileId: profile.id, buttonBase, hasHat, hasAnalog, message: `evdev 능력: 버튼 0x${(buttonBase || 0).toString(16)}${hasHat ? ' · HAT' : ''}${hasAnalog ? ' · 아날로그' : ''}` };
    });
  } catch (error) {
    return { ok: false, message: sanitizeControllerFsMessage(error), errorCode: error.code || 'CONTROLLER_FS_CAPS_FAILED' };
  }
}

// List every per-game .map for one controller (VID:PID) under config/inputs. Lighter than a full inventory scan.
async function controllerFsListMaps(request = {}) {
  const vid = String(request.vid || '').toLowerCase();
  const pid = String(request.pid || '').toLowerCase();
  if (!/^[0-9a-f]{4}$/.test(vid) || !/^[0-9a-f]{4}$/.test(pid)) return { ok: false, maps: [], message: '컨트롤러 고유번호가 올바르지 않습니다.', errorCode: 'CONTROLLER_FS_BAD_TARGET' };
  try {
    return await withControllerFsClient(request.profileId, async ({ profile, sftp }) => {
      if (!(await sftpLstat(sftp, controllerInputsDir))) return { ok: true, profileId: profile.id, maps: [], message: 'config/inputs 폴더가 없습니다.' };
      const entries = await sftpReadDir(sftp, controllerInputsDir);
      const re = new RegExp(`^(.+)_input_${vid}_${pid}_(v[0-9]+)\\.map$`, 'i');
      const maps = [];
      for (const entry of entries) {
        if (!entry.attrs?.isFile?.()) continue;
        const m = entry.filename.match(re);
        if (!m) continue;
        maps.push({ game: m[1], version: m[2].toLowerCase(), fileName: entry.filename, path: `${controllerInputsDir}/${entry.filename}`, sizeBytes: Number(entry.attrs.size || 0) });
      }
      maps.sort((a, b) => a.game.localeCompare(b.game, undefined, { numeric: true }));
      return { ok: true, profileId: profile.id, maps, message: `${maps.length}개 코어 맵을 찾았습니다.` };
    });
  } catch (error) {
    return { ok: false, maps: [], message: sanitizeControllerFsMessage(error), errorCode: error.code || 'CONTROLLER_FS_LIST_MAPS_FAILED' };
  }
}

// Find the arcade MRA whose <setname> matches a map slug and extract its per-game button names (<buttons names=...>).
// Lets the editor label slots with game-specific names (Fire/Jump/Shot...) instead of generic "Button N".
const arcadeMraDir = '/media/fat/_Arcade';
async function controllerFsReadArcadeButtons(request = {}) {
  const game = String(request.game || '').trim();
  if (!game || !/^[A-Za-z0-9_.+-]+$/.test(game)) return { ok: false, message: '아케이드 setname 형식이 아닙니다.', errorCode: 'CONTROLLER_FS_BAD_SETNAME' };
  try {
    return await withControllerFsClient(request.profileId, async ({ profile, client }) => {
      // Recurse all of _Arcade (clones live in _alternatives/… subfolders); -F fixed string, -i case-insensitive.
      const find = `find ${arcadeMraDir} -name '*.mra' -exec grep -Flis "<setname>${game}</setname>" {} + 2>/dev/null | head -1`;
      const mraPath = (await execCollectOutput(client, find).catch(() => '')).trim().split('\n')[0] || '';
      if (!mraPath) return { ok: false, profileId: profile.id, message: `${game}에 해당하는 MRA를 찾지 못했습니다(아케이드 게임이 아닐 수 있음).`, errorCode: 'CONTROLLER_FS_NO_MRA' };
      const xml = await execCollectOutput(client, `cat "${mraPath}"`).catch(() => '');
      const names = parseMraButtonNames(xml);
      return { ok: true, profileId: profile.id, game, mraPath, names, message: names.length ? `버튼 이름 ${names.length}개를 찾았습니다.` : 'MRA에 버튼 이름이 없습니다.' };
    });
  } catch (error) {
    return { ok: false, message: sanitizeControllerFsMessage(error), errorCode: error.code || 'CONTROLLER_FS_MRA_FAILED' };
  }
}

// Build a setname → button-names index from ALL MRAs in one pass (per-game recursive grep is ~13s; this is one scan,
// cached by the renderer). Output lines are `path:<setname>…` / `path:<buttons …names="…">`, grouped by file.
async function controllerFsReadArcadeIndex(request = {}) {
  try {
    return await withControllerFsClient(request.profileId, async ({ profile, client }) => {
      const cmd = `find ${arcadeMraDir} -name '*.mra' -exec grep -HoiE '<setname>[^<]*</setname>|<name>[^<]*</name>|<buttons[^>]*>' {} + 2>/dev/null`;
      const out = await execCollectOutput(client, cmd).catch(() => '');
      const index = parseMraIndex(out);
      const count = Object.keys(index).length;
      return { ok: true, profileId: profile.id, index, count, message: `아케이드 버튼 이름 ${count}개를 인덱싱했습니다.` };
    });
  } catch (error) {
    return { ok: false, index: {}, message: sanitizeControllerFsMessage(error), errorCode: error.code || 'CONTROLLER_FS_MRA_INDEX_FAILED' };
  }
}

function decodeXmlEntities(s) {
  return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"');
}

// Build setname → { name (full display title), count (action buttons), names } from interleaved grep output.
function parseMraIndex(text) {
  const byFile = new Map();
  for (const line of String(text || '').split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const file = line.slice(0, colon);
    const frag = line.slice(colon + 1);
    let e = byFile.get(file);
    if (!e) { e = {}; byFile.set(file, e); }
    let m;
    if ((m = frag.match(/<setname>([^<]*)<\/setname>/i))) e.setname = m[1].trim().toLowerCase();
    else if ((m = frag.match(/<name>([^<]*)<\/name>/i))) { if (!e.name) e.name = decodeXmlEntities(m[1].trim()); }
    else if (/<buttons/i.test(frag)) {
      const nm = frag.match(/names="([^"]*)"/i);
      if (nm) e.names = decodeXmlEntities(nm[1]).split(',').map((s) => s.trim()).filter((s) => s.length > 0);
      const cm = frag.match(/count="([0-9]+)"/i);
      if (cm) e.count = Number(cm[1]);
    }
  }
  const index = {};
  for (const e of byFile.values()) {
    if (e.setname && e.names && e.names.length) index[e.setname] = { name: e.name || undefined, count: e.count, names: e.names };
  }
  return index;
}

// MRA button names live in `<buttons names="A,B,..." .../>` (comma list, Button 1..N order). Returns trimmed names.
function parseMraButtonNames(xml) {
  const text = String(xml || '');
  const tag = text.match(/<buttons\b[^>]*\bnames\s*=\s*"([^"]*)"/i);
  if (!tag) return [];
  return tag[1].split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

// Read EVERY .map for one controller (VID:PID) and return their 64 uint16 codes, so the renderer can group games by
// identical mapping (a "map library"). One SSH session, sftp reads per file.
async function controllerFsReadAllMaps(request = {}) {
  const vid = String(request.vid || '').toLowerCase();
  const pid = String(request.pid || '').toLowerCase();
  if (!/^[0-9a-f]{4}$/.test(vid) || !/^[0-9a-f]{4}$/.test(pid)) return { ok: false, maps: [], message: '컨트롤러 고유번호가 올바르지 않습니다.', errorCode: 'CONTROLLER_FS_BAD_TARGET' };
  try {
    return await withControllerFsClient(request.profileId, async ({ profile, sftp }) => {
      if (!(await sftpLstat(sftp, controllerInputsDir))) return { ok: true, profileId: profile.id, maps: [], message: 'config/inputs 폴더가 없습니다.' };
      const entries = await sftpReadDir(sftp, controllerInputsDir);
      const re = new RegExp(`^(.+)_input_${vid}_${pid}_(v[0-9]+)\\.map$`, 'i');
      const targets = [];
      for (const entry of entries) {
        if (!entry.attrs?.isFile?.()) continue;
        const m = entry.filename.match(re);
        if (m && Number(entry.attrs.size || 0) >= 128) targets.push({ game: m[1], version: m[2].toLowerCase(), fileName: entry.filename, path: `${controllerInputsDir}/${entry.filename}` });
      }
      targets.sort((a, b) => a.game.localeCompare(b.game, undefined, { numeric: true }));
      const maps = [];
      for (const t of targets.slice(0, 3000)) {
        const buf = await sftpReadBuffer(sftp, t.path, 128).catch(() => null);
        if (!buf || buf.length < 128) continue;
        maps.push({ ...t, codes: readControllerMapU16(buf.subarray(0, 128)) });
      }
      return { ok: true, profileId: profile.id, maps, message: `${maps.length}개 코어 맵을 읽었습니다.` };
    });
  } catch (error) {
    return { ok: false, maps: [], message: sanitizeControllerFsMessage(error), errorCode: error.code || 'CONTROLLER_FS_READ_ALL_FAILED' };
  }
}

// Read one .map and return its 64 uint16 codes (and raw bytes) for the editor to decode.
async function controllerFsReadMap(request = {}) {
  try {
    const mapPath = assertControllerReadPath(request.path);
    // Accept per-game maps (<game>_input_…) AND the base/menu map (input_<vid>_<pid>_v<n>.map, no game prefix).
    if (!/(?:^|[/_])input_[0-9a-f]{4}_[0-9a-f]{4}_v[0-9]+\.map$/i.test(mapPath)) return { ok: false, codes: [], message: '맵 파일 경로가 아닙니다.', errorCode: 'CONTROLLER_FS_NOT_MAP' };
    return await withControllerFsClient(request.profileId, async ({ profile, sftp }) => {
      const buf = await sftpReadBuffer(sftp, mapPath, 4096);
      if (!buf || buf.length < 128) return { ok: false, profileId: profile.id, codes: [], message: '맵 파일을 읽지 못했거나 형식이 예상과 다릅니다.', errorCode: 'CONTROLLER_FS_BAD_MAP' };
      return { ok: true, profileId: profile.id, path: mapPath, byteLength: buf.length, codes: readControllerMapU16(buf.subarray(0, 128)), message: '맵을 읽었습니다.' };
    });
  } catch (error) {
    return { ok: false, codes: [], message: sanitizeControllerFsMessage(error), errorCode: error.code || 'CONTROLLER_FS_READ_MAP_FAILED' };
  }
}

// Write a controller .map from 64 uint16 codes (creating one if absent), backing up any existing file and verifying.
async function controllerFsWriteMap(request = {}) {
  const codes = Array.isArray(request.codes) ? request.codes.map((c) => Number(c) & 0xffff) : null;
  if (!codes || codes.length !== 64) return { ok: false, message: '맵 코드는 64개여야 합니다.', errorCode: 'CONTROLLER_FS_BAD_CODES' };
  const game = String(request.game || '').trim();
  const vid = String(request.vid || '').toLowerCase();
  const pid = String(request.pid || '').toLowerCase();
  const version = String(request.version || 'v3').toLowerCase();
  // Either an explicit existing path, or compose one from game/vid/pid/version.
  let targetPath = request.path ? String(request.path) : '';
  if (!targetPath) {
    if (!game || !/^[0-9a-f]{4}$/.test(vid) || !/^[0-9a-f]{4}$/.test(pid) || !/^v[0-9]+$/.test(version)) return { ok: false, message: '맵 파일 정보를 만들 수 없습니다.', errorCode: 'CONTROLLER_FS_BAD_TARGET' };
    targetPath = `${controllerInputsDir}/${game}_input_${vid}_${pid}_${version}.map`;
  }
  if (!/_input_[0-9a-f]{4}_[0-9a-f]{4}_v[0-9]+\.map$/i.test(targetPath) || !targetPath.startsWith(`${controllerInputsDir}/`)) return { ok: false, message: '맵 파일 경로가 아닙니다.', errorCode: 'CONTROLLER_FS_NOT_MAP' };
  try {
    return await withControllerFsClient(request.profileId, async ({ profile, sftp }) => {
      const bytes = writeControllerMapU16(codes);
      let backupPath;
      let created = true;
      const existing = await sftpLstat(sftp, targetPath);
      if (existing?.isFile?.()) {
        const cur = await sftpReadBuffer(sftp, targetPath, 4096);
        backupPath = await backupControllerFile(sftp, targetPath, cur, profile, existing);
        await writeLocalControllerBackup(profile.id, targetPath, cur).catch(() => undefined);
        created = false;
      }
      await sftpWriteControllerRestoreFile(sftp, targetPath, bytes);
      const verify = await sftpReadBuffer(sftp, targetPath, 128);
      if (!verify || !verify.subarray(0, 128).equals(bytes)) throw createControllerFsError('CONTROLLER_FS_WRITE_VERIFY_FAILED', '맵 저장 후 검증에 실패했습니다.');
      return { ok: true, profileId: profile.id, path: targetPath, created, backupPath, message: created ? '새 맵을 저장했습니다.' : '맵을 수정했습니다(기존 파일은 백업).' };
    });
  } catch (error) {
    return { ok: false, message: sanitizeControllerFsMessage(error), errorCode: error.code || 'CONTROLLER_FS_WRITE_MAP_FAILED' };
  }
}

// Batch-write many maps in ONE SSH session (per-game codes generated locally). Avoids opening a fresh connection per
// file — the single-file path did, which made applying to hundreds of games extremely slow. New files skip backup.
async function controllerFsWriteMaps(request = {}) {
  const items = Array.isArray(request.items) ? request.items : [];
  const vid = String(request.vid || '').toLowerCase();
  const pid = String(request.pid || '').toLowerCase();
  const version = String(request.version || 'v3').toLowerCase();
  if (!items.length) return { ok: false, message: '쓸 맵이 없습니다.', errorCode: 'CONTROLLER_FS_NO_ITEMS' };
  try {
    return await withControllerFsClient(request.profileId, async ({ profile, sftp }) => {
      let created = 0; let overwritten = 0; let failed = 0; let backedUp = 0; let unchanged = 0;
      for (const item of items.slice(0, 6000)) {
        try {
          const codes = Array.isArray(item.codes) ? item.codes.map((c) => Number(c) & 0xffff) : null;
          if (!codes || codes.length !== 64) { failed += 1; continue; }
          let targetPath = item.path ? String(item.path) : '';
          if (!targetPath) {
            const game = String(item.game || '').trim();
            if (!game || !/^[0-9a-f]{4}$/.test(vid) || !/^[0-9a-f]{4}$/.test(pid) || !/^v[0-9]+$/.test(version)) { failed += 1; continue; }
            targetPath = `${controllerInputsDir}/${game}_input_${vid}_${pid}_${version}.map`;
          }
          if (!/_input_[0-9a-f]{4}_[0-9a-f]{4}_v[0-9]+\.map$/i.test(targetPath) || !targetPath.startsWith(`${controllerInputsDir}/`)) { failed += 1; continue; }
          const bytes = writeControllerMapU16(codes);
          const existing = await sftpLstat(sftp, targetPath);
          if (existing?.isFile?.()) {
            const cur = await sftpReadBuffer(sftp, targetPath, 4096);
            // Skip entirely when the generated map already matches — no rewrite, no redundant backup. Makes re-running
            // "전체 자동 생성" with the same template cheap and avoids backup clutter.
            if (cur.length >= 128 && cur.subarray(0, 128).equals(bytes)) { unchanged += 1; continue; }
            await backupControllerFile(sftp, targetPath, cur, profile, existing).catch(() => undefined);
            backedUp += 1; overwritten += 1;
          } else {
            created += 1;
          }
          await sftpWriteControllerRestoreFile(sftp, targetPath, bytes);
        } catch {
          failed += 1;
        }
      }
      return { ok: true, profileId: profile.id, created, overwritten, unchanged, failed, backedUp, message: `생성 ${created}개, 수정 ${overwritten}개, 변경없음 ${unchanged}개, 실패 ${failed}개.` };
    });
  } catch (error) {
    return { ok: false, message: sanitizeControllerFsMessage(error), errorCode: error.code || 'CONTROLLER_FS_WRITE_MAPS_FAILED' };
  }
}

// Clone every per-game .map of a source controller (VID_PID_version) to a target controller (VID_PID), keeping the
// game and map-format version and only swapping the VID/PID in the file name. Valid for same/compatible models.
async function controllerFsCloneMappings(request = {}) {
  const source = request.source || {};
  const target = request.target || {};
  const sVid = String(source.vid || '').toLowerCase();
  const sPid = String(source.pid || '').toLowerCase();
  const sVer = String(source.version || '').toLowerCase();
  const tVid = String(target.vid || '').toLowerCase();
  const tPid = String(target.pid || '').toLowerCase();
  if (!/^[0-9a-f]{4}$/.test(sVid) || !/^[0-9a-f]{4}$/.test(sPid) || !/^v[0-9]+$/.test(sVer)) return { ok: false, plan: [], message: '소스 컨트롤러 고유번호가 올바르지 않습니다.', errorCode: 'CONTROLLER_FS_BAD_SOURCE' };
  if (!/^[0-9a-f]{4}$/.test(tVid) || !/^[0-9a-f]{4}$/.test(tPid)) return { ok: false, plan: [], message: '대상 컨트롤러 고유번호가 올바르지 않습니다.', errorCode: 'CONTROLLER_FS_BAD_TARGET' };
  if (sVid === tVid && sPid === tPid) return { ok: false, plan: [], message: '소스와 대상이 같은 컨트롤러입니다.', errorCode: 'CONTROLLER_FS_SAME' };
  try {
    return await withControllerFsClient(request.profileId, async ({ profile, sftp }) => {
      if (!(await sftpLstat(sftp, controllerInputsDir))) return { ok: false, profileId: profile.id, plan: [], message: 'config/inputs 폴더가 없습니다.', errorCode: 'CONTROLLER_FS_NO_INPUTS' };
      const entries = (await sftpReadDir(sftp, controllerInputsDir)).filter((entry) => entry.attrs?.isFile?.());
      const plan = [];
      for (const entry of entries) {
        const match = entry.filename.match(controllerInputMapNameRe);
        if (!match) continue;
        const [, game, vid, pid, ver] = match;
        if (vid.toLowerCase() !== sVid || pid.toLowerCase() !== sPid || ver.toLowerCase() !== sVer) continue;
        const targetFileName = `${game}_input_${tVid}_${tPid}_${ver.toLowerCase()}.map`;
        const sourcePath = `${controllerInputsDir}/${entry.filename}`;
        const targetPath = `${controllerInputsDir}/${targetFileName}`;
        const targetExists = Boolean((await sftpLstat(sftp, targetPath))?.isFile?.());
        plan.push({ game, sourceFileName: entry.filename, sourcePath, targetFileName, targetPath, targetExists, sizeBytes: Number(entry.attrs?.size || 0) });
      }
      if (plan.length === 0) return { ok: false, profileId: profile.id, plan, message: '소스 컨트롤러로 추정되는 .map 파일을 찾지 못했습니다.', errorCode: 'CONTROLLER_FS_NO_SOURCE_MAPS' };
      const createCount = plan.filter((item) => !item.targetExists).length;
      const overwriteCount = plan.length - createCount;
      if (request.dryRun || !request.confirmed) {
        return { ok: true, profileId: profile.id, dryRun: true, plan, createCount, overwriteCount, message: `복제 미리보기: 새로 생성 ${createCount}개, 덮어쓰기 ${overwriteCount}개 (총 ${plan.length}개).` };
      }
      let created = 0;
      let overwritten = 0;
      let backedUp = 0;
      for (const item of plan) {
        const bytes = await sftpReadBuffer(sftp, item.sourcePath, Number.POSITIVE_INFINITY);
        if (item.targetExists) {
          const current = await sftpReadBuffer(sftp, item.targetPath, Number.POSITIVE_INFINITY);
          const currentAttrs = await sftpLstat(sftp, item.targetPath);
          await backupControllerFile(sftp, item.targetPath, current, profile, currentAttrs);
          await writeLocalControllerBackup(profile.id, item.targetPath, current).catch(() => undefined);
          backedUp += 1;
          overwritten += 1;
        } else {
          created += 1;
        }
        await sftpWriteControllerRestoreFile(sftp, item.targetPath, bytes);
      }
      return { ok: true, profileId: profile.id, dryRun: false, plan, created, overwritten, backedUp, message: `복제 완료: 새로 생성 ${created}개, 덮어쓰기 ${overwritten}개(기존 ${backedUp}개 백업).` };
    });
  } catch (error) {
    return { ok: false, plan: [], message: sanitizeControllerFsMessage(error), errorCode: error.code || 'CONTROLLER_FS_CLONE_FAILED' };
  }
}

function readControllerMapU16(buffer) {
  const values = new Array(64).fill(0);
  for (let i = 0; i < 64 && i * 2 + 1 < buffer.length; i += 1) values[i] = buffer.readUInt16LE(i * 2);
  return values;
}

function writeControllerMapU16(values) {
  const buffer = Buffer.alloc(128);
  for (let i = 0; i < 64; i += 1) buffer.writeUInt16LE((values[i] || 0) & 0xffff, i * 2);
  return buffer;
}

// Calibration-based auto map: align the source and target controller's shared core maps by slot to learn a
// per-code translation (each .map = 64 uint16 input codes; slot is core-defined, code is controller-defined), then
// generate the target's map for every core the source has by translating codes. Validated: byte-for-byte exact.
async function controllerFsAutoMap(request = {}) {
  const source = request.source || {};
  const target = request.target || {};
  const sVid = String(source.vid || '').toLowerCase();
  const sPid = String(source.pid || '').toLowerCase();
  const sVer = String(source.version || 'v3').toLowerCase();
  const tVid = String(target.vid || '').toLowerCase();
  const tPid = String(target.pid || '').toLowerCase();
  if (!/^[0-9a-f]{4}$/.test(sVid) || !/^[0-9a-f]{4}$/.test(sPid) || !/^v[0-9]+$/.test(sVer)) return { ok: false, message: '소스 컨트롤러 고유번호가 올바르지 않습니다.', errorCode: 'CONTROLLER_FS_BAD_SOURCE' };
  if (!/^[0-9a-f]{4}$/.test(tVid) || !/^[0-9a-f]{4}$/.test(tPid)) return { ok: false, message: '대상 컨트롤러 고유번호가 올바르지 않습니다.', errorCode: 'CONTROLLER_FS_BAD_TARGET' };
  if (sVid === tVid && sPid === tPid) return { ok: false, message: '소스와 대상이 같은 컨트롤러입니다.', errorCode: 'CONTROLLER_FS_SAME' };
  try {
    return await withControllerFsClient(request.profileId, async ({ profile, sftp }) => {
      if (!(await sftpLstat(sftp, controllerInputsDir))) return { ok: false, message: 'config/inputs 폴더가 없습니다.', errorCode: 'CONTROLLER_FS_NO_INPUTS' };
      const entries = (await sftpReadDir(sftp, controllerInputsDir)).filter((entry) => entry.attrs?.isFile?.() && Number(entry.attrs?.size) === 128);
      const sourceByGame = new Map();
      const targetByGame = new Map();
      const targetVersionVotes = new Map();
      for (const entry of entries) {
        const match = entry.filename.match(controllerInputMapNameRe);
        if (!match) continue;
        const [, game, vid, pid, ver] = match;
        const lvid = vid.toLowerCase();
        const lpid = pid.toLowerCase();
        const lver = ver.toLowerCase();
        // Match core names case-insensitively (MiSTer cores can differ in case, e.g. megadrive vs MegaDrive).
        const gkey = game.toLowerCase();
        if (lvid === sVid && lpid === sPid && lver === sVer) sourceByGame.set(gkey, { path: `${controllerInputsDir}/${entry.filename}`, game });
        if (lvid === tVid && lpid === tPid) {
          targetByGame.set(gkey, { path: `${controllerInputsDir}/${entry.filename}`, version: lver });
          targetVersionVotes.set(lver, (targetVersionVotes.get(lver) || 0) + 1);
        }
      }
      if (sourceByGame.size === 0) return { ok: false, message: '소스 컨트롤러의 맵이 없습니다.', errorCode: 'CONTROLLER_FS_NO_SOURCE_MAPS' };
      if (targetByGame.size === 0) return { ok: false, message: '대상(새) 컨트롤러로 매핑한 코어가 하나도 없습니다. 먼저 미스터에서 소스가 가진 코어 1~2개(예: MegaDrive)를 새 컨트롤러로 매핑하세요.', errorCode: 'CONTROLLER_FS_NO_TARGET_MAPS' };
      const tVer = [...targetVersionVotes.entries()].sort((a, b) => b[1] - a[1])[0][0];

      // Build code translation from shared (calibration) cores.
      const sharedGames = [...sourceByGame.keys()].filter((game) => targetByGame.has(game));
      if (sharedGames.length === 0) return { ok: false, message: '두 컨트롤러가 공통으로 매핑한 코어(캘리브레이션)가 없습니다. 새 컨트롤러로 소스가 가진 코어를 1~2개 매핑하세요.', errorCode: 'CONTROLLER_FS_NO_CALIBRATION' };
      const votes = new Map();
      for (const game of sharedGames) {
        const sBuf = await sftpReadBuffer(sftp, sourceByGame.get(game).path, 128).catch(() => null);
        const tBuf = await sftpReadBuffer(sftp, targetByGame.get(game).path, 128).catch(() => null);
        if (!sBuf || !tBuf || sBuf.length < 128 || tBuf.length < 128) continue;
        const su = readControllerMapU16(sBuf);
        const tu = readControllerMapU16(tBuf);
        for (let i = 0; i < 64; i += 1) {
          const sc = su[i];
          const tc = tu[i];
          if (sc === 0 || tc === 0) continue;
          if (!votes.has(sc)) votes.set(sc, new Map());
          const m = votes.get(sc);
          m.set(tc, (m.get(tc) || 0) + 1);
        }
      }
      const translate = new Map();
      for (const [sc, m] of votes) translate.set(sc, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);

      // Optional scope: only generate these core slugs (e.g. console cores). Calibration still uses ALL shared cores
      // (the code translation is controller-global, so more calibration data is always better).
      const onlyGames = Array.isArray(request.onlyGames) && request.onlyGames.length
        ? new Set(request.onlyGames.map((g) => String(g).toLowerCase()))
        : null;
      const toGenerate = [...sourceByGame.keys()]
        .filter((game) => !targetByGame.has(game))
        .filter((game) => !onlyGames || onlyGames.has(game));

      if (request.dryRun || !request.confirmed) {
        return {
          ok: true,
          profileId: profile.id,
          dryRun: true,
          targetVersion: tVer,
          sharedCores: sharedGames,
          distinctSourceCodes: translate.size,
          coresToGenerate: toGenerate.length,
          message: `자동 매핑 미리보기: 캘리브레이션 코어 ${sharedGames.length}개에서 버튼코드 ${translate.size}종을 학습했고, 생성 대상 코어는 ${toGenerate.length}개입니다.`,
        };
      }

      let created = 0;
      let overwritten = 0;
      let backedUp = 0;
      let skippedEmpty = 0;
      const uncovered = new Set();
      let partial = 0;
      for (const game of toGenerate) {
        const source = sourceByGame.get(game);
        const sBuf = await sftpReadBuffer(sftp, source.path, 128).catch(() => null);
        if (!sBuf || sBuf.length < 128) continue;
        const su = readControllerMapU16(sBuf);
        const out = new Array(64).fill(0);
        let mapped = 0;
        let missing = 0;
        for (let i = 0; i < 64; i += 1) {
          const sc = su[i];
          if (sc === 0) continue;
          const tc = translate.get(sc);
          if (tc !== undefined) { out[i] = tc; mapped += 1; } else { missing += 1; uncovered.add(sc); }
        }
        if (mapped === 0) { skippedEmpty += 1; continue; }
        if (missing > 0) partial += 1;
        // Keep the source core name's original casing in the generated file name.
        const targetPath = `${controllerInputsDir}/${source.game}_input_${tVid}_${tPid}_${tVer}.map`;
        const existing = await sftpLstat(sftp, targetPath);
        if (existing?.isFile?.()) {
          const cur = await sftpReadBuffer(sftp, targetPath, 128);
          await backupControllerFile(sftp, targetPath, cur, profile, existing);
          backedUp += 1;
          overwritten += 1;
        } else {
          created += 1;
        }
        await sftpWriteControllerRestoreFile(sftp, targetPath, writeControllerMapU16(out));
      }
      return {
        ok: true,
        profileId: profile.id,
        dryRun: false,
        targetVersion: tVer,
        sharedCores: sharedGames,
        distinctSourceCodes: translate.size,
        coresToGenerate: toGenerate.length,
        created,
        overwritten,
        backedUp,
        partial,
        skippedEmpty,
        uncoveredCodeCount: uncovered.size,
        message: `자동 매핑 완료: 생성 ${created}개, 덮어쓰기 ${overwritten}개(백업 ${backedUp}). 일부만 채워진 코어 ${partial}개, 미커버 버튼코드 ${uncovered.size}종(해당 버튼은 미할당). ${skippedEmpty}개는 학습된 버튼이 없어 건너뜀.`,
      };
    });
  } catch (error) {
    return { ok: false, message: sanitizeControllerFsMessage(error), errorCode: error.code || 'CONTROLLER_FS_AUTOMAP_FAILED' };
  }
}

// Live input monitor: stream a controller's evdev events (/dev/input/eventN) so the app can see button/axis codes
// in real time. The evdev key code equals the .map button code; axis events let us learn the lever encoding.
const controllerInputMonitors = new Map();

function controllerFsStopInputMonitorInternal(monitorId) {
  const monitor = controllerInputMonitors.get(monitorId);
  if (!monitor) return;
  controllerInputMonitors.delete(monitorId);
  try { monitor.stream?.close?.(); } catch { /* ignore */ }
  try { monitor.client?.end(); } catch { /* ignore */ }
}

// joydev (jsN): struct js_event is 8 bytes [time(u32) value(i16) type(u8) number(u8)]. type bit 0x80 = JS_EVENT_INIT
// (synthetic startup events). type&0x7f: 1=button, 2=axis. We read joydev because MiSTer EVIOCGRAB-grabs the evdev
// (eventN) nodes, so `cat /dev/input/eventN` yields nothing while MiSTer is running; the joydev node still streams.
function parseJoydevFrame(acc, send, monitorId) {
  while (acc.length >= 8) {
    const value = acc.readInt16LE(4);
    const rawType = acc.readUInt8(6);
    const number = acc.readUInt8(7);
    const init = (rawType & 0x80) !== 0;
    const type = rawType & 0x7f;
    const codeHex = `js#${number}`;
    if (!init) {
      if (type === 1) send({ monitorId, kind: 'button', source: 'js', code: number, codeHex, pressed: value !== 0, value });
      else if (type === 2) send({ monitorId, kind: 'axis', source: 'js', code: number, codeHex, value });
    }
    acc = acc.subarray(8);
  }
  return acc;
}

// evdev (eventN): struct input_event is 16 bytes on 32-bit MiSTer [sec(4) usec(4) type(2) code(2) value(4)].
function parseEvdevFrame(acc, send, monitorId) {
  while (acc.length >= 16) {
    const type = acc.readUInt16LE(8);
    const code = acc.readUInt16LE(10);
    const value = acc.readInt32LE(12);
    acc = acc.subarray(16);
    const codeHex = `0x${code.toString(16).padStart(4, '0')}`;
    if (type === 1) send({ monitorId, kind: 'button', source: 'evdev', code, codeHex, pressed: value !== 0, value });
    else if (type === 3) send({ monitorId, kind: 'axis', source: 'evdev', code, codeHex, value });
  }
  return acc;
}

// --- Raw HID (/dev/hidrawN) -------------------------------------------------------------------------------------
// MiSTer EVIOCGRAB-grabs evdev devices, which the kernel routes exclusively — so eventN AND jsN both go silent while
// MiSTer runs. The raw HID node (/dev/hidrawN) is NOT part of the input grab, so it keeps streaming. We parse the
// device's HID report descriptor to know each control's bit position, then diff successive reports to detect input.
function parseHidReportDescriptor(bytes) {
  let pos = 0;
  const g = { usagePage: 0, logicalMin: 0, logicalMax: 0, reportSize: 0, reportCount: 0, reportId: 0 };
  let usages = [];
  let usageMin = null;
  const fields = [];
  const bitPos = new Map();
  const usedReportIds = new Set();
  const getBits = (id) => bitPos.get(id) || 0;
  const addBits = (id, n) => bitPos.set(id, getBits(id) + n);
  while (pos < bytes.length) {
    const b = bytes[pos++];
    if (b === 0xfe) { const dataSize = bytes[pos++]; pos += 1 + dataSize; continue; } // long item
    const size = (b & 0x03) === 3 ? 4 : (b & 0x03);
    const type = (b >> 2) & 0x03;
    const tag = (b >> 4) & 0x0f;
    let data = 0;
    for (let i = 0; i < size; i += 1) data |= bytes[pos + i] << (8 * i);
    data >>>= 0;
    pos += size;
    if (type === 0) { // Main
      if (tag === 0x8) { // Input
        const isConst = (data & 0x01) !== 0;
        const isVar = (data & 0x02) !== 0;
        const id = g.reportId;
        usedReportIds.add(id);
        for (let i = 0; i < g.reportCount; i += 1) {
          const usage = isVar
            ? (usages.length ? usages[Math.min(i, usages.length - 1)] : (usageMin != null ? usageMin + i : 0))
            : (usageMin != null ? usageMin : (usages[0] || 0));
          fields.push({ reportId: id, usagePage: g.usagePage, usage, bitOffset: getBits(id), bitSize: g.reportSize, logicalMin: g.logicalMin, logicalMax: g.logicalMax, isConst, isVar });
          addBits(id, g.reportSize);
        }
      }
      usages = []; usageMin = null; // reset locals after any main item
    } else if (type === 1) { // Global
      if (tag === 0x0) g.usagePage = data;
      else if (tag === 0x1) g.logicalMin = signedHidData(data, size);
      else if (tag === 0x2) g.logicalMax = signedHidData(data, size);
      else if (tag === 0x7) g.reportSize = data;
      else if (tag === 0x8) g.reportId = data;
      else if (tag === 0x9) g.reportCount = data;
    } else if (type === 2) { // Local
      if (tag === 0x0) usages.push(data);
      else if (tag === 0x1) usageMin = data;
    }
  }
  const hasReportId = !(usedReportIds.size === 1 && usedReportIds.has(0));
  const lengths = {};
  for (const [id, bits] of bitPos.entries()) lengths[id] = Math.ceil(bits / 8) + (hasReportId ? 1 : 0);
  return { hasReportId, lengths, fields: fields.filter((f) => !f.isConst) };
}

function signedHidData(data, size) {
  if (size === 1 && data >= 0x80) return data - 0x100;
  if (size === 2 && data >= 0x8000) return data - 0x10000;
  return data;
}

function readHidField(report, field, idOffsetBits) {
  const base = field.bitOffset + idOffsetBits;
  let value = 0;
  for (let i = 0; i < field.bitSize; i += 1) {
    const bit = base + i;
    value |= (((report[bit >> 3] || 0) >> (bit & 7)) & 1) << i;
  }
  if (field.logicalMin < 0 && field.bitSize < 32 && value >= (1 << (field.bitSize - 1))) value -= (1 << field.bitSize);
  return value;
}

// Classify a HID field into our control vocabulary + a best-effort evdev code (for later .map generation).
function classifyHidField(field, index) {
  if (field.usagePage === 0x09) {
    return { control: 'button', key: `btn${field.usage}`, evdevCode: 0x120 + (field.usage - 1), label: `버튼 ${field.usage}` };
  }
  if (field.usagePage === 0x01) {
    const isHat = field.usage === 0x39 || (field.bitSize <= 4 && field.logicalMax === 7);
    if (isHat) return { control: 'hat', key: `hat${index}`, evdevCode: 0x10, label: '햇(레버)' };
    const axisNames = { 0x30: 'X', 0x31: 'Y', 0x32: 'Z', 0x33: 'Rx', 0x34: 'Ry', 0x35: 'Rz', 0x36: 'Slider', 0x37: 'Dial', 0x38: 'Wheel' };
    const axisEvdev = { 0x30: 0x00, 0x31: 0x01, 0x32: 0x02, 0x33: 0x03, 0x34: 0x04, 0x35: 0x05 };
    const name = axisNames[field.usage] || `U${field.usage.toString(16)}`;
    return { control: 'axis', key: `axis${index}`, evdevCode: axisEvdev[field.usage] ?? 0x00, label: `축 ${name}` };
  }
  return null; // vendor / unknown — ignore
}

const HAT_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

async function startHidrawMonitor(devicePath, monitorId, send, request) {
  const nodeMatch = devicePath.match(/\/dev\/(hidraw[0-9]+)$/);
  const descPath = `/sys/class/hidraw/${nodeMatch[1]}/device/report_descriptor`;
  const { session } = await resolveControllerFsProfile(request.profileId);
  const client = await createSshClient(session);
  const descBuf = await execCollectBuffer(client, `cat ${descPath}`).catch(() => Buffer.alloc(0));
  if (!descBuf.length) { try { client.end(); } catch { /* ignore */ } return { ok: false, monitorId, message: 'HID 리포트 디스크립터를 읽지 못했습니다.', errorCode: 'CONTROLLER_FS_HID_DESC_FAILED' }; }
  const layout = parseHidReportDescriptor(descBuf);
  const fieldInfos = layout.fields.map((f, i) => ({ field: f, info: classifyHidField(f, i) })).filter((x) => x.info);
  const idOffsetBits = layout.hasReportId ? 8 : 0;
  const prev = new Map();
  const bucket = (v, f) => { const lo = f.logicalMin + (f.logicalMax - f.logicalMin) * 0.3; const hi = f.logicalMin + (f.logicalMax - f.logicalMin) * 0.7; return v <= lo ? -1 : v >= hi ? 1 : 0; };
  return await new Promise((resolve) => {
    client.exec(`timeout 600 cat ${devicePath}`, (error, stream) => {
      if (error) { try { client.end(); } catch { /* ignore */ } resolve({ ok: false, monitorId, message: sanitizeControllerFsMessage(error), errorCode: 'CONTROLLER_FS_MONITOR_FAILED' }); return; }
      controllerInputMonitors.set(monitorId, { client, stream });
      let acc = Buffer.alloc(0);
      const handleReport = (report) => {
        for (const { field, info } of fieldInfos) {
          const value = readHidField(report, field, idOffsetBits);
          const key = info.key;
          if (info.control === 'button') {
            const pressed = value !== 0;
            if (prev.get(key) !== pressed) { prev.set(key, pressed); send({ monitorId, kind: 'button', source: 'hidraw', code: field.usage, codeHex: `btn${field.usage}`, evdevCode: info.evdevCode, pressed, value, label: info.label }); }
          } else if (info.control === 'hat') {
            const dir = value >= 0 && value <= 7 ? HAT_DIRS[value] : 'center';
            if (prev.get(key) !== dir) { prev.set(key, dir); send({ monitorId, kind: 'hat', source: 'hidraw', code: field.usage, codeHex: 'hat', evdevCode: info.evdevCode, value, dir, label: info.label }); }
          } else { // axis
            const dir = bucket(value, field);
            if (prev.get(key) !== dir) { prev.set(key, dir); send({ monitorId, kind: 'axis', source: 'hidraw', code: field.usage, codeHex: info.label, evdevCode: info.evdevCode, value, dir, label: info.label }); }
          }
        }
      };
      const frameLen = layout.lengths[layout.hasReportId ? Object.keys(layout.lengths)[0] : 0] || descBuf.length;
      stream.on('data', (chunk) => {
        acc = acc.length ? Buffer.concat([acc, chunk]) : chunk;
        if (layout.hasReportId) {
          // Variable framing by leading report id.
          while (acc.length >= 1) {
            const id = acc[0];
            const len = layout.lengths[id];
            if (!len || acc.length < len) break;
            handleReport(acc.subarray(0, len));
            acc = acc.subarray(len);
          }
        } else {
          while (acc.length >= frameLen) { handleReport(acc.subarray(0, frameLen)); acc = acc.subarray(frameLen); }
        }
      });
      if (stream.stderr) stream.stderr.on('data', () => { /* ignore */ });
      stream.on('close', () => { controllerInputMonitors.delete(monitorId); try { client.end(); } catch { /* ignore */ } send({ monitorId, kind: 'closed' }); });
      resolve({ ok: true, monitorId, eventPath: devicePath, source: 'hidraw', fieldCount: fieldInfos.length, message: `${devicePath} HID 입력 모니터를 시작했습니다.` });
    });
  });
}

function execCollectBuffer(client, command) {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) { reject(error); return; }
      const chunks = [];
      stream.on('data', (buffer) => chunks.push(buffer));
      if (stream.stderr) stream.stderr.on('data', () => { /* ignore */ });
      stream.on('close', () => resolve(Buffer.concat(chunks)));
    });
  });
}

async function controllerFsStartInputMonitor(request = {}, event) {
  const monitorId = String(request.monitorId || `mon-${Date.now()}`);
  const devicePath = String(request.eventPath || '');
  const isHidraw = /^\/dev\/hidraw[0-9]+$/.test(devicePath);
  const isJs = /^\/dev\/input\/js[0-9]+$/.test(devicePath);
  const isEvent = /^\/dev\/input\/event[0-9]+$/.test(devicePath);
  if (!isHidraw && !isJs && !isEvent) return { ok: false, monitorId, message: '잘못된 입력 장치 경로입니다.', errorCode: 'CONTROLLER_FS_BAD_EVENT_PATH' };
  controllerFsStopInputMonitorInternal(monitorId);
  const send = (payload) => { try { event?.sender?.send('controllerFs:input:event', payload); } catch { /* renderer gone */ } };
  if (isHidraw) {
    try { return await startHidrawMonitor(devicePath, monitorId, send, request); }
    catch (error) { return { ok: false, monitorId, message: sanitizeControllerFsMessage(error), errorCode: error.code || 'CONTROLLER_FS_MONITOR_FAILED' }; }
  }
  const parseFrame = isJs ? parseJoydevFrame : parseEvdevFrame;
  try {
    const { session } = await resolveControllerFsProfile(request.profileId);
    const client = await createSshClient(session);
    return await new Promise((resolve) => {
      // timeout caps the monitor so a forgotten session can't stream forever.
      client.exec(`timeout 600 cat ${devicePath}`, (error, stream) => {
        if (error) { try { client.end(); } catch { /* ignore */ } resolve({ ok: false, monitorId, message: sanitizeControllerFsMessage(error), errorCode: 'CONTROLLER_FS_MONITOR_FAILED' }); return; }
        controllerInputMonitors.set(monitorId, { client, stream });
        let acc = Buffer.alloc(0);
        stream.on('data', (chunk) => {
          acc = acc.length ? Buffer.concat([acc, chunk]) : chunk;
          acc = parseFrame(acc, send, monitorId);
        });
        if (stream.stderr) stream.stderr.on('data', () => { /* ignore */ });
        stream.on('close', () => { controllerInputMonitors.delete(monitorId); try { client.end(); } catch { /* ignore */ } send({ monitorId, kind: 'closed' }); });
        resolve({ ok: true, monitorId, eventPath: devicePath, source: isJs ? 'js' : 'evdev', message: `${devicePath} 입력 모니터를 시작했습니다.` });
      });
    });
  } catch (error) {
    return { ok: false, monitorId, message: sanitizeControllerFsMessage(error), errorCode: error.code || 'CONTROLLER_FS_MONITOR_FAILED' };
  }
}

async function controllerFsStopInputMonitor(request = {}) {
  controllerFsStopInputMonitorInternal(String(request.monitorId || ''));
  return { ok: true };
}

function createRomFsError(code, message, detail) {
  const error = new Error(message);
  error.code = code;
  if (detail) error.detail = detail;
  return error;
}

function sanitizeRomFsMessage(error) {
  return String(error?.message || error || 'ROM 파일 작업에 실패했습니다.').replace(/password|privateKey|passphrase|token/gi, '[secret]');
}

function romFsResult(operationType, startedAt, fields = {}) {
  const finishedAt = new Date().toISOString();
  return {
    ok: Boolean(fields.ok),
    operationType,
    status: fields.status || (fields.ok ? 'completed' : 'failed'),
    startedAt,
    finishedAt,
    sourcePath: fields.sourcePath,
    targetPath: fields.targetPath,
    fileCount: fields.fileCount ?? 0,
    totalBytes: fields.totalBytes ?? 0,
    errorCode: fields.errorCode,
    message: fields.message || (fields.ok ? '작업이 완료되었습니다.' : '작업에 실패했습니다.'),
    detail: fields.detail,
  };
}

function normalizeRemoteRomFsPath(input) {
  const raw = String(input || '').trim();
  if (!raw) throw createRomFsError('ROM_FS_PATH_REQUIRED', 'MiSTer 경로가 필요합니다.');
  if (raw.includes('\\') || raw.includes('\0')) throw createRomFsError('ROM_FS_PATH_BLOCKED', 'Windows 경로 구분자 또는 잘못된 문자는 원격 경로에 사용할 수 없습니다.');
  if (!raw.startsWith('/')) throw createRomFsError('ROM_FS_PATH_BLOCKED', 'MiSTer 경로는 / 로 시작하는 절대경로여야 합니다.');
  const segments = raw.split('/').filter(Boolean);
  if (segments.includes('..')) throw createRomFsError('ROM_FS_PATH_BLOCKED', '상위 폴더 이동(..)은 허용하지 않습니다.');
  const normalized = path.posix.normalize(raw);
  if (normalized === '.' || !normalized.startsWith('/')) throw createRomFsError('ROM_FS_PATH_BLOCKED', '원격 경로를 안전하게 해석할 수 없습니다.');
  return normalized.replace(/\/+$/g, '') || '/';
}

function romFsAllowedRootFor(targetPath) {
  const normalized = normalizeRemoteRomFsPath(targetPath);
  return romFsQuickPaths.find((root) => normalized === root || (root !== '/' && normalized.startsWith(`${root}/`))) || '/';
}

function assertRomFsAllowedPath(targetPath, options = {}) {
  const normalized = normalizeRemoteRomFsPath(targetPath);
  const root = romFsAllowedRootFor(normalized);
  const segments = normalized.split('/').filter(Boolean);
  if (!options.allowTrashRoot && segments.at(-1) === romFsTrashFolderName) {
    throw createRomFsError('ROM_FS_PATH_BLOCKED', '휴지통 루트 자체는 직접 파일 대상으로 사용할 수 없습니다.');
  }
  return { normalized, root };
}

function validateRomFsName(name) {
  const value = String(name || '').trim();
  if (!value) throw createRomFsError('ROM_FS_INVALID_NAME', '이름이 필요합니다.');
  if (value === '.' || value === '..' || value.includes('/') || value.includes('\\') || value.includes('\0')) {
    throw createRomFsError('ROM_FS_INVALID_NAME', '파일/폴더 이름에 /, \\, .. 문자는 사용할 수 없습니다.');
  }
  return value;
}

function rememberRomFsLocalGrant(folderPath) {
  if (!folderPath) return undefined;
  const resolved = path.resolve(folderPath);
  romFsLocalFolderGrants.add(resolved.toLowerCase());
  return resolved;
}

function assertRomFsLocalGrant(targetPath) {
  const resolved = path.resolve(String(targetPath || ''));
  const lower = resolved.toLowerCase();
  const allowed = [...romFsLocalFolderGrants].some((grant) => lower === grant || lower.startsWith(`${grant.toLowerCase()}${path.sep}`));
  if (!allowed) throw createRomFsError('ROM_FS_LOCAL_SCOPE_BLOCKED', 'PC 파일 작업은 앱에서 사용자가 선택한 파일/폴더 범위 안에서만 허용됩니다.');
  return resolved;
}

async function hasRomFsLocalDirectoryChildren(folderPath) {
  try {
    const dirents = await fs.readdir(folderPath, { withFileTypes: true });
    return dirents.some((dirent) => dirent.isDirectory());
  } catch {
    return false;
  }
}

async function romFsLocalTreeEntry(folderPath, depth = 0, parentPath) {
  const resolved = rememberRomFsLocalGrant(folderPath);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) throw createRomFsError('ROM_FS_LOCAL_NOT_DIRECTORY', 'PC 폴더만 트리에 표시할 수 있습니다.');
  const parsed = path.parse(resolved);
  return {
    id: `local-tree:${resolved}`,
    name: path.basename(resolved) || parsed.root || resolved,
    path: resolved,
    parentPath,
    depth,
    hasChildren: await hasRomFsLocalDirectoryChildren(resolved),
  };
}

async function romFsListLocalDriveRoots() {
  const roots = [];
  const seen = new Set();
  if (process.platform === 'win32') {
    for (let code = 65; code <= 90; code += 1) {
      const driveRoot = `${String.fromCharCode(code)}:\\`;
      try {
        const stat = await fs.stat(driveRoot);
        if (!stat.isDirectory()) continue;
        const key = path.resolve(driveRoot).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        roots.push(await romFsLocalTreeEntry(driveRoot, 0));
      } catch {
        // Missing or inaccessible drive letters are normal.
      }
    }
  } else {
    roots.push(await romFsLocalTreeEntry(path.parse(app.getPath('home')).root || '/', 0));
  }
  return roots;
}

function sftpWrap(sftp, method, ...args) {
  return new Promise((resolve, reject) => {
    sftp[method](...args, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

async function sftpLstat(sftp, targetPath) {
  try {
    return await sftpWrap(sftp, 'lstat', targetPath);
  } catch (error) {
    if (error?.code === 2) return undefined;
    throw error;
  }
}

async function sftpFastPut(sftp, localPath, remotePath) {
  return sftpWrap(sftp, 'fastPut', localPath, remotePath);
}

async function sftpFastGet(sftp, remotePath, localPath) {
  return sftpWrap(sftp, 'fastGet', remotePath, localPath);
}

async function sftpWriteUtf8File(sftp, remotePath, content) {
  return new Promise((resolve, reject) => {
    sftp.writeFile(remotePath, Buffer.from(String(content), 'utf8'), (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function sftpWriteBuffer(sftp, remotePath, bytes) {
  return new Promise((resolve, reject) => {
    sftp.writeFile(remotePath, Buffer.from(bytes), (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function sftpRename(sftp, fromPath, toPath) {
  return sftpWrap(sftp, 'rename', fromPath, toPath);
}

async function sftpUnlink(sftp, targetPath) {
  return sftpWrap(sftp, 'unlink', targetPath);
}

async function sftpRmdir(sftp, targetPath) {
  return sftpWrap(sftp, 'rmdir', targetPath);
}

async function sftpMkdirOne(sftp, targetPath) {
  try {
    await sftpWrap(sftp, 'mkdir', targetPath);
  } catch (error) {
    if (error?.code !== 4 && error?.code !== 'EEXIST') throw error;
  }
}

async function sftpMkdirRecursive(sftp, targetPath) {
  const { normalized } = assertRomFsAllowedPath(targetPath, { allowTrashRoot: true });
  const parts = normalized.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = `${current}/${validateRomFsName(part)}`;
    const existing = await sftpLstat(sftp, current);
    if (!existing) await sftpMkdirOne(sftp, current);
  }
  return normalized;
}

async function assertNoRomFsSymlink(sftp, targetPath) {
  const { normalized } = assertRomFsAllowedPath(targetPath, { allowTrashRoot: true });
  const parts = normalized.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = `${current}/${part}`;
    const attrs = await sftpLstat(sftp, current);
    if (attrs?.isSymbolicLink?.()) throw createRomFsError('ROM_FS_SYMLINK_BLOCKED', '심볼릭 링크 경로는 ROM 파일 작업에서 허용하지 않습니다.', { targetPath: current });
  }
  return normalized;
}

function romFsEntryFromRemote(name, parentPath, attrs, profileId) {
  const entryPath = `${parentPath.replace(/\/+$/g, '')}/${name}`;
  const isDirectory = Boolean(attrs?.isDirectory?.());
  const isFile = Boolean(attrs?.isFile?.());
  const extension = isFile ? path.posix.extname(name).replace(/^\./, '').toLowerCase() : undefined;
  return {
    id: `remote:${profileId || 'active'}:${entryPath}`,
    name,
    path: entryPath,
    parentPath,
    location: 'mister',
    type: isDirectory ? 'directory' : isFile ? 'file' : 'unknown',
    sizeBytes: Number(attrs?.size || 0),
    modifiedAt: attrs?.mtime ? new Date(Number(attrs.mtime) * 1000).toISOString() : undefined,
    extension,
    root: romFsAllowedRootFor(entryPath),
    profileId,
  };
}

function romFsEntryFromLocal(filePath, stat, folderPath) {
  const isDirectory = stat.isDirectory();
  const isFile = stat.isFile();
  return {
    id: `local:${filePath}`,
    name: path.basename(filePath),
    path: filePath,
    parentPath: folderPath,
    location: 'local',
    type: isDirectory ? 'directory' : isFile ? 'file' : 'unknown',
    sizeBytes: isFile ? stat.size : 0,
    modifiedAt: stat.mtime?.toISOString?.(),
    extension: isFile ? path.extname(filePath).replace(/^\./, '').toLowerCase() : undefined,
  };
}

async function resolveRomFsProfile(profileId) {
  const id = String(profileId || activeMisterProfile?.profileId || '');
  const profiles = await readJsonFile(appDataPath('profiles', profileFileName), []);
  const profile = (Array.isArray(profiles) ? profiles.map(sanitizeProfile) : []).find((item) => item.id === id)
    || (activeMisterProfile ? {
      id: activeMisterProfile.profileId,
      alias: activeMisterProfile.alias,
      ipAddress: activeMisterProfile.ipAddress,
      port: activeMisterProfile.port || 22,
      username: activeMisterProfile.username || 'root',
    } : undefined);
  if (!profile?.ipAddress) throw createRomFsError('ROM_FS_NO_ACTIVE_PROFILE', 'MiSTer 연결이 필요합니다. 먼저 MiSTer 연결 메뉴에서 연결하세요.');
  const password = await loadProfilePassword(profile.id);
  const session = rememberSession({
    profileId: profile.id,
    host: profile.ipAddress,
    port: profile.port || 22,
    username: profile.username || 'root',
    password: password || '1',
  });
  return { profile, session };
}

async function withRomFsClient(profileId, callback) {
  const { profile, session } = await resolveRomFsProfile(profileId);
  const client = await createSshClient(session);
  try {
    const sftp = await sftpClient(client);
    return await callback({ profile, session, client, sftp });
  } finally {
    client.end();
  }
}

function assertRomFsTrashDeletePath(targetPath) {
  const { normalized } = assertRomFsAllowedPath(targetPath, { allowTrashRoot: true });
  const trashRoot = `${remotePaths.mediaFat}/${romFsTrashFolderName}`;
  if (normalized === trashRoot || !normalized.startsWith(`${trashRoot}/`)) {
    throw createRomFsError('ROM_FS_DELETE_PATH_BLOCKED', '영구 삭제는 /media/fat/.hello-mister-trash 안의 항목에만 허용됩니다.');
  }
  return normalized;
}

async function sftpDeleteTrashRecursive(sftp, targetPath) {
  const normalized = assertRomFsTrashDeletePath(targetPath);
  const attrs = await sftpLstat(sftp, normalized);
  if (!attrs) throw createRomFsError('ROM_FS_NOT_FOUND', '영구 삭제할 휴지통 항목을 찾지 못했습니다.');
  if (attrs.isDirectory?.()) {
    const entries = await sftpReadDir(sftp, normalized);
    const summary = { fileCount: 0, folderCount: 1, totalBytes: 0 };
    for (const entry of entries) {
      const child = await sftpDeleteTrashRecursive(sftp, `${normalized}/${entry.filename}`);
      summary.fileCount += child.fileCount;
      summary.folderCount += child.folderCount;
      summary.totalBytes += child.totalBytes;
    }
    await sftpRmdir(sftp, normalized);
    return summary;
  }
  await sftpUnlink(sftp, normalized);
  return { fileCount: 1, folderCount: 0, totalBytes: Number(attrs.size || 0) };
}

async function romFsListRemote(request = {}) {
  try {
    const targetPath = assertRomFsAllowedPath(request.path || remotePaths.games, { allowTrashRoot: true }).normalized;
    return await withRomFsClient(request.profileId, async ({ profile, sftp }) => {
      await assertNoRomFsSymlink(sftp, targetPath);
      const entries = (await sftpReadDir(sftp, targetPath))
        .filter((item) => item.filename !== '.' && item.filename !== '..')
        .map((item) => romFsEntryFromRemote(item.filename, targetPath, item.attrs, profile.id))
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === 'directory' ? -1 : 1));
      return { ok: true, path: targetPath, profileId: profile.id, entries, message: `${entries.length}개 항목을 읽었습니다.` };
    });
  } catch (error) {
    return { ok: false, path: request.path, entries: [], errorCode: error.code || 'ROM_FS_LIST_FAILED', message: sanitizeRomFsMessage(error) };
  }
}

async function romFsStatRemote(request = {}) {
  try {
    const targetPath = assertRomFsAllowedPath(request.path).normalized;
    return await withRomFsClient(request.profileId, async ({ profile, sftp }) => {
      await assertNoRomFsSymlink(sftp, targetPath);
      const attrs = await sftpLstat(sftp, targetPath);
      if (!attrs) return { ok: false, path: targetPath, errorCode: 'ROM_FS_NOT_FOUND', message: '원격 파일을 찾지 못했습니다.' };
      return { ok: true, entry: romFsEntryFromRemote(path.posix.basename(targetPath), path.posix.dirname(targetPath), attrs, profile.id), message: '원격 파일 정보를 읽었습니다.' };
    });
  } catch (error) {
    return { ok: false, path: request.path, errorCode: error.code || 'ROM_FS_STAT_FAILED', message: sanitizeRomFsMessage(error) };
  }
}

async function romFsCheckCapability(request = {}) {
  const checkedAt = new Date().toISOString();
  const requestedRoot = request.root || remotePaths.mediaFat;
  try {
    const writeRoot = assertRomFsAllowedPath(requestedRoot, { allowTrashRoot: true }).normalized;
    return await withRomFsClient(request.profileId, async ({ profile, sftp }) => {
      try {
        await assertNoRomFsSymlink(sftp, writeRoot);
        await sftpReadDir(sftp, writeRoot);
      } catch (error) {
        return {
          ok: false,
          status: 'failed',
          canRead: false,
          canWrite: true,
          checkedAt,
          profileId: profile.id,
          readRoot: writeRoot,
          writeRoot,
          errorCode: error.code || 'ROM_FS_READ_CAPABILITY_FAILED',
          message: `MiSTer 폴더를 읽지 못했습니다: ${sanitizeRomFsMessage(error)}`,
        };
      }

      return {
        ok: true,
        status: 'read-write',
        canRead: true,
        canWrite: true,
        checkedAt,
        profileId: profile.id,
        readRoot: writeRoot,
        writeRoot,
        message: 'MiSTer SFTP 파일 읽기/쓰기 작업을 허용했습니다. 실제 파일시스템 거부는 작업 결과로 표시됩니다.',
      };
    });
  } catch (error) {
    return {
      ok: false,
      status: activeMisterProfile ? 'failed' : 'not-connected',
      canRead: false,
      canWrite: Boolean(activeMisterProfile),
      checkedAt,
      errorCode: error.code || 'ROM_FS_CAPABILITY_FAILED',
      message: sanitizeRomFsMessage(error),
    };
  }
}

async function romFsSelectLocalFolder() {
  const result = await dialog.showOpenDialog({ title: 'PC ROM 폴더 열기', properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, cancelled: true, message: 'PC 폴더 선택이 취소되었습니다.' };
  const folderPath = rememberRomFsLocalGrant(result.filePaths[0]);
  return { ok: true, folderPath, message: 'PC 폴더를 ROM 관리 범위에 추가했습니다.' };
}

async function romFsListLocalFolder(request = {}) {
  try {
    const folderPath = assertRomFsLocalGrant(request.folderPath);
    const dirents = await fs.readdir(folderPath, { withFileTypes: true });
    const entries = [];
    for (const dirent of dirents) {
      const filePath = path.join(folderPath, dirent.name);
      const stat = await fs.stat(filePath);
      entries.push(romFsEntryFromLocal(filePath, stat, folderPath));
    }
    entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === 'directory' ? -1 : 1));
    return { ok: true, folderPath, entries, message: `${entries.length}개 PC 항목을 읽었습니다.` };
  } catch (error) {
    return { ok: false, folderPath: request.folderPath, entries: [], errorCode: error.code || 'ROM_FS_LOCAL_LIST_FAILED', message: sanitizeRomFsMessage(error) };
  }
}

async function romFsListLocalTreeRoots() {
  try {
    const roots = await romFsListLocalDriveRoots();
    return { ok: true, roots, message: `${roots.length}개 PC 드라이브를 읽었습니다.` };
  } catch (error) {
    return { ok: false, roots: [], errorCode: error.code || 'ROM_FS_LOCAL_TREE_ROOTS_FAILED', message: sanitizeRomFsMessage(error) };
  }
}

async function romFsListLocalTreeFolder(request = {}) {
  try {
    const folderPath = assertRomFsLocalGrant(request.folderPath);
    const depth = Number.isFinite(Number(request.depth)) ? Number(request.depth) : 0;
    const dirents = await fs.readdir(folderPath, { withFileTypes: true });
    const children = [];
    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue;
      const childPath = path.join(folderPath, dirent.name);
      try {
        children.push(await romFsLocalTreeEntry(childPath, depth + 1, folderPath));
      } catch {
        // Skip inaccessible child folders in the tree, but keep the parent usable.
      }
    }
    children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return { ok: true, folderPath, children, message: `${children.length}개 하위 PC 폴더를 읽었습니다.` };
  } catch (error) {
    return { ok: false, folderPath: request.folderPath, children: [], errorCode: error.code || 'ROM_FS_LOCAL_TREE_FOLDER_FAILED', message: sanitizeRomFsMessage(error) };
  }
}

function romFsTargetPath(folderPath, fileName) {
  const folder = assertRomFsAllowedPath(folderPath).normalized;
  return assertRomFsAllowedPath(`${folder}/${validateRomFsName(fileName)}`).normalized;
}

function romFsTempUploadPath(targetPath) {
  return `${targetPath}.hello-mister-uploading`;
}

async function remoteTrashPathFor(sftp, sourcePath) {
  const { normalized } = assertRomFsAllowedPath(sourcePath);
  const trashRoot = `${remotePaths.mediaFat}/${romFsTrashFolderName}`;
  if (normalized === trashRoot || normalized.startsWith(`${trashRoot}/`)) {
    throw createRomFsError('ROM_FS_TRASH_SOURCE_BLOCKED', '휴지통 안의 항목은 다시 휴지통으로 이동할 수 없습니다.');
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-');
  const relativeSourcePath = normalized.startsWith(`${remotePaths.mediaFat}/`)
    ? normalized.slice(remotePaths.mediaFat.length + 1)
    : normalized.replace(/^\/+/, '');
  const trashBase = `${trashRoot}/${stamp}`;
  await sftpMkdirRecursive(sftp, trashBase);
  const targetPath = `${trashBase}/${relativeSourcePath}`;
  await sftpMkdirRecursive(sftp, path.posix.dirname(targetPath));
  return targetPath;
}

async function romFsCopyLocalToMister(request = {}) {
  const startedAt = new Date().toISOString();
  try {
    const localPath = assertRomFsLocalGrant(request.localPath);
    const localStat = await fs.stat(localPath);
    if (!localStat.isFile()) throw createRomFsError('ROM_FS_LOCAL_NOT_FILE', 'PC에서 선택한 항목이 파일이 아닙니다.');
    const targetPath = romFsTargetPath(request.targetFolderPath, request.targetFileName || path.basename(localPath));
    const conflictPolicy = request.conflictPolicy || 'skip';
    return await withRomFsClient(request.profileId, async ({ sftp }) => {
      await sftpMkdirRecursive(sftp, path.posix.dirname(targetPath));
      const existing = await sftpLstat(sftp, targetPath);
      if (existing && conflictPolicy === 'skip') {
        return romFsResult('localToMisterCopy', startedAt, { ok: true, status: 'skipped', sourcePath: localPath, targetPath, fileCount: 1, totalBytes: localStat.size, message: '같은 이름 파일이 있어 기본 정책에 따라 건너뛰었습니다.' });
      }
      const finalPath = existing && conflictPolicy === 'rename' ? await uniqueRemotePath(sftp, targetPath) : targetPath;
      const tempPath = romFsTempUploadPath(finalPath);
      await sftpFastPut(sftp, localPath, tempPath);
      const uploaded = await sftpLstat(sftp, tempPath);
      if (Number(uploaded?.size || -1) !== Number(localStat.size)) {
        await cleanupRemoteTemp(sftp, tempPath);
        throw createRomFsError('ROM_FS_VERIFY_FAILED', '업로드 후 파일 크기 확인에 실패했습니다.');
      }
      if (existing && conflictPolicy === 'overwrite') await sftpRename(sftp, targetPath, await remoteTrashPathFor(sftp, targetPath));
      await sftpRename(sftp, tempPath, finalPath);
      return romFsResult('localToMisterCopy', startedAt, { ok: true, sourcePath: localPath, targetPath: finalPath, fileCount: 1, totalBytes: localStat.size, message: 'PC에서 MiSTer로 파일을 복사했습니다.' });
    });
  } catch (error) {
    return romFsResult('localToMisterCopy', startedAt, { ok: false, sourcePath: request.localPath, targetPath: request.targetFolderPath, errorCode: error.code || 'ROM_FS_COPY_FAILED', message: sanitizeRomFsMessage(error) });
  }
}

async function romFsCopyMisterToLocal(request = {}) {
  const startedAt = new Date().toISOString();
  try {
    const sourcePath = assertRomFsAllowedPath(request.remotePath).normalized;
    const targetFolder = assertRomFsLocalGrant(request.localFolderPath);
    // Create the (possibly nested) destination folder so recursive folder downloads land in their subfolders.
    await fs.mkdir(targetFolder, { recursive: true });
    return await withRomFsClient(request.profileId, async ({ sftp }) => {
      await assertNoRomFsSymlink(sftp, sourcePath);
      const attrs = await sftpLstat(sftp, sourcePath);
      if (!attrs?.isFile?.()) throw createRomFsError('ROM_FS_REMOTE_NOT_FILE', 'MiSTer에서 선택한 항목이 파일이 아닙니다.');
      const finalLocalPath = await localConflictPath(path.join(targetFolder, request.targetFileName || path.posix.basename(sourcePath)), request.conflictPolicy || 'skip');
      if (!finalLocalPath) return romFsResult('misterToLocalCopy', startedAt, { ok: true, status: 'skipped', sourcePath, targetPath: targetFolder, fileCount: 1, totalBytes: attrs.size, message: '같은 이름 PC 파일이 있어 기본 정책에 따라 건너뛰었습니다.' });
      const tempLocalPath = `${finalLocalPath}.hello-mister-downloading`;
      await sftpFastGet(sftp, sourcePath, tempLocalPath);
      const downloaded = await fs.stat(tempLocalPath);
      if (Number(downloaded.size) !== Number(attrs.size || 0)) {
        await fs.rm(tempLocalPath, { force: true });
        throw createRomFsError('ROM_FS_VERIFY_FAILED', '다운로드 후 파일 크기 확인에 실패했습니다.');
      }
      if ((request.conflictPolicy || 'skip') === 'overwrite') await fs.rm(finalLocalPath, { force: true });
      await fs.rename(tempLocalPath, finalLocalPath);
      return romFsResult('misterToLocalCopy', startedAt, { ok: true, sourcePath, targetPath: finalLocalPath, fileCount: 1, totalBytes: attrs.size || 0, message: 'MiSTer에서 PC로 파일을 복사했습니다.' });
    });
  } catch (error) {
    return romFsResult('misterToLocalCopy', startedAt, { ok: false, sourcePath: request.remotePath, targetPath: request.localFolderPath, errorCode: error.code || 'ROM_FS_COPY_FAILED', message: sanitizeRomFsMessage(error) });
  }
}

async function romFsCopyMisterToMister(request = {}) {
  const startedAt = new Date().toISOString();
  let tempLocalPath;
  try {
    const sourcePath = assertRomFsAllowedPath(request.sourceRemotePath).normalized;
    const targetPath = romFsTargetPath(request.targetFolderPath, request.targetFileName || path.posix.basename(sourcePath));
    const transferDir = appDataPath('rom', 'transfer-temp');
    await fs.mkdir(transferDir, { recursive: true });
    rememberRomFsLocalGrant(transferDir);
    tempLocalPath = path.join(transferDir, `${crypto.randomUUID()}-${path.posix.basename(sourcePath)}`);
    const sourceResult = await romFsCopyMisterToLocal({
      profileId: request.sourceProfileId,
      remotePath: sourcePath,
      localFolderPath: transferDir,
      targetFileName: path.basename(tempLocalPath),
      conflictPolicy: 'overwrite',
    });
    if (!sourceResult.ok) throw createRomFsError(sourceResult.errorCode || 'ROM_FS_SOURCE_COPY_FAILED', sourceResult.message);
    const targetResult = await romFsCopyLocalToMister({
      profileId: request.targetProfileId,
      localPath: tempLocalPath,
      targetFolderPath: request.targetFolderPath,
      targetFileName: request.targetFileName || path.posix.basename(sourcePath),
      conflictPolicy: request.conflictPolicy || 'skip',
    });
    if (!targetResult.ok) throw createRomFsError(targetResult.errorCode || 'ROM_FS_TARGET_COPY_FAILED', targetResult.message);
    return romFsResult('misterToMisterCopy', startedAt, { ok: true, sourcePath, targetPath, fileCount: 1, totalBytes: targetResult.totalBytes || sourceResult.totalBytes || 0, message: 'MiSTer 간 ROM 복사 작업을 완료했습니다.' });
  } catch (error) {
    return romFsResult('misterToMisterCopy', startedAt, { ok: false, sourcePath: request.sourceRemotePath, targetPath: request.targetFolderPath, errorCode: error.code || 'ROM_FS_COPY_FAILED', message: sanitizeRomFsMessage(error) });
  } finally {
    if (tempLocalPath) await fs.rm(tempLocalPath, { force: true }).catch(() => undefined);
  }
}

async function romFsMoveRemote(request = {}) {
  const startedAt = new Date().toISOString();
  try {
    const sourcePath = assertRomFsAllowedPath(request.sourcePath).normalized;
    const targetPath = assertRomFsAllowedPath(request.targetPath).normalized;
    return await withRomFsClient(request.profileId, async ({ sftp }) => {
      await assertNoRomFsSymlink(sftp, sourcePath);
      const existing = await sftpLstat(sftp, targetPath);
      if (existing && (request.conflictPolicy || 'skip') === 'skip') return romFsResult('moveRemote', startedAt, { ok: true, status: 'skipped', sourcePath, targetPath, fileCount: 1, message: '같은 이름 파일이 있어 이동을 건너뛰었습니다.' });
      await sftpMkdirRecursive(sftp, path.posix.dirname(targetPath));
      if (existing && request.conflictPolicy === 'overwrite') await sftpRename(sftp, targetPath, await remoteTrashPathFor(sftp, targetPath));
      await sftpRename(sftp, sourcePath, targetPath);
      return romFsResult('moveRemote', startedAt, { ok: true, sourcePath, targetPath, fileCount: 1, message: 'MiSTer 내부에서 파일을 이동했습니다.' });
    });
  } catch (error) {
    return romFsResult('moveRemote', startedAt, { ok: false, sourcePath: request.sourcePath, targetPath: request.targetPath, errorCode: error.code || 'ROM_FS_MOVE_FAILED', message: sanitizeRomFsMessage(error) });
  }
}

async function romFsRenameRemote(request = {}) {
  const sourcePath = assertRomFsAllowedPath(request.sourcePath).normalized;
  const newName = validateRomFsName(request.newName);
  return romFsMoveRemote({ profileId: request.profileId, sourcePath, targetPath: `${path.posix.dirname(sourcePath)}/${newName}`, conflictPolicy: request.conflictPolicy || 'skip' });
}

async function romFsTrashRemote(request = {}) {
  const startedAt = new Date().toISOString();
  try {
    const sourcePath = assertRomFsAllowedPath(request.sourcePath).normalized;
    return await withRomFsClient(request.profileId, async ({ sftp }) => {
      await assertNoRomFsSymlink(sftp, sourcePath);
      const attrs = await sftpLstat(sftp, sourcePath);
      if (!attrs) throw createRomFsError('ROM_FS_NOT_FOUND', '휴지통으로 옮길 파일을 찾지 못했습니다.');
      const trashPath = await remoteTrashPathFor(sftp, sourcePath);
      await sftpRename(sftp, sourcePath, trashPath);
      await appendRomFsTrashLog({ profileId: request.profileId || activeMisterProfile?.profileId, originalPath: sourcePath, trashPath, sizeBytes: attrs.size || 0 });
      return romFsResult('trashRemote', startedAt, { ok: true, sourcePath, targetPath: trashPath, fileCount: 1, totalBytes: attrs.size || 0, message: 'MiSTer 파일을 휴지통으로 이동했습니다.' });
    });
  } catch (error) {
    return romFsResult('trashRemote', startedAt, { ok: false, sourcePath: request.sourcePath, errorCode: error.code || 'ROM_FS_TRASH_FAILED', message: sanitizeRomFsMessage(error) });
  }
}

async function romFsDeleteRemote(request = {}) {
  const startedAt = new Date().toISOString();
  try {
    if (!request.confirmed) {
      throw createRomFsError('ROM_FS_DELETE_CONFIRMATION_REQUIRED', '휴지통 영구 삭제 전 확인이 필요합니다.');
    }
    const sourcePath = assertRomFsTrashDeletePath(request.sourcePath);
    return await withRomFsClient(request.profileId, async ({ sftp }) => {
      const summary = await sftpDeleteTrashRecursive(sftp, sourcePath);
      return romFsResult('deleteRemote', startedAt, {
        ok: true,
        sourcePath,
        fileCount: summary.fileCount + summary.folderCount,
        totalBytes: summary.totalBytes,
        message: '휴지통 항목을 영구 삭제했습니다.',
      });
    });
  } catch (error) {
    return romFsResult('deleteRemote', startedAt, {
      ok: false,
      sourcePath: request.sourcePath,
      errorCode: error.code || 'ROM_FS_DELETE_FAILED',
      message: sanitizeRomFsMessage(error),
    });
  }
}

async function romFsRestoreRemote(request = {}) {
  return romFsMoveRemote({ profileId: request.profileId, sourcePath: request.trashPath, targetPath: request.originalPath, conflictPolicy: request.conflictPolicy || 'skip' });
}

async function romFsCreateLocalFolder(request = {}) {
  const startedAt = new Date().toISOString();
  try {
    // assertRomFsLocalGrant is prefix-based, so a not-yet-existing subfolder under a granted root passes. mkdir -p is
    // idempotent: ensuring an empty source folder on the PC side never errors when the folder already exists (merge).
    const targetFolder = assertRomFsLocalGrant(request.folderPath);
    await fs.mkdir(targetFolder, { recursive: true });
    return romFsResult('createFolderLocal', startedAt, { ok: true, targetPath: targetFolder, fileCount: 0, message: 'PC 폴더를 만들었습니다.' });
  } catch (error) {
    return romFsResult('createFolderLocal', startedAt, { ok: false, targetPath: request.folderPath, errorCode: error.code || 'ROM_FS_LOCAL_MKDIR_FAILED', message: sanitizeRomFsMessage(error) });
  }
}

async function romFsCreateRemoteFolder(request = {}) {
  const startedAt = new Date().toISOString();
  try {
    const parentPath = assertRomFsAllowedPath(request.parentPath).normalized;
    const folderName = validateRomFsName(request.folderName);
    const targetPath = assertRomFsAllowedPath(`${parentPath}/${folderName}`).normalized;
    return await withRomFsClient(request.profileId, async ({ sftp }) => {
      await sftpMkdirRecursive(sftp, targetPath);
      return romFsResult('createFolderRemote', startedAt, { ok: true, targetPath, fileCount: 0, message: 'MiSTer 대상 폴더를 만들었습니다.' });
    });
  } catch (error) {
    return romFsResult('createFolderRemote', startedAt, { ok: false, targetPath: request.parentPath, errorCode: error.code || 'ROM_FS_MKDIR_FAILED', message: sanitizeRomFsMessage(error) });
  }
}

async function cleanupRemoteTemp(sftp, tempPath) {
  try {
    await sftpUnlink(sftp, tempPath);
  } catch {
    // Cleanup failure is reported by the caller through the failed operation state.
  }
}

async function uniqueRemotePath(sftp, targetPath) {
  const extension = path.posix.extname(targetPath);
  const base = targetPath.slice(0, targetPath.length - extension.length);
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${base} (${index})${extension}`;
    if (!(await sftpLstat(sftp, candidate))) return candidate;
  }
  throw createRomFsError('ROM_FS_CONFLICT_UNRESOLVED', '충돌 없는 파일 이름을 만들지 못했습니다.');
}

async function localConflictPath(targetPath, conflictPolicy) {
  try {
    await fs.stat(targetPath);
    if (conflictPolicy === 'skip') return undefined;
    if (conflictPolicy === 'overwrite') return targetPath;
    const extension = path.extname(targetPath);
    const base = targetPath.slice(0, targetPath.length - extension.length);
    for (let index = 1; index < 1000; index += 1) {
      const candidate = `${base} (${index})${extension}`;
      try {
        await fs.stat(candidate);
      } catch {
        return candidate;
      }
    }
    throw createRomFsError('ROM_FS_CONFLICT_UNRESOLVED', '충돌 없는 PC 파일 이름을 만들지 못했습니다.');
  } catch (error) {
    if (error?.code === 'ENOENT') return targetPath;
    throw error;
  }
}

async function appendRomFsTrashLog(entry) {
  const filePath = appDataPath('rom', 'rom-trash-log.json');
  const entries = await readJsonFile(filePath, []);
  const safeEntry = {
    profileId: entry.profileId ? String(entry.profileId) : undefined,
    originalPath: String(entry.originalPath || ''),
    trashPath: String(entry.trashPath || ''),
    sizeBytes: Number(entry.sizeBytes || 0),
    movedAt: new Date().toISOString(),
  };
  await writeJsonFile(filePath, [safeEntry, ...(Array.isArray(entries) ? entries : [])].slice(0, 500));
}

const iniBackupRoot = '/media/fat/.hello-mister-backups/ini';
const iniTrashRoot = '/media/fat/.hello-mister-trash/ini';
const iniWriteCheckFileName = '.hello-mister-ini-write-check.tmp';

function createIniFsError(code, message, detail) {
  const error = new Error(message);
  error.code = code;
  if (detail) error.detail = detail;
  return error;
}

function sanitizeIniFsMessage(error) {
  return String(error?.message || error || 'INI 파일 작업에 실패했습니다.').replace(/password|privateKey|passphrase|token/gi, '[secret]');
}

const iniFsPhaseLabels = {
  connect: 'MiSTer 연결',
  validateFileName: 'INI 파일명 검증',
  readMediaFat: '/media/fat 읽기',
  writeCapabilityBackup: '백업 폴더 쓰기 확인',
  writeCapabilityTrash: '휴지통 이동 확인',
  readCurrent: '현재 원격 INI 읽기',
  createBackup: '백업 생성',
  writeLocalBackup: '로컬 백업 저장',
  writeRemote: '새 INI 저장',
  rereadRemote: '저장 후 다시 읽기',
  pruneBackups: '백업 정리',
  locateSource: '원격 INI 확인',
  createTrashDir: '휴지통 폴더 생성',
  moveToTrash: '휴지통 이동',
};

function iniFsFailureMessage(action, phase, error) {
  const label = iniFsPhaseLabels[phase] || phase || '작업';
  return `${action} 실패: ${label} 단계에서 실패했습니다. ${sanitizeIniFsMessage(error)}`;
}

function iniFsFailureResult({ action, phase, fileName, defaultCode, error, extra = {} }) {
  return {
    ok: false,
    fileName,
    message: iniFsFailureMessage(action, phase, error),
    errorCode: error?.code || defaultCode,
    phase,
    detail: {
      operation: action,
      phase,
      sanitizedDetail: sanitizeIniFsMessage(error),
      ...(error?.detail ? { safeDetail: error.detail } : {}),
    },
    ...extra,
  };
}

function normalizeIniFileName(fileName) {
  return String(fileName || '').trim().replace(/\\/g, '/').split('/').pop() || '';
}

function hasUnsafeControlChar(value) {
  return Array.from(String(value || '')).some((char) => char.charCodeAt(0) < 32);
}

const safeIniNameBodyPattern = '[A-Za-z0-9][A-Za-z0-9._ ()-]*';
const allowedAltIniNamePattern = /^MiSTer_alt_[1-3]\.ini$/i;
const allowedCustomIniNamePattern = new RegExp(`^MiSTer_${safeIniNameBodyPattern}\\.ini$`, 'i');
const invalidIniFileNameMessage = '허용되지 않은 INI 파일명입니다. MiSTer.ini, MiSTer_alt_1.ini, MiSTer_alt_2.ini, MiSTer_alt_3.ini, MiSTer_이름.ini 형식의 안전한 파일명만 사용할 수 있습니다.';

function assertAllowedIniFileName(fileName) {
  const normalized = normalizeIniFileName(fileName);
  const allowed = /^MiSTer\.ini$/i.test(normalized)
    || allowedAltIniNamePattern.test(normalized)
    || allowedCustomIniNamePattern.test(normalized);
  if (!allowed || normalized !== String(fileName || '').trim() || /[<>:"|?*]/.test(normalized) || hasUnsafeControlChar(normalized)) {
    throw createIniFsError('INI_FS_INVALID_FILENAME', invalidIniFileNameMessage);
  }
  if (normalized.includes('..')) {
    throw createIniFsError('INI_FS_INVALID_FILENAME', '허용되지 않은 INI 파일명입니다. 상위 폴더 이동(..)은 사용할 수 없습니다.');
  }
  return normalized;
}

function isSafeLocalIniDisplayFileName(fileName) {
  const normalized = normalizeIniFileName(fileName);
  return normalized === String(fileName || '').trim()
    && /\.ini$/i.test(normalized)
    && !normalized.includes('..')
    && !/[<>:"|?*]/.test(normalized)
    && !hasUnsafeControlChar(normalized);
}

function suggestedRemoteIniFileName(fileName) {
  const normalized = normalizeIniFileName(fileName);
  try {
    return assertAllowedIniFileName(normalized);
  } catch {
    const base = normalized.replace(/\.ini$/i, '').replace(/[^A-Za-z0-9._ -]/g, ' ').replace(/\s+/g, ' ').trim() || 'Imported';
    return `MiSTer_${base}.ini`;
  }
}

function iniFileKind(fileName) {
  if (/^MiSTer\.ini$/i.test(fileName)) return 'main';
  if (/^MiSTer_alt_1\.ini$/i.test(fileName)) return 'alt1';
  if (/^MiSTer_alt_2\.ini$/i.test(fileName)) return 'alt2';
  if (/^MiSTer_alt_3\.ini$/i.test(fileName)) return 'alt3';
  if (allowedAltIniNamePattern.test(fileName)) return 'alt';
  return 'custom';
}

function iniRemotePath(fileName) {
  return `/media/fat/${assertAllowedIniFileName(fileName)}`;
}

function iniAltNumber(kind) {
  if (kind === 'alt1') return 1;
  if (kind === 'alt2') return 2;
  if (kind === 'alt3') return 3;
  return undefined;
}

function iniSortRank(file) {
  if (file.source === 'remote' && file.kind === 'main') return 0;
  if (file.source === 'remote' && String(file.kind).startsWith('alt')) return 1;
  if (file.source === 'remote') return 2;
  if (file.source === 'local-import' || file.source === 'upload-ready') return 3;
  return 4;
}

function iniEntryIsDirectory(entry) {
  if (typeof entry?.attrs?.isDirectory === 'function') return Boolean(entry.attrs.isDirectory());
  if (typeof entry?.attrs?.isFile === 'function') return !entry.attrs.isFile();
  const typeMarker = String(entry?.longname || '').charAt(0);
  return typeMarker === 'd';
}

function iniEntryIsFileLike(entry) {
  if (iniEntryIsDirectory(entry)) return false;
  if (typeof entry?.attrs?.isFile === 'function') return Boolean(entry.attrs.isFile());
  const typeMarker = String(entry?.longname || '').charAt(0);
  if (typeMarker === '-') return true;
  return true;
}

function incrementIniExcludedReason(reasons, reason) {
  reasons[reason] = (reasons[reason] || 0) + 1;
}

function normalizeIniRemotePath(targetPath) {
  const raw = String(targetPath || '').trim();
  if (!raw || raw.includes('\\') || raw.includes('\0')) throw createIniFsError('INI_FS_PATH_BLOCKED', 'INI 원격 경로를 안전하게 해석할 수 없습니다.');
  const normalized = path.posix.normalize(raw);
  if (!normalized.startsWith('/media/fat/')) throw createIniFsError('INI_FS_PATH_BLOCKED', 'INI 작업은 /media/fat 아래의 허용된 INI 경로만 사용할 수 있습니다.');
  if (normalized.split('/').includes('..')) throw createIniFsError('INI_FS_PATH_BLOCKED', '상위 폴더 이동(..)은 허용하지 않습니다.');
  return normalized;
}

function assertIniRootWritePath(targetPath) {
  const normalized = normalizeIniRemotePath(targetPath);
  if (path.posix.dirname(normalized) !== '/media/fat') {
    throw createIniFsError('INI_FS_PATH_BLOCKED', '원격 INI 파일은 /media/fat 루트의 허용된 INI 파일명만 사용할 수 있습니다.', { targetPath: normalized });
  }
  const fileName = assertAllowedIniFileName(path.posix.basename(normalized));
  return `/media/fat/${fileName}`;
}

function assertIniWriteCheckPath(targetPath) {
  const normalized = normalizeIniRemotePath(targetPath);
  const allowed = new Set([
    `${iniBackupRoot}/${iniWriteCheckFileName}`,
    `${iniTrashRoot}/${iniWriteCheckFileName}`,
  ]);
  if (allowed.has(normalized)) return normalized;
  throw createIniFsError('INI_FS_WRITE_CHECK_PATH_BLOCKED', 'INI 쓰기 권한 확인은 INI 백업/휴지통 검사용 파일에만 허용됩니다.', { targetPath: normalized });
}

// Manual backups are named `{originalFileName} - NN.bak` (e.g. "MiSTer_Arcade.ini - 01.bak") so the file name
// itself identifies which INI it belongs to. NN is a zero-padded incrementing counter per original file.
function iniBackupFileName(fileName, number) {
  return `${fileName} - ${String(number).padStart(2, '0')}.bak`;
}

function parseIniBackupNumber(fileName, backupFileName) {
  const escaped = String(fileName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(backupFileName || '').match(new RegExp(`^${escaped} - ([0-9]{1,4})\\.bak$`, 'i'));
  return match ? Number(match[1]) : undefined;
}

function backupFileNameMatchesOriginal(fileName, backupFileName) {
  try {
    return parseIniBackupNumber(assertAllowedIniFileName(fileName), backupFileName) !== undefined;
  } catch {
    return false;
  }
}

function assertIniBackupWritePath(fileName, backupPath) {
  const normalizedFile = assertAllowedIniFileName(fileName);
  const normalized = normalizeIniRemotePath(backupPath);
  const expectedPrefix = `${iniBackupRoot}/${normalizedFile}/`;
  if (!normalized.startsWith(expectedPrefix) || !backupFileNameMatchesOriginal(normalizedFile, path.posix.basename(normalized))) {
    throw createIniFsError('INI_FS_BACKUP_PATH_BLOCKED', '선택한 백업 경로가 해당 INI 파일의 백업 폴더 밖에 있습니다.');
  }
  return normalized;
}

function assertIniBackupPath(fileName, backupPath) {
  return assertIniBackupWritePath(fileName, backupPath);
}

// A trashed INI file is `{stamp}-{iniName}`; a trashed backup is `{stamp}-{iniName} - NN.bak`. Returns the kind
// and the original INI file name so restore can route an INI back to /media/fat and a backup back to its folder.
function parseIniTrashName(trashFileName) {
  const stripped = String(trashFileName || '').match(/^[0-9]{8}-[0-9]{6}-(.+)$/i);
  if (!stripped) throw createIniFsError('INI_FS_TRASH_PATH_BLOCKED', '선택한 휴지통 파일명이 안전한 INI 휴지통 형식이 아닙니다.');
  const rest = stripped[1];
  const backup = rest.match(/^(.+) - [0-9]{1,4}\.bak$/i);
  if (backup) return { kind: 'backup', originalFileName: assertAllowedIniFileName(backup[1]), trashedName: rest };
  return { kind: 'ini', originalFileName: assertAllowedIniFileName(rest), trashedName: rest };
}

function trashFileNameToOriginal(fileName) {
  return parseIniTrashName(fileName).originalFileName;
}

function assertIniTrashWritePath(trashPath) {
  const normalized = normalizeIniRemotePath(trashPath);
  if (!normalized.startsWith(`${iniTrashRoot}/`) || path.posix.dirname(normalized) !== iniTrashRoot) {
    throw createIniFsError('INI_FS_TRASH_PATH_BLOCKED', '선택한 휴지통 경로가 INI 휴지통 밖에 있습니다.');
  }
  trashFileNameToOriginal(path.posix.basename(normalized));
  return normalized;
}

function assertIniTrashPath(trashPath) {
  return assertIniTrashWritePath(trashPath);
}

function iniTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-');
}

async function sftpMkdirRecursiveIni(sftp, targetPath) {
  const normalized = normalizeIniRemotePath(targetPath).replace(/\/+$/g, '');
  if (!(normalized === iniBackupRoot || normalized === iniTrashRoot || normalized.startsWith(`${iniBackupRoot}/`) || normalized.startsWith(`${iniTrashRoot}/`))) {
    throw createIniFsError('INI_FS_MKDIR_BLOCKED', 'INI 백업/휴지통 폴더 밖에는 원격 폴더를 만들 수 없습니다.');
  }
  const parts = normalized.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = `${current}/${part}`;
    if (current === '/media' || current === '/media/fat') continue;
    const existing = await sftpLstat(sftp, current);
    if (!existing) await sftpMkdirOne(sftp, current);
  }
  return normalized;
}

function iniMetadataPath(profileId) {
  return appDataPath('mister-ini', String(profileId || 'unknown'), 'ini-metadata.json');
}

function emptyIniMetadata(profileId) {
  return { schemaVersion: 1, profileId: String(profileId || 'unknown'), updatedAt: new Date().toISOString(), files: [] };
}

function sanitizeIniMetadataStore(store, profileId) {
  const now = new Date().toISOString();
  const files = Array.isArray(store?.files) ? store.files : [];
  return {
    schemaVersion: 1,
    profileId: String(profileId || store?.profileId || 'unknown'),
    updatedAt: now,
    files: files.map((item) => ({
      profileId: String(profileId || item.profileId || 'unknown'),
      fileName: (() => {
        const normalized = normalizeIniFileName(item.fileName);
        try {
          return assertAllowedIniFileName(normalized);
        } catch {
          if (isSafeLocalIniDisplayFileName(normalized)) return normalized;
          throw createIniFsError('INI_FS_INVALID_FILENAME', '허용되지 않은 INI 파일명입니다.');
        }
      })(),
      displayName: item.displayName ? String(item.displayName).slice(0, 120) : undefined,
      presetSlot: ['main', 'alt1', 'alt2', 'alt3', 'custom'].includes(item.presetSlot) ? item.presetSlot : (() => {
        try { return iniFileKind(assertAllowedIniFileName(item.fileName)); } catch { return 'custom'; }
      })(),
      notes: item.notes ? String(item.notes).slice(0, 1000) : undefined,
      source: ['remote', 'local-import', 'upload-ready', 'cache', 'missing-remote'].includes(item.source) ? item.source : undefined,
      localContent: item.localContent ? String(item.localContent).slice(0, 1024 * 1024) : undefined,
      localSizeBytes: Number.isFinite(Number(item.localSizeBytes)) ? Number(item.localSizeBytes) : undefined,
      localImportedAt: item.localImportedAt ? String(item.localImportedAt) : undefined,
      updatedAt: item.updatedAt || now,
    })),
  };
}

async function loadIniMetadata(profileId) {
  const store = await readJsonFile(iniMetadataPath(profileId), emptyIniMetadata(profileId));
  try {
    return sanitizeIniMetadataStore(store, profileId);
  } catch {
    return emptyIniMetadata(profileId);
  }
}

async function saveIniMetadata(store) {
  const profileId = String(store?.profileId || activeMisterProfile?.profileId || 'unknown');
  const safeStore = sanitizeIniMetadataStore(store, profileId);
  await writeJsonFile(iniMetadataPath(profileId), safeStore);
  return safeStore;
}

function backupEntryFromRemote(fileName, entry) {
  const remotePath = `${iniBackupRoot}/${fileName}/${entry.filename}`;
  return {
    path: remotePath,
    fileName: entry.filename,
    sourceFileName: fileName,
    sizeBytes: Number(entry.attrs?.size || 0),
    createdAt: entry.attrs?.mtime ? new Date(Number(entry.attrs.mtime) * 1000).toISOString() : undefined,
    location: 'remote',
  };
}

async function nextIniBackupNumber(sftp, fileName) {
  const normalizedFile = assertAllowedIniFileName(fileName);
  const backupDir = `${iniBackupRoot}/${normalizedFile}`;
  if (!(await sftpLstat(sftp, backupDir))) return 1;
  const numbers = (await sftpReadDir(sftp, backupDir))
    .map((entry) => parseIniBackupNumber(normalizedFile, entry.filename))
    .filter((number) => number !== undefined);
  return (numbers.length ? Math.max(...numbers) : 0) + 1;
}

async function listIniBackupsForSftp(sftp, fileName) {
  const normalizedFile = assertAllowedIniFileName(fileName);
  const backupDir = `${iniBackupRoot}/${normalizedFile}`;
  if (!(await sftpLstat(sftp, backupDir))) return [];
  const entries = (await sftpReadDir(sftp, backupDir))
    .map((entry) => ({ entry, number: parseIniBackupNumber(normalizedFile, entry.filename) }))
    .filter((item) => item.number !== undefined)
    .sort((a, b) => b.number - a.number)
    .map((item) => backupEntryFromRemote(normalizedFile, item.entry));
  return entries;
}

async function resolveIniFsProfile(profileId) {
  return resolveRomFsProfile(profileId);
}

async function withIniFsClient(profileId, callback) {
  const { profile, session } = await resolveIniFsProfile(profileId);
  const client = await createSshClient(session);
  try {
    const sftp = await sftpClient(client);
    return await callback({ profile, session, client, sftp });
  } finally {
    client.end();
  }
}

function iniRemoteFileFromEntry(entry, metadata, backupCount, profile) {
  const fileName = entry.filename;
  const kind = iniFileKind(fileName);
  return {
    listId: `remote:${fileName}`,
    fileName,
    path: iniRemotePath(fileName),
    displayName: metadata?.displayName,
    source: 'remote',
    sizeBytes: Number(entry.attrs?.size || 0),
    modifiedAt: entry.attrs?.mtime ? new Date(Number(entry.attrs.mtime) * 1000).toISOString() : undefined,
    kind,
    isDefault: kind === 'main',
    altNumber: iniAltNumber(kind),
    custom: kind === 'custom',
    backupCount,
    targetProfileId: profile?.id,
    targetAlias: profile?.alias,
    targetHost: profile?.ipAddress,
    metadata,
  };
}

function iniLocalFileFromMetadata(metadata, profile, remoteFileNames) {
  const fileName = normalizeIniFileName(metadata.fileName);
  const remoteExists = remoteFileNames.has(fileName);
  let kind = 'custom';
  try { kind = iniFileKind(assertAllowedIniFileName(fileName)); } catch { kind = 'custom'; }
  const source = metadata.source || (metadata.localContent ? 'local-import' : 'cache');
  return {
    listId: `${source}:${fileName}`,
    fileName,
    path: remoteExists ? iniRemotePath(fileName) : '',
    displayName: metadata.displayName,
    source,
    sizeBytes: Number(metadata.localSizeBytes || 0),
    modifiedAt: metadata.localImportedAt || metadata.updatedAt,
    kind,
    isDefault: kind === 'main',
    altNumber: iniAltNumber(kind),
    custom: kind === 'custom',
    backupCount: 0,
    targetProfileId: profile?.id,
    targetAlias: profile?.alias,
    targetHost: profile?.ipAddress,
    metadata,
  };
}

// A synthetic list entry for an INI whose original file is gone but still has backups, so the user can select it
// and restore from a backup (which recreates the original file).
function iniBackupOnlyFile(fileName, backupCount, profile) {
  let kind = 'custom';
  try { kind = iniFileKind(assertAllowedIniFileName(fileName)); } catch { kind = 'custom'; }
  return {
    listId: `backup-only:${fileName}`,
    fileName,
    path: '',
    source: 'missing-remote',
    sizeBytes: 0,
    kind,
    isDefault: kind === 'main',
    altNumber: iniAltNumber(kind),
    custom: kind === 'custom',
    backupCount,
    targetProfileId: profile?.id,
    targetAlias: profile?.alias,
    targetHost: profile?.ipAddress,
  };
}

async function iniFsCheckWriteCapability(request = {}) {
  const checkedAt = new Date().toISOString();
  if (!request?.profileId && !activeMisterProfile?.profileId) {
    return {
      ok: false,
      state: 'disconnected',
      canRead: false,
      canWrite: false,
      checkedAt,
      message: 'MiSTer 연결 필요',
      errorCode: 'INI_FS_NO_ACTIVE_PROFILE',
    };
  }
  try {
    return await withIniFsClient(request.profileId, async ({ profile, sftp }) => {
      const backupCheckPath = assertIniWriteCheckPath(`${iniBackupRoot}/${iniWriteCheckFileName}`);
      const checkFileName = `MiSTer_HelloMisterWriteCheck_${Date.now()}.ini`;
      const remoteCheckPath = assertIniRootWritePath(`/media/fat/${checkFileName}`);
      const trashCheckPath = assertIniTrashWritePath(`${iniTrashRoot}/${iniTimestamp()}-${checkFileName}`);
      try {
        await sftpReadDir(sftp, remotePaths.mediaFat);
      } catch (readError) {
        return {
          ok: false,
          profileId: profile.id,
          state: 'connectedReadOnly',
          canRead: false,
          canWrite: false,
          checkedAt,
          targetPath: remotePaths.mediaFat,
          message: 'MiSTer 연결은 되었지만 /media/fat을 읽지 못했습니다.',
          errorCode: readError?.code || 'INI_FS_READ_CHECK_FAILED',
          detail: { operation: 'write-capability-check', phase: 'readMediaFat', remotePath: remotePaths.mediaFat, sanitizedDetail: sanitizeIniFsMessage(readError) },
        };
      }
      let phase = 'writeCapabilityBackup';
      try {
        await sftpMkdirRecursiveIni(sftp, iniBackupRoot);
        await sftpWriteUtf8File(sftp, backupCheckPath, `hello-mister ini backup write capability check ${checkedAt}\n`);
        const backupAttrs = await sftpLstat(sftp, backupCheckPath);
        if (!backupAttrs?.isFile?.()) throw createIniFsError('INI_FS_WRITE_CHECK_VERIFY_FAILED', 'INI 백업 쓰기 권한 확인 파일을 검증하지 못했습니다.', { targetPath: backupCheckPath });
        await sftpUnlink(sftp, backupCheckPath);

        phase = 'writeCapabilityTrash';
        await sftpMkdirRecursiveIni(sftp, iniTrashRoot);
        await sftpWriteUtf8File(sftp, remoteCheckPath, `hello-mister ini trash move capability check ${checkedAt}\n`);
        const remoteAttrs = await sftpLstat(sftp, remoteCheckPath);
        if (!remoteAttrs?.isFile?.()) throw createIniFsError('INI_FS_WRITE_CHECK_VERIFY_FAILED', 'INI 쓰기 권한 확인 파일을 검증하지 못했습니다.', { targetPath: remoteCheckPath });
        await sftpRename(sftp, remoteCheckPath, trashCheckPath);
        const trashAttrs = await sftpLstat(sftp, trashCheckPath);
        if (!trashAttrs?.isFile?.()) throw createIniFsError('INI_FS_TRASH_CHECK_VERIFY_FAILED', 'INI 휴지통 이동 확인 파일을 검증하지 못했습니다.', { targetPath: trashCheckPath });
        await sftpUnlink(sftp, trashCheckPath);
        return {
          ok: true,
          profileId: profile.id,
          state: 'connectedWritable',
          canRead: true,
          canWrite: true,
          checkedAt,
          targetPath: remoteCheckPath,
          message: '연결됨 · INI 저장/백업/휴지통 이동 가능',
          detail: {
            operation: 'write-capability-check',
            phase: 'writeCapabilityTrash',
            backupCheckPath,
            remoteCheckPath,
            trashCheckPath,
          },
        };
      } catch (writeError) {
        await sftpUnlink(sftp, backupCheckPath).catch(() => undefined);
        await sftpUnlink(sftp, remoteCheckPath).catch(() => undefined);
        await sftpUnlink(sftp, trashCheckPath).catch(() => undefined);
        return {
          ok: false,
          profileId: profile.id,
          state: 'writeCheckFailed',
          canRead: true,
          canWrite: false,
          checkedAt,
          targetPath: remoteCheckPath,
          message: iniFsFailureMessage('INI 권한 확인', phase, writeError),
          errorCode: writeError?.code || 'INI_FS_WRITE_CHECK_FAILED',
          detail: { operation: 'write-capability-check', phase, remotePath: remoteCheckPath, sanitizedDetail: sanitizeIniFsMessage(writeError), ...(writeError?.detail ? { safeDetail: writeError.detail } : {}) },
        };
      }
    });
  } catch (error) {
    return {
      ok: false,
      state: 'writeCheckFailed',
      canRead: false,
      canWrite: false,
      checkedAt,
      message: iniFsFailureMessage('INI 권한 확인', 'connect', error),
      errorCode: error.code || 'INI_FS_WRITE_CAPABILITY_FAILED',
      detail: { operation: 'write-capability-check', phase: 'connect', sanitizedDetail: sanitizeIniFsMessage(error) },
    };
  }
}

async function iniFsListRemoteIni(request = {}) {
  try {
    return await withIniFsClient(request.profileId, async ({ profile, sftp }) => {
      const metadataStore = await loadIniMetadata(profile.id);
      const metadataByName = new Map(metadataStore.files.map((item) => [item.fileName.toLowerCase(), item]));
      const rawEntries = await sftpReadDir(sftp, remotePaths.mediaFat);
      const excludedReasons = {};
      const entries = [];
      for (const entry of rawEntries) {
        if (iniEntryIsDirectory(entry)) {
          incrementIniExcludedReason(excludedReasons, 'directory');
          continue;
        }
        if (!iniEntryIsFileLike(entry)) {
          incrementIniExcludedReason(excludedReasons, 'not-file');
          continue;
        }
        try {
          assertAllowedIniFileName(entry.filename);
          entries.push(entry);
        } catch {
          incrementIniExcludedReason(excludedReasons, 'not-mister-ini');
        }
      }
      const files = [];
      const remoteFileNames = new Set(entries.map((entry) => entry.filename));
      const remoteFileNameKeys = new Set(entries.map((entry) => entry.filename.toLowerCase()));
      for (const entry of entries) {
        files.push(iniRemoteFileFromEntry(entry, metadataByName.get(entry.filename.toLowerCase()), (await listIniBackupsForSftp(sftp, entry.filename)).length, profile));
      }
      for (const item of metadataStore.files) {
        const remoteHasSameFileName = remoteFileNameKeys.has(item.fileName.toLowerCase());
        if (remoteHasSameFileName && !item.localContent && !['local-import', 'upload-ready'].includes(item.source)) continue;
        if (!item.localContent && item.source === 'remote') continue;
        if (item.localContent || ['local-import', 'upload-ready', 'cache', 'missing-remote'].includes(item.source)) {
          files.push(iniLocalFileFromMetadata(item, profile, remoteFileNames));
        }
      }
      // Surface INIs that still have backups but whose original file is gone, so they can be reopened and restored.
      if (await sftpLstat(sftp, iniBackupRoot)) {
        const presentNames = new Set(files.map((file) => file.fileName.toLowerCase()));
        const backupDirEntries = (await sftpReadDir(sftp, iniBackupRoot)).filter((entry) => iniEntryIsDirectory(entry));
        for (const dir of backupDirEntries) {
          let iniName;
          try { iniName = assertAllowedIniFileName(dir.filename); } catch { continue; }
          if (presentNames.has(iniName.toLowerCase())) continue;
          const backupCount = (await listIniBackupsForSftp(sftp, iniName)).length;
          if (backupCount === 0) continue;
          files.push(iniBackupOnlyFile(iniName, backupCount, profile));
          presentNames.add(iniName.toLowerCase());
        }
      }
      files.sort((a, b) => {
        const rankDiff = iniSortRank(a) - iniSortRank(b);
        if (rankDiff !== 0) return rankDiff;
        if (a.kind !== b.kind) {
          if (a.kind === 'main') return -1;
          if (b.kind === 'main') return 1;
        }
        return a.fileName.localeCompare(b.fileName, undefined, { numeric: true });
      });
      const remoteIniCandidateCount = entries.length;
      const debug = {
        profileId: profile.id,
        profileAlias: profile.alias,
        host: profile.ipAddress,
        rawMediaFatItemCount: rawEntries.length,
        remoteIniCandidateCount,
        metadataCount: metadataStore.files.length,
        cacheCount: metadataStore.files.filter((item) => !remoteFileNameKeys.has(item.fileName.toLowerCase())).length,
        finalListCount: files.length,
        excludedItemCount: Object.values(excludedReasons).reduce((sum, count) => sum + count, 0),
        excludedReasons,
      };
      const index = {
        ok: true,
        profileId: profile.id,
        profileAlias: profile.alias,
        host: profile.ipAddress,
        files,
        debug,
        cachedAt: new Date().toISOString(),
        message: remoteIniCandidateCount > 0
          ? `원격 INI ${remoteIniCandidateCount}개를 읽었습니다.`
          : '원격 INI 0개: /media/fat에서 MiSTer*.ini 파일을 찾지 못했습니다.',
      };
      await writeJsonFile(appDataPath('mister-ini', profile.id, 'ini-index.json'), index);
      return index;
    });
  } catch (error) {
    return { ok: false, files: [], cachedAt: new Date().toISOString(), message: sanitizeIniFsMessage(error), errorCode: error.code || 'INI_FS_LIST_FAILED' };
  }
}

async function iniFsReadRemoteIni(request = {}) {
  const fileName = (() => {
    try { return assertAllowedIniFileName(request.fileName); } catch { return String(request.fileName || ''); }
  })();
  try {
    return await withIniFsClient(request.profileId, async ({ profile, sftp }) => {
      const targetPath = iniRemotePath(fileName);
      const attrs = await sftpLstat(sftp, targetPath);
      if (!attrs?.isFile?.()) throw createIniFsError('INI_FS_NOT_FOUND', '선택한 INI 파일을 찾지 못했습니다.');
      const content = await sftpReadFile(sftp, targetPath, 1024 * 1024);
      return { ok: true, profileId: profile.id, fileName, path: targetPath, content, sizeBytes: attrs.size || Buffer.byteLength(content), readAt: new Date().toISOString(), message: 'INI 파일을 읽었습니다.' };
    });
  } catch (error) {
    return { ok: false, fileName, path: fileName ? `/media/fat/${fileName}` : '', content: '', sizeBytes: 0, readAt: new Date().toISOString(), message: sanitizeIniFsMessage(error), errorCode: error.code || 'INI_FS_READ_FAILED' };
  }
}

async function backupIniFile(sftp, fileName, content) {
  const normalizedFile = assertAllowedIniFileName(fileName);
  const backupDir = `${iniBackupRoot}/${normalizedFile}`;
  await sftpMkdirRecursiveIni(sftp, backupDir);
  const number = await nextIniBackupNumber(sftp, normalizedFile);
  const backupPath = assertIniBackupWritePath(normalizedFile, `${backupDir}/${iniBackupFileName(normalizedFile, number)}`);
  await sftpWriteUtf8File(sftp, backupPath, content);
  return backupPath;
}

async function writeLocalIniBackup(profileId, fileName, content) {
  const localPath = appDataPath('backups', 'ini', String(profileId || 'unknown'), fileName, `${iniTimestamp()}.ini`);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, content, 'utf8');
  return localPath;
}

async function iniFsWriteRemoteIniWithBackup(request = {}) {
  const fileName = (() => {
    try { return assertAllowedIniFileName(request.fileName); } catch { return String(request.fileName || ''); }
  })();
  if (!request.confirmed) return { ok: false, fileName, message: '저장 전 확인이 필요합니다.', errorCode: 'INI_FS_CONFIRMATION_REQUIRED' };
  let phase = 'connect';
  try {
    return await withIniFsClient(request.profileId, async ({ profile, sftp }) => {
      phase = 'validateFileName';
      const targetPath = iniRemotePath(fileName);
      phase = 'readCurrent';
      const attrs = await sftpLstat(sftp, targetPath);
      const currentContent = attrs?.isFile?.() ? await sftpReadFile(sftp, targetPath, 1024 * 1024) : '';
      // No automatic remote backup on save (user manages backups manually). Keep a silent local PC-side copy only.
      phase = 'writeLocalBackup';
      await writeLocalIniBackup(profile.id, fileName, currentContent).catch(() => undefined);
      phase = 'writeRemote';
      await sftpWriteUtf8File(sftp, assertIniRootWritePath(targetPath), String(request.content || ''));
      phase = 'rereadRemote';
      const verification = await sftpReadFile(sftp, targetPath, 1024 * 1024);
      if (verification !== String(request.content || '')) throw createIniFsError('INI_FS_VERIFY_FAILED', '저장 후 INI 파일 검증에 실패했습니다.');
      phase = 'listBackups';
      const backups = await listIniBackupsForSftp(sftp, fileName);
      return { ok: true, profileId: profile.id, fileName, path: targetPath, backups, message: 'INI 파일을 저장하고 다시 읽어 검증했습니다. (자동 백업 없음 — 필요하면 수동으로 백업하세요)' };
    });
  } catch (error) {
    return iniFsFailureResult({
      action: 'INI 저장',
      phase,
      fileName,
      defaultCode: 'INI_FS_WRITE_FAILED',
      error,
    });
  }
}

async function iniFsCreateBackup(request = {}) {
  const fileName = (() => {
    try { return assertAllowedIniFileName(request.fileName); } catch { return String(request.fileName || ''); }
  })();
  try {
    return await withIniFsClient(request.profileId, async ({ profile, sftp }) => {
      const targetPath = iniRemotePath(fileName);
      const attrs = await sftpLstat(sftp, targetPath);
      if (!attrs?.isFile?.()) throw createIniFsError('INI_FS_NOT_FOUND', '백업할 INI 파일을 찾지 못했습니다.');
      const content = await sftpReadFile(sftp, targetPath, 1024 * 1024);
      const backupPath = await backupIniFile(sftp, fileName, content);
      await writeLocalIniBackup(profile.id, fileName, content).catch(() => undefined);
      const backups = await listIniBackupsForSftp(sftp, fileName);
      return { ok: true, profileId: profile.id, fileName, path: backupPath, backups, message: `백업을 만들었습니다: ${path.posix.basename(backupPath)}` };
    });
  } catch (error) {
    return { ok: false, fileName, backups: [], message: sanitizeIniFsMessage(error), errorCode: error.code || 'INI_FS_BACKUP_CREATE_FAILED' };
  }
}

async function iniFsListBackups(request = {}) {
  const fileName = (() => {
    try { return assertAllowedIniFileName(request.fileName); } catch { return String(request.fileName || ''); }
  })();
  try {
    return await withIniFsClient(request.profileId, async ({ profile, sftp }) => {
      const backups = await listIniBackupsForSftp(sftp, fileName);
      return { ok: true, profileId: profile.id, fileName, backups, message: `${backups.length}개 백업을 읽었습니다.` };
    });
  } catch (error) {
    return { ok: false, fileName, backups: [], message: sanitizeIniFsMessage(error), errorCode: error.code || 'INI_FS_BACKUP_LIST_FAILED' };
  }
}

async function iniFsPreviewBackup(request = {}) {
  const fileName = (() => {
    try { return assertAllowedIniFileName(request.fileName); } catch { return String(request.fileName || ''); }
  })();
  try {
    return await withIniFsClient(request.profileId, async ({ profile, sftp }) => {
      const backupPath = assertIniBackupPath(fileName, request.backupPath);
      const attrs = await sftpLstat(sftp, backupPath);
      if (!attrs?.isFile?.()) throw createIniFsError('INI_FS_BACKUP_NOT_FOUND', '선택한 INI 백업 파일을 찾지 못했습니다.');
      const content = await sftpReadFile(sftp, backupPath, 1024 * 1024);
      return {
        ok: true,
        profileId: profile.id,
        fileName,
        backupPath,
        content,
        sizeBytes: attrs.size || Buffer.byteLength(content),
        readAt: new Date().toISOString(),
        message: 'INI 백업 미리보기를 읽었습니다.',
      };
    });
  } catch (error) {
    return {
      ok: false,
      fileName,
      backupPath: String(request.backupPath || ''),
      content: '',
      sizeBytes: 0,
      readAt: new Date().toISOString(),
      message: sanitizeIniFsMessage(error),
      errorCode: error.code || 'INI_FS_BACKUP_PREVIEW_FAILED',
    };
  }
}

async function iniFsRestoreBackup(request = {}) {
  const fileName = (() => {
    try { return assertAllowedIniFileName(request.fileName); } catch { return String(request.fileName || ''); }
  })();
  if (!request.confirmed) return { ok: false, fileName, message: '백업 불러오기 전 확인이 필요합니다.', errorCode: 'INI_FS_CONFIRMATION_REQUIRED' };
  try {
    return await withIniFsClient(request.profileId, async ({ profile, sftp }) => {
      const backupPath = assertIniBackupPath(fileName, request.backupPath);
      const backupContent = await sftpReadFile(sftp, backupPath, 1024 * 1024);
      const targetPath = iniRemotePath(fileName);
      const currentAttrs = await sftpLstat(sftp, targetPath);
      // Only safety-backup the current file when it actually exists, so applying a backup onto a missing
      // original doesn't create a junk empty backup.
      let currentBackupPath;
      if (currentAttrs?.isFile?.()) {
        currentBackupPath = await backupIniFile(sftp, fileName, await sftpReadFile(sftp, targetPath, 1024 * 1024));
      }
      await sftpWriteUtf8File(sftp, assertIniRootWritePath(targetPath), backupContent);
      const backups = await listIniBackupsForSftp(sftp, fileName);
      return { ok: true, profileId: profile.id, fileName, path: targetPath, backupPath: currentBackupPath, backups, message: currentBackupPath ? '선택한 백업을 불러왔습니다. 기존 파일은 적용 전에 다시 백업했습니다.' : '선택한 백업을 원본 INI로 복원했습니다.' };
    });
  } catch (error) {
    return { ok: false, fileName, message: sanitizeIniFsMessage(error), errorCode: error.code || 'INI_FS_RESTORE_FAILED' };
  }
}

async function iniFsDeleteBackup(request = {}) {
  const fileName = (() => {
    try { return assertAllowedIniFileName(request.fileName); } catch { return String(request.fileName || ''); }
  })();
  if (!request.confirmed) return { ok: false, fileName, message: '백업 삭제 전 확인이 필요합니다.', errorCode: 'INI_FS_CONFIRMATION_REQUIRED' };
  try {
    return await withIniFsClient(request.profileId, async ({ profile, sftp }) => {
      const backupPath = assertIniBackupPath(fileName, request.backupPath);
      const attrs = await sftpLstat(sftp, backupPath);
      if (!attrs?.isFile?.()) throw createIniFsError('INI_FS_BACKUP_NOT_FOUND', '삭제할 INI 백업 파일을 찾지 못했습니다.');
      // Soft delete: move the .bak into the INI trash so it shows in the trash list and stays recoverable. A
      // timestamp prefix keeps the trash name unique and parseable ({stamp}-{iniName} - NN.bak); restoring
      // re-numbers it back into the backup folder.
      await sftpMkdirRecursiveIni(sftp, iniTrashRoot);
      const trashPath = assertIniTrashWritePath(`${iniTrashRoot}/${iniTimestamp()}-${path.posix.basename(backupPath)}`);
      await sftpRename(sftp, backupPath, trashPath);
      const backups = await listIniBackupsForSftp(sftp, fileName);
      return { ok: true, profileId: profile.id, fileName, path: trashPath, backups, message: 'INI 백업을 휴지통으로 이동했습니다.' };
    });
  } catch (error) {
    return { ok: false, fileName, message: sanitizeIniFsMessage(error), errorCode: error.code || 'INI_FS_BACKUP_DELETE_FAILED' };
  }
}

async function iniFsTrashIni(request = {}) {
  const fileName = (() => {
    try { return assertAllowedIniFileName(request.fileName); } catch { return String(request.fileName || ''); }
  })();
  if (!request.confirmed) return { ok: false, fileName, message: '삭제 전 확인이 필요합니다.', errorCode: 'INI_FS_CONFIRMATION_REQUIRED' };
  if (/^MiSTer\.ini$/i.test(fileName)) return { ok: false, fileName, message: '기본 INI는 삭제할 수 없습니다.', errorCode: 'INI_FS_MAIN_DELETE_BLOCKED' };
  let phase = 'connect';
  try {
    return await withIniFsClient(request.profileId, async ({ profile, sftp }) => {
      phase = 'validateFileName';
      const sourcePath = iniRemotePath(fileName);
      phase = 'locateSource';
      const attrs = await sftpLstat(sftp, sourcePath);
      if (!attrs?.isFile?.()) throw createIniFsError('INI_FS_NOT_FOUND', '휴지통으로 이동할 INI 파일을 찾지 못했습니다.');
      phase = 'createTrashDir';
      await sftpMkdirRecursiveIni(sftp, iniTrashRoot);
      const trashPath = assertIniTrashWritePath(`${iniTrashRoot}/${iniTimestamp()}-${fileName}`);
      phase = 'moveToTrash';
      await sftpRename(sftp, sourcePath, trashPath);
      return { ok: true, profileId: profile.id, fileName, path: trashPath, message: 'INI 파일을 휴지통으로 이동했습니다. 일반 목록에서 제거하고 휴지통 목록을 다시 읽으세요.' };
    });
  } catch (error) {
    return iniFsFailureResult({
      action: 'INI 휴지통 이동',
      phase,
      fileName,
      defaultCode: 'INI_FS_TRASH_FAILED',
      error,
    });
  }
}

function iniTrashEntryFromRemote(entry) {
  const fileName = entry.filename;
  let kind = 'ini';
  let originalFileName = fileName.replace(/^[0-9]{8}-[0-9]{6}-/, '');
  try {
    const parsed = parseIniTrashName(fileName);
    kind = parsed.kind;
    originalFileName = parsed.originalFileName;
  } catch { /* keep the best-effort fallback above */ }
  return {
    path: `${iniTrashRoot}/${fileName}`,
    fileName,
    originalFileName,
    kind,
    sizeBytes: Number(entry.attrs?.size || 0),
    movedAt: entry.attrs?.mtime ? new Date(Number(entry.attrs.mtime) * 1000).toISOString() : undefined,
  };
}

async function iniFsListTrash(request = {}) {
  try {
    return await withIniFsClient(request.profileId, async ({ profile, sftp }) => {
      const entries = (await sftpReadDir(sftp, iniTrashRoot))
        .filter((entry) => /^[0-9]{8}-[0-9]{6}-MiSTer.*\.(ini|bak)$/i.test(entry.filename))
        .map(iniTrashEntryFromRemote)
        .sort((a, b) => b.fileName.localeCompare(a.fileName));
      return { ok: true, profileId: profile.id, entries, message: `${entries.length}개 휴지통 항목을 읽었습니다.` };
    });
  } catch (error) {
    return { ok: false, entries: [], message: sanitizeIniFsMessage(error), errorCode: error.code || 'INI_FS_TRASH_LIST_FAILED' };
  }
}

async function iniFsRestoreTrashedIni(request = {}) {
  const targetFileName = (() => {
    try { return assertAllowedIniFileName(request.targetFileName); } catch { return String(request.targetFileName || ''); }
  })();
  if (!request.confirmed) return { ok: false, fileName: targetFileName, message: '휴지통 복구 전 확인이 필요합니다.', errorCode: 'INI_FS_CONFIRMATION_REQUIRED' };
  try {
    return await withIniFsClient(request.profileId, async ({ profile, sftp }) => {
      const trashPath = assertIniTrashPath(request.trashPath);
      const trashAttrs = await sftpLstat(sftp, trashPath);
      if (!trashAttrs?.isFile?.()) throw createIniFsError('INI_FS_TRASH_NOT_FOUND', '복구할 휴지통 항목을 찾지 못했습니다.');
      const parsed = parseIniTrashName(path.posix.basename(trashPath));
      if (parsed.kind === 'backup') {
        const originalPath = iniRemotePath(parsed.originalFileName);
        const originalExists = await sftpLstat(sftp, originalPath);
        if (!originalExists?.isFile?.()) {
          // No original INI to attach this backup to → bring it back AS the original file by dropping the
          // " - NN.bak" suffix, so the INI reappears in the list instead of vanishing into a hidden backup folder.
          await sftpRename(sftp, trashPath, assertIniRootWritePath(originalPath));
          return { ok: true, profileId: profile.id, fileName: parsed.originalFileName, path: originalPath, message: `원본 INI가 없어 백업을 ${parsed.originalFileName} 원본으로 복원했습니다.` };
        }
        // Original exists → undelete as a numbered backup in its backup folder.
        const backupDir = `${iniBackupRoot}/${parsed.originalFileName}`;
        await sftpMkdirRecursiveIni(sftp, backupDir);
        const number = await nextIniBackupNumber(sftp, parsed.originalFileName);
        const restorePath = assertIniBackupWritePath(parsed.originalFileName, `${backupDir}/${iniBackupFileName(parsed.originalFileName, number)}`);
        await sftpRename(sftp, trashPath, restorePath);
        return { ok: true, profileId: profile.id, fileName: parsed.originalFileName, path: restorePath, message: `백업을 복원했습니다: ${path.posix.basename(restorePath)}` };
      }
      const targetPath = iniRemotePath(targetFileName);
      const existing = await sftpLstat(sftp, targetPath);
      let backupPath;
      if (existing?.isFile?.()) {
        backupPath = await backupIniFile(sftp, targetFileName, await sftpReadFile(sftp, targetPath, 1024 * 1024));
      }
      await sftpRename(sftp, trashPath, assertIniRootWritePath(targetPath));
      return { ok: true, profileId: profile.id, fileName: targetFileName, path: targetPath, backupPath, message: backupPath ? '휴지통 INI를 복구했습니다. 기존 파일은 먼저 백업했습니다.' : '휴지통 INI를 복구했습니다.' };
    });
  } catch (error) {
    return { ok: false, fileName: targetFileName, message: sanitizeIniFsMessage(error), errorCode: error.code || 'INI_FS_TRASH_RESTORE_FAILED' };
  }
}

async function iniFsDeleteTrashedIni(request = {}) {
  if (!request.confirmed) return { ok: false, message: '휴지통 영구 삭제 전 확인이 필요합니다.', errorCode: 'INI_FS_CONFIRMATION_REQUIRED' };
  try {
    return await withIniFsClient(request.profileId, async ({ profile, sftp }) => {
      const trashPath = assertIniTrashPath(request.trashPath);
      const attrs = await sftpLstat(sftp, trashPath);
      if (!attrs?.isFile?.()) throw createIniFsError('INI_FS_TRASH_NOT_FOUND', '영구 삭제할 휴지통 INI 파일을 찾지 못했습니다.');
      await sftpUnlink(sftp, trashPath);
      return { ok: true, profileId: profile.id, path: trashPath, message: '휴지통 INI 파일을 영구 삭제했습니다.' };
    });
  } catch (error) {
    return { ok: false, message: sanitizeIniFsMessage(error), errorCode: error.code || 'INI_FS_TRASH_DELETE_FAILED' };
  }
}

async function iniFsEmptyTrash(request = {}) {
  if (!request.confirmed) return { ok: false, message: '휴지통 비우기 전 확인이 필요합니다.', errorCode: 'INI_FS_CONFIRMATION_REQUIRED' };
  try {
    return await withIniFsClient(request.profileId, async ({ profile, sftp }) => {
      if (!(await sftpLstat(sftp, iniTrashRoot))) {
        return { ok: true, profileId: profile.id, deletedCount: 0, message: '휴지통이 이미 비어 있습니다.' };
      }
      const entries = (await sftpReadDir(sftp, iniTrashRoot))
        .filter((entry) => /^[0-9]{8}-[0-9]{6}-MiSTer.*\.(ini|bak)$/i.test(entry.filename));
      let deletedCount = 0;
      for (const entry of entries) {
        const trashPath = assertIniTrashPath(`${iniTrashRoot}/${entry.filename}`);
        await sftpUnlink(sftp, trashPath);
        deletedCount += 1;
      }
      return { ok: true, profileId: profile.id, deletedCount, message: `휴지통에서 ${deletedCount}개 항목을 영구 삭제했습니다.` };
    });
  } catch (error) {
    return { ok: false, message: sanitizeIniFsMessage(error), errorCode: error.code || 'INI_FS_TRASH_EMPTY_FAILED' };
  }
}

async function iniFsExportIniLocal(request = {}) {
  const fileName = (() => {
    try { return assertAllowedIniFileName(request.fileName); } catch { return String(request.fileName || ''); }
  })();
  const read = await iniFsReadRemoteIni({ profileId: request.profileId, fileName });
  if (!read.ok) return { ok: false, fileName, message: read.message, errorCode: read.errorCode };
  const result = await dialog.showSaveDialog({
    title: 'INI 파일을 PC에 저장',
    defaultPath: fileName,
    filters: [{ name: 'MiSTer INI', extensions: ['ini'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, fileName, message: 'INI 내보내기가 취소되었습니다.', errorCode: 'INI_FS_EXPORT_CANCELLED' };
  await fs.writeFile(result.filePath, read.content, 'utf8');
  return { ok: true, fileName, path: result.filePath, message: `INI 파일을 PC에 저장했습니다: ${result.filePath}` };
}

async function iniFsImportIniLocal(request = {}) {
  const result = await dialog.showOpenDialog({
    title: 'PC INI 파일 가져오기',
    properties: ['openFile'],
    filters: [{ name: 'MiSTer INI', extensions: ['ini'] }],
  });
  const requestedTarget = request.targetFileName ? suggestedRemoteIniFileName(request.targetFileName) : undefined;
  if (result.canceled || result.filePaths.length === 0) return { ok: false, fileName: requestedTarget, message: 'INI 가져오기가 취소되었습니다.', errorCode: 'INI_FS_IMPORT_CANCELLED' };
  const originalFileName = path.basename(result.filePaths[0]);
  if (!isSafeLocalIniDisplayFileName(originalFileName)) return { ok: false, fileName: requestedTarget, message: '가져올 수 없는 INI 파일명입니다.', errorCode: 'INI_FS_INVALID_LOCAL_FILENAME' };
  const content = await fs.readFile(result.filePaths[0], 'utf8');
  return {
    ok: true,
    fileName: originalFileName,
    originalFileName,
    suggestedRemoteFileName: requestedTarget || suggestedRemoteIniFileName(originalFileName),
    path: result.filePaths[0],
    content,
    sizeBytes: Buffer.byteLength(content, 'utf8'),
    message: 'PC INI 파일을 읽었습니다. 아직 MiSTer에는 저장하지 않았습니다.',
  };
}

const stickerImageExtensions = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
const stickerStoreFiles = {
  images: ['stickers', stickerImageLibraryFileName],
  templates: ['stickers', stickerTemplatesFileName],
  cards: ['stickers', stickerCardsFileName],
  sheets: ['stickers', stickerSheetsFileName],
};

function maskLocalPathForSticker(filePath) {
  return path.basename(filePath);
}

function normalizeStickerName(fileName) {
  return path.basename(fileName, path.extname(fileName))
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stickerAssetType(filePath) {
  const lower = String(filePath).toLowerCase();
  if (/(cover|box|boxart|front)/.test(lower)) return 'cover';
  if (/(title|title-screen)/.test(lower)) return 'title';
  if (/(logo|wheel|clearlogo|clear logo)/.test(lower)) return 'logo';
  if (/marquee/.test(lower)) return 'marquee';
  if (/(snap|screenshot|screen)/.test(lower)) return 'screenshot';
  if (/(background|wallpaper|\bbg\b)/.test(lower)) return 'background';
  if (/(template|overlay|frame)/.test(lower)) return 'templateAsset';
  return 'unknown';
}

function stickerPlatformGuess(filePath) {
  const lower = String(filePath).toLowerCase();
  if (/(nes|famicom)/.test(lower)) return 'NES';
  if (/(snes|super famicom|sfc)/.test(lower)) return 'SNES';
  if (/(mega drive|megadrive|genesis)/.test(lower)) return 'Genesis';
  if (/(gba|game boy advance)/.test(lower)) return 'GBA';
  if (/(gbc|game boy color)/.test(lower)) return 'GBC';
  if (/(pce|pc engine|turbografx|tgfx)/.test(lower)) return 'PC Engine';
  if (/(arcade|mame|fbneo)/.test(lower)) return 'Arcade';
  return undefined;
}

function stickerImageId(filePath) {
  return `image-${crypto.createHash('sha1').update(filePath).digest('hex').slice(0, 16)}`;
}

async function localStickerImageMetadata(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) return undefined;
  const extension = path.extname(filePath).toLowerCase();
  const extensionName = extension.replace(/^\./, '');
  if (!stickerImageExtensions.includes(extensionName)) return undefined;
  const fileName = path.basename(filePath);
  const normalizedName = normalizeStickerName(fileName);
  const timestamp = new Date().toISOString();
  return {
    imageId: stickerImageId(filePath),
    sourceId: `source-${crypto.createHash('sha1').update(path.dirname(filePath)).digest('hex').slice(0, 12)}`,
    fileName,
    basename: path.basename(filePath, extension),
    extension,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime ? stat.mtime.toISOString() : undefined,
    localPath: filePath,
    maskedPath: maskLocalPathForSticker(filePath),
    assetType: stickerAssetType(filePath),
    normalizedName,
    possibleGameTitle: normalizedName || undefined,
    possiblePlatform: stickerPlatformGuess(filePath),
    importedAt: timestamp,
    updatedAt: timestamp,
  };
}

async function scanStickerImageFolder(rootPath, options = {}) {
  const maxFiles = Math.max(1, Math.min(Number(options.maxFiles) || 3000, 3000));
  const recursive = Boolean(options.recursive);
  const warnings = [];
  const items = [];
  const queue = [rootPath];
  while (queue.length && items.length < maxFiles) {
    const folder = queue.shift();
    const entries = await fs.readdir(folder, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        if (recursive) queue.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const metadata = await localStickerImageMetadata(fullPath);
      if (metadata) items.push(metadata);
      if (items.length >= maxFiles) {
        warnings.push(`이미지 ${maxFiles}개까지만 읽었습니다. 더 큰 라이브러리는 후속 최적화가 필요합니다.`);
        break;
      }
    }
    if (!recursive) break;
  }
  if (items.length >= 300) warnings.push('300개 이상 이미지가 감지되었습니다. 썸네일 표시가 느릴 수 있습니다.');
  if (items.length >= 1000) warnings.push('1000개 이상 이미지가 감지되었습니다. 강한 대량 이미지 경고입니다.');
  return {
    ok: true,
    sourceType: 'folder',
    rootPath,
    items,
    warnings,
    message: `${items.length}개 이미지 후보를 읽었습니다. 원본 파일은 수정하지 않았습니다.`,
  };
}

function emptyStickerStore(kind) {
  const now = new Date().toISOString();
  if (kind === 'images') return { schemaVersion: 1, images: [], updatedAt: now };
  if (kind === 'templates') return { schemaVersion: 1, templates: [], updatedAt: now };
  if (kind === 'cards') return { schemaVersion: 1, cards: [], updatedAt: now };
  if (kind === 'sheets') return { schemaVersion: 1, sheets: [], updatedAt: now };
  return { schemaVersion: 1, updatedAt: now };
}

async function loadStickerStore(kind) {
  const segments = stickerStoreFiles[kind];
  if (!segments) return emptyStickerStore(kind);
  return readJsonFile(appDataPath(...segments), emptyStickerStore(kind));
}

async function saveStickerStore(kind, store) {
  const segments = stickerStoreFiles[kind];
  if (!segments) return emptyStickerStore(kind);
  const safeStore = JSON.parse(JSON.stringify({ ...store, schemaVersion: 1, updatedAt: new Date().toISOString() }, (key, value) => {
    if (secretKeyPattern.test(key)) return '[removed]';
    return value;
  }));
  await writeJsonFile(appDataPath(...segments), safeStore);
  return safeStore;
}

app.whenReady().then(() => {
  registerControllerIpc();
  registerIpc();
  return createWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
