export type TechnicalTerm =
  | 'dry-run'
  | 'simulated transfer'
  | 'preflight guard'
  | 'kill switch'
  | 'feature flag'
  | 'host key'
  | 'fingerprint'
  | 'appData';

const friendlyTerms: Record<TechnicalTerm, string> = {
  'dry-run': '미리 검사',
  'simulated transfer': '복사 시뮬레이션',
  'preflight guard': '실행 전 안전 검사',
  'kill switch': '전송 전체 잠금',
  'feature flag': '기능 잠금 설정',
  'host key': 'SSH 장치 신뢰 키',
  fingerprint: '신뢰 키 지문',
  appData: '앱 데이터 저장 위치',
};

export function formatTechnicalTerm(term: TechnicalTerm) {
  return friendlyTerms[term];
}

export function formatLockedTransferSummary() {
  return '실제 ROM 복사, 원격 폴더 생성, 삭제, 덮어쓰기, 재부팅은 잠겨 있습니다.';
}

export function formatBasicModeSummary() {
  return '기본 모드는 스티커 제작, MiSTer 연결, ROM 미리 검사처럼 바로 필요한 작업만 보여줍니다.';
}

export function formatHomeReviewSummary() {
  return {
    status: '스티커 제작과 읽기 전용 MiSTer 검증을 먼저 보여주고, 실제 전송은 잠겨 있습니다.',
    nextActions: ['스티커 제작 시작', 'MiSTer 연결하기', 'ROM 미리 검사하기'],
  };
}

export function formatMisterConnectionSteps() {
  return ['IP 입력', 'MiSTer 저장', '수동 연결', 'SSH 장치 신뢰 키 확인', '연결 상태 확인'];
}

export function formatGameManagementSteps() {
  return ['ROM 선택', '미리 검사', '충돌/용량 확인', '복사 계획 확인', '리포트/시뮬레이션'];
}
