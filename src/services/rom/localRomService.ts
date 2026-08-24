import type { LocalRomScanOptions, LocalRomScanResult } from '../../types/rom';

export class LocalRomSelectionService {
  async selectFiles(): Promise<LocalRomScanResult> {
    if (typeof window !== 'undefined' && window.helloMisterDesktop?.selectLocalRomFiles) return window.helloMisterDesktop.selectLocalRomFiles();
    return { ok: false, cancelled: true, sourceType: 'files', items: [], warnings: [], message: '현재 환경에서는 로컬 ROM 파일 선택을 지원하지 않습니다.' };
  }

  async selectFolder(options: LocalRomScanOptions): Promise<LocalRomScanResult> {
    if (typeof window !== 'undefined' && window.helloMisterDesktop?.selectLocalRomFolder) return window.helloMisterDesktop.selectLocalRomFolder(options);
    return { ok: false, cancelled: true, sourceType: 'folder', items: [], warnings: [], message: '현재 환경에서는 로컬 ROM 폴더 선택을 지원하지 않습니다.' };
  }
}
