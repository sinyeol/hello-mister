import type { RomCopyPlan, RomPerFilePlan, RomPlanFilterMode, RomPlanSortMode, RomPlanSummary, RomPlannedAction } from '../../types/rom';
import { normalizePlannedAction } from './romPolicyService';

const actionList: RomPlannedAction[] = [
  'copyLater',
  'skip',
  'replaceLater',
  'renameLocalFileLater',
  'createFolderLater',
  'chooseDifferentFolder',
  'needsUserDecision',
  'block',
  'blocked',
];

export function summarizeRomPlan(plan?: RomCopyPlan): RomPlanSummary {
  const items = plan?.perFilePlan || [];
  const actionCounts = actionList.reduce((acc, action) => ({ ...acc, [action]: 0 }), {} as Record<RomPlannedAction, number>);
  const conflictCounts = {
    none: 0,
    sameNameSameSize: 0,
    sameNameDifferentSize: 0,
    targetFolderMissing: 0,
    ambiguousPlatform: 0,
    unsupportedExtension: 0,
    remoteReadFailed: 0,
    needsManualPlatform: 0,
    insufficientSpace: 0,
  };

  for (const item of items) {
    actionCounts[item.action] = (actionCounts[item.action] || 0) + 1;
    conflictCounts[item.conflictType] = (conflictCounts[item.conflictType] || 0) + 1;
  }

  const normalizedActions = items.map((item) => normalizePlannedAction(item.action));
  return {
    totalFileCount: items.length,
    copyLaterCount: normalizedActions.filter((action) => action === 'copyLater').length,
    skipCount: normalizedActions.filter((action) => action === 'skip').length,
    replaceLaterCount: normalizedActions.filter((action) => action === 'replaceLater').length,
    renameLaterCount: normalizedActions.filter((action) => action === 'renameLocalFileLater').length,
    folderCreationCount: normalizedActions.filter((action) => action === 'createFolderLater').length,
    blockedCount: normalizedActions.filter((action) => action === 'block').length,
    manualDecisionCount: normalizedActions.filter((action) => action === 'needsUserDecision' || action === 'chooseDifferentFolder').length,
    totalSizeBytes: plan?.totalSizeBytes || 0,
    totalCopySizeBytes: items
      .filter((item) => normalizePlannedAction(item.action) === 'copyLater')
      .reduce((sum, item) => sum + item.sizeBytes, 0),
    remoteFreeBytes: plan?.remoteFreeBytes,
    conflictCounts,
    actionCounts,
  };
}

export function filterRomPlanItems(items: RomPerFilePlan[], filter: RomPlanFilterMode): RomPerFilePlan[] {
  return items.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'ready') return item.status === 'copy-ready';
    if (filter === 'manual') return item.status === 'manual-required';
    if (filter === 'blocked') return item.status === 'blocked';
    if (filter === 'targetFolderMissing') return item.conflictType === 'targetFolderMissing';
    if (filter === 'unsupportedExtension') return item.conflictType === 'unsupportedExtension';
    if (filter === 'replaceLater') return normalizePlannedAction(item.action) === 'replaceLater';
    return item.status === 'conflict';
  });
}

export function sortRomPlanItems(items: RomPerFilePlan[], sort: RomPlanSortMode): RomPerFilePlan[] {
  const copy = [...items];
  copy.sort((left, right) => {
    if (sort === 'size-desc') return right.sizeBytes - left.sizeBytes;
    if (sort === 'size-asc') return left.sizeBytes - right.sizeBytes;
    if (sort === 'platform') return String(left.recommendedPlatform || '').localeCompare(String(right.recommendedPlatform || '')) || left.fileName.localeCompare(right.fileName);
    if (sort === 'action') return normalizePlannedAction(left.action).localeCompare(normalizePlannedAction(right.action)) || left.fileName.localeCompare(right.fileName);
    if (sort === 'conflict') return left.conflictType.localeCompare(right.conflictType) || left.fileName.localeCompare(right.fileName);
    return left.fileName.localeCompare(right.fileName);
  });
  return copy;
}
