import type {
  LocalRomCandidate,
  RemoteFolderCreationPlan,
  RemoteFolderNameValidationResult,
  RemoteFolderPolicy,
  RomConflictResolutionPolicy,
  RomConflictType,
  RomCopyPlan,
  RomFinalConfirmationBlocker,
  RomFinalConfirmationRisk,
  RomFinalConfirmationSummary,
  RomPlanBlockReason,
  RomPlanValidationResult,
  RomPlannedAction,
  RomPerFilePlan,
} from '../../types/rom';

const gamesBasePath = '/media/fat/games' as const;

export const romConflictPolicies: RomConflictResolutionPolicy[] = [
  {
    conflictType: 'none',
    defaultAction: 'copyLater',
    allowedActions: ['copyLater', 'skip', 'block'],
    description: '충돌이 없으므로 나중에 복사할 수 있는 계획으로 둡니다.',
  },
  {
    conflictType: 'sameNameSameSize',
    defaultAction: 'skip',
    allowedActions: ['skip', 'copyLater', 'block'],
    description: '같은 파일일 가능성이 높아 기본값은 건너뛰기입니다.',
  },
  {
    conflictType: 'sameNameDifferentSize',
    defaultAction: 'needsUserDecision',
    allowedActions: ['skip', 'replaceLater', 'renameLocalFileLater', 'block'],
    description: '이름은 같지만 크기가 다르므로 사용자가 충돌 해결 방식을 선택해야 합니다.',
    requiresBackup: true,
  },
  {
    conflictType: 'targetFolderMissing',
    defaultAction: 'needsUserDecision',
    allowedActions: ['createFolderLater', 'chooseDifferentFolder', 'block'],
    description: '원격 대상 폴더가 없으므로 폴더 생성 계획 또는 다른 폴더 선택이 필요합니다.',
    requiresFolderPlan: true,
  },
  {
    conflictType: 'ambiguousPlatform',
    defaultAction: 'needsUserDecision',
    allowedActions: ['needsUserDecision', 'block'],
    description: '플랫폼 후보가 여러 개라 직접 선택 전까지 차단합니다.',
  },
  {
    conflictType: 'unsupportedExtension',
    defaultAction: 'block',
    allowedActions: ['block'],
    description: '지원하지 않는 확장자는 이번 단계에서 차단합니다.',
  },
  {
    conflictType: 'remoteReadFailed',
    defaultAction: 'block',
    allowedActions: ['block'],
    description: '원격 목록 확인에 실패했으므로 안전하게 차단합니다.',
  },
  {
    conflictType: 'needsManualPlatform',
    defaultAction: 'needsUserDecision',
    allowedActions: ['needsUserDecision', 'block'],
    description: '플랫폼 직접 선택이 필요합니다.',
  },
  {
    conflictType: 'insufficientSpace',
    defaultAction: 'block',
    allowedActions: ['block'],
    description: '원격 저장공간이 부족하면 실제 복사 계획을 진행할 수 없습니다.',
  },
];

export function getPolicyForConflict(conflictType: RomConflictType): RomConflictResolutionPolicy {
  return romConflictPolicies.find((policy) => policy.conflictType === conflictType) || romConflictPolicies[0];
}

export function normalizePlannedAction(action: RomPlannedAction): RomPlannedAction {
  return action === 'blocked' ? 'block' : action;
}

export function validateRemoteFolderName(folderName: string): RemoteFolderNameValidationResult {
  const raw = String(folderName || '').trim();
  if (!raw) return { ok: false, folderName: raw, code: 'EMPTY', message: '폴더 이름이 비어 있습니다.' };
  if (/^[a-zA-Z]:/.test(raw) || raw.startsWith('/') || raw.startsWith('\\')) {
    return { ok: false, folderName: raw, code: 'ABSOLUTE_PATH', message: '절대경로는 입력할 수 없습니다.' };
  }
  if (raw.includes('/') || raw.includes('\\')) {
    return { ok: false, folderName: raw, code: 'PATH_SEPARATOR', message: '폴더 이름에 경로 구분자를 넣을 수 없습니다.' };
  }
  if (raw.includes('..')) return { ok: false, folderName: raw, code: 'PARENT_TRAVERSAL', message: '.. 경로 이동은 허용하지 않습니다.' };
  if (raw === '.' || raw.toLowerCase() === 'games') {
    return { ok: false, folderName: raw, code: 'RESERVED', message: '예약된 폴더 이름은 사용할 수 없습니다.' };
  }
  return { ok: true, folderName: raw, normalizedName: raw, message: '폴더 이름이 dry-run 검증을 통과했습니다.' };
}

export function createRemoteFolderPlan(folderName: string, candidateIds: string[]): RemoteFolderCreationPlan {
  const validation = validateRemoteFolderName(folderName);
  const targetRemotePath = validation.ok ? `${gamesBasePath}/${validation.normalizedName}` : `${gamesBasePath}/[invalid]`;
  return {
    folderName,
    targetRemotePath,
    candidateIds,
    validation,
    dryRun: true,
    readOnly: true,
    status: validation.ok ? 'planned' : 'invalid',
    message: validation.ok
      ? '폴더 생성 예정으로만 표시했습니다. 실제 mkdir은 수행하지 않습니다.'
      : validation.message,
  };
}

export function createRemoteFolderPolicy(plans: RemoteFolderCreationPlan[]): RemoteFolderPolicy {
  return {
    basePath: gamesBasePath,
    allowCreateLater: true,
    plannedFolders: plans,
  };
}

export function validateRomPlan(plan: RomCopyPlan): RomPlanValidationResult {
  const blockers: RomPlanBlockReason[] = [];
  const risks: RomFinalConfirmationRisk[] = [];
  const warnings: string[] = [];
  const folderPlans = plan.folderPolicy?.plannedFolders || [];
  const backupItems = plan.backupPlan?.items || [];

  for (const item of plan.perFilePlan) {
    const action = normalizePlannedAction(item.action);
    if (action === 'block') blockers.push({ code: 'ACTION_BLOCKED', message: `${item.fileName} 항목이 차단 상태입니다.`, candidateId: item.candidateId, fileName: item.fileName });
    if (action === 'needsUserDecision' || action === 'chooseDifferentFolder') {
      blockers.push({ code: 'MANUAL_DECISION_REQUIRED', message: `${item.fileName} 항목은 사용자 결정이 필요합니다.`, candidateId: item.candidateId, fileName: item.fileName });
    }
    if (action === 'createFolderLater') {
      const planForItem = folderPlans.find((folderPlan) => folderPlan.candidateIds.includes(item.candidateId));
      if (!planForItem) blockers.push({ code: 'MISSING_TARGET_FOLDER', message: `${item.fileName} 대상 폴더 생성 계획이 없습니다.`, candidateId: item.candidateId, fileName: item.fileName });
      if (planForItem && !planForItem.validation.ok) blockers.push({ code: 'INVALID_FOLDER_NAME', message: planForItem.validation.message, candidateId: item.candidateId, fileName: item.fileName });
    }
    if (action === 'replaceLater') {
      risks.push({ code: 'REPLACE_LATER', message: `${item.fileName} 원격 파일 교체 예정입니다.`, severity: 'danger', candidateId: item.candidateId });
      if (!backupItems.some((backup) => backup.candidateId === item.candidateId)) {
        blockers.push({ code: 'MISSING_BACKUP_PLAN', message: `${item.fileName} 교체 전 백업 계획이 없습니다.`, candidateId: item.candidateId, fileName: item.fileName });
      }
    }
  }

  if (plan.requiredFreeBytes && typeof plan.remoteFreeBytes === 'number' && plan.remoteFreeBytes < plan.requiredFreeBytes) {
    blockers.push({ code: 'INSUFFICIENT_SPACE', message: '원격 저장공간이 dry-run 기준보다 부족합니다.' });
  }
  if (plan.perFilePlan.some((item) => normalizePlannedAction(item.action) === 'renameLocalFileLater')) warnings.push('renameLocalFileLater는 계획 표시만 하며 실제 로컬/원격 rename을 수행하지 않습니다.');
  if (folderPlans.length) warnings.push('폴더 생성 계획은 dry-run이며 실제 mkdir은 비활성입니다.');

  return {
    ok: blockers.length === 0,
    canProceedLater: blockers.length === 0,
    blockers,
    risks,
    warnings,
  };
}

export function createFinalConfirmationSummary(plan: RomCopyPlan): RomFinalConfirmationSummary {
  const validation = plan.validation || validateRomPlan(plan);
  const copyItems = plan.perFilePlan.filter((item) => normalizePlannedAction(item.action) === 'copyLater');
  const skipItems = plan.perFilePlan.filter((item) => normalizePlannedAction(item.action) === 'skip');
  const replaceItems = plan.perFilePlan.filter((item) => normalizePlannedAction(item.action) === 'replaceLater');
  const conflictItems = plan.perFilePlan.filter((item) => item.conflictType !== 'none');
  return {
    targetAlias: plan.targetAlias,
    targetHost: plan.targetHost,
    targetBasePath: plan.targetBasePath,
    copyFileCount: copyItems.length,
    skipFileCount: skipItems.length,
    conflictFileCount: conflictItems.length,
    replaceFileCount: replaceItems.length,
    folderCreationCount: plan.folderPolicy?.plannedFolders.length || 0,
    backupRequiredFileCount: plan.backupPlan?.items.length || 0,
    totalCopySizeBytes: copyItems.reduce((sum, item) => sum + item.sizeBytes, 0),
    remoteFreeBytes: plan.remoteFreeBytes,
    risks: validation.risks,
    blockers: validation.blockers.map((blocker): RomFinalConfirmationBlocker => ({
      code: blocker.code,
      message: blocker.message,
      candidateId: blocker.candidateId,
    })),
    requiredPhrase: 'DRY RUN ONLY',
    transferEnabled: false,
  };
}

export function summarizeAction(action: RomPlannedAction) {
  const normalized = normalizePlannedAction(action);
  const labels: Record<RomPlannedAction, string> = {
    copyLater: '나중에 복사',
    skip: '건너뛰기',
    replaceLater: '나중에 교체',
    renameLocalFileLater: '로컬 이름 변경 후 복사 예정',
    createFolderLater: '폴더 생성 예정',
    chooseDifferentFolder: '다른 폴더 선택 필요',
    needsUserDecision: '결정 필요',
    block: '차단',
    blocked: '차단',
  };
  return labels[normalized];
}

export function updatePlanActions(plan: RomCopyPlan, overrides: Record<string, RomPlannedAction>): RomCopyPlan {
  const perFilePlan: RomPerFilePlan[] = plan.perFilePlan.map((item) => {
    const action = normalizePlannedAction(overrides[item.candidateId] || item.action);
    const status: RomPerFilePlan['status'] = action === 'copyLater' ? 'copy-ready' : action === 'block' ? 'blocked' : action === 'needsUserDecision' || action === 'createFolderLater' || action === 'chooseDifferentFolder' ? 'manual-required' : 'conflict';
    return {
      ...item,
      action,
      folderCreationRequired: action === 'createFolderLater',
      backupRequired: action === 'replaceLater',
      status,
    };
  });
  const nextPlan = { ...plan, perFilePlan };
  return { ...nextPlan, validation: validateRomPlan(nextPlan) };
}

export function folderNameFromCandidate(candidate: LocalRomCandidate) {
  const target = candidate.recommendation?.targetRemotePath || candidate.recommendation?.targetFolder || '';
  return target.split('/').filter(Boolean).pop() || candidate.recommendation?.platform || candidate.normalizedGameName;
}
