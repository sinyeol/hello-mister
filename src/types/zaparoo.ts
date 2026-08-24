export interface ZaparooApiTarget {
  host: string;
  port?: number;
  endpoint?: string;
}

export interface ZaparooRpcPayload {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params?: unknown;
}

export interface ZaparooRpcError {
  code?: number | string;
  message: string;
  data?: unknown;
}

export interface ZaparooApiResult<T = unknown> {
  ok: boolean;
  target?: ZaparooApiTarget;
  endpoint?: string;
  method?: string;
  result?: T;
  message: string;
  error?: ZaparooRpcError;
  checkedAt?: string;
}

export interface ZaparooStatusResult extends ZaparooApiResult {
  version?: unknown;
  health?: unknown;
  readers?: ZaparooReader[];
  platform?: string;
}

export interface ZaparooMediaItem {
  id?: string;
  name?: string;
  title?: string;
  system?: string;
  systemId?: string;
  path?: string;
  zapScript?: string;
  tags?: string[];
  raw?: unknown;
}

export interface ZaparooMediaSearchResult extends ZaparooApiResult {
  items: ZaparooMediaItem[];
}

export interface ZaparooMediaBrowseResult extends ZaparooApiResult {
  items: ZaparooMediaItem[];
}

export interface ZaparooMediaLookupResult extends ZaparooApiResult {
  item?: ZaparooMediaItem;
  items: ZaparooMediaItem[];
}

export interface ZaparooRunResult extends ZaparooApiResult {
  fallbackUsed?: boolean;
  zapScript?: string;
  diagnostics?: ZaparooRunDiagnostics;
}

export type ZaparooRunFailureCode =
  | 'API_OFFLINE'
  | 'API_ENDPOINT_FAILED'
  | 'RUN_METHOD_FAILED'
  | 'RUN_ENDPOINT_FAILED'
  | 'ALLOW_RUN_MISSING'
  | 'ALLOW_RUN_BLOCKED'
  | 'ALLOWED_IPS_BLOCKED'
  | 'LAUNCH_PATH_MISSING'
  | 'MEDIA_NOT_MATCHED'
  | 'UNKNOWN_ZAPAROO_ERROR';

export interface ZaparooConfigArrayStatus {
  present: boolean;
  values: string[];
  count: number;
  empty: boolean;
  parseError?: string;
}

export interface ZaparooConfigDiagnostics {
  ok: boolean;
  status: 'not-checked' | 'found' | 'missing' | 'read-failed' | 'parse-failed';
  path: string;
  serviceFound: boolean;
  allowRun: ZaparooConfigArrayStatus;
  allowedIps: ZaparooConfigArrayStatus;
  allowedIpsLimited?: boolean;
  localIpCandidates?: string[];
  allowedIpMatch?: 'not-checked' | 'unrestricted' | 'matched' | 'not-matched' | 'unknown';
  guidance?: string[];
  message: string;
  checkedAt: string;
  rawPreview?: string;
  error?: ZaparooRpcError;
}

export type ZaparooAllowedIpsRecommendationMode = 'single-ip' | 'subnet-24' | 'open';

export interface ZaparooConfigRecommendation {
  mode: ZaparooAllowedIpsRecommendationMode;
  apiPort: number;
  apiListen: string;
  allowedIps: string[];
  allowRun: string[];
  localIp?: string;
  subnet?: string;
  notes: string[];
}

export interface ZaparooConfigPatchChange {
  key: 'api_port' | 'api_listen' | 'allowed_ips' | 'allow_run' | '[service]';
  action: 'add' | 'update' | 'unchanged';
  before?: string;
  after: string;
}

export interface ZaparooConfigPatchPlan {
  ok: boolean;
  path: string;
  recommendation: ZaparooConfigRecommendation;
  changes: ZaparooConfigPatchChange[];
  diffPreview: string;
  nextPreview: string;
  changed: boolean;
  backupFileName: string;
  remoteBackupPath: string;
  localBackupRelativePath: string;
  safetyMessages: string[];
  message: string;
}

export interface ZaparooConfigApplyResult {
  ok: boolean;
  path: string;
  plan?: ZaparooConfigPatchPlan;
  localBackupPath?: string;
  remoteBackupPath?: string;
  remoteBackupOk: boolean;
  localBackupOk: boolean;
  applied: boolean;
  reloadAttempted: boolean;
  reloadOk: boolean;
  reloadMessage?: string;
  verification?: ZaparooConfigDiagnostics;
  requiresLocalBackupOnlyConfirmation?: boolean;
  message: string;
  error?: ZaparooRpcError;
}

export interface ZaparooRunDiagnostics {
  code: ZaparooRunFailureCode;
  userMessage: string;
  config?: ZaparooConfigDiagnostics;
  methodResult?: ZaparooApiResult;
  fallbackResult?: ZaparooApiResult;
}

export interface ZaparooReader {
  id?: string;
  name?: string;
  type?: string;
  connected?: boolean;
  raw?: unknown;
}

export interface ZaparooReadersResult extends ZaparooApiResult {
  readers: ZaparooReader[];
}

export interface ZaparooReaderWriteResult extends ZaparooApiResult {
  text?: string;
}

export type ZaparooNfcReadStatus =
  | 'idle'
  | 'waitingForTag'
  | 'tagDetected'
  | 'verified'
  | 'mismatch'
  | 'timeout'
  | 'error'
  | 'cancelled';

export type ZaparooNfcReadErrorCode =
  | 'ZAPAROO_EVENTS_UNAVAILABLE'
  | 'ZAPAROO_TOKENS_UNAVAILABLE'
  | 'NFC_READ_TIMEOUT'
  | 'NFC_READER_NOT_FOUND'
  | 'NFC_PAYLOAD_EMPTY'
  | 'NFC_TOKEN_TEXT_MISSING'
  | 'NFC_READ_CANCELLED'
  | 'NFC_VERIFY_MISMATCH'
  | 'UNKNOWN_NFC_READ_ERROR';

export interface ZaparooTokenReadRequest {
  target?: ZaparooApiTarget;
  timeoutMs?: number;
  requestId?: string;
}

export interface ZaparooTokenReadResult extends ZaparooApiResult {
  status: ZaparooNfcReadStatus;
  code?: ZaparooNfcReadErrorCode;
  text?: string;
  rawEventPreview?: string;
  timeoutMs?: number;
  fallbackUsed?: 'tokens' | 'tokens.history';
  requestId?: string;
}
