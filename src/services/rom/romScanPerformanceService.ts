import type {
  LocalRomScanCancellation,
  LocalRomScanPerformanceWarning,
  LocalRomScanProgress,
  RomHashProgress,
} from '../../types/rom';

const warningThreshold = 500;
const strongWarningThreshold = 2000;
const blockedThreshold = 10000;

function now() {
  return new Date().toISOString();
}

function elapsedMs(startedAt: string) {
  return Math.max(0, Date.now() - new Date(startedAt).getTime());
}

export class RomScanPerformanceService {
  getPerformanceWarnings(fileCount: number, explicitAllowLargeScan = false): LocalRomScanPerformanceWarning[] {
    const warnings: LocalRomScanPerformanceWarning[] = [];
    if (fileCount >= warningThreshold) {
      warnings.push({
        level: 'warning',
        threshold: warningThreshold,
        fileCount,
        message: '500개 이상의 ROM 후보가 감지되었습니다. dry-run 검사는 가능하지만 시간이 오래 걸릴 수 있습니다.',
        requiresExplicitAllow: false,
      });
    }
    if (fileCount >= strongWarningThreshold) {
      warnings.push({
        level: 'strong-warning',
        threshold: strongWarningThreshold,
        fileCount,
        message: '2000개 이상의 대량 ROM 세트입니다. 원격 비교와 충돌 검사는 단계별로 나누는 것을 권장합니다.',
        requiresExplicitAllow: false,
      });
    }
    if (fileCount >= blockedThreshold) {
      warnings.push({
        level: explicitAllowLargeScan ? 'strong-warning' : 'blocked',
        threshold: blockedThreshold,
        fileCount,
        message: explicitAllowLargeScan
          ? '10000개 이상의 초대량 스캔이 명시적으로 허용되었습니다. 자동 hash 계산은 계속 비활성화됩니다.'
          : '10000개 이상의 스캔은 기본 차단됩니다. 사용자가 명시적으로 허용해야 진행할 수 있습니다.',
        requiresExplicitAllow: !explicitAllowLargeScan,
      });
    }
    return warnings;
  }

  isRecursiveScanAllowed(recursive: boolean, userOptedIn: boolean) {
    return !recursive || userOptedIn;
  }

  createScanProgress(input: {
    totalEstimatedFiles?: number;
    currentFileName?: string;
    processedFiles?: number;
    explicitAllowLargeScan?: boolean;
  }): LocalRomScanProgress {
    const startedAt = now();
    return {
      status: 'running',
      totalEstimatedFiles: input.totalEstimatedFiles,
      processedFiles: input.processedFiles || 0,
      currentFileName: input.currentFileName,
      startedAt,
      updatedAt: startedAt,
      elapsedMs: 0,
      warnings: this.getPerformanceWarnings(input.totalEstimatedFiles || 0, input.explicitAllowLargeScan),
    };
  }

  updateScanProgress(progress: LocalRomScanProgress, processedFiles: number, currentFileName?: string): LocalRomScanProgress {
    const updatedAt = now();
    return {
      ...progress,
      status: progress.status === 'cancel-requested' ? 'cancel-requested' : 'running',
      processedFiles,
      currentFileName,
      updatedAt,
      elapsedMs: elapsedMs(progress.startedAt),
    };
  }

  completeScanProgress(progress: LocalRomScanProgress, totalFiles: number): LocalRomScanProgress {
    const updatedAt = now();
    return {
      ...progress,
      status: 'complete',
      totalEstimatedFiles: totalFiles,
      processedFiles: totalFiles,
      currentFileName: undefined,
      updatedAt,
      elapsedMs: elapsedMs(progress.startedAt),
      warnings: this.getPerformanceWarnings(totalFiles),
    };
  }

  requestCancellation(keepPartialResults = true): LocalRomScanCancellation {
    return {
      requested: true,
      requestedAt: now(),
      keepPartialResults,
      message: keepPartialResults
        ? '취소 요청됨: 이미 읽은 ROM 후보는 유지합니다.'
        : '취소 요청됨: 부분 결과를 버리도록 표시했습니다.',
    };
  }

  cancelScanProgress(progress: LocalRomScanProgress, keepPartialResults = true): LocalRomScanProgress {
    const updatedAt = now();
    return {
      ...progress,
      status: 'cancelled',
      updatedAt,
      elapsedMs: elapsedMs(progress.startedAt),
      currentFileName: keepPartialResults ? progress.currentFileName : undefined,
    };
  }

  createHashProgress(fileId: string, fileName: string, totalBytes?: number): RomHashProgress {
    const startedAt = now();
    return {
      status: 'running',
      fileId,
      fileName,
      processedBytes: 0,
      totalBytes,
      startedAt,
      updatedAt: startedAt,
      elapsedMs: 0,
      message: 'SHA-256 계산을 수동으로 시작했습니다. 대량 hash 자동 계산은 비활성화되어 있습니다.',
    };
  }

  finishHashProgress(progress: RomHashProgress, status: 'complete' | 'failed' | 'cancelled', message: string): RomHashProgress {
    const updatedAt = now();
    return {
      ...progress,
      status,
      processedBytes: status === 'complete' ? progress.totalBytes || progress.processedBytes : progress.processedBytes,
      updatedAt,
      elapsedMs: progress.startedAt ? elapsedMs(progress.startedAt) : progress.elapsedMs,
      message,
    };
  }
}
