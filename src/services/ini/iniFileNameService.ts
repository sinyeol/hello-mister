const allowedAltIniNames = new Set(['MiSTer_alt_1.ini', 'MiSTer_alt_2.ini', 'MiSTer_alt_3.ini']);
const safeIniNameBodyPattern = '[A-Za-z0-9][A-Za-z0-9._ ()-]*';
const allowedAltIniNamePattern = /^MiSTer_alt_[1-3]\.ini$/i;
const allowedCustomIniNamePattern = new RegExp(`^MiSTer_${safeIniNameBodyPattern}\\.ini$`, 'i');
const invalidIniFileNameMessage = '허용되지 않은 INI 파일명입니다. MiSTer.ini, MiSTer_alt_1.ini, MiSTer_alt_2.ini, MiSTer_alt_3.ini, MiSTer_이름.ini 형식의 안전한 파일명만 사용할 수 있습니다.';

export type IniFileKind = 'main' | 'alt1' | 'alt2' | 'alt3' | 'alt' | 'custom';

function hasUnsafeControlChar(value: string) {
  return Array.from(value).some((char) => char.charCodeAt(0) < 32);
}

export function normalizeIniFileName(fileName: string) {
  return String(fileName || '').trim().replace(/\\/g, '/').split('/').pop() || '';
}

export function isSafeIniDisplayFileName(fileName: string) {
  const normalized = normalizeIniFileName(fileName);
  return normalized === String(fileName || '').trim()
    && /\.ini$/i.test(normalized)
    && !normalized.includes('..')
    && !/[<>:"|?*]/.test(normalized)
    && !hasUnsafeControlChar(normalized);
}

export function isAllowedIniFileName(fileName: string) {
  const normalized = normalizeIniFileName(fileName);
  if (normalized !== String(fileName || '').trim()) return false;
  if (/^MiSTer\.ini$/i.test(normalized)) return true;
  if (allowedAltIniNamePattern.test(normalized) || allowedAltIniNames.has(normalized)) {
    return !normalized.includes('..')
      && !/[<>:"|?*]/.test(normalized)
      && !hasUnsafeControlChar(normalized);
  }
  return allowedCustomIniNamePattern.test(normalized)
    && !normalized.includes('..')
    && !/[<>:"|?*]/.test(normalized)
    && !hasUnsafeControlChar(normalized);
}

export function assertAllowedIniFileName(fileName: string) {
  const normalized = normalizeIniFileName(fileName);
  if (!isAllowedIniFileName(fileName)) {
    throw new Error(invalidIniFileNameMessage);
  }
  return normalized;
}

export function classifyIniFile(fileName: string): IniFileKind {
  const normalized = normalizeIniFileName(fileName);
  if (/^MiSTer\.ini$/i.test(normalized)) return 'main';
  if (/^MiSTer_alt_1\.ini$/i.test(normalized)) return 'alt1';
  if (/^MiSTer_alt_2\.ini$/i.test(normalized)) return 'alt2';
  if (/^MiSTer_alt_3\.ini$/i.test(normalized)) return 'alt3';
  if (allowedAltIniNamePattern.test(normalized)) return 'alt';
  return 'custom';
}

export function canTrashIniFile(fileName: string) {
  return classifyIniFile(fileName) !== 'main' && isAllowedIniFileName(fileName);
}

export function remoteIniPath(fileName: string) {
  return `/media/fat/${assertAllowedIniFileName(fileName)}`;
}

export function suggestedRemoteIniFileName(fileName: string) {
  const normalized = normalizeIniFileName(fileName);
  if (isAllowedIniFileName(normalized)) return normalized;
  const base = normalized.replace(/\.ini$/i, '').replace(/[^A-Za-z0-9._ -]/g, ' ').replace(/\s+/g, ' ').trim();
  const safeBase = base || 'Imported';
  return `MiSTer_${safeBase}.ini`;
}
