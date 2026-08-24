import { useEffect, useState } from 'react';
import type { ActiveMisterProfile, MisterDeviceProfile, MisterRemoteFingerprint } from '../../types/mister';

const activeProfileKey = 'hello-mister-v2:active-mister-profile';
const activeProfileEvent = 'hello-mister-active-profile-change';

function parseActiveProfile(value: string | null): ActiveMisterProfile | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<ActiveMisterProfile>;
    if (!parsed.profileId || !parsed.ipAddress) return undefined;
    return {
      profileId: String(parsed.profileId),
      alias: parsed.alias ? String(parsed.alias) : undefined,
      hostname: parsed.hostname ? String(parsed.hostname) : undefined,
      ipAddress: String(parsed.ipAddress),
      port: Number(parsed.port || 22),
      username: parsed.username ? String(parsed.username) : 'root',
      connectedAt: parsed.connectedAt ? String(parsed.connectedAt) : new Date().toISOString(),
      sessionId: parsed.sessionId ? String(parsed.sessionId) : undefined,
      hostKeyStatus: parsed.hostKeyStatus,
      readOnlySummary: parsed.readOnlySummary ? String(parsed.readOnlySummary) : undefined,
      mediaFatOk: Boolean(parsed.mediaFatOk),
      gamesOk: Boolean(parsed.gamesOk),
      misterIniOk: Boolean(parsed.misterIniOk),
      lastErrorCode: parsed.lastErrorCode,
      macAddress: parsed.macAddress ? String(parsed.macAddress) : undefined,
      sdCid: parsed.sdCid ? String(parsed.sdCid) : undefined,
      identityWarning: parsed.identityWarning ? String(parsed.identityWarning) : undefined,
    };
  } catch {
    return undefined;
  }
}

function emitActiveProfileChange() {
  window.dispatchEvent(new CustomEvent(activeProfileEvent));
}

function writeLocalActiveProfile(profile: ActiveMisterProfile) {
  window.localStorage.setItem(activeProfileKey, JSON.stringify(profile, null, 2));
}

function clearLocalActiveProfile() {
  window.localStorage.removeItem(activeProfileKey);
}

export function getActiveMisterProfile(): ActiveMisterProfile | undefined {
  return parseActiveProfile(window.localStorage.getItem(activeProfileKey));
}

export function setActiveMisterProfile(profile: ActiveMisterProfile) {
  writeLocalActiveProfile(profile);
  emitActiveProfileChange();
  void window.helloMisterDesktop?.setActiveMisterProfile?.(profile).catch(() => undefined);
}

export function clearActiveMisterProfile(profileId?: string) {
  const current = getActiveMisterProfile();
  if (profileId && current?.profileId !== profileId) return;
  clearLocalActiveProfile();
  emitActiveProfileChange();
  void window.helloMisterDesktop?.clearActiveMisterProfile?.(profileId).catch(() => undefined);
}

export async function syncActiveMisterProfileFromDesktop() {
  if (!window.helloMisterDesktop?.getActiveMisterProfile) return getActiveMisterProfile();
  const desktopProfile = await window.helloMisterDesktop.getActiveMisterProfile().catch(() => undefined);
  if (desktopProfile) writeLocalActiveProfile(desktopProfile);
  emitActiveProfileChange();
  return getActiveMisterProfile();
}

export function createActiveMisterProfile(
  profile: MisterDeviceProfile,
  fingerprint: MisterRemoteFingerprint,
  readOnlySummary: string,
  identityWarning?: string,
): ActiveMisterProfile {
  return {
    profileId: profile.id,
    alias: profile.alias,
    hostname: (profile.hostname && profile.hostname !== 'MiSTer') ? profile.hostname : (fingerprint.hostname || profile.hostname),
    ipAddress: profile.ipAddress,
    port: Number(profile.port || 22),
    username: profile.username || 'root',
    connectedAt: new Date().toISOString(),
    sessionId: fingerprint.sessionId,
    hostKeyStatus: profile.hostKeyStatus,
    readOnlySummary,
    mediaFatOk: fingerprint.pathStatuses.some((item) => item.path === '/media/fat' && item.exists),
    gamesOk: fingerprint.pathStatuses.some((item) => item.path === '/media/fat/games' && item.exists),
    misterIniOk: fingerprint.pathStatuses.some((item) => item.path === '/media/fat/MiSTer.ini' && item.exists),
    lastErrorCode: fingerprint.error?.code,
    macAddress: fingerprint.macAddress || profile.macAddress,
    sdCid: fingerprint.sdCid || profile.sdCid,
    identityWarning,
  };
}

export function useActiveMisterProfile() {
  const [activeProfile, setActiveProfile] = useState<ActiveMisterProfile | undefined>(() => getActiveMisterProfile());

  useEffect(() => {
    const update = () => setActiveProfile(getActiveMisterProfile());
    void syncActiveMisterProfileFromDesktop().then(update).catch(() => undefined);
    window.addEventListener(activeProfileEvent, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(activeProfileEvent, update);
      window.removeEventListener('storage', update);
    };
  }, []);

  return [activeProfile, setActiveMisterProfile, clearActiveMisterProfile] as const;
}

export function formatActiveMisterLabel(activeProfile?: ActiveMisterProfile) {
  if (!activeProfile) return '연결된 MiSTer 없음';
  const name = (activeProfile.hostname && activeProfile.hostname !== 'MiSTer') ? activeProfile.hostname : (activeProfile.alias || 'MiSTer');
  return `${name} @ ${activeProfile.ipAddress}:${activeProfile.port}`;
}
