import type { ControllerConfigFile, ControllerConfigFileType, ControllerPreset } from '../../types/controllers';

export const controllerCandidatePaths = [
  '/media/fat',
  '/media/fat/config',
  '/media/fat/config/inputs',
  '/media/fat/config/input',
  '/media/fat/config/joystick',
  '/media/fat/config/joysticks',
  '/media/fat/config/controllers',
  '/media/fat/config/gamecontrollerdb',
  '/media/fat/Scripts',
] as const;

export const controllerBackupRoot = '/media/fat/.hello-mister-backups/controllers';
export const controllerTrashRoot = '/media/fat/.hello-mister-trash/controllers';

export function classifyControllerFile(fileName: string, folderPath = ''): { type: ControllerConfigFileType; label: string } {
  const haystack = `${folderPath}/${fileName}`.toLowerCase();
  if (/gamecontrollerdb/.test(haystack)) return { type: 'gamecontrollerdb', label: 'GameControllerDB' };
  if (/scripts/.test(haystack)) return { type: 'script', label: '스크립트 참고 파일' };
  if (/\.(map)$/i.test(fileName) || /joystick/.test(haystack)) return { type: 'joystick-map', label: '조이스틱 매핑' };
  if (/core|_input|input_/.test(haystack)) return { type: 'core-input', label: '코어별 입력 설정' };
  if (/input|controller/.test(haystack)) return { type: 'global-input', label: '기본 입력 설정' };
  return { type: 'other-config', label: '기타 설정 파일' };
}

export function isControllerCandidateFileName(fileName: string) {
  return (
    /^gamecontrollerdb/i.test(fileName)
    || /controller/i.test(fileName)
    || /joystick/i.test(fileName)
    || /input/i.test(fileName)
    || /\.(map|cfg|ini|txt)$/i.test(fileName)
  );
}

export function canRestoreControllerTarget(file: Pick<ControllerConfigFile, 'path'>) {
  return file.path.startsWith('/media/fat/config/');
}

export function controllerFileSortValue(file: ControllerConfigFile) {
  const typeOrder: Record<ControllerConfigFileType, number> = {
    gamecontrollerdb: 0,
    'global-input': 1,
    'core-input': 2,
    'joystick-map': 3,
    script: 4,
    'other-config': 5,
  };
  return `${typeOrder[file.type]}:${file.path.toLowerCase()}`;
}

export const controllerPresetList: ControllerPreset[] = [
  {
    presetId: 'neogeo-4-button',
    name: 'NeoGeo 4버튼',
    description: 'A/B/C/D 중심의 4버튼 아케이드 배열을 위한 프리셋 구조입니다.',
    targetSystem: 'NeoGeo',
    buttonLayout: ['A', 'B', 'C', 'D'],
    notes: '실제 적용은 대상 mapping 파일 구조가 확인된 뒤 활성화합니다.',
    status: 'blocked-unverified-file-structure',
  },
  {
    presetId: 'cps-6-button',
    name: 'CPS 6버튼',
    description: '약/중/강 펀치와 킥을 나누는 6버튼 격투 게임 배열 구조입니다.',
    targetSystem: 'CPS',
    buttonLayout: ['LP', 'MP', 'HP', 'LK', 'MK', 'HK'],
    notes: '파일 구조 확인 전에는 적용하지 않고 설명/구조만 표시합니다.',
    status: 'blocked-unverified-file-structure',
  },
  {
    presetId: 'console-pad',
    name: 'Console Pad',
    description: '방향키, ABXY, Start/Select 중심의 일반 콘솔 패드 배열 구조입니다.',
    targetSystem: 'Console',
    buttonLayout: ['D-Pad', 'A', 'B', 'X', 'Y', 'L', 'R', 'Start', 'Select'],
    notes: '코어별 mapping 포맷이 확인되면 안전한 적용 adapter로 분리합니다.',
    status: 'blocked-unverified-file-structure',
  },
];
