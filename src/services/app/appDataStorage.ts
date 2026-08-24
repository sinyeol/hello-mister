import type { AppDataStorageStatus, AppDataSecretSanitizeStatus } from '../../types/desktop';

export async function getAppDataStorageStatus(): Promise<AppDataStorageStatus> {
  if (typeof window !== 'undefined' && window.helloMisterDesktop?.getAppDataStorageStatus) {
    return window.helloMisterDesktop.getAppDataStorageStatus();
  }
  return {
    checkedAt: new Date().toISOString(),
    files: [],
    message: '브라우저 fallback에서는 Electron appData 파일 상태를 직접 확인할 수 없습니다.',
  };
}

export async function openAppDataFolder() {
  if (typeof window !== 'undefined' && window.helloMisterDesktop?.openAppDataFolder) {
    return window.helloMisterDesktop.openAppDataFolder();
  }
  return {
    ok: false,
    message: '브라우저 fallback에서는 앱 데이터 폴더를 OS 탐색기로 열 수 없습니다.',
  };
}

export function formatSecretSanitizeStatus(status: AppDataSecretSanitizeStatus) {
  const labels: Record<AppDataSecretSanitizeStatus, string> = {
    ok: 'secret 없음',
    'needs-review': '수동 확인 필요',
    missing: '아직 없음',
    'not-readable': '읽기 실패',
    'browser-fallback': 'fallback 가능',
  };
  return labels[status];
}

export function statusToneForSecret(status: AppDataSecretSanitizeStatus) {
  if (status === 'ok') return 'safe' as const;
  if (status === 'needs-review' || status === 'not-readable') return 'warning' as const;
  return 'dry' as const;
}
