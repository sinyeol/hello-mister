import type { SafeActionResult } from '../../types/tasks';

export interface MisterFileService {
  readText(path: string): Promise<SafeActionResult & { content?: string }>;
  writeText(path: string, content: string, options: { dryRun: boolean; backupPath?: string }): Promise<SafeActionResult>;
}

export class DryRunMisterFileService implements MisterFileService {
  async readText(path: string) {
    return {
      ok: true,
      dryRun: true,
      message: `dry-run: ${path} 파일을 읽는 흐름을 시뮬레이션했습니다.`,
      content: '# dry-run placeholder\n',
      logs: ['실제 MiSTer 파일 시스템에는 접근하지 않았습니다.'],
    };
  }

  async writeText(path: string, _content: string, options: { dryRun: boolean; backupPath?: string }) {
    if (!options.dryRun) {
      return {
        ok: false,
        dryRun: false,
        message: '실제 쓰기 adapter가 아직 연결되지 않았습니다.',
        logs: [],
        error: { code: 'REAL_WRITE_DISABLED', message: '1차 구현에서는 원격 파일 쓰기를 차단합니다.' },
      };
    }
    return {
      ok: true,
      dryRun: true,
      message: `dry-run: ${path}에 쓰기 전 백업과 변경 preview를 생성했습니다.`,
      logs: [`backup=${options.backupPath ?? '자동 백업 경로 미지정'}`, '원격 저장은 수행하지 않았습니다.'],
    };
  }
}
