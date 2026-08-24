import type {
  RomCopyPlan,
  RomTransferFeatureFlags,
  RomTransferKillSwitchState,
  RomTransferPreflightBlocker,
  RomTransferPreflightResult,
  RomTransferPreflightWarning,
} from '../../types/rom';
import { normalizePlannedAction, validateRomPlan } from './romPolicyService';
import { defaultRomTransferFeatureFlags, getDefaultRomTransferKillSwitch } from './romTransferFeatureFlags';

const dangerousManualExtensions = new Set(['.zip', '.7z', '.cue', '.bin', '.chd', '.iso', '.vhd', '.dsk', '.rom', '.adf', '.hdf', '.xdf', '.dim', '.hdi']);

export class RomTransferPreflightService {
  inspect(input: {
    plan?: RomCopyPlan;
    hasTargetProfile: boolean;
    hasSessionCredential: boolean;
    hostKeyTrusted: boolean;
    hostKeyMismatch?: boolean;
    finalConfirmationCompleted?: boolean;
    featureFlags?: RomTransferFeatureFlags;
    killSwitch?: RomTransferKillSwitchState;
  }): RomTransferPreflightResult {
    const flags = input.featureFlags || defaultRomTransferFeatureFlags;
    const killSwitch = input.killSwitch || getDefaultRomTransferKillSwitch();
    const blockers: RomTransferPreflightBlocker[] = [];
    const warnings: RomTransferPreflightWarning[] = [];
    const requiredActions: string[] = [];
    const plan = input.plan;

    if (!plan) {
      blockers.push({ code: 'NO_PLAN', message: '복사 계획이 없습니다.' });
    } else {
      if (plan.schemaVersion !== 1) blockers.push({ code: 'SCHEMA_VERSION_UNSUPPORTED', message: `지원하지 않는 plan schemaVersion입니다: ${plan.schemaVersion}` });
      if (!plan.targetProfileId) blockers.push({ code: 'NO_TARGET_PROFILE', message: '대상 MiSTer 프로필이 계획에 없습니다.' });
      const validation = plan.validation || validateRomPlan(plan);
      for (const blocker of validation.blockers) {
        blockers.push({ code: blocker.code === 'MISSING_BACKUP_PLAN' ? 'MISSING_BACKUP_PLAN' : blocker.code === 'INSUFFICIENT_SPACE' ? 'STORAGE_NOT_OK' : 'BLOCKED_ITEMS', message: blocker.message, candidateId: blocker.candidateId });
      }
      for (const item of plan.perFilePlan) {
        const action = normalizePlannedAction(item.action);
        if (action === 'needsUserDecision' || action === 'chooseDifferentFolder') blockers.push({ code: 'NEEDS_USER_DECISION', message: `${item.fileName} 항목에 사용자 결정이 필요합니다.`, candidateId: item.candidateId });
        if (item.conflictType === 'targetFolderMissing' && action !== 'createFolderLater' && action !== 'block') blockers.push({ code: 'TARGET_FOLDER_UNRESOLVED', message: `${item.fileName} 대상 폴더 없음 상태가 해결되지 않았습니다.`, candidateId: item.candidateId });
        if (item.conflictType === 'ambiguousPlatform' || item.conflictType === 'needsManualPlatform') blockers.push({ code: 'AMBIGUOUS_PLATFORM', message: `${item.fileName} 플랫폼을 수동으로 확정해야 합니다.`, candidateId: item.candidateId });
      }
      for (const file of plan.sourceFiles) {
        if (dangerousManualExtensions.has(file.extension.toLowerCase()) && !file.manualPlatform) {
          blockers.push({ code: 'DANGEROUS_EXTENSION_UNRESOLVED', message: `${file.fileName} 확장자는 자동 확정 금지 대상입니다.`, candidateId: file.id });
        }
      }
      if (typeof plan.remoteFreeBytes === 'number' && plan.remoteFreeBytes < plan.requiredFreeBytes) {
        blockers.push({ code: 'STORAGE_NOT_OK', message: '원격 여유 공간이 dry-run 기준보다 부족합니다.' });
      }
    }

    if (!input.hasTargetProfile) blockers.push({ code: 'NO_TARGET_PROFILE', message: '대상 프로필이 선택되지 않았습니다.' });
    if (!input.hasSessionCredential) blockers.push({ code: 'NO_SESSION_CREDENTIAL', message: 'session-only 인증이 없습니다.' });
    if (!input.hostKeyTrusted) blockers.push({ code: 'HOST_KEY_NOT_TRUSTED', message: 'SSH host key가 신뢰 상태가 아닙니다.' });
    if (input.hostKeyMismatch) blockers.push({ code: 'HOST_KEY_MISMATCH', message: 'SSH host key mismatch 상태에서는 전송을 준비할 수 없습니다.' });
    if (!input.finalConfirmationCompleted) {
      blockers.push({ code: 'FINAL_CONFIRMATION_MISSING', message: '최종 확인 문구가 완료되지 않았습니다.' });
      requiredActions.push('최종 확인 modal에서 DRY RUN ONLY 문구를 입력하세요.');
    }
    if (!flags.transferEnabled || !flags.uploadEnabled) blockers.push({ code: 'FEATURE_FLAG_DISABLED', message: 'ROM transfer feature flag가 꺼져 있습니다.' });
    if (killSwitch.romTransferKillSwitch) blockers.push({ code: 'KILL_SWITCH_ACTIVE', message: killSwitch.reason });

    if (!plan?.backupPlan?.items.length) warnings.push({ code: 'NO_BACKUP_ITEMS', message: 'replaceLater 항목이 없다면 백업 항목이 0개일 수 있습니다.' });
    requiredActions.push('실제 전송 전 backup/temp/hash/retry/cancel 정책을 다시 확인하세요.');

    return {
      canSimulate: Boolean(plan),
      canPrepare: Boolean(plan) && blockers.every((blocker) => blocker.code === 'FEATURE_FLAG_DISABLED' || blocker.code === 'KILL_SWITCH_ACTIVE' || blocker.code === 'FINAL_CONFIRMATION_MISSING'),
      canExecute: false,
      blockers,
      warnings,
      requiredActions,
      featureFlags: flags,
      killSwitch,
    };
  }
}
