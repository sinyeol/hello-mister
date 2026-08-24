import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, Eye, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import { PageHeader } from '../components/cards/PageHeader';
import { SectionCard } from '../components/cards/SectionCard';
import { ActiveMisterBanner } from '../components/mister/ActiveMisterBanner';
import { controllerDesktopService } from '../services/controllers/controllerDesktopService';
import { canRestoreControllerTarget, controllerCandidatePaths, controllerFileSortValue, controllerPresetList } from '../services/controllers/controllerFileService';
import {
  buildControllerMapPresetCandidates,
  compareControllerMapBytes,
  controllerMapPresetTypeLabels,
  createControllerMapApplyPlan,
  createControllerMapPresetFromCandidate,
  createControllerMapPresetFromFile,
  deleteControllerMapPreset,
  groupControllerMapFiles,
  loadControllerMapPresets,
  mapFileBytesFromReadResult,
  pickDominantControllerKey,
  parseControllerMapFileName,
  saveControllerMapPreset,
  summarizeFrequentDiffOffsets,
  type ControllerMapApplyPlan,
  type ControllerMapDiffResult,
  type ControllerMapPresetCandidate,
  type ControllerMapPresetCandidateHashEntry,
  type ControllerMapPreset,
  type ControllerMapPresetType,
} from '../services/controllers/controllerMapAnalysisService';
import {
  buildControllerMapAnalysisCsvFiles,
  buildControllerMapAnalysisExport,
  buildControllerMapAnalysisSummaryExport,
  buildControllerMapAnalysisZip,
  encodeTextForExport,
  type ControllerMapAnalysisExport,
  type ControllerMapAnalysisExportMode,
} from '../services/controllers/controllerMapExportService';
import { SafeMisterProfileStore } from '../services/mister/profileStore';
import { misterDisplayName } from '../services/mister/misterName';
import type { ActiveMisterProfile, MisterDeviceProfile } from '../types/mister';
import type { ControllerAutoMapResult, ControllerBackupEntry, ControllerBackupPreviewResult, ControllerCloneResult, ControllerConfigFile, ControllerConnectedDevice, ControllerFilePreview, ControllerInventoryResult, ControllerReadFileResult } from '../types/controllers';

const controllerScanTimeoutMs = 30_000;
const controllerMapExportReadTimeoutMs = 8_000;
const controllerMapExportReadConcurrency = 8;

type CandidateSaveDuplicateMode = 'replace' | 'copy';

interface LastPresetSaveAction {
  selectedCandidateId?: string;
  representativePath?: string;
  savedPresetId?: string;
  errorMessage?: string;
  status: 'idle' | 'open' | 'saving' | 'success' | 'error';
}

const controllerTargetProfileKey = 'hello-mister-v2:controller-target-profile';

function misterLabel(profile?: ActiveMisterProfile) {
  if (!profile) return 'MiSTer 연결 필요';
  const name = (profile.hostname && profile.hostname !== 'MiSTer') ? profile.hostname : (profile.alias || 'MiSTer');
  return `${name} @ ${profile.ipAddress}:${profile.port || 22}`;
}

// Map a saved profile to the ActiveMisterProfile shape this page operates on (controller ops only need
// profileId/alias/ipAddress/port). Reuse the global active profile object when it's the same device.
function mapDeviceToActiveProfile(profile: MisterDeviceProfile, globalActive?: ActiveMisterProfile): ActiveMisterProfile {
  if (globalActive && globalActive.profileId === profile.id) return globalActive;
  return {
    profileId: profile.id,
    alias: profile.alias,
    ipAddress: profile.ipAddress,
    port: Number(profile.port || 22),
    username: profile.username || 'root',
    connectedAt: new Date().toISOString(),
    mediaFatOk: false,
    gamesOk: false,
    misterIniOk: false,
  };
}

function formatBytes(value?: number) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function formatMapByteLengthCounts(counts: Record<string, number>) {
  return Object.entries(counts).map(([length, count]) => `${length} ${count}개`).join(' · ') || '-';
}

function selectedOptionLabel(file?: ControllerConfigFile) {
  if (!file) return '';
  const parsed = parseControllerMapFileName(file.fileName);
  return parsed.isRecognizedInputMap
    ? `${file.fileName} · 게임 키 추정 ${parsed.gameKey} · 조이스틱 키 추정 ${parsed.controllerKey}`
    : `${file.fileName} · 파일명 규칙 미확인`;
}

function diffSummaryText(diff?: ControllerMapDiffResult) {
  if (!diff) return '비교 결과가 없습니다.';
  if (diff.identical) return `동일합니다. ${diff.aLength} bytes`;
  return `차이 ${diff.differenceCount}개 · A ${diff.aLength} bytes · B ${diff.bLength} bytes`;
}

function defaultPresetNameForCandidate(candidate: ControllerMapPresetCandidate) {
  return `${candidate.familyGuess} - ${candidate.controllerKey}`;
}

function defaultPresetTypeForCandidate(candidate: ControllerMapPresetCandidate): ControllerMapPresetType {
  const text = `${candidate.familyGuess} ${candidate.sampleGameKeys.join(' ')}`.toLowerCase();
  if (/neogeo|neo geo|snk/.test(text)) return 'neogeo-4-button';
  if (/cps fighting|street fighter|sf2|sfa|vsav|vamp|xmcota|mvsc/.test(text)) return 'cps-6-button';
  if (/mega drive|genesis/.test(text)) return 'mega-drive-6-button';
  if (/snes|super nintendo/.test(text)) return 'snes';
  if (/console|pad/.test(text)) return 'console-pad';
  if (candidate.confidence !== 'low' && /arcade|capcom|cps|cave|raizing|toaplan|konami|sega st-v/.test(text)) return 'arcade-common';
  return 'custom';
}

function hasSuspiciousControllerText(content: string) {
  if (!content) return false;
  const replacementCount = (content.match(/\uFFFD/g) || []).length;
  let controlCount = 0;
  for (const char of content) {
    const code = char.charCodeAt(0);
    if (code < 32 && !['\n', '\r', '\t'].includes(char)) controlCount += 1;
  }
  return replacementCount > 0 || controlCount / Math.max(content.length, 1) > 0.12;
}

function statusMessage(inventory?: ControllerInventoryResult, scanning = false) {
  if (scanning) return '컨트롤러 설정 파일을 읽는 중입니다.';
  if (!inventory) return '컨트롤러 설정 파일을 아직 읽지 않았습니다.';
  if (inventory.status === 'ready') return '컨트롤러 설정 파일을 불러왔습니다.';
  if (inventory.status === 'empty') return '컨트롤러 관련 후보 파일을 찾지 못했습니다.';
  if (inventory.status === 'partial') return '일부 경로를 읽지 못했습니다.';
  if (inventory.status === 'timeout') return '컨트롤러 설정 파일 읽기가 시간 초과되었습니다.';
  return inventory.message || '컨트롤러 설정 파일을 읽지 못했습니다.';
}

function statusClass(inventory?: ControllerInventoryResult, scanning = false) {
  if (scanning) return 'info';
  if (!inventory) return 'muted';
  if (inventory.status === 'ready') return 'success';
  if (inventory.status === 'empty') return 'muted';
  if (inventory.status === 'partial') return 'warning';
  return 'danger';
}

function ControllerPreviewBlock({ title, preview, content }: { title: string; preview?: ControllerFilePreview; content: string }) {
  if (!preview) {
    if (hasSuspiciousControllerText(content)) {
      return (
        <div className="controller-preview">
          <p className="callout warning">
            이 파일 내용은 텍스트로 표시할 수 없는 컨트롤러 매핑 데이터로 보입니다. 깨진 문자열은 숨겼습니다.
            앱을 최신 빌드로 완전히 재시작한 뒤 다시 내용을 보면 byte/hex 미리보기가 표시됩니다.
          </p>
        </div>
      );
    }
    return null;
  }

  if (preview.mode === 'hex') {
    return (
      <div className="controller-preview">
        <div className="mini-stats">
          <span>{title}</span>
          <span>{preview.byteCount} bytes</span>
          <span>{preview.truncated ? `${preview.shownBytes} bytes preview` : 'full preview'}</span>
        </div>
        {preview.message && <p className="muted">{preview.message}</p>}
        <pre className="code-preview hex-preview">{preview.hex || content}</pre>
        {preview.decimalBytes && (
          <details>
            <summary>decimal bytes</summary>
            <pre className="code-block byte-preview">{preview.decimalBytes}</pre>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="controller-preview">
      <div className="mini-stats">
        <span>{title}</span>
        <span>{preview.byteCount} bytes</span>
        <span>{preview.truncated ? `${preview.shownBytes} bytes preview` : 'full preview'}</span>
      </div>
      <textarea className="code-preview" value={preview.text || content} readOnly aria-label={title} />
    </div>
  );
}

function createTimeoutInventory(profile?: ActiveMisterProfile, startedAt = new Date().toISOString()): ControllerInventoryResult {
  const finishedAt = new Date().toISOString();
  const durationMs = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
  const failure = {
    path: '/media/fat',
    message: '컨트롤러 설정 파일 읽기가 시간 초과되었습니다. 연결 상태를 확인하고 다시 시도하세요.',
    errorCode: 'CONTROLLER_FS_SCAN_TIMEOUT',
  };
  return {
    ok: false,
    status: 'timeout',
    profileId: profile?.profileId,
    alias: profile?.alias,
    host: profile?.ipAddress,
    port: profile?.port,
    startedAt,
    finishedAt,
    durationMs,
    scannedAt: finishedAt,
    candidateRoots: [...controllerCandidatePaths],
    scannedRoots: [],
    candidateFolders: [],
    files: [],
    failedPaths: [failure],
    errors: [failure],
    summary: {
      scannedFolderCount: 0,
      candidateFileCount: 0,
      failedPathCount: 1,
    },
    diagnostics: {
      activeProfile: profile ? {
        profileId: profile.profileId,
        alias: profile.alias,
        host: profile.ipAddress,
        port: profile.port,
      } : undefined,
      candidateRoots: [...controllerCandidatePaths],
      scannedRoots: [],
      failedRoots: [failure],
      errors: [failure],
      startedAt,
      finishedAt,
      durationMs,
      status: 'timeout',
    },
    message: failure.message,
    errorCode: failure.errorCode,
  };
}

export function ControllerManagementPage() {
  const [activeProfile, setActiveProfile] = useState<ActiveMisterProfile | undefined>();
  const profileStore = useMemo(() => new SafeMisterProfileStore(), []);
  const [savedProfiles, setSavedProfiles] = useState<MisterDeviceProfile[]>([]);
  const [selectedTargetProfileId, setSelectedTargetProfileId] = useState<string | undefined>(() => {
    try { return window.localStorage.getItem(controllerTargetProfileKey) ?? undefined; } catch { return undefined; }
  });
  const [targetDeviceStatus, setTargetDeviceStatus] = useState<Record<string, { reachable: boolean; connected: boolean }>>({});
  const savedProfilesRef = useRef<MisterDeviceProfile[]>([]);
  const selectedTargetRef = useRef<string | undefined>(selectedTargetProfileId);
  const [inventory, setInventory] = useState<ControllerInventoryResult | undefined>();
  const [selectedFile, setSelectedFile] = useState<ControllerConfigFile | undefined>();
  const [readResult, setReadResult] = useState<ControllerReadFileResult | undefined>();
  const [backupPreview, setBackupPreview] = useState<ControllerBackupPreviewResult | undefined>();
  const [backups, setBackups] = useState<ControllerBackupEntry[]>([]);
  const [compareAPath, setCompareAPath] = useState('');
  const [compareBPath, setCompareBPath] = useState('');
  const [compareResult, setCompareResult] = useState<ControllerMapDiffResult | undefined>();
  const [compareMessage, setCompareMessage] = useState('');
  const [frequentOffsets, setFrequentOffsets] = useState<Array<{ offset: number; count: number }>>([]);
  const [presets, setPresets] = useState<ControllerMapPreset[]>([]);
  const [presetType, setPresetType] = useState<ControllerMapPresetType>('custom');
  const [candidateHashEntries, setCandidateHashEntries] = useState<ControllerMapPresetCandidateHashEntry[]>([]);
  const [candidateMessage, setCandidateMessage] = useState('');
  const [candidateBusy, setCandidateBusy] = useState(false);
  const [candidateControllerFilter, setCandidateControllerFilter] = useState('');
  const [candidateByteLengthFilter, setCandidateByteLengthFilter] = useState('128');
  const [candidateMinFileCount, setCandidateMinFileCount] = useState(5);
  const [candidateRecommendedOnly, setCandidateRecommendedOnly] = useState(true);
  const [candidateShowExceptions, setCandidateShowExceptions] = useState(false);
  const [candidateRepresentativeOverrides, setCandidateRepresentativeOverrides] = useState<Record<string, string>>({});
  const [candidateSaveModal, setCandidateSaveModal] = useState<ControllerMapPresetCandidate | undefined>();
  const [candidateSaveName, setCandidateSaveName] = useState('');
  const [candidateSaveType, setCandidateSaveType] = useState<ControllerMapPresetType>('custom');
  const [candidateSaveNotes, setCandidateSaveNotes] = useState('');
  const [candidateSaveRepresentativePath, setCandidateSaveRepresentativePath] = useState('');
  const [candidateSaveError, setCandidateSaveError] = useState('');
  const [candidateSaveBusy, setCandidateSaveBusy] = useState(false);
  const [candidateSaveDuplicateMode, setCandidateSaveDuplicateMode] = useState<CandidateSaveDuplicateMode>('replace');
  const [lastPresetSaveAction, setLastPresetSaveAction] = useState<LastPresetSaveAction>({ status: 'idle' });
  const [applyPresetId, setApplyPresetId] = useState('');
  const [applyTargetPath, setApplyTargetPath] = useState('');
  const [applyPlan, setApplyPlan] = useState<ControllerMapApplyPlan | undefined>();
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [connectedDevices, setConnectedDevices] = useState<ControllerConnectedDevice[]>([]);
  const [cloneSourceKey, setCloneSourceKey] = useState('');
  const [cloneTarget, setCloneTarget] = useState<{ vid: string; pid: string; name?: string }>();
  const [clonePlan, setClonePlan] = useState<ControllerCloneResult | undefined>();
  const [autoMapPlan, setAutoMapPlan] = useState<ControllerAutoMapResult | undefined>();
  const [cloneBusy, setCloneBusy] = useState(false);
  const [cloneMessage, setCloneMessage] = useState('');
  const mountedRef = useRef(true);
  const scanRunRef = useRef(0);
  const exportCancelRef = useRef(false);

  const sortedFiles = useMemo(
    () => [...(inventory?.files || [])].sort((a, b) => controllerFileSortValue(a).localeCompare(controllerFileSortValue(b), undefined, { numeric: true })),
    [inventory],
  );
  const mapFiles = useMemo(
    () => sortedFiles.filter((file) => /\.map$/i.test(file.fileName)),
    [sortedFiles],
  );
  const mapGroups = useMemo(() => groupControllerMapFiles(mapFiles), [mapFiles]);
  const dominantControllerKey = useMemo(() => pickDominantControllerKey(mapFiles), [mapFiles]);
  const controllerKeyStats = useMemo(() => {
    const stats = new Map<string, { count: number; vid: string; pid: string; version: string }>();
    for (const file of mapFiles) {
      const parsed = parseControllerMapFileName(file.fileName);
      if (parsed.controllerKey === 'unknown' || !parsed.vid || !parsed.pid || !parsed.version) continue;
      const existing = stats.get(parsed.controllerKey) ?? { count: 0, vid: parsed.vid.toLowerCase(), pid: parsed.pid.toLowerCase(), version: parsed.version };
      existing.count += 1;
      stats.set(parsed.controllerKey, existing);
    }
    return [...stats.entries()].map(([key, value]) => ({ key, ...value })).sort((a, b) => b.count - a.count);
  }, [mapFiles]);
  const mappedVidPidSet = useMemo(() => new Set(controllerKeyStats.map((stat) => `${stat.vid}_${stat.pid}`)), [controllerKeyStats]);
  const presetCandidates = useMemo(
    () => buildControllerMapPresetCandidates(candidateHashEntries, {
      dominantControllerKey,
      minFileCount: candidateMinFileCount,
      representativeOverrides: candidateRepresentativeOverrides,
    }),
    [candidateHashEntries, dominantControllerKey, candidateMinFileCount, candidateRepresentativeOverrides],
  );
  const candidateControllerOptions = useMemo(() => {
    const keys = new Set<string>();
    for (const candidate of presetCandidates) keys.add(candidate.controllerKey);
    return [...keys].sort((a, b) => (a === dominantControllerKey ? -1 : b === dominantControllerKey ? 1 : a.localeCompare(b)));
  }, [dominantControllerKey, presetCandidates]);
  const filteredPresetCandidates = useMemo(() => {
    const controllerKey = candidateControllerFilter || dominantControllerKey;
    return presetCandidates.filter((candidate) => {
      if (controllerKey && candidate.controllerKey !== controllerKey) return false;
      if (candidateByteLengthFilter && String(candidate.byteLength) !== candidateByteLengthFilter) return false;
      if (candidateRecommendedOnly && !candidate.isRecommended) return false;
      if (!candidateShowExceptions && candidate.byteLength === 2048) return false;
      return candidate.fileCount >= candidateMinFileCount || !candidateRecommendedOnly;
    });
  }, [candidateByteLengthFilter, candidateControllerFilter, candidateMinFileCount, candidateRecommendedOnly, candidateShowExceptions, dominantControllerKey, presetCandidates]);
  const candidateSaveRepresentative = useMemo(() => {
    if (!candidateSaveModal) return undefined;
    return candidateSaveModal.files.find((file) => file.path === candidateSaveRepresentativePath) || candidateSaveModal.representativeFile;
  }, [candidateSaveModal, candidateSaveRepresentativePath]);
  const candidateDuplicatePreset = useMemo(() => {
    if (!candidateSaveModal) return undefined;
    return presets.find((preset) => (
      preset.controllerKey === candidateSaveModal.controllerKey
      && preset.type === candidateSaveType
      && preset.sha256 === candidateSaveModal.sha256
    ));
  }, [candidateSaveModal, candidateSaveType, presets]);

  // Resolve the operation target: the user-selected MiSTer (via refs, so callers read the current value), else the
  // saved profile matching the global active, else the first saved profile, else the raw global active.
  async function hydrateActiveProfile() {
    const globalActive = await window.helloMisterDesktop?.getActiveMisterProfile?.();
    const saved = savedProfilesRef.current;
    const targetId = selectedTargetRef.current;
    const targetSaved = (targetId ? saved.find((item) => item.id === targetId) : undefined)
      ?? saved.find((item) => item.id === globalActive?.profileId)
      ?? saved[0];
    const profile = targetSaved ? mapDeviceToActiveProfile(targetSaved, globalActive) : globalActive;
    if (mountedRef.current) setActiveProfile(profile);
    return profile;
  }

  function selectTargetProfile(profileId: string) {
    selectedTargetRef.current = profileId;
    setSelectedTargetProfileId(profileId);
    try { window.localStorage.setItem(controllerTargetProfileKey, profileId); } catch { /* ignore */ }
    setConnectedDevices([]);
    setClonePlan(undefined);
    setCloneTarget(undefined);
    void refreshInventory();
  }

  const targetStatusLabel = (profile: MisterDeviceProfile) => {
    const status = targetDeviceStatus[profile.id];
    if (status?.connected) return '● 연결됨';
    if (status?.reachable) return '○ 켜짐';
    return '· 오프라인';
  };

  async function refreshInventory() {
    const runId = scanRunRef.current + 1;
    scanRunRef.current = runId;
    const startedAt = new Date().toISOString();
    setBusy(true);
    setMessage('컨트롤러 설정 파일을 읽는 중입니다.');
    setReadResult(undefined);
    setBackupPreview(undefined);
    setBackups([]);

    try {
      const profile = await hydrateActiveProfile();
      if (!mountedRef.current || scanRunRef.current !== runId) return;

      if (!profile) {
        setInventory(undefined);
        setSelectedFile(undefined);
        setMessage('MiSTer 연결이 필요합니다.');
        return;
      }

      const timeoutResult = new Promise<ControllerInventoryResult>((resolve) => {
        window.setTimeout(() => resolve(createTimeoutInventory(profile, startedAt)), controllerScanTimeoutMs);
      });
      const result = await Promise.race([
        controllerDesktopService.scanInventory(profile.profileId),
        timeoutResult,
      ]);

      if (!mountedRef.current || scanRunRef.current !== runId) return;
      setInventory(result);
      setMessage(result.message);

      const nextSelected = result.files.find((file) => file.path === selectedFile?.path) || result.files[0];
      setSelectedFile(nextSelected);
    } catch (error) {
      if (!mountedRef.current || scanRunRef.current !== runId) return;
      const finishedAt = new Date().toISOString();
      const rawMessage = String(error instanceof Error ? error.message : error || '');
      const handlerMissing = /No handler registered for ['"]controllerFs:scanInventory['"]/i.test(rawMessage);
      const failure = {
        path: '/media/fat',
        message: String(error instanceof Error ? error.message : error || '컨트롤러 설정 파일을 읽지 못했습니다.'),
        errorCode: 'CONTROLLER_FS_RENDERER_SCAN_FAILED',
      };
      if (handlerMissing) {
        failure.message = '컨트롤러 스캔 기능이 현재 실행 중인 앱에 등록되지 않았습니다. 앱을 완전히 종료한 뒤 최신 빌드로 다시 시작하세요.';
        failure.errorCode = 'CONTROLLER_FS_IPC_HANDLER_MISSING';
      }
      const errorInventory: ControllerInventoryResult = {
        ok: false,
        status: 'error',
        startedAt,
        finishedAt,
        durationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime()),
        scannedAt: finishedAt,
        candidateRoots: [...controllerCandidatePaths],
        scannedRoots: [],
        candidateFolders: [],
        files: [],
        failedPaths: [failure],
        errors: [failure],
        summary: { scannedFolderCount: 0, candidateFileCount: 0, failedPathCount: 1 },
        diagnostics: {
          candidateRoots: [...controllerCandidatePaths],
          scannedRoots: [],
          failedRoots: [failure],
          errors: [failure],
          startedAt,
          finishedAt,
          durationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime()),
          status: 'error',
        },
        message: failure.message,
        errorCode: failure.errorCode,
      };
      setInventory(errorInventory);
      setSelectedFile(undefined);
      setMessage(errorInventory.message);
    } finally {
      if (mountedRef.current && scanRunRef.current === runId) setBusy(false);
    }
  }

  async function viewFile(file = selectedFile) {
    if (!file) return;
    setBusy(true);
    try {
      const result = await controllerDesktopService.readFile(activeProfile?.profileId, file.path);
      setReadResult(result);
      setBackupPreview(undefined);
      setMessage(result.message);
    } catch (error) {
      const result: ControllerReadFileResult = {
        ok: false,
        content: '',
        readAt: new Date().toISOString(),
        message: String(error instanceof Error ? error.message : error || '컨트롤러 파일 내용을 읽지 못했습니다.'),
        errorCode: 'CONTROLLER_FS_RENDERER_READ_FAILED',
      };
      setReadResult(result);
      setBackupPreview(undefined);
      setMessage(result.message);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function readMapFile(file: ControllerConfigFile) {
    const result = await controllerDesktopService.readFile(activeProfile?.profileId, file.path);
    if (!result.ok) throw new Error(result.message);
    const bytes = mapFileBytesFromReadResult(result);
    if (!bytes) throw new Error('map 파일의 byte 데이터를 읽지 못했습니다.');
    return { result, bytes };
  }

  function selectedMapGroupFiles() {
    if (!selectedFile || !/\.map$/i.test(selectedFile.fileName)) return [];
    const selectedMeta = parseControllerMapFileName(selectedFile.fileName);
    if (!selectedMeta.controllerKey || selectedMeta.controllerKey === 'unknown') return [selectedFile];
    return mapFiles.filter((file) => parseControllerMapFileName(file.fileName).controllerKey === selectedMeta.controllerKey);
  }

  async function buildCurrentMapExport(mode: ControllerMapAnalysisExportMode, filesForExport = mapFiles): Promise<ControllerMapAnalysisExport> {
    const readResults = new Map<string, ControllerReadFileResult>();
    if (mode === 'summary') {
      setExportMessage('메타데이터만 정리하는 중입니다. 원격 파일 bytes는 읽지 않습니다.');
      return buildControllerMapAnalysisExport({
        app: { name: 'Hello Mister', version: '2.1.0' },
        activeProfile,
        files: filesForExport,
        readResults,
        mode,
      });
    }

    let completedCount = 0;
    let partialCount = 0;
    let nextIndex = 0;
    const total = filesForExport.length;
    const workerCount = Math.min(controllerMapExportReadConcurrency, Math.max(total, 1));
    const readOne = async (file: ControllerConfigFile) => {
      try {
        if (exportCancelRef.current) return;
        setExportMessage(
          mode === 'hash'
            ? `SHA-256이 필요한 map 파일만 확인하는 중입니다... ${completedCount}/${total}`
            : `선택한 map 파일 bytes를 읽는 중입니다... ${completedCount}/${total}`,
        );
        const result = await Promise.race([
          controllerDesktopService.readFile(activeProfile?.profileId, file.path),
          createMapExportReadTimeout(file),
        ]);
        if (!result.ok) partialCount += 1;
        readResults.set(file.path, result);
      } catch (error) {
        partialCount += 1;
        readResults.set(file.path, {
          ok: false,
          content: '',
          readAt: new Date().toISOString(),
          message: String(error instanceof Error ? error.message : error || 'controller map read failed'),
          errorCode: 'CONTROLLER_MAP_EXPORT_READ_FAILED',
        });
      }
      completedCount += 1;
      setExportMessage(
        partialCount > 0
          ? `${mode === 'hash' ? 'SHA-256 확인' : 'bytes 읽기'} ${completedCount}/${total} · ${partialCount}개는 metadata만 포함`
          : `${mode === 'hash' ? 'SHA-256 확인' : 'bytes 읽기'} ${completedCount}/${total}`,
      );
    };
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < filesForExport.length && !exportCancelRef.current) {
        const index = nextIndex;
        nextIndex += 1;
        await readOne(filesForExport[index]);
      }
    }));
    if (exportCancelRef.current) {
      throw new Error('CONTROLLER_MAP_EXPORT_CANCELLED');
    }
    return buildControllerMapAnalysisExport({
      app: { name: 'Hello Mister', version: '2.1.0' },
      activeProfile,
      files: filesForExport,
      readResults,
      mode,
    });
  }

  function createMapExportReadTimeout(file: ControllerConfigFile): Promise<ControllerReadFileResult> {
    return new Promise((resolve) => {
      window.setTimeout(() => {
        resolve({
          ok: false,
          file,
          content: '',
          preview: {
            mode: 'hex',
            byteCount: Number(file.sizeBytes || 0),
            shownBytes: 0,
            truncated: true,
            message: '파일 읽기 제한 시간이 지나 원격 metadata만 export에 포함했습니다.',
          },
          readAt: new Date().toISOString(),
          message: `${file.fileName} 읽기 시간이 초과되어 metadata만 내보냅니다.`,
          errorCode: 'CONTROLLER_MAP_EXPORT_READ_TIMEOUT',
        });
      }, controllerMapExportReadTimeoutMs);
    });
  }

  async function preparePresetCandidates() {
    if (mapFiles.length === 0) {
      setCandidateMessage('프리셋 후보를 만들 .map 파일이 없습니다.');
      return;
    }
    setCandidateBusy(true);
    setCandidateHashEntries([]);
    setCandidateMessage('프리셋 후보용 SHA-256을 확인하는 중입니다...');
    let completedCount = 0;
    let failedCount = 0;
    let nextIndex = 0;
    const entries: ControllerMapPresetCandidateHashEntry[] = [];
    const total = mapFiles.length;
    const workerCount = Math.min(controllerMapExportReadConcurrency, Math.max(total, 1));

    const readOne = async (file: ControllerConfigFile) => {
      try {
        const result = await Promise.race([
          controllerDesktopService.readFile(activeProfile?.profileId, file.path),
          createMapExportReadTimeout(file),
        ]);
        if (!result.ok || !result.sha256) failedCount += 1;
        entries.push({
          file,
          sha256: result.ok ? result.sha256 : undefined,
          ok: result.ok,
          message: result.message,
        });
      } catch (error) {
        failedCount += 1;
        entries.push({
          file,
          ok: false,
          message: String(error instanceof Error ? error.message : error || 'controller map hash read failed'),
        });
      }
      completedCount += 1;
      if (mountedRef.current) {
        setCandidateMessage(`프리셋 후보용 SHA-256 확인 중... ${completedCount}/${total}${failedCount ? ` · 실패 ${failedCount}개` : ''}`);
      }
    };

    try {
      await Promise.all(Array.from({ length: workerCount }, async () => {
        while (nextIndex < mapFiles.length) {
          const index = nextIndex;
          nextIndex += 1;
          await readOne(mapFiles[index]);
        }
      }));
      if (!mountedRef.current) return;
      setCandidateHashEntries(entries);
      const validCount = entries.filter((entry) => entry.sha256).length;
      setCandidateControllerFilter('');
      setCandidateByteLengthFilter('128');
      setCandidateRecommendedOnly(true);
      setCandidateMessage(`프리셋 후보 준비 완료: SHA 확인 ${validCount}/${total}개. 기본 필터는 주 controllerKey와 128 bytes입니다.`);
    } finally {
      if (mountedRef.current) setCandidateBusy(false);
    }
  }

  async function saveControllerExportBytes(bytes: Uint8Array, filename: string, mimeType: string) {
    if (window.zaparooDesktop?.saveFile) {
      const result = await window.zaparooDesktop.saveFile(bytes, filename, mimeType);
      if (result.canceled) return { ok: false, canceled: true, message: '내보내기를 취소했습니다.' };
      return { ok: result.ok, canceled: false, message: result.ok ? `내보냈습니다: ${result.path || filename}` : result.error || '내보내기에 실패했습니다.' };
    }
    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { ok: true, canceled: false, message: `다운로드를 시작했습니다: ${filename}` };
  }

  function cancelControllerMapExport() {
    exportCancelRef.current = true;
    setExportMessage('내보내기 취소를 요청했습니다. 진행 중인 파일 읽기가 끝나면 중단합니다.');
  }

  async function exportControllerMapAnalysis(kind: 'summary' | 'json' | 'csv' | 'zip', mode: ControllerMapAnalysisExportMode = 'hash', scope: 'all' | 'selected-group' = 'all') {
    if (mapFiles.length === 0) {
      setExportMessage('내보낼 .map 파일이 없습니다.');
      return;
    }
    const filesForExport = mode === 'full' && scope === 'selected-group' ? selectedMapGroupFiles() : mapFiles;
    if (mode === 'full' && filesForExport.length === 0) {
      setExportMessage('bytes를 포함할 .map 파일 또는 그룹을 먼저 선택하세요.');
      return;
    }
    if (mode === 'full' && scope === 'all') {
      const confirmed = window.confirm(`전체 ${mapFiles.length}개 .map 파일 bytes를 모두 포함하면 시간이 오래 걸리고 파일이 커질 수 있습니다. 일반 분석에는 권장하지 않습니다. 계속할까요?`);
      if (!confirmed) return;
    }
    exportCancelRef.current = false;
    setExportBusy(true);
    setExportMessage(mode === 'summary' ? '메타데이터만 정리하는 중입니다...' : mode === 'hash' ? '경량 분석 ZIP을 준비하는 중입니다...' : 'bytes 포함 export를 준비하는 중입니다...');
    try {
      const exportData = await buildCurrentMapExport(mode, filesForExport);
      const partialCount = exportData.files.filter((file) => file.parseWarnings.length > 0).length;
      setExportMessage(
        partialCount > 0
          ? `내보내기 파일을 만드는 중입니다... ${partialCount}개 항목은 읽기 실패/timeout 경고를 포함합니다.`
          : '내보내기 파일을 만드는 중입니다...',
      );
      let filename = 'controller-map-analysis.zip';
      let mimeType = 'application/zip';
      let bytes: Uint8Array;
      if (kind === 'summary') {
        filename = 'controller-map-summary.json';
        mimeType = 'application/json';
        bytes = encodeTextForExport(JSON.stringify(buildControllerMapAnalysisSummaryExport(exportData), null, 2));
      } else if (kind === 'json') {
        filename = 'controller-map-analysis.json';
        mimeType = 'application/json';
        bytes = encodeTextForExport(JSON.stringify(exportData, null, 2));
      } else if (kind === 'csv') {
        filename = 'controller-map-files.csv';
        mimeType = 'text/csv';
        bytes = encodeTextForExport(buildControllerMapAnalysisCsvFiles(exportData)['controller-map-files.csv']);
      } else {
        bytes = await buildControllerMapAnalysisZip(exportData);
      }
      const result = await saveControllerExportBytes(bytes, filename, mimeType);
      setExportMessage(result.canceled ? '내보내기를 취소했습니다.' : result.message);
    } catch (error) {
      const raw = String(error instanceof Error ? error.message : error || '컨트롤러 map 내보내기에 실패했습니다.');
      setExportMessage(raw === 'CONTROLLER_MAP_EXPORT_CANCELLED' ? '내보내기를 취소했습니다.' : raw);
    } finally {
      exportCancelRef.current = false;
      if (mountedRef.current) setExportBusy(false);
    }
  }

  async function compareSelectedMapFiles() {
    const fileA = mapFiles.find((file) => file.path === compareAPath);
    const fileB = mapFiles.find((file) => file.path === compareBPath);
    if (!fileA || !fileB) {
      setCompareMessage('비교할 .map 파일 2개를 선택하세요.');
      return;
    }
    setBusy(true);
    try {
      const [a, b] = await Promise.all([readMapFile(fileA), readMapFile(fileB)]);
      const diff = compareControllerMapBytes(a.bytes, b.bytes);
      setCompareResult(diff);
      setCompareMessage(diff.identical ? '선택한 두 .map 파일은 byte 기준으로 동일합니다.' : `${diff.differenceCount}개 offset 차이를 찾았습니다.`);
    } catch (error) {
      setCompareResult(undefined);
      setCompareMessage(String(error instanceof Error ? error.message : error || 'map 비교에 실패했습니다.'));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function analyzeSameControllerGroup() {
    const fileA = mapFiles.find((file) => file.path === compareAPath);
    if (!fileA) {
      setCompareMessage('기준 .map 파일을 먼저 선택하세요.');
      return;
    }
    const controllerKey = parseControllerMapFileName(fileA.fileName).controllerKey;
    const candidates = mapFiles.filter((file) => parseControllerMapFileName(file.fileName).controllerKey === controllerKey && file.path !== fileA.path).slice(0, 24);
    if (candidates.length === 0) {
      setFrequentOffsets([]);
      setCompareMessage('같은 조이스틱 키로 추정되는 다른 .map 파일이 없습니다.');
      return;
    }
    setBusy(true);
    try {
      const base = await readMapFile(fileA);
      const diffs: ControllerMapDiffResult[] = [];
      for (const candidate of candidates) {
        const next = await readMapFile(candidate);
        diffs.push(compareControllerMapBytes(base.bytes, next.bytes));
      }
      const offsets = summarizeFrequentDiffOffsets(diffs);
      setFrequentOffsets(offsets);
      setCompareMessage(`같은 조이스틱 키 ${controllerKey} 그룹에서 ${candidates.length}개 파일을 비교했습니다.`);
    } catch (error) {
      setFrequentOffsets([]);
      setCompareMessage(String(error instanceof Error ? error.message : error || '다중 비교에 실패했습니다.'));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function saveSelectedMapAsPreset() {
    if (!selectedFile || !/\.map$/i.test(selectedFile.fileName)) {
      setMessage('프리셋으로 저장할 .map 파일을 선택하세요.');
      return;
    }
    const parsed = parseControllerMapFileName(selectedFile.fileName);
    const name = window.prompt('프리셋 이름을 입력하세요.', `${parsed.gameKey} - ${parsed.controllerKey}`);
    if (!name) return;
    setBusy(true);
    try {
      const result = await controllerDesktopService.readFile(activeProfile?.profileId, selectedFile.path);
      const preset = await createControllerMapPresetFromFile(selectedFile, result, { name, type: presetType });
      setPresets(saveControllerMapPreset(preset));
      setMessage('선택한 .map 파일을 로컬 프리셋으로 저장했습니다. 원격 MiSTer 파일은 수정하지 않았습니다.');
    } catch (error) {
      setMessage(String(error instanceof Error ? error.message : error || '프리셋 저장에 실패했습니다.'));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function saveCandidateAsPreset(candidate: ControllerMapPresetCandidate) {
    if (candidate.byteLength === 2048) {
      setCandidateMessage('2048-byte exception group is separated from default preset apply candidates. Save a manual preset only after verifying the file structure.');
      return;
    }
    const representative = candidate.files.find((file) => file.path === candidateRepresentativeOverrides[candidate.candidateId]) || candidate.representativeFile;
    const defaultName = `${candidate.familyGuess} · ${candidate.controllerKey} · ${candidate.fileCount} files`;
    const name = window.prompt('프리셋 이름을 입력하세요.', defaultName);
    if (!name) return;
    setCandidateBusy(true);
    try {
      const result = await controllerDesktopService.readFile(activeProfile?.profileId, representative.path);
      const preset = await createControllerMapPresetFromCandidate(candidate, representative, result, { name, type: presetType });
      setPresets(saveControllerMapPreset(preset));
      setCandidateMessage(`프리셋을 저장했습니다: ${preset.name}. 원격 MiSTer 파일은 수정하지 않았습니다.`);
    } catch (error) {
      setCandidateMessage(String(error instanceof Error ? error.message : error || '프리셋 후보 저장에 실패했습니다.'));
    } finally {
      if (mountedRef.current) setCandidateBusy(false);
    }
  }

  void saveCandidateAsPreset;

  function openCandidateSaveModal(candidate: ControllerMapPresetCandidate) {
    if (candidate.byteLength === 2048) {
      setCandidateMessage('2048-byte exception groups are separated from default preset apply candidates. Verify the file structure before saving a manual preset.');
      return;
    }
    const representative = candidate.files.find((file) => file.path === candidateRepresentativeOverrides[candidate.candidateId]) || candidate.representativeFile;
    const defaultType = defaultPresetTypeForCandidate(candidate);
    setCandidateSaveModal(candidate);
    setCandidateSaveName(defaultPresetNameForCandidate(candidate));
    setCandidateSaveType(defaultType);
    setCandidateSaveNotes(`SHA group preset candidate. Covers ${candidate.fileCount} files.`);
    setCandidateSaveRepresentativePath(representative.path);
    setCandidateSaveError('');
    setCandidateSaveDuplicateMode('replace');
    setLastPresetSaveAction({
      status: 'open',
      selectedCandidateId: candidate.candidateId,
      representativePath: representative.path,
    });
  }

  function closeCandidateSaveModal() {
    if (candidateSaveBusy) return;
    setCandidateSaveModal(undefined);
    setCandidateSaveError('');
  }

  async function confirmCandidatePresetSave() {
    const candidate = candidateSaveModal;
    const representative = candidateSaveRepresentative;
    if (!candidate || !representative) {
      setCandidateSaveError('저장할 프리셋 후보와 대표 파일을 확인할 수 없습니다.');
      return;
    }
    const trimmedName = candidateSaveName.trim();
    if (!trimmedName) {
      setCandidateSaveError('프리셋 이름을 입력하세요.');
      return;
    }
    if (!candidate.files.some((file) => file.path === representative.path)) {
      setCandidateSaveError('대표 파일은 같은 SHA 그룹 안의 .map 파일만 선택할 수 있습니다.');
      return;
    }
    setCandidateSaveBusy(true);
    setCandidateBusy(true);
    setCandidateSaveError('');
    setLastPresetSaveAction({
      status: 'saving',
      selectedCandidateId: candidate.candidateId,
      representativePath: representative.path,
    });
    try {
      const result = await controllerDesktopService.readFile(activeProfile?.profileId, representative.path);
      const createdPreset = await createControllerMapPresetFromCandidate(candidate, representative, result, {
        name: trimmedName,
        type: candidateSaveType,
        notes: candidateSaveNotes,
      });
      const nextPreset = candidateDuplicatePreset && candidateSaveDuplicateMode === 'replace'
        ? {
            ...createdPreset,
            presetId: candidateDuplicatePreset.presetId,
            createdAt: candidateDuplicatePreset.createdAt,
            updatedAt: new Date().toISOString(),
          }
        : createdPreset;
      const savedPresets = saveControllerMapPreset(nextPreset);
      setPresets(savedPresets);
      setCandidateMessage(`프리셋을 저장했습니다: ${nextPreset.name}. 원격 MiSTer 파일은 수정하지 않았습니다.`);
      setLastPresetSaveAction({
        status: 'success',
        selectedCandidateId: candidate.candidateId,
        representativePath: representative.path,
        savedPresetId: nextPreset.presetId,
      });
      setCandidateSaveModal(undefined);
    } catch (error) {
      const errorMessage = String(error instanceof Error ? error.message : error || '프리셋 후보 저장에 실패했습니다.');
      setCandidateSaveError(errorMessage);
      setLastPresetSaveAction({
        status: 'error',
        selectedCandidateId: candidate.candidateId,
        representativePath: representative.path,
        errorMessage,
      });
    } finally {
      if (mountedRef.current) {
        setCandidateSaveBusy(false);
        setCandidateBusy(false);
      }
    }
  }

  async function previewApplyPlan() {
    const preset = presets.find((item) => item.presetId === applyPresetId);
    const target = mapFiles.find((file) => file.path === applyTargetPath);
    if (!preset || !target) {
      setMessage('프리셋과 대상 .map 파일을 선택하세요.');
      return;
    }
    setBusy(true);
    try {
      const targetResult = await controllerDesktopService.readFile(activeProfile?.profileId, target.path);
      const plan = await createControllerMapApplyPlan(preset, target, targetResult);
      setApplyPlan(plan);
      setMessage('적용 준비 dry-run을 만들었습니다. 이번 단계에서는 원격 파일을 수정하지 않습니다.');
    } catch (error) {
      setApplyPlan(undefined);
      setMessage(String(error instanceof Error ? error.message : error || '적용 준비 dry-run에 실패했습니다.'));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function createBackup(file = selectedFile) {
    if (!file) return;
    setBusy(true);
    try {
      const result = await controllerDesktopService.createBackup({ profileId: activeProfile?.profileId, sourcePath: file.path });
      setMessage(result.message);
      if (result.backups) setBackups(result.backups);
      else await loadBackups(file);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function loadBackups(file = selectedFile) {
    if (!file) return;
    setBusy(true);
    try {
      const result = await controllerDesktopService.listBackups(activeProfile?.profileId, file.path);
      setBackups(result.backups);
      setBackupPreview(undefined);
      setMessage(result.message);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function viewBackup(backup: ControllerBackupEntry) {
    if (!selectedFile) return;
    setBusy(true);
    try {
      const result = await controllerDesktopService.readBackup(activeProfile?.profileId, selectedFile.path, backup.path);
      setBackupPreview(result);
      setMessage(result.message);
    } catch (error) {
      const result: ControllerBackupPreviewResult = {
        ok: false,
        sourcePath: selectedFile.path,
        content: '',
        readAt: new Date().toISOString(),
        message: String(error instanceof Error ? error.message : error || '컨트롤러 백업을 미리보기하지 못했습니다.'),
        errorCode: 'CONTROLLER_FS_RENDERER_BACKUP_READ_FAILED',
      };
      setBackupPreview(result);
      setMessage(result.message);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function restoreBackup(backup: ControllerBackupEntry) {
    if (!selectedFile) return;
    const confirmed = window.confirm(`${selectedFile.fileName} 파일을 선택한 백업 내용으로 덮어씁니다.\n복원 전 현재 파일을 다시 백업합니다.\n계속할까요?`);
    if (!confirmed) return;
    setBusy(true);
    try {
      const result = await controllerDesktopService.restoreBackup({
        profileId: activeProfile?.profileId,
        sourcePath: selectedFile.path,
        backupPath: backup.path,
        confirmed: true,
      });
      setMessage(result.message);
      if (result.ok) {
        await viewFile(selectedFile);
        await loadBackups(selectedFile);
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function loadConnectedDevices() {
    setCloneBusy(true);
    setCloneMessage('연결된 컨트롤러를 확인하는 중입니다...');
    try {
      const result = await controllerDesktopService.listConnectedDevices(activeProfile?.profileId);
      if (!mountedRef.current) return;
      setConnectedDevices(result.ok ? result.devices : []);
      setCloneMessage(result.message);
    } finally {
      if (mountedRef.current) setCloneBusy(false);
    }
  }

  async function runClone(dryRun: boolean) {
    const source = controllerKeyStats.find((stat) => stat.key === cloneSourceKey);
    if (!source) { setCloneMessage('매핑을 복사할 소스 컨트롤러를 선택하세요.'); return; }
    if (!cloneTarget) { setCloneMessage('새 매핑을 받을 대상 컨트롤러를 선택하세요.'); return; }
    if (source.vid === cloneTarget.vid && source.pid === cloneTarget.pid) { setCloneMessage('소스와 대상이 같은 컨트롤러입니다.'); return; }
    if (!dryRun && !window.confirm(`${source.key} 매핑을 ${cloneTarget.name || `${cloneTarget.vid}:${cloneTarget.pid}`}(으)로 복제합니다.\n기존 파일은 덮어쓰기 전에 자동 백업됩니다. 계속할까요?`)) return;
    setCloneBusy(true);
    setCloneMessage(dryRun ? '복제 미리보기를 만드는 중...' : '복제를 적용하는 중...');
    try {
      const result = await controllerDesktopService.cloneMappings({
        profileId: activeProfile?.profileId,
        source: { vid: source.vid, pid: source.pid, version: source.version },
        target: { vid: cloneTarget.vid, pid: cloneTarget.pid },
        dryRun,
        confirmed: !dryRun,
      });
      if (!mountedRef.current) return;
      setClonePlan(result);
      setCloneMessage(result.message);
      if (!dryRun && result.ok) await refreshInventory();
    } finally {
      if (mountedRef.current) setCloneBusy(false);
    }
  }

  async function runAutoMap(dryRun: boolean) {
    const source = controllerKeyStats.find((stat) => stat.key === cloneSourceKey);
    if (!source) { setCloneMessage('매핑을 복사할 소스 컨트롤러를 선택하세요.'); return; }
    if (!cloneTarget) { setCloneMessage('새 매핑을 받을 대상 컨트롤러를 선택하세요.'); return; }
    if (source.vid === cloneTarget.vid && source.pid === cloneTarget.pid) { setCloneMessage('소스와 대상이 같은 컨트롤러입니다.'); return; }
    if (!dryRun && !window.confirm(`${source.key}의 매핑을 학습한 변환표로 ${cloneTarget.name || `${cloneTarget.vid}:${cloneTarget.pid}`}용 맵을 자동 생성합니다.\n기존 파일은 덮어쓰기 전에 자동 백업됩니다. 시간이 걸릴 수 있습니다. 계속할까요?`)) return;
    setCloneBusy(true);
    setCloneMessage(dryRun ? '캘리브레이션을 학습하는 중...' : '자동 매핑을 생성하는 중... (코어가 많으면 수십 초 걸릴 수 있어요)');
    try {
      const result = await controllerDesktopService.autoMap({
        profileId: activeProfile?.profileId,
        source: { vid: source.vid, pid: source.pid, version: source.version },
        target: { vid: cloneTarget.vid, pid: cloneTarget.pid },
        dryRun,
        confirmed: !dryRun,
      });
      if (!mountedRef.current) return;
      setAutoMapPlan(result);
      setCloneMessage(result.message);
      if (!dryRun && result.ok) await refreshInventory();
    } finally {
      if (mountedRef.current) setCloneBusy(false);
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    void refreshInventory();
    return () => {
      mountedRef.current = false;
      scanRunRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setPresets(loadControllerMapPresets());
  }, []);

  useEffect(() => {
    void profileStore.loadProfiles().then(setSavedProfiles).catch(() => undefined);
  }, [profileStore]);

  useEffect(() => { savedProfilesRef.current = savedProfiles; }, [savedProfiles]);

  // Once saved profiles arrive, re-resolve the target (the first scan may have run before they loaded).
  useEffect(() => {
    if (savedProfiles.length > 0) void refreshInventory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedProfiles.length]);

  useEffect(() => {
    const api = window.helloMisterDesktop;
    if (!api?.probeMisterReachable || savedProfiles.length === 0) { setTargetDeviceStatus({}); return; }
    let cancelled = false;
    const check = async () => {
      let sessions: Awaited<ReturnType<NonNullable<typeof api.listSshSessions>>> = [];
      try { sessions = (await api.listSshSessions?.()) ?? []; } catch { sessions = []; }
      const results = await Promise.all(savedProfiles.map(async (profile) => {
        const probe = await api.probeMisterReachable!(profile.ipAddress, profile.port || 22, 2500).catch(() => ({ open: false }));
        const reachable = Boolean(probe?.open);
        // "연결됨"은 세션이 있으면서 지금 실제로 응답할 때만. 전원이 꺼진 stale 풀 세션을 연결됨으로 보지 않는다.
        const hasSession = sessions.some((session) => session.sessionId === profile.id || (session.host === profile.ipAddress && Number(session.port) === Number(profile.port || 22)));
        return [profile.id, { reachable, connected: reachable && hasSession }] as const;
      }));
      if (!cancelled) setTargetDeviceStatus(Object.fromEntries(results));
    };
    void check();
    const interval = window.setInterval(() => void check(), 10000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [savedProfiles]);

  const scanClass = statusClass(inventory, busy);
  const scannedFolderCount = inventory?.summary.scannedFolderCount || 0;
  const candidateFileCount = inventory?.summary.candidateFileCount || 0;
  const failedPathCount = inventory?.summary.failedPathCount || 0;

  return (
    <>
      <PageHeader
        eyebrow="컨트롤러 관리"
        title="파일 기반 컨트롤러 설정"
        description="연결된 MiSTer의 컨트롤러 관련 설정 파일을 읽고, 안전한 백업과 복원 흐름을 제공합니다."
      />
      <ActiveMisterBanner purpose="컨트롤러 관리는 선택한 대상 MiSTer를 기준으로 동작합니다." />

      {savedProfiles.length > 1 && (
        <SectionCard title="작업 대상">
          <div className="ini-target-bar ini-target-summary">
            <div className="ini-target-identity">
              <span>대상 MiSTer</span>
              <select className="ini-target-select" value={activeProfile?.profileId ?? ''} onChange={(event) => selectTargetProfile(event.target.value)} aria-label="컨트롤러 대상 MiSTer">
                {savedProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{misterDisplayName(profile)} · {targetStatusLabel(profile)}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="muted">{misterLabel(activeProfile)} 기준으로 컨트롤러 파일을 읽고 씁니다.</p>
        </SectionCard>
      )}

      {!activeProfile ? (
        <SectionCard title="MiSTer 연결 필요">
          <p className="muted">MiSTer 연결이 필요합니다. 먼저 MiSTer 연결 메뉴에서 연결하세요.</p>
          <Link className="button primary" to="/mister">MiSTer 연결로 이동</Link>
        </SectionCard>
      ) : (
        <div className="stack">
          <SectionCard title="새 컨트롤러 자동 매핑">
            <p className="muted">컨트롤러의 고유번호(VID/PID)로 현재 연결된 컨트롤러를 확인하고, 매핑이 없는 새 컨트롤러에 기존 컨트롤러의 전체 매핑을 복제합니다. 같은/호환 모델일 때 사용하세요(매핑 byte는 버튼 배치에 종속).</p>
            <div className="button-row">
              <button className="button primary" disabled={cloneBusy || busy} onClick={() => void loadConnectedDevices()}>
                <RefreshCw size={16} /> 연결된 컨트롤러 확인
              </button>
            </div>
            {connectedDevices.length > 0 && (
              <div className="table-list compact">
                <div className="table-row header"><span>컨트롤러</span><span>고유번호(VID:PID)</span><span>상태</span><span></span></div>
                {connectedDevices.map((device) => {
                  const mapped = mappedVidPidSet.has(`${device.vid}_${device.pid}`);
                  const isTarget = cloneTarget?.vid === device.vid && cloneTarget?.pid === device.pid;
                  return (
                    <div className="table-row" key={`${device.vid}_${device.pid}_${device.name}`}>
                      <span><strong>{device.name}</strong></span>
                      <span>{device.vid}:{device.pid}</span>
                      <span>{mapped ? '매핑 있음' : '새 컨트롤러'}</span>
                      <span>
                        <button className="button small" onClick={() => { setCloneTarget({ vid: device.vid, pid: device.pid, name: device.name }); setClonePlan(undefined); setAutoMapPlan(undefined); }}>
                          {isTarget ? '대상 선택됨' : '대상으로 선택'}
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="two-column">
              <label className="field">
                <span>소스 컨트롤러 (매핑 복사 원본)</span>
                <select value={cloneSourceKey} onChange={(event) => { setCloneSourceKey(event.target.value); setClonePlan(undefined); }}>
                  <option value="">선택</option>
                  {controllerKeyStats.map((stat) => <option key={stat.key} value={stat.key}>{stat.key} · 맵 {stat.count}개</option>)}
                </select>
              </label>
              <label className="field">
                <span>대상 컨트롤러 (새 매핑 생성)</span>
                <input value={cloneTarget ? `${cloneTarget.name ? `${cloneTarget.name} · ` : ''}${cloneTarget.vid}:${cloneTarget.pid}` : ''} readOnly placeholder="위 목록에서 ‘복제 대상으로’ 선택" />
              </label>
            </div>
            <p className="muted"><strong>같은/호환 모델</strong>이면 매핑을 통째로 복제합니다.</p>
            <div className="button-row">
              <button className="button" disabled={cloneBusy || !cloneSourceKey || !cloneTarget} onClick={() => void runClone(true)}>복제 미리보기</button>
              <button className="button primary" disabled={cloneBusy || !clonePlan?.ok || !clonePlan?.dryRun} onClick={() => void runClone(false)}>복제 적용</button>
            </div>
            <p className="muted"><strong>다른 모델</strong>이면, 새 컨트롤러를 소스가 가진 코어 1~2개(예: MegaDrive)에 직접 매핑한 뒤 자동 매핑으로 변환·생성합니다.</p>
            <div className="button-row">
              <button className="button" disabled={cloneBusy || !cloneSourceKey || !cloneTarget} onClick={() => void runAutoMap(true)}>자동 매핑 미리보기</button>
              <button className="button primary" disabled={cloneBusy || !autoMapPlan?.ok || !autoMapPlan?.dryRun} onClick={() => void runAutoMap(false)}>자동 매핑 적용</button>
            </div>
            {autoMapPlan?.ok && (
              <div className="detail-list">
                <div><span>캘리브레이션 코어</span><strong>{(autoMapPlan.sharedCores || []).slice(0, 8).join(', ') || '-'}{(autoMapPlan.sharedCores?.length || 0) > 8 ? ' 외' : ''}</strong></div>
                <div><span>학습한 버튼코드</span><strong>{autoMapPlan.distinctSourceCodes ?? '-'}종</strong></div>
                <div><span>생성 대상 코어</span><strong>{autoMapPlan.coresToGenerate ?? '-'}개</strong></div>
                {!autoMapPlan.dryRun && <div><span>결과</span><strong>생성 {autoMapPlan.created ?? 0} · 덮어쓰기 {autoMapPlan.overwritten ?? 0} · 일부만 {autoMapPlan.partial ?? 0} · 건너뜀 {autoMapPlan.skippedEmpty ?? 0} · 미커버 {autoMapPlan.uncoveredCodeCount ?? 0}종</strong></div>}
              </div>
            )}
            {cloneMessage && <p className="callout">{cloneMessage}</p>}
            {clonePlan?.plan && clonePlan.plan.length > 0 && (
              <div className="table-list compact">
                <div className="table-row header"><span>게임/코어</span><span>생성될 파일</span><span>상태</span></div>
                {clonePlan.plan.slice(0, 40).map((item) => (
                  <div className="table-row" key={item.targetPath}>
                    <span>{item.game}</span>
                    <span><small>{item.targetFileName}</small></span>
                    <span>{item.targetExists ? '덮어쓰기(백업)' : '새로 생성'}</span>
                  </div>
                ))}
                {clonePlan.plan.length > 40 && <p className="muted">외 {clonePlan.plan.length - 40}개</p>}
              </div>
            )}
          </SectionCard>

          <SectionCard title="map 분석">
            <div className="mini-stats">
              <span>.map 파일 {mapFiles.length}개</span>
              <span>조이스틱 키 그룹 {mapGroups.byController.length}개</span>
              <span>게임 키 그룹 {mapGroups.byGame.length}개</span>
              <span>길이 그룹 {mapGroups.byLength.length}개</span>
            </div>
            <p className="muted">플랫폼별 그룹화와 프리셋 후보 분석에는 전체 bytes가 필요하지 않습니다. 기본 내보내기는 파일명, joystick/game key, byte 길이, SHA-256 중심의 경량 데이터만 포함합니다.</p>
            <div className="button-row">
              <button className="button primary" disabled={busy || exportBusy || mapFiles.length === 0} onClick={() => void exportControllerMapAnalysis('zip', 'hash')}>
                경량 분석 ZIP 내보내기
              </button>
              <button className="button" disabled={busy || exportBusy || mapFiles.length === 0} onClick={() => void exportControllerMapAnalysis('summary', 'summary')}>
                메타데이터만 내보내기
              </button>
              <button className="button" disabled={busy || exportBusy || selectedMapGroupFiles().length === 0} onClick={() => void exportControllerMapAnalysis('zip', 'full', 'selected-group')}>
                선택 그룹 bytes 포함
              </button>
              <button className="button" disabled={busy || exportBusy || mapFiles.length === 0} onClick={() => void exportControllerMapAnalysis('zip', 'full', 'all')}>
                전체 bytes 포함
              </button>
              <button className="button" disabled={busy || exportBusy || mapFiles.length === 0} onClick={() => void exportControllerMapAnalysis('csv', 'summary')}>
                CSV 내보내기
              </button>
              {exportBusy && <button className="button danger" onClick={cancelControllerMapExport}>취소</button>}
            </div>
            {exportMessage && <p className="callout">{exportMessage}</p>}
            <div className="two-column">
              <div className="stack">
                <label className="field">
                  <span>파일 A</span>
                  <select value={compareAPath} onChange={(event) => setCompareAPath(event.target.value)}>
                    <option value="">선택</option>
                    {mapFiles.map((file) => <option key={file.path} value={file.path}>{selectedOptionLabel(file)}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>파일 B</span>
                  <select value={compareBPath} onChange={(event) => setCompareBPath(event.target.value)}>
                    <option value="">선택</option>
                    {mapFiles.map((file) => <option key={file.path} value={file.path}>{selectedOptionLabel(file)}</option>)}
                  </select>
                </label>
                <div className="button-row">
                  <button className="button primary" disabled={busy || !compareAPath || !compareBPath} onClick={() => void compareSelectedMapFiles()}>
                    2개 파일 비교
                  </button>
                  <button className="button" disabled={busy || !compareAPath} onClick={() => void analyzeSameControllerGroup()}>
                    같은 조이스틱 파일 비교
                  </button>
                </div>
                {compareMessage && <p className="callout">{compareMessage}</p>}
              </div>
              <div className="stack">
                <div className="detail-list">
                  <div><span>비교 요약</span><strong>{diffSummaryText(compareResult)}</strong></div>
                  <div><span>길이 경고</span><strong>{compareResult?.lengthWarning || '없음'}</strong></div>
                  <div><span>동일 여부</span><strong>{compareResult ? (compareResult.identical ? '동일' : '차이 있음') : '-'}</strong></div>
                </div>
                {compareResult && compareResult.shownDifferences.length > 0 && (
                  <div className="table-list compact">
                    <div className="table-row header"><span>offset</span><span>A hex</span><span>B hex</span><span>A/B dec</span></div>
                    {compareResult.shownDifferences.slice(0, 24).map((row) => (
                      <div className="table-row" key={row.offset}>
                        <span>{row.offset.toString().padStart(6, '0')}</span>
                        <span>{row.aHex}</span>
                        <span>{row.bHex}</span>
                        <span>{row.aDec ?? '-'} / {row.bDec ?? '-'}</span>
                      </div>
                    ))}
                  </div>
                )}
                {frequentOffsets.length > 0 && (
                  <div>
                    <strong>자주 바뀌는 offset 상위 {frequentOffsets.length}개</strong>
                    <div className="mini-stats">
                      {frequentOffsets.map((item) => <span key={item.offset}>{item.offset}: {item.count}회</span>)}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <details>
              <summary>그룹 보기</summary>
              <div className="two-column">
                <div>
                  <strong>조이스틱 키별</strong>
                  <div className="table-list compact">
                    {mapGroups.byController.map((group) => (
                      <div className="table-row" key={group.key}>
                        <span><strong>{group.label}</strong><small>{group.sampleFileNames.join(', ')}</small></span>
                        <span>{group.files.length}개</span>
                        <span>{formatMapByteLengthCounts(group.byteLengthCounts)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <strong>게임 키별</strong>
                  <div className="table-list compact">
                    {mapGroups.byGame.map((group) => (
                      <div className="table-row" key={group.key}>
                        <span><strong>{group.label}</strong><small>{group.sampleFileNames.join(', ')}</small></span>
                        <span>{group.files.length}개</span>
                        <span>{formatMapByteLengthCounts(group.byteLengthCounts)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </details>
          </SectionCard>

          <SectionCard title="로컬 map 프리셋">
            <div className="button-row">
              <label className="field inline-field">
                <span>프리셋 유형</span>
                <select value={presetType} onChange={(event) => setPresetType(event.target.value as ControllerMapPresetType)}>
                  {Object.entries(controllerMapPresetTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <button className="button primary" disabled={busy || !selectedFile || !/\.map$/i.test(selectedFile.fileName)} onClick={() => void saveSelectedMapAsPreset()}>
                선택한 .map을 프리셋으로 저장
              </button>
            </div>
            <p className="muted">프리셋은 로컬 metadata에만 저장합니다. 원격 MiSTer 파일은 수정하지 않습니다.</p>
            <div className="table-list compact">
              {presets.map((preset) => (
                <div className="table-row" key={preset.presetId}>
                  <span>
                    <strong>{preset.name}</strong>
                    <small>{controllerMapPresetTypeLabels[preset.type]} · {preset.gameKey} · {preset.controllerKey}</small>
                  </span>
                  <span>{preset.byteLength} bytes</span>
                  <span>{preset.sha256.slice(0, 12)}...</span>
                  <button className="button small" onClick={() => setPresets(deleteControllerMapPreset(preset.presetId))}>삭제</button>
                </div>
              ))}
              {presets.length === 0 && <p className="muted">저장된 로컬 map 프리셋이 없습니다.</p>}
            </div>
          </SectionCard>

          <SectionCard title="프리셋 후보">
            <div className="mini-stats">
              <span>주 controllerKey {dominantControllerKey || '-'}</span>
              <span>후보 그룹 {presetCandidates.length}개</span>
              <span>표시 {filteredPresetCandidates.length}개</span>
              <span>SHA 확인 {candidateHashEntries.filter((entry) => entry.sha256).length}/{mapFiles.length}</span>
            </div>
            <p className="muted">같은 controllerKey, byteLength, SHA-256을 가진 .map 파일을 묶어 프리셋 후보로 보여줍니다. 버튼 의미는 추정하지 않고, 대표 .map bytes 하나만 로컬 프리셋으로 저장합니다.</p>
            <div className="button-row">
              <button className="button primary" disabled={busy || candidateBusy || mapFiles.length === 0} onClick={() => void preparePresetCandidates()}>
                프리셋 후보 준비
              </button>
              <label className="field inline-field">
                <span>controllerKey</span>
                <select value={candidateControllerFilter} onChange={(event) => setCandidateControllerFilter(event.target.value)}>
                  <option value="">주 controllerKey ({dominantControllerKey || '-'})</option>
                  {candidateControllerOptions.map((key) => <option key={key} value={key}>{key}</option>)}
                </select>
              </label>
              <label className="field inline-field">
                <span>byteLength</span>
                <select value={candidateByteLengthFilter} onChange={(event) => setCandidateByteLengthFilter(event.target.value)}>
                  <option value="128">128 bytes</option>
                  <option value="2048">2048 bytes 예외</option>
                  <option value="">전체</option>
                </select>
              </label>
              <label className="field inline-field">
                <span>최소 파일 수</span>
                <input type="number" min={1} max={9999} value={candidateMinFileCount} onChange={(event) => setCandidateMinFileCount(Math.max(1, Number(event.target.value || 1)))} />
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={candidateRecommendedOnly} onChange={(event) => setCandidateRecommendedOnly(event.target.checked)} />
                <span>추천 후보만</span>
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={candidateShowExceptions} onChange={(event) => setCandidateShowExceptions(event.target.checked)} />
                <span>2048-byte 예외 보기</span>
              </label>
            </div>
            {candidateMessage && <p className="callout">{candidateMessage}</p>}
            <div className="table-list compact">
              {filteredPresetCandidates.slice(0, 40).map((candidate, index) => {
                const selectedRepresentativePath = candidateRepresentativeOverrides[candidate.candidateId] || candidate.representativePath;
                const savedPreset = presets.find((preset) => preset.controllerKey === candidate.controllerKey && preset.sha256 === candidate.sha256);
                return (
                  <div className="table-row" key={candidate.candidateId}>
                    <span>
                      <strong>#{index + 1} {candidate.familyGuess}</strong>
                      <small>{candidate.controllerKey} · {candidate.byteLength} bytes · {candidate.sha256.slice(0, 12)} · {candidate.confidence}</small>
                      <small>sample: {candidate.sampleGameKeys.slice(0, 8).join(', ') || candidate.sampleFiles.slice(0, 3).join(', ')}</small>
                      {savedPreset && <small className="status-text success">저장됨: {savedPreset.name}</small>}
                      {candidate.warnings.length > 0 && <small className="status-text warning">{candidate.warnings.join(' ')}</small>}
                    </span>
                    <span>{candidate.fileCount} files</span>
                    <span>
                      <select
                        value={selectedRepresentativePath}
                        onChange={(event) => setCandidateRepresentativeOverrides((current) => ({ ...current, [candidate.candidateId]: event.target.value }))}
                      >
                        {candidate.files.slice(0, 80).map((file) => <option key={file.path} value={file.path}>{file.fileName}</option>)}
                      </select>
                    </span>
                    <button
                      className="button small"
                      disabled={candidateBusy || candidate.byteLength === 2048}
                      title={candidate.byteLength === 2048 ? '2048-byte 예외 그룹은 기본 적용 후보에서 제외됩니다.' : '대표 파일 하나만 읽어 로컬 프리셋으로 저장합니다.'}
                      onClick={(event) => {
                        event.stopPropagation();
                        openCandidateSaveModal(candidate);
                      }}
                    >
                      그룹을 프리셋으로 저장
                    </button>
                  </div>
                );
              })}
              {candidateHashEntries.length > 0 && filteredPresetCandidates.length === 0 && (
                <p className="muted">현재 필터에 맞는 프리셋 후보가 없습니다. 추천 후보/byteLength/최소 파일 수 조건을 조정하세요.</p>
              )}
              {candidateHashEntries.length === 0 && (
                <p className="muted">프리셋 후보 준비를 누르면 SHA-256 기준 후보 그룹을 만듭니다.</p>
              )}
            </div>
          </SectionCard>

          <SectionCard title="적용 준비 dry-run">
            <p className="muted">이번 단계에서는 실제 원격 .map 파일을 저장하지 않습니다. 프리셋과 대상 파일의 byte 차이와 적용 가능 여부만 확인합니다.</p>
            <div className="two-column">
              <div className="stack">
                <label className="field">
                  <span>source preset</span>
                  <select value={applyPresetId} onChange={(event) => setApplyPresetId(event.target.value)}>
                    <option value="">선택</option>
                    {presets.map((preset) => <option key={preset.presetId} value={preset.presetId}>{preset.name} · {preset.controllerKey}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>target .map</span>
                  <select value={applyTargetPath} onChange={(event) => setApplyTargetPath(event.target.value)}>
                    <option value="">선택</option>
                    {mapFiles.map((file) => <option key={file.path} value={file.path}>{selectedOptionLabel(file)}</option>)}
                  </select>
                </label>
                <button className="button primary" disabled={busy || !applyPresetId || !applyTargetPath} onClick={() => void previewApplyPlan()}>
                  적용 준비 확인
                </button>
              </div>
              <div className="stack">
                {applyPlan ? (
                  <>
                    <div className="detail-list">
                      <div><span>적용 가능</span><strong>{applyPlan.allowed ? 'dry-run 가능' : '불가'}</strong></div>
                      <div><span>백업 필요</span><strong>{applyPlan.backupRequired ? '필수' : '아님'}</strong></div>
                      <div><span>조이스틱 키</span><strong>{applyPlan.controllerKeyMatches ? '일치' : '다름/주의'}</strong></div>
                      <div><span>byte 길이</span><strong>{applyPlan.byteLengthMatches ? '일치' : '다름'}</strong></div>
                      <div><span>diff</span><strong>{diffSummaryText(applyPlan.diff)}</strong></div>
                    </div>
                    {applyPlan.warnings.length > 0 && <p className="callout warning">{applyPlan.warnings.join(' ')}</p>}
                    <p className="muted">실제 저장 버튼은 아직 비활성 단계입니다. 다음 단계에서 백업/복원 검증 후 열 수 있습니다.</p>
                  </>
                ) : (
                  <p className="muted">프리셋과 대상 .map 파일을 선택한 뒤 dry-run을 만드세요.</p>
                )}
              </div>
            </div>
          </SectionCard>
          <SectionCard title="현재 MiSTer">
            <div className="summary-grid">
              <div>
                <span className="eyebrow">대상</span>
                <strong>{misterLabel(activeProfile)}</strong>
              </div>
              <div>
                <span className="eyebrow">스캔 상태</span>
                <strong className={`status-text ${scanClass}`}>{statusMessage(inventory, busy)}</strong>
              </div>
              <div>
                <span className="eyebrow">백업/복원</span>
                <strong>{inventory?.ok ? '컨트롤러 전용 adapter 사용' : '읽기 확인 필요'}</strong>
              </div>
            </div>
            <div className="button-row">
              <button className="button primary" disabled={busy} onClick={() => void refreshInventory()}>
                <RefreshCw size={16} /> 설정 파일 새로고침
              </button>
              {selectedFile && (
                <>
                  <button className="button" disabled={busy} onClick={() => void viewFile()}>
                    <Eye size={16} /> 내용 보기
                  </button>
                  <button className="button" disabled={busy || !selectedFile.canBackup} onClick={() => void createBackup()}>
                    <Archive size={16} /> 백업
                  </button>
                  <button className="button" disabled={busy} onClick={() => void loadBackups()}>
                    <RotateCcw size={16} /> 백업 목록
                  </button>
                </>
              )}
            </div>
            {message && <p className={scanClass === 'danger' ? 'callout danger' : 'callout'}>{message}</p>}
          </SectionCard>

          <div className="two-column">
            <SectionCard title="설정 파일">
              <div className="mini-stats">
                <span>후보 파일 {candidateFileCount}개</span>
                <span>스캔 폴더 {scannedFolderCount}개</span>
                <span>실패 경로 {failedPathCount}개</span>
                <span>마지막 새로고침 {inventory?.finishedAt ? formatDate(inventory.finishedAt) : '-'}</span>
                <span>소요 시간 {inventory?.durationMs ?? 0}ms</span>
              </div>
              <div className="table-list compact">
                {sortedFiles.map((file) => {
                  const mapMeta = parseControllerMapFileName(file.fileName);
                  return (
                    <button
                      key={file.id}
                      type="button"
                      className={`table-row ${selectedFile?.path === file.path ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedFile(file);
                        setReadResult(undefined);
                        setBackupPreview(undefined);
                        setBackups([]);
                      }}
                    >
                      <span>
                        <strong>{file.fileName}</strong>
                        <small>{file.path}</small>
                        {/\.map$/i.test(file.fileName) && (
                          <small>
                            {mapMeta.isRecognizedInputMap
                              ? `게임 키 추정 ${mapMeta.gameKey} · 조이스틱 키 추정 ${mapMeta.controllerKey} · VID/PID 추정 ${mapMeta.vid}/${mapMeta.pid}`
                              : '파일명 규칙 미확인 map'}
                          </small>
                        )}
                      </span>
                      <span>{file.typeLabel}</span>
                      <span>{formatBytes(file.sizeBytes)}</span>
                      <span>{formatDate(file.modifiedAt)}</span>
                    </button>
                  );
                })}
                {sortedFiles.length === 0 && !busy && (
                  <p className="muted">후보 파일이 없습니다. 개발자 상세에서 스캔 경로와 실패 이유를 확인하세요.</p>
                )}
              </div>
            </SectionCard>

            <SectionCard title="읽기 / 백업 / 복원">
              {selectedFile ? (
                <div className="stack">
                  <div className="detail-list">
                    <div><span>파일</span><strong>{selectedFile.fileName}</strong></div>
                    <div><span>종류</span><strong>{selectedFile.typeLabel}</strong></div>
                    <div><span>복원 가능</span><strong>{canRestoreControllerTarget(selectedFile) ? '가능' : '읽기/백업만 가능'}</strong></div>
                  </div>
                  {readResult?.ok && (
                    <ControllerPreviewBlock title="controller file preview" preview={readResult.preview} content={readResult.content} />
                  )}
                  {readResult?.ok && !readResult.preview && !hasSuspiciousControllerText(readResult.content) && (
                    <textarea
                      className="code-preview"
                      value={readResult.content}
                      readOnly
                      aria-label="컨트롤러 설정 파일 내용"
                    />
                  )}
                  {readResult && !readResult.ok && <p className="callout danger">{readResult.message}</p>}
                  <div className="backup-list">
                    {backups.map((backup) => (
                      <div className="backup-row" key={backup.path}>
                        <span>
                          <strong>{backup.fileName}</strong>
                          <small>{formatDate(backup.createdAt)} · {formatBytes(backup.sizeBytes)}</small>
                        </span>
                        <button
                          className="button small"
                          disabled={busy}
                          onClick={() => void viewBackup(backup)}
                        >
                          미리보기
                        </button>
                        <button
                          className="button small"
                          disabled={busy || !canRestoreControllerTarget(selectedFile)}
                          title={canRestoreControllerTarget(selectedFile) ? '복원 전 현재 파일을 다시 백업합니다.' : '복원은 /media/fat/config 아래 파일에만 허용됩니다.'}
                          onClick={() => void restoreBackup(backup)}
                        >
                          복원
                        </button>
                      </div>
                    ))}
                    {backups.length === 0 && <p className="muted">선택한 파일의 백업 목록을 아직 읽지 않았습니다.</p>}
                  </div>
                  {backupPreview?.ok && (
                    <ControllerPreviewBlock title="backup preview" preview={backupPreview.preview} content={backupPreview.content} />
                  )}
                  {backupPreview && !backupPreview.ok && <p className="callout danger">{backupPreview.message}</p>}
                </div>
              ) : (
                <p className="muted">설정 파일을 선택하세요.</p>
              )}
            </SectionCard>
          </div>

          <SectionCard title="프리셋 구조">
            <div className="preset-grid">
              {controllerPresetList.map((preset) => (
                <div className="preset-card" key={preset.presetId}>
                  <div className="preset-title">
                    <ShieldCheck size={16} />
                    <strong>{preset.name}</strong>
                  </div>
                  <p>{preset.description}</p>
                  <small>{preset.buttonLayout.join(' / ')}</small>
                  <button className="button small" disabled title="대상 mapping 파일 구조 확인 후 활성화됩니다.">적용 준비 중</button>
                </div>
              ))}
            </div>
            <p className="muted">실시간 물리 컨트롤러 감지는 raw command 없이 확정할 수 있는 범위가 제한됩니다. 현재 단계에서는 파일 기반으로 확인 가능한 정보만 표시합니다.</p>
          </SectionCard>

          <SectionCard title="개발자 상세">
            <details>
              <summary>스캔 경로와 실패 정보</summary>
              <pre className="code-block">{JSON.stringify({
                activeProfile: inventory?.diagnostics?.activeProfile || {
                  profileId: activeProfile.profileId,
                  alias: activeProfile.alias,
                  host: activeProfile.ipAddress,
                  port: activeProfile.port,
                },
                candidateRoots: inventory?.diagnostics?.candidateRoots || inventory?.candidateRoots || [],
                scannedRoots: inventory?.diagnostics?.scannedRoots || inventory?.scannedRoots || [],
                failedRoots: inventory?.diagnostics?.failedRoots || inventory?.failedPaths || [],
                errors: inventory?.diagnostics?.errors || inventory?.errors || [],
                startedAt: inventory?.diagnostics?.startedAt || inventory?.startedAt,
                finishedAt: inventory?.diagnostics?.finishedAt || inventory?.finishedAt,
                durationMs: inventory?.diagnostics?.durationMs || inventory?.durationMs,
                status: inventory?.diagnostics?.status || inventory?.status,
                lastPresetSaveAction,
              }, null, 2)}</pre>
            </details>
          </SectionCard>
        </div>
      )}
      {candidateSaveModal && (
        <div className="modal-backdrop" role="presentation" onClick={closeCandidateSaveModal}>
          <div
            className="compare-modal"
            role="dialog"
            aria-modal="true"
            aria-label="컨트롤러 map 프리셋 저장"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h3>컨트롤러 map 프리셋 저장</h3>
                <p className="muted">대표 .map 파일 하나만 읽어 SHA-256을 검증한 뒤 로컬 프리셋으로 저장합니다.</p>
              </div>
              <button className="button small" disabled={candidateSaveBusy} onClick={closeCandidateSaveModal}>닫기</button>
            </div>

            <div className="summary-grid">
              <div><span className="eyebrow">대표 파일</span><strong>{candidateSaveRepresentative?.fileName || candidateSaveModal.representativeFile.fileName}</strong></div>
              <div><span className="eyebrow">controllerKey</span><strong>{candidateSaveModal.controllerKey}</strong></div>
              <div><span className="eyebrow">byteLength</span><strong>{candidateSaveModal.byteLength} bytes</strong></div>
              <div><span className="eyebrow">SHA-256</span><strong>{candidateSaveModal.sha256.slice(0, 16)}...</strong></div>
              <div><span className="eyebrow">fileCount</span><strong>{candidateSaveModal.fileCount}</strong></div>
              <div><span className="eyebrow">sample gameKeys</span><strong>{candidateSaveModal.sampleGameKeys.slice(0, 4).join(', ') || '-'}</strong></div>
            </div>

            <div className="two-column">
              <label className="field">
                <span>프리셋 이름</span>
                <input value={candidateSaveName} onChange={(event) => setCandidateSaveName(event.target.value)} disabled={candidateSaveBusy} />
              </label>
              <label className="field">
                <span>프리셋 유형</span>
                <select value={candidateSaveType} onChange={(event) => setCandidateSaveType(event.target.value as ControllerMapPresetType)} disabled={candidateSaveBusy}>
                  {Object.entries(controllerMapPresetTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>

            <label className="field">
              <span>대표 파일</span>
              <select value={candidateSaveRepresentativePath} onChange={(event) => setCandidateSaveRepresentativePath(event.target.value)} disabled={candidateSaveBusy}>
                {candidateSaveModal.files.slice(0, 80).map((file) => <option key={file.path} value={file.path}>{file.fileName}</option>)}
              </select>
            </label>

            <label className="field">
              <span>메모</span>
              <textarea value={candidateSaveNotes} onChange={(event) => setCandidateSaveNotes(event.target.value)} disabled={candidateSaveBusy} />
            </label>

            {candidateDuplicatePreset && (
              <div className="callout warning">
                <strong>같은 controllerKey + 유형 + SHA-256 프리셋이 이미 있습니다.</strong>
                <div className="button-row">
                  <label className="checkbox-row">
                    <input
                      type="radio"
                      checked={candidateSaveDuplicateMode === 'replace'}
                      onChange={() => setCandidateSaveDuplicateMode('replace')}
                      disabled={candidateSaveBusy}
                    />
                    <span>기존 프리셋 교체: {candidateDuplicatePreset.name}</span>
                  </label>
                  <label className="checkbox-row">
                    <input
                      type="radio"
                      checked={candidateSaveDuplicateMode === 'copy'}
                      onChange={() => setCandidateSaveDuplicateMode('copy')}
                      disabled={candidateSaveBusy}
                    />
                    <span>다른 이름으로 별도 저장</span>
                  </label>
                </div>
              </div>
            )}

            {candidateSaveError && <p className="callout danger">{candidateSaveError}</p>}

            <div className="modal-actions">
              <button className="button" disabled={candidateSaveBusy} onClick={closeCandidateSaveModal}>취소</button>
              <button
                className="button primary"
                disabled={candidateSaveBusy || !candidateSaveName.trim()}
                onClick={() => void confirmCandidatePresetSave()}
              >
                {candidateSaveBusy ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
