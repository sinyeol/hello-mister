export type ZaparooNfcWriteReadinessCode =
  | 'ACTIVE_MISTER_REQUIRED'
  | 'ZAPAROO_API_DISCONNECTED'
  | 'NFC_READER_MISSING'
  | 'PAYLOAD_INVALID'
  | 'READY';

export interface ZaparooNfcWriteReadinessInput {
  hasActiveMister: boolean;
  zaparooApiConnected: boolean;
  readerCount: number;
  payloadValid: boolean;
  payloadWarnings?: string[];
}

export interface ZaparooNfcWriteReadiness {
  canWrite: boolean;
  code: ZaparooNfcWriteReadinessCode;
  message: string;
}

export function getZaparooNfcWriteReadiness(input: ZaparooNfcWriteReadinessInput): ZaparooNfcWriteReadiness {
  if (!input.hasActiveMister) {
    return {
      canWrite: false,
      code: 'ACTIVE_MISTER_REQUIRED',
      message: 'MiSTer 연결 메뉴에서 먼저 연결하세요.',
    };
  }

  if (!input.zaparooApiConnected) {
    return {
      canWrite: false,
      code: 'ZAPAROO_API_DISCONNECTED',
      message: 'Zaparoo API에 연결되지 않았습니다.',
    };
  }

  if (input.readerCount <= 0) {
    return {
      canWrite: false,
      code: 'NFC_READER_MISSING',
      message: 'NFC 리더가 연결되지 않았습니다.',
    };
  }

  if (!input.payloadValid) {
    return {
      canWrite: false,
      code: 'PAYLOAD_INVALID',
      message: input.payloadWarnings?.length
        ? `NFC에 쓸 실행 경로가 올바르지 않습니다. ${input.payloadWarnings.join(' ')}`
        : 'NFC에 쓸 실행 경로가 올바르지 않습니다.',
    };
  }

  return {
    canWrite: true,
    code: 'READY',
    message: 'NFC 리더 연결됨',
  };
}
