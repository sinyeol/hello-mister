import type { RomTransferFeatureFlags, RomTransferKillSwitchState, RomTransferLockReason } from '../../types/rom';

export const defaultRomTransferFeatureFlags: RomTransferFeatureFlags = {
  transferEnabled: false,
  uploadEnabled: false,
  mkdirEnabled: false,
  overwriteEnabled: false,
  deleteEnabled: false,
  renameEnabled: false,
};

export function getDefaultRomTransferKillSwitch(): RomTransferKillSwitchState {
  return {
    romTransferKillSwitch: true,
    reason: '실제 ROM 전송은 backup/temp/hash/retry/cancel 정책 검증 전까지 전역 kill switch로 잠겨 있습니다.',
    updatedAt: new Date().toISOString(),
  };
}

export class RomTransferFeatureFlagService {
  getFlags(): RomTransferFeatureFlags {
    return { ...defaultRomTransferFeatureFlags };
  }

  getKillSwitch(): RomTransferKillSwitchState {
    return getDefaultRomTransferKillSwitch();
  }

  getLockReasons(flags = this.getFlags(), killSwitch = this.getKillSwitch()): RomTransferLockReason[] {
    const reasons: RomTransferLockReason[] = [];
    if (killSwitch.romTransferKillSwitch) {
      reasons.push({ code: 'KILL_SWITCH_ACTIVE', message: killSwitch.reason });
    }
    if (!flags.transferEnabled) reasons.push({ code: 'FEATURE_FLAG_DISABLED', message: 'transferEnabled feature flag가 꺼져 있습니다.' });
    if (!flags.uploadEnabled) reasons.push({ code: 'FEATURE_FLAG_DISABLED', message: 'uploadEnabled feature flag가 꺼져 있습니다.' });
    reasons.push({ code: 'WRITE_IPC_NOT_EXPOSED', message: 'preload/main에 ROM write IPC가 노출되어 있지 않습니다.' });
    reasons.push({ code: 'ROM_TRANSFER_DISABLED', message: '이번 단계는 simulated transfer만 허용합니다.' });
    return reasons;
  }
}
