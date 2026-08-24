import type { RomTransferPreflightBlocker, RomTransferPreflightWarning } from '../../types/rom';

export const romTransferPolicyMessages = {
  backup: {
    title: 'Backup policy',
    risk: '주의',
    body: [
      '덮어쓰기 예정 파일은 백업 계획 없이는 진행할 수 없습니다.',
      '이번 버전에서는 실제 백업도 실행하지 않습니다.',
      '백업 계획만 생성합니다.',
    ],
  },
  tempFile: {
    title: 'Temp file policy',
    risk: '위험',
    body: [
      '미래 실제 전송에서는 최종 파일명으로 바로 업로드하지 않고 임시 파일명으로 업로드한 뒤 검증 후 전환합니다.',
      '현재 버전에서는 임시 파일도 생성하지 않습니다.',
    ],
  },
  verify: {
    title: 'Verify policy',
    risk: '안전',
    body: [
      '기본 검증은 파일 크기 기준입니다.',
      'SHA-256 검증은 사용자가 직접 선택한 경우에만 수행합니다.',
      '대용량 파일의 해시 계산은 오래 걸릴 수 있습니다.',
    ],
  },
  retry: {
    title: 'Retry policy',
    risk: '주의',
    body: [
      '네트워크 timeout은 제한적 재시도 후보입니다.',
      '인증 실패, host key mismatch, 저장공간 부족은 자동 재시도하지 않습니다.',
    ],
  },
  cancel: {
    title: 'Cancel policy',
    risk: '위험',
    body: [
      '실제 업로드 중 취소하면 임시 파일이 남을 수 있습니다.',
      '현재는 시뮬레이션 취소만 지원합니다.',
    ],
  },
  rollback: {
    title: 'Rollback limitation',
    risk: '위험',
    body: [
      '백업 없이 덮어쓴 파일은 복구할 수 없습니다.',
      '네트워크 중단 시 부분 파일이나 임시 파일이 남을 수 있습니다.',
      '자동 rollback은 제한적입니다.',
    ],
  },
} as const;

export function formatPreflightBlocker(blocker: RomTransferPreflightBlocker) {
  const messages: Record<RomTransferPreflightBlocker['code'], string> = {
    NO_PLAN: 'ROM 복사 계획이 없습니다. 먼저 dry-run 계획을 생성하세요.',
    SCHEMA_VERSION_UNSUPPORTED: '계획 schema version이 현재 앱과 맞지 않습니다.',
    NO_TARGET_PROFILE: '대상 MiSTer 프로필이 없습니다.',
    NO_SESSION_CREDENTIAL: 'session-only 인증이 필요합니다. 인증 정보는 저장하지 않습니다.',
    HOST_KEY_NOT_TRUSTED: 'SSH host key가 아직 신뢰되지 않았습니다.',
    HOST_KEY_MISMATCH: 'SSH host key가 저장된 값과 다릅니다. 실제 전송은 차단됩니다.',
    STORAGE_NOT_OK: '저장공간 dry-run이 통과하지 않았습니다.',
    BLOCKED_ITEMS: '차단된 ROM 계획 항목이 남아 있습니다.',
    NEEDS_USER_DECISION: '사용자 결정이 필요한 항목이 남아 있습니다.',
    MISSING_BACKUP_PLAN: 'replaceLater 항목에 필요한 백업 계획이 없습니다.',
    TARGET_FOLDER_UNRESOLVED: '대상 폴더 없음 항목의 처리 정책이 확정되지 않았습니다.',
    AMBIGUOUS_PLATFORM: '플랫폼이 모호한 ROM 항목이 남아 있습니다.',
    DANGEROUS_EXTENSION_UNRESOLVED: '위험 확장자 항목을 수동으로 처리해야 합니다.',
    FINAL_CONFIRMATION_MISSING: '최종 확인 문구가 입력되지 않았습니다.',
    FEATURE_FLAG_DISABLED: '실제 전송 feature flag가 꺼져 있습니다.',
    KILL_SWITCH_ACTIVE: '전역 kill switch가 켜져 있어 실제 전송이 잠겨 있습니다.',
  };
  return messages[blocker.code] || blocker.message;
}

export function formatPreflightWarning(warning: RomTransferPreflightWarning) {
  return `${warning.code}: ${warning.message}`;
}
