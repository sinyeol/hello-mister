import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSearch,
  FolderOpen,
  HardDrive,
  Loader2,
  Monitor,
  Radar,
  Rocket,
  ShieldAlert,
  Wifi,
} from 'lucide-react';
import { PageHeader } from '../components/cards/PageHeader';
import { SectionCard } from '../components/cards/SectionCard';
import { StatusBadge } from '../components/status/StatusBadge';
import { buildMisterIni, sdVideoPresets } from '../data/sdVideoPresets';
import { recommendedScripts } from '../data/misterScriptCatalog';
import { DesktopMrFusionDownloadService } from '../services/sd/mrFusionDownload';
import {
  DesktopSdCardDetectionService,
  formatDriveCapacity,
  formatSdStructureSummary,
  isDriveSelectableForMrFusion,
} from '../services/sd/sdCardDetection';
import { DesktopSdFlashService } from '../services/sd/sdFlash';
import { createTaskId, taskQueue } from '../services/tasks/taskQueue';
import type {
  MrFusionDownloadProgress,
  MrFusionImage,
  MrFusionVariant,
  SdCardDrive,
  SdFlashProgress,
  SdStructureCheckResult,
} from '../types/sd';

type WizardMode = 'new' | 'inspect';
type StepKey = 'mode' | 'image' | 'drive' | 'flash' | 'wifi' | 'boot' | 'video' | 'inspect';

const NEW_STEPS: Array<{ key: StepKey; title: string }> = [
  { key: 'mode', title: '시작' },
  { key: 'image', title: '이미지' },
  { key: 'drive', title: '카드 선택' },
  { key: 'flash', title: '굽기' },
  { key: 'wifi', title: 'Wi‑Fi·스크립트' },
  { key: 'boot', title: '부팅' },
  { key: 'video', title: '영상 출력' },
];
const INSPECT_STEPS: Array<{ key: StepKey; title: string }> = [
  { key: 'mode', title: '시작' },
  { key: 'inspect', title: '카드 점검' },
];

const DOWNLOAD_PHASE: Record<string, string> = {
  resolve: '릴리스 확인',
  download: '다운로드',
  verify: '무결성 검증',
  extract: '압축 해제',
  done: '완료',
  error: '오류',
};
const FLASH_PHASE: Record<string, string> = {
  validate: '대상 검증',
  prepare: '준비',
  elevating: '관리자 권한 대기',
  clearing: '파티션 정리',
  writing: '이미지 기록',
  verifying: '확인',
  finalizing: '마무리',
  done: '완료',
  error: '오류',
};

function normalizeLetter(value: string | undefined) {
  // "F", "F:", "F::", "F:\\" → 모두 "F" (대소문자·콜론 무시).
  return String(value || '').replace(/[:\\]+$/, '').trim().toUpperCase();
}

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return '';
  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)}GB`;
  return `${mb.toFixed(1)}MB`;
}

export function SdCardManagementPage() {
  const navigate = useNavigate();
  const downloadService = useMemo(() => new DesktopMrFusionDownloadService(), []);
  const driveService = useMemo(() => new DesktopSdCardDetectionService(), []);
  const flashService = useMemo(() => new DesktopSdFlashService(), []);

  const [mode, setMode] = useState<WizardMode | undefined>();
  const [stepIndex, setStepIndex] = useState(0);

  // image step
  const [variant, setVariant] = useState<MrFusionVariant>('mr-fusion');
  const [image, setImage] = useState<MrFusionImage | undefined>();
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<MrFusionDownloadProgress | undefined>();
  const [imageMessage, setImageMessage] = useState('');
  const [resolving, setResolving] = useState(false);
  const [localCandidate, setLocalCandidate] = useState<{ tag?: string; image: MrFusionImage } | undefined>();

  // drive step
  const [drives, setDrives] = useState<SdCardDrive[]>([]);
  const [selectedDrive, setSelectedDrive] = useState<SdCardDrive | undefined>();
  const [scanningDrives, setScanningDrives] = useState(false);

  // flash step
  const [confirmation, setConfirmation] = useState('');
  const [enableRealFlash, setEnableRealFlash] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const [flashProgress, setFlashProgress] = useState<SdFlashProgress | undefined>();
  const [flashResult, setFlashResult] = useState<{ ok: boolean; dryRun: boolean; cancelled?: boolean; message: string; logs: string[] } | undefined>();
  const [realFlashDone, setRealFlashDone] = useState(false);

  // wifi step
  const [wifiDrive, setWifiDrive] = useState<SdCardDrive | undefined>();

  // inspect step
  const [structureResult, setStructureResult] = useState<SdStructureCheckResult | undefined>();
  const [inspecting, setInspecting] = useState(false);

  const steps = mode === 'inspect' ? INSPECT_STEPS : NEW_STEPS;
  const current = steps[Math.min(stepIndex, steps.length - 1)];
  const driveLetter = normalizeLetter(selectedDrive?.driveLetter || selectedDrive?.mountPoint);
  const confirmationMatches = Boolean(driveLetter) && normalizeLetter(confirmation) === driveLetter;
  const imageReady = Boolean(image?.localPath);

  function canAdvance(key: StepKey): boolean {
    switch (key) {
      case 'mode':
        return Boolean(mode);
      case 'image':
        return imageReady;
      case 'drive':
        return Boolean(selectedDrive && isDriveSelectableForMrFusion(selectedDrive));
      case 'flash':
        return realFlashDone;
      case 'wifi':
        return true;
      default:
        return true;
    }
  }

  function goNext() {
    setStepIndex((index) => Math.min(index + 1, steps.length - 1));
  }
  function goBack() {
    setStepIndex((index) => Math.max(index - 1, 0));
  }
  function jumpTo(index: number) {
    if (index <= stepIndex) setStepIndex(index);
  }

  async function scanDrives(target: 'flash' | 'wifi' | 'video' = 'flash') {
    setScanningDrives(true);
    try {
      const result = await driveService.listRemovableDrives();
      setDrives(result);
      if (target === 'flash' && !selectedDrive) setSelectedDrive(result.find(isDriveSelectableForMrFusion));
      if (target === 'wifi' || target === 'video') {
        // 방금 구운 카드를 우선 자동 선택(req 8) → 없으면 FAT/미스터 카드 → 없으면 첫 카드.
        const burnedLetter = normalizeLetter(selectedDrive?.driveLetter || selectedDrive?.mountPoint);
        const byBurned = burnedLetter ? result.find((d) => normalizeLetter(d.driveLetter || d.mountPoint) === burnedLetter) : undefined;
        const fat = result.find((d) => /fat/i.test(d.fileSystem || '') || /mrfusion|mister/i.test(d.volumeName || ''));
        setWifiDrive(byBurned || fat || result[0] || selectedDrive);
      }
    } catch (error) {
      setImageMessage(`드라이브 감지 실패: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setScanningDrives(false);
    }
  }

  // 이미지 준비: 같은 버전의 로컬 이미지가 있으면 다운로드 대신 재사용 여부를 물어본다(req 1).
  // SHA가 달라졌거나(changed) 로컬에 없으면(none) 곧바로 다운로드.
  async function startImageDownload() {
    setLocalCandidate(undefined);
    setImage(undefined);
    setImageMessage('');
    setDownloadProgress({ phase: 'resolve', message: '최신 릴리스 확인' });
    setResolving(true);
    let status: 'local-verified' | 'changed' | 'none' | 'error' = 'none';
    try {
      const resolved = await downloadService.resolveLatest(variant, { onProgress: setDownloadProgress });
      status = resolved.status;
      if (resolved.status === 'local-verified' && resolved.image) {
        setLocalCandidate({ tag: resolved.tag, image: resolved.image });
        return;
      }
      if (resolved.status === 'error') {
        setImageMessage(resolved.message || '릴리스 확인에 실패했습니다.');
        return;
      }
    } finally {
      setResolving(false);
    }
    // changed(로컬 SHA 불일치) → 새로 받기(force). none → 새로 받기.
    await runDownload(status === 'changed');
  }

  async function runDownload(force = false) {
    setDownloading(true);
    setImageMessage('');
    setDownloadProgress({ phase: 'resolve', message: '시작' });
    try {
      const result = await downloadService.downloadLatest(variant, { force, onProgress: setDownloadProgress });
      if (result.image) setImage(result.image);
      setImageMessage([result.message, ...result.logs].join('\n'));
    } finally {
      setDownloading(false);
    }
  }

  async function selectLocalImage() {
    const result = await downloadService.selectLocalImage();
    if (result.image) setImage(result.image);
    setImageMessage(result.message);
  }

  async function runFlash(dryRun: boolean) {
    if (!image?.localPath || !selectedDrive) return;
    setFlashing(true);
    setFlashResult(undefined);
    setFlashProgress({ phase: 'validate', message: '시작' });
    try {
      const result = await flashService.flashMrFusionImage(
        { image, targetDrive: selectedDrive, typedConfirmation: confirmation, dryRun },
        setFlashProgress,
      );
      setFlashResult(result);
      if (result.ok && !dryRun) {
        setRealFlashDone(true);
        taskQueue.enqueue({
          id: createTaskId('sd-flash'),
          title: 'Mr. Fusion 이미지 플래시',
          description: `${selectedDrive.driveLetter} (PhysicalDrive${selectedDrive.diskNumber}) 에 ${image.fileName} 기록`,
          category: 'sd',
          riskLevel: '위험',
          dryRun: false,
          status: '완료',
          logs: result.logs.map((log) => ({ at: new Date().toISOString(), message: log })),
        });
      }
    } finally {
      setFlashing(false);
    }
  }

  async function inspectStructure() {
    if (!selectedDrive) return;
    setInspecting(true);
    try {
      const result = await driveService.inspectStructure(selectedDrive);
      setStructureResult(result);
    } finally {
      setInspecting(false);
    }
  }

  // 단계로 넘어오면 자동으로 드라이브를 새로고침한다: 카드 선택(req 2), Wi‑Fi·영상 단계는 방금 구운 카드를 기본 선택(req 8/11).
  useEffect(() => {
    if (current.key === 'drive') void scanDrives('flash');
    if (current.key === 'wifi') void scanDrives('wifi');
    if (current.key === 'video') void scanDrives('video');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.key]);

  return (
    <>
      <PageHeader
        eyebrow="SD 카드 셋업"
        title="새 SD 카드 설치 마법사"
        description="새 microSD에 Mr. Fusion(범용 MiSTer 설치 이미지)을 구워 DE10-Nano·클론에서 바로 부팅할 수 있게 단계별로 진행합니다."
      />

      <nav className="wizard-stepper" aria-label="설치 단계">
        {steps.map((step, index) => {
          const state = index === stepIndex ? 'current' : index < stepIndex ? 'done' : 'todo';
          return (
            <button
              key={step.key}
              type="button"
              className={`wizard-step ${state}`}
              disabled={index > stepIndex}
              onClick={() => jumpTo(index)}
            >
              <span className="wizard-step-index">{state === 'done' ? <CheckCircle2 size={14} /> : index + 1}</span>
              <span className="wizard-step-title">{step.title}</span>
            </button>
          );
        })}
      </nav>

      {current.key === 'mode' && (
        <SectionCard title="무엇을 할까요?" tone="dry">
          <div className="mode-cards">
            <button type="button" className={`mode-card ${mode === 'new' ? 'active' : ''}`} onClick={() => setMode('new')}>
              <Rocket size={20} />
              <strong>새 SD 카드 만들기</strong>
              <small>빈/새 카드에 Mr. Fusion을 굽습니다. (카드 데이터 전체 삭제)</small>
            </button>
            <button type="button" className={`mode-card ${mode === 'inspect' ? 'active' : ''}`} onClick={() => setMode('inspect')}>
              <FileSearch size={20} />
              <strong>기존 SD 카드 점검</strong>
              <small>이미 MiSTer가 설치된 카드의 구조만 읽기 전용으로 확인합니다.</small>
            </button>
          </div>
        </SectionCard>
      )}

      {current.key === 'image' && (
        <SectionCard title="1. 설치 이미지 준비" tone="dry">
          <div className="info-box">
            <FileSearch size={16} />
            <div>
              <div><b>둘 다 같은 “범용 MiSTer 설치 이미지(Mr. Fusion)”</b>입니다. 카드에 구워 미스터에 넣고 켜면, 첫 부팅에 카드를 전체 용량으로 다시 나누고 기본 MiSTer를 설치합니다. DE10-Nano·클론 공통으로 동작합니다.</div>
              <div style={{ marginTop: 6 }}><b>Mr. Fusion (공식, MiSTer-devel)</b> — 기본 MiSTer(메뉴+펌웨어)만 설치합니다. 코어·롬셋은 아직 없으니, 설치가 끝나면 미스터 메뉴의 <code>Scripts → update_all</code>을 직접 한 번 실행해 코어를 받아야 합니다.</div>
              <div style={{ marginTop: 6 }}><b>Ms. Fusion (theypsilon 제작)</b> — Mr. Fusion과 똑같지만 <b>첫 부팅 설치 직후 update_all(다운로더)을 자동 실행</b>하도록 묶여 있습니다. 인터넷(유선랜 권장)만 연결돼 있으면 코어·업데이트까지 한 번에 받아 “켜자마자 바로 사용” 상태가 됩니다. 대신 첫 부팅이 그만큼 오래 걸리고 네트워크가 반드시 필요합니다.</div>
              <div style={{ marginTop: 6 }} className="muted">추천: 유선랜이 연결돼 있고 한 번에 끝내고 싶으면 <b>Ms. Fusion</b>, 직접 단계별로 관리하고 싶으면 <b>Mr. Fusion</b>.</div>
            </div>
          </div>
          <div className="field-group">
            <label className={`mode-card slim ${variant === 'mr-fusion' ? 'active' : ''}`}>
              <input type="radio" checked={variant === 'mr-fusion'} onChange={() => setVariant('mr-fusion')} />
              <span><strong>Mr. Fusion (공식)</strong><small>기본 MiSTer만 설치. 코어는 부팅 후 update_all로 직접 받기.</small></span>
            </label>
            <label className={`mode-card slim ${variant === 'ms-fusion' ? 'active' : ''}`}>
              <input type="radio" checked={variant === 'ms-fusion'} onChange={() => setVariant('ms-fusion')} />
              <span><strong>Ms. Fusion</strong><small>첫 부팅에 update_all 자동 실행 → 코어까지 한 번에. 네트워크 필수.</small></span>
            </label>
          </div>
          <div className="action-row">
            <button className="button primary" onClick={() => void startImageDownload()} disabled={downloading || resolving}>
              {downloading || resolving ? <Loader2 size={16} className="spin" /> : <Download size={16} />} 최신 이미지 다운로드 + 검증
            </button>
            <button className="button" onClick={() => void selectLocalImage()} disabled={downloading || resolving}>
              <FolderOpen size={16} /> 로컬 이미지 선택
            </button>
            {image && !downloading && !resolving && (
              <button className="button ghost" onClick={() => void runDownload(true)}>다시 받기</button>
            )}
          </div>

          {localCandidate && !image && (
            <div className="result-card">
              <div><strong>같은 버전이 이미 로컬에 있습니다</strong>{localCandidate.tag ? <span className="muted"> · {localCandidate.tag}</span> : null}</div>
              <small className="muted">{localCandidate.image.fileName}</small>
              <small className="muted">SHA-256 검증됨 · {localCandidate.image.checksum?.slice(0, 16)}…</small>
              <p className="muted">다시 받지 않고 이 로컬 이미지를 사용할까요?</p>
              <div className="action-row">
                <button className="button primary" onClick={() => { setImage(localCandidate.image); setLocalCandidate(undefined); }}>
                  <CheckCircle2 size={16} /> 로컬 이미지 사용
                </button>
                <button className="button" onClick={() => { setLocalCandidate(undefined); void runDownload(true); }}>
                  <Download size={16} /> 새로 받기
                </button>
              </div>
            </div>
          )}

          {(downloading || resolving) && downloadProgress && (
            <div className="progress-box">
              <div className="progress-bar"><span style={{ width: `${downloadProgress.percent ?? 5}%` }} /></div>
              <small className="muted">
                {DOWNLOAD_PHASE[downloadProgress.phase] || downloadProgress.phase}
                {typeof downloadProgress.percent === 'number' ? ` · ${downloadProgress.percent}%` : ''}
                {downloadProgress.totalBytes ? ` · ${formatBytes(downloadProgress.receivedBytes)} / ${formatBytes(downloadProgress.totalBytes)}` : ''}
              </small>
            </div>
          )}

          {image && (
            <div className="result-card ok">
              <div><strong>{image.fileName}</strong> {image.tag ? <span className="muted">· {image.tag}</span> : null}</div>
              <small className="muted">{image.localPath}</small>
              <small className="muted">{formatBytes(image.sizeBytes)}{image.checksum ? ` · SHA-256 ${image.checksum.slice(0, 16)}…` : ''}</small>
              <StatusBadge label={image.verified ? '검증됨' : image.source === 'local' ? '로컬 선택' : '확인 필요'} tone={image.verified ? 'safe' : 'warning'} />
            </div>
          )}
          {imageMessage && <pre className="log-box">{imageMessage}</pre>}
        </SectionCard>
      )}

      {current.key === 'drive' && (
        <SectionCard title="2. 구울 SD 카드 선택" tone="warning">
          <p className="muted">PC에 꽂힌 removable 카드만 보입니다. 시스템 디스크는 선택할 수 없습니다.</p>
          <button className="button" onClick={() => void scanDrives('flash')} disabled={scanningDrives}>
            {scanningDrives ? <Loader2 size={16} className="spin" /> : <HardDrive size={16} />} 드라이브 새로고침
          </button>
          {drives.map((drive) => {
            const selectable = isDriveSelectableForMrFusion(drive);
            return (
              <label key={drive.id} className={`drive-row ${!selectable ? 'disabled' : ''}`}>
                <input type="radio" checked={selectedDrive?.id === drive.id} disabled={!selectable} onChange={() => setSelectedDrive(drive)} />
                <span>
                  <strong>{drive.driveLetter || drive.mountPoint} · {drive.label}</strong>
                  <small>{formatDriveCapacity(drive)} · {drive.fileSystem} · Disk {drive.diskNumber ?? '?'} · {drive.busType ?? 'Unknown'}</small>
                  <small>{drive.selectionReason}</small>
                </span>
                <StatusBadge label={selectable ? '선택 가능' : '선택 불가'} tone={selectable ? 'safe' : 'warning'} />
              </label>
            );
          })}
          {drives.length === 0 && <div className="empty-state">카드를 꽂고 ‘드라이브 새로고침’을 누르세요.</div>}
          {selectedDrive && (
            <div className="erase-warning">
              <AlertTriangle size={18} />
              <div>
                <strong>{selectedDrive.driveLetter || selectedDrive.mountPoint}</strong> ({selectedDrive.volumeName || '이름 없음'}, {formatDriveCapacity(selectedDrive)}, {selectedDrive.fileSystem})
                <div>이 카드의 <b>모든 데이터가 삭제</b>됩니다. 사진·다른 카드가 아닌지 반드시 확인하세요.</div>
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {current.key === 'flash' && (
        <SectionCard title="3. SD 카드에 굽기" tone="danger">
          {!selectedDrive || !image ? (
            <div className="empty-state">이전 단계에서 이미지와 카드를 먼저 선택하세요.</div>
          ) : (
            <>
              <div className="result-card">
                <small>대상: <strong>{selectedDrive.driveLetter}</strong> · PhysicalDrive{selectedDrive.diskNumber} · {selectedDrive.busType} · {formatDriveCapacity(selectedDrive)}</small>
                <small>이미지: <strong>{image.fileName}</strong> · {formatBytes(image.sizeBytes)}</small>
              </div>

              <div className="danger-box">
                <ShieldAlert size={18} /> 굽기를 시작하면 <b>{selectedDrive.driveLetter} 카드의 데이터가 모두 삭제</b>됩니다. 관리자 권한(UAC) 동의가 필요합니다.
              </div>

              <label className="field">
                <span>확인을 위해 대상 드라이브 문자를 입력하세요 — 예: <b>{driveLetter}</b> (대소문자·콜론(:)은 구분하지 않습니다)</span>
                <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={driveLetter} />
                {confirmation && !confirmationMatches && <small className="muted">‘{driveLetter}’ 와 일치해야 굽기가 활성화됩니다.</small>}
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={enableRealFlash} onChange={(event) => setEnableRealFlash(event.target.checked)} />
                <span>실제로 이 카드에 굽기 (체크해야 실제 쓰기가 활성화됩니다)</span>
              </label>

              <div className="action-row">
                {realFlashDone ? (
                  <button className="button" disabled>
                    <CheckCircle2 size={16} /> 굽기 완료
                  </button>
                ) : (
                  <button
                    className="button danger"
                    onClick={() => void runFlash(false)}
                    disabled={flashing || !enableRealFlash || !confirmationMatches}
                  >
                    {flashing ? <Loader2 size={16} className="spin" /> : <Rocket size={16} />} 굽기 시작
                  </button>
                )}
              </div>

              {flashing && flashProgress && (
                <div className="progress-box">
                  <div className="progress-bar"><span style={{ width: `${flashProgress.percent ?? 5}%` }} /></div>
                  <small className="muted">
                    {FLASH_PHASE[flashProgress.phase] || flashProgress.phase}
                    {typeof flashProgress.percent === 'number' ? ` · ${flashProgress.percent}%` : ''}
                    {flashProgress.totalBytes ? ` · ${formatBytes(flashProgress.writtenBytes)} / ${formatBytes(flashProgress.totalBytes)}` : ''}
                  </small>
                </div>
              )}

              {flashResult && (
                <div className={`result-card ${flashResult.ok ? 'ok' : 'err'}`}>
                  <strong>{flashResult.ok ? '굽기 완료' : flashResult.cancelled ? '취소됨' : '실패'}</strong>
                  <small>{flashResult.message}</small>
                  {flashResult.logs.map((log, index) => <small key={index} className="muted">{log}</small>)}
                </div>
              )}

              {realFlashDone && (
                <div className="info-box">
                  <CheckCircle2 size={16} />
                  <span>굽기가 끝났습니다. 카드의 <b>MRFUSION</b> 드라이브가 나타나는 건 정상이며, 여기에 넣는 Wi‑Fi/스크립트는 <b>첫 부팅 때 미스터로 자동 복사</b>됩니다. 리눅스 파티션의 “포맷하시겠습니까?” 창이 뜨면 <b>절대 포맷하지 말고 취소</b>하세요. 이제 <b>다음</b>으로 진행하세요.</span>
                </div>
              )}
            </>
          )}
        </SectionCard>
      )}

      {current.key === 'wifi' && (
        <SectionCard title="5. Wi‑Fi · 스크립트 (선택)" tone="dry">
          <div className="info-box">
            <Monitor size={16} />
            <div>
              <div><b>CRT·15kHz 같은 아날로그 출력에 바로 연결하지 마세요.</b> 먼저 <b>LCD(HDMI)</b>에 연결해 한 번 부팅·설치를 끝내세요.</div>
              <div style={{ marginTop: 4 }}>그 다음 카드를 다시 PC에 꽂아 <b>영상 출력</b>을 설정합니다. 영상 설정은 이 마법사의 마지막 <b>‘영상 출력’ 단계</b>(부팅 후)에서 합니다.</div>
            </div>
          </div>
          <div className="info-box">
            <CheckCircle2 size={16} />
            <div>여기서 넣는 <b>Wi‑Fi·스크립트는 첫 부팅 설치 때 미스터로 자동 복사</b>됩니다(Mr. Fusion 공식 방식). 부팅 전 지금 넣어 두면 됩니다. (영상 출력만 예외 — 부팅 후 마지막 단계에서 설정)</div>
          </div>
          <button className="button" onClick={() => void scanDrives('wifi')} disabled={scanningDrives}>
            {scanningDrives ? <Loader2 size={16} className="spin" /> : <HardDrive size={16} />} 카드 드라이브 다시 찾기
          </button>
          {drives.length > 0 ? (
            <label className="field">
              <span>카드 드라이브 (방금 구운 카드 자동 선택)</span>
              <select value={wifiDrive?.id || ''} onChange={(event) => setWifiDrive(drives.find((d) => d.id === event.target.value))}>
                <option value="">선택…</option>
                {drives.map((drive) => (
                  <option key={drive.id} value={drive.id}>{drive.driveLetter || drive.mountPoint} · {drive.volumeName || drive.label} · {drive.fileSystem}</option>
                ))}
              </select>
            </label>
          ) : (
            <div className="empty-state">카드(MRFUSION)가 안 보이면 ‘카드 드라이브 다시 찾기’를 누르세요.</div>
          )}

          <WifiPanel drive={wifiDrive} />
          <CardScriptsPanel drive={wifiDrive} />
        </SectionCard>
      )}

      {current.key === 'boot' && (
        <SectionCard title="6. 미스터에 넣고 부팅" tone="dry">
          <ol className="ordered-list">
            <li>구운 SD 카드를 MiSTer(DE10-Nano 또는 클론)에 넣습니다.</li>
            <li><b>먼저 LCD(HDMI) 모니터에 연결</b>하고 전원을 켭니다. (CRT·15kHz 등은 아직 연결하지 마세요)</li>
            <li>Mr. Fusion이 자동으로 카드를 전체 용량으로 리사이즈하고 MiSTer를 설치합니다. (수 분, 자동 재부팅) {variant === 'ms-fusion' ? 'Ms. Fusion은 첫 부팅에 update_all로 코어까지 받습니다(네트워크 필요).' : '코어는 메뉴의 Scripts → update_all 로 받습니다.'}</li>
            <li>MiSTer 메뉴가 뜨면 설치 완료입니다.</li>
            <li><b>영상 설정을 하려면</b> 미스터 전원을 끄고 <b>SD 카드를 다시 PC에 꽂으세요.</b> 그런 다음 아래 버튼을 누릅니다.</li>
          </ol>
          <div className="erase-warning">
            <AlertTriangle size={18} />
            <div>
              <b>첫 부팅 설치 중에는 절대 전원을 끄지 마세요.</b> 파티션을 다시 만들고 시스템을 설치하는 도중 전원이 끊기면
              카드가 손상되어 처음부터 다시 구워야 합니다. <b>MiSTer 메뉴가 뜰 때까지(수 분) 기다리세요.</b>
            </div>
          </div>
          <div className="info-box">
            <AlertTriangle size={16} />
            <div>
              <div><b>화면이 검정색이에요 — 정상인가요?</b></div>
              <div style={{ marginTop: 4 }}><b>설치 중</b>이면 검정/깜빡임이 수 분 이어지다 자동 재부팅 후 메뉴가 뜹니다(보드 활동 LED 깜빡임). 그냥 기다리세요. 메뉴가 떠야 할 때도 계속 “신호 없음”이면 영상 싱크 문제이니, 다음 <b>영상 출력</b> 단계에서 화면에 맞는 설정을 저장하세요.</div>
            </div>
          </div>
          <div className="info-box">
            <AlertTriangle size={16} />
            <span>클론(QMTech 등): SD 슬롯 위치와 부팅 점퍼/SDRAM 장착이 보드마다 다릅니다. SD 이미지는 DE10-Nano와 동일합니다. 카드를 PC에 다시 꽂을 때 Windows가 “포맷하시겠습니까?” 창을 띄우면 <b>절대 포맷하지 말고 취소</b>하세요(리눅스 파티션이라 정상).</span>
          </div>
          <div className="action-row">
            <button className="button primary" onClick={goNext}>
              부팅하고 SD 카드를 PC에 연결했습니다 <ArrowRight size={16} />
            </button>
          </div>
        </SectionCard>
      )}

      {current.key === 'video' && (
        <SectionCard title="7. 영상 출력 설정" tone="dry">
          <div className="info-box">
            <Monitor size={16} />
            <div>
              <div><b>부팅·설치가 끝난 카드</b>에 화면 종류(HDMI·CRT·15kHz 등)에 맞는 <code>MiSTer.ini</code>를 저장합니다. 이제 저장한 설정은 유지됩니다.</div>
              <div style={{ marginTop: 4 }}>HDMI(LCD)만 쓴다면 이 단계는 건너뛰어도 됩니다.</div>
            </div>
          </div>
          <button className="button" onClick={() => void scanDrives('video')} disabled={scanningDrives}>
            {scanningDrives ? <Loader2 size={16} className="spin" /> : <HardDrive size={16} />} 카드 드라이브 다시 찾기
          </button>
          {drives.length > 0 ? (
            <label className="field">
              <span>카드 드라이브</span>
              <select value={wifiDrive?.id || ''} onChange={(event) => setWifiDrive(drives.find((d) => d.id === event.target.value))}>
                <option value="">선택…</option>
                {drives.map((drive) => (
                  <option key={drive.id} value={drive.id}>{drive.driveLetter || drive.mountPoint} · {drive.volumeName || drive.label} · {drive.fileSystem}</option>
                ))}
              </select>
            </label>
          ) : (
            <div className="empty-state">부팅을 끝낸 카드를 PC에 꽂고 ‘카드 드라이브 다시 찾기’를 누르세요.</div>
          )}

          <VideoIniPanel drive={wifiDrive} />

          <div className="erase-warning">
            <AlertTriangle size={18} />
            <div>
              <div>영상 출력을 저장했다면 <b>카드를 미스터에 다시 넣고</b>, 설정한 출력 장비(예: <b>CRT·15kHz PVM/방송용 모니터</b>)에 연결해 부팅하세요.</div>
              <div style={{ marginTop: 4 }}>화면이 정상적으로 나오면, 이제 미스터를 <b>Hello Mister 앱</b>에 연결하세요. 아래 버튼으로 자동 검색을 시작할 수 있습니다.</div>
            </div>
          </div>
          <div className="action-row">
            <button className="button primary" onClick={() => navigate('/mister')}><Radar size={16} /> 미스터를 Hello Mister에 연결 (자동 검색)</button>
          </div>
        </SectionCard>
      )}

      {current.key === 'inspect' && (
        <SectionCard title="기존 SD 카드 점검 (읽기 전용)" tone="dry">
          <button className="button" onClick={() => void scanDrives('flash')} disabled={scanningDrives}>
            {scanningDrives ? <Loader2 size={16} className="spin" /> : <HardDrive size={16} />} 드라이브 새로고침
          </button>
          {drives.map((drive) => (
            <label key={drive.id} className="drive-row">
              <input type="radio" checked={selectedDrive?.id === drive.id} onChange={() => setSelectedDrive(drive)} />
              <span>
                <strong>{drive.driveLetter || drive.mountPoint} · {drive.label}</strong>
                <small>{formatDriveCapacity(drive)} · {drive.fileSystem} · Disk {drive.diskNumber ?? '?'}</small>
              </span>
            </label>
          ))}
          {drives.length === 0 && <div className="empty-state">카드를 꽂고 ‘드라이브 새로고침’을 누르세요.</div>}
          <div className="action-row">
            <button className="button" onClick={() => void inspectStructure()} disabled={!selectedDrive || inspecting}>
              {inspecting ? <Loader2 size={16} className="spin" /> : <FileSearch size={16} />} MiSTer 구조 검사
            </button>
          </div>
          {structureResult && (
            <div className="mini-list">
              <strong>{formatSdStructureSummary(structureResult)}</strong>
              {structureResult.items.map((item) => (
                <div key={item.key}>
                  <span>{item.label}</span>
                  <span>{item.path}</span>
                  <StatusBadge label={item.exists ? '있음' : '없음'} tone={item.exists ? 'safe' : 'warning'} />
                </div>
              ))}
            </div>
          )}
          {selectedDrive && (
            <>
              <div className="info-box">
                <Monitor size={16} />
                <span>
                  <code>MiSTer.ini</code>가 <b>없음</b>이면 MiSTer는 기본(HDMI) 설정으로 동작합니다. 화면이 안 나오거나 싱크가 안 맞으면
                  아래에서 화면 종류에 맞는 영상 출력을 골라 이 카드에 <code>MiSTer.ini</code>를 만들면 됩니다.
                </span>
              </div>
              <VideoIniPanel drive={selectedDrive} />
              <WifiPanel drive={selectedDrive} />
              <CardScriptsPanel drive={selectedDrive} />
            </>
          )}
        </SectionCard>
      )}

      <div className="wizard-nav">
        <button className="button ghost" onClick={goBack} disabled={stepIndex === 0}><ArrowLeft size={16} /> 이전</button>
        {stepIndex < steps.length - 1 ? (
          <button className="button primary" onClick={goNext} disabled={!canAdvance(current.key)}>다음 <ArrowRight size={16} /></button>
        ) : (
          <span className="muted">마지막 단계입니다.</span>
        )}
      </div>
    </>
  );
}

function VideoIniPanel({ drive }: { drive?: SdCardDrive }) {
  const [presetId, setPresetId] = useState(sdVideoPresets[0].id);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const preset = sdVideoPresets.find((p) => p.id === presetId) || sdVideoPresets[0];

  async function save() {
    const api = window.helloMisterDesktop;
    if (!api?.writeMisterIni) {
      setMessage('MiSTer.ini 저장은 데스크톱 앱에서만 가능합니다.');
      return;
    }
    if (!drive) {
      setMessage('먼저 카드 드라이브를 선택하세요.');
      return;
    }
    setBusy(true);
    try {
      const result = await api.writeMisterIni({ mountPoint: drive.mountPoint, content: buildMisterIni(preset) });
      setMessage(result.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="video-ini-panel">
      <h3 className="subhead">영상 출력</h3>
      <div className="mode-cards-col">
        {sdVideoPresets.map((p, index) => (
          <Fragment key={p.id}>
            {(index === 0 || sdVideoPresets[index - 1].group !== p.group) && (
              <div className="preset-group-label">{p.group}</div>
            )}
            <label className={`mode-card slim ${presetId === p.id ? 'active' : ''}`}>
              <input type="radio" checked={presetId === p.id} onChange={() => setPresetId(p.id)} />
              <span>
                <strong>{p.name}</strong>
                <small>{p.summary}</small>
                {p.warning && <small className="warn-text">{p.warning}</small>}
              </span>
            </label>
          </Fragment>
        ))}
      </div>
      <details className="ini-preview">
        <summary>생성될 MiSTer.ini 미리보기</summary>
        <pre className="log-box">{buildMisterIni(preset)}</pre>
      </details>
      <div className="erase-warning">
        <AlertTriangle size={16} />
        <div>
          <b>한 번 부팅·설치한 카드</b>에 저장하세요. 갓 구운(부팅 전) 카드에 저장하면 첫 부팅 설치 때 <code>MiSTer.ini</code>가 지워집니다.
          저장이 유지되려면 미스터에서 한 번 부팅해 설치를 끝낸 뒤, 카드를 다시 꽂아 저장해야 합니다.
        </div>
      </div>
      <div className="action-row">
        <button className="button primary" onClick={() => void save()} disabled={!drive || busy}>
          {busy ? <Loader2 size={16} className="spin" /> : <Monitor size={16} />} 이 카드에 MiSTer.ini 저장
        </button>
      </div>
      {message && <p className="muted">{message}</p>}
    </div>
  );
}

// 카드 루트에 wpa_supplicant.conf 를 써서 무선을 미리 설정한다. 오타 방지용 주변 SSID 검색 포함. 자체 상태.
function WifiPanel({ drive }: { drive?: SdCardDrive }) {
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [networks, setNetworks] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState('');

  async function scan() {
    const api = window.helloMisterDesktop;
    if (!api?.scanWifiNetworks) { setMessage('Wi‑Fi 검색은 데스크톱 앱에서만 가능합니다.'); return; }
    setScanning(true);
    try {
      const result = await api.scanWifiNetworks();
      setNetworks(result.networks);
      setMessage(result.message);
    } finally {
      setScanning(false);
    }
  }

  async function save() {
    const api = window.helloMisterDesktop;
    if (!api?.writeWpaSupplicant) { setMessage('Wi‑Fi 설정 저장은 데스크톱 앱에서만 가능합니다.'); return; }
    if (!drive || !ssid.trim()) { setMessage('카드 드라이브와 SSID를 확인하세요.'); return; }
    const result = await api.writeWpaSupplicant({ mountPoint: drive.mountPoint, ssid: ssid.trim(), password, countryCode: 'KR' });
    setMessage(result.message);
  }

  return (
    <div className="video-ini-panel">
      <h3 className="subhead">Wi‑Fi (선택)</h3>
      <p className="muted">무선만 쓴다면 카드에 <code>wpa_supplicant.conf</code>를 넣습니다. 갓 구운 카드는 <b>첫 부팅 때 미스터로 자동 복사</b>되어 적용됩니다(지워지지 않습니다). 오타를 막으려면 <b>주변 Wi‑Fi 검색</b>으로 골라 넣으세요.</p>
      <div className="action-row">
        <button className="button" onClick={() => void scan()} disabled={scanning}>
          {scanning ? <Loader2 size={16} className="spin" /> : <Wifi size={16} />} 주변 Wi‑Fi 검색
        </button>
      </div>
      {networks.length > 0 && (
        <label className="field">
          <span>검색된 Wi‑Fi에서 선택</span>
          <select value={networks.includes(ssid) ? ssid : ''} onChange={(event) => setSsid(event.target.value)}>
            <option value="">직접 입력…</option>
            {networks.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      )}
      <div className="field-group">
        <label className="field"><span>Wi‑Fi 이름(SSID)</span><input value={ssid} onChange={(event) => setSsid(event.target.value)} placeholder="검색해서 고르거나 직접 입력" /></label>
        <label className="field"><span>비밀번호</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="비워두면 개방 네트워크" /></label>
      </div>
      <p className="muted">국가코드는 <b>KR</b>로 저장됩니다.</p>
      <div className="action-row">
        <button className="button primary" onClick={() => void save()} disabled={!drive || !ssid.trim()}><Wifi size={16} /> 카드에 Wi‑Fi 설정 저장</button>
      </div>
      {message && <p className="muted">{message}</p>}
    </div>
  );
}

// 카드의 Scripts 폴더에 유용한 미스터 스크립트를 넣는다: Zaparoo(NFC 카드 실행) 설치 스크립트 + 추천 스크립트.
// 미스터에서 Scripts 메뉴로 실행하면 된다.
function CardScriptsPanel({ drive }: { drive?: SdCardDrive }) {
  const [busy, setBusy] = useState<string | undefined>();
  const [message, setMessage] = useState('');
  const [zapProgress, setZapProgress] = useState<{ phase: string; message: string; percent?: number } | undefined>();

  // 기본 추천 스크립트(Update All + Zaparoo)를 한 번에 카드에 넣는다. 첫 부팅 때 미스터로 자동 복사된다.
  async function installDefaults() {
    const api = window.helloMisterDesktop;
    if (!api?.installMisterScriptToCard || !api?.installZaparooToCard) { setMessage('데스크톱 앱에서만 가능합니다.'); return; }
    if (!drive) { setMessage('먼저 카드 드라이브를 선택하세요.'); return; }
    setBusy('defaults');
    setMessage('');
    let unsubscribe: (() => void) | undefined;
    if (api.onSdScriptProgress) unsubscribe = api.onSdScriptProgress((payload) => { if (payload.task === 'zaparoo') setZapProgress(payload); });
    try {
      const messages: string[] = [];
      const updateAll = recommendedScripts.find((s) => s.fileName === 'update_all.sh');
      if (updateAll) {
        const r1 = await api.installMisterScriptToCard({ mountPoint: drive.mountPoint, fileName: updateAll.fileName, url: updateAll.url });
        messages.push(`update_all: ${r1.message}`);
      }
      setZapProgress({ phase: 'resolve', message: 'Zaparoo 준비' });
      const r2 = await api.installZaparooToCard({ mountPoint: drive.mountPoint });
      messages.push(`Zaparoo: ${r2.message}`);
      setMessage(messages.join('\n'));
    } finally {
      unsubscribe?.();
      setBusy(undefined);
    }
  }

  async function installZaparoo() {
    const api = window.helloMisterDesktop;
    if (!api?.installZaparooToCard) { setMessage('데스크톱 앱에서만 가능합니다.'); return; }
    if (!drive) { setMessage('먼저 카드 드라이브를 선택하세요.'); return; }
    setBusy('zaparoo');
    setZapProgress({ phase: 'resolve', message: '시작' });
    let unsubscribe: (() => void) | undefined;
    if (api.onSdScriptProgress) unsubscribe = api.onSdScriptProgress((payload) => { if (payload.task === 'zaparoo') setZapProgress(payload); });
    try {
      const result = await api.installZaparooToCard({ mountPoint: drive.mountPoint });
      setMessage(result.message);
    } finally {
      unsubscribe?.();
      setBusy(undefined);
    }
  }

  async function installScript(fileName: string, url: string) {
    const api = window.helloMisterDesktop;
    if (!api?.installMisterScriptToCard) { setMessage('데스크톱 앱에서만 가능합니다.'); return; }
    if (!drive) { setMessage('먼저 카드 드라이브를 선택하세요.'); return; }
    setBusy(fileName);
    try {
      const result = await api.installMisterScriptToCard({ mountPoint: drive.mountPoint, fileName, url });
      setMessage(result.message);
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="video-ini-panel">
      <h3 className="subhead">카드에 스크립트 넣기 (Scripts 폴더)</h3>
      <p className="muted">받은 스크립트는 카드의 <code>Scripts</code> 폴더에 들어가고, <b>첫 부팅 때 미스터로 자동 복사</b>됩니다. 부팅 후 미스터의 <b>Scripts</b> 메뉴에서 실행하세요.</p>

      <div className="result-card ok">
        <div><strong>기본 스크립트 넣기 (권장) — Update All + Zaparoo</strong></div>
        <small className="muted"><b>Update All</b>(코어·업데이트 관리)과 <b>Zaparoo</b>(NFC 카드로 게임 실행)를 한 번에 카드에 넣습니다. 이 앱의 NFC 기능을 쓰려면 Zaparoo가 필요합니다.</small>
        <div className="action-row">
          <button className="button primary" onClick={() => void installDefaults()} disabled={!drive || Boolean(busy)}>
            {busy === 'defaults' ? <Loader2 size={16} className="spin" /> : <Rocket size={16} />} Update All + Zaparoo 넣기
          </button>
        </div>
        {busy === 'defaults' && zapProgress && (
          <div className="progress-box">
            <div className="progress-bar"><span style={{ width: `${zapProgress.percent ?? 5}%` }} /></div>
            <small className="muted">{zapProgress.message}</small>
          </div>
        )}
      </div>

      <div className="result-card">
        <div><strong>Zaparoo (TapTo) — NFC 카드로 게임 실행</strong></div>
        <small className="muted">이 앱의 NFC 실행을 쓰려면 미스터에 Zaparoo Core가 있어야 합니다. 설치 스크립트를 카드에 넣습니다(약 20MB). 미스터에서 <code>zaparoo</code>를 한 번 실행하면 설치·시작 서비스 설정이 끝납니다.</small>
        <div className="action-row">
          <button className="button primary" onClick={() => void installZaparoo()} disabled={!drive || Boolean(busy)}>
            {busy === 'zaparoo' ? <Loader2 size={16} className="spin" /> : <Rocket size={16} />} Zaparoo 설치 스크립트 넣기
          </button>
        </div>
        {busy === 'zaparoo' && zapProgress && (
          <div className="progress-box">
            <div className="progress-bar"><span style={{ width: `${zapProgress.percent ?? 5}%` }} /></div>
            <small className="muted">{zapProgress.message}</small>
          </div>
        )}
      </div>

      <div className="mode-cards-col">
        <div className="preset-group-label">기타 추천 스크립트</div>
        {recommendedScripts.map((script) => (
          <label key={script.fileName} className="mode-card slim">
            <span>
              <strong>{script.title} <small className="muted">({script.fileName})</small></strong>
              <small>{script.description}</small>
              <small className="muted">출처: {script.source}</small>
            </span>
            <button className="button" onClick={() => void installScript(script.fileName, script.url)} disabled={!drive || Boolean(busy)}>
              {busy === script.fileName ? <Loader2 size={16} className="spin" /> : <Download size={16} />} 넣기
            </button>
          </label>
        ))}
      </div>
      <p className="muted">
        스크립트는 카드의 <code>Scripts</code> 폴더에 저장되고, <b>첫 부팅 설치 때 미스터로 자동 복사</b>됩니다(Mr. Fusion 공식 방식). 부팅 후 미스터의 <b>Scripts</b> 메뉴에서 실행하세요.
      </p>
      {message && <p className="muted">{message}</p>}
    </div>
  );
}
