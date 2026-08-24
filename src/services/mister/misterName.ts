// 앱 전체에서 미스터를 선택/표시할 때 쓰는 표준 표시 이름.
// 우선순위: 호스트네임(카드에 저장된 기기 이름) → 사용자 별칭 → IP/host. 스톡 기본값 'MiSTer'는 "이름 없음"으로 취급.
// 여러 디바이스 객체 모양(MisterDeviceProfile / ActiveMisterProfile / ConnectedMiSTerDevice / MiSTerLibraryProfile /
// MiSTerConnectionConfig)을 모두 받도록 넓게 정의한다.
export interface MisterNameLike {
  hostname?: string;
  alias?: string;
  ipAddress?: string;
  host?: string;
  deviceName?: string;
}

export function misterDisplayName(device?: MisterNameLike): string {
  if (!device) return 'MiSTer';
  const host = device.hostname?.trim();
  if (host && host !== 'MiSTer') return host;
  const alias = device.alias?.trim();
  if (alias) return alias;
  return (device.ipAddress || device.host || device.deviceName || '').trim() || 'MiSTer';
}
