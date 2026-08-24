import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Gamepad2, Palette, Radar, Settings } from 'lucide-react';
import { PageHeader } from '../components/cards/PageHeader';
import { SectionCard } from '../components/cards/SectionCard';
import { AdvancedSection } from '../components/common/AdvancedSection';
import { StatusBadge } from '../components/status/StatusBadge';
import { DryRunNotice } from '../components/status/DryRunNotice';
import { useTaskQueue } from '../services/tasks/useTaskQueue';
import { formatRuntimeMode, getRuntimeEnvironment } from '../services/app/runtimeEnvironment';
import { useAppViewMode } from '../services/app/viewMode';
import { formatBasicModeSummary, formatHomeReviewSummary, formatLockedTransferSummary } from '../services/app/uiText';
import type { DesktopRuntimeEnvironment } from '../types/desktop';

function taskTone(status: string, dryRun?: boolean) {
  if (/완료|success|done/i.test(status)) return 'safe' as const;
  if (/실패|차단|failed|blocked/i.test(status)) return 'danger' as const;
  if (dryRun) return 'dry' as const;
  return 'warning' as const;
}

export function HomePage() {
  const { tasks } = useTaskQueue();
  const [appMode] = useAppViewMode();
  const [environment, setEnvironment] = useState<DesktopRuntimeEnvironment>();
  const reviewSummary = useMemo(() => formatHomeReviewSummary(), []);
  const recentTasks = tasks.slice(0, 6);

  useEffect(() => {
    void getRuntimeEnvironment().then(setEnvironment);
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="홈"
        title="Hello Mister v2.1"
        description="스티커 제작, MiSTer 연결 확인, ROM 미리 검사를 한 화면에서 시작합니다."
        actions={<StatusBadge label="기본 모드 우선" tone="safe" />}
      />
      <DryRunNotice />

      <SectionCard title="검토 모드 대시보드" description={formatBasicModeSummary()}>
        <div className="grid three">
          <div className="source-card">
            <strong>현재 앱 상태</strong>
            <p className="muted">실행 모드: {environment ? formatRuntimeMode(environment.mode) : '확인 중'}</p>
            <div className="summary-strip">
              <StatusBadge label="스티커 제작 허브" tone="safe" />
              <StatusBadge label="읽기 전용 가능" tone="safe" />
              <StatusBadge label="실제 ROM transfer locked" tone="warning" />
            </div>
          </div>
          <div className="source-card">
            <strong>바로 시작</strong>
            <div className="action-row">
              <Link to="/stickers" className="button primary"><Palette size={16} /> 스티커 제작</Link>
              <Link to="/mister" className="button"><Radar size={16} /> MiSTer 연결</Link>
              <Link to="/games" className="button"><Gamepad2 size={16} /> ROM 미리 검사</Link>
            </div>
          </div>
          <div className="source-card">
            <strong>다음에 할 일</strong>
            <ul className="check-list">
              {reviewSummary.nextActions.map((action) => <li key={action}>{action}</li>)}
            </ul>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="스티커 제작" description="v1.0의 카드/스티커 제작 흐름을 v2 기본 모드에서 다시 시작할 수 있게 배치했습니다." tone="safe">
        <div className="flow-steps">
          {['이미지 준비', '템플릿 선택', '카드 편집', '앨범 확인', '시트/출력'].map((step, index) => (
            <span className="flow-step" data-step={index + 1} key={step}>{step}</span>
          ))}
        </div>
        <div className="action-row">
          <Link to="/stickers" className="button primary"><Palette size={16} /> 스티커 제작 허브 열기</Link>
          <Link to="/settings" className="button"><Settings size={16} /> 모드 설정</Link>
        </div>
      </SectionCard>

      <div className="grid two">
        <SectionCard title="MiSTer 연결" description="IP 입력, MiSTer 저장, 수동 연결, SSH 장치 신뢰 키 확인, 연결 상태 확인 순서로 진행합니다." tone="warning">
          <div className="flow-steps">
            {['IP 입력', '저장', '신뢰 키', '연결 확인'].map((step, index) => (
              <span className="flow-step" data-step={index + 1} key={step}>{step}</span>
            ))}
          </div>
          <div className="action-row">
            <Link to="/mister" className="button primary"><Radar size={16} /> 연결 화면 열기</Link>
          </div>
        </SectionCard>

        <SectionCard title="ROM 미리 검사" description="로컬 ROM을 선택하고, 원격 games 폴더와 비교해 충돌/용량/계획만 확인합니다." tone="dry">
          <div className="flow-steps">
            {['ROM 선택', '미리 검사', '계획 확인', '리포트'].map((step, index) => (
              <span className="flow-step" data-step={index + 1} key={step}>{step}</span>
            ))}
          </div>
          <div className="action-row">
            <Link to="/games" className="button primary"><Gamepad2 size={16} /> 게임 관리 열기</Link>
          </div>
        </SectionCard>
      </div>

      <AdvancedSection
        viewMode={appMode}
        minimumMode="advanced"
        title="최근 작업 로그"
        summary="작업 로그는 고급 모드의 내부 진단에서만 기본 노출합니다."
      >
        {recentTasks.length > 0 ? (
          <div className="task-list">
            {recentTasks.map((task) => (
              <details key={task.id} className="task-row">
                <summary>
                  <strong>{task.title}</strong>
                  <span>{task.resultSummary || task.description}</span>
                  <StatusBadge label={`${task.status}${task.readOnly ? ' · read-only' : ''}${task.dryRun ? ' · dry-run' : ''}`} tone={taskTone(task.status, task.dryRun)} />
                </summary>
                <div className="task-log">
                  {task.logs.map((log) => <p key={`${task.id}-${log.at}-${log.message}`}><time>{new Date(log.at).toLocaleString()}</time>{log.message}</p>)}
                </div>
              </details>
            ))}
          </div>
        ) : <div className="empty-state">아직 기록된 작업이 없습니다.</div>}
      </AdvancedSection>

      <AdvancedSection
        viewMode={appMode}
        minimumMode="advanced"
        title="위험 기능 잠금 상세"
        summary="실제 전송, 원격 쓰기, SD 플래싱 잠금 상태를 자세히 봅니다."
        tone="dry"
      >
        <div className="danger-box">
          <AlertTriangle size={18} />
          <span>{formatLockedTransferSummary()} 원격 upload, reboot, 스크립트 실행, SD 포맷/플래싱, raw command IPC도 계속 차단되어 있습니다.</span>
        </div>
        <ul className="check-list">
          <li>ROM copy/upload locked</li>
          <li>remote mkdir/rename/delete locked</li>
          <li>reboot/script execution/SD flash locked</li>
          <li>raw command IPC 없음</li>
          <li>password/privateKey/passphrase/token 저장 없음</li>
        </ul>
      </AdvancedSection>
    </>
  );
}
