import { useEffect, useMemo, useState } from 'react';
import { FileJson, FolderOpen, FolderSearch, HardDrive, ListChecks, Save, ShieldCheck } from 'lucide-react';
import { PageHeader } from '../components/cards/PageHeader';
import { SectionCard } from '../components/cards/SectionCard';
import { RomFileExplorerPanel } from '../components/rom/RomFileExplorerPanel';
import { StatusBadge } from '../components/status/StatusBadge';
import { SafeMisterProfileStore } from '../services/mister/profileStore';
import { MisterRemoteReadService } from '../services/mister/remote';
import { useActiveMisterProfile } from '../services/mister/activeProfile';
import { misterDisplayName } from '../services/mister/misterName';
import { LocalRomSelectionService } from '../services/rom/localRomService';
import { RomBackupPlanService } from '../services/rom/romBackupService';
import { createSavedRomPlan, maskRomDryRunResult, RomPlanPersistenceService } from '../services/rom/romPlanPersistenceService';
import { RomPlatformRecommendationService, romPlatformCandidates } from '../services/rom/romPlatformService';
import {
  createFinalConfirmationSummary,
  createRemoteFolderPlan,
  createRemoteFolderPolicy,
  folderNameFromCandidate,
  getPolicyForConflict,
  normalizePlannedAction,
  summarizeAction,
  validateRomPlan,
} from '../services/rom/romPolicyService';
import { RomPlanningService } from '../services/rom/romPlanningService';
import { RomDryRunValidationService } from '../services/rom/romDryRunValidationService';
import { filterRomPlanItems, sortRomPlanItems, summarizeRomPlan } from '../services/rom/romPlanSummaryService';
import { RomScanPerformanceService } from '../services/rom/romScanPerformanceService';
import { RomStorageCheckService } from '../services/rom/romStorageCheckService';
import { RomTransferService } from '../services/rom/romTransferService';
import { RomTransferFeatureFlagService } from '../services/rom/romTransferFeatureFlags';
import { RomTransferPreflightService } from '../services/rom/romTransferPreflightService';
import { romTransferSafetyPolicy } from '../services/rom/romTransferSafetyPolicy';
import { RomSimulatedTransferService } from '../services/rom/romSimulatedTransferService';
import { createValidationRecord, defaultValidationChecklist, RomValidationRecordService } from '../services/rom/romValidationRecordService';
import { RomDryRunReportService } from '../services/rom/romDryRunReportService';
import { RomSimulationReportService, createSimulationRecord } from '../services/rom/romSimulationReportService';
import { formatReviewChecklistGrade, ReviewChecklistService } from '../services/review/reviewChecklistService';
import {
  calculateValidationGrade,
  compareValidationRecords,
  filterValidationRecords,
  formatValidationGrade,
  sortValidationRecords,
} from '../services/rom/romValidationRecordAnalysisService';
import { formatPreflightBlocker, romTransferPolicyMessages } from '../services/rom/romPolicyMessageService';
import { RomTransferReadinessService } from '../services/rom/romTransferReadinessService';
import { useAppViewMode } from '../services/app/viewMode';
import { formatGameManagementSteps, formatLockedTransferSummary } from '../services/app/uiText';
import {
  romTransferDesignPhases,
  romTransferFailureScenarios,
  romTransferImplementationPrerequisites,
  romTransferRollbackLimits,
} from '../services/rom/romTransferDesign';
import { createTaskId, taskQueue } from '../services/tasks/taskQueue';
import type { MisterDeviceProfile, MisterRemoteGameFolder, MisterRemoteStorageStatus, SshKnownHostEntry, SshSessionState } from '../types/mister';
import type {
  LocalRomMetadata,
  RemoteFolderCreationPlan,
  RemoteGameFolderSnapshot,
  RomBackupPlan,
  RomCopyPlan,
  RomDryRunResult,
  RomDryRunValidationSession,
  RomDryRunValidationRecord,
  RomDryRunValidationChecklist,
  RomDryRunValidationFilter,
  RomDryRunValidationSort,
  RomFinalConfirmationSummary,
  LocalRomScanCancellation,
  LocalRomScanProgress,
  RomPerFilePlan,
  RomPlanFilterMode,
  RomPlanSortMode,
  RomPlannedAction,
  RomHashProgress,
  RomSimulatedTransferFailureMode,
  RomSimulatedTransferRecord,
  RomSimulatedTransferSession,
  RomStorageDryRun,
  RomTransferPreflightResult,
  RomTransferPreparationResult,
  RomTransferReadinessChecklist,
  RomTransferReadinessStatus,
  SavedRomPlan,
} from '../types/rom';
import type { ReviewChecklist, ReviewChecklistStatus } from '../types/review';

function formatBytes(bytes?: number) {
  if (typeof bytes !== 'number') return '?';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function actionTone(action: RomPlannedAction) {
  const normalized = normalizePlannedAction(action);
  if (normalized === 'copyLater' || normalized === 'skip') return 'safe' as const;
  if (normalized === 'block') return 'danger' as const;
  return 'warning' as const;
}

function planStatusTone(status: RomPerFilePlan['status']) {
  if (status === 'copy-ready') return 'safe' as const;
  if (status === 'blocked') return 'danger' as const;
  return 'warning' as const;
}

const validationChecklistLabels: Array<{ key: keyof RomDryRunValidationChecklist; label: string }> = [
  { key: 'ranOnRealMister', label: '실제 MiSTer 장치에서 실행했음' },
  { key: 'hostKeyTrusted', label: 'host key trusted 상태였음' },
  { key: 'gamesSnapshotRead', label: '/media/fat/games snapshot 조회 확인' },
  { key: 'storageDryRunCalculated', label: '저장공간 dry-run 계산 확인' },
  { key: 'reviewedAllConflicts', label: '충돌 항목 검토 완료' },
  { key: 'resolvedManualPlatforms', label: '수동 플랫폼 선택 항목 처리 완료' },
  { key: 'backupPlanForReplace', label: 'replaceLater 백업 계획 확인' },
  { key: 'reviewedFolderCreationPlan', label: '폴더 생성 예정 항목 확인' },
  { key: 'exportedPlanJson', label: '계획 JSON 내보내기 완료' },
  { key: 'confirmedNoRealCopy', label: '실제 복사를 실행하지 않았음' },
];

export function GameManagementPage() {
  const [viewMode] = useAppViewMode();
  const profileStore = useMemo(() => new SafeMisterProfileStore(), []);
  const remoteService = useMemo(() => new MisterRemoteReadService(), []);
  const localRomService = useMemo(() => new LocalRomSelectionService(), []);
  const recommendationService = useMemo(() => new RomPlatformRecommendationService(), []);
  const storageService = useMemo(() => new RomStorageCheckService(), []);
  const planner = useMemo(() => new RomPlanningService(), []);
  const scanPerformanceService = useMemo(() => new RomScanPerformanceService(), []);
  const validationService = useMemo(() => new RomDryRunValidationService(), []);
  const backupService = useMemo(() => new RomBackupPlanService(), []);
  const transferService = useMemo(() => new RomTransferService(), []);
  const featureFlagService = useMemo(() => new RomTransferFeatureFlagService(), []);
  const preflightService = useMemo(() => new RomTransferPreflightService(), []);
  const simulatedTransferService = useMemo(() => new RomSimulatedTransferService(), []);
  const validationRecordService = useMemo(() => new RomValidationRecordService(), []);
  const dryRunReportService = useMemo(() => new RomDryRunReportService(), []);
  const simulationReportService = useMemo(() => new RomSimulationReportService(), []);
  const readinessService = useMemo(() => new RomTransferReadinessService(), []);
  const planStore = useMemo(() => new RomPlanPersistenceService(), []);
  const romReviewService = useMemo(() => new ReviewChecklistService('rom-dry-run'), []);

  const [defaultProfile, setDefaultProfile] = useState<MisterDeviceProfile | undefined>();
  const [sessions, setSessions] = useState<SshSessionState[]>([]);
  const [knownHosts, setKnownHosts] = useState<SshKnownHostEntry[]>([]);
  const [folders, setFolders] = useState<MisterRemoteGameFolder[]>([]);
  const [remoteStorage, setRemoteStorage] = useState<MisterRemoteStorageStatus | undefined>();
  const [localFiles, setLocalFiles] = useState<LocalRomMetadata[]>([]);
  const [manualOverrides, setManualOverrides] = useState<Record<string, string>>({});
  const [actionOverrides, setActionOverrides] = useState<Record<string, RomPlannedAction>>({});
  const [folderNameOverrides, setFolderNameOverrides] = useState<Record<string, string>>({});
  const [snapshots, setSnapshots] = useState<Record<string, RemoteGameFolderSnapshot>>({});
  const [storageDryRun, setStorageDryRun] = useState<RomStorageDryRun | undefined>();
  const [backupRootLocalPath, setBackupRootLocalPath] = useState('');
  const [backupPlan, setBackupPlan] = useState<RomBackupPlan | undefined>();
  const [folderPlans, setFolderPlans] = useState<RemoteFolderCreationPlan[]>([]);
  const [dryRunResult, setDryRunResult] = useState<RomDryRunResult | undefined>();
  const [recursiveScan, setRecursiveScan] = useState(false);
  const [allowVeryLargeScan, setAllowVeryLargeScan] = useState(false);
  const [keepPartialOnCancel, setKeepPartialOnCancel] = useState(true);
  const [scanProgress, setScanProgress] = useState<LocalRomScanProgress | undefined>();
  const [scanCancellation, setScanCancellation] = useState<LocalRomScanCancellation | undefined>();
  const [hashProgress, setHashProgress] = useState<RomHashProgress | undefined>();
  const [includeFullLocalPaths, setIncludeFullLocalPaths] = useState(false);
  const [planFilter, setPlanFilter] = useState<RomPlanFilterMode>('all');
  const [planSort, setPlanSort] = useState<RomPlanSortMode>('name');
  const [savedPlans, setSavedPlans] = useState<SavedRomPlan[]>([]);
  const [finalSummary, setFinalSummary] = useState<RomFinalConfirmationSummary | undefined>();
  const [validationSession, setValidationSession] = useState<RomDryRunValidationSession | undefined>();
  const [validationRecords, setValidationRecords] = useState<RomDryRunValidationRecord[]>([]);
  const [validationUserNote, setValidationUserNote] = useState('');
  const [validationChecklist, setValidationChecklist] = useState<RomDryRunValidationChecklist>(defaultValidationChecklist);
  const [selectedValidationRecordId, setSelectedValidationRecordId] = useState<string | undefined>();
  const [validationRecordFilter, setValidationRecordFilter] = useState<RomDryRunValidationFilter>('all');
  const [validationRecordSort, setValidationRecordSort] = useState<RomDryRunValidationSort>('date-desc');
  const [confirmationPhrase, setConfirmationPhrase] = useState('');
  const [transferPreparation, setTransferPreparation] = useState<RomTransferPreparationResult | undefined>();
  const [preflightResult, setPreflightResult] = useState<RomTransferPreflightResult | undefined>();
  const [simulationFailureMode, setSimulationFailureMode] = useState<RomSimulatedTransferFailureMode>('none');
  const [simulatedTransferSession, setSimulatedTransferSession] = useState<RomSimulatedTransferSession | undefined>();
  const [simulationRecords, setSimulationRecords] = useState<RomSimulatedTransferRecord[]>([]);
  const [selectedSimulationRecordId, setSelectedSimulationRecordId] = useState<string | undefined>();
  const [readinessChecklist, setReadinessChecklist] = useState<RomTransferReadinessChecklist | undefined>();
  const [readinessNote, setReadinessNote] = useState('');
  const [romReviewChecklist, setRomReviewChecklist] = useState<ReviewChecklist>();
  const [romReviewNote, setRomReviewNote] = useState('');
  const [showFinalModal, setShowFinalModal] = useState(false);
  const [message, setMessage] = useState('PC에서 추가할 ROM을 고르고 MiSTer 대상 폴더, 같은 이름 파일, 저장공간, 덮어쓰기 여부를 복사 전 확인합니다. 실제 복사는 아직 잠겨 있습니다.');
  const [activeMister] = useActiveMisterProfile();

  const activeSession = activeMister?.sessionId
    ? sessions.find((session) => session.sessionId === activeMister.sessionId || session.host === activeMister.ipAddress) || {
      sessionId: activeMister.sessionId,
      host: activeMister.ipAddress,
      port: activeMister.port,
      username: activeMister.username,
      createdAt: activeMister.connectedAt,
      lastUsedAt: activeMister.connectedAt,
      hasPassword: false,
      hasPrivateKey: false,
    }
    : defaultProfile ? sessions.find((session) => session.sessionId === defaultProfile.id || session.host === defaultProfile.ipAddress) : undefined;
  const activeKnownHost = activeSession ? knownHosts.find((entry) => entry.host === activeSession.host && entry.port === activeSession.port) : undefined;
  const activeHostTrusted = Boolean(activeKnownHost || activeMister?.hostKeyStatus === 'trusted' || activeMister?.hostKeyStatus === 'trusted-now');
  const remoteTargetFolders = useMemo(
    () => folders.map((folder) => ({ coreName: folder.name, remotePath: folder.path, existingFileCount: folder.fileCount })),
    [folders],
  );
  const candidates = useMemo(() => (
    localFiles.map((file) => recommendationService.createCandidate(file, remoteTargetFolders, manualOverrides[file.id]))
  ), [localFiles, manualOverrides, recommendationService, remoteTargetFolders]);
  const scanWarnings = useMemo(
    () => scanPerformanceService.getPerformanceWarnings(localFiles.length, allowVeryLargeScan),
    [allowVeryLargeScan, localFiles.length, scanPerformanceService],
  );
  const planSummary = useMemo(() => summarizeRomPlan(dryRunResult?.plan), [dryRunResult]);
  const conflictTotal = useMemo(
    () => Object.entries(planSummary.conflictCounts).reduce((total, [key, value]) => total + (key === 'none' ? 0 : value), 0),
    [planSummary],
  );
  const selectedValidationRecord = validationRecords.find((record) => record.validationSessionId === selectedValidationRecordId);
  const displayedValidationRecords = useMemo(
    () => sortValidationRecords(filterValidationRecords(validationRecords, validationRecordFilter), validationRecordSort),
    [validationRecordFilter, validationRecordSort, validationRecords],
  );
  const selectedSimulationRecord = simulationRecords.find((record) => record.simulationRecordId === selectedSimulationRecordId);
  const validationComparison = selectedValidationRecord && displayedValidationRecords.length > 1
    ? compareValidationRecords(displayedValidationRecords.find((record) => record.validationSessionId !== selectedValidationRecord.validationSessionId) || displayedValidationRecords[0], selectedValidationRecord)
    : undefined;
  const currentFeatureFlags = featureFlagService.getFlags();
  const currentKillSwitch = featureFlagService.getKillSwitch();

  useEffect(() => {
    void Promise.all([
      profileStore.loadProfiles(),
      remoteService.listSessions(),
      remoteService.listKnownHosts(),
      planStore.loadPlans(),
      validationRecordService.loadRecords(),
      simulationReportService.loadRecords(),
      readinessService.loadChecklist(),
    ]).then(([savedProfiles, sshSessions, trustedHosts, plans, records, simulations, readiness]) => {
      setDefaultProfile(savedProfiles.find((profile) => profile.id === activeMister?.profileId) || savedProfiles.find((profile) => profile.defaultDevice) || savedProfiles[0]);
      setSessions(sshSessions);
      setKnownHosts(trustedHosts);
      setSavedPlans(plans);
      setValidationRecords(records);
      setSimulationRecords(simulations);
      setReadinessChecklist(readiness);
      setReadinessNote(readiness.userNote || '');
      const review = romReviewService.load();
      setRomReviewChecklist(review);
      setRomReviewNote(review.userNote);
    });
  }, [profileStore, remoteService, planStore, validationRecordService, simulationReportService, readinessService, romReviewService, activeMister?.profileId]);

  function buildDryRunResult(
    nextActionOverrides = actionOverrides,
    nextFolderNameOverrides = folderNameOverrides,
    nextBackupRoot = backupRootLocalPath,
  ) {
    const storage = storageService.inspect(candidates, remoteStorage);
    const result = planner.createDryRunPlan({
      candidates,
      snapshots: Object.values(snapshots),
      storage,
      targetProfileId: defaultProfile?.id,
      targetAlias: defaultProfile?.alias,
      targetHost: defaultProfile?.ipAddress,
      actionOverrides: nextActionOverrides,
    });
    const plans = result.plan.perFilePlan
      .filter((item) => normalizePlannedAction(item.action) === 'createFolderLater')
      .map((item) => {
        const candidate = candidates.find((entry) => entry.id === item.candidateId);
        const folderName = nextFolderNameOverrides[item.candidateId] || (candidate ? folderNameFromCandidate(candidate) : item.fileName.replace(/\.[^.]+$/, ''));
        return createRemoteFolderPlan(folderName, [item.candidateId]);
      });
    const planWithFolders: RomCopyPlan = {
      ...result.plan,
      folderPolicy: createRemoteFolderPolicy(plans),
    };
    const nextBackupPlan = backupService.createBackupPlan(planWithFolders, nextBackupRoot || undefined);
    const planWithBackup: RomCopyPlan = {
      ...planWithFolders,
      backupPlan: nextBackupPlan,
    };
    const validation = validateRomPlan(planWithBackup);
    planWithBackup.validation = validation;
    planWithBackup.canProceedLater = validation.canProceedLater;
    return {
      result: {
        ...result,
        ok: validation.canProceedLater,
        plan: planWithBackup,
        storage,
        message: validation.canProceedLater
          ? '안전 정책을 반영한 ROM dry-run 계획을 생성했습니다. 실제 복사는 수행하지 않았습니다.'
          : '사용자 결정, 백업 계획, 폴더 생성 계획 또는 차단 항목이 남아 있습니다. 실제 복사는 수행하지 않았습니다.',
      },
      storage,
      backupPlan: nextBackupPlan,
      folderPlans: plans,
    };
  }

  function setPlanState(next: ReturnType<typeof buildDryRunResult>) {
    setDryRunResult(next.result);
    setStorageDryRun(next.storage);
    setBackupPlan(next.backupPlan);
    setFolderPlans(next.folderPlans);
    setFinalSummary(createFinalConfirmationSummary(next.result.plan));
  }

  function refreshValidationSession(plan = dryRunResult?.plan, savedOrExportReady = Boolean(dryRunResult)) {
    const session = validationService.createSession({
      targetProfileId: defaultProfile?.id,
      targetAlias: defaultProfile?.alias,
      targetHost: defaultProfile?.ipAddress,
      hasDefaultProfile: Boolean(defaultProfile),
      hasSessionCredential: Boolean(activeSession),
      hostKeyTrusted: activeHostTrusted,
      remoteGamesRead: folders.length > 0,
      remoteStorageRead: Boolean(remoteStorage),
      localFileCount: localFiles.length,
      plan,
      savedOrExportReady,
    });
    setValidationSession(session);
    taskQueue.enqueue({
      id: createTaskId('rom-dry-run-validation'),
      title: 'ROM dry-run 검증 세션',
      description: session.summary.message,
      category: 'dry-run',
      riskLevel: '안전',
      dryRun: true,
      readOnly: true,
      status: session.summary.status === 'success' || session.summary.status === 'partial-success' ? '완료' : '차단',
      targetProfileId: defaultProfile?.id,
      targetAlias: defaultProfile?.alias,
      targetHost: defaultProfile?.ipAddress,
      resultSummary: session.summary.message,
      logs: session.steps.map((step) => ({
        at: new Date().toISOString(),
        message: `${step.label}: ${step.status}${step.errorCode ? ` (${step.errorCode})` : ''}`,
      })),
    });
  }

  function updateValidationChecklist(key: keyof RomDryRunValidationChecklist, value: boolean) {
    setValidationChecklist((current) => ({ ...current, [key]: value }));
  }

  async function saveValidationRecord() {
    if (!validationSession) {
      setMessage('저장할 dry-run 검증 세션이 없습니다.');
      return;
    }
    const record = createValidationRecord({
      session: validationSession,
      dryRunResult,
      hostKeyTrustStatus: activeHostTrusted ? 'trusted' : activeSession ? 'untrusted' : 'unknown',
      checklist: validationChecklist,
      userNote: validationUserNote,
      options: { includeFullLocalPaths },
    });
    const records = await validationRecordService.saveRecord(record);
    setValidationRecords(records);
    setSelectedValidationRecordId(record.validationSessionId);
    taskQueue.enqueue({
      id: createTaskId('rom-validation-record-save'),
      title: 'ROM dry-run 검증 기록 저장',
      description: record.sanitizedSummary,
      category: 'dry-run',
      riskLevel: '안전',
      dryRun: true,
      readOnly: true,
      status: '완료',
      targetProfileId: defaultProfile?.id,
      targetAlias: defaultProfile?.alias,
      targetHost: defaultProfile?.ipAddress,
      resultSummary: `candidate ${record.romCandidateCount}개 / blocked ${record.blockedCount}개`,
      logs: [{ at: new Date().toISOString(), message: 'credential과 raw command 없이 검증 기록만 저장했습니다.' }],
    });
    setMessage('실제 장치 dry-run 검증 기록을 저장했습니다. 실제 복사는 실행하지 않았습니다.');
  }

  async function deleteValidationRecord(recordId: string) {
    const records = await validationRecordService.deleteRecord(recordId);
    setValidationRecords(records);
    if (selectedValidationRecordId === recordId) setSelectedValidationRecordId(undefined);
    setMessage('dry-run 검증 기록을 삭제했습니다. 원격 파일은 변경하지 않았습니다.');
  }

  async function exportValidationRecordJson(record: RomDryRunValidationRecord) {
    if (!window.helloMisterDesktop?.saveTextFile) {
      setMessage('현재 환경에서 JSON 저장 adapter가 없습니다.');
      return;
    }
    const result = await window.helloMisterDesktop.saveTextFile({
      defaultPath: `hello-mister-rom-validation-${record.createdAt.slice(0, 10)}.json`,
      content: JSON.stringify(record, null, 2),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    setMessage(result.message);
  }

  async function updateSelectedValidationRecordNote(note: string) {
    if (!selectedValidationRecord) return;
    const records = await validationRecordService.updateRecord(selectedValidationRecord.validationSessionId, { userNote: note });
    setValidationRecords(records);
    setMessage('검증 기록 메모를 저장했습니다. credential은 저장하지 않았습니다.');
  }

  async function updateSelectedValidationRecordChecklist(key: keyof RomDryRunValidationChecklist, value: boolean) {
    if (!selectedValidationRecord) return;
    const records = await validationRecordService.updateRecord(selectedValidationRecord.validationSessionId, {
      checklist: { ...selectedValidationRecord.checklist, [key]: value },
    });
    setValidationRecords(records);
    setMessage('검증 기록 체크리스트를 저장했습니다.');
  }

  async function exportDryRunReport(record: RomDryRunValidationRecord, format: 'json' | 'markdown') {
    if (!window.helloMisterDesktop?.saveTextFile) {
      setMessage('현재 환경에서 리포트 저장 adapter가 없습니다.');
      return;
    }
    const report = dryRunReportService.createReport({
      record,
      backupPlan,
      preflight: preflightResult,
      options: { format, includeFullLocalPaths },
    });
    const content = dryRunReportService.export(report, format);
    const extension = format === 'markdown' ? 'md' : 'json';
    const result = await window.helloMisterDesktop.saveTextFile({
      defaultPath: `hello-mister-rom-dry-run-report-${record.createdAt.slice(0, 10)}.${extension}`,
      content,
      filters: [{ name: format === 'markdown' ? 'Markdown' : 'JSON', extensions: [extension] }],
    });
    setMessage(result.message);
  }

  function refreshPreflight() {
    const result = preflightService.inspect({
      plan: dryRunResult?.plan,
      hasTargetProfile: Boolean(defaultProfile),
      hasSessionCredential: Boolean(activeSession),
      hostKeyTrusted: activeHostTrusted,
      finalConfirmationCompleted: confirmationPhrase === 'DRY RUN ONLY',
      featureFlags: featureFlagService.getFlags(),
      killSwitch: featureFlagService.getKillSwitch(),
    });
    setPreflightResult(result);
    return result;
  }

  function runSimulatedTransfer() {
    if (!dryRunResult) {
      setMessage('시뮬레이션할 ROM 계획이 없습니다.');
      return;
    }
    const preflight = refreshPreflight();
    if (!preflight.canSimulate) {
      setMessage('preflight 결과 시뮬레이션도 시작할 수 없습니다.');
      return;
    }
    const session = simulatedTransferService.runToCompletion(
      simulatedTransferService.createSession(dryRunResult.plan, simulationFailureMode),
    );
    setSimulatedTransferSession(session);
    void simulationReportService.saveRecord(createSimulationRecord(session)).then((records) => {
      setSimulationRecords(records);
      setSelectedSimulationRecordId(session.sessionId);
    });
    taskQueue.enqueue({
      id: createTaskId('rom-transfer-simulation'),
      title: 'ROM 전송 시뮬레이션',
      description: session.message,
      category: 'dry-run',
      riskLevel: '안전',
      dryRun: true,
      readOnly: true,
      status: session.status === 'completed' ? '완료' : session.status === 'cancelled' ? '취소' : '실패',
      targetProfileId: defaultProfile?.id,
      targetAlias: defaultProfile?.alias,
      targetHost: defaultProfile?.ipAddress,
      resultSummary: `${session.label}: ${session.progress.processedFiles}/${session.progress.totalFiles} files, remoteWritesPerformed=${session.remoteWritesPerformed}`,
      logs: session.logs.map((log) => ({ at: new Date().toISOString(), message: log })),
    });
    setMessage(session.message);
  }

  function cancelSimulatedTransfer() {
    if (!simulatedTransferSession) return;
    const session = simulatedTransferService.cancel(simulatedTransferSession);
    setSimulatedTransferSession(session);
    void simulationReportService.saveRecord(createSimulationRecord(session)).then((records) => {
      setSimulationRecords(records);
      setSelectedSimulationRecordId(session.sessionId);
    });
    setMessage(session.message);
  }

  async function deleteSimulationRecord(recordId: string) {
    const records = await simulationReportService.deleteRecord(recordId);
    setSimulationRecords(records);
    if (selectedSimulationRecordId === recordId) setSelectedSimulationRecordId(undefined);
    setMessage('시뮬레이션 기록을 삭제했습니다. 원격 파일은 변경하지 않았습니다.');
  }

  async function exportSimulationReport(record: RomSimulatedTransferRecord, format: 'json' | 'markdown') {
    if (!window.helloMisterDesktop?.saveTextFile) {
      setMessage('현재 환경에서 시뮬레이션 리포트 저장 adapter가 없습니다.');
      return;
    }
    const report = simulationReportService.createReport(record, { format, includeFullLocalPaths });
    const content = simulationReportService.export(report, format);
    const extension = format === 'markdown' ? 'md' : 'json';
    const result = await window.helloMisterDesktop.saveTextFile({
      defaultPath: `hello-mister-rom-simulation-report-${record.createdAt.slice(0, 10)}.${extension}`,
      content,
      filters: [{ name: format === 'markdown' ? 'Markdown' : 'JSON', extensions: [extension] }],
    });
    setMessage(result.message);
  }

  async function updateReadinessStatus(itemId: string, status: RomTransferReadinessStatus) {
    if (!readinessChecklist) return;
    const next = await readinessService.saveChecklist(readinessService.setItemStatus(readinessChecklist, itemId, status));
    setReadinessChecklist(next);
    setMessage('실제 전송 기능 검토 체크리스트를 저장했습니다. 실제 전송은 계속 잠겨 있습니다.');
  }

  async function saveReadinessNote() {
    if (!readinessChecklist) return;
    const next = await readinessService.saveChecklist({ ...readinessChecklist, userNote: readinessNote });
    setReadinessChecklist(next);
    setMessage('체크리스트 메모를 저장했습니다.');
  }

  async function exportReadinessChecklist(format: 'json' | 'markdown') {
    if (!readinessChecklist || !window.helloMisterDesktop?.saveTextFile) return;
    const content = readinessService.export({ ...readinessChecklist, userNote: readinessNote }, format);
    const extension = format === 'markdown' ? 'md' : 'json';
    const result = await window.helloMisterDesktop.saveTextFile({
      defaultPath: `hello-mister-rom-transfer-readiness.${extension}`,
      content,
      filters: [{ name: format === 'markdown' ? 'Markdown' : 'JSON', extensions: [extension] }],
    });
    setMessage(result.message);
  }

  function updateRomReviewStatus(itemId: string, status: ReviewChecklistStatus) {
    if (!romReviewChecklist) return;
    const next = romReviewService.setStatus(romReviewChecklist, itemId, status);
    setRomReviewChecklist(next);
    setRomReviewNote(next.userNote);
    setMessage('ROM dry-run 실사용 검토 체크리스트를 저장했습니다. 실제 복사는 여전히 잠겨 있습니다.');
  }

  function saveRomReviewNote() {
    if (!romReviewChecklist) return;
    const next = romReviewService.setNote(romReviewChecklist, romReviewNote);
    setRomReviewChecklist(next);
    setMessage('ROM dry-run 실사용 검토 메모를 저장했습니다.');
  }

  async function exportRomReviewChecklist(format: 'json' | 'markdown') {
    if (!romReviewChecklist || !window.helloMisterDesktop?.saveTextFile) {
      setMessage('현재 환경에서는 ROM 검토 체크리스트 내보내기를 사용할 수 없습니다. Electron 앱 창에서 다시 시도하세요.');
      return;
    }
    const extension = format === 'json' ? 'json' : 'md';
    const content = romReviewService.export({ ...romReviewChecklist, userNote: romReviewNote }, format);
    const result = await window.helloMisterDesktop.saveTextFile({
      defaultPath: `hello-mister-rom-dry-run-review.${extension}`,
      content,
      filters: [{ name: format === 'json' ? 'JSON' : 'Markdown', extensions: [extension] }],
    });
    setMessage(result.message);
  }

  function cancelLocalScan() {
    const cancellation = scanPerformanceService.requestCancellation(keepPartialOnCancel);
    setScanCancellation(cancellation);
    setScanProgress((progress) => progress ? scanPerformanceService.cancelScanProgress(progress, keepPartialOnCancel) : progress);
    taskQueue.enqueue({
      id: createTaskId('local-rom-scan-cancel'),
      title: 'ROM 스캔 취소 요청',
      description: cancellation.message,
      category: 'dry-run',
      riskLevel: '안전',
      dryRun: true,
      readOnly: true,
      status: '취소',
      resultSummary: cancellation.message,
      logs: [{ at: new Date().toISOString(), message: '실제 파일 쓰기 없이 스캔 결과 처리만 중단/유지합니다.' }],
    });
  }

  async function loadGameFolders() {
    if (!activeSession || !activeHostTrusted) {
      setMessage('MiSTer 대상 폴더 조회에는 MiSTer 연결 메뉴에서 확인한 연결이 필요합니다.');
      return;
    }
    const taskId = createTaskId('remote-games');
    taskQueue.enqueue({
      id: taskId,
      title: 'games 폴더 목록 읽기',
      description: `${activeSession.username}@${activeSession.host} /media/fat/games`,
      category: 'network',
      riskLevel: '안전',
      dryRun: false,
      readOnly: true,
      status: '진행 중',
      logs: [{ at: new Date().toISOString(), message: 'SFTP readdir로 1단계 폴더만 읽습니다.' }],
    });
    try {
      const [fingerprint, result] = await Promise.all([
        remoteService.fingerprintSession(activeSession.sessionId, activeSession.host),
        remoteService.listGames(activeSession.sessionId),
      ]);
      setRemoteStorage(fingerprint.storage);
      setFolders(result.items);
      refreshValidationSession(dryRunResult?.plan, Boolean(dryRunResult));
      setMessage(result.message);
      taskQueue.updateStatus(taskId, result.ok ? '완료' : '실패', `${result.items.length}개 코어 폴더`, {
        errorCode: result.errorCode,
        sanitizedErrorMessage: result.error,
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setMessage(text);
      taskQueue.updateStatus(taskId, '실패', text);
    }
  }

  async function selectRomFiles() {
    const progress = scanPerformanceService.createScanProgress({ currentFileName: '파일 선택 대기' });
    setScanProgress(progress);
    setScanCancellation(undefined);
    const taskId = createTaskId('local-rom-scan');
    taskQueue.enqueue({
      id: taskId,
      title: '로컬 ROM 파일 선택',
      description: '선택한 파일의 metadata만 읽습니다.',
      category: 'dry-run',
      riskLevel: '안전',
      dryRun: true,
      readOnly: true,
      status: '진행 중',
      logs: [],
    });
    const result = await localRomService.selectFiles();
    if (result.ok) {
      setScanProgress(scanPerformanceService.completeScanProgress(progress, result.items.length));
      setLocalFiles(result.items);
      setSnapshots({});
      setDryRunResult(undefined);
      setActionOverrides({});
      setFolderNameOverrides({});
      setMessage(result.message);
      taskQueue.updateStatus(taskId, '완료', `${result.items.length}개 파일 metadata 읽기 완료`, { resultSummary: result.message });
    } else {
      setScanProgress((current) => current ? { ...current, status: result.cancelled ? 'cancelled' : 'failed', updatedAt: new Date().toISOString() } : current);
      setMessage(result.message);
      taskQueue.updateStatus(taskId, result.cancelled ? '취소' : '실패', result.message);
    }
  }

  async function selectRomFolder() {
    const progress = scanPerformanceService.createScanProgress({
      currentFileName: recursiveScan ? '재귀 스캔 준비' : '1단계 폴더 스캔 준비',
      explicitAllowLargeScan: allowVeryLargeScan,
    });
    setScanProgress(progress);
    setScanCancellation(undefined);
    const taskId = createTaskId('local-rom-folder-scan');
    taskQueue.enqueue({
      id: taskId,
      title: '로컬 ROM 폴더 스캔',
      description: recursiveScan ? '재귀 옵션으로 후보 파일 metadata를 읽습니다.' : '기본 1단계 폴더에서 후보 파일 metadata만 읽습니다.',
      category: 'dry-run',
      riskLevel: '안전',
      dryRun: true,
      readOnly: true,
      status: '진행 중',
      logs: [],
    });
    const result = await localRomService.selectFolder({ recursive: recursiveScan, maxFiles: allowVeryLargeScan ? 20000 : 10000 });
    if (result.ok) {
      setScanProgress(scanPerformanceService.completeScanProgress(progress, result.items.length));
      setLocalFiles(result.items);
      setSnapshots({});
      setDryRunResult(undefined);
      setActionOverrides({});
      setFolderNameOverrides({});
      setMessage([result.message, ...result.warnings].join('\n'));
      taskQueue.updateStatus(taskId, '완료', `${result.items.length}개 파일 metadata 읽기 완료`, { resultSummary: result.message });
    } else {
      setScanProgress((current) => current ? { ...current, status: result.cancelled ? 'cancelled' : 'failed', updatedAt: new Date().toISOString() } : current);
      setMessage(result.message);
      taskQueue.updateStatus(taskId, result.cancelled ? '취소' : '실패', result.message);
    }
  }

  async function calculateHash(file: LocalRomMetadata) {
    if (!window.helloMisterDesktop?.calculateFileSha256) {
      setMessage('현재 환경에서는 SHA-256 계산 adapter가 없습니다.');
      return;
    }
    const progress = scanPerformanceService.createHashProgress(file.id, file.fileName, file.sizeBytes);
    setHashProgress(progress);
    setLocalFiles((items) => items.map((item) => item.id === file.id ? { ...item, hashStatus: 'calculating' } : item));
    const result = await window.helloMisterDesktop.calculateFileSha256(file.filePath);
    setHashProgress(scanPerformanceService.finishHashProgress(progress, result.ok ? 'complete' : 'failed', result.message));
    setLocalFiles((items) => items.map((item) => item.id === file.id ? { ...item, hashStatus: result.ok ? 'complete' : 'failed', sha256: result.hash } : item));
    setMessage(result.message);
  }

  async function compareRemoteFolders() {
    if (!activeSession || !activeHostTrusted) {
      setMessage('MiSTer 대상 폴더 비교에는 MiSTer 연결 메뉴에서 확인한 연결이 필요합니다.');
      return;
    }
    const taskId = createTaskId('rom-conflict-check');
    taskQueue.enqueue({
      id: taskId,
      title: 'ROM 원격 폴더 비교',
      description: '추천 대상 폴더의 1단계 파일 목록만 읽어 같은 이름 파일을 복사 전 확인합니다.',
      category: 'network',
      riskLevel: '안전',
      dryRun: true,
      readOnly: true,
      status: '진행 중',
      logs: [],
    });
    const uniqueFolders = Array.from(new Set(candidates.map((candidate) => candidate.recommendation?.targetFolder).filter(Boolean))) as string[];
    const nextSnapshots: Record<string, RemoteGameFolderSnapshot> = {};
    for (const folderPath of uniqueFolders) {
      const folder = remoteTargetFolders.find((item) => item.remotePath === folderPath) || { coreName: folderPath.split('/').pop() || 'unknown', remotePath: folderPath };
      if (!remoteTargetFolders.some((item) => item.remotePath === folderPath)) {
        nextSnapshots[folderPath] = { ok: false, folder, files: [], readAt: new Date().toISOString(), message: '원격 대상 폴더가 없습니다.', errorCode: 'REMOTE_PATH_MISSING' };
        continue;
      }
      const result = await remoteService.listGameFolderFiles(activeSession.sessionId, folderPath);
      nextSnapshots[folderPath] = {
        ok: result.ok,
        folder,
        files: result.items,
        readAt: result.readAt,
        message: result.message,
        errorCode: result.errorCode,
      };
    }
    setSnapshots(nextSnapshots);
    taskQueue.updateStatus(taskId, '완료', `${Object.keys(nextSnapshots).length}개 대상 폴더 비교 완료`, {
      resultSummary: `충돌 검사 대상 폴더 ${Object.keys(nextSnapshots).length}개`,
    });
    setMessage('원격 games 폴더 비교를 완료했습니다. 파일 목록/stat만 읽었고 다운로드나 수정은 수행하지 않았습니다.');
  }

  function createCopyPlan(nextOverrides = actionOverrides, nextFolderNames = folderNameOverrides, nextBackupRoot = backupRootLocalPath) {
    const next = buildDryRunResult(nextOverrides, nextFolderNames, nextBackupRoot);
    setPlanState(next);
    refreshValidationSession(next.result.plan, true);
    taskQueue.enqueue({
      id: createTaskId('rom-copy-plan'),
      title: 'ROM 복사 계획 dry-run 생성',
      description: next.result.message,
      category: 'dry-run',
      riskLevel: '안전',
      dryRun: true,
      readOnly: true,
      status: '완료',
      targetProfileId: defaultProfile?.id,
      targetAlias: defaultProfile?.alias,
      targetHost: defaultProfile?.ipAddress,
      resultSummary: `파일 ${next.result.plan.perFilePlan.length}개 · 차단 ${next.result.plan.validation?.blockers.length || 0}개 · 저장공간 ${next.storage.status}`,
      logs: [{ at: new Date().toISOString(), message: '실제 ROM 복사는 실행하지 않았습니다.' }],
    });
    setMessage(next.result.message);
  }

  function updateAction(candidateId: string, action: RomPlannedAction) {
    const nextOverrides = { ...actionOverrides, [candidateId]: action };
    setActionOverrides(nextOverrides);
    taskQueue.enqueue({
      id: createTaskId('rom-policy-change'),
      title: 'ROM 충돌 정책 변경',
      description: `${candidateId}: ${summarizeAction(action)}`,
      category: 'dry-run',
      riskLevel: '안전',
      dryRun: true,
      readOnly: true,
      status: '완료',
      logs: [{ at: new Date().toISOString(), message: '정책만 변경했습니다. 실제 복사는 비활성입니다.' }],
    });
    if (dryRunResult) createCopyPlan(nextOverrides);
  }

  function applyBulk(kind: 'skipSameSize' | 'blockMissing' | 'blockUnsupported' | 'showManual' | 'showConflicts' | 'showMissing') {
    if (kind === 'showManual') {
      setPlanFilter('manual');
      return;
    }
    if (kind === 'showConflicts') {
      setPlanFilter('conflict');
      return;
    }
    if (kind === 'showMissing') {
      setPlanFilter('targetFolderMissing');
      return;
    }
    const nextOverrides = { ...actionOverrides };
    for (const item of dryRunResult?.plan.perFilePlan || []) {
      if (kind === 'skipSameSize' && item.conflictType === 'sameNameSameSize') nextOverrides[item.candidateId] = 'skip';
      if (kind === 'blockMissing' && item.conflictType === 'targetFolderMissing') nextOverrides[item.candidateId] = 'block';
      if (kind === 'blockUnsupported' && item.conflictType === 'unsupportedExtension') nextOverrides[item.candidateId] = 'block';
    }
    setActionOverrides(nextOverrides);
    if (dryRunResult) createCopyPlan(nextOverrides);
  }

  function updateFolderName(candidateId: string, folderName: string) {
    const nextNames = { ...folderNameOverrides, [candidateId]: folderName };
    setFolderNameOverrides(nextNames);
    if (dryRunResult) createCopyPlan(actionOverrides, nextNames);
  }

  async function selectBackupFolder() {
    const result = await window.helloMisterDesktop?.selectRomBackupFolder?.();
    if (!result?.ok || !result.folderPath) {
      setMessage(result?.message || '백업 폴더 선택 adapter가 없습니다.');
      return;
    }
    setBackupRootLocalPath(result.folderPath);
    if (dryRunResult) createCopyPlan(actionOverrides, folderNameOverrides, result.folderPath);
    taskQueue.enqueue({
      id: createTaskId('rom-backup-plan'),
      title: 'ROM 복사 전 백업 계획 생성',
      description: '로컬 백업 위치를 dry-run 계획에 반영했습니다.',
      category: 'dry-run',
      riskLevel: '안전',
      dryRun: true,
      readOnly: true,
      status: '완료',
      logs: [{ at: new Date().toISOString(), message: '실제 백업 파일은 생성하지 않았습니다.' }],
    });
    setMessage(result.message);
  }

  async function exportPlanJson() {
    if (!dryRunResult || !window.helloMisterDesktop?.saveTextFile) return;
    const safePlan = maskRomDryRunResult(dryRunResult, { includeFullLocalPaths });
    const result = await window.helloMisterDesktop.saveTextFile({
      defaultPath: `hello-mister-rom-plan-${new Date().toISOString().slice(0, 10)}.json`,
      content: JSON.stringify(safePlan, null, 2),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    taskQueue.enqueue({
      id: createTaskId('rom-plan-export'),
      title: 'ROM 계획 JSON 내보내기',
      description: result.message,
      category: 'dry-run',
      riskLevel: '안전',
      dryRun: true,
      readOnly: true,
      status: result.ok ? '완료' : result.cancelled ? '취소' : '실패',
      logs: [{ at: new Date().toISOString(), message: includeFullLocalPaths ? '사용자 옵션에 따라 로컬 전체 경로를 포함했습니다.' : '로컬 전체 경로를 숨긴 JSON을 저장했습니다.' }],
    });
    setMessage(result.message);
  }

  async function exportBackupPlanJson() {
    if (!backupPlan || !window.helloMisterDesktop?.saveTextFile) return;
    const result = await window.helloMisterDesktop.saveTextFile({
      defaultPath: `hello-mister-rom-backup-plan-${new Date().toISOString().slice(0, 10)}.json`,
      content: JSON.stringify(backupPlan, null, 2),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    setMessage(result.message);
  }

  async function saveCurrentPlan() {
    if (!dryRunResult) return;
    const savedPlan = createSavedRomPlan(dryRunResult, { includeFullLocalPaths }, `ROM 계획 ${new Date().toLocaleString()}`);
    const plans = await planStore.savePlan(savedPlan);
    setSavedPlans(plans);
    taskQueue.enqueue({
      id: createTaskId('rom-plan-save'),
      title: 'ROM 계획 저장',
      description: savedPlan.metadata.title,
      category: 'dry-run',
      riskLevel: '안전',
      dryRun: true,
      readOnly: true,
      status: '완료',
      logs: [{ at: new Date().toISOString(), message: 'appData/localStorage 계획 저장소에 credential 없이 저장했습니다.' }],
    });
    setMessage('ROM 계획을 저장했습니다. 실제 복사는 수행하지 않았습니다.');
  }

  function loadSavedPlan(plan: SavedRomPlan) {
    setDryRunResult(plan.dryRunResult);
    setStorageDryRun(plan.dryRunResult.storage);
    setBackupPlan(plan.backupPlan || plan.dryRunResult.plan.backupPlan);
    setFolderPlans(plan.folderPolicy?.plannedFolders || plan.dryRunResult.plan.folderPolicy?.plannedFolders || []);
    setFinalSummary(createFinalConfirmationSummary(plan.dryRunResult.plan));
    setMessage(`${plan.metadata.title} 계획을 불러왔습니다. 실제 복사는 수행하지 않았습니다.`);
  }

  async function deleteSavedPlan(planId: string) {
    const plans = await planStore.deletePlan(planId);
    setSavedPlans(plans);
    setMessage('저장된 ROM 계획을 삭제했습니다. 원격 파일은 변경하지 않았습니다.');
  }

  function openFinalConfirmation() {
    if (!dryRunResult) return;
    const summary = createFinalConfirmationSummary(dryRunResult.plan);
    const preparation = transferService.prepareTransfer({
      plan: dryRunResult.plan,
      hasSessionCredential: Boolean(activeSession),
      hostKeyTrusted: activeHostTrusted,
      finalConfirmationCompleted: confirmationPhrase === 'DRY RUN ONLY',
    });
    setFinalSummary(summary);
    setTransferPreparation(preparation);
    if (preparation.preflight) setPreflightResult(preparation.preflight);
    setShowFinalModal(true);
    taskQueue.enqueue({
      id: createTaskId('rom-final-confirmation'),
      title: 'ROM 최종 확인 modal 열람',
      description: preparation.message,
      category: 'dry-run',
      riskLevel: '주의',
      dryRun: true,
      readOnly: true,
      status: '차단',
      targetProfileId: defaultProfile?.id,
      targetAlias: defaultProfile?.alias,
      targetHost: defaultProfile?.ipAddress,
      errorCode: preparation.disabledError.code,
      resultSummary: 'transfer preparation blocked',
      logs: preparation.guard.blockers.map((blocker) => ({ at: new Date().toISOString(), message: blocker.message })),
    });
  }

  const filteredPlans = sortRomPlanItems(filterRomPlanItems(dryRunResult?.plan.perFilePlan || [], planFilter), planSort);
  const visiblePlans = viewMode === 'basic' ? filteredPlans.slice(0, 10) : filteredPlans;
  const showLegacyRomPlanning = false;

  return (
    <>
      <PageHeader
        eyebrow="MiSTer 게임 롬 관리"
        title="PC / MiSTer 파일 전송 관리자"
        description="PC와 MiSTer 폴더를 앱 안에서 탐색하고, SFTP 기반 복사/이동/휴지통 작업을 수행합니다."
      />
      <RomFileExplorerPanel />

      {showLegacyRomPlanning && (
      <>
      <SectionCard title="작업 선택" description="현재 단계에서는 ROM 추가의 복사 전 확인 흐름을 확정합니다. 삭제와 MiSTer 간 복사는 다음 단계에서 같은 안전장치를 붙여 활성화합니다." tone="dry">
        <div className="action-row">
          <button className="button primary">ROM 추가</button>
          <button className="button" disabled>ROM 삭제 잠김</button>
          <button className="button" disabled>MiSTer 간 복사 잠김</button>
          <button className="button" disabled>복사 기록 준비 중</button>
        </div>
        <p className="muted">실제 복사, 삭제, 원격 폴더 생성, 덮어쓰기는 아직 실행하지 않습니다. 이 화면은 대상 MiSTer, 대상 폴더, 같은 이름 파일, 저장공간, 덮어쓰기 선택을 확인하는 단계입니다.</p>
      </SectionCard>

      <SectionCard title="ROM 관리 흐름" description="게임 리스트는 카드 제작/실행/NFC 연결용 목록이고, ROM 관리는 파일 복사/삭제/이동을 위한 화면입니다." tone="dry">
        <div className="flow-steps">
          {formatGameManagementSteps().map((step, index) => (
            <span className="flow-step" data-step={index + 1} key={step}>{step}</span>
          ))}
        </div>
        <div className="summary-strip">
          <StatusBadge label={`ROM 후보 ${candidates.length}개`} tone={candidates.length ? 'safe' : 'dry'} />
          <StatusBadge label={`원격 폴더 ${folders.length}개`} tone={folders.length ? 'safe' : 'warning'} />
          <StatusBadge label={`충돌 ${conflictTotal}개`} tone={conflictTotal ? 'warning' : 'safe'} />
          <StatusBadge label={`차단 ${planSummary.blockedCount}개`} tone={planSummary.blockedCount ? 'danger' : 'safe'} />
          <StatusBadge label="실제 복사 아님" tone="dry" />
        </div>
        <p className="simple-note">{formatLockedTransferSummary()}</p>
      </SectionCard>

      <div className="grid two">
        <SectionCard title="PC에서 추가할 ROM 선택" description="파일 metadata만 읽습니다. hash 계산은 사용자가 요청한 파일에만 수행합니다.">
          <div className="action-row">
            <button className="button primary" onClick={() => void selectRomFiles()}><FolderOpen size={16} /> ROM 파일 선택</button>
            <button className="button" onClick={() => void selectRomFolder()}><FolderSearch size={16} /> ROM 폴더 선택</button>
            <label className="toggle-row">
              <input type="checkbox" checked={recursiveScan} onChange={(event) => setRecursiveScan(event.target.checked)} />
              하위 폴더 재귀 스캔
            </label>
          </div>
          <p className="muted">기본 폴더 스캔은 1단계만 읽습니다. 500개 이상이면 대량 파일 검사 경고를 표시합니다.</p>
        </SectionCard>

        <SectionCard title="MiSTer 대상 폴더" description="MiSTer 연결 메뉴에서 연결한 장치의 /media/fat/games 1단계 폴더만 읽습니다." tone={!activeSession || !activeHostTrusted ? 'warning' : 'dry'}>
          <div className="action-row">
            <button className="button primary" onClick={() => void loadGameFolders()} disabled={!activeSession || !activeHostTrusted}><HardDrive size={16} /> 대상 폴더 읽기</button>
            <StatusBadge label={activeSession ? 'session 있음' : 'session 필요'} tone={activeSession ? 'safe' : 'warning'} />
            <StatusBadge label={activeHostTrusted ? '신뢰 키 확인됨' : '신뢰 키 확인 필요'} tone={activeHostTrusted ? 'safe' : 'warning'} />
          </div>
          <p className="muted">{defaultProfile ? `${misterDisplayName(defaultProfile)} @ ${defaultProfile.ipAddress}` : '저장된 기본 프로필이 없습니다.'}</p>
          <p className="muted">원격 폴더 {folders.length}개 · 저장공간 {remoteStorage?.usePercent ?? '?'}% 사용</p>
        </SectionCard>
      </div>

      <SectionCard title="대량 ROM 스캔 상태" description="진행률, 대량 파일 경고, 취소 요청, hash 진행률을 표시합니다. 모든 동작은 로컬 metadata 읽기 또는 복사 전 확인입니다.">
        <div className="action-row">
          <label className="toggle-row">
            <input type="checkbox" checked={allowVeryLargeScan} onChange={(event) => setAllowVeryLargeScan(event.target.checked)} />
            10000개 이상 스캔을 명시적으로 허용
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={keepPartialOnCancel} onChange={(event) => setKeepPartialOnCancel(event.target.checked)} />
            취소 시 부분 결과 유지
          </label>
          <button className="button small" disabled={!scanProgress || scanProgress.status !== 'running'} onClick={cancelLocalScan}>스캔 취소</button>
        </div>
        {scanProgress ? (
          <div className="source-card">
            <strong>{scanProgress.status}</strong>
            <p className="muted">
              처리 {scanProgress.processedFiles}
              {typeof scanProgress.totalEstimatedFiles === 'number' ? ` / ${scanProgress.totalEstimatedFiles}` : ''}
              {scanProgress.currentFileName ? ` · 현재 ${scanProgress.currentFileName}` : ''}
              {` · 경과 ${(scanProgress.elapsedMs / 1000).toFixed(1)}초`}
            </p>
          </div>
        ) : <p className="muted">아직 실행 중인 ROM 스캔이 없습니다.</p>}
        {scanWarnings.map((warning) => (
          <div className="danger-box" key={`${warning.level}-${warning.threshold}-current`}>
            {warning.message}
          </div>
        ))}
        {scanProgress?.warnings.map((warning) => (
          <div className="danger-box" key={`${warning.level}-${warning.threshold}`}>
            {warning.message}
          </div>
        ))}
        {scanCancellation && <p className="muted">{scanCancellation.message}</p>}
        {hashProgress && (
          <p className="muted">
            hash 상태: {hashProgress.fileName || '선택 파일'} · {hashProgress.status} · {formatBytes(hashProgress.processedBytes)} / {formatBytes(hashProgress.totalBytes)}
          </p>
        )}
      </SectionCard>

      <SectionCard title="선택한 ROM 후보" description="확장자, 파일명, 폴더명, 수동 플랫폼 선택, MiSTer 대상 폴더 기준으로 복사 위치를 추천합니다.">
        {localFiles.length >= 500 && <div className="danger-box">500개 이상 파일이 선택되었습니다. 대량 파일 검사는 오래 걸릴 수 있습니다.</div>}
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>파일</th>
                <th>경로</th>
                <th>크기</th>
                <th>후보/override</th>
                <th>추천 대상</th>
                <th>상태</th>
                <th>hash</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => (
                <tr key={candidate.id}>
                  <td><strong>{candidate.fileName}</strong><br /><span className="muted">{candidate.extension}</span></td>
                  <td><code>{candidate.filePath}</code></td>
                  <td>{formatBytes(candidate.sizeBytes)}<br /><span className="muted">{candidate.modifiedAt ? new Date(candidate.modifiedAt).toLocaleString() : '수정일 없음'}</span></td>
                  <td>
                    <select value={manualOverrides[candidate.id] || ''} onChange={(event) => setManualOverrides((current) => ({ ...current, [candidate.id]: event.target.value }))}>
                      <option value="">자동 추천</option>
                      {romPlatformCandidates.map((platform) => <option key={platform.platform} value={platform.platform}>{platform.label}</option>)}
                    </select>
                    <small className="muted">{candidate.platformGuesses.map((guess) => `${guess.platform}(${guess.confidence})`).join(', ') || '후보 없음'}</small>
                  </td>
                  <td>{candidate.recommendation?.targetRemotePath || '플랫폼 선택 필요'}<br /><span className="muted">{candidate.recommendation?.reason}</span></td>
                  <td><StatusBadge label={candidate.status} tone={candidate.status === 'ready' ? 'safe' : candidate.status === 'blocked' || candidate.status === 'target-missing' ? 'danger' : 'warning'} /></td>
                  <td>
                    <button className="button small" disabled={candidate.hashStatus === 'calculating'} onClick={() => void calculateHash(candidate)}>hash 계산</button>
                    <small className="muted">{candidate.hashStatus}{candidate.sha256 ? ` · ${candidate.sha256.slice(0, 12)}...` : ''}</small>
                  </td>
                </tr>
              ))}
              {candidates.length === 0 && <tr><td colSpan={7}>아직 선택된 ROM 후보가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="복사 전 확인 절차" description="실제 MiSTer와 큰 ROM 세트를 기준으로 대상 폴더 읽기, PC ROM 선택, 같은 이름 파일, 백업 계획, 저장/내보내기 준비를 단계별로 확인합니다.">
        <div className="action-row">
          <button className="button primary" onClick={() => refreshValidationSession(dryRunResult?.plan, Boolean(dryRunResult))}>복사 전 확인 실행</button>
          <StatusBadge label={validationSession?.summary.status || '대기'} tone={validationSession?.summary.status === 'success' ? 'safe' : validationSession ? 'warning' : 'dry'} />
          <span className="muted">{validationSession?.summary.message || '아직 검증 세션이 없습니다.'}</span>
        </div>
        {validationSession && (
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>단계</th>
                  <th>상태</th>
                  <th>요약</th>
                  <th>오류 코드</th>
                </tr>
              </thead>
              <tbody>
                {validationSession.steps.map((step) => (
                  <tr key={step.id}>
                    <td>{step.label}</td>
                    <td><StatusBadge label={step.status} tone={step.status === 'success' ? 'safe' : step.status === 'blocked' || step.status === 'failed' ? 'danger' : 'warning'} /></td>
                    <td>{step.resultSummary || step.sanitizedMessage || '-'}</td>
                    <td>{step.errorCode || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="실제 장치 dry-run 검증 기록" description="실제 MiSTer와 실제 ROM 세트로 돌린 dry-run 결과를 credential 없이 저장하고 나중에 검토합니다.">
        <div className="action-row">
          <button className="button primary" disabled={!validationSession} onClick={() => void saveValidationRecord()}>현재 검증 기록 저장</button>
          <button className="button" disabled={!selectedValidationRecord} onClick={() => selectedValidationRecord && void exportValidationRecordJson(selectedValidationRecord)}><FileJson size={16} /> 선택 기록 JSON 내보내기</button>
          <button className="button" disabled={!selectedValidationRecord} onClick={() => selectedValidationRecord && void exportDryRunReport(selectedValidationRecord, 'markdown')}>Markdown 리포트</button>
          <button className="button" disabled={!selectedValidationRecord} onClick={() => selectedValidationRecord && void exportDryRunReport(selectedValidationRecord, 'json')}>JSON 리포트</button>
          <button className="button danger" disabled={!selectedValidationRecord} onClick={() => selectedValidationRecord && void deleteValidationRecord(selectedValidationRecord.validationSessionId)}>선택 기록 삭제</button>
          <StatusBadge label={`${validationRecords.length}개 저장됨`} tone={validationRecords.length ? 'safe' : 'dry'} />
        </div>
        <div className="action-row">
          <select value={validationRecordFilter} onChange={(event) => setValidationRecordFilter(event.target.value as RomDryRunValidationFilter)}>
            <option value="all">전체</option>
            <option value="passed">통과</option>
            <option value="partial">부분 통과</option>
            <option value="blocked">차단됨</option>
            <option value="hostKeyIssue">host key 문제</option>
            <option value="storageIssue">저장공간 문제</option>
            <option value="needsManualPlatform">플랫폼 수동 선택 필요</option>
            <option value="hasConflict">충돌 있음</option>
          </select>
          <select value={validationRecordSort} onChange={(event) => setValidationRecordSort(event.target.value as RomDryRunValidationSort)}>
            <option value="date-desc">날짜 최신순</option>
            <option value="date-asc">날짜 오래된순</option>
            <option value="file-count">파일 수</option>
            <option value="total-size">총 용량</option>
            <option value="conflict-count">충돌 수</option>
            <option value="blocked-count">차단 수</option>
          </select>
        </div>
        <label className="field">
          사용자 메모
          <textarea value={validationUserNote} onChange={(event) => setValidationUserNote(event.target.value)} placeholder="예: 실제 MiSTer 192.168.0.42, 1200개 ROM 세트로 dry-run 확인" />
        </label>
        <div className="grid two">
          <div className="source-card">
            <strong>검증 체크리스트</strong>
            {validationChecklistLabels.map((item) => (
              <label className="toggle-row" key={item.key}>
                <input
                  type="checkbox"
                  checked={validationChecklist[item.key]}
                  onChange={(event) => updateValidationChecklist(item.key, event.target.checked)}
                />
                {item.label}
              </label>
            ))}
          </div>
          <div className="source-card">
            <strong>저장된 검증 세션</strong>
            {displayedValidationRecords.length ? displayedValidationRecords.map((record) => {
              const grade = calculateValidationGrade(record);
              return (
              <button
                className={`button small ${selectedValidationRecordId === record.validationSessionId ? 'primary' : ''}`}
                key={record.validationSessionId}
                onClick={() => setSelectedValidationRecordId(record.validationSessionId)}
              >
                {record.createdAt.slice(0, 19).replace('T', ' ')} · {record.targetAlias || record.targetHost || '대상 미정'} · {formatValidationGrade(grade)}
              </button>
              );
            }) : <p className="muted">필터에 맞는 dry-run 검증 기록이 없습니다.</p>}
          </div>
        </div>
        {selectedValidationRecord && (
          <>
            <div className="danger-box">
              <strong>선택 기록 요약</strong>
              <StatusBadge label={formatValidationGrade(calculateValidationGrade(selectedValidationRecord))} tone={calculateValidationGrade(selectedValidationRecord) === 'passed' ? 'safe' : 'warning'} />
              <span>{selectedValidationRecord.sanitizedSummary}</span>
              <span>후보 {selectedValidationRecord.romCandidateCount}개 · 충돌 {selectedValidationRecord.conflictCount}개 · 차단 {selectedValidationRecord.blockedCount}개 · 저장공간 {selectedValidationRecord.storageStatus}</span>
              <span>local full path 포함 여부: {selectedValidationRecord.includesFullLocalPaths ? '포함' : '기본 숨김'}</span>
            </div>
            <label className="field">
              선택 기록 메모 편집
              <textarea defaultValue={selectedValidationRecord.userNote || ''} onBlur={(event) => void updateSelectedValidationRecordNote(event.target.value)} />
            </label>
            <div className="source-card">
              <strong>선택 기록 체크리스트 편집</strong>
              {validationChecklistLabels.map((item) => (
                <label className="toggle-row" key={`${selectedValidationRecord.validationSessionId}-${item.key}`}>
                  <input
                    type="checkbox"
                    checked={selectedValidationRecord.checklist[item.key]}
                    onChange={(event) => void updateSelectedValidationRecordChecklist(item.key, event.target.checked)}
                  />
                  {item.label}
                </label>
              ))}
            </div>
            {validationComparison && (
              <div className="source-card">
                <strong>이전/현재 기록 비교</strong>
                <p className="muted">{validationComparison.summary}</p>
                <p className="muted">총 용량 변화 {formatBytes(Math.abs(validationComparison.totalSizeDeltaBytes))} · 저장공간 상태 변화 {String(validationComparison.storageStatusChanged)} · 대상 프로필 변화 {String(validationComparison.targetProfileChanged)}</p>
              </div>
            )}
          </>
        )}
      </SectionCard>

      <SectionCard title="ROM dry-run 실사용 검토 체크리스트" description="실제 ROM 세트와 실제 MiSTer를 기준으로 dry-run 검토 항목을 저장합니다. 실제 복사 활성화 버튼은 없습니다.">
        <div className="danger-box">
          <StatusBadge label={romReviewChecklist ? formatReviewChecklistGrade(romReviewChecklist.grade) : '검토 전'} tone={romReviewChecklist?.grade === 'needs-fix' ? 'danger' : romReviewChecklist?.grade === 'ready-to-consider-transfer' ? 'safe' : 'dry'} />
          <span>로컬 ROM 선택, 위험 확장자 수동 처리, 원격 snapshot, 충돌/용량/백업/시뮬레이션 검토를 한 곳에서 기록합니다.</span>
        </div>
        <div className="action-row">
          <button className="button" disabled={!romReviewChecklist} onClick={saveRomReviewNote}>체크리스트 메모 저장</button>
          <button className="button" disabled={!romReviewChecklist} onClick={() => void exportRomReviewChecklist('markdown')}>Markdown 내보내기</button>
          <button className="button" disabled={!romReviewChecklist} onClick={() => void exportRomReviewChecklist('json')}>JSON 내보내기</button>
          <button className="button danger" disabled title="실제 전송 활성화 버튼은 12차 범위에 없습니다.">실제 전송 활성화</button>
        </div>
        <label className="field">
          사용자 메모
          <textarea value={romReviewNote} onChange={(event) => setRomReviewNote(event.target.value)} placeholder="실제 ROM 폴더, 파일 수, 충돌 검토 결과, 내보낸 리포트 위치를 기록합니다." />
        </label>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>항목</th>
                <th>상태</th>
                <th>필수</th>
              </tr>
            </thead>
            <tbody>
              {romReviewChecklist?.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.label}</td>
                  <td>
                    <select value={item.status} onChange={(event) => updateRomReviewStatus(item.id, event.target.value as ReviewChecklistStatus)}>
                      <option value="unchecked">미확인</option>
                      <option value="passed">통과</option>
                      <option value="failed">실패</option>
                      <option value="not-applicable">해당 없음</option>
                    </select>
                  </td>
                  <td><StatusBadge label={item.required ? '필수' : '선택'} tone={item.required ? 'warning' : 'dry'} /></td>
                </tr>
              )) || <tr><td colSpan={3}>체크리스트를 불러오는 중입니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="충돌/용량 검사와 복사 계획" description="대상 폴더의 1단계 파일 목록만 읽고, 저장공간과 같은 이름 파일 여부를 복사 전 확인으로 계산합니다.">
        <div className="action-row">
          <button className="button" disabled={!candidates.length || !folders.length} onClick={() => void compareRemoteFolders()}><ListChecks size={16} /> 원격 폴더와 비교</button>
          <button className="button primary" disabled={!candidates.length} onClick={() => createCopyPlan()}>복사 계획 생성</button>
          <button className="button" disabled={!dryRunResult} onClick={() => applyBulk('skipSameSize')}>같은 이름/같은 크기 모두 skip</button>
          <button className="button" disabled={!dryRunResult} onClick={() => applyBulk('blockMissing')}>대상 폴더 없음 모두 block</button>
          <button className="button" disabled={!dryRunResult} onClick={() => applyBulk('blockUnsupported')}>미지원 확장자 모두 block</button>
          <button className="button" disabled={!dryRunResult} onClick={() => applyBulk('showManual')}>플랫폼 선택 필요만 보기</button>
          <button className="button" disabled={!dryRunResult} onClick={() => applyBulk('showMissing')}>대상 폴더 없음만 보기</button>
          <button className="button" disabled={!dryRunResult} onClick={() => applyBulk('showConflicts')}>충돌 항목만 보기</button>
        </div>
        {storageDryRun && (
          <div className="danger-box">
            저장공간 {storageDryRun.status} · 선택 파일 {formatBytes(storageDryRun.requirement.totalSizeBytes)} · 필요 여유 {formatBytes(storageDryRun.requirement.requiredFreeBytes)} · 원격 여유 {formatBytes(storageDryRun.remoteFreeBytes)}
          </div>
        )}
        {!dryRunResult && (
          <div className="source-card">
            <strong>복사 계획 요약</strong>
            <p className="muted">아직 복사 계획이 없습니다. ROM 후보를 선택한 뒤 “복사 계획 생성”을 누르면 파일 수, action, 충돌, 용량 요약이 여기에 표시됩니다.</p>
          </div>
        )}
        {dryRunResult && (
          <>
            <div className="source-card">
              <strong>복사 계획 요약</strong>
              <p className="muted">
                총 {planSummary.totalFileCount}개 · 복사 예정 {planSummary.copyLaterCount}개 · skip {planSummary.skipCount}개 · replace 예정 {planSummary.replaceLaterCount}개 · rename 예정 {planSummary.renameLaterCount}개 · 폴더 생성 예정 {planSummary.folderCreationCount}개 · block {planSummary.blockedCount}개
              </p>
              <p className="muted">
                총 용량 {formatBytes(planSummary.totalSizeBytes)} · 복사 예정 용량 {formatBytes(planSummary.totalCopySizeBytes)} · 원격 여유 {formatBytes(planSummary.remoteFreeBytes)}
              </p>
            </div>
            <div className="action-row">
              {(['all', 'ready', 'conflict', 'manual', 'blocked', 'targetFolderMissing', 'unsupportedExtension', 'replaceLater'] as const).map((filter) => (
                <button key={filter} className={`button small ${planFilter === filter ? 'primary' : ''}`} onClick={() => setPlanFilter(filter)}>{filter}</button>
              ))}
              <select value={planSort} onChange={(event) => setPlanSort(event.target.value as RomPlanSortMode)}>
                <option value="name">이름순</option>
                <option value="size-desc">크기 큰 순</option>
                <option value="size-asc">크기 작은 순</option>
                <option value="platform">플랫폼순</option>
                <option value="action">action순</option>
                <option value="conflict">conflict순</option>
              </select>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>파일</th>
                  <th>대상</th>
                  <th>충돌</th>
                  <th>action</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {visiblePlans.map((plan) => {
                  const policy = getPolicyForConflict(plan.conflictType);
                  return (
                    <tr key={plan.candidateId}>
                      <td>{plan.fileName}<br /><span className="muted">{formatBytes(plan.sizeBytes)}</span></td>
                      <td>{plan.targetRemotePath || '대상 미정'}</td>
                      <td>{plan.conflictType}<br /><span className="muted">{plan.warning || policy.description}</span></td>
                      <td>
                        <select value={normalizePlannedAction(actionOverrides[plan.candidateId] || plan.action)} onChange={(event) => updateAction(plan.candidateId, event.target.value as RomPlannedAction)}>
                          {policy.allowedActions.map((action) => <option key={action} value={normalizePlannedAction(action)}>{summarizeAction(action)}</option>)}
                        </select>
                        <StatusBadge label={summarizeAction(actionOverrides[plan.candidateId] || plan.action)} tone={actionTone(actionOverrides[plan.candidateId] || plan.action)} />
                      </td>
                      <td><StatusBadge label={plan.status} tone={planStatusTone(plan.status)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredPlans.length > visiblePlans.length && (
              <p className="compact-table-note">기본 모드에서는 처음 {visiblePlans.length}개만 표시합니다. 전체 계획 테이블은 고급 모드에서 확인하세요.</p>
            )}
          </>
        )}
      </SectionCard>

      <div className="grid two">
        <SectionCard title="대상 폴더 생성 dry-run" description="대상 폴더가 없을 때 createFolderLater 계획만 만듭니다. 실제 mkdir은 비활성입니다.">
          {dryRunResult?.plan.perFilePlan.filter((item) => item.conflictType === 'targetFolderMissing').map((item) => (
            <div className="source-card" key={item.candidateId}>
              <strong>{item.fileName}</strong>
              <p className="muted">추천 대상: {item.targetRemotePath || '없음'}</p>
              <input
                value={folderNameOverrides[item.candidateId] || item.targetFolder?.split('/').pop() || item.recommendedPlatform || ''}
                onChange={(event) => updateFolderName(item.candidateId, event.target.value)}
                placeholder="생성 예정 폴더명"
              />
              <div className="action-row">
                <button className="button small" onClick={() => updateAction(item.candidateId, 'createFolderLater')}>폴더 생성 예정으로 표시</button>
                <button className="button small" onClick={() => updateAction(item.candidateId, 'chooseDifferentFolder')}>다른 기존 폴더 선택</button>
                <button className="button small danger" onClick={() => updateAction(item.candidateId, 'block')}>차단</button>
              </div>
            </div>
          ))}
          {folderPlans.length > 0 ? folderPlans.map((plan) => (
            <div className="status-line" key={`${plan.folderName}-${plan.targetRemotePath}`}>
              <StatusBadge label={plan.status} tone={plan.validation.ok ? 'warning' : 'danger'} />
              <span>{plan.targetRemotePath}</span>
              <small className="muted">{plan.validation.message}</small>
            </div>
          )) : <p className="muted">폴더 생성 예정 항목이 없습니다.</p>}
        </SectionCard>

        <SectionCard title="복사 전 백업 계획" description="replaceLater 항목은 실제 복사 전 백업이 필요합니다. 이번 단계에서는 계획만 만듭니다.">
          <div className="action-row">
            <button className="button" onClick={() => void selectBackupFolder()}>로컬 백업 위치 선택</button>
            <button className="button" disabled={!backupPlan?.items.length} onClick={() => void exportBackupPlanJson()}>백업 계획 JSON 내보내기</button>
            <button className="button" disabled>실제 백업 실행 비활성</button>
          </div>
          <p className="muted">백업 위치: {backupRootLocalPath || '아직 선택하지 않음'}</p>
          <p>replaceLater 파일 {backupPlan?.items.length || 0}개 · 예상 백업 크기 {formatBytes(backupPlan?.totalSizeBytes)}</p>
          {backupPlan?.items.map((item) => (
            <div className="status-line" key={item.candidateId}>
              <StatusBadge label="백업 필요" tone="warning" />
              <span>{item.remotePath}</span>
              <small className="muted">{item.backupTargetLocalPathPreview || '로컬 백업 위치 필요'}</small>
            </div>
          ))}
        </SectionCard>
      </div>

      <SectionCard title="최종 확인과 계획 저장" description="실제 복사 기능은 아직 비활성입니다. 최종 확인 modal은 다음 단계의 안전장치를 미리 검증합니다.">
        <div className="action-row">
          <button className="button" disabled={!dryRunResult} onClick={openFinalConfirmation}>최종 확인 열기</button>
          <button className="button" disabled={!dryRunResult} onClick={() => void saveCurrentPlan()}><Save size={16} /> 계획 저장</button>
          <button className="button" disabled={!dryRunResult} onClick={() => void exportPlanJson()}><FileJson size={16} /> 계획 JSON 내보내기</button>
          <button className="button" disabled>실제 복사 실행</button>
          <label className="toggle-row">
            <input type="checkbox" checked={includeFullLocalPaths} onChange={(event) => setIncludeFullLocalPaths(event.target.checked)} />
            JSON에 로컬 전체 경로 포함
          </label>
        </div>
        {dryRunResult?.plan.validation && (
          <div className="danger-box">
            차단 {dryRunResult.plan.validation.blockers.length}개 · 위험 {dryRunResult.plan.validation.risks.length}개 · 경고 {dryRunResult.plan.validation.warnings.length}개
          </div>
        )}
      </SectionCard>

      <SectionCard title="전송 안전 정책" description="실제 전송 adapter를 열기 전에 backup/temp/hash/retry/cancel/rollback 정책을 코드와 UI에 고정합니다.">
        <div className="grid two">
          {Object.entries(romTransferPolicyMessages).map(([key, policy]) => (
            <details className="source-card" key={key} open={key === 'backup'}>
              <summary>
                {policy.title} <StatusBadge label={policy.risk} tone={policy.risk === '안전' ? 'safe' : policy.risk === '주의' ? 'warning' : 'danger'} />
              </summary>
              <ul>{policy.body.map((line) => <li key={line}>{line}</li>)}</ul>
            </details>
          ))}
        </div>
        <div className="grid two">
          <div className="source-card">
            <strong>Backup / temp / verify 정책</strong>
            <p className="muted">replaceLater: {romTransferSafetyPolicy.backup.requireBackupForReplace ? '백업 계획 필수' : '백업 선택'} · 기본 백업: {romTransferSafetyPolicy.backup.mode}</p>
            <p className="muted">temp 파일: {romTransferSafetyPolicy.tempFile.suffix} · 실제 temp 생성: {romTransferSafetyPolicy.tempFile.implemented ? '구현됨' : '아직 금지'}</p>
            <p className="muted">검증: {romTransferSafetyPolicy.verify.defaultMode} · SHA-256: {romTransferSafetyPolicy.verify.requireExplicitHashForLargeFiles ? '사용자 opt-in 필요' : '자동'}</p>
          </div>
          <div className="source-card">
            <strong>Retry / cancel / rollback 정책</strong>
            <p className="muted">재시도 가능: {romTransferSafetyPolicy.retry.retryableErrors.join(', ')}</p>
            <p className="muted">재시도 금지: {romTransferSafetyPolicy.retry.nonRetryableErrors.join(', ')}</p>
            <p className="muted">취소: {romTransferSafetyPolicy.cancel.simulatedCancelOnly ? '이번 단계는 simulated cancel만 지원' : '실제 취소 지원'}</p>
            <ul>
              {romTransferSafetyPolicy.rollbackLimitations.map((item) => <li key={item.code}>{item.message}</li>)}
            </ul>
          </div>
        </div>
        <div className="danger-box">
          <ShieldCheck size={18} />
          <span>feature flag: transfer={String(currentFeatureFlags.transferEnabled)}, upload={String(currentFeatureFlags.uploadEnabled)}, mkdir={String(currentFeatureFlags.mkdirEnabled)}, overwrite={String(currentFeatureFlags.overwriteEnabled)}, rename={String(currentFeatureFlags.renameEnabled)}, delete={String(currentFeatureFlags.deleteEnabled)}</span>
          <span>kill switch: {String(currentKillSwitch.romTransferKillSwitch)} · {currentKillSwitch.reason}</span>
        </div>
      </SectionCard>

      <SectionCard title="전송 preflight와 시뮬레이션" description="실제 복사가 아닌 UI/진행률 검증용 시뮬레이션입니다. 원격 파일 변경 없음, 실제 복사 아님 상태로만 기록합니다.">
        <div className="action-row">
          <button className="button" disabled={!dryRunResult} onClick={refreshPreflight}>preflight 다시 계산</button>
          <select value={simulationFailureMode} onChange={(event) => setSimulationFailureMode(event.target.value as RomSimulatedTransferFailureMode)}>
            {(['none', 'network-timeout', 'verify-failed', 'storage-changed', 'user-cancel'] as const).map((mode) => (
              <option key={mode} value={mode}>{simulatedTransferService.formatFailureMode(mode)}</option>
            ))}
          </select>
          <button className="button primary" disabled={!dryRunResult} onClick={runSimulatedTransfer}>전송 시뮬레이션 실행</button>
          <button className="button danger" disabled={!simulatedTransferSession || simulatedTransferSession.status !== 'running'} onClick={cancelSimulatedTransfer}>시뮬레이션 취소</button>
          <button className="button danger" disabled title="실제 복사는 feature flag와 kill switch, 별도 write adapter 검증 전까지 잠겨 있습니다.">실제 복사 실행</button>
        </div>
        {preflightResult && (
          <div className="source-card">
            <strong>Preflight 결과</strong>
            <p className="muted">시뮬레이션 가능: {String(preflightResult.canSimulate)} · 준비 가능: {String(preflightResult.canPrepare)} · 실제 전송 가능: {String(preflightResult.canExecute)}</p>
            {preflightResult.blockers.length > 0 && (
              <ul>{preflightResult.blockers.map((blocker) => <li key={`${blocker.code}-${blocker.message}`}>{blocker.code}: {formatPreflightBlocker(blocker)}</li>)}</ul>
            )}
            {preflightResult.requiredActions.length > 0 && <p className="muted">필수 조치: {preflightResult.requiredActions.join(' / ')}</p>}
            {preflightResult.warnings.length > 0 && <p className="muted">경고: {preflightResult.warnings.map((warning) => `${warning.code}: ${warning.message}`).join(' / ')}</p>}
          </div>
        )}
        {simulatedTransferSession && (
          <div className="danger-box">
            <StatusBadge label="시뮬레이션" tone="dry" />
            <StatusBadge label="원격 파일 변경 없음" tone="safe" />
            <StatusBadge label="실제 복사 아님" tone="warning" />
            <span>{simulatedTransferSession.message}</span>
            <span>{simulatedTransferSession.progress.processedFiles}/{simulatedTransferSession.progress.totalFiles} files · {simulatedTransferSession.progress.percent}% · remoteWritesPerformed={String(simulatedTransferSession.remoteWritesPerformed)}</span>
            <details>
              <summary>시뮬레이션 로그</summary>
              <ul>{simulatedTransferSession.logs.map((log) => <li key={log}>{log}</li>)}</ul>
            </details>
          </div>
        )}
        <div className="source-card">
          <strong>시뮬레이션 기록과 리포트</strong>
          <p className="muted">이 리포트는 시뮬레이션 결과입니다. 원격 MiSTer에는 어떤 파일도 쓰지 않았습니다. 실제 ROM 복사가 아닙니다.</p>
          <div className="action-row">
            <button className="button" disabled={!selectedSimulationRecord} onClick={() => selectedSimulationRecord && void exportSimulationReport(selectedSimulationRecord, 'markdown')}>시뮬레이션 Markdown 리포트</button>
            <button className="button" disabled={!selectedSimulationRecord} onClick={() => selectedSimulationRecord && void exportSimulationReport(selectedSimulationRecord, 'json')}>시뮬레이션 JSON 리포트</button>
            <button className="button danger" disabled={!selectedSimulationRecord} onClick={() => selectedSimulationRecord && void deleteSimulationRecord(selectedSimulationRecord.simulationRecordId)}>시뮬레이션 기록 삭제</button>
          </div>
          {simulationRecords.length ? simulationRecords.map((record) => (
            <button
              className={`button small ${selectedSimulationRecordId === record.simulationRecordId ? 'primary' : ''}`}
              key={record.simulationRecordId}
              onClick={() => setSelectedSimulationRecordId(record.simulationRecordId)}
            >
              {record.createdAt.slice(0, 19).replace('T', ' ')} · {record.status} · {record.simulatedFileCount} files · 실제 복사 아님
            </button>
          )) : <p className="muted">저장된 시뮬레이션 기록이 없습니다.</p>}
          {selectedSimulationRecord && (
            <p className="muted">선택 기록: {selectedSimulationRecord.message} · remoteWritesPerformed={String(selectedSimulationRecord.remoteWritesPerformed)}</p>
          )}
        </div>
      </SectionCard>

      <SectionCard title="최근 저장된 ROM 계획" description="저장된 계획은 credential 없이 appData 또는 브라우저 저장소에 보관됩니다.">
        {savedPlans.length ? savedPlans.map((plan) => (
          <div className="source-card" key={plan.metadata.id}>
            <strong>{plan.metadata.title}</strong>
            <p className="muted">{plan.metadata.fileCount}개 · {formatBytes(plan.metadata.totalSizeBytes)} · {plan.metadata.targetAlias || plan.metadata.targetHost || '대상 미정'}</p>
            <div className="action-row">
              <button className="button small" onClick={() => loadSavedPlan(plan)}>불러오기</button>
              <button className="button small danger" onClick={() => void deleteSavedPlan(plan.metadata.id)}>삭제</button>
            </div>
          </div>
        )) : <p className="muted">저장된 ROM 계획이 없습니다.</p>}
      </SectionCard>

      <SectionCard title="실제 전송 기능 검토 체크리스트" description="실제 transfer adapter를 열기 전 반드시 확인해야 할 항목입니다. 이 화면에는 실제 전송 활성화 버튼이 없습니다.">
        <div className="danger-box">
          <ShieldCheck size={18} />
          <span>{readinessChecklist?.lockedMessage || '실제 전송은 아직 잠겨 있습니다.'}</span>
        </div>
        <div className="action-row">
          <button className="button" disabled={!readinessChecklist} onClick={() => void saveReadinessNote()}>체크리스트 메모 저장</button>
          <button className="button" disabled={!readinessChecklist} onClick={() => void exportReadinessChecklist('markdown')}>체크리스트 Markdown 내보내기</button>
          <button className="button" disabled={!readinessChecklist} onClick={() => void exportReadinessChecklist('json')}>체크리스트 JSON 내보내기</button>
          <button className="button danger" disabled title="실제 전송 활성화 버튼은 11차 범위에 없습니다.">실제 전송 활성화</button>
        </div>
        <label className="field">
          체크리스트 메모
          <textarea value={readinessNote} onChange={(event) => setReadinessNote(event.target.value)} placeholder="실제 장치 검증, 실패 시나리오 확인, 운영 메모를 남깁니다." />
        </label>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>항목</th>
                <th>상태</th>
                <th>필수</th>
              </tr>
            </thead>
            <tbody>
              {readinessChecklist?.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.label}</td>
                  <td>
                    <select value={item.status} onChange={(event) => void updateReadinessStatus(item.id, event.target.value as RomTransferReadinessStatus)}>
                      <option value="unchecked">미확인</option>
                      <option value="passed">통과</option>
                      <option value="failed">실패</option>
                      <option value="not-applicable">해당 없음</option>
                    </select>
                  </td>
                  <td><StatusBadge label={item.required ? '필수' : '선택'} tone={item.required ? 'warning' : 'dry'} /></td>
                </tr>
              )) || <tr><td colSpan={3}>체크리스트를 불러오는 중입니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="transfer adapter 설계와 rollback 한계" description="실제 복사 adapter는 아직 disabled입니다. 아래 내용은 다음 단계 구현 전 검증해야 할 설계 문서입니다.">
        <div className="grid two">
          <div>
            <h3>미래 transfer phase</h3>
            {romTransferDesignPhases.map((phase) => (
              <div className="status-line" key={phase.id}>
                <StatusBadge label={phase.writeOperationRequired ? 'write 필요' : 'read/검증'} tone={phase.writeOperationRequired ? 'danger' : 'dry'} />
                <span>{phase.label}</span>
                <small className="muted">{phase.description}</small>
              </div>
            ))}
          </div>
          <div>
            <h3>실패/rollback 한계</h3>
            {romTransferRollbackLimits.map((limit) => (
              <div className="status-line" key={limit.code}>
                <StatusBadge label={limit.code} tone="warning" />
                <span>{limit.description}</span>
              </div>
            ))}
            <h3>구현 전 필수 조건</h3>
            <ul>
              {romTransferImplementationPrerequisites.map((item) => <li key={item.id}>{item.label}</li>)}
            </ul>
          </div>
        </div>
        <details>
          <summary>실패 시나리오 보기</summary>
          <ul>
            {romTransferFailureScenarios.map((scenario) => (
              <li key={scenario.code}><strong>{scenario.label}</strong>: {scenario.mitigation}</li>
            ))}
          </ul>
        </details>
      </SectionCard>

      <SectionCard title="안전 상태" tone="warning">
        <div className="danger-box">
          <ShieldCheck size={18} />
          <span>이번 단계는 충돌 정책, 폴더 생성 계획, 백업 계획, 최종 확인, transfer disabled guard만 제공합니다. 원격 ROM 복사/삭제/rename/overwrite/mkdir는 구현하지 않았습니다.</span>
        </div>
      </SectionCard>
      <pre className="log-box">{message}</pre>
      </>
      )}

      {showFinalModal && finalSummary && (
        <div className="modal-backdrop" role="presentation">
          <div className="compare-modal" role="dialog" aria-modal="true" aria-label="ROM 최종 확인">
            <div className="modal-header">
              <h3>ROM 최종 확인</h3>
              <button className="button compact" onClick={() => setShowFinalModal(false)}>닫기</button>
            </div>
            <p className="muted">현재는 실제 복사가 비활성화되어 있습니다. 이 modal은 다음 단계의 실행 전 안전장치 구조입니다.</p>
            <div className="grid two">
              <div>
                <p><strong>대상:</strong> {finalSummary.targetAlias || finalSummary.targetHost || '미정'}</p>
                <p><strong>경로:</strong> {finalSummary.targetBasePath}</p>
                <p><strong>복사 예정:</strong> {finalSummary.copyFileCount}개 / {formatBytes(finalSummary.totalCopySizeBytes)}</p>
                <p><strong>건너뛰기:</strong> {finalSummary.skipFileCount}개</p>
                <p><strong>replace 예정:</strong> {finalSummary.replaceFileCount}개</p>
              </div>
              <div>
                <p><strong>폴더 생성 예정:</strong> {finalSummary.folderCreationCount}개</p>
                <p><strong>백업 필요:</strong> {finalSummary.backupRequiredFileCount}개</p>
                <p><strong>충돌:</strong> {finalSummary.conflictFileCount}개</p>
                <p><strong>원격 여유:</strong> {formatBytes(finalSummary.remoteFreeBytes)}</p>
                <p><strong>transfer:</strong> disabled</p>
                <p><strong>preflight:</strong> {preflightResult ? `simulate=${String(preflightResult.canSimulate)} / execute=${String(preflightResult.canExecute)}` : '미계산'}</p>
              </div>
            </div>
            {preflightResult && (
              <div className="danger-box">
                <strong>Preflight 차단/필수 조치</strong>
                <ul>
                  {preflightResult.blockers.map((blocker) => <li key={`${blocker.code}-${blocker.message}`}>{blocker.code}: {formatPreflightBlocker(blocker)}</li>)}
                  {preflightResult.requiredActions.map((action) => <li key={action}>필수 조치: {action}</li>)}
                  {preflightResult.blockers.length === 0 && preflightResult.requiredActions.length === 0 && <li>실제 전송은 여전히 kill switch와 feature flag에 의해 비활성입니다.</li>}
                </ul>
              </div>
            )}
            {finalSummary.blockers.length > 0 && (
              <div className="danger-box">
                <strong>차단 항목</strong>
                <ul>{finalSummary.blockers.map((blocker) => <li key={`${blocker.code}-${blocker.candidateId || blocker.message}`}>{blocker.code}: {blocker.message}</li>)}</ul>
              </div>
            )}
            {finalSummary.risks.length > 0 && (
              <div className="danger-box">
                <strong>위험 항목</strong>
                <ul>{finalSummary.risks.map((risk) => <li key={`${risk.code}-${risk.candidateId || risk.message}`}>{risk.code}: {risk.message}</li>)}</ul>
              </div>
            )}
            <label className="field">
              확인 문구 입력: <code>{finalSummary.requiredPhrase}</code>
              <input value={confirmationPhrase} onChange={(event) => setConfirmationPhrase(event.target.value)} placeholder="DRY RUN ONLY" />
            </label>
            <div className="action-row">
              <button className="button" disabled={!dryRunResult} onClick={refreshPreflight}>preflight 다시 계산</button>
              <button className="button" disabled={!dryRunResult} onClick={() => void saveCurrentPlan()}>계획만 저장</button>
              <button className="button" disabled={!dryRunResult} onClick={() => void exportPlanJson()}>계획 JSON 내보내기</button>
              <button className="button danger" disabled title="실제 복사는 다음 단계에서 별도 adapter와 rollback 설계 후 활성화됩니다.">실제 복사 실행</button>
            </div>
            <pre className="log-box">{transferPreparation?.disabledError.message || 'ROM_TRANSFER_DISABLED'}</pre>
          </div>
        </div>
      )}
    </>
  );
}
