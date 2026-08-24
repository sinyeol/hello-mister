import { PageHeader } from '../components/cards/PageHeader';
import { SectionCard } from '../components/cards/SectionCard';

export function SyncPage() {
  return (
    <>
      <PageHeader eyebrow="동기화" title="여러 MiSTer 간 비교/동기화 skeleton" description="ROM, Scripts, INI, 컨트롤러 설정을 비교하고 충돌 해결 후 작업 큐로 복사하는 구조를 준비합니다." />
      <div className="grid two">
        <SectionCard title="MiSTer A">연결된 장치가 없습니다.</SectionCard>
        <SectionCard title="MiSTer B">연결된 장치가 없습니다.</SectionCard>
      </div>
      <SectionCard title="충돌 해결 정책" tone="dry">
        <p>실제 복사/삭제 전에는 preview, 백업 hook, 사용자 확인, dry-run 결과 로그가 필요합니다.</p>
      </SectionCard>
    </>
  );
}
