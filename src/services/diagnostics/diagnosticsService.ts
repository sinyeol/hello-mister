import type { SafeActionResult } from '../../types/tasks';

export interface DiagnosticsService {
  runBasicDiagnostics(): Promise<SafeActionResult>;
}

export class DryRunDiagnosticsService implements DiagnosticsService {
  async runBasicDiagnostics(): Promise<SafeActionResult> {
    return {
      ok: true,
      dryRun: true,
      message: 'dry-run: 연결, 저장공간, 설정 위험 진단 카드를 생성했습니다.',
      logs: ['연결 진단: mock 후보 있음', '저장공간 진단: SD 카드 adapter 대기', '설정 위험 진단: CRT preset은 위험으로 표시'],
    };
  }
}
