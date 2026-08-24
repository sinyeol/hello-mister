import type { RemoteErrorCode } from './mister';

export type RomHashStatus = 'not-calculated' | 'calculating' | 'complete' | 'failed';

export type LocalRomScanProgressStatus = 'idle' | 'counting' | 'running' | 'cancel-requested' | 'cancelled' | 'complete' | 'failed';

export interface LocalRomScanProgress {
  status: LocalRomScanProgressStatus;
  totalEstimatedFiles?: number;
  processedFiles: number;
  currentFileName?: string;
  startedAt: string;
  updatedAt: string;
  elapsedMs: number;
  warnings: LocalRomScanPerformanceWarning[];
}

export interface LocalRomScanCancellation {
  requested: boolean;
  requestedAt?: string;
  keepPartialResults: boolean;
  message: string;
}

export type LocalRomScanPerformanceWarningLevel = 'notice' | 'warning' | 'strong-warning' | 'blocked';

export interface LocalRomScanPerformanceWarning {
  level: LocalRomScanPerformanceWarningLevel;
  threshold: number;
  fileCount: number;
  message: string;
  requiresExplicitAllow: boolean;
}

export interface RomHashProgress {
  status: 'idle' | 'running' | 'cancel-requested' | 'cancelled' | 'complete' | 'failed';
  fileId?: string;
  fileName?: string;
  processedBytes: number;
  totalBytes?: number;
  startedAt?: string;
  updatedAt?: string;
  elapsedMs: number;
  message: string;
}

export interface LocalRomScanOptions {
  recursive: boolean;
  maxFiles: number;
}

export interface LocalRomMetadata {
  id: string;
  fileName: string;
  filePath: string;
  parentFolder: string;
  extension: string;
  sizeBytes: number;
  modifiedAt?: string;
  hashStatus: RomHashStatus;
  sha256?: string;
}

export interface LocalRomScanResult {
  ok: boolean;
  cancelled?: boolean;
  sourceType: 'files' | 'folder';
  rootPath?: string;
  items: LocalRomMetadata[];
  warnings: string[];
  message: string;
}

export interface RomPlatformGuess {
  platform: string;
  coreFolderNames: string[];
  confidence: RomTargetConfidence;
  reason: string;
  autoSelectable: boolean;
}

export interface RomPlatformCandidate {
  platform: string;
  label: string;
  extensions: string[];
  coreFolderNames: string[];
  ambiguous?: boolean;
}

export type RomTargetConfidence = 'high' | 'medium' | 'low' | 'needs-user';

export interface RomManualOverride {
  candidateId: string;
  platform: string;
}

export interface RomTargetRecommendation {
  platform?: string;
  targetFolder?: string;
  targetRemotePath?: string;
  confidence: RomTargetConfidence;
  reason: string;
  targetFolderExists: boolean;
  needsManualPlatform: boolean;
}

export interface LocalRomCandidate extends LocalRomMetadata {
  normalizedGameName: string;
  possibleCardTitle: string;
  possibleNfcLaunchPath?: string;
  misterLaunchPathCandidate?: string;
  platformGuesses: RomPlatformGuess[];
  manualPlatform?: string;
  recommendation?: RomTargetRecommendation;
  status: 'ready' | 'needs-platform' | 'target-missing' | 'unsupported' | 'blocked';
}

export type RomFileCandidate = LocalRomCandidate;

export interface RomTargetFolder {
  coreName: string;
  remotePath: string;
  existingFileCount?: number;
  availableBytes?: number;
}

export interface RemoteRomFileEntry {
  name: string;
  path: string;
  sizeBytes?: number;
  modifiedAt?: string;
}

export interface RemoteGameFolderSnapshot {
  ok: boolean;
  folder: RomTargetFolder;
  files: RemoteRomFileEntry[];
  readAt: string;
  message: string;
  errorCode?: RemoteErrorCode;
}

export type RomConflictType =
  | 'none'
  | 'sameNameSameSize'
  | 'sameNameDifferentSize'
  | 'targetFolderMissing'
  | 'ambiguousPlatform'
  | 'unsupportedExtension'
  | 'remoteReadFailed'
  | 'needsManualPlatform'
  | 'insufficientSpace';

export interface RomConflict {
  type: RomConflictType;
  severity: 'info' | 'warning' | 'blocker';
  message: string;
  candidateId?: string;
  targetPath?: string;
}

export interface RomConflictCheckResult {
  candidateId: string;
  conflictType: RomConflictType;
  severity: 'info' | 'warning' | 'blocker';
  message: string;
  remoteFile?: RemoteRomFileEntry;
}

export interface RomStorageRequirement {
  totalSizeBytes: number;
  safetyReserveBytes: number;
  requiredFreeBytes: number;
}

export interface RomStorageWarning {
  code: 'not-checked' | 'low-headroom' | 'insufficient-space';
  message: string;
}

export interface RomStorageDryRun {
  ok: boolean;
  status: 'sufficient' | 'warning' | 'insufficient' | 'unknown';
  requirement: RomStorageRequirement;
  remoteFreeBytes?: number;
  remoteSizeBytes?: number;
  warnings: RomStorageWarning[];
  message: string;
}

export type RomPlannedAction =
  | 'copyLater'
  | 'skip'
  | 'replaceLater'
  | 'renameLocalFileLater'
  | 'createFolderLater'
  | 'chooseDifferentFolder'
  | 'needsUserDecision'
  | 'block'
  | 'blocked';

export type RomPlanAction = RomPlannedAction;

export interface RomConflictResolutionPolicy {
  conflictType: RomConflictType;
  defaultAction: RomPlannedAction;
  allowedActions: RomPlannedAction[];
  description: string;
  requiresBackup?: boolean;
  requiresFolderPlan?: boolean;
}

export interface RomPlanBlockReason {
  code:
    | 'ACTION_BLOCKED'
    | 'MANUAL_DECISION_REQUIRED'
    | 'MISSING_TARGET_FOLDER'
    | 'INVALID_FOLDER_NAME'
    | 'MISSING_BACKUP_PLAN'
    | 'INSUFFICIENT_SPACE'
    | 'TRANSFER_DISABLED';
  message: string;
  candidateId?: string;
  fileName?: string;
}

export interface RomPlanValidationResult {
  ok: boolean;
  canProceedLater: boolean;
  blockers: RomPlanBlockReason[];
  risks: RomFinalConfirmationRisk[];
  warnings: string[];
}

export interface RemoteFolderNameValidationResult {
  ok: boolean;
  folderName: string;
  normalizedName?: string;
  code?: 'EMPTY' | 'PATH_SEPARATOR' | 'PARENT_TRAVERSAL' | 'ABSOLUTE_PATH' | 'OUTSIDE_GAMES' | 'RESERVED';
  message: string;
}

export interface RemoteFolderCreationPlan {
  folderName: string;
  targetRemotePath: string;
  candidateIds: string[];
  validation: RemoteFolderNameValidationResult;
  dryRun: true;
  readOnly: true;
  status: 'planned' | 'invalid' | 'blocked';
  message: string;
}

export interface RemoteFolderPolicy {
  basePath: '/media/fat/games';
  allowCreateLater: boolean;
  plannedFolders: RemoteFolderCreationPlan[];
}

export interface RomBackupItem {
  candidateId: string;
  fileName: string;
  remotePath: string;
  sizeBytes?: number;
  backupTargetLocalPathPreview?: string;
  backupReason: string;
  requiredBeforeCopy: true;
}

export interface RomBackupPlan {
  planId: string;
  createdAt: string;
  backupRootLocalPath?: string;
  items: RomBackupItem[];
  totalSizeBytes: number;
  dryRun: true;
  readOnly: true;
  message: string;
}

export interface RomBackupPolicy {
  mode: 'local-first';
  requireBackupForReplace: boolean;
  remoteBackupDesignedOnly: boolean;
}

export interface RomBackupValidationResult {
  ok: boolean;
  blockers: RomPlanBlockReason[];
  message: string;
}

export interface RomFinalConfirmationRisk {
  code: string;
  message: string;
  severity: 'warning' | 'danger';
  candidateId?: string;
}

export interface RomFinalConfirmationBlocker {
  code: string;
  message: string;
  candidateId?: string;
}

export interface RomFinalConfirmationSummary {
  targetAlias?: string;
  targetHost?: string;
  targetBasePath: '/media/fat/games';
  copyFileCount: number;
  skipFileCount: number;
  conflictFileCount: number;
  replaceFileCount: number;
  folderCreationCount: number;
  backupRequiredFileCount: number;
  totalCopySizeBytes: number;
  remoteFreeBytes?: number;
  risks: RomFinalConfirmationRisk[];
  blockers: RomFinalConfirmationBlocker[];
  requiredPhrase: 'DRY RUN ONLY';
  transferEnabled: false;
}

export interface RomPlanSummary {
  totalFileCount: number;
  copyLaterCount: number;
  skipCount: number;
  replaceLaterCount: number;
  renameLaterCount: number;
  folderCreationCount: number;
  blockedCount: number;
  manualDecisionCount: number;
  totalSizeBytes: number;
  totalCopySizeBytes: number;
  remoteFreeBytes?: number;
  conflictCounts: Record<RomConflictType, number>;
  actionCounts: Record<RomPlannedAction, number>;
}

export type RomPlanFilterMode =
  | 'all'
  | 'ready'
  | 'conflict'
  | 'manual'
  | 'blocked'
  | 'targetFolderMissing'
  | 'unsupportedExtension'
  | 'replaceLater';

export type RomPlanSortMode = 'name' | 'size-desc' | 'size-asc' | 'platform' | 'action' | 'conflict';

export interface RomDryRunValidationStep {
  id:
    | 'default-profile'
    | 'session-credential'
    | 'host-key-trust'
    | 'remote-games-snapshot'
    | 'remote-storage'
    | 'local-rom-scan'
    | 'platform-recommendation'
    | 'target-folder-matching'
    | 'remote-file-metadata'
    | 'conflict-policy'
    | 'backup-dry-run'
    | 'copy-plan-dry-run'
    | 'plan-save-export';
  label: string;
  status: 'waiting' | 'running' | 'success' | 'failed' | 'skipped' | 'blocked';
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  errorCode?: RemoteErrorCode | 'NO_DEFAULT_PROFILE' | 'NO_SESSION_CREDENTIAL' | 'HOST_KEY_NOT_TRUSTED' | 'HOST_KEY_MISMATCH' | 'LOCAL_SCAN_EMPTY' | 'PLAN_BLOCKED';
  sanitizedMessage?: string;
  resultSummary?: string;
}

export interface RomDryRunValidationSummary {
  status: 'success' | 'partial-success' | 'blocked' | 'auth-required' | 'host-key-blocked' | 'remote-read-failed' | 'local-scan-failed';
  totalSteps: number;
  successCount: number;
  blockedCount: number;
  failedCount: number;
  skippedCount: number;
  durationMs: number;
  message: string;
}

export interface RomDryRunValidationSession {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  targetProfileId?: string;
  targetAlias?: string;
  targetHost?: string;
  dryRun: true;
  readOnly: true;
  steps: RomDryRunValidationStep[];
  summary: RomDryRunValidationSummary;
}

export interface RomDryRunValidationChecklist {
  ranOnRealMister: boolean;
  hostKeyTrusted: boolean;
  gamesSnapshotRead: boolean;
  storageDryRunCalculated: boolean;
  reviewedAllConflicts: boolean;
  resolvedManualPlatforms: boolean;
  backupPlanForReplace: boolean;
  reviewedFolderCreationPlan: boolean;
  exportedPlanJson: boolean;
  confirmedNoRealCopy: boolean;
}

export interface RomDryRunValidationRecord {
  validationSessionId: string;
  schemaVersion: 1;
  appVersion: string;
  createdAt: string;
  updatedAt: string;
  targetProfileId?: string;
  targetAlias?: string;
  targetHost?: string;
  hostKeyTrustStatus: 'unknown' | 'trusted' | 'untrusted' | 'mismatch';
  romCandidateCount: number;
  totalSizeBytes: number;
  platformResolvedCount: number;
  needsManualPlatformCount: number;
  conflictCount: number;
  blockedCount: number;
  targetFolderMissingCount: number;
  storageStatus: RomStorageDryRun['status'];
  dryRunResultStatus: RomDryRunValidationSummary['status'];
  durationMs: number;
  userNote?: string;
  checklist: RomDryRunValidationChecklist;
  sanitizedSummary: string;
  includesFullLocalPaths: false;
  dryRun: true;
  readOnly: true;
}

export interface RomDryRunValidationRecordStore {
  records: RomDryRunValidationRecord[];
  schemaVersion: 1;
  updatedAt: string;
}

export type RomDryRunValidationGrade = 'passed' | 'partial' | 'blocked' | 'needs-recheck' | 'not-eligible-for-transfer';

export type RomDryRunValidationFilter =
  | 'all'
  | 'passed'
  | 'partial'
  | 'blocked'
  | 'hostKeyIssue'
  | 'storageIssue'
  | 'needsManualPlatform'
  | 'hasConflict';

export type RomDryRunValidationSort = 'date-desc' | 'date-asc' | 'file-count' | 'total-size' | 'conflict-count' | 'blocked-count';

export interface RomDryRunValidationComparison {
  baseRecordId: string;
  currentRecordId: string;
  romCandidateDelta: number;
  conflictDelta: number;
  blockedDelta: number;
  totalSizeDeltaBytes: number;
  storageStatusChanged: boolean;
  targetProfileChanged: boolean;
  summary: string;
}

export type RomDryRunReportFormat = 'json' | 'markdown';

export interface RomDryRunReportExportOptions extends RomPlanExportOptions {
  format: RomDryRunReportFormat;
}

export interface RomDryRunReport {
  schemaVersion: 1;
  appVersion: string;
  generatedAt: string;
  reportType: 'rom-dry-run-validation';
  target: {
    alias?: string;
    host?: string;
    profileId?: string;
    hostKeyTrustStatus: RomDryRunValidationRecord['hostKeyTrustStatus'];
  };
  validation: {
    recordId: string;
    grade: RomDryRunValidationGrade;
    romCandidateCount: number;
    totalSizeBytes: number;
    platformResolvedCount: number;
    needsManualPlatformCount: number;
    conflictCount: number;
    blockedCount: number;
    targetFolderMissingCount: number;
    storageStatus: RomStorageDryRun['status'];
    checklist: RomDryRunValidationChecklist;
  };
  planSummary?: RomPlanSummary;
  backupSummary?: {
    requiredFileCount: number;
    totalSizeBytes: number;
    backupRootLocalPath?: string;
  };
  preflight?: RomTransferPreflightResult;
  rollbackLimitations: RomRollbackLimitation[];
  lockedReason: string;
  warning: string;
  includesFullLocalPaths: boolean;
}

export interface RomTransferDesignPhase {
  id: string;
  label: string;
  description: string;
  writeOperationRequired: boolean;
  implemented: false;
}

export interface RomTransferFailureScenario {
  code: string;
  label: string;
  mitigation: string;
}

export interface RomTransferRollbackLimit {
  code: string;
  description: string;
}

export interface RomTransferImplementationPrerequisite {
  id: string;
  label: string;
  required: true;
}

export interface RomTransferSafetyPolicy {
  backup: RomBackupPolicy;
  tempFile: RomTempFilePolicy;
  verify: RomVerifyPolicy;
  retry: RomRetryPolicy;
  cancel: RomCancelPolicy;
  rollbackLimitations: RomRollbackLimitation[];
}

export interface RomTempFilePolicy {
  uploadToTemporaryName: true;
  suffix: '.__hello-mister-uploading';
  finalizeAfterVerify: true;
  implemented: false;
  message: string;
}

export interface RomVerifyPolicy {
  defaultMode: 'size-only';
  optionalSha256: true;
  requireExplicitHashForLargeFiles: true;
  hashMissingLabel: 'size-only verify';
}

export interface RomRetryPolicy {
  maxNetworkTimeoutRetries: number;
  retryableErrors: Array<'NETWORK_TIMEOUT'>;
  nonRetryableErrors: Array<'AUTH_FAILED' | 'HOST_KEY_MISMATCH' | 'INSUFFICIENT_SPACE' | 'VERIFY_FAILED'>;
}

export interface RomCancelPolicy {
  simulatedCancelOnly: true;
  remoteCleanupImplemented: false;
  tempFilesMayRemain: true;
  message: string;
}

export interface RomRollbackLimitation {
  code: string;
  message: string;
}

export interface RomTransferFeatureFlags {
  transferEnabled: false;
  uploadEnabled: false;
  mkdirEnabled: false;
  overwriteEnabled: false;
  deleteEnabled: false;
  renameEnabled: false;
}

export interface RomTransferKillSwitchState {
  romTransferKillSwitch: true;
  reason: string;
  updatedAt: string;
}

export interface RomTransferLockReason {
  code: 'FEATURE_FLAG_DISABLED' | 'KILL_SWITCH_ACTIVE' | 'WRITE_IPC_NOT_EXPOSED' | 'ROM_TRANSFER_DISABLED';
  message: string;
}

export interface RomTransferPreflightBlocker {
  code:
    | 'NO_PLAN'
    | 'SCHEMA_VERSION_UNSUPPORTED'
    | 'NO_TARGET_PROFILE'
    | 'NO_SESSION_CREDENTIAL'
    | 'HOST_KEY_NOT_TRUSTED'
    | 'HOST_KEY_MISMATCH'
    | 'STORAGE_NOT_OK'
    | 'BLOCKED_ITEMS'
    | 'NEEDS_USER_DECISION'
    | 'MISSING_BACKUP_PLAN'
    | 'TARGET_FOLDER_UNRESOLVED'
    | 'AMBIGUOUS_PLATFORM'
    | 'DANGEROUS_EXTENSION_UNRESOLVED'
    | 'FINAL_CONFIRMATION_MISSING'
    | 'FEATURE_FLAG_DISABLED'
    | 'KILL_SWITCH_ACTIVE';
  message: string;
  candidateId?: string;
}

export interface RomTransferPreflightWarning {
  code: string;
  message: string;
}

export interface RomTransferPreflightResult {
  canSimulate: boolean;
  canPrepare: boolean;
  canExecute: false;
  blockers: RomTransferPreflightBlocker[];
  warnings: RomTransferPreflightWarning[];
  requiredActions: string[];
  featureFlags: RomTransferFeatureFlags;
  killSwitch: RomTransferKillSwitchState;
}

export type RomSimulatedTransferFailureMode = 'none' | 'network-timeout' | 'verify-failed' | 'storage-changed' | 'user-cancel';

export interface RomSimulatedTransferStep {
  id: string;
  label: string;
  fileName?: string;
  status: 'waiting' | 'running' | 'success' | 'failed' | 'cancelled' | 'skipped';
  progressPercent: number;
  message: string;
}

export interface RomSimulatedTransferProgress {
  processedFiles: number;
  totalFiles: number;
  processedBytes: number;
  totalBytes: number;
  percent: number;
  currentFileName?: string;
}

export interface RomSimulatedTransferSession {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
  failureMode: RomSimulatedTransferFailureMode;
  dryRun: true;
  readOnly: true;
  remoteWritesPerformed: false;
  label: '시뮬레이션';
  planId?: string;
  targetAlias?: string;
  targetHost?: string;
  progress: RomSimulatedTransferProgress;
  steps: RomSimulatedTransferStep[];
  logs: string[];
  message: string;
}

export interface RomSimulatedTransferRecord {
  simulationRecordId: string;
  schemaVersion: 1;
  appVersion: string;
  createdAt: string;
  updatedAt: string;
  targetAlias?: string;
  targetHost?: string;
  status: RomSimulatedTransferSession['status'];
  failureMode: RomSimulatedTransferFailureMode;
  simulatedFileCount: number;
  simulatedTotalBytes: number;
  completedSteps: number;
  failedSteps: number;
  cancelled: boolean;
  durationMs: number;
  message: string;
  remoteWritesPerformed: false;
  dryRun: true;
  readOnly: true;
  includesFullLocalPaths: false;
}

export interface RomSimulatedTransferReport {
  schemaVersion: 1;
  appVersion: string;
  generatedAt: string;
  reportType: 'rom-simulated-transfer';
  record: RomSimulatedTransferRecord;
  mandatoryNotice: string[];
  includesFullLocalPaths: boolean;
}

export interface RomSimulationExportOptions extends RomPlanExportOptions {
  format: RomDryRunReportFormat;
}

export type RomTransferReadinessStatus = 'unchecked' | 'passed' | 'failed' | 'not-applicable';

export interface RomTransferReadinessItem {
  id: string;
  label: string;
  status: RomTransferReadinessStatus;
  required: boolean;
  note?: string;
}

export interface RomTransferReadinessChecklist {
  schemaVersion: 1;
  appVersion: string;
  updatedAt: string;
  userNote?: string;
  items: RomTransferReadinessItem[];
  canConsiderRealTransfer: false;
  lockedMessage: string;
}

export interface RomTransferGuardResult {
  ok: boolean;
  blockers: RomPlanBlockReason[];
  message: string;
}

export interface RomTransferDisabledError {
  code: 'ROM_TRANSFER_DISABLED' | 'ROM_TRANSFER_LOCKED';
  message: string;
}

export interface RomTransferPreparationResult {
  ok: boolean;
  dryRun: true;
  readOnly: true;
  guard: RomTransferGuardResult;
  preflight?: RomTransferPreflightResult;
  disabledError: RomTransferDisabledError;
  message: string;
}

export interface RomPlanExportOptions {
  includeFullLocalPaths: boolean;
}

export interface SavedRomPlanMetadata {
  id: string;
  schemaVersion: 1;
  appVersion?: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  targetAlias?: string;
  targetHost?: string;
  fileCount: number;
  totalSizeBytes: number;
  remoteGamesSnapshotAt?: string;
  includesFullLocalPaths?: boolean;
  conflictSummary?: Record<string, number>;
  backupPlanSummary?: {
    itemCount: number;
    totalSizeBytes: number;
  };
  dryRun: true;
  readOnly: true;
}

export interface SavedRomPlan {
  metadata: SavedRomPlanMetadata;
  dryRunResult: RomDryRunResult;
  folderPolicy?: RemoteFolderPolicy;
  backupPlan?: RomBackupPlan;
  finalConfirmation?: RomFinalConfirmationSummary;
}

export interface RomPerFilePlan {
  candidateId: string;
  localPath: string;
  fileName: string;
  sizeBytes: number;
  recommendedPlatform?: string;
  targetFolder?: string;
  targetRemotePath?: string;
  conflictType: RomConflictType;
  action: RomPlannedAction;
  status: 'copy-ready' | 'manual-required' | 'conflict' | 'blocked';
  warning?: string;
  remoteExistingFile?: RemoteRomFileEntry;
  folderCreationRequired?: boolean;
  backupRequired?: boolean;
}

export interface RomCopyPlan {
  planId: string;
  createdAt: string;
  sourceFiles: LocalRomCandidate[];
  targetProfileId?: string;
  targetAlias?: string;
  targetHost?: string;
  targetBasePath: '/media/fat/games';
  perFilePlan: RomPerFilePlan[];
  totalSizeBytes: number;
  requiredFreeBytes: number;
  remoteFreeBytes?: number;
  canProceedLater: boolean;
  schemaVersion: 1;
  folderPolicy?: RemoteFolderPolicy;
  backupPlan?: RomBackupPlan;
  validation?: RomPlanValidationResult;
  dryRun: true;
  readOnly: true;
}

export interface RomDryRunResult {
  ok: boolean;
  dryRun: true;
  readOnly: true;
  plan: RomCopyPlan;
  conflicts: RomConflictCheckResult[];
  storage: RomStorageDryRun;
  message: string;
}

export type RomFsAllowedRoot = string;
export type RomFsEntryLocation = 'local' | 'mister';
export type RomFsEntryType = 'file' | 'directory' | 'unknown';
export type RomFsConflictPolicy = 'skip' | 'rename' | 'overwrite';

export interface RomFsEntry {
  id: string;
  name: string;
  path: string;
  parentPath?: string;
  location: RomFsEntryLocation;
  type: RomFsEntryType;
  sizeBytes: number;
  modifiedAt?: string;
  extension?: string;
  root?: RomFsAllowedRoot;
  profileId?: string;
}

export interface RomFsListRemoteRequest {
  profileId?: string;
  path?: string;
}

export interface RomFsListRemoteResult {
  ok: boolean;
  path?: string;
  profileId?: string;
  entries: RomFsEntry[];
  errorCode?: string;
  message: string;
}

export type RomFsCapabilityStatus =
  | 'not-connected'
  | 'checking'
  | 'readable'
  | 'read-write'
  | 'write-denied'
  | 'failed';

export interface RomFsCapabilityCheckRequest {
  profileId?: string;
  root?: string;
}

export interface RomFsCapabilityResult {
  ok: boolean;
  status: RomFsCapabilityStatus;
  canRead: boolean;
  canWrite: boolean;
  checkedAt: string;
  profileId?: string;
  readRoot?: string;
  writeRoot?: string;
  tempDirectory?: string;
  tempFileName?: string;
  cleanupWarning?: string;
  errorCode?: string;
  message: string;
  detail?: unknown;
}

export interface RomFsStatRemoteResult {
  ok: boolean;
  path?: string;
  entry?: RomFsEntry;
  errorCode?: string;
  message: string;
}

export interface RomFsListLocalFolderRequest {
  folderPath: string;
}

export interface RomFsListLocalFolderResult {
  ok: boolean;
  folderPath?: string;
  entries: RomFsEntry[];
  errorCode?: string;
  message: string;
}

export interface RomFsLocalTreeEntry {
  id: string;
  name: string;
  path: string;
  parentPath?: string;
  depth: number;
  hasChildren: boolean;
}

export interface RomFsLocalTreeRootsResult {
  ok: boolean;
  roots: RomFsLocalTreeEntry[];
  errorCode?: string;
  message: string;
}

export interface RomFsListLocalTreeFolderRequest {
  folderPath: string;
  depth?: number;
}

export interface RomFsListLocalTreeFolderResult {
  ok: boolean;
  folderPath?: string;
  children: RomFsLocalTreeEntry[];
  errorCode?: string;
  message: string;
}

export type RomFsOperationType =
  | 'localToMisterCopy'
  | 'misterToLocalCopy'
  | 'misterToMisterCopy'
  | 'moveRemote'
  | 'renameRemote'
  | 'trashRemote'
  | 'restoreRemote'
  | 'deleteRemote'
  | 'createFolderRemote'
  | 'createFolderLocal';

export type RomFsOperationStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'partial' | 'skipped';

export interface RomFsOperationResult {
  ok: boolean;
  operationType: RomFsOperationType;
  status: RomFsOperationStatus;
  startedAt: string;
  finishedAt: string;
  sourcePath?: string;
  targetPath?: string;
  fileCount: number;
  totalBytes: number;
  errorCode?: string;
  message: string;
  detail?: unknown;
}

export interface RomFsCopyLocalToMisterRequest {
  profileId?: string;
  localPath: string;
  targetFolderPath: string;
  targetFileName?: string;
  conflictPolicy?: RomFsConflictPolicy;
}

export interface RomFsCopyMisterToLocalRequest {
  profileId?: string;
  remotePath: string;
  localFolderPath: string;
  targetFileName?: string;
  conflictPolicy?: RomFsConflictPolicy;
}

export interface RomFsCopyMisterToMisterRequest {
  sourceProfileId?: string;
  targetProfileId?: string;
  sourceRemotePath: string;
  targetFolderPath: string;
  targetFileName?: string;
  conflictPolicy?: RomFsConflictPolicy;
}

export interface RomFsMoveRemoteRequest {
  profileId?: string;
  sourcePath: string;
  targetPath: string;
  conflictPolicy?: RomFsConflictPolicy;
}

export interface RomFsRenameRemoteRequest {
  profileId?: string;
  sourcePath: string;
  newName: string;
  conflictPolicy?: RomFsConflictPolicy;
}

export interface RomFsTrashRemoteRequest {
  profileId?: string;
  sourcePath: string;
}

export interface RomFsDeleteRemoteRequest {
  profileId?: string;
  sourcePath: string;
  confirmed?: boolean;
}

export interface RomFsRestoreRemoteRequest {
  profileId?: string;
  trashPath: string;
  originalPath: string;
  conflictPolicy?: RomFsConflictPolicy;
}

export interface RomFsCreateRemoteFolderRequest {
  profileId?: string;
  parentPath: string;
  folderName: string;
}

export interface RomFsCreateLocalFolderRequest {
  folderPath: string;
}
