import { Link } from 'react-router-dom';
import { StatusBadge } from '../status/StatusBadge';
import { formatActiveMisterLabel, useActiveMisterProfile } from '../../services/mister/activeProfile';

interface ActiveMisterBannerProps {
  compact?: boolean;
  purpose?: string;
}

export function ActiveMisterBanner({ compact = false, purpose = '이 화면은 MiSTer 연결 메뉴에서 마지막으로 연결한 장치를 기준으로 동작합니다.' }: ActiveMisterBannerProps) {
  const [activeProfile] = useActiveMisterProfile();

  if (!activeProfile) {
    return (
      <div className="danger-box">
        <div>
          <strong>먼저 MiSTer 연결 메뉴에서 연결하세요.</strong>
          {!compact && <p className="muted">저장된 MiSTer가 있어도 자동으로 연결하지 않습니다. 사용자가 “연결”을 눌러 수동으로 연결 상태를 확인하세요.</p>}
        </div>
        <Link className="button compact" to="/mister">연결로 이동</Link>
      </div>
    );
  }

  return (
    <div className="callout">
      <div>
        <strong>현재 연결된 MiSTer: {formatActiveMisterLabel(activeProfile)}</strong>
        {!compact && <p className="muted">{purpose}</p>}
        {!compact && (
          <p className="muted">
            /media/fat {activeProfile.mediaFatOk ? '확인' : '미확인'} · games {activeProfile.gamesOk ? '확인' : '미확인'} · MiSTer.ini {activeProfile.misterIniOk ? '확인' : '미확인'}
          </p>
        )}
      </div>
      <StatusBadge label="MiSTer 연결됨" tone="safe" />
    </div>
  );
}
