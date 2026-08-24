import type { RomCopyPlan, RomTransferPreparationResult } from '../../types/rom';
import { validateRomPlan } from './romPolicyService';
import { RomTransferFeatureFlagService } from './romTransferFeatureFlags';
import { RomTransferPreflightService } from './romTransferPreflightService';

export class RomTransferService {
  private featureFlags = new RomTransferFeatureFlagService();
  private preflightService = new RomTransferPreflightService();

  prepareTransfer(input: {
    plan: RomCopyPlan;
    hasSessionCredential: boolean;
    hostKeyTrusted: boolean;
    hostKeyMismatch?: boolean;
    finalConfirmationCompleted?: boolean;
  }): RomTransferPreparationResult {
    const validation = input.plan.validation || validateRomPlan(input.plan);
    const preflight = this.preflightService.inspect({
      plan: input.plan,
      hasTargetProfile: Boolean(input.plan.targetProfileId),
      hasSessionCredential: input.hasSessionCredential,
      hostKeyTrusted: input.hostKeyTrusted,
      hostKeyMismatch: input.hostKeyMismatch,
      finalConfirmationCompleted: input.finalConfirmationCompleted,
      featureFlags: this.featureFlags.getFlags(),
      killSwitch: this.featureFlags.getKillSwitch(),
    });
    const blockers = [
      ...validation.blockers,
      ...preflight.blockers.map((blocker) => ({
        code: blocker.code === 'KILL_SWITCH_ACTIVE' || blocker.code === 'FEATURE_FLAG_DISABLED' ? 'TRANSFER_DISABLED' as const : 'MANUAL_DECISION_REQUIRED' as const,
        message: blocker.message,
        candidateId: blocker.candidateId,
      })),
      {
        code: 'TRANSFER_DISABLED' as const,
        message: 'ROM 실제 복사는 이번 단계에서 비활성화되어 있습니다.',
      },
    ];

    return {
      ok: false,
      dryRun: true,
      readOnly: true,
      guard: {
        ok: false,
        blockers,
        message: '전송 guard는 계획을 평가하지만 실제 전송 adapter는 비활성입니다.',
      },
      preflight,
      disabledError: {
        code: preflight.killSwitch.romTransferKillSwitch ? 'ROM_TRANSFER_LOCKED' : 'ROM_TRANSFER_DISABLED',
        message: preflight.killSwitch.romTransferKillSwitch
          ? 'ROM_TRANSFER_LOCKED: feature flag와 kill switch로 실제 쓰기 기능이 전역 차단되어 있습니다.'
          : 'ROM_TRANSFER_DISABLED: 실제 ROM 복사는 다음 단계에서 별도 adapter와 rollback 설계 후 검토합니다.',
      },
      message: 'transfer 준비는 dry-run으로만 수행했습니다. 원격 쓰기는 호출하지 않습니다.',
    };
  }

  executeTransfer(): RomTransferPreparationResult {
    const preflight = this.preflightService.inspect({
      hasTargetProfile: false,
      hasSessionCredential: false,
      hostKeyTrusted: false,
      finalConfirmationCompleted: false,
      featureFlags: this.featureFlags.getFlags(),
      killSwitch: this.featureFlags.getKillSwitch(),
    });
    return {
      ok: false,
      dryRun: true,
      readOnly: true,
      guard: {
        ok: false,
        blockers: [{ code: 'TRANSFER_DISABLED', message: 'executeTransfer는 ROM_TRANSFER_DISABLED / ROM_TRANSFER_LOCKED 상태입니다.' }],
        message: '실제 ROM 복사는 비활성입니다.',
      },
      preflight,
      disabledError: {
        code: 'ROM_TRANSFER_LOCKED',
        message: 'ROM_TRANSFER_DISABLED / ROM_TRANSFER_LOCKED: 원격 쓰기 계열 기능은 구현하지 않았습니다.',
      },
      message: 'ROM_TRANSFER_DISABLED',
    };
  }
}
