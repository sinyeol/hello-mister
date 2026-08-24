export type MisterConnectionMethod = 'ssh' | 'sftp' | 'smb' | 'http' | 'ftp';

export type MisterConnectionStatus = '후보' | '저장됨' | '검색됨' | '인증 필요' | 'MiSTer 확인됨' | '연결됨' | '실패' | 'dry-run';

export interface NetworkInterfaceInfo {
  id: string;
  name: string;
  address: string;
  netmask: string;
  family: 'IPv4';
  cidr: string;
  subnetBase: string;
  subnetLabel: string;
  candidateCount: number;
  privateRange: boolean;
  virtual: boolean;
  skipped?: boolean;
  skipReason?: string;
}

export interface MisterDiscoveryOptions {
  interfaceId?: string;
  ports: number[];
  timeoutMs: number;
  concurrency: number;
  includeHttp: boolean;
}

export interface PortProbeResult {
  ipAddress: string;
  port: number;
  open: boolean;
  latencyMs?: number;
  error?: string;
}

export interface MisterFingerprint {
  mediaFatExists: boolean;
  gamesPathExists: boolean;
  scriptsPathExists: boolean;
  misterIniExists: boolean;
  hostname?: string;
  macAddress?: string;
  sdCid?: string;
  checkedAt: string;
}

export type MisterPasswordMode = 'defaultMisterPassword' | 'promptEachRun' | 'customSessionOnly' | 'savedSafeStorage';
export type MisterPasswordStorageStatus = 'not-requested' | 'stored' | 'unavailable' | 'missing';

export interface MisterDeviceProfile {
  id: string;
  alias?: string;
  hostname?: string;
  ipAddress: string;
  macAddress?: string;
  // SD card CID (unique per physical microSD) — preferred over MAC for telling devices apart.
  sdCid?: string;
  methods: MisterConnectionMethod[];
  status: MisterConnectionStatus;
  lastSeenAt?: string;
  fingerprint?: MisterFingerprint;
  defaultDevice?: boolean;
  port?: number;
  username?: string;
  passwordMode?: MisterPasswordMode;
  passwordSaved?: boolean;
  passwordStorageStatus?: MisterPasswordStorageStatus;
  autoConnect?: boolean;
  isDefault?: boolean;
  lastConnectedAt?: string;
  lastFailedAt?: string;
  lastErrorCode?: RemoteErrorCode;
  hostKeyStatus?: SshHostKeyTrustStatus;
  readOnlySummary?: string;
}

export interface MisterDiscoveryCandidate {
  id: string;
  ipAddress: string;
  hostname?: string;
  hostnameSource?: 'dns' | 'netbios';
  openPorts: number[];
  methods: MisterConnectionMethod[];
  confidence: '낮음' | '보통' | '높음';
  fingerprint?: MisterFingerprint;
  source: '저장된 프로필' | '서브넷 검색' | '수동 입력' | 'mock';
  status: MisterConnectionStatus;
  probeResults?: PortProbeResult[];
  savedProfileId?: string;
  scannedAt?: string;
}

export interface MisterConnectionCredentials {
  username: string;
  password?: string;
  privateKeyPath?: string;
  port: number;
}

export interface MisterConnectionAttempt {
  candidateId: string;
  dryRun: boolean;
  credentials?: MisterConnectionCredentials;
}

export interface MisterConnectionResult {
  ok: boolean;
  status: MisterConnectionStatus;
  message: string;
  fingerprint?: MisterFingerprint;
  logs: string[];
}

export interface MisterDiscoveryReport {
  interfaces: NetworkInterfaceInfo[];
  selectedInterface?: NetworkInterfaceInfo;
  candidates: MisterDiscoveryCandidate[];
  scannedHostCount: number;
  scannedPortCount: number;
  startedAt: string;
  finishedAt: string;
  logs: string[];
  fallback?: boolean;
}

export interface MisterProfileStore {
  loadProfiles(): Promise<MisterDeviceProfile[]>;
  saveProfile(profile: MisterDeviceProfile): Promise<MisterDeviceProfile[]>;
  setDefaultProfile(profileId: string): Promise<MisterDeviceProfile[]>;
  deleteProfile(profileId: string, options?: { removeKnownHost?: boolean }): Promise<MisterDeviceProfile[]>;
}

export interface SshCredentialInput {
  profileId?: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface SshSessionState {
  sessionId: string;
  host: string;
  port: number;
  username: string;
  createdAt: string;
  lastUsedAt: string;
  hasPassword: boolean;
  hasPrivateKey: boolean;
}

export interface SafeCommandResult {
  action: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface MisterRemotePathStatus {
  path: string;
  exists: boolean;
  type: 'file' | 'directory' | 'missing' | 'unknown';
  label: string;
}

export interface MisterRemoteStorageStatus {
  mountPath: string;
  sizeKb?: number;
  usedKb?: number;
  availableKb?: number;
  usePercent?: number;
  raw?: string;
}

export interface MisterRemoteFingerprint {
  ok: boolean;
  sessionId?: string;
  host: string;
  ipAddress: string;
  hostname?: string;
  macAddress?: string;
  sdCid?: string;
  checkedAt: string;
  latencyMs: number;
  pathStatuses: MisterRemotePathStatus[];
  storage?: MisterRemoteStorageStatus;
  osInfo?: string;
  kernelInfo?: string;
  remoteTime?: string;
  message: string;
  error?: RemoteErrorInfo;
  hostKey?: SshHostKeyCheckResult;
  commands: SafeCommandResult[];
}

export interface MisterRemoteIniSnapshot {
  ok: boolean;
  sessionId?: string;
  path: string;
  content: string;
  readAt: string;
  sizeBytes: number;
  message: string;
  error?: RemoteErrorInfo;
}

export interface MisterRemoteGameFolder {
  name: string;
  path: string;
  fileCount?: number;
  sizeBytes?: number;
  modifiedAt?: string;
}

export interface MisterRemoteScriptFile {
  name: string;
  path: string;
  sizeBytes?: number;
  modifiedAt?: string;
  contentPreview?: string;
}

export interface RemoteReadResult<T> {
  ok: boolean;
  sessionId?: string;
  items: T;
  readAt: string;
  message: string;
  error?: string;
  errorCode?: RemoteErrorCode;
}

export interface DiagnosticPackage {
  appVersion: string;
  createdAt: string;
  profile?: Pick<MisterDeviceProfile, 'id' | 'alias' | 'ipAddress' | 'hostname' | 'macAddress' | 'methods' | 'lastSeenAt'>;
  fingerprint?: MisterRemoteFingerprint;
  games?: MisterRemoteGameFolder[];
  scripts?: MisterRemoteScriptFile[];
  misterIniExists?: boolean;
  hostKeyTrust?: SshHostKeyCheckResult;
  hostKeyHistory?: SshKnownHostHistoryEntry[];
  remoteErrorCode?: RemoteErrorCode;
  taskLogSummary?: string[];
  errors: string[];
}

export type RemoteErrorCode =
  | 'NETWORK_TIMEOUT'
  | 'CONNECTION_REFUSED'
  | 'HOST_KEY_UNTRUSTED'
  | 'HOST_KEY_MISMATCH'
  | 'AUTH_FAILED'
  | 'SSH_NEGOTIATION_FAILED'
  | 'SFTP_UNAVAILABLE'
  | 'REMOTE_PATH_MISSING'
  | 'NOT_MISTER'
  | 'READ_PERMISSION_DENIED'
  | 'COMMAND_BLOCKED'
  | 'UNKNOWN_REMOTE_ERROR';

export interface RemoteErrorInfo {
  code: RemoteErrorCode;
  message: string;
  detail?: string;
}

export type SshHostKeyTrustStatus = 'unchecked' | 'new' | 'trusted' | 'mismatch' | 'trusted-now' | 'removed';

export interface SshKnownHostEntry {
  id: string;
  host: string;
  port: number;
  fingerprint: string;
  keyType: string;
  firstSeen: string;
  lastSeen: string;
  profileId?: string;
  alias?: string;
}

export type SshKnownHostHistoryAction = 'detected' | 'trusted' | 'removed' | 'replaced';

export interface SshKnownHostHistoryEntry {
  id: string;
  host: string;
  port: number;
  oldFingerprint?: string;
  newFingerprint?: string;
  oldKeyType?: string;
  newKeyType?: string;
  detectedAt: string;
  profileId?: string;
  alias?: string;
  reason?: string;
  action: SshKnownHostHistoryAction;
}

export interface SshHostKeyCheckResult {
  ok: boolean;
  status: SshHostKeyTrustStatus;
  host: string;
  port: number;
  fingerprint?: string;
  keyType?: string;
  knownHost?: SshKnownHostEntry;
  history?: SshKnownHostHistoryEntry[];
  message: string;
  error?: RemoteErrorInfo;
}

export type MisterProfileReadStatus = 'unknown' | 'success' | 'partial' | 'failed' | 'blocked' | 'needs-auth';

export interface MisterProfileSummary {
  profileId: string;
  alias?: string;
  host: string;
  port: number;
  hostname?: string;
  mac?: string;
  lastSeen?: string;
  lastSuccessfulReadAt?: string;
  lastFailedReadAt?: string;
  lastErrorCode?: RemoteErrorCode;
  lastErrorMessageSanitized?: string;
  hostKeyTrustStatus?: SshHostKeyTrustStatus;
  fingerprintSummary?: string;
  mediaFatStatus?: boolean;
  gamesFolderStatus?: boolean;
  scriptsFolderStatus?: boolean;
  misterIniStatus?: boolean;
  downloaderIniStatus?: boolean;
  storageSummary?: string;
  gameFolderCount?: number;
  scriptCount?: number;
  readOnlyTestStatus?: MisterProfileReadStatus;
  readOnlyTestDurationMs?: number;
  updatedAt: string;
}

export interface ActiveMisterProfile {
  profileId: string;
  alias?: string;
  hostname?: string;
  ipAddress: string;
  port: number;
  username: string;
  connectedAt: string;
  sessionId?: string;
  hostKeyStatus?: SshHostKeyTrustStatus;
  readOnlySummary?: string;
  mediaFatOk: boolean;
  gamesOk: boolean;
  misterIniOk: boolean;
  lastErrorCode?: RemoteErrorCode;
  // Hardware MAC of the connected device, so the active connection is identified by the physical
  // MiSTer rather than its (DHCP-reusable) IP. Stays empty when the device reports no usable MAC.
  macAddress?: string;
  // SD card CID (unique per physical microSD, even cloned ones) — the preferred device identifier.
  sdCid?: string;
  // Set when the live device's MAC does not match the saved profile for this IP (the IP was reused
  // by a different MiSTer). The sidebar surfaces this so a cloned-SD device is not silently shown
  // under the previous device's alias.
  identityWarning?: string;
}

export interface RemoteErrorGuide {
  code: RemoteErrorCode;
  description: string;
  recommendedAction: string;
}

export type ReadOnlyIntegrationStepStatus = '대기' | '진행 중' | '성공' | '실패' | '건너뜀' | '차단됨';

export interface ReadOnlyIntegrationTestStep {
  id: string;
  label: string;
  status: ReadOnlyIntegrationStepStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  message: string;
  sanitizedMessage?: string;
  resultSummary?: string;
  errorCode?: RemoteErrorCode;
}

export interface ReadOnlyIntegrationTestSummary {
  status: MisterProfileReadStatus;
  successfulSteps: number;
  failedSteps: number;
  blockedSteps: number;
  durationMs: number;
  lastErrorCode?: RemoteErrorCode;
  message: string;
}

export interface ReadOnlyIntegrationTestResult {
  ok: boolean;
  partial: boolean;
  summary: ReadOnlyIntegrationTestSummary;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  steps: ReadOnlyIntegrationTestStep[];
  fingerprint?: MisterRemoteFingerprint;
  games?: MisterRemoteGameFolder[];
  scripts?: MisterRemoteScriptFile[];
  iniPreview?: MisterRemoteIniSnapshot;
  diagnosticPackage?: DiagnosticPackage;
  message: string;
}
