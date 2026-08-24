import { useEffect, useMemo, useState } from 'react';
import { Download, FileDiff, ShieldAlert, Wifi } from 'lucide-react';
import { PageHeader } from '../components/cards/PageHeader';
import { SectionCard } from '../components/cards/SectionCard';
import { ActiveMisterBanner } from '../components/mister/ActiveMisterBanner';
import { StatusBadge } from '../components/status/StatusBadge';
import { iniPresets } from '../data/iniPresets';
import { diffIniValues, formatIniDiffSummary } from '../services/ini/iniDiff';
import { DryRunIniProfileService } from '../services/ini/iniProfiles';
import { useActiveMisterProfile } from '../services/mister/activeProfile';
import { SafeMisterProfileStore } from '../services/mister/profileStore';
import { MisterRemoteReadService } from '../services/mister/remote';
import { createTaskId, taskQueue } from '../services/tasks/taskQueue';
import type { IniPreset } from '../types/ini';
import type { MisterDeviceProfile, MisterRemoteIniSnapshot, SshSessionState } from '../types/mister';

export function IniSettingsPage() {
  const service = useMemo(() => new DryRunIniProfileService(), []);
  const profileStore = useMemo(() => new SafeMisterProfileStore(), []);
  const remoteService = useMemo(() => new MisterRemoteReadService(), []);
  const [selected, setSelected] = useState<IniPreset>(iniPresets[0]);
  const [planText, setPlanText] = useState('프리셋을 선택하면 적용 계획이 여기에 표시됩니다.');
  const [exportMessage, setExportMessage] = useState('파일 내보내기 전입니다.');
  const [defaultProfile, setDefaultProfile] = useState<MisterDeviceProfile | undefined>();
  const [sessions, setSessions] = useState<SshSessionState[]>([]);
  const [activeMister] = useActiveMisterProfile();
  const [remoteIni, setRemoteIni] = useState<MisterRemoteIniSnapshot | undefined>();
  const currentValues = iniPresets[0].values;
  const diff = diffIniValues(currentValues, selected.values);
  const profiles = [
    'MiSTer.ini',
    'MiSTer_alt_1.ini',
    'MiSTer_alt_2.ini',
    'MiSTer_alt_3.ini',
    'MiSTer_HDMI.ini',
  ];
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

  useEffect(() => {
    void Promise.all([profileStore.loadProfiles(), remoteService.listSessions()]).then(([savedProfiles, sshSessions]) => {
      setDefaultProfile(savedProfiles.find((profile) => profile.id === activeMister?.profileId) || savedProfiles.find((profile) => profile.defaultDevice) || savedProfiles[0]);
      setSessions(sshSessions);
    });
  }, [profileStore, remoteService, activeMister?.profileId]);

  function createPlan(mode: '현재 MiSTer.ini로 적용' | '대체 INI로 저장', rebootAfterApply: boolean) {
    const plan = service.createApplyPlan(selected, mode, rebootAfterApply);
    setPlanText(JSON.stringify(plan, null, 2));
  }

  async function exportPreset() {
    const result = await service.exportPresetFile(selected);
    setExportMessage(result.message);
    taskQueue.enqueue({
      id: createTaskId('ini-export'),
      title: 'INI 프리셋 파일 내보내기',
      description: selected.fileNameCandidate,
      category: 'ini',
      riskLevel: '안전',
      dryRun: false,
      status: result.ok ? '완료' : result.cancelled ? '차단됨' : '실패',
      logs: [{ at: new Date().toISOString(), message: result.message }],
    });
  }

  async function readRemoteIni() {
    if (!activeSession) return;
    const taskId = createTaskId('remote-ini');
    taskQueue.enqueue({
      id: taskId,
      title: '원격 MiSTer.ini 읽기',
      description: `${activeSession.username}@${activeSession.host}:${activeSession.port}`,
      category: 'ini',
      riskLevel: '안전',
      dryRun: false,
      status: '실행 중',
      logs: [{ at: new Date().toISOString(), message: 'SFTP 읽기 전용으로 /media/fat/MiSTer.ini를 가져옵니다.' }],
    });
    try {
      const snapshot = await remoteService.readMisterIni(activeSession.sessionId);
      setRemoteIni(snapshot);
      taskQueue.updateStatus(taskId, snapshot.ok ? '완료' : '실패', snapshot.message);
    } catch (error) {
      taskQueue.updateStatus(taskId, '실패', error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <>
      <PageHeader eyebrow="INI 설정" title="MiSTer.ini GUI 프리셋 관리" description="프리셋을 실제 INI 파일로 내보낼 수 있지만 원격 업로드, 덮어쓰기, reboot는 계속 비활성입니다." />
      <ActiveMisterBanner purpose="INI 설정은 MiSTer 연결 메뉴에서 마지막으로 연결한 장치의 읽기 세션을 사용합니다." />
      <div className="grid two">
        <SectionCard title="현재 INI 프로필 목록">
          <div className="mini-list">
            {profiles.map((profile) => <div key={profile}><strong>{profile}</strong><span>원격 읽기 adapter 연결 전 placeholder</span></div>)}
          </div>
          <button className="button" onClick={() => void readRemoteIni()} disabled={!activeSession}><Wifi size={16} /> 원격 MiSTer.ini 읽기</button>
          <p className="muted">{activeSession ? `연결: ${activeSession.username}@${activeSession.host}` : 'MiSTer 연결 메뉴에서 연결하세요.'}</p>
        </SectionCard>
        <SectionCard title="적용 방식" tone="dry">
          <ol className="ordered-list">
            <li>선택한 프리셋을 `/media/fat/MiSTer.ini`로 복사하고 reboot합니다. 현재는 disabled입니다.</li>
            <li>선택한 프리셋을 `/media/fat/MiSTer_프로필명.ini`로 저장하고 사용자가 OSD에서 선택합니다.</li>
            <li>저장 전 자동 백업: `backups/ini/MiSTer.ini.YYYY-MM-DD_HHMMSS.bak`</li>
          </ol>
        </SectionCard>
      </div>
      <div className="preset-grid">
        {iniPresets.map((preset) => (
          <button key={preset.id} className={`preset-card ${selected.id === preset.id ? 'selected' : ''}`} onClick={() => setSelected(preset)}>
            <div className="preset-header">
              <strong>{preset.name}</strong>
              <StatusBadge label={preset.riskLevel} tone={preset.riskLevel === '위험' ? 'danger' : preset.riskLevel === '주의' ? 'warning' : 'safe'} />
            </div>
            <span>{preset.fileNameCandidate}</span>
            <p>{preset.description}</p>
          </button>
        ))}
      </div>
      <SectionCard title={`${selected.name} 미리보기`} description={selected.purpose}>
        {selected.riskLevel === '위험' && (
          <div className="danger-box"><ShieldAlert size={18} /> 이 프리셋은 기본 적용 금지입니다. 실제 값은 공식 MiSTer.ini 템플릿과 현재 장치 백업 기반으로만 확정해야 합니다.</div>
        )}
        <table className="data-table">
          <thead><tr><th>키</th><th>라벨</th><th>값</th><th>설명</th></tr></thead>
          <tbody>
            {selected.values.map((value) => (
              <tr key={value.key}><td>{value.key}</td><td>{value.label}</td><td>{value.value}</td><td>{value.description}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="muted">TODO: {selected.todo}</p>
        <div className="action-row">
          <button className="button" onClick={() => createPlan('현재 MiSTer.ini로 적용', false)}>현재 MiSTer.ini로 적용 dry-run</button>
          <button className="button" onClick={() => createPlan('대체 INI로 저장', false)}>대체 INI로 저장 dry-run</button>
          <button className="button" onClick={() => void exportPreset()}><Download size={16} /> 프리셋을 파일로 내보내기</button>
          <button className="button danger" disabled onClick={() => createPlan('현재 MiSTer.ini로 적용', true)}>적용 후 재부팅 비활성</button>
        </div>
        <p className="muted">{exportMessage}</p>
      </SectionCard>

      <SectionCard title="변경점 비교" description={formatIniDiffSummary(diff)}>
        <div className="diff-list">
          {diff.map((entry) => (
            <div key={`${entry.kind}-${entry.key}`} className={`diff-row ${entry.kind}`}>
              <FileDiff size={16} />
              <strong>{entry.kind}</strong>
              <span>{entry.key}</span>
              <code>{entry.before ?? '(없음)'} → {entry.after ?? '(삭제)'}</code>
              <StatusBadge label={entry.riskLevel} tone={entry.riskLevel === '위험' ? 'danger' : entry.riskLevel === '주의' ? 'warning' : 'safe'} />
            </div>
          ))}
        </div>
      </SectionCard>
      {remoteIni && (
        <SectionCard title="원격 MiSTer.ini 미리보기" description={remoteIni.message}>
          <div className="action-row">
            <StatusBadge label={remoteIni.ok ? '읽기 완료' : '읽기 실패'} tone={remoteIni.ok ? 'safe' : 'warning'} />
            <span className="muted">{remoteIni.path} · {remoteIni.sizeBytes} bytes · {new Date(remoteIni.readAt).toLocaleString()}</span>
          </div>
          <pre className="log-box">{remoteIni.content}</pre>
          <button
            className="button"
            onClick={() => void window.helloMisterDesktop?.saveTextFile?.({
              defaultPath: 'MiSTer.ini.backup',
              content: remoteIni.content,
              filters: [{ name: 'MiSTer INI', extensions: ['ini'] }],
            }).then((result) => setExportMessage(result.message))}
          >
            로컬로 백업 저장
          </button>
        </SectionCard>
      )}
      <pre className="log-box">{planText}</pre>
    </>
  );
}
