import type { MisterDeviceProfile, MisterProfileStore } from '../../types/mister';
import { createDefaultSavedProfiles } from './discovery';

const storageKey = 'hello-mister-v2:mister-device-profiles';
const allowedPasswordModes = ['defaultMisterPassword', 'promptEachRun', 'customSessionOnly', 'savedSafeStorage'] as const;

function sanitizeProfile(profile: MisterDeviceProfile): MisterDeviceProfile {
  return {
    id: profile.id,
    alias: profile.alias?.trim() || undefined,
    // 호스트네임이 없거나 스톡 기본값('MiSTer')이면 기존 별칭을 승격해 이름을 잃지 않게 한다.
    // 멱등(이미 승격된 값은 그대로)·비파괴(alias 보존). 표시 이름을 호스트네임으로 통일하기 위한 1회성 이관.
    hostname: (() => {
      const host = profile.hostname?.trim();
      return host && host !== 'MiSTer' ? host : (profile.alias?.trim() || host || undefined);
    })(),
    ipAddress: profile.ipAddress,
    macAddress: profile.macAddress?.trim() || undefined,
    sdCid: profile.sdCid?.trim() || undefined,
    methods: profile.methods,
    status: profile.status || '저장됨',
    lastSeenAt: profile.lastSeenAt || new Date().toISOString(),
    fingerprint: profile.fingerprint,
    defaultDevice: Boolean(profile.defaultDevice || profile.isDefault),
    port: Number(profile.port || 22),
    username: profile.username?.trim() || 'root',
    passwordMode: allowedPasswordModes.includes(profile.passwordMode as typeof allowedPasswordModes[number]) ? profile.passwordMode : 'defaultMisterPassword',
    passwordSaved: Boolean(profile.passwordSaved),
    passwordStorageStatus: profile.passwordStorageStatus,
    autoConnect: false,
    isDefault: Boolean(profile.defaultDevice || profile.isDefault),
    lastConnectedAt: profile.lastConnectedAt,
    lastFailedAt: profile.lastFailedAt,
    lastErrorCode: profile.lastErrorCode,
    hostKeyStatus: profile.hostKeyStatus,
    readOnlySummary: profile.readOnlySummary,
  };
}

function readLocalProfiles(): MisterDeviceProfile[] {
  try {
    const text = localStorage.getItem(storageKey);
    if (!text) return createDefaultSavedProfiles();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.map(sanitizeProfile) : createDefaultSavedProfiles();
  } catch {
    return createDefaultSavedProfiles();
  }
}

function writeLocalProfiles(profiles: MisterDeviceProfile[]) {
  localStorage.setItem(storageKey, JSON.stringify(profiles.map(sanitizeProfile), null, 2));
}

export class SafeMisterProfileStore implements MisterProfileStore {
  async loadProfiles(): Promise<MisterDeviceProfile[]> {
    if (window.helloMisterDesktop?.loadMisterProfiles) {
      const profiles = await window.helloMisterDesktop.loadMisterProfiles();
      return profiles.length ? profiles.map(sanitizeProfile) : createDefaultSavedProfiles();
    }
    return readLocalProfiles();
  }

  async saveProfile(profile: MisterDeviceProfile): Promise<MisterDeviceProfile[]> {
    const sanitized = sanitizeProfile(profile);
    if (window.helloMisterDesktop?.saveMisterProfile) {
      return window.helloMisterDesktop.saveMisterProfile(sanitized);
    }
    const existing = readLocalProfiles();
    const next = [...existing.filter((item) => item.id !== sanitized.id), sanitized];
    writeLocalProfiles(next);
    return next;
  }

  async saveProfilePassword(profileId: string, password: string) {
    if (window.helloMisterDesktop?.saveMisterProfilePassword) return window.helloMisterDesktop.saveMisterProfilePassword(profileId, password);
    return { ok: false, saved: false, storageAvailable: false, message: '브라우저 모드에서는 비밀번호를 저장하지 않습니다.' };
  }

  async getProfilePasswordStatus(profileId: string) {
    if (window.helloMisterDesktop?.getMisterProfilePasswordStatus) return window.helloMisterDesktop.getMisterProfilePasswordStatus(profileId);
    return { ok: true, saved: false, storageAvailable: false, message: '브라우저 모드에서는 저장된 비밀번호가 없습니다.' };
  }

  async deleteProfilePassword(profileId: string) {
    if (window.helloMisterDesktop?.deleteMisterProfilePassword) return window.helloMisterDesktop.deleteMisterProfilePassword(profileId);
    return { ok: true, message: '브라우저 모드에는 삭제할 저장 비밀번호가 없습니다.' };
  }

  async setDefaultProfile(profileId: string): Promise<MisterDeviceProfile[]> {
    if (window.helloMisterDesktop?.setDefaultMisterProfile) {
      return window.helloMisterDesktop.setDefaultMisterProfile(profileId);
    }
    const next = readLocalProfiles().map((profile) => ({ ...profile, defaultDevice: profile.id === profileId, isDefault: profile.id === profileId }));
    writeLocalProfiles(next);
    return next;
  }

  async deleteProfile(profileId: string, options: { removeKnownHost?: boolean } = {}): Promise<MisterDeviceProfile[]> {
    if (window.helloMisterDesktop?.deleteMisterProfile) {
      return window.helloMisterDesktop.deleteMisterProfile(profileId, options);
    }
    const next = readLocalProfiles()
      .filter((profile) => profile.id !== profileId)
      .map((profile) => ({ ...profile, defaultDevice: false, isDefault: false }));
    writeLocalProfiles(next);
    return next;
  }
}

export function createProfileFromCandidate(candidate: {
  id: string;
  ipAddress: string;
  hostname?: string;
  methods: MisterDeviceProfile['methods'];
  fingerprint?: MisterDeviceProfile['fingerprint'];
}, alias: string): MisterDeviceProfile {
  return sanitizeProfile({
    id: `profile-${candidate.ipAddress.replace(/\./g, '-')}`,
    alias,
    hostname: candidate.hostname || candidate.fingerprint?.hostname,
    ipAddress: candidate.ipAddress,
    macAddress: candidate.fingerprint?.macAddress,
    sdCid: candidate.fingerprint?.sdCid,
    methods: candidate.methods,
    status: '저장됨',
    lastSeenAt: new Date().toISOString(),
    fingerprint: candidate.fingerprint,
    autoConnect: false,
  });
}
