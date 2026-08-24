import type { RomBackupItem, RomBackupPlan, RomBackupValidationResult, RomCopyPlan, RomPlanBlockReason } from '../../types/rom';
import { normalizePlannedAction } from './romPolicyService';

function joinPreviewPath(root: string, fileName: string) {
  const cleanRoot = root.replace(/[\\/]+$/, '');
  return `${cleanRoot}\\${fileName}`;
}

export class RomBackupPlanService {
  createBackupPlan(plan: RomCopyPlan, backupRootLocalPath?: string): RomBackupPlan {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupRoot = backupRootLocalPath ? `${backupRootLocalPath.replace(/[\\/]+$/, '')}\\hello-mister-rom-backup-${timestamp}` : undefined;
    const items: RomBackupItem[] = plan.perFilePlan
      .filter((item) => normalizePlannedAction(item.action) === 'replaceLater')
      .map((item) => ({
        candidateId: item.candidateId,
        fileName: item.remoteExistingFile?.name || item.fileName,
        remotePath: item.remoteExistingFile?.path || item.targetRemotePath || `${plan.targetBasePath}/${item.fileName}`,
        sizeBytes: item.remoteExistingFile?.sizeBytes,
        backupTargetLocalPathPreview: backupRoot ? joinPreviewPath(backupRoot, item.remoteExistingFile?.name || item.fileName) : undefined,
        backupReason: 'replaceLater 선택으로 원격 파일 교체 전 백업이 필요합니다.',
        requiredBeforeCopy: true,
      }));
    return {
      planId: `${plan.planId}-backup`,
      createdAt: new Date().toISOString(),
      backupRootLocalPath,
      items,
      totalSizeBytes: items.reduce((sum, item) => sum + (item.sizeBytes || 0), 0),
      dryRun: true,
      readOnly: true,
      message: items.length
        ? '복사 전 백업 계획을 dry-run으로 생성했습니다. 실제 백업 파일은 만들지 않았습니다.'
        : 'replaceLater 항목이 없어 백업 대상이 없습니다.',
    };
  }

  validateBackupPlan(plan: RomCopyPlan, backupPlan?: RomBackupPlan): RomBackupValidationResult {
    const blockers: RomPlanBlockReason[] = [];
    const replaceItems = plan.perFilePlan.filter((item) => normalizePlannedAction(item.action) === 'replaceLater');
    for (const item of replaceItems) {
      if (!backupPlan?.items.some((backup) => backup.candidateId === item.candidateId)) {
        blockers.push({
          code: 'MISSING_BACKUP_PLAN',
          message: `${item.fileName} 교체 전 백업 계획이 없습니다.`,
          candidateId: item.candidateId,
          fileName: item.fileName,
        });
      }
    }
    if (replaceItems.length > 0 && !backupPlan?.backupRootLocalPath) {
      blockers.push({
        code: 'MISSING_BACKUP_PLAN',
        message: 'replaceLater 항목이 있으므로 로컬 백업 위치가 필요합니다.',
      });
    }
    return {
      ok: blockers.length === 0,
      blockers,
      message: blockers.length ? '백업 계획이 부족해 최종 실행 전 차단됩니다.' : '백업 dry-run 계획이 유효합니다.',
    };
  }
}
