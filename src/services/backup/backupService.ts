import type { SafeActionResult } from '../../types/tasks';

export interface BackupService {
  createBackupPlan(targets: string[]): Promise<SafeActionResult & { backupName: string }>;
}

export class DryRunBackupService implements BackupService {
  async createBackupPlan(targets: string[]) {
    return {
      ok: true,
      dryRun: true,
      backupName: `hello-mister-backup-${new Date().toISOString().slice(0, 10)}.zip`,
      message: 'dry-run: 백업 대상과 파일명을 계산했습니다.',
      logs: targets.map((target) => `포함 예정: ${target}`),
    };
  }
}
