import type {
  RomTransferDesignPhase,
  RomTransferFailureScenario,
  RomTransferImplementationPrerequisite,
  RomTransferRollbackLimit,
} from '../../types/rom';

export const romTransferDesignPhases: RomTransferDesignPhase[] = [
  {
    id: 'prepare',
    label: 'prepare',
    description: '프로필, session-only 인증, host key 신뢰, 저장공간, 충돌 정책, 백업 정책을 최종 검증한다.',
    writeOperationRequired: false,
    implemented: false,
  },
  {
    id: 'optional-backup',
    label: 'optional backup',
    description: 'replace 예정 원격 파일을 먼저 백업하는 단계다. 실제 다운로드/쓰기 정책 확정 전까지 구현하지 않는다.',
    writeOperationRequired: true,
    implemented: false,
  },
  {
    id: 'optional-mkdir',
    label: 'optional mkdir',
    description: '대상 core 폴더가 없을 때 생성하는 단계다. 현재는 dry-run 계획만 허용한다.',
    writeOperationRequired: true,
    implemented: false,
  },
  {
    id: 'upload-temp-file',
    label: 'upload temp file',
    description: '최종 경로가 아닌 임시 파일명으로 업로드하고 중단/검증 실패에 대비한다.',
    writeOperationRequired: true,
    implemented: false,
  },
  {
    id: 'verify-size-hash',
    label: 'verify size/hash',
    description: '업로드 후 크기와 선택적 hash를 비교한다. 대용량 hash는 사용자가 명시적으로 선택해야 한다.',
    writeOperationRequired: false,
    implemented: false,
  },
  {
    id: 'finalize-rename',
    label: 'finalize rename',
    description: '검증된 임시 파일을 최종 파일명으로 바꾸는 단계다. 원격 rename 정책 확정 전까지 비활성화한다.',
    writeOperationRequired: true,
    implemented: false,
  },
  {
    id: 'cleanup-temp',
    label: 'cleanup temp',
    description: '실패 또는 취소 후 임시 파일을 정리하는 단계다. 정리 실패 시 사용자에게 남은 파일 경로를 알려야 한다.',
    writeOperationRequired: true,
    implemented: false,
  },
  {
    id: 'record-log',
    label: 'record log',
    description: '작업 로그와 진단 패키지에 결과를 남기되 credential과 raw command는 제외한다.',
    writeOperationRequired: false,
    implemented: false,
  },
];

export const romTransferFailureScenarios: RomTransferFailureScenario[] = [
  {
    code: 'NETWORK_DISCONNECTED',
    label: '네트워크 끊김',
    mitigation: '임시 파일이 남을 수 있으므로 다음 연결 시 temp 파일 점검 단계가 필요하다.',
  },
  {
    code: 'AUTH_EXPIRED',
    label: '인증 만료',
    mitigation: 'session-only 인증을 다시 입력하도록 안내하고 중간 상태를 작업 로그에 남긴다.',
  },
  {
    code: 'REMOTE_SPACE_EXHAUSTED',
    label: '저장공간 부족',
    mitigation: '업로드 시작 전 여유 공간을 재확인하고, 실패 시 임시 파일 정리 가능성을 표시한다.',
  },
  {
    code: 'REMOTE_FILE_EXISTS',
    label: '원격 파일 존재',
    mitigation: 'replace 정책과 백업 계획이 없으면 실행을 차단한다.',
  },
  {
    code: 'UPLOAD_INTERRUPTED',
    label: 'upload 중단',
    mitigation: '부분 업로드된 temp 파일을 표시하고 자동 삭제는 별도 확인 후에만 허용해야 한다.',
  },
  {
    code: 'VERIFY_FAILED',
    label: '검증 실패',
    mitigation: 'size/hash mismatch를 기록하고 finalize rename을 실행하지 않는다.',
  },
  {
    code: 'TEMP_CLEANUP_FAILED',
    label: 'temp file cleanup 실패',
    mitigation: '남은 temp 파일 경로를 진단 패키지와 UI에 표시한다.',
  },
];

export const romTransferRollbackLimits: RomTransferRollbackLimit[] = [
  {
    code: 'REMOTE_WRITE_NOT_ATOMIC',
    description: '원격에 이미 쓰인 파일은 네트워크 상태에 따라 완전 자동 rollback이 어려울 수 있다.',
  },
  {
    code: 'OVERWRITE_WITHOUT_BACKUP_UNRECOVERABLE',
    description: '기존 파일을 백업 없이 overwrite하면 복구할 수 없으므로 replace는 백업 계획 없이는 차단해야 한다.',
  },
  {
    code: 'TEMP_FILES_CAN_REMAIN',
    description: '업로드 중단 또는 정리 실패 시 원격에 temp 파일이 남을 수 있다.',
  },
  {
    code: 'REMOTE_MKDIR_REQUIRES_POLICY',
    description: '폴더 생성은 경로 검증과 사용자 확인 없이 실행하면 안 된다.',
  },
];

export const romTransferImplementationPrerequisites: RomTransferImplementationPrerequisite[] = [
  { id: 'backup-policy', label: '백업 정책 확정', required: true },
  { id: 'temp-filename-policy', label: '임시 파일명 정책 확정', required: true },
  { id: 'size-hash-verify-policy', label: 'size/hash 검증 정책 확정', required: true },
  { id: 'retry-policy', label: '재시도/중단 정책 확정', required: true },
  { id: 'confirmation-phrase', label: '사용자 최종 확인 문구 확정', required: true },
  { id: 'cancellation-ux', label: '작업 중단 UX 확정', required: true },
];
