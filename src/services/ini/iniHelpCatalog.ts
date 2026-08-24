import type {
  MisterIniAllowedValue,
  MisterIniHelpSource,
  MisterIniRiskLevel,
  MisterIniSetting,
  MisterIniValueRange,
  MisterIniValueType,
} from '../../types/ini';

export interface IniHelpEntry {
  label: string;
  description: string;
  category: MisterIniSetting['category'];
  labelEn: string;
  labelKo: string;
  descriptionKo: string;
  whenToUseKo?: string;
  valueGuideKo?: string;
  recommendedKo?: string;
  warningKo?: string;
  source: MisterIniHelpSource;
  valueType?: MisterIniValueType;
  allowedValues?: MisterIniAllowedValue[];
  range?: MisterIniValueRange;
  examples?: string[];
  riskLevel?: MisterIniRiskLevel;
  placeholder?: string;
  options?: string[];
  optionLabels?: Record<string, string>;
  rawBoolean?: boolean;
}

type IniHelpEntryInput = Omit<IniHelpEntry, 'label' | 'description' | 'options' | 'optionLabels' | 'source'> & {
  label?: string;
  description?: string;
  source?: MisterIniHelpSource;
  options?: string[];
  optionLabels?: Record<string, string>;
};

function entry(input: IniHelpEntryInput): IniHelpEntry {
  const optionLabels = input.allowedValues
    ? Object.fromEntries(input.allowedValues.map((item) => [item.value, item.labelKo]))
    : input.optionLabels;

  return {
    ...input,
    label: input.label || `${input.labelEn} (${input.labelKo})`,
    description: input.description || input.descriptionKo,
    source: input.source || 'official-mister-ini',
    riskLevel: input.riskLevel || 'normal',
    options: input.allowedValues?.map((item) => item.value) || input.options,
    optionLabels,
  };
}

const booleanValueGuide = 'OFF=0, ON=1로 저장됩니다.';

export const iniHelpCatalog: Record<string, IniHelpEntry> = {
  video_mode: entry({
    labelEn: 'Video Mode',
    labelKo: '비디오 모드',
    descriptionKo: 'MiSTer의 출력 해상도와 주사율을 정하는 핵심 영상 설정입니다.',
    whenToUseKo: '화면이 나오지 않거나 특정 디스플레이에 맞춘 custom video mode가 필요할 때만 조정합니다.',
    valueGuideKo: '프리셋 번호 또는 custom video mode 문자열을 사용할 수 있습니다.',
    recommendedKo: '화면이 정상적으로 나오고 있다면 변경하지 않는 것이 안전합니다.',
    warningKo: '잘못 설정하면 화면이 나오지 않을 수 있습니다.',
    valueType: 'videoMode',
    examples: ['0', '8', '1920,48,32,80,1080,3,5,23,148500'],
    riskLevel: 'caution',
    placeholder: '0-14 또는 custom modeline',
    category: 'video',
  }),
  vsync_adjust: entry({
    labelEn: 'VSync Adjust',
    labelKo: '수직 동기 조정',
    descriptionKo: '화면 지연과 호환성의 균형에 영향을 주는 설정입니다.',
    whenToUseKo: '입력 지연을 줄이거나 특정 디스플레이에서 끊김/호환성 문제가 있을 때만 조정합니다.',
    valueGuideKo: '값 0/1/2 중 하나를 사용합니다. 값의 체감 효과는 코어와 디스플레이에 따라 다릅니다.',
    recommendedKo: '정확한 목적이 없다면 기존 값을 유지하세요.',
    valueType: 'enum',
    allowedValues: [
      { value: '0', labelKo: '값 0', descriptionKo: '기본 또는 보수적 동작으로 쓰이는 경우가 많습니다.' },
      { value: '1', labelKo: '값 1', descriptionKo: '낮은 지연을 목표로 조정할 때 쓰일 수 있습니다.' },
      { value: '2', labelKo: '값 2', descriptionKo: '호환성 또는 특정 환경용으로 쓰일 수 있습니다.' },
    ],
    riskLevel: 'caution',
    category: 'video',
  }),
  vscale_mode: entry({
    labelEn: 'Vertical Scale Mode',
    labelKo: '세로 스케일 방식',
    descriptionKo: '화면을 세로 방향으로 어떻게 확대하거나 맞출지 정하는 설정입니다. 정수 스케일, 화면 맞춤, 특수 스케일링 등 출력 방식에 영향을 줄 수 있습니다.',
    whenToUseKo: '화면 비율이나 위아래 여백이 맞지 않을 때만 확인합니다.',
    valueGuideKo: '숫자 값으로 저장됩니다.',
    recommendedKo: '화면 비율이나 위아래 여백에 문제가 있을 때만 조정하세요.',
    warningKo: '코어와 출력 해상도에 따라 결과가 달라질 수 있습니다.',
    valueType: 'number',
    examples: ['0', '1', '2'],
    placeholder: '예: 0 / 1 / 2',
    category: 'video',
  }),
  vscale_border: entry({
    labelEn: 'Vertical Scale Border',
    labelKo: '세로 스케일 여백',
    descriptionKo: '화면 위아래가 잘리거나 여백이 맞지 않을 때 세로 여백을 조정하는 설정입니다.',
    whenToUseKo: '화면 위아래가 잘리거나 여백이 어색할 때만 확인합니다.',
    valueGuideKo: '보통 1-399 범위의 숫자 값을 사용합니다.',
    recommendedKo: '필요할 때만 조금씩 조정하세요.',
    warningKo: '값을 크게 바꾸면 화면 구성이 어색해질 수 있습니다.',
    valueType: 'number',
    range: { min: 1, max: 399 },
    placeholder: '1-399',
    category: 'video',
  }),
  direct_video: entry({
    labelEn: 'Direct Video',
    labelKo: '다이렉트 비디오',
    descriptionKo: 'HDMI 출력 타이밍을 이용해 아날로그 변환 장치에서 코어의 원래 비디오 타이밍을 사용하게 하는 설정입니다.',
    whenToUseKo: 'CRT, PVM/BVM, DAC, HDMI-to-VGA 같은 아날로그 출력 환경에서만 신중하게 확인합니다.',
    valueGuideKo: booleanValueGuide,
    recommendedKo: '일반 HDMI TV나 모니터에서는 OFF를 유지하세요.',
    warningKo: '아날로그 출력 환경이 아닌데 켜면 화면이 나오지 않거나 색/동기 문제가 생길 수 있습니다.',
    valueType: 'boolean',
    riskLevel: 'danger',
    category: 'video',
  }),
  composite_sync: entry({
    labelEn: 'Composite Sync',
    labelKo: '컴포지트 싱크',
    descriptionKo: '아날로그 출력에서 수평/수직 동기 신호를 하나의 composite sync 신호로 사용할지 정하는 설정입니다.',
    whenToUseKo: 'SCART, PVM/BVM, 일부 CRT 연결에서 필요할 수 있습니다.',
    valueGuideKo: booleanValueGuide,
    recommendedKo: '일반 HDMI 사용자는 보통 변경할 필요가 없습니다.',
    warningKo: '잘못 설정하면 화면이 나오지 않을 수 있습니다.',
    valueType: 'boolean',
    riskLevel: 'caution',
    category: 'video',
  }),
  vga_mode: entry({
    labelEn: 'VGA Mode',
    labelKo: 'VGA 모드',
    descriptionKo: 'VGA/아날로그 출력의 신호 형식을 정하는 설정입니다. 사용하는 케이블, IO 보드, 변환기, 디스플레이에 맞춰야 합니다.',
    whenToUseKo: '아날로그 출력 환경에서 케이블이나 디스플레이 입력 방식에 맞춰 조정합니다.',
    valueGuideKo: 'rgb, ypbpr, svideo, cvbs, dsub15 같은 값을 사용할 수 있습니다.',
    recommendedKo: '일반 HDMI 사용자는 보통 건드릴 필요가 없습니다. 아날로그 출력 환경에서만 설정을 확인하세요.',
    warningKo: '잘못 설정하면 화면이 나오지 않거나 색이 이상하게 보일 수 있습니다.',
    valueType: 'enum',
    allowedValues: [
      { value: 'rgb', labelKo: 'RGB' },
      { value: 'ypbpr', labelKo: 'YPbPr' },
      { value: 'svideo', labelKo: 'S-Video' },
      { value: 'cvbs', labelKo: 'Composite/CVBS' },
      { value: 'dsub15', labelKo: 'D-Sub 15' },
    ],
    riskLevel: 'caution',
    placeholder: 'rgb / ypbpr / svideo / cvbs / dsub15',
    category: 'video',
  }),
  vga_scaler: entry({
    labelEn: 'VGA Scaler',
    labelKo: 'VGA 스케일러',
    descriptionKo: 'VGA 출력에 스케일러 처리를 적용할지 정하는 설정입니다. 출력 장치가 어떤 해상도와 신호를 받을 수 있는지에 따라 필요 여부가 달라집니다.',
    whenToUseKo: 'VGA 또는 아날로그 출력에서 표시 방식이 맞지 않을 때 확인합니다.',
    valueGuideKo: booleanValueGuide,
    recommendedKo: '화면이 정상이라면 기존 값을 유지하세요.',
    warningKo: '아날로그 출력 환경에서는 화면 비율이나 표시 방식이 달라질 수 있습니다.',
    valueType: 'boolean',
    riskLevel: 'caution',
    category: 'video',
  }),
  hdmi_limited: entry({
    labelEn: 'HDMI Limited Range',
    labelKo: 'HDMI 제한 색 범위',
    descriptionKo: 'HDMI 색 범위를 제한 범위로 출력할지 정하는 설정입니다. TV와 PC 모니터는 기대하는 색 범위가 다를 수 있습니다.',
    whenToUseKo: '검은색이 뜨거나 흰색이 뭉개져 보이는 등 색 범위가 맞지 않을 때 확인합니다.',
    valueGuideKo: booleanValueGuide,
    recommendedKo: '검은색이 뜨거나 흰색이 뭉개져 보이면 바꿔볼 수 있습니다.',
    warningKo: '디스플레이 설정과 맞지 않으면 색이 흐리거나 과하게 보일 수 있습니다.',
    valueType: 'boolean',
    riskLevel: 'caution',
    category: 'video',
  }),
  forced_scandoubler: entry({
    labelEn: 'Forced Scandoubler',
    labelKo: '스캔더블러 강제',
    descriptionKo: 'VGA 출력에서 스캔더블러를 항상 사용하도록 강제하는 설정입니다. 낮은 해상도 신호를 일반 모니터가 받을 수 있는 형태로 올릴 때 사용됩니다.',
    whenToUseKo: 'VGA 또는 아날로그 출력에서 낮은 해상도 신호를 처리해야 할 때 확인합니다.',
    valueGuideKo: booleanValueGuide,
    recommendedKo: 'HDMI TV나 일반 HDMI 모니터를 쓰면 보통 변경할 필요가 없습니다.',
    warningKo: 'CRT, PVM, BVM, VGA 변환기, 아날로그 출력 환경에서는 화면 출력 방식이 달라질 수 있습니다.',
    valueType: 'boolean',
    riskLevel: 'caution',
    category: 'video',
  }),
  ypbpr: entry({
    labelEn: 'YPbPr Output',
    labelKo: 'YPbPr 출력',
    descriptionKo: '컴포넌트 비디오 출력 사용 여부를 조정합니다.',
    whenToUseKo: 'YPbPr 입력을 쓰는 디스플레이나 변환기를 사용할 때 확인합니다.',
    valueGuideKo: booleanValueGuide,
    recommendedKo: 'RGB/VGA와 혼동하지 않도록 케이블 구성을 먼저 확인하세요.',
    warningKo: '출력 방식이 다르면 색이 어긋나거나 화면이 나오지 않을 수 있습니다.',
    valueType: 'boolean',
    riskLevel: 'caution',
    category: 'video',
  }),
  ntsc_mode: entry({
    labelEn: 'NTSC Mode',
    labelKo: 'NTSC 모드',
    descriptionKo: 'S-Video나 Composite Video 출력에서 사용하는 NTSC/PAL 계열 컬러 방식을 정하는 설정입니다.',
    whenToUseKo: '아날로그 영상 출력에서 색상이나 표시 방식이 맞지 않을 때 확인합니다.',
    valueGuideKo: '0, 1, 2 같은 숫자 값으로 저장됩니다.',
    recommendedKo: '일반 HDMI 사용자는 변경할 필요가 없습니다.',
    warningKo: '아날로그 영상 출력에서 색상이나 표시 방식에 영향을 줄 수 있습니다.',
    valueType: 'enum',
    allowedValues: [
      { value: '0', labelKo: '값 0' },
      { value: '1', labelKo: '값 1' },
      { value: '2', labelKo: '값 2' },
    ],
    riskLevel: 'caution',
    category: 'video',
  }),
  key_menu_as_rgui: entry({
    labelEn: 'Menu Key as RGUI',
    labelKo: '메뉴 키 RGUI 동작',
    descriptionKo: 'MiSTer의 메뉴 키를 일부 코어에서 RGUI 키처럼 동작하게 하는 설정입니다. 특정 컴퓨터 계열 코어나 키보드 매핑에서 메뉴 키 동작을 맞출 때 사용합니다.',
    whenToUseKo: '특정 컴퓨터 계열 코어나 키보드 매핑에서 메뉴 키 동작을 맞출 때 확인합니다.',
    valueGuideKo: booleanValueGuide,
    recommendedKo: '일반적인 게임 실행 환경에서는 OFF를 유지하는 것이 안전합니다.',
    warningKo: '특정 코어에서 키 입력이 달라질 수 있습니다.',
    valueType: 'boolean',
    category: 'controller',
  }),
  menu_pal: entry({
    labelEn: 'Menu PAL',
    labelKo: 'PAL 메뉴',
    descriptionKo: 'MiSTer 메뉴 화면을 PAL 방식으로 표시할지 정하는 설정입니다.',
    whenToUseKo: '특정 PAL 디스플레이 환경에서 메뉴 화면 표시를 맞출 때 확인합니다.',
    valueGuideKo: booleanValueGuide,
    recommendedKo: '일반적인 HDMI 환경에서는 OFF를 유지하는 것이 안전합니다.',
    warningKo: '특정 PAL 디스플레이 환경에서만 필요할 수 있습니다.',
    valueType: 'boolean',
    category: 'video',
  }),
  hdmi_audio_96k: entry({
    labelEn: 'HDMI Audio 96k',
    labelKo: 'HDMI 오디오 96kHz',
    descriptionKo: 'HDMI 오디오 샘플링을 96kHz로 출력할지 정하는 설정입니다.',
    whenToUseKo: 'HDMI 오디오 장비가 96kHz를 지원하고 호환성을 확인할 수 있을 때만 사용합니다.',
    valueGuideKo: booleanValueGuide,
    recommendedKo: 'TV, 캡처카드, 오디오 장비 호환성을 우선하면 기존 값을 유지하세요.',
    warningKo: '일부 장비는 48kHz 쪽이 더 안정적일 수 있습니다.',
    valueType: 'boolean',
    riskLevel: 'caution',
    category: 'audio',
  }),
  keyrah_mode: entry({
    labelEn: 'Keyrah Mode',
    labelKo: '키라 모드',
    descriptionKo: 'Keyrah 같은 특수 키보드 어댑터를 사용할 때 장치 식별값을 지정하는 설정입니다.',
    whenToUseKo: 'Keyrah 같은 특수 키보드 어댑터를 실제로 사용할 때만 확인합니다.',
    valueGuideKo: '예: 0x18d80002 같은 형식입니다.',
    recommendedKo: '해당 장치를 쓰지 않는다면 변경하지 마세요.',
    warningKo: '잘못된 값을 넣으면 키보드 입력이 기대와 다르게 동작할 수 있습니다.',
    valueType: 'hex',
    examples: ['0x18d80002'],
    placeholder: '예: 0x18d80002',
    category: 'controller',
  }),
  rbf_hide_datecode: entry({
    labelEn: 'RBF Hide Datecode',
    labelKo: 'RBF 날짜 코드 숨김',
    descriptionKo: '코어 파일명에 포함된 날짜 코드 표시를 숨길지 정하는 설정입니다.',
    whenToUseKo: '코어 목록이나 메뉴 표시를 더 깔끔하게 보고 싶을 때 확인합니다.',
    valueGuideKo: booleanValueGuide,
    recommendedKo: '메뉴를 깔끔하게 보고 싶으면 ON, 코어 버전 정보를 확인하고 싶으면 OFF를 사용하세요.',
    valueType: 'boolean',
    category: 'network-system',
  }),
  hdr: entry({
    labelEn: 'HDR',
    labelKo: 'HDR',
    descriptionKo: 'HDR 출력을 사용할지 정하는 설정입니다.',
    whenToUseKo: 'HDR을 지원하는 디스플레이에서 색 표현을 확인할 수 있을 때만 사용합니다.',
    valueGuideKo: booleanValueGuide,
    recommendedKo: 'HDR을 지원하는 디스플레이를 사용하고, 색 표현이 정상인지 확인할 수 있을 때만 사용하세요.',
    warningKo: '일부 디스플레이나 캡처 장비에서는 색이 부정확하게 보일 수 있습니다.',
    valueType: 'boolean',
    riskLevel: 'caution',
    category: 'video',
  }),
  fb_size: entry({
    labelEn: 'Framebuffer Size',
    labelKo: '프레임버퍼 크기',
    descriptionKo: 'Linux framebuffer 크기를 조정하는 설정입니다. 메뉴, 터미널, 일부 화면 표시 방식에 영향을 줄 수 있습니다.',
    whenToUseKo: '메뉴, 터미널, 일부 화면 표시 방식이 맞지 않을 때 확인합니다.',
    valueGuideKo: '0은 자동값으로 사용할 수 있습니다. 다른 숫자 값은 크기 또는 축소 비율로 동작할 수 있습니다.',
    recommendedKo: '일반 사용자는 자동값을 유지하세요.',
    valueType: 'enum',
    allowedValues: [
      { value: '0', labelKo: '값 0' },
      { value: '1', labelKo: '값 1' },
      { value: '2', labelKo: '값 2' },
      { value: '4', labelKo: '값 4' },
    ],
    category: 'video',
  }),
  fb_terminal: entry({
    labelEn: 'Framebuffer Terminal',
    labelKo: '프레임버퍼 터미널',
    descriptionKo: 'framebuffer terminal 표시 여부를 정하는 설정입니다.',
    whenToUseKo: '부팅 또는 터미널 표시가 필요한 환경에서만 확인합니다.',
    valueGuideKo: booleanValueGuide,
    recommendedKo: '일반 사용자는 기존 값을 유지하세요.',
    valueType: 'boolean',
    category: 'network-system',
  }),
  bootcore: entry({
    labelEn: 'Boot Core',
    labelKo: '부팅 코어',
    descriptionKo: 'MiSTer 시작 시 자동으로 실행할 코어 후보를 지정합니다.',
    whenToUseKo: '앱 시작 후 특정 코어로 바로 들어가고 싶을 때 사용합니다.',
    valueGuideKo: '코어 파일 경로나 이름 형식은 현재 INI 주석과 설치 구조를 확인하세요.',
    valueType: 'text',
    placeholder: '예: _Console/NES',
    category: 'network-system',
  }),
  bootrom: entry({
    labelEn: 'Boot ROM',
    labelKo: '부팅 ROM',
    descriptionKo: '부팅 코어와 함께 사용할 ROM 후보를 지정합니다.',
    whenToUseKo: '특정 게임/ROM으로 바로 시작하는 흐름을 만들 때 확인합니다.',
    valueGuideKo: 'ROM 경로는 MiSTer 파일 구조와 일치해야 합니다.',
    valueType: 'text',
    placeholder: '예: /media/fat/games/...',
    category: 'network-system',
  }),
  osd_timeout: entry({
    labelEn: 'OSD Timeout',
    labelKo: 'OSD 표시 시간',
    descriptionKo: 'OSD가 자동으로 닫히는 시간을 조정합니다.',
    whenToUseKo: '메뉴가 너무 빨리 닫히거나 오래 남아 있을 때 조정합니다.',
    valueGuideKo: '숫자 값을 사용합니다. 단위와 정확한 의미는 INI 주석을 확인하세요.',
    valueType: 'number',
    placeholder: '예: 30',
    category: 'network-system',
  }),
  font: entry({
    labelEn: 'Font',
    labelKo: 'OSD 글꼴',
    descriptionKo: 'OSD에서 사용할 글꼴 파일 또는 이름을 지정합니다.',
    whenToUseKo: 'OSD 글꼴을 바꾸고 싶을 때 사용합니다.',
    valueGuideKo: '설치된 글꼴 파일명/경로와 일치해야 합니다.',
    valueType: 'text',
    category: 'other',
  }),
  gamma: entry({
    labelEn: 'Gamma',
    labelKo: '감마',
    descriptionKo: '화면 감마 값을 조정합니다.',
    whenToUseKo: '화면이 너무 어둡거나 밝게 느껴질 때 조정합니다.',
    valueGuideKo: '숫자 값을 사용합니다. 디스플레이에 따라 적정값이 다릅니다.',
    valueType: 'number',
    placeholder: '예: 1.0',
    category: 'video',
  }),
  volume: entry({
    labelEn: 'Volume',
    labelKo: '기본 볼륨',
    descriptionKo: 'MiSTer 기본 오디오 볼륨 값을 지정합니다.',
    whenToUseKo: '부팅 후 기본 볼륨이 너무 크거나 작을 때 조정합니다.',
    valueGuideKo: '숫자 값을 사용합니다. 너무 큰 값은 장비에 따라 불편할 수 있습니다.',
    valueType: 'number',
    placeholder: '예: 70',
    category: 'audio',
  }),
  refresh_min: entry({
    labelEn: 'Refresh Min',
    labelKo: '최소 주사율',
    descriptionKo: '가변 주사율 환경에서 사용할 최소 주사율을 지정하는 설정입니다.',
    whenToUseKo: 'VRR이나 특수 출력 환경에서 표시 장치가 처리할 수 있는 하한을 맞춰야 할 때만 조정합니다.',
    valueGuideKo: '숫자 값으로 저장됩니다.',
    recommendedKo: 'VRR이나 특수 출력 환경을 쓰지 않는다면 기존 값을 유지하세요.',
    valueType: 'number',
    range: { min: 0, unit: 'Hz' },
    placeholder: '예: 50',
    category: 'video',
  }),
  refresh_max: entry({
    labelEn: 'Refresh Max',
    labelKo: '최대 주사율',
    descriptionKo: '가변 주사율 환경에서 사용할 최대 주사율을 지정하는 설정입니다.',
    whenToUseKo: 'VRR이나 특수 출력 환경에서 표시 장치가 처리할 수 있는 상한을 맞춰야 할 때만 조정합니다.',
    valueGuideKo: '숫자 값으로 저장됩니다.',
    recommendedKo: 'VRR이나 특수 출력 환경을 쓰지 않는다면 기존 값을 유지하세요.',
    valueType: 'number',
    range: { min: 0, unit: 'Hz' },
    placeholder: '예: 60',
    category: 'video',
  }),
};

export function helpForIniKey(key: string) {
  return iniHelpCatalog[String(key || '').trim().toLowerCase()];
}
