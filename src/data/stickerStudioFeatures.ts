export interface StickerStudioFeature {
  id: string;
  title: string;
  description: string;
  status: 'available' | 'planned' | 'local-only';
  primaryAction: string;
  route: string;
  notes: string[];
}

export const stickerStudioFeatures: StickerStudioFeature[] = [
  {
    id: 'image-management',
    title: '이미지 관리',
    description: '로컬 이미지 파일과 폴더를 가져와 카드 제작용 라이브러리로 정리합니다.',
    status: 'available',
    primaryAction: '이미지 가져오기',
    route: '/stickers/images',
    notes: ['PNG, JPG, WEBP, GIF를 지원합니다.', '폴더 1단계 스캔이 기본이며 재귀 스캔은 사용자가 직접 켜야 합니다.'],
  },
  {
    id: 'template-management',
    title: '템플릿 관리',
    description: '기본 템플릿을 고르고, 복제하거나 이름을 바꿔 카드 모양을 준비합니다.',
    status: 'available',
    primaryAction: '템플릿 고르기',
    route: '/stickers/templates',
    notes: ['기본 템플릿 6개를 제공합니다.', '기본 템플릿은 삭제할 수 없고 사용자 템플릿만 삭제할 수 있습니다.'],
  },
  {
    id: 'card-editor',
    title: '카드/스티커 편집',
    description: '템플릿과 이미지를 선택하고 제목, 플랫폼, NFC 경로 후보를 입력해 카드를 저장합니다.',
    status: 'available',
    primaryAction: '카드 만들기',
    route: '/stickers/editor',
    notes: ['HTML/CSS 기반 MVP 미리보기를 제공합니다.', '저장된 카드는 v2 appData의 sticker-cards.json에 기록됩니다.'],
  },
  {
    id: 'card-album',
    title: '카드 앨범',
    description: '저장한 카드를 검색, 필터, 복제, 삭제하고 출력 대상으로 보냅니다.',
    status: 'available',
    primaryAction: '앨범 보기',
    route: '/stickers/album',
    notes: ['삭제는 로컬 카드 데이터에만 적용됩니다.', '원격 MiSTer나 ROM 파일에는 영향을 주지 않습니다.'],
  },
  {
    id: 'sheet-export',
    title: '시트/출력',
    description: '선택한 카드를 A4 또는 Letter 시트에 배치하고 인쇄 미리보기 또는 SVG 내보내기를 수행합니다.',
    status: 'local-only',
    primaryAction: '시트 만들기',
    route: '/stickers/output',
    notes: ['이번 MVP는 시트 미리보기와 SVG/HTML 출력 중심입니다.', '고해상도 PNG/PDF 출력은 후속 단계에서 v1 출력 파이프라인을 참고해 보강합니다.'],
  },
];

export function summarizeStickerStudioFeatures() {
  return {
    total: stickerStudioFeatures.length,
    available: stickerStudioFeatures.filter((feature) => feature.status === 'available' || feature.status === 'local-only').length,
    planned: stickerStudioFeatures.filter((feature) => feature.status === 'planned').length,
  };
}
