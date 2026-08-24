import type { RomTransferSafetyPolicy } from '../../types/rom';

export const romTransferSafetyPolicy: RomTransferSafetyPolicy = {
  backup: {
    mode: 'local-first',
    requireBackupForReplace: true,
    remoteBackupDesignedOnly: true,
  },
  tempFile: {
    uploadToTemporaryName: true,
    suffix: '.__hello-mister-uploading',
    finalizeAfterVerify: true,
    implemented: false,
    message: '실제 전송 시 최종 파일명으로 바로 업로드하지 않고 임시 파일명으로 업로드한 뒤 검증 후 finalize해야 합니다. 이번 단계에서는 temp 파일을 만들지 않습니다.',
  },
  verify: {
    defaultMode: 'size-only',
    optionalSha256: true,
    requireExplicitHashForLargeFiles: true,
    hashMissingLabel: 'size-only verify',
  },
  retry: {
    maxNetworkTimeoutRetries: 2,
    retryableErrors: ['NETWORK_TIMEOUT'],
    nonRetryableErrors: ['AUTH_FAILED', 'HOST_KEY_MISMATCH', 'INSUFFICIENT_SPACE', 'VERIFY_FAILED'],
  },
  cancel: {
    simulatedCancelOnly: true,
    remoteCleanupImplemented: false,
    tempFilesMayRemain: true,
    message: '이번 단계의 취소는 시뮬레이션 상태만 취소합니다. 실제 원격 temp cleanup은 구현하지 않습니다.',
  },
  rollbackLimitations: [
    {
      code: 'BACKUP_REQUIRED_FOR_REPLACE',
      message: 'replaceLater는 백업 계획 없이는 진행할 수 없습니다. 백업 실패 시 복사를 진행하지 않습니다.',
    },
    {
      code: 'TEMP_FILE_CAN_REMAIN',
      message: '업로드 중 취소 또는 네트워크 끊김이 발생하면 원격 temp 파일이 남을 수 있습니다.',
    },
    {
      code: 'FINALIZED_FILE_LIMITED_ROLLBACK',
      message: '이미 finalize된 파일은 자동 rollback이 제한적이며 사용자가 수동 확인해야 할 수 있습니다.',
    },
    {
      code: 'OVERWRITE_WITHOUT_BACKUP_UNRECOVERABLE',
      message: 'overwrite 전 백업이 없으면 기존 파일을 복구할 수 없습니다.',
    },
  ],
};

export function formatRetryPolicy() {
  return `재시도 가능: ${romTransferSafetyPolicy.retry.retryableErrors.join(', ')} / 재시도 금지: ${romTransferSafetyPolicy.retry.nonRetryableErrors.join(', ')}`;
}

export function formatTempFilePolicy(fileName = 'filename.ext') {
  return `${fileName}${romTransferSafetyPolicy.tempFile.suffix}`;
}
