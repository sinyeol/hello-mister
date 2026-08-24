import type {
  RomCopyPlan,
  RomSimulatedTransferFailureMode,
  RomSimulatedTransferSession,
  RomSimulatedTransferStep,
} from '../../types/rom';
import { normalizePlannedAction } from './romPolicyService';

function now() {
  return new Date().toISOString();
}

export class RomSimulatedTransferService {
  createSession(plan: RomCopyPlan, failureMode: RomSimulatedTransferFailureMode = 'none'): RomSimulatedTransferSession {
    const copyItems = plan.perFilePlan.filter((item) => normalizePlannedAction(item.action) === 'copyLater' || normalizePlannedAction(item.action) === 'replaceLater');
    const totalBytes = copyItems.reduce((sum, item) => sum + item.sizeBytes, 0);
    const steps: RomSimulatedTransferStep[] = [
      { id: 'preflight', label: 'preflight guard 확인', status: 'success', progressPercent: 100, message: '시뮬레이션용 preflight만 통과 처리합니다.' },
      ...copyItems.map((item, index): RomSimulatedTransferStep => ({
        id: `simulate-${index}-${item.candidateId}`,
        label: '파일 전송 시뮬레이션',
        fileName: item.fileName,
        status: 'waiting',
        progressPercent: 0,
        message: '원격 파일 변경 없이 진행률만 계산합니다.',
      })),
      { id: 'summary', label: 'simulation summary', status: 'waiting', progressPercent: 0, message: '원격 쓰기 없음.' },
    ];
    return {
      sessionId: `rom-transfer-sim-${Date.now()}`,
      createdAt: now(),
      updatedAt: now(),
      status: 'idle',
      failureMode,
      dryRun: true,
      readOnly: true,
      remoteWritesPerformed: false,
      label: '시뮬레이션',
      planId: plan.planId,
      targetAlias: plan.targetAlias,
      targetHost: plan.targetHost,
      progress: {
        processedFiles: 0,
        totalFiles: copyItems.length,
        processedBytes: 0,
        totalBytes,
        percent: 0,
      },
      steps,
      logs: ['시뮬레이션 세션을 만들었습니다. SFTP upload/mkdir/rename/delete는 호출하지 않습니다.'],
      message: '전송 시뮬레이션 준비 완료',
    };
  }

  runToCompletion(session: RomSimulatedTransferSession): RomSimulatedTransferSession {
    if (session.failureMode === 'user-cancel') return this.cancel(session);
    const failed = session.failureMode !== 'none';
    const steps = session.steps.map((step, index) => {
      if (step.id === 'preflight') return step;
      if (step.id === 'summary') {
        return {
          ...step,
          status: failed ? 'failed' as const : 'success' as const,
          progressPercent: 100,
          message: failed ? `실패 시나리오가 적용되었습니다: ${session.failureMode}` : 'simulation complete: 원격 파일 변경 없음',
        };
      }
      const shouldFail = failed && index === Math.max(1, Math.floor(session.steps.length / 2));
      return {
        ...step,
        status: shouldFail ? 'failed' as const : 'success' as const,
        progressPercent: shouldFail ? 50 : 100,
        message: shouldFail ? this.formatFailureMode(session.failureMode) : '시뮬레이션 성공: 실제 복사 아님',
      };
    });
    const processedFiles = steps.filter((step) => step.fileName && step.status === 'success').length;
    const percent = failed ? 50 : 100;
    return {
      ...session,
      updatedAt: now(),
      status: failed ? 'failed' : 'completed',
      steps,
      progress: {
        ...session.progress,
        processedFiles,
        processedBytes: failed ? Math.floor(session.progress.totalBytes / 2) : session.progress.totalBytes,
        percent,
        currentFileName: steps.find((step) => step.status === 'failed')?.fileName,
      },
      logs: [
        ...session.logs,
        failed ? `실패 시뮬레이션: ${this.formatFailureMode(session.failureMode)}` : 'simulation complete: remoteWritesPerformed=false',
      ],
      message: failed ? '시뮬레이션 실패 상태를 표시했습니다. 원격 파일 변경은 없습니다.' : '시뮬레이션 완료. 원격 파일 변경은 없습니다.',
    };
  }

  cancel(session: RomSimulatedTransferSession): RomSimulatedTransferSession {
    return {
      ...session,
      updatedAt: now(),
      status: 'cancelled',
      steps: session.steps.map((step) => step.status === 'waiting' || step.status === 'running' ? { ...step, status: 'cancelled', message: '사용자 취소 시뮬레이션' } : step),
      logs: [...session.logs, 'user cancel simulation: 원격 cleanup은 구현하지 않았고 호출하지 않았습니다.'],
      message: '전송 시뮬레이션을 취소했습니다. 원격 파일 변경은 없습니다.',
    };
  }

  formatFailureMode(mode: RomSimulatedTransferFailureMode) {
    const labels: Record<RomSimulatedTransferFailureMode, string> = {
      none: '실패 없음',
      'network-timeout': '네트워크 timeout 시뮬레이션',
      'verify-failed': 'size/hash verify 실패 시뮬레이션',
      'storage-changed': '원격 저장공간 변경 시뮬레이션',
      'user-cancel': '사용자 취소 시뮬레이션',
    };
    return labels[mode];
  }
}
