import type { LocalRomCandidate, RomStorageDryRun } from '../../types/rom';
import type { MisterRemoteStorageStatus } from '../../types/mister';

const oneGiB = 1024 * 1024 * 1024;

function kbToBytes(value?: number) {
  return typeof value === 'number' ? value * 1024 : undefined;
}

export class RomStorageCheckService {
  inspect(candidates: LocalRomCandidate[], remoteStorage?: MisterRemoteStorageStatus): RomStorageDryRun {
    const totalSizeBytes = candidates
      .filter((candidate) => candidate.recommendation?.targetFolderExists && !candidate.recommendation.needsManualPlatform)
      .reduce((sum, candidate) => sum + candidate.sizeBytes, 0);
    const remoteFreeBytes = kbToBytes(remoteStorage?.availableKb);
    const remoteSizeBytes = kbToBytes(remoteStorage?.sizeKb);
    const safetyReserveBytes = Math.max(oneGiB, Math.floor((remoteSizeBytes || 0) * 0.05));
    const requiredFreeBytes = totalSizeBytes + safetyReserveBytes;
    if (typeof remoteFreeBytes !== 'number') {
      return {
        ok: false,
        status: 'unknown',
        requirement: { totalSizeBytes, safetyReserveBytes, requiredFreeBytes },
        warnings: [{ code: 'not-checked', message: '원격 저장공간을 확인하지 못했습니다.' }],
        message: '저장공간 확인 실패: fingerprint 또는 df 결과가 필요합니다.',
      };
    }
    if (remoteFreeBytes < totalSizeBytes) {
      return {
        ok: false,
        status: 'insufficient',
        requirement: { totalSizeBytes, safetyReserveBytes, requiredFreeBytes },
        remoteFreeBytes,
        remoteSizeBytes,
        warnings: [{ code: 'insufficient-space', message: '선택한 파일 총량보다 남은 공간이 적습니다.' }],
        message: '원격 저장공간이 부족합니다.',
      };
    }
    if (remoteFreeBytes < requiredFreeBytes) {
      return {
        ok: true,
        status: 'warning',
        requirement: { totalSizeBytes, safetyReserveBytes, requiredFreeBytes },
        remoteFreeBytes,
        remoteSizeBytes,
        warnings: [{ code: 'low-headroom', message: '복사 후 안전 여유 공간이 부족할 수 있습니다.' }],
        message: '복사는 가능해 보이지만 여유 공간 경고가 있습니다.',
      };
    }
    return {
      ok: true,
      status: 'sufficient',
      requirement: { totalSizeBytes, safetyReserveBytes, requiredFreeBytes },
      remoteFreeBytes,
      remoteSizeBytes,
      warnings: [],
      message: '저장공간 dry-run 결과가 충분합니다.',
    };
  }
}
