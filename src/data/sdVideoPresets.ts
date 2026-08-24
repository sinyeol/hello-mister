// 새 SD 카드 설치 마법사용 영상 출력 프리셋.
// 카드의 FAT 루트에 MiSTer.ini 로 기록된다. 값은 공식 MiSTer 문서 기준
// (advanced/ini, advanced/crt). 기존 src/data/iniPresets.ts 는 전부 TODO 라 여기서 실제 값을 정의한다.
//
// 아날로그 출력(15kHz RGB/컴포넌트/S-Video/컴포지트)은 MiSTer 아날로그 I/O 보드가 필요하다.
// Direct Video는 전용 HDMI→아날로그(AG62xx) 어댑터로 아날로그 보드 없이 출력한다.

export interface SdVideoPreset {
  id: string;
  group: string;
  name: string;
  summary: string;
  warning?: string;
  iniLines: string[];
}

export const sdVideoPresets: SdVideoPreset[] = [
  // ── HDMI (평면 LCD/TV) ────────────────────────────────────────────────
  {
    id: 'hdmi',
    group: 'HDMI · 평면 LCD TV/모니터',
    name: 'HDMI 일반 (기본)',
    summary: '대부분의 HDMI TV·모니터. 디지털 표준 출력으로 화면이 자동으로 맞춰집니다.',
    iniLines: ['vga_scaler=0', 'direct_video=0', 'forced_scandoubler=0', 'vsync_adjust=0'],
  },
  {
    id: 'hdmi-1080p',
    group: 'HDMI · 평면 LCD TV/모니터',
    name: 'HDMI 강제 1080p60 (싱크 안 맞을 때)',
    summary: 'HDMI인데 화면이 안 뜨거나 깨지면 표준 1080p60으로 고정합니다. (720p가 필요하면 저장 후 video_mode를 0으로)',
    iniLines: ['vga_scaler=0', 'direct_video=0', 'forced_scandoubler=0', 'video_mode=8', 'vsync_adjust=0'],
  },

  // ── 방송용·프로 모니터 (15kHz RGB, 아날로그 I/O 보드) ──────────────────
  {
    id: 'pvm-bvm-rgbs',
    group: '방송용·프로 모니터 (15kHz RGB · 아날로그 보드)',
    name: 'Sony PVM / BVM · RGBS (BNC)',
    summary: 'Sony PVM(14M2·20L5·9044 등)·BVM, JVC·Ikegami·Panasonic 방송 모니터의 RGBS(동기 합성) BNC 입력. 가장 흔한 프로 모니터 연결.',
    warning: '아날로그 I/O 보드 + RGBS 케이블(VGA→BNC, 3×RGB+Sync) 필요.',
    iniLines: ['vga_scaler=0', 'vga_mode=rgb', 'forced_scandoubler=0', 'composite_sync=1'],
  },
  {
    id: 'pro-rgbhv',
    group: '방송용·프로 모니터 (15kHz RGB · 아날로그 보드)',
    name: '프로 모니터 · RGBHV (별도 H/V 싱크)',
    summary: '동기를 따로 받는(H/V 분리) 모니터용. 대부분의 PVM/BVM은 위의 RGBS를 쓰고, 모니터가 H·V 싱크를 따로 요구할 때만 이것.',
    warning: '아날로그 I/O 보드 필요. 모니터가 분리 동기(RGBHV)를 지원해야 함.',
    iniLines: ['vga_scaler=0', 'vga_mode=rgb', 'forced_scandoubler=0', 'composite_sync=0'],
  },

  // ── 가정용 브라운관 TV (아날로그 I/O 보드) ────────────────────────────
  {
    id: 'scart-rgb',
    group: '가정용 브라운관 TV (아날로그 보드)',
    name: 'RGB SCART TV (유럽/PAL Trinitron 등)',
    summary: 'RGB SCART 입력 가정용 브라운관(Sony Trinitron KV·Philips 등). 15kHz 순수 RGB로 가장 좋은 화질.',
    warning: '아날로그 I/O 보드 + RGB SCART 케이블 필요.',
    iniLines: ['vga_scaler=0', 'vga_mode=rgb', 'forced_scandoubler=0', 'composite_sync=1'],
  },
  {
    id: 'component-ypbpr',
    group: '가정용 브라운관 TV (아날로그 보드)',
    name: '컴포넌트(YPbPr) HDTV·브라운관',
    summary: '컴포넌트(적/녹/청 RCA) 입력 TV. Sony WEGA·HD 브라운관, 컴포넌트 EDTV/HDTV 등.',
    warning: '아날로그 보드의 Sync-on-Green 스위치 ON 필요(보드 v6+는 자동). composite_sync는 끕니다.',
    iniLines: ['vga_scaler=0', 'vga_mode=ypbpr', 'forced_scandoubler=0', 'composite_sync=0', 'vga_sog=1'],
  },
  {
    id: 'svideo',
    group: '가정용 브라운관 TV (아날로그 보드)',
    name: 'S-Video 가정용 TV',
    summary: 'S-Video 입력 가정용 TV. RGB/컴포넌트가 없을 때 차선책(컴포지트보다 선명).',
    warning: '아날로그 I/O 보드 필요.',
    iniLines: ['vga_scaler=0', 'vga_mode=svideo', 'forced_scandoubler=0', 'composite_sync=1', 'ntsc_mode=0'],
  },
  {
    id: 'cvbs',
    group: '가정용 브라운관 TV (아날로그 보드)',
    name: '컴포지트 (노란 RCA) TV',
    summary: '컴포지트(노란 RCA) 입력 가정용 TV. 가장 기본이지만 화질은 가장 낮습니다.',
    warning: '아날로그 I/O 보드 필요. 화질상 권장하지 않습니다(가능하면 RGB/S-Video).',
    iniLines: ['vga_scaler=0', 'vga_mode=cvbs', 'forced_scandoubler=0', 'composite_sync=1', 'ntsc_mode=0'],
  },

  // ── PC·멀티싱크 CRT ───────────────────────────────────────────────────
  {
    id: 'vga-31khz',
    group: 'PC·멀티싱크 CRT',
    name: 'VGA / 멀티싱크 31kHz (RGBHV)',
    summary: 'PC용 VGA·멀티싱크 모니터(Sony Multiscan·GDM, NEC MultiSync, Dell/Iiyama 등). 31kHz 스캔더블 RGB.',
    warning: '아날로그 I/O 보드 또는 HDMI→VGA(Direct Video) 어댑터 필요.',
    iniLines: ['vga_scaler=0', 'vga_mode=rgb', 'forced_scandoubler=1', 'composite_sync=0'],
  },
  {
    id: 'multisync-15k',
    group: 'PC·멀티싱크 CRT',
    name: '멀티싱크 15kHz 네이티브 (NEC XM 등)',
    summary: '15kHz까지 받는 멀티싱크/아케이드 모니터(NEC XM29 등)에 네이티브 240p RGBS로 출력.',
    warning: '아날로그 I/O 보드 필요. 모니터가 15kHz RGBS를 지원해야 합니다.',
    iniLines: ['vga_scaler=0', 'vga_mode=rgb', 'forced_scandoubler=0', 'composite_sync=1'],
  },

  // ── Direct Video (HDMI→어댑터, 아날로그 보드 없이) ────────────────────
  {
    id: 'dv-15khz',
    group: 'Direct Video (HDMI→어댑터, 아날로그 보드 없이)',
    name: 'Direct Video → 15kHz 브라운관',
    summary: '아날로그 보드 없이 전용 HDMI→VGA/RGB 어댑터로 15kHz 브라운관(PVM/SCART TV 등)에 출력.',
    warning: '⚠ 전용 Direct Video 어댑터(AG62xx) 필요. 일반 HDMI TV에서는 화면이 전혀 안 나옵니다.',
    iniLines: ['vga_scaler=0', 'direct_video=1', 'forced_scandoubler=0', 'composite_sync=1'],
  },
  {
    id: 'dv-31khz',
    group: 'Direct Video (HDMI→어댑터, 아날로그 보드 없이)',
    name: 'Direct Video → 31kHz 모니터',
    summary: '아날로그 보드 없이 전용 어댑터로 31kHz VGA/멀티싱크 모니터에 스캔더블 출력.',
    warning: '⚠ 전용 Direct Video 어댑터 필요. 일반 HDMI TV에서는 화면이 안 나옵니다.',
    iniLines: ['vga_scaler=0', 'direct_video=1', 'forced_scandoubler=1', 'composite_sync=0'],
  },
];

export function buildMisterIni(preset: SdVideoPreset): string {
  // 아날로그/Direct Video 출력(스케일러를 안 거치는 raw 출력, vga_scaler=0)에서는 프레임버퍼 터미널을
  // 화면에 띄울 수 없어 MiSTer가 "If you see this, then you need to modify MiSTer.ini (fb_terminal=0 …)"
  // 경고 화면을 보여준다. 그래서 CRT/아날로그 프리셋에는 fb_terminal=0을 넣어 이 경고를 없앤다.
  // (HDMI는 스케일러로 터미널이 정상 표시되므로 그대로 둔다.)
  const isHdmi = preset.group.startsWith('HDMI');
  const lines = isHdmi ? preset.iniLines : [...preset.iniLines, 'fb_terminal=0'];
  return [
    '[MiSTer]',
    `; Hello Mister 설치 마법사 생성 — 영상 출력: ${preset.name}`,
    ...lines,
    '',
  ].join('\r\n');
}
