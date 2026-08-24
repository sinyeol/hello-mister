const secretKeyPattern = /password|privateKey|passphrase|token|secret|credential|rawCommand|privateKeyPath/i;
const windowsPathPattern = /^[a-zA-Z]:[\\/]/;
const posixPathPattern = /^\/(Users|home|mnt|media|Volumes)\//;

export function basenameOnly(pathValue: string) {
  return pathValue.split(/[\\/]/).filter(Boolean).pop() || pathValue;
}

export function maskLocalPath(pathValue?: string, includeFullLocalPaths = false) {
  if (!pathValue) return pathValue;
  if (includeFullLocalPaths) return pathValue;
  if (windowsPathPattern.test(pathValue) || posixPathPattern.test(pathValue)) {
    return basenameOnly(pathValue);
  }
  return pathValue;
}

export function sanitizeForExport<T>(value: T, options: { includeFullLocalPaths?: boolean } = {}): T {
  return JSON.parse(JSON.stringify(value, (key, innerValue) => {
    if (secretKeyPattern.test(key)) return '[removed]';
    if (typeof innerValue === 'string' && /path$/i.test(key)) {
      return maskLocalPath(innerValue, Boolean(options.includeFullLocalPaths));
    }
    return innerValue;
  }));
}

export function createFullPathWarning(includeFullLocalPaths: boolean) {
  return includeFullLocalPaths
    ? '주의: 사용자가 명시적으로 선택했기 때문에 로컬 전체 경로가 리포트에 포함될 수 있습니다.'
    : '기본 내보내기에서는 로컬 전체 경로를 숨기고 파일명 중심으로 기록합니다.';
}
