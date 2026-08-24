import type { DesktopRuntimeEnvironment } from '../../types/desktop';

export function createBrowserRuntimeEnvironment(): DesktopRuntimeEnvironment {
  return {
    mode: 'browser-fallback',
    appName: 'Hello Mister v2.1',
    appVersion: '2.1.0',
    electronApiAvailable: false,
    readOnlyIpcAvailable: false,
    romTransferLocked: true,
    unsafeCommandIpcExposed: false,
    safetyMode: 'dry-run',
    checkedAt: new Date().toISOString(),
  };
}

export async function getRuntimeEnvironment(): Promise<DesktopRuntimeEnvironment> {
  if (typeof window !== 'undefined' && window.helloMisterDesktop?.getRuntimeEnvironment) {
    return window.helloMisterDesktop.getRuntimeEnvironment();
  }
  return createBrowserRuntimeEnvironment();
}

export function formatRuntimeMode(mode: DesktopRuntimeEnvironment['mode']) {
  return mode === 'electron' ? 'Electron 앱' : '브라우저 fallback';
}

export function formatElectronApiStatus(environment?: DesktopRuntimeEnvironment) {
  if (!environment) return '확인 전';
  if (environment.electronApiAvailable && environment.readOnlyIpcAvailable) return 'Electron read-only IPC 사용 가능';
  return '브라우저 fallback에서는 파일 dialog와 appData 확인이 제한됩니다.';
}

export function formatTransferLockStatus(environment?: DesktopRuntimeEnvironment) {
  if (!environment) return '확인 전';
  if (environment.romTransferLocked && !environment.unsafeCommandIpcExposed) return 'ROM 전송 잠금, raw command IPC 없음';
  return '안전 상태 수동 확인 필요';
}
