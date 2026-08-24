import { PageHeader } from '../components/cards/PageHeader';
import { SectionCard } from '../components/cards/SectionCard';
import { StatusBadge } from '../components/status/StatusBadge';

export function DeveloperToolsPage() {
  return (
    <>
      <PageHeader
        eyebrow="고급 도구"
        title="검토/진단 상세 정보"
        description="appData, IPC, 리포트, 정책, rollback/readiness 같은 내부 정보는 기본 모드에서 숨기고 고급 모드에서 확인합니다."
      />
      <div className="grid two">
        <SectionCard title="안전 잠금 상태" description="실제 원격 쓰기 기능은 아직 활성화하지 않았습니다." tone="warning">
          <div className="summary-strip">
            <StatusBadge label="ROM transfer locked" tone="danger" />
            <StatusBadge label="remote mkdir/upload/delete 없음" tone="safe" />
            <StatusBadge label="raw command IPC 없음" tone="safe" />
          </div>
        </SectionCard>
        <SectionCard title="내부 진단 정보 위치" description="세부 appData 상태와 파일 dialog 검토는 설정 및 백업/진단 화면의 고급 모드 섹션에서 계속 확인할 수 있습니다." tone="dry">
          <ul className="check-list">
            <li>설정: 실행 환경, 앱 데이터 저장 위치, 저장 파일 상태</li>
            <li>백업/진단: 작업 로그, 리포트, read-only 검증 기록</li>
            <li>게임 관리: ROM dry-run 리포트와 전송 준비 정책</li>
          </ul>
        </SectionCard>
      </div>
    </>
  );
}
