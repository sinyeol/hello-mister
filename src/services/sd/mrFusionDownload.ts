import type { MrFusionDownloadProgress, MrFusionDownloadResult, MrFusionImage, MrFusionVariant } from '../../types/sd';

export interface MrFusionDownloadService {
  downloadLatest(
    variant: MrFusionVariant,
    options?: { force?: boolean; onProgress?: (progress: MrFusionDownloadProgress) => void },
  ): Promise<MrFusionDownloadResult>;
  resolveLatest(
    variant: MrFusionVariant,
    options?: { onProgress?: (progress: MrFusionDownloadProgress) => void },
  ): Promise<{ ok: boolean; status: 'local-verified' | 'changed' | 'none' | 'error'; tag?: string; image?: MrFusionImage; message?: string }>;
  selectLocalImage(): Promise<{ ok: boolean; image?: MrFusionImage; message: string }>;
  calculateHash(filePath: string): Promise<{ ok: boolean; hash?: string; message: string }>;
}

export class DesktopMrFusionDownloadService implements MrFusionDownloadService {
  async downloadLatest(variant: MrFusionVariant, options?: { force?: boolean; onProgress?: (progress: MrFusionDownloadProgress) => void }) {
    const api = window.helloMisterDesktop;
    if (!api?.downloadMrFusionImage) {
      return {
        ok: false,
        message: '이미지 다운로드는 데스크톱(Electron) 앱에서만 가능합니다. 브라우저 미리보기에서는 동작하지 않습니다.',
        logs: [],
      };
    }
    let unsubscribe: (() => void) | undefined;
    if (options?.onProgress && api.onSdDownloadProgress) {
      unsubscribe = api.onSdDownloadProgress(options.onProgress);
    }
    try {
      return await api.downloadMrFusionImage({ variant, force: options?.force });
    } finally {
      unsubscribe?.();
    }
  }

  async resolveLatest(variant: MrFusionVariant, options?: { onProgress?: (progress: MrFusionDownloadProgress) => void }) {
    const api = window.helloMisterDesktop;
    if (!api?.resolveMrFusionImage) {
      return { ok: false, status: 'none' as const, message: '이미지 확인은 데스크톱(Electron) 앱에서만 가능합니다.' };
    }
    let unsubscribe: (() => void) | undefined;
    if (options?.onProgress && api.onSdDownloadProgress) {
      unsubscribe = api.onSdDownloadProgress(options.onProgress);
    }
    try {
      return await api.resolveMrFusionImage({ variant });
    } finally {
      unsubscribe?.();
    }
  }

  async selectLocalImage() {
    if (window.helloMisterDesktop?.selectMrFusionImage) {
      const selected = await window.helloMisterDesktop.selectMrFusionImage();
      if (selected.cancelled || !selected.filePath) return { ok: false, message: '로컬 이미지 선택이 취소되었습니다.' };
      const image: MrFusionImage = {
        source: 'local',
        fileName: selected.fileName || selected.filePath,
        localPath: selected.filePath,
        verified: false,
      };
      return { ok: true, image, message: '로컬 Mr. Fusion 이미지를 선택했습니다.' };
    }
    return { ok: false, message: '현재 실행 환경에서는 로컬 파일 선택 adapter가 없습니다.' };
  }

  async calculateHash(filePath: string) {
    if (window.helloMisterDesktop?.calculateFileSha256) {
      const result = await window.helloMisterDesktop.calculateFileSha256(filePath);
      return { ok: result.ok, hash: result.hash, message: result.message };
    }
    return { ok: false, message: '현재 실행 환경에서는 SHA-256 계산 adapter가 없습니다.' };
  }
}
