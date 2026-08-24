import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileText, Play, RefreshCw, RotateCcw, Save, Trash2, Upload } from 'lucide-react';
import { PageHeader } from '../components/cards/PageHeader';
import { SectionCard } from '../components/cards/SectionCard';
import { StatusBadge } from '../components/status/StatusBadge';
import { ActiveMisterBanner } from '../components/mister/ActiveMisterBanner';
import { useActiveMisterProfile } from '../services/mister/activeProfile';
import { misterDisplayName } from '../services/mister/misterName';
import { SafeMisterProfileStore } from '../services/mister/profileStore';
import { ScriptDesktopService } from '../services/script/scriptDesktopService';
import { isLikelyLongScript, lookupScriptCatalog, recommendedScripts, scriptHeaderComment } from '../data/misterScriptCatalog';
import type { MisterDeviceProfile } from '../types/mister';
import type { ScriptFsBackupEntry, ScriptFsCapabilityResult, ScriptFsFile, ScriptFsTrashEntry, ScriptRunMode } from '../types/script';

const scriptTargetProfileKey = 'hello-mister-v2:script-target-profile';

interface ScriptDeviceStatus {
  reachable: boolean;
  connected: boolean;
}

function isBackupOnly(file: ScriptFsFile) {
  return Boolean(file.listId?.startsWith('backup-only:'));
}

function capabilityLabel(capability?: ScriptFsCapabilityResult) {
  if (!capability || capability.state === 'disconnected') return 'MiSTer 연결 필요';
  if (capability.state === 'connectedWritable') return '편집/실행 가능';
  if (capability.state === 'connectedReadOnly') return '읽기만 가능';
  return '권한 확인 실패';
}

function capabilityTone(capability?: ScriptFsCapabilityResult): 'safe' | 'warning' | 'neutral' {
  if (!capability || capability.state === 'disconnected') return 'warning';
  if (capability.state === 'connectedWritable') return 'safe';
  return 'warning';
}

function formatBytes(bytes?: number) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : '확인 전';
}

export function ScriptManagementPage() {
  const [defaultActive] = useActiveMisterProfile();
  const profileStore = useMemo(() => new SafeMisterProfileStore(), []);
  const [savedProfiles, setSavedProfiles] = useState<MisterDeviceProfile[]>([]);
  const [selectedTargetProfileId, setSelectedTargetProfileId] = useState<string | undefined>(() => {
    try { return window.localStorage.getItem(scriptTargetProfileKey) ?? undefined; } catch { return undefined; }
  });
  const [deviceStatus, setDeviceStatus] = useState<Record<string, ScriptDeviceStatus>>({});

  const [files, setFiles] = useState<ScriptFsFile[]>([]);
  const [selectedFileName, setSelectedFileName] = useState<string>();
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [binary, setBinary] = useState(false);
  const [backups, setBackups] = useState<ScriptFsBackupEntry[]>([]);
  const [trashEntries, setTrashEntries] = useState<ScriptFsTrashEntry[]>([]);
  const [capability, setCapability] = useState<ScriptFsCapabilityResult>();
  const [message, setMessage] = useState('연결된 MiSTer의 /media/fat/Scripts .sh 파일을 보고 편집·실행합니다.');
  const [loading, setLoading] = useState(false);
  const [runOutput, setRunOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [runModePrompt, setRunModePrompt] = useState(false);
  const [bgLogPath, setBgLogPath] = useState<string>();
  const [transferPrompt, setTransferPrompt] = useState(false);
  const [showRecommended, setShowRecommended] = useState(false);

  const activeRunIdRef = useRef<string | undefined>();
  const outputRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    void profileStore.loadProfiles().then(setSavedProfiles).catch(() => undefined);
  }, [profileStore, defaultActive?.profileId]);

  useEffect(() => {
    const api = window.helloMisterDesktop;
    if (!api?.probeMisterReachable || savedProfiles.length === 0) { setDeviceStatus({}); return; }
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
      if (!cancelled) setDeviceStatus(Object.fromEntries(results));
    };
    void check();
    const interval = window.setInterval(() => void check(), 10000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [savedProfiles]);

  const targetProfile = useMemo(
    () => savedProfiles.find((profile) => profile.id === selectedTargetProfileId)
      ?? savedProfiles.find((profile) => profile.id === defaultActive?.profileId)
      ?? savedProfiles[0],
    [savedProfiles, selectedTargetProfileId, defaultActive?.profileId],
  );
  const profileId = targetProfile?.id ?? defaultActive?.profileId;
  const misterLabel = targetProfile
    ? `${(targetProfile.hostname && targetProfile.hostname !== 'MiSTer') ? targetProfile.hostname : (targetProfile.alias?.trim() || 'MiSTer')} @ ${targetProfile.ipAddress}`
    : defaultActive ? `${(defaultActive.hostname && defaultActive.hostname !== 'MiSTer') ? defaultActive.hostname : (defaultActive.alias || 'MiSTer')} @ ${defaultActive.ipAddress}` : '';

  const deviceStatusLabel = useCallback((profile: MisterDeviceProfile) => {
    const status = deviceStatus[profile.id];
    if (status?.connected) return '● 연결됨';
    if (status?.reachable) return '○ 켜짐';
    return '· 오프라인';
  }, [deviceStatus]);

  const canWrite = capability?.state === 'connectedWritable';
  const dirty = content !== originalContent;
  const selectedFile = files.find((file) => file.fileName === selectedFileName);
  const isMissingOriginal = selectedFile ? isBackupOnly(selectedFile) : false;
  const catalogEntry = selectedFileName ? lookupScriptCatalog(selectedFileName) : undefined;
  const headerComment = !binary ? scriptHeaderComment(content) : '';
  const scriptDescription = catalogEntry?.description ?? '';
  const likelyLong = selectedFileName ? isLikelyLongScript(selectedFileName, catalogEntry) : false;

  const refreshCapability = useCallback(async () => {
    if (!profileId) { setCapability(undefined); return; }
    setCapability(await ScriptDesktopService.checkCapability(profileId));
  }, [profileId]);

  const refreshList = useCallback(async () => {
    if (!profileId) { setFiles([]); setTrashEntries([]); return; }
    setLoading(true);
    try {
      const [list, trash] = await Promise.all([ScriptDesktopService.listRemote(profileId), ScriptDesktopService.listTrash(profileId)]);
      setFiles(list.files);
      setTrashEntries(trash.ok ? trash.entries : []);
      setMessage(list.message);
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => { void refreshCapability(); }, [refreshCapability]);
  useEffect(() => { if (profileId) void refreshList(); }, [profileId, refreshList]);

  const openScript = useCallback(async (fileName: string) => {
    if (!profileId) return;
    setSelectedFileName(fileName);
    // A run from a previous script must not leak its "running" panel onto this one.
    activeRunIdRef.current = undefined;
    setRunning(false);
    setRunOutput('');
    setBgLogPath(undefined);
    const [read, backupList] = await Promise.all([
      ScriptDesktopService.readRemote(profileId, fileName),
      ScriptDesktopService.listBackups(profileId, fileName),
    ]);
    setBackups(backupList.backups);
    setBinary(Boolean(read.binary));
    if (read.ok) {
      setContent(read.content);
      setOriginalContent(read.content);
      setMessage(read.message);
    } else {
      setContent('');
      setOriginalContent('');
      setMessage(backupList.backups.length > 0
        ? `${read.message} 백업 ${backupList.backups.length}개에서 ‘복원’으로 원본을 되살릴 수 있습니다.`
        : read.message);
    }
  }, [profileId]);

  // Live run output subscription.
  useEffect(() => {
    const offChunk = ScriptDesktopService.onRunChunk((payload) => {
      if (payload.runId !== activeRunIdRef.current) return;
      setRunOutput((current) => (current + payload.text).slice(-200000));
    });
    const offDone = ScriptDesktopService.onRunDone((payload) => {
      if (payload.runId !== activeRunIdRef.current) return;
      setRunOutput((current) => `${current}\n[종료 코드 ${payload.exitCode ?? '?'}]`);
      setRunning(false);
    });
    return () => { offChunk(); offDone(); };
  }, []);

  useEffect(() => { if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight; }, [runOutput]);

  function selectTargetProfile(nextProfileId: string) {
    setSelectedTargetProfileId(nextProfileId);
    try { window.localStorage.setItem(scriptTargetProfileKey, nextProfileId); } catch { /* ignore */ }
    setSelectedFileName(undefined);
    setContent('');
    setOriginalContent('');
    setBackups([]);
    setRunOutput('');
    setBinary(false);
    setBgLogPath(undefined);
    activeRunIdRef.current = undefined;
    setRunning(false);
  }

  async function saveScript() {
    if (!profileId || !selectedFileName) return;
    if (!canWrite) { setMessage('스크립트 쓰기 권한을 확인하지 못했습니다.'); return; }
    if (!window.confirm(`${selectedFileName}를 저장합니다. 자동 백업은 만들지 않습니다(필요하면 먼저 ‘백업 만들기’).`)) return;
    const result = await ScriptDesktopService.writeRemote(profileId, selectedFileName, content);
    setMessage(result.message);
    if (result.ok) {
      setOriginalContent(content);
      setBackups(result.backups ?? backups);
      await refreshList();
    }
  }

  async function createBackup() {
    if (!profileId || !selectedFileName) return;
    if (!canWrite) { setMessage('스크립트 쓰기 권한을 확인하지 못했습니다.'); return; }
    const result = await ScriptDesktopService.createBackup(profileId, selectedFileName);
    setMessage(result.message);
    if (result.ok) { setBackups(result.backups); await refreshList(); }
  }

  async function restoreBackup(backup: ScriptFsBackupEntry) {
    if (!profileId || !selectedFileName) return;
    if (!canWrite) { setMessage('복원 권한을 확인하지 못했습니다.'); return; }
    const confirmed = isMissingOriginal
      ? window.confirm(`원본 스크립트가 없어 이 백업으로 ${selectedFileName} 원본을 새로 만듭니다.\n\n선택한 백업: ${backup.fileName}`)
      : window.confirm(`${selectedFileName}를 이 백업 내용으로 덮어씁니다. 적용 전 현재 파일을 다시 백업합니다.\n\n선택한 백업: ${backup.fileName}`);
    if (!confirmed) return;
    const result = await ScriptDesktopService.restoreBackup(profileId, selectedFileName, backup.path);
    setMessage(result.message);
    if (result.ok) { await refreshList(); await openScript(selectedFileName); }
  }

  async function deleteBackup(backup: ScriptFsBackupEntry) {
    if (!profileId || !selectedFileName) return;
    if (!window.confirm(`${backup.fileName} 백업을 휴지통으로 이동합니다(복원 가능).`)) return;
    const result = await ScriptDesktopService.deleteBackup(profileId, selectedFileName, backup.path);
    setMessage(result.message);
    if (result.ok) { setBackups(result.backups ?? backups.filter((item) => item.path !== backup.path)); await refreshList(); }
  }

  async function trashScript() {
    if (!profileId || !selectedFileName) return;
    if (!canWrite) { setMessage('스크립트 쓰기 권한을 확인하지 못했습니다.'); return; }
    if (!window.confirm(`${selectedFileName}를 휴지통으로 이동합니다. 영구 삭제가 아니라 복원할 수 있습니다.`)) return;
    const result = await ScriptDesktopService.trash(profileId, selectedFileName);
    setMessage(result.message);
    if (result.ok) { setSelectedFileName(undefined); setContent(''); setOriginalContent(''); await refreshList(); }
  }

  async function restoreTrash(entry: ScriptFsTrashEntry) {
    if (!profileId) return;
    const confirmed = entry.kind === 'backup'
      ? window.confirm(`${entry.originalFileName} 백업을 복원합니다. 원본이 있으면 백업 목록으로, 없으면 원본 스크립트로 되돌립니다.`)
      : window.confirm(`${entry.originalFileName}를 휴지통에서 복구합니다. 같은 이름의 현재 파일이 있으면 먼저 백업합니다.`);
    if (!confirmed) return;
    const result = await ScriptDesktopService.restoreTrashed(profileId, entry.path, entry.originalFileName);
    setMessage(result.message);
    if (result.ok) await refreshList();
  }

  async function deleteTrash(entry: ScriptFsTrashEntry) {
    if (!profileId) return;
    if (!window.confirm(`${entry.originalFileName} 휴지통 항목을 영구 삭제합니다. 되돌릴 수 없습니다.`)) return;
    const result = await ScriptDesktopService.deleteTrashed(profileId, entry.path);
    setMessage(result.message);
    if (result.ok) setTrashEntries((current) => current.filter((item) => item.path !== entry.path));
  }

  async function emptyTrash() {
    if (!profileId || trashEntries.length === 0) return;
    if (!window.confirm(`휴지통의 ${trashEntries.length}개 항목을 모두 영구 삭제합니다. 되돌릴 수 없습니다.`)) return;
    const result = await ScriptDesktopService.emptyTrash(profileId);
    setMessage(result.message);
    if (result.ok) await refreshList();
  }

  async function exportScript() {
    if (!profileId || !selectedFileName) return;
    const result = await ScriptDesktopService.exportLocal(profileId, selectedFileName);
    setMessage(result.message);
  }

  async function importScript() {
    if (!profileId) return;
    if (!canWrite) { setMessage('스크립트 쓰기 권한을 확인하지 못했습니다.'); return; }
    const result = await ScriptDesktopService.importLocal(profileId);
    setMessage(result.message);
    if (result.ok) { await refreshList(); if (result.fileName) await openScript(result.fileName); }
  }

  function runScript() {
    if (!profileId || !selectedFileName) return;
    if (dirty && !window.confirm('저장하지 않은 변경이 있습니다. 저장된 파일 기준으로 실행합니다. 계속할까요?')) return;
    // Long jobs (update_all 등): ask whether to keep it tied to this app or detach so it survives disconnects.
    if (likelyLong) { setRunModePrompt(true); return; }
    void runWithMode('foreground');
  }

  async function runWithMode(mode: ScriptRunMode) {
    setRunModePrompt(false);
    if (!profileId || !selectedFileName) return;
    if (!window.confirm(`${selectedFileName}를 ${misterLabel}에서 ${mode === 'background' ? '백그라운드로' : '실행'}합니다. 스크립트가 그대로 실행되니 내용을 확인했는지 확인하세요.`)) return;
    const runId = `run-${selectedFileName}-${performance.now().toString(36)}`;
    activeRunIdRef.current = runId;
    setRunOutput('');
    setBgLogPath(undefined);
    setRunning(true);
    const result = await ScriptDesktopService.run(profileId, selectedFileName, runId, mode);
    setMessage(result.message);
    if (mode === 'background') {
      setRunning(false);
      if (result.ok && result.logPath) {
        setBgLogPath(result.logPath);
        setRunOutput(`${result.message}\n로그: ${result.logPath}\n\n‘로그 새로고침’으로 진행 상황을 확인하세요.`);
      } else {
        setRunOutput(result.message);
      }
    } else if (!result.ok && result.errorCode) {
      setRunning(false);
    }
  }

  async function refreshBgLog() {
    if (!profileId || !bgLogPath) return;
    const result = await ScriptDesktopService.readRunLog(profileId, bgLogPath);
    setRunOutput(result.content ? result.content : result.message);
  }

  async function transferTo(targetProfileId: string) {
    setTransferPrompt(false);
    if (!profileId || !selectedFileName) return;
    const target = savedProfiles.find((profile) => profile.id === targetProfileId);
    if (!window.confirm(`${selectedFileName}를 ${misterDisplayName(target)}의 Scripts 폴더로 전송합니다. 같은 이름이 있으면 덮어씁니다.`)) return;
    const result = await ScriptDesktopService.copyToDevice(profileId, targetProfileId, selectedFileName);
    setMessage(result.message);
  }

  async function installRecommended(rec: typeof recommendedScripts[number]) {
    if (!profileId) { setMessage('먼저 대상 MiSTer를 선택하세요.'); return; }
    if (!canWrite) { setMessage('스크립트 쓰기 권한을 확인하지 못했습니다.'); return; }
    if (!window.confirm(`${rec.fileName}를 GitHub(${rec.source})에서 내려받아 ${misterLabel}의 Scripts 폴더에 설치합니다. 같은 이름이 있으면 덮어씁니다.`)) return;
    setMessage(`${rec.fileName} 내려받는 중...`);
    const result = await ScriptDesktopService.installFromUrl(profileId, rec.fileName, rec.url);
    setMessage(result.message);
    if (result.ok) { await refreshList(); await openScript(rec.fileName); }
  }

  if (!targetProfile && !defaultActive) {
    return (
      <>
        <PageHeader eyebrow="스크립트 관리" title="MiSTer 스크립트 관리" description="/media/fat/Scripts의 .sh 파일을 보고 편집·실행·백업합니다." />
        <SectionCard title="MiSTer 연결이 필요합니다" tone="warning">
          <p className="muted">먼저 MiSTer 연결 메뉴에서 저장된 MiSTer에 연결하세요.</p>
        </SectionCard>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="스크립트 관리"
        title="MiSTer 스크립트 관리"
        description="/media/fat/Scripts의 .sh 파일을 보고 편집·저장(수동 백업)·실행하고, 휴지통/PC 내보내기/가져오기를 지원합니다."
      />

      <ActiveMisterBanner purpose="스크립트 관리는 선택한 대상 MiSTer를 기준으로 동작합니다." />

      <SectionCard title="작업 대상">
        <div className="ini-target-bar ini-target-summary">
          <div className="ini-target-identity">
            <span>대상 MiSTer</span>
            {savedProfiles.length > 1 ? (
              <select className="ini-target-select" value={profileId ?? ''} onChange={(event) => selectTargetProfile(event.target.value)} aria-label="스크립트 대상 MiSTer">
                {savedProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{misterDisplayName(profile)} · {deviceStatusLabel(profile)}</option>
                ))}
              </select>
            ) : (
              <strong title={misterLabel}>{misterLabel}</strong>
            )}
          </div>
          <div className="ini-target-status">
            <StatusBadge label={capabilityLabel(capability)} tone={capabilityTone(capability)} />
          </div>
          <div className="inline-actions">
            <button className="button compact" type="button" onClick={() => void refreshList()} disabled={loading}><RefreshCw size={14} /> 목록 새로고침</button>
            <button className="button compact secondary" type="button" onClick={() => void refreshCapability()} disabled={loading}>권한 다시 확인</button>
          </div>
        </div>
        <p className="muted">{message}</p>
      </SectionCard>

      <div className="ini-manager-layout two-pane" style={{ gridTemplateColumns: '360px 12px minmax(520px, 1fr)' }}>
        <SectionCard title="스크립트 목록">
          <div className="ini-list-toolbar">
            <button className="button compact" type="button" onClick={() => void importScript()} disabled={!canWrite}><Upload size={14} /> PC 스크립트 가져오기</button>
          </div>
          <div style={{ maxHeight: 480, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {files.map((file) => {
              const backupOnly = isBackupOnly(file);
              const active = file.fileName === selectedFileName;
              return (
                <button
                  key={file.listId ?? file.fileName}
                  type="button"
                  onClick={() => void openScript(file.fileName)}
                  title={backupOnly ? `${file.fileName}\n원본 없음 · 로컬 PC 백업 ${file.backupCount}개` : `${file.fileName}\n${file.path}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                    padding: '5px 8px', borderRadius: 6,
                    border: `1px solid ${active ? '#0891b2' : '#e2e8f0'}`,
                    background: active ? '#ecfeff' : (backupOnly ? '#f1f5f9' : '#ffffff'),
                    cursor: 'pointer', lineHeight: 1.2,
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: active ? 600 : 400 }}>{file.fileName}</span>
                  {file.backupCount > 0 && <span style={{ fontSize: 11, color: '#64748b', flexShrink: 0 }}>백업 {file.backupCount}</span>}
                  {backupOnly && <span style={{ fontSize: 11, color: '#94a3b8', flexShrink: 0 }}>PC</span>}
                </button>
              );
            })}
            {files.length === 0 && <p className="muted">/media/fat/Scripts에서 .sh 파일을 찾지 못했습니다.</p>}
          </div>
          <details className="ini-inline-panel">
            <summary><strong>휴지통</strong><span>{trashEntries.length}개</span></summary>
            <div className="ini-backup-list">
              <div className="inline-actions">
                <button className="button compact secondary" type="button" onClick={() => void refreshList()}>새로고침</button>
                <button className="button compact danger" type="button" onClick={() => void emptyTrash()} disabled={trashEntries.length === 0}><Trash2 size={14} /> 휴지통 비우기</button>
              </div>
              {trashEntries.slice(0, 20).map((entry) => (
                <div key={entry.path} className="ini-backup-row">
                  <span>{entry.originalFileName}{entry.kind === 'backup' ? ' · 백업' : ''}</span>
                  <small>{formatBytes(entry.sizeBytes)} · {formatDate(entry.movedAt)}</small>
                  <div className="inline-actions">
                    <button className="button compact" type="button" onClick={() => void restoreTrash(entry)}><RotateCcw size={14} /> 복구</button>
                    <button className="button danger compact" type="button" onClick={() => void deleteTrash(entry)}>영구 삭제</button>
                  </div>
                </div>
              ))}
              {trashEntries.length === 0 && <p className="muted">휴지통 항목이 없습니다.</p>}
            </div>
          </details>
          <details className="ini-inline-panel" open={showRecommended} onToggle={(event) => setShowRecommended(event.currentTarget.open)}>
            <summary><strong>추천 스크립트</strong><span>{recommendedScripts.length}개</span></summary>
            <div className="ini-backup-list">
              <p className="muted">GitHub에서 내려받아 이 미스터의 Scripts 폴더에 설치합니다.</p>
              {recommendedScripts.map((rec) => {
                const installed = files.some((file) => file.fileName.toLowerCase() === rec.fileName.toLowerCase());
                return (
                  <div key={rec.fileName} style={{ padding: '6px 0', borderTop: '1px solid #eef2f7' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong style={{ flex: 1, minWidth: 0, fontSize: 13 }}>{rec.title} <span style={{ fontWeight: 400, color: '#94a3b8' }}>({rec.fileName})</span></strong>
                      <button className="button compact" type="button" onClick={() => void installRecommended(rec)} disabled={!canWrite}><Download size={14} /> {installed ? '업데이트' : '다운로드'}</button>
                    </div>
                    <p className="muted" style={{ marginTop: 2 }}>{rec.description}</p>
                    <small style={{ color: '#94a3b8' }}>출처: {rec.source}</small>
                  </div>
                );
              })}
            </div>
          </details>
        </SectionCard>

        <div />

        <SectionCard title={selectedFileName ? `${selectedFileName} 편집` : '스크립트 선택'}>
          {!selectedFileName ? (
            <p className="muted">왼쪽에서 스크립트를 선택하세요.</p>
          ) : (
            <>
              <div style={{ marginBottom: 10, padding: '8px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                {catalogEntry?.title && <strong style={{ fontSize: 13 }}>{catalogEntry.title}{likelyLong ? ' · 오래 걸릴 수 있음' : ''}</strong>}
                {scriptDescription ? (
                  <p className="muted" style={{ marginTop: catalogEntry?.title ? 4 : 0, whiteSpace: 'pre-wrap' }}>{scriptDescription}</p>
                ) : (
                  <p className="muted" style={{ marginTop: catalogEntry?.title ? 4 : 0 }}>등록된 한국어 설명이 없는 스크립트입니다. {headerComment ? '아래 원본 주석을 참고하고' : '내용을 확인하고'} 실행 전 확인하세요.</p>
                )}
                {headerComment && (
                  <details style={{ marginTop: 6 }}>
                    <summary style={{ fontSize: 12, color: '#64748b', cursor: 'pointer' }}>원본 주석 (영문)</summary>
                    <p className="muted" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{headerComment}</p>
                  </details>
                )}
              </div>
              <div className="action-row">
                <button className="button primary compact" type="button" onClick={() => void saveScript()} disabled={!canWrite || !dirty || binary || isMissingOriginal}><Save size={14} /> 저장{dirty && !binary ? ' *' : ''}</button>
                <button className="button compact" type="button" onClick={() => void createBackup()} disabled={!canWrite || binary || isMissingOriginal}><FileText size={14} /> 백업 만들기</button>
                <button className="button compact" type="button" onClick={() => void runScript()} disabled={running || isMissingOriginal}><Play size={14} /> {running ? '실행 중...' : '실행'}</button>
                <button className="button compact secondary" type="button" onClick={() => void exportScript()} disabled={binary || isMissingOriginal}><Download size={14} /> PC로 내보내기</button>
                {savedProfiles.length > 1 && <button className="button compact secondary" type="button" onClick={() => setTransferPrompt(true)} disabled={isMissingOriginal}><Upload size={14} /> 다른 미스터로 전송</button>}
                <button className="button compact danger" type="button" onClick={() => void trashScript()} disabled={!canWrite || isMissingOriginal}><Trash2 size={14} /> 휴지통</button>
              </div>
              <p className="muted">실행은 SSH로 원격 실행되며 출력은 아래에 표시됩니다(미스터 화면이 아닙니다).</p>
              {isMissingOriginal && <p className="muted">원본 스크립트가 없습니다. 아래 백업에서 ‘복원’으로 되살릴 수 있습니다.</p>}
              {binary ? (
                <p className="muted" style={{ marginTop: 8 }}>바이너리 파일입니다(ELF 등). 편집·미리보기·백업·내보내기는 불가하고, 실행·휴지통만 가능합니다.</p>
              ) : !isMissingOriginal && (
                <textarea
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  spellCheck={false}
                  disabled={!canWrite}
                  style={{ width: '100%', minHeight: 320, marginTop: 8, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 12, whiteSpace: 'pre', overflowWrap: 'normal', tabSize: 2 }}
                />
              )}

              {(runOutput || running) && (
                <div style={{ marginTop: 10 }}>
                  <div className="inline-actions" style={{ alignItems: 'center' }}>
                    <strong style={{ fontSize: 13 }}>실행 출력</strong>
                    {bgLogPath && <button className="button compact secondary" type="button" onClick={() => void refreshBgLog()}><RefreshCw size={14} /> 로그 새로고침</button>}
                  </div>
                  <pre ref={outputRef} className="log-box" style={{ maxHeight: 280, overflow: 'auto', marginTop: 4 }}>{runOutput || '실행을 시작했습니다...'}</pre>
                </div>
              )}

              <details className="ini-inline-panel" style={{ marginTop: 10 }}>
                <summary><strong>백업</strong><span>{backups.length}개</span></summary>
                <div className="ini-backup-list">
                  {backups.slice(0, 30).map((backup) => (
                    <div key={backup.path} className="ini-backup-row">
                      <span>{backup.fileName}</span>
                      <small>{formatBytes(backup.sizeBytes)} · {formatDate(backup.createdAt)}</small>
                      <div className="inline-actions">
                        <button className="button compact" type="button" onClick={() => void restoreBackup(backup)} disabled={!canWrite}><RotateCcw size={14} /> 복원</button>
                        <button className="button compact" type="button" onClick={() => void deleteBackup(backup)} disabled={!canWrite}><Trash2 size={14} /> 휴지통</button>
                      </div>
                    </div>
                  ))}
                  {backups.length === 0 && <p className="muted">백업이 없습니다. ‘백업 만들기’로 만듭니다.</p>}
                </div>
              </details>
            </>
          )}
        </SectionCard>
      </div>

      {runModePrompt && (
        <div className="modal-backdrop" role="presentation">
          <div className="compare-modal" role="dialog" aria-modal="true" aria-label="실행 방식 선택">
            <div className="modal-header">
              <h3>{selectedFileName} 실행 방식</h3>
              <button className="button compact" onClick={() => setRunModePrompt(false)}>닫기</button>
            </div>
            <p className="muted">이 스크립트는 오래 걸릴 수 있습니다(예: update_all). 실행 방식을 선택하세요.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              <button className="button primary" type="button" onClick={() => void runWithMode('background')} style={{ textAlign: 'left' }}>
                백그라운드 실행 (권장) — 연결이 끊겨도 미스터에서 끝까지 진행됩니다. 진행은 ‘로그 새로고침’으로 확인합니다.
              </button>
              <button className="button" type="button" onClick={() => void runWithMode('foreground')} style={{ textAlign: 'left' }}>
                포그라운드 실행 — 출력을 실시간으로 보지만, 앱을 닫거나 연결이 끊기면 중단될 수 있습니다.
              </button>
            </div>
            <div className="action-row" style={{ marginTop: 10 }}>
              <button className="button" type="button" onClick={() => setRunModePrompt(false)}>취소</button>
            </div>
          </div>
        </div>
      )}

      {transferPrompt && selectedFileName && (
        <div className="modal-backdrop" role="presentation">
          <div className="compare-modal" role="dialog" aria-modal="true" aria-label="다른 미스터로 전송">
            <div className="modal-header">
              <h3>다른 미스터로 전송</h3>
              <button className="button compact" onClick={() => setTransferPrompt(false)}>닫기</button>
            </div>
            <p className="muted">{selectedFileName}를 복사할 대상 MiSTer를 선택하세요.</p>
            <div className="ini-backup-list">
              {savedProfiles.filter((profile) => profile.id !== profileId).map((profile) => (
                <button key={profile.id} className="button small" type="button" onClick={() => void transferTo(profile.id)} title={profile.ipAddress}>
                  {misterDisplayName(profile)} · {deviceStatusLabel(profile)}
                </button>
              ))}
            </div>
            <div className="action-row" style={{ marginTop: 10 }}>
              <button className="button" type="button" onClick={() => setTransferPrompt(false)}>취소</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
