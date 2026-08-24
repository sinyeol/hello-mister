export interface ParsedZaparooSseEvent {
  event?: string;
  data?: unknown;
  raw: string;
}

export interface ZaparooNfcReadReadinessInput {
  hasActiveMister: boolean;
  zaparooApiConnected: boolean;
  readerCount: number;
}

export interface ZaparooNfcReadReadiness {
  canRead: boolean;
  code: 'ACTIVE_MISTER_REQUIRED' | 'ZAPAROO_API_DISCONNECTED' | 'NFC_READER_MISSING' | 'READY';
  message: string;
}

export interface ZaparooNfcTokenComparison {
  status: 'tagDetected' | 'verified' | 'mismatch' | 'error';
  message: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function parseZaparooSseEventBlock(block: string): ParsedZaparooSseEvent {
  const eventLines: string[] = [];
  const dataLines: string[] = [];
  for (const rawLine of String(block || '').replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) eventLines.push(line.slice('event:'.length).trim());
    if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trimStart());
  }
  const rawData = dataLines.join('\n');
  let data: unknown = rawData;
  if (rawData) {
    try {
      data = JSON.parse(rawData);
    } catch {
      data = rawData;
    }
  }
  return { event: eventLines[0], data, raw: String(block || '') };
}

export function isZaparooTokensAddedEvent(event: ParsedZaparooSseEvent | unknown): boolean {
  const parsed = asRecord(event);
  const data = asRecord(parsed?.data) ?? parsed;
  const eventName = firstString(
    parsed?.event,
    data?.event,
    data?.type,
    data?.method,
    asRecord(data?.params)?.event,
    asRecord(data?.params)?.type,
  );
  return eventName === 'tokens.added';
}

export function extractZaparooTokenText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractZaparooTokenText(item);
      if (found) return found;
    }
    return undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;

  const direct = firstString(record.text, record.payload, record.value, record.zapScript, record.zapscript);
  if (direct) return direct;

  for (const key of ['params', 'result', 'token', 'tag', 'data', 'tokens', 'history', 'item', 'last']) {
    const found = extractZaparooTokenText(record[key]);
    if (found) return found;
  }

  return undefined;
}

export function normalizeZaparooNfcText(text: string) {
  return String(text || '').replace(/\r\n/g, '\n').trim();
}

export function compareZaparooNfcTokenText(readText?: string, expectedText?: string): ZaparooNfcTokenComparison {
  const read = normalizeZaparooNfcText(readText || '');
  const expected = normalizeZaparooNfcText(expectedText || '');
  if (!read) return { status: 'error', message: '읽은 NFC 데이터가 비어 있습니다.' };
  if (!expected) return { status: 'tagDetected', message: '태그를 감지했습니다. 비교할 현재 payload가 없어 읽은 내용만 표시합니다.' };
  if (read === expected) return { status: 'verified', message: '기록된 NFC 데이터가 현재 payload와 일치합니다.' };
  return { status: 'mismatch', message: '태그에 다른 데이터가 기록되어 있습니다.' };
}

export function getZaparooNfcReadReadiness(input: ZaparooNfcReadReadinessInput): ZaparooNfcReadReadiness {
  if (!input.hasActiveMister) {
    return { canRead: false, code: 'ACTIVE_MISTER_REQUIRED', message: 'MiSTer 연결 메뉴에서 먼저 연결하세요.' };
  }
  if (!input.zaparooApiConnected) {
    return { canRead: false, code: 'ZAPAROO_API_DISCONNECTED', message: 'Zaparoo API에 연결되지 않았습니다.' };
  }
  if (input.readerCount <= 0) {
    return { canRead: false, code: 'NFC_READER_MISSING', message: 'NFC 리더가 연결되지 않았습니다.' };
  }
  return { canRead: true, code: 'READY', message: 'NFC 태그 읽기 준비 완료' };
}

export function formatZaparooNfcReadStatus(status: string, code?: string) {
  if (status === 'idle') return '태그 읽기 대기 전';
  if (status === 'waitingForTag') return '태그를 리더에서 뗐다가 다시 올려주세요.';
  if (status === 'tagDetected') return '태그를 감지했습니다.';
  if (status === 'verified') return '기록된 NFC 데이터가 현재 payload와 일치합니다.';
  if (status === 'mismatch' || code === 'NFC_VERIFY_MISMATCH') return '태그에 다른 데이터가 기록되어 있습니다.';
  if (status === 'timeout' || code === 'NFC_READ_TIMEOUT') return '태그를 감지하지 못했습니다. 태그를 뗐다가 다시 올려주세요.';
  if (status === 'cancelled' || code === 'NFC_READ_CANCELLED') return '읽기를 취소했습니다.';
  if (code === 'NFC_TOKEN_TEXT_MISSING') return '태그를 감지했지만 읽을 텍스트를 찾지 못했습니다.';
  return '읽기 중 오류가 발생했습니다.';
}
