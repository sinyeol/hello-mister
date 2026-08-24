import type {
  MisterDeviceProfile,
  MisterProfileSummary,
  MisterRemoteFingerprint,
  ReadOnlyIntegrationTestResult,
  RemoteErrorCode,
  SshHostKeyTrustStatus,
} from '../../types/mister';
import { formatFingerprintSummary } from './remote';

const browserSummaryKey = 'hello-mister-v2-profile-summary';

function pathExists(fingerprint: MisterRemoteFingerprint | undefined, path: string) {
  return fingerprint?.pathStatuses.find((item) => item.path === path)?.exists;
}

function storageSummary(fingerprint: MisterRemoteFingerprint | undefined) {
  if (!fingerprint?.storage) return undefined;
  const { usedKb, sizeKb, usePercent } = fingerprint.storage;
  if (typeof usedKb === 'number' && typeof sizeKb === 'number') return `${usedKb}KB / ${sizeKb}KB (${usePercent ?? '?'}%)`;
  return fingerprint.storage.raw || undefined;
}

function sanitizeSummary(summary: MisterProfileSummary): MisterProfileSummary {
  return JSON.parse(JSON.stringify(summary, (key, value) => (
    /password|privateKey|passphrase|token|secret|credential|rawCommand/i.test(key) ? '[removed]' : value
  )));
}

export function createProfileSummaryFromFingerprint(input: {
  profile: MisterDeviceProfile;
  fingerprint?: MisterRemoteFingerprint;
  hostKeyTrustStatus?: SshHostKeyTrustStatus;
  errorCode?: RemoteErrorCode;
  errorMessage?: string;
  gameFolderCount?: number;
  scriptCount?: number;
}): MisterProfileSummary {
  const now = new Date().toISOString();
  const ok = Boolean(input.fingerprint?.ok) && !input.errorCode;
  return sanitizeSummary({
    profileId: input.profile.id,
    alias: input.profile.alias,
    host: input.profile.ipAddress,
    port: 22,
    hostname: input.fingerprint?.hostname || input.profile.hostname,
    mac: input.fingerprint?.macAddress || input.profile.macAddress,
    lastSeen: input.fingerprint?.checkedAt || input.profile.lastSeenAt,
    lastSuccessfulReadAt: ok ? input.fingerprint?.checkedAt || now : undefined,
    lastFailedReadAt: ok ? undefined : now,
    lastErrorCode: input.errorCode || input.fingerprint?.error?.code,
    lastErrorMessageSanitized: input.errorMessage || input.fingerprint?.error?.message,
    hostKeyTrustStatus: input.hostKeyTrustStatus,
    fingerprintSummary: input.fingerprint ? formatFingerprintSummary(input.fingerprint) : undefined,
    mediaFatStatus: pathExists(input.fingerprint, '/media/fat'),
    gamesFolderStatus: pathExists(input.fingerprint, '/media/fat/games'),
    scriptsFolderStatus: pathExists(input.fingerprint, '/media/fat/Scripts'),
    misterIniStatus: pathExists(input.fingerprint, '/media/fat/MiSTer.ini'),
    downloaderIniStatus: pathExists(input.fingerprint, '/media/fat/downloader.ini'),
    storageSummary: storageSummary(input.fingerprint),
    gameFolderCount: input.gameFolderCount,
    scriptCount: input.scriptCount,
    readOnlyTestStatus: ok ? 'success' : input.errorCode === 'HOST_KEY_MISMATCH' || input.errorCode === 'HOST_KEY_UNTRUSTED' ? 'blocked' : 'failed',
    updatedAt: now,
  });
}

export function createProfileSummaryFromIntegration(profile: MisterDeviceProfile, result: ReadOnlyIntegrationTestResult, hostKeyTrustStatus?: SshHostKeyTrustStatus): MisterProfileSummary {
  const failed = result.steps.find((step) => step.errorCode);
  return sanitizeSummary({
    ...createProfileSummaryFromFingerprint({
      profile,
      fingerprint: result.fingerprint,
      hostKeyTrustStatus,
      errorCode: failed?.errorCode,
      errorMessage: failed?.sanitizedMessage || failed?.message,
      gameFolderCount: result.games?.length,
      scriptCount: result.scripts?.length,
    }),
    lastSuccessfulReadAt: result.ok || result.partial ? result.finishedAt : undefined,
    lastFailedReadAt: result.ok ? undefined : result.finishedAt,
    readOnlyTestStatus: result.summary.status,
    readOnlyTestDurationMs: result.durationMs,
    updatedAt: result.finishedAt,
  });
}

export class MisterProfileSummaryStore {
  async loadSummaries(): Promise<MisterProfileSummary[]> {
    if (typeof window === 'undefined') return [];
    if (window.helloMisterDesktop?.loadMisterProfileSummaries) return window.helloMisterDesktop.loadMisterProfileSummaries();
    try {
      const parsed = JSON.parse(window.localStorage.getItem(browserSummaryKey) || '[]');
      return Array.isArray(parsed) ? parsed.map(sanitizeSummary) : [];
    } catch {
      return [];
    }
  }

  async saveSummary(summary: MisterProfileSummary): Promise<MisterProfileSummary[]> {
    const safe = sanitizeSummary(summary);
    if (typeof window === 'undefined') return [safe];
    if (window.helloMisterDesktop?.saveMisterProfileSummary) return window.helloMisterDesktop.saveMisterProfileSummary(safe);
    const current = await this.loadSummaries();
    const next = [safe, ...current.filter((item) => item.profileId !== safe.profileId)];
    window.localStorage.setItem(browserSummaryKey, JSON.stringify(next));
    return next;
  }

  async clearSummary(profileId: string): Promise<MisterProfileSummary[]> {
    if (typeof window === 'undefined') return [];
    if (window.helloMisterDesktop?.clearMisterProfileSummary) return window.helloMisterDesktop.clearMisterProfileSummary(profileId);
    const next = (await this.loadSummaries()).filter((item) => item.profileId !== profileId);
    window.localStorage.setItem(browserSummaryKey, JSON.stringify(next));
    return next;
  }
}
