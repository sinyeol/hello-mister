import type {
  LocalRomCandidate,
  RemoteGameFolderSnapshot,
  RomConflictCheckResult,
  RomCopyPlan,
  RomDryRunResult,
  RomPerFilePlan,
  RomPlannedAction,
  RomStorageDryRun,
} from '../../types/rom';
import { RomConflictService } from './romConflictService';
import { getPolicyForConflict, normalizePlannedAction, validateRomPlan } from './romPolicyService';

export class RomPlanningService {
  private conflictService = new RomConflictService();

  createDryRunPlan(input: {
    candidates: LocalRomCandidate[];
    snapshots: RemoteGameFolderSnapshot[];
    storage: RomStorageDryRun;
    targetProfileId?: string;
    targetAlias?: string;
    targetHost?: string;
    actionOverrides?: Record<string, RomPlannedAction>;
  }): RomDryRunResult {
    const conflicts = input.candidates.map((candidate) => {
      const snapshot = input.snapshots.find((item) => item.folder.remotePath === candidate.recommendation?.targetFolder);
      return this.conflictService.inspect(candidate, snapshot);
    });
    const perFilePlan = input.candidates.map((candidate) => this.createPerFilePlan(
      candidate,
      conflicts.find((conflict) => conflict.candidateId === candidate.id),
      input.actionOverrides?.[candidate.id],
    ));
    const totalSizeBytes = input.candidates.reduce((sum, candidate) => sum + candidate.sizeBytes, 0);
    const plan: RomCopyPlan = {
      planId: `rom-plan-${Date.now()}`,
      createdAt: new Date().toISOString(),
      sourceFiles: input.candidates,
      targetProfileId: input.targetProfileId,
      targetAlias: input.targetAlias,
      targetHost: input.targetHost,
      targetBasePath: '/media/fat/games',
      perFilePlan,
      totalSizeBytes,
      requiredFreeBytes: input.storage.requirement.requiredFreeBytes,
      remoteFreeBytes: input.storage.remoteFreeBytes,
      canProceedLater: false,
      schemaVersion: 1,
      dryRun: true,
      readOnly: true,
    };
    const validation = validateRomPlan(plan);
    plan.validation = validation;
    plan.canProceedLater = validation.canProceedLater;
    return {
      ok: validation.canProceedLater,
      dryRun: true,
      readOnly: true,
      plan,
      conflicts,
      storage: input.storage,
      message: validation.canProceedLater
        ? 'ROM 복사 계획을 dry-run으로 생성했습니다. 실제 복사는 수행하지 않았습니다.'
        : 'ROM 복사 계획에 사용자 결정 또는 차단 항목이 있습니다. 실제 복사는 수행하지 않았습니다.',
    };
  }

  private createPerFilePlan(candidate: LocalRomCandidate, conflict?: RomConflictCheckResult, overrideAction?: RomPlannedAction): RomPerFilePlan {
    const conflictType = conflict?.conflictType || 'none';
    const action = normalizePlannedAction(overrideAction || getPolicyForConflict(conflictType).defaultAction);
    return {
      candidateId: candidate.id,
      localPath: candidate.filePath,
      fileName: candidate.fileName,
      sizeBytes: candidate.sizeBytes,
      recommendedPlatform: candidate.recommendation?.platform,
      targetFolder: candidate.recommendation?.targetFolder,
      targetRemotePath: candidate.recommendation?.targetRemotePath,
      conflictType,
      action,
      status: action === 'copyLater'
        ? 'copy-ready'
        : action === 'block'
          ? 'blocked'
          : action === 'needsUserDecision' || action === 'createFolderLater' || action === 'chooseDifferentFolder'
            ? 'manual-required'
            : 'conflict',
      warning: conflict?.message,
      remoteExistingFile: conflict?.remoteFile,
      folderCreationRequired: action === 'createFolderLater',
      backupRequired: action === 'replaceLater',
    };
  }
}
