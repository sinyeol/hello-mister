import type { MisterDiscoveryCandidate, MisterDeviceProfile, MisterFingerprint, PortProbeResult } from '../../types/mister';

export function macSuffix(macAddress?: string) {
  if (!macAddress) return undefined;
  const compact = macAddress.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  return compact.length >= 4 ? compact.slice(-4) : compact || undefined;
}

// A usable hardware MAC distinguishes two physically-distinct MiSTers even when they share the
// "MiSTer" hostname or (cloned SD) the same SSH host key, and stays stable across DHCP IP changes.
// Reject empty / all-zero / broadcast placeholders so identity falls back to host/IP instead.
// 020304050607 is the stock MiSTer Ethernet MAC: every MiSTer (and every cloned SD card) ships with it
// unless the user overrides it, so it cannot tell two devices apart — treat it as a placeholder.
const placeholderMacs = new Set(['000000000000', 'ffffffffffff', '020304050607']);

export function isUsableMacAddress(mac?: string): boolean {
  if (!mac) return false;
  const hex = mac.trim().toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12) return false;
  return !placeholderMacs.has(hex);
}

// True only when both MACs are usable AND identical. Returns false if either is missing/placeholder,
// so a flaky/absent MAC reading never produces a false "different device" alarm.
export function sameMacAddress(a?: string, b?: string): boolean {
  if (!isUsableMacAddress(a) || !isUsableMacAddress(b)) return false;
  return a!.replace(/[^0-9a-f]/gi, '').toLowerCase() === b!.replace(/[^0-9a-f]/gi, '').toLowerCase();
}

// The SD card CID is unique per physical microSD card (even cloned ones), so it identifies a MiSTer
// across DHCP IP changes and when every device shares the stock MAC. A real CID is 32 hex chars.
export function isUsableSdCid(cid?: string): boolean {
  if (!cid) return false;
  const hex = cid.trim().toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length < 16) return false;
  return !/^(0+|f+)$/.test(hex);
}

export function serialSuffix(cid?: string): string | undefined {
  if (!cid) return undefined;
  const hex = cid.trim().toUpperCase().replace(/[^0-9A-F]/g, '');
  return hex.length >= 6 ? hex.slice(-6) : (hex || undefined);
}

// Stable hardware identity for a device: prefer the SD CID, then a usable (non-stock) MAC. Returns ''
// when neither is usable, so identity falls back to IP/profileId. Used to tell two MiSTers apart.
export function deviceHardwareKey(device?: { sdCid?: string; macAddress?: string }): string {
  const cid = (device?.sdCid ?? '').trim().toLowerCase().replace(/[^0-9a-f]/g, '');
  if (isUsableSdCid(cid)) return `cid:${cid}`;
  const mac = (device?.macAddress ?? '').trim().toLowerCase().replace(/[^0-9a-f]/g, '');
  if (isUsableMacAddress(mac)) return `mac:${mac}`;
  return '';
}

export function sameDevice(
  a?: { sdCid?: string; macAddress?: string },
  b?: { sdCid?: string; macAddress?: string },
): boolean {
  const keyA = deviceHardwareKey(a);
  return Boolean(keyA) && keyA === deviceHardwareKey(b);
}

export function formatMisterDeviceName(candidate: Pick<MisterDiscoveryCandidate, 'ipAddress' | 'hostname' | 'fingerprint'> & { alias?: string }) {
  if (candidate.alias) return candidate.alias;
  const host = candidate.hostname || candidate.fingerprint?.hostname || 'MiSTer';
  const suffix = macSuffix(candidate.fingerprint?.macAddress);
  if (host.toLowerCase() === 'mister' && suffix) return `MiSTer @ ${candidate.ipAddress} / MAC ${suffix}`;
  if (host.toLowerCase() === 'mister') return `MiSTer 후보 @ ${candidate.ipAddress}`;
  return `${host} @ ${candidate.ipAddress}`;
}

export function formatProfileDeviceName(profile: MisterDeviceProfile) {
  if (profile.alias) return profile.alias;
  const suffix = macSuffix(profile.macAddress || profile.fingerprint?.macAddress);
  if ((profile.hostname || '').toLowerCase() === 'mister' && suffix) return `MiSTer @ ${profile.ipAddress} / MAC ${suffix}`;
  return `${profile.hostname || 'MiSTer'} @ ${profile.ipAddress}`;
}

export function formatPortProbeSummary(results: PortProbeResult[] = []) {
  if (results.length === 0) return '포트 확인 전';
  const open = results.filter((result) => result.open).map((result) => result.port);
  const closedCount = results.length - open.length;
  return `열림 ${open.length ? open.join(', ') : '없음'} · 닫힘/무응답 ${closedCount}`;
}

export function createMockFingerprint(ipAddress: string, macTail = 'A1B2'): MisterFingerprint {
  return {
    mediaFatExists: true,
    gamesPathExists: true,
    scriptsPathExists: true,
    misterIniExists: true,
    hostname: 'MiSTer',
    macAddress: `02:00:00:00:${macTail.slice(0, 2)}:${macTail.slice(2, 4)}`,
    checkedAt: new Date().toISOString(),
  };
}
