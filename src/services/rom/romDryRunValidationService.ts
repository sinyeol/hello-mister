import type {
  RomCopyPlan,
  RomDryRunValidationSession,
  RomDryRunValidationStep,
  RomDryRunValidationSummary,
} from '../../types/rom';

function now() {
  return new Date().toISOString();
}

function finishStep(
  step: RomDryRunValidationStep,
  status: RomDryRunValidationStep['status'],
  resultSummary?: string,
  errorCode?: RomDryRunValidationStep['errorCode'],
  sanitizedMessage?: string,
): RomDryRunValidationStep {
  const finishedAt = now();
  const startedAt = step.startedAt || finishedAt;
  return {
    ...step,
    status,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime()),
    resultSummary,
    errorCode,
    sanitizedMessage,
  };
}

const baseSteps: Array<Pick<RomDryRunValidationStep, 'id' | 'label'>> = [
  { id: 'default-profile', label: '기본 MiSTer 프로필 확인' },
  { id: 'session-credential', label: 'session-only 인증 확인' },
  { id: 'host-key-trust', label: 'SSH host key 신뢰 확인' },
  { id: 'remote-games-snapshot', label: '원격 /media/fat/games snapshot' },
  { id: 'remote-storage', label: '원격 저장공간 조회' },
  { id: 'local-rom-scan', label: '로컬 ROM 후보 스캔' },
  { id: 'platform-recommendation', label: '플랫폼 추천' },
  { id: 'target-folder-matching', label: '대상 폴더 매칭' },
  { id: 'remote-file-metadata', label: '원격 대상 파일 metadata 비교' },
  { id: 'conflict-policy', label: '충돌 정책 적용' },
  { id: 'backup-dry-run', label: '백업 계획 dry-run' },
  { id: 'copy-plan-dry-run', label: '최종 복사 계획 dry-run' },
  { id: 'plan-save-export', label: '계획 저장/내보내기 준비' },
];

export class RomDryRunValidationService {
  createSession(input: {
    targetProfileId?: string;
    targetAlias?: string;
    targetHost?: string;
    hasDefaultProfile: boolean;
    hasSessionCredential: boolean;
    hostKeyTrusted: boolean;
    hostKeyMismatch?: boolean;
    remoteGamesRead?: boolean;
    remoteStorageRead?: boolean;
    localFileCount: number;
    plan?: RomCopyPlan;
    savedOrExportReady?: boolean;
  }): RomDryRunValidationSession {
    const createdAt = now();
    const steps: RomDryRunValidationStep[] = baseSteps.map((step) => ({ ...step, status: 'waiting' }));

    const set = (
      id: RomDryRunValidationStep['id'],
      status: RomDryRunValidationStep['status'],
      summary?: string,
      errorCode?: RomDryRunValidationStep['errorCode'],
      message?: string,
    ) => {
      const index = steps.findIndex((step) => step.id === id);
      if (index >= 0) steps[index] = finishStep({ ...steps[index], startedAt: createdAt }, status, summary, errorCode, message);
    };

    set('default-profile', input.hasDefaultProfile ? 'success' : 'blocked', input.hasDefaultProfile ? '기본 프로필 확인됨' : '기본 프로필 없음', input.hasDefaultProfile ? undefined : 'NO_DEFAULT_PROFILE');
    set('session-credential', input.hasSessionCredential ? 'success' : 'blocked', input.hasSessionCredential ? 'session-only 인증 있음' : '인증 필요', input.hasSessionCredential ? undefined : 'NO_SESSION_CREDENTIAL');

    if (input.hostKeyMismatch) {
      set('host-key-trust', 'blocked', 'host key mismatch로 원격 읽기 차단', 'HOST_KEY_MISMATCH');
    } else {
      set('host-key-trust', input.hostKeyTrusted ? 'success' : 'blocked', input.hostKeyTrusted ? '신뢰된 host key' : 'host key 신뢰 필요', input.hostKeyTrusted ? undefined : 'HOST_KEY_NOT_TRUSTED');
    }

    const remoteAllowed = input.hasDefaultProfile && input.hasSessionCredential && input.hostKeyTrusted && !input.hostKeyMismatch;
    set('remote-games-snapshot', remoteAllowed ? (input.remoteGamesRead ? 'success' : 'skipped') : 'blocked', remoteAllowed ? (input.remoteGamesRead ? 'games 폴더 snapshot 확인됨' : '아직 원격 snapshot 없음') : '원격 단계 차단', remoteAllowed ? undefined : 'HOST_KEY_NOT_TRUSTED');
    set('remote-storage', remoteAllowed ? (input.remoteStorageRead ? 'success' : 'skipped') : 'blocked', remoteAllowed ? (input.remoteStorageRead ? '저장공간 확인됨' : '아직 저장공간 snapshot 없음') : '원격 단계 차단', remoteAllowed ? undefined : 'HOST_KEY_NOT_TRUSTED');

    set('local-rom-scan', input.localFileCount > 0 ? 'success' : 'skipped', input.localFileCount > 0 ? `${input.localFileCount}개 로컬 ROM 후보` : '로컬 ROM 후보 없음', input.localFileCount > 0 ? undefined : 'LOCAL_SCAN_EMPTY');
    set('platform-recommendation', input.localFileCount > 0 ? 'success' : 'skipped', input.localFileCount > 0 ? '확장자/키워드/override 기반 추천 가능' : '추천할 후보 없음');
    set('target-folder-matching', input.localFileCount > 0 ? 'success' : 'skipped', input.remoteGamesRead ? '원격 games 폴더와 비교 가능' : '원격 snapshot 없이 로컬 추천만 표시');
    set('remote-file-metadata', remoteAllowed ? (input.remoteGamesRead ? 'success' : 'skipped') : 'blocked', remoteAllowed ? '1단계 파일 metadata 비교만 허용' : '원격 metadata 단계 차단');
    set('conflict-policy', input.plan ? 'success' : 'skipped', input.plan ? `${input.plan.perFilePlan.length}개 파일 정책 계산됨` : '복사 계획 생성 전');
    set('backup-dry-run', input.plan?.backupPlan ? 'success' : input.plan ? 'skipped' : 'skipped', input.plan?.backupPlan ? `${input.plan.backupPlan.items.length}개 백업 계획` : 'replaceLater 백업 계획 없음');
    set('copy-plan-dry-run', input.plan ? (input.plan.validation?.blockers.length ? 'blocked' : 'success') : 'skipped', input.plan ? `blocker ${input.plan.validation?.blockers.length || 0}개` : '복사 계획 없음', input.plan?.validation?.blockers.length ? 'PLAN_BLOCKED' : undefined);
    set('plan-save-export', input.savedOrExportReady ? 'success' : input.plan ? 'skipped' : 'skipped', input.savedOrExportReady ? '저장/내보내기 가능' : '계획 저장 전');

    const summary = this.summarize(steps);
    return {
      sessionId: `rom-dry-run-validation-${Date.now()}`,
      createdAt,
      updatedAt: now(),
      targetProfileId: input.targetProfileId,
      targetAlias: input.targetAlias,
      targetHost: input.targetHost,
      dryRun: true,
      readOnly: true,
      steps,
      summary,
    };
  }

  summarize(steps: RomDryRunValidationStep[]): RomDryRunValidationSummary {
    const successCount = steps.filter((step) => step.status === 'success').length;
    const blockedCount = steps.filter((step) => step.status === 'blocked').length;
    const failedCount = steps.filter((step) => step.status === 'failed').length;
    const skippedCount = steps.filter((step) => step.status === 'skipped').length;
    const durationMs = steps.reduce((sum, step) => sum + (step.durationMs || 0), 0);
    const codes = steps.map((step) => step.errorCode).filter(Boolean);
    let status: RomDryRunValidationSummary['status'] = 'success';
    if (codes.includes('NO_SESSION_CREDENTIAL')) status = 'auth-required';
    else if (codes.includes('HOST_KEY_MISMATCH') || codes.includes('HOST_KEY_NOT_TRUSTED')) status = 'host-key-blocked';
    else if (blockedCount) status = 'blocked';
    else if (failedCount) status = 'remote-read-failed';
    else if (skippedCount) status = 'partial-success';
    return {
      status,
      totalSteps: steps.length,
      successCount,
      blockedCount,
      failedCount,
      skippedCount,
      durationMs,
      message: `ROM dry-run 검증: 성공 ${successCount}, 차단 ${blockedCount}, 실패 ${failedCount}, 건너뜀 ${skippedCount}`,
    };
  }
}
