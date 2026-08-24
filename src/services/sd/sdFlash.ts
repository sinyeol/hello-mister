import type { SdFlashProgress, SdFlashRequest, SdFlashResult } from '../../types/sd';

export interface SdFlashService {
  flashMrFusionImage(request: SdFlashRequest, onProgress?: (progress: SdFlashProgress) => void): Promise<SdFlashResult>;
}

// 실제 디스크 쓰기는 Electron main의 관리자 권한 워커가 수행한다(시스템 디스크 차단 + 드라이브 문자 교차검증).
// dryRun=true 는 대상/이미지/확인 문구만 검증하고 실제 포맷·파티션·쓰기는 하지 않는다.
export class DesktopSdFlashService implements SdFlashService {
  async flashMrFusionImage(request: SdFlashRequest, onProgress?: (progress: SdFlashProgress) => void): Promise<SdFlashResult> {
    const api = window.helloMisterDesktop;
    if (!api?.flashSdImage) {
      return {
        ok: request.dryRun,
        dryRun: request.dryRun,
        message: request.dryRun
          ? 'dry-run(시뮬레이션): 데스크톱 환경이 아니라 실제 쓰기를 수행하지 않았습니다.'
          : '실제 플래시는 데스크톱(Electron) 앱에서만 가능합니다.',
        logs: [],
      };
    }
    let unsubscribe: (() => void) | undefined;
    if (onProgress && api.onSdFlashProgress) {
      unsubscribe = api.onSdFlashProgress(onProgress);
    }
    try {
      return await api.flashSdImage(request);
    } finally {
      unsubscribe?.();
    }
  }
}
