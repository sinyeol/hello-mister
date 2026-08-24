import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileJson, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/cards/PageHeader';
import { SectionCard } from '../components/cards/SectionCard';
import { StatusBadge } from '../components/status/StatusBadge';
import { DryRunBackupService } from '../services/backup/backupService';
import { DryRunDiagnosticsService } from '../services/diagnostics/diagnosticsService';
import { SafeMisterProfileStore } from '../services/mister/profileStore';
import { createProfileSummaryFromIntegration, MisterProfileSummaryStore } from '../services/mister/profileSummary';
import { misterDisplayName } from '../services/mister/misterName';
import { createDiagnosticPackage, formatFingerprintSummary, getRemoteErrorGuide, MisterRemoteReadService } from '../services/mister/remote';
import { formatReviewChecklistGrade, ReviewChecklistService } from '../services/review/reviewChecklistService';
import { createTaskId, taskQueue } from '../services/tasks/taskQueue';
import { useTaskQueue } from '../services/tasks/useTaskQueue';
import type {
  DiagnosticPackage,
  MisterDeviceProfile,
  MisterProfileSummary,
  MisterRemoteFingerprint,
  MisterRemoteGameFolder,
  MisterRemoteScriptFile,
  ReadOnlyIntegrationStepStatus,
  ReadOnlyIntegrationTestResult,
  SshKnownHostEntry,
  SshKnownHostHistoryEntry,
  SshSessionState,
} from '../types/mister';
import type { ReviewChecklist, ReviewChecklistStatus } from '../types/review';

const manualSteps = [
  { id: 'profile', label: '장치 프로필 선택' },
  { id: 'session', label: 'MiSTer 연결 확인' },
  { id: 'host-key', label: 'host key fingerprint 확인' },
  { id: 'host-key', label: 'host key 신뢰 등록' },
  { id: 'fingerprint', label: 'read-only fingerprint 실행' },
  { id: 'path-media-fat', label: '/media/fat 구조 확인' },
  { id: 'ini-preview', label: '원격 MiSTer.ini 미리보기 확인' },
  { id: 'games-list', label: 'games 1단계 폴더 목록 확인' },
  { id: 'scripts-list', label: 'Scripts 목록 확인' },
  { id: 'diagnostic-dry-run', label: '진단 패키지 dry-run 생성' },
  { id: 'summary-cache', label: '결과를 프로필 summary cache에 저장' },
];

function statusTone(status?: ReadOnlyIntegrationStepStatus | string) {
  if (status === '성공' || status === '완료') return 'safe' as const;
  if (status === '실패' || status === '차단됨') return 'danger' as const;
  if (status === '진행 중') return 'warning' as const;
  return 'dry' as const;
}

export function BackupDiagnosticsPage() {
  const backupService = useMemo(() => new DryRunBackupService(), []);
  const diagnosticsService = useMemo(() => new DryRunDiagnosticsService(), []);
  const profileStore = useMemo(() => new SafeMisterProfileStore(), []);
  const summaryStore = useMemo(() => new MisterProfileSummaryStore(), []);
  const remoteService = useMemo(() => new MisterRemoteReadService(), []);
  const misterReviewService = useMemo(() => new ReviewChecklistService('mister-readonly'), []);
  const { tasks } = useTaskQueue();
  const [profiles, setProfiles] = useState<MisterDeviceProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [sessions, setSessions] = useState<SshSessionState[]>([]);
  const [fingerprint, setFingerprint] = useState<MisterRemoteFingerprint | undefined>();
  const [games, setGames] = useState<MisterRemoteGameFolder[]>([]);
  const [scripts, setScripts] = useState<MisterRemoteScriptFile[]>([]);
  const [knownHosts, setKnownHosts] = useState<SshKnownHostEntry[]>([]);
  const [knownHostHistory, setKnownHostHistory] = useState<SshKnownHostHistoryEntry[]>([]);
  const [profileSummary, setProfileSummary] = useState<MisterProfileSummary | undefined>();
  const [integrationResult, setIntegrationResult] = useState<ReadOnlyIntegrationTestResult | undefined>();
  const [diagnosticPackage, setDiagnosticPackage] = useState<DiagnosticPackage | undefined>();
  const [reviewChecklist, setReviewChecklist] = useState<ReviewChecklist>();
  const [reviewNote, setReviewNote] = useState('');
  const [message, setMessage] = useState('진단 패키지는 읽기 전용 정보만 사용합니다. password/private key/token은 포함하지 않습니다.');

  const defaultProfile = profiles.find((profile) => profile.id === selectedProfileId) || profiles.find((profile) => profile.defaultDevice) || profiles[0];
  const activeSession = defaultProfile ? sessions.find((session) => session.sessionId === defaultProfile.id || session.host === defaultProfile.ipAddress) : undefined;
  const activeKnownHost = activeSession ? knownHosts.find((entry) => entry.host === activeSession.host && entry.port === activeSession.port) : undefined;

  const refreshState = useCallback(async () => {
    const [savedProfiles, sshSessions, trustedHosts, trustHistory, summaries] = await Promise.all([
      profileStore.loadProfiles(),
      remoteService.listSessions(),
      remoteService.listKnownHosts(),
      remoteService.listKnownHostHistory(),
      summaryStore.loadSummaries(),
    ]);
    setProfiles(savedProfiles);
    setSessions(sshSessions);
    setKnownHosts(trustedHosts);
    setKnownHostHistory(trustHistory);
    const selected = savedProfiles.find((profile) => profile.id === selectedProfileId) || savedProfiles.find((profile) => profile.defaultDevice) || savedProfiles[0];
    setSelectedProfileId((current) => current || selected?.id || '');
    setProfileSummary(selected ? summaries.find((summary) => summary.profileId === selected.id) : undefined);
  }, [profileStore, remoteService, selectedProfileId, summaryStore]);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  useEffect(() => {
    const checklist = misterReviewService.load();
    setReviewChecklist(checklist);
    setReviewNote(checklist.userNote);
  }, [misterReviewService]);

  useEffect(() => {
    void summaryStore.loadSummaries().then((summaries) => {
      if (defaultProfile) setProfileSummary(summaries.find((summary) => summary.profileId === defaultProfile.id));
    });
  }, [defaultProfile, summaryStore]);

  async function createRemoteDiagnosticPackage() {
    const taskId = createTaskId('diagnostic-package');
    taskQueue.enqueue({
      id: taskId,
      title: '진단 패키지 생성',
      description: '프로필, fingerprint summary, games/Scripts 목록을 로컬 JSON으로 구성합니다.',
      category: 'diagnostics',
      riskLevel: '안전',
      dryRun: false,
      readOnly: true,
      status: '진행 중',
      targetProfileId: defaultProfile?.id,
      targetAlias: defaultProfile?.alias,
      targetHost: defaultProfile?.ipAddress,
      logs: [],
    });
    try {
      let nextGames = games;
      let nextScripts = scripts;
      let nextFingerprint = fingerprint;
      if (activeSession) {
        nextFingerprint = fingerprint || await remoteService.fingerprintSession(activeSession.sessionId, activeSession.host);
        setFingerprint(nextFingerprint);
        const [gameResult, scriptResult] = await Promise.all([
          remoteService.listGames(activeSession.sessionId),
          remoteService.listScripts(activeSession.sessionId),
        ]);
        nextGames = gameResult.items;
        nextScripts = scriptResult.items;
        setGames(nextGames);
        setScripts(nextScripts);
      }
      const pack = createDiagnosticPackage({
        profile: defaultProfile,
        fingerprint: nextFingerprint,
        hostKeyTrust: activeKnownHost
          ? { ok: true, status: 'trusted', host: activeKnownHost.host, port: activeKnownHost.port, fingerprint: activeKnownHost.fingerprint, keyType: activeKnownHost.keyType, knownHost: activeKnownHost, message: '신뢰된 SSH 호스트 키입니다.' }
          : undefined,
        games: nextGames,
        scripts: nextScripts,
        hostKeyHistory: knownHostHistory.filter((entry) => !activeKnownHost || (entry.host === activeKnownHost.host && entry.port === activeKnownHost.port)).slice(0, 20),
        taskLogSummary: tasks.slice(0, 10).map((task) => `${task.title}: ${task.status}`),
      });
      setDiagnosticPackage(pack);
      setMessage('진단 패키지를 생성했습니다. password/private key/token은 포함하지 않습니다.');
      taskQueue.updateStatus(taskId, '완료', '진단 패키지 생성 완료');
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setMessage(text);
      taskQueue.updateStatus(taskId, '실패', text, { sanitizedErrorMessage: text });
    }
  }

  async function runReadOnlyIntegrationTest() {
    const taskId = createTaskId('readonly-integration-test');
    taskQueue.enqueue({
      id: taskId,
      title: '읽기 전용 통합 테스트',
      description: 'SSH, host key, /media/fat, games, Scripts, MiSTer.ini를 쓰기 없이 확인합니다.',
      category: 'diagnostics',
      riskLevel: '안전',
      dryRun: false,
      readOnly: true,
      status: '진행 중',
      targetProfileId: defaultProfile?.id,
      targetAlias: defaultProfile?.alias,
      targetHost: defaultProfile?.ipAddress,
      logs: [],
    });
    const result = await remoteService.runReadOnlyIntegrationTest({
      sessionId: activeSession?.sessionId,
      profile: defaultProfile,
      knownHost: activeKnownHost,
      taskLogSummary: tasks.slice(0, 10).map((task) => `${task.title}: ${task.status}`),
    });
    setIntegrationResult(result);
    if (result.fingerprint) setFingerprint(result.fingerprint);
    if (result.games) setGames(result.games);
    if (result.scripts) setScripts(result.scripts);
    if (result.diagnosticPackage) setDiagnosticPackage(result.diagnosticPackage);
    if (defaultProfile) {
      const nextSummary = createProfileSummaryFromIntegration(defaultProfile, result, activeKnownHost ? 'trusted' : undefined);
      const summaries = await summaryStore.saveSummary(nextSummary);
      setProfileSummary(summaries.find((summary) => summary.profileId === defaultProfile.id));
    }
    setMessage(result.message);
    const failedStep = result.steps.find((step) => step.errorCode);
    taskQueue.updateStatus(taskId, result.ok ? '완료' : result.partial ? '완료' : '실패', result.message, {
      resultSummary: `${result.summary.message} · 성공 ${result.summary.successfulSteps}, 실패 ${result.summary.failedSteps}, 차단 ${result.summary.blockedSteps}`,
      errorCode: failedStep?.errorCode,
      sanitizedErrorMessage: failedStep?.sanitizedMessage || failedStep?.message,
    });
  }

  async function saveDiagnosticPackage() {
    if (!diagnosticPackage) return;
    const result = await remoteService.saveDiagnosticPackage(diagnosticPackage);
    setMessage(result.message);
  }

  async function exportTaskLogs() {
    const result = await taskQueue.exportLogs();
    setMessage(result.message);
  }

  async function clearTaskLogs() {
    const result = await taskQueue.clear();
    setMessage(result.message);
  }

  function updateReviewChecklistStatus(itemId: string, status: ReviewChecklistStatus) {
    if (!reviewChecklist) return;
    const next = misterReviewService.setStatus(reviewChecklist, itemId, status);
    setReviewChecklist(next);
    setReviewNote(next.userNote);
  }

  function saveReviewNote() {
    if (!reviewChecklist) return;
    const next = misterReviewService.setNote(reviewChecklist, reviewNote);
    setReviewChecklist(next);
    setMessage('실제 MiSTer read-only 검토 체크리스트 메모를 저장했습니다. 인증 정보는 저장하지 않습니다.');
  }

  async function exportReviewChecklist(format: 'json' | 'markdown') {
    if (!reviewChecklist || !window.helloMisterDesktop?.saveTextFile) {
      setMessage('현재 환경에서는 체크리스트 파일 내보내기를 사용할 수 없습니다. Electron 앱 창에서 다시 시도하세요.');
      return;
    }
    const extension = format === 'json' ? 'json' : 'md';
    const content = misterReviewService.export({ ...reviewChecklist, userNote: reviewNote }, format);
    const result = await window.helloMisterDesktop.saveTextFile({
      defaultPath: `hello-mister-readonly-review.${extension}`,
      content,
      filters: [{ name: format === 'json' ? 'JSON' : 'Markdown', extensions: [extension] }],
    });
    setMessage(result.message);
  }

  function stepStatus(id: string): ReadOnlyIntegrationStepStatus | '대기' {
    if (id === 'summary-cache' && profileSummary?.updatedAt) return '성공';
    const step = integrationResult?.steps.find((item) => item.id === id);
    return step?.status || '대기';
  }

  return (
    <>
      <PageHeader
        eyebrow="백업/진단"
        title="읽기 전용 진단과 영구 작업 로그"
        description="실제 MiSTer 장치를 대상으로 안전한 수동 검증 절차를 안내하고, 결과를 프로필 summary와 작업 로그에 남깁니다."
      />

      <div className="grid three">
        <SectionCard title="장치 선택">
          <label className="field">
            <span>검증할 프로필</span>
            <select value={defaultProfile?.id || ''} onChange={(event) => setSelectedProfileId(event.target.value)}>
              {profiles.map((profile) => <option key={profile.id} value={profile.id}>{misterDisplayName(profile)}</option>)}
            </select>
          </label>
          <p className="muted">{defaultProfile ? `${defaultProfile.ipAddress} · ${defaultProfile.methods.join(', ')}` : '저장된 프로필이 없습니다.'}</p>
        </SectionCard>
        <SectionCard title="세션/신뢰 상태">
          <StatusBadge label={activeSession ? 'session 인증 있음' : 'session 인증 필요'} tone={activeSession ? 'safe' : 'warning'} />
          <p className="muted">{activeSession ? `${activeSession.username}@${activeSession.host}` : 'MiSTer 연결 메뉴에서 연결하세요.'}</p>
          <StatusBadge label={activeKnownHost ? 'host key 신뢰됨' : 'host key 신뢰 필요'} tone={activeKnownHost ? 'safe' : 'warning'} />
        </SectionCard>
        <SectionCard title="프로필 summary cache">
          <StatusBadge label={profileSummary?.readOnlyTestStatus || '기록 없음'} tone={profileSummary?.lastErrorCode ? 'warning' : profileSummary ? 'safe' : 'dry'} />
          <p className="muted">마지막 성공: {profileSummary?.lastSuccessfulReadAt ? new Date(profileSummary.lastSuccessfulReadAt).toLocaleString() : '없음'}</p>
          <p className="muted">마지막 실패: {profileSummary?.lastFailedReadAt ? new Date(profileSummary.lastFailedReadAt).toLocaleString() : '없음'}</p>
          <p className="muted">games {profileSummary?.gameFolderCount ?? '?'}개 · Scripts {profileSummary?.scriptCount ?? '?'}개</p>
        </SectionCard>
      </div>

      <SectionCard title="실제 MiSTer 읽기 전용 검증" description="host key mismatch 또는 MiSTer 연결 없음 상태에서는 원격 읽기 실행을 막습니다. 일부 항목 실패 시 가능한 read-only 항목은 계속 정리합니다.">
        <div className="action-row">
          <button className="button primary" disabled={!defaultProfile || !activeSession || !activeKnownHost} onClick={() => void runReadOnlyIntegrationTest()}>읽기 전용 통합 테스트 실행</button>
          <button className="button" disabled={!diagnosticPackage} onClick={() => void saveDiagnosticPackage()}><Download size={16} /> 결과를 진단 패키지로 내보내기</button>
          <a className="button" href="#task-log">작업 로그에서 보기</a>
          <StatusBadge label={!defaultProfile ? '프로필 필요' : !activeSession ? '인증 필요' : !activeKnownHost ? 'host key 신뢰 필요' : '실행 가능'} tone={!defaultProfile || !activeSession || !activeKnownHost ? 'warning' : 'safe'} />
        </div>
        <div className="mini-list">
          {manualSteps.map((step) => {
            const status = stepStatus(step.id);
            const resultStep = integrationResult?.steps.find((item) => item.id === step.id);
            const guide = getRemoteErrorGuide(resultStep?.errorCode);
            return (
              <div key={`${step.id}-${step.label}`}>
                <strong>{step.label}</strong>
                <span>{resultStep?.resultSummary || resultStep?.message || guide?.recommendedAction || '대기 중'}</span>
                <StatusBadge label={status} tone={statusTone(status)} />
              </div>
            );
          })}
        </div>
        {integrationResult && (
          <div className="danger-box">
            전체 결과: {integrationResult.summary.status} · 성공 {integrationResult.summary.successfulSteps} · 실패 {integrationResult.summary.failedSteps} · 차단 {integrationResult.summary.blockedSteps} · {integrationResult.durationMs}ms
          </div>
        )}
      </SectionCard>

      <SectionCard title="실제 MiSTer read-only 검토 체크리스트" description="실제 장치별 수동 검토 흐름을 앱 안에 남깁니다. session credential은 저장하지 않습니다.">
        <div className="danger-box">
          <StatusBadge label={reviewChecklist ? formatReviewChecklistGrade(reviewChecklist.grade) : '확인 전'} tone={reviewChecklist?.grade === 'needs-fix' ? 'danger' : reviewChecklist?.grade === 'review-complete' ? 'safe' : 'dry'} />
          <span>원격 쓰기 기능 잠금, host key trusted, 진단 패키지 내보내기, 작업 로그 기록 여부를 실제 장치 기준으로 확인합니다.</span>
        </div>
        <div className="action-row">
          <button className="button" disabled={!reviewChecklist} onClick={saveReviewNote}>체크리스트 메모 저장</button>
          <button className="button" disabled={!reviewChecklist} onClick={() => void exportReviewChecklist('markdown')}>Markdown 내보내기</button>
          <button className="button" disabled={!reviewChecklist} onClick={() => void exportReviewChecklist('json')}>JSON 내보내기</button>
        </div>
        <label className="field">
          사용자 메모
          <textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="실제 MiSTer IP, 검토 날짜, 부분 성공 항목, 다음 확인할 내용을 남깁니다." />
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
              {reviewChecklist?.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.label}</td>
                  <td>
                    <select value={item.status} onChange={(event) => updateReviewChecklistStatus(item.id, event.target.value as ReviewChecklistStatus)}>
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

      <SectionCard title="백업 센터 skeleton">
        <p>MiSTer.ini, MiSTer_alt_*.ini, MiSTer_*.ini, downloader.ini, Scripts, controller configs, favorites, card/NFC mapping data</p>
        <div className="action-row">
          <button className="button" onClick={() => void backupService.createBackupPlan(['MiSTer.ini', 'Scripts', 'controller configs']).then((result) => setMessage(`${result.message}\n${result.logs.join('\n')}`))}>백업 계획 dry-run</button>
          <button className="button" onClick={() => void diagnosticsService.runBasicDiagnostics().then((result) => setMessage(`${result.message}\n${result.logs.join('\n')}`))}>기본 진단 dry-run</button>
          <button className="button primary" onClick={() => void createRemoteDiagnosticPackage()}><Download size={16} /> 진단 패키지 생성</button>
          <button className="button" disabled={!diagnosticPackage} onClick={() => void saveDiagnosticPackage()}>로컬 JSON 저장</button>
        </div>
      </SectionCard>

      <SectionCard title="영구 작업 로그" description="최근 작업 100개를 appData JSON에 저장합니다. password/private key/token/raw command는 저장하지 않습니다.">
        <div className="action-row">
          <button className="button" onClick={() => void exportTaskLogs()}><FileJson size={16} /> 작업 로그 JSON 내보내기</button>
          <button className="button danger" onClick={() => void clearTaskLogs()}><Trash2 size={16} /> 작업 로그 전체 삭제</button>
        </div>
        <div id="task-log" className="task-list">
          {tasks.slice(0, 12).map((task) => (
            <details key={task.id} className="task-row">
              <summary>
                <strong>{task.title}</strong>
                <span>{task.resultSummary || task.description}</span>
                <StatusBadge label={`${task.status}${task.readOnly ? ' · read-only' : ''}${task.dryRun ? ' · dry-run' : ''}`} tone={task.errorCode ? 'danger' : task.status === '완료' ? 'safe' : 'dry'} />
              </summary>
              <div className="task-log">
                {task.logs.map((log) => <p key={`${task.id}-${log.at}-${log.message}`}><time>{new Date(log.at).toLocaleString()}</time>{log.message}</p>)}
                {task.errorCode && <p>{task.errorCode}: {getRemoteErrorGuide(task.errorCode as never)?.description} {getRemoteErrorGuide(task.errorCode as never)?.recommendedAction}</p>}
              </div>
            </details>
          ))}
          {tasks.length === 0 && <div className="empty-state">아직 기록된 작업이 없습니다.</div>}
        </div>
      </SectionCard>

      {diagnosticPackage && (
        <SectionCard title="진단 패키지 미리보기" description={fingerprint ? formatFingerprintSummary(fingerprint) : 'fingerprint 정보 없음'}>
          <pre className="log-box">{JSON.stringify(diagnosticPackage, null, 2)}</pre>
        </SectionCard>
      )}
      <pre className="log-box">{message}</pre>
    </>
  );
}
