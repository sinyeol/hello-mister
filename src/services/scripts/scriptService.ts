import type { SafeActionResult } from '../../types/tasks';

export interface ScriptService {
  listScripts(): Promise<string[]>;
  runScript(path: string, dryRun: boolean): Promise<SafeActionResult>;
}

export class DryRunScriptService implements ScriptService {
  async listScripts() {
    return ['update_all.sh', 'wifi.sh', 'custom_backup.sh'];
  }

  async runScript(path: string, dryRun: boolean): Promise<SafeActionResult> {
    return {
      ok: dryRun,
      dryRun,
      message: dryRun ? `dry-run: ${path} 실행 전 위험 키워드 검사와 백업 계획만 만들었습니다.` : '실제 스크립트 실행은 아직 비활성화되어 있습니다.',
      logs: ['위험 키워드 검사 예정: rm, mkfs, dd, reboot, shutdown', '실시간 로그 표시 adapter는 추후 연결합니다.'],
    };
  }
}
