import type { IniPreset } from '../types/ini';

const deferredValue = 'TODO: 공식 MiSTer.ini 템플릿 확인 후 값 확정';

export const iniPresets: IniPreset[] = [
  {
    id: 'hdmi-safe',
    name: 'HDMI 기본',
    fileNameCandidate: 'MiSTer_HDMI.ini',
    purpose: '일반 HDMI TV/모니터용',
    description: '가장 안전한 기본 출력용입니다. 기존 설정을 최대한 보존하고 위험한 CRT 관련 옵션은 건드리지 않습니다.',
    riskLevel: '안전',
    values: [
      { key: 'video_mode', label: '출력 모드', value: deferredValue, description: '현재 MiSTer.ini를 읽은 뒤 사용자가 확인해서 채우는 자리입니다.' },
      { key: 'vsync_adjust', label: 'VSync 조정', value: deferredValue, description: '안전 모드에서는 기존 값을 우선 보존합니다.' },
    ],
    todo: '공식 MiSTer.ini 기본 템플릿과 현재 장치 값을 병합하는 로직 필요',
  },
  {
    id: 'hdmi-low-latency',
    name: 'HDMI 저지연',
    fileNameCandidate: 'MiSTer_HDMI_LowLatency.ini',
    purpose: 'HDMI TV에서 지연을 줄이는 방향',
    description: 'vsync 관련 설정을 조정할 수 있게 하되, 실제 값은 사용자가 비교하고 적용하게 합니다.',
    riskLevel: '주의',
    values: [
      { key: 'vsync_adjust', label: 'VSync 조정', value: deferredValue, description: '지연과 호환성 사이의 균형을 사용자가 선택해야 합니다.' },
      { key: 'video_mode', label: '출력 모드', value: deferredValue, description: '캡처/디스플레이 호환성을 확인한 뒤 적용합니다.' },
    ],
    todo: '저지연 권장값 후보를 공식 문서 기반으로 채우기',
  },
  {
    id: 'crt-15khz',
    name: 'CRT 15kHz',
    fileNameCandidate: 'MiSTer_CRT_15kHz.ini',
    purpose: 'PVM, BVM, RGBs, VGA-to-SCART, Direct Video 계열',
    description: '화면이 안 나올 위험이 있으므로 기본 적용 금지입니다. 반드시 백업 후 적용해야 합니다.',
    riskLevel: '위험',
    values: [
      { key: 'direct_video', label: 'Direct Video', value: deferredValue, description: '잘못 적용하면 화면 출력이 사라질 수 있습니다.' },
      { key: 'composite_sync', label: '컴포지트 싱크', value: deferredValue, description: '케이블/모니터 조합에 따라 달라집니다.' },
    ],
    todo: 'CRT 관련 값은 하드웨어 조합별 검증 테이블 필요',
  },
  {
    id: 'capture-card',
    name: '캡처카드',
    fileNameCandidate: 'MiSTer_Capture.ini',
    purpose: '캡처카드 호환성을 우선',
    description: '해상도와 스케일링을 안정적으로 맞추기 위한 프로필입니다.',
    riskLevel: '주의',
    values: [
      { key: 'video_mode', label: '출력 해상도', value: deferredValue, description: '캡처카드가 안정적으로 받는 모드를 선택합니다.' },
      { key: 'vscale_mode', label: '스케일링', value: deferredValue, description: '캡처 소프트웨어 미리보기 기준으로 조정합니다.' },
    ],
    todo: '일반 캡처카드별 안정 모드 예시 수집',
  },
  {
    id: 'arcade-vertical',
    name: '세로 아케이드',
    fileNameCandidate: 'MiSTer_Arcade_Vertical.ini',
    purpose: '세로 슈팅/아케이드 환경',
    description: '코어별 예외 설정과 연결될 수 있도록 설계된 프로필입니다.',
    riskLevel: '주의',
    values: [
      { key: 'orientation', label: '화면 방향', value: deferredValue, description: '코어별 설정과 충돌하지 않게 확인해야 합니다.' },
      { key: 'vscale_mode', label: '세로 스케일링', value: deferredValue, description: '디스플레이 회전 여부와 함께 조정합니다.' },
    ],
    todo: '코어별 override와 연동하는 구조 추가',
  },
];
