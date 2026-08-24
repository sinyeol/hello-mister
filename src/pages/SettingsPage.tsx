import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { PageHeader } from '../components/cards/PageHeader';
import { SectionCard } from '../components/cards/SectionCard';
import { StatusBadge } from '../components/status/StatusBadge';
import { formatRuntimeMode, formatTransferLockStatus, getRuntimeEnvironment } from '../services/app/runtimeEnvironment';
import { formatLockedTransferSummary } from '../services/app/uiText';
import { formatViewMode, useAppViewMode } from '../services/app/viewMode';
import type { DesktopRuntimeEnvironment } from '../types/desktop';

export function SettingsPage() {
  const [appMode, setAppMode] = useAppViewMode();
  const [environment, setEnvironment] = useState<DesktopRuntimeEnvironment>();

  async function refreshDesktopStatus() {
    setEnvironment(await getRuntimeEnvironment());
  }

  useEffect(() => {
    void refreshDesktopStatus();
  }, []);

  const electronMode = environment?.mode === 'electron';

  return (
    <>
      <PageHeader
        eyebrow="설정"
        title="앱 모드와 안전 잠금"
        description="기본 모드는 꼭 필요한 화면만 보여줍니다. 고급 모드에서 SD·INI·스크립트·컨트롤러·백업 화면이 추가로 보입니다."
      />

      <SectionCard title="앱 모드" description="기본은 스티커 제작과 일반 MiSTer 사용 중심, 고급은 SD·INI·스크립트·컨트롤러·백업을 포함합니다.">
        <div className="segmented-control two">
          <button type="button" className={appMode === 'basic' ? 'active' : ''} onClick={() => setAppMode('basic')}>기본 모드</button>
          <button type="button" className={appMode === 'advanced' ? 'active' : ''} onClick={() => setAppMode('advanced')}>고급 모드</button>
        </div>
        <p className="simple-note">현재 {formatViewMode(appMode)}입니다.</p>
      </SectionCard>

      <div className="grid two">
        <SectionCard title="실행 상태" description="Electron 앱 실행 여부와 전송 잠금 상태입니다.">
          <div className="summary-strip">
            <StatusBadge label={environment ? formatRuntimeMode(environment.mode) : '확인 중'} tone={electronMode ? 'safe' : 'warning'} />
            <StatusBadge label={formatTransferLockStatus(environment)} tone="dry" />
          </div>
          <p className="muted">버전: {environment?.appVersion || '확인 중'}</p>
          <div className="action-row">
            <button className="button" onClick={() => void refreshDesktopStatus()}><RefreshCw size={16} /> 상태 새로고침</button>
          </div>
        </SectionCard>

        <SectionCard title="안전 잠금" description={formatLockedTransferSummary()} tone="dry">
          <ul className="check-list">
            <li>MiSTer 간·으로의 ROM 복사·업로드 잠금 (dry-run만)</li>
            <li>INI·컨트롤러·스크립트 편집은 백업 후 확인을 거쳐 적용</li>
            <li>SD 굽기·포맷은 명시적 확인 뒤에만 실행</li>
            <li>raw command IPC 없음</li>
          </ul>
        </SectionCard>
      </div>

      <SectionCard title="정보 · 고지" description="비제휴 고지와 서드파티 소프트웨어 안내입니다.">
        <p className="muted">
          Hello Mister는 독립적인 서드파티 도구로, MiSTer 프로젝트(MiSTer-devel), Zaparoo 프로젝트, theypsilon,
          Unbroken Software(LaunchBox), NXP 등과 제휴·후원·승인 관계가 없습니다. Zaparoo는 Wizzo Pty Ltd의 상표이며,
          MISTER FPGA·LaunchBox 등 언급된 명칭은 각 권리자의 상표/명칭입니다. 이 앱에서의 언급은 호환성 설명을 위한 것입니다.
        </p>
        <p className="muted">
          이 앱은 Mr. Fusion·Ms. Fusion·update_all·MiSTer 공식 스크립트·Zaparoo Core 를 <b>번들하지 않으며</b>,
          사용자의 요청 시 각 프로젝트의 공식 GitHub 배포 원본을 무수정으로 내려받기만 합니다. 해당 소프트웨어는 각자의
          라이선스(GPL-3.0)를 따릅니다:{' '}
          <a href="https://github.com/MiSTer-devel/mr-fusion" target="_blank" rel="noreferrer">mr-fusion</a> ·{' '}
          <a href="https://github.com/theypsilon/Update_All_MiSTer" target="_blank" rel="noreferrer">Update All</a> ·{' '}
          <a href="https://github.com/MiSTer-devel/Scripts_MiSTer" target="_blank" rel="noreferrer">Scripts_MiSTer</a> ·{' '}
          <a href="https://github.com/ZaparooProject/zaparoo-core" target="_blank" rel="noreferrer">Zaparoo Core</a>
        </p>
        <p className="muted">
          SD 카드 굽기 등 파괴적 작업은 사용자의 확인 아래 있는 그대로(AS-IS) 제공되며, 데이터 손실에 대한 보증이 없습니다.
          스티커 인쇄에 쓰는 게임 이미지의 저작권 책임은 사용자에게 있으며 개인적 사용 목적으로만 사용하세요.
        </p>
      </SectionCard>
    </>
  );
}
