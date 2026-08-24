export interface MisterScriptCatalogEntry {
  title: string;
  description: string;
  /** Likely long-running (downloads / updates) — the UI offers a background run mode. */
  long?: boolean;
}

// Descriptions for well-known MiSTer Scripts. Keyed by lowercased file name.
export const misterScriptCatalog: Record<string, MisterScriptCatalogEntry> = {
  'update_all.sh': {
    title: 'Update All',
    description: 'MiSTer를 통째로 최신으로 맞추는 대표 스크립트입니다. 코어/메뉴(distribution_mister), 아케이드 MRA, BIOS, 치트, 게임 목록, 배경 등 update_all.ini에서 켜둔 항목을 한 번에 내려받아 동기화합니다. 내려받을 양에 따라 수십 분~수 시간이 걸릴 수 있어 백그라운드 실행을 권장합니다.',
    long: true,
  },
  'update.sh': {
    title: 'Update (기본)',
    description: 'MiSTer 기본 업데이트 스크립트입니다. distribution_mister 저장소에서 코어와 메뉴를 내려받아 업데이트합니다.',
    long: true,
  },
  'downloader.sh': {
    title: 'Downloader',
    description: 'downloader.ini 설정을 기준으로 코어/파일을 내려받아 SD카드를 동기화하는 엔진입니다. update_all 내부에서도 사용됩니다.',
    long: true,
  },
  'update_cheats.sh': {
    title: '치트 업데이트',
    description: '게임 치트 파일(.cht)을 내려받아 /media/fat/Cheats를 업데이트합니다.',
    long: true,
  },
  'update_arcade-roms.sh': {
    title: '아케이드 롬 업데이트',
    description: 'MRA가 참조하는 아케이드 롬을 내려받아 채웁니다(저작권 정책에 따라 동작).',
    long: true,
  },
  'update_names-txt.sh': {
    title: '코어 이름표 업데이트',
    description: '메뉴에 표시되는 코어/시스템 이름표(names.txt)를 내려받아 갱신합니다.',
  },
  'ini_settings.sh': {
    title: 'INI 설정 도우미',
    description: 'MiSTer.ini 옵션을 텍스트 메뉴로 고르며 편집하는 스크립트입니다(원래는 미스터 콘솔 UI용). 이 앱의 INI 설정 메뉴로도 같은 작업을 할 수 있습니다.',
  },
  'wifi.sh': {
    title: 'Wi-Fi 설정',
    description: 'MiSTer의 무선 네트워크(SSID/비밀번호)를 설정하는 스크립트입니다.',
  },
  'timezone.sh': {
    title: '시간대 설정',
    description: 'MiSTer의 시간대(타임존)를 설정합니다.',
  },
  'samba_on.sh': {
    title: 'Samba 켜기',
    description: 'SMB 파일 공유를 활성화해 PC에서 /media/fat에 접근할 수 있게 합니다.',
  },
  'fast_USB_polling_on.sh': {
    title: 'USB 폴링 빠르게',
    description: 'USB 컨트롤러 폴링 속도를 높여 입력 지연을 줄입니다.',
  },
};

export function lookupScriptCatalog(fileName: string): MisterScriptCatalogEntry | undefined {
  return misterScriptCatalog[fileName.toLowerCase()];
}

export interface RecommendedScript {
  fileName: string;
  title: string;
  description: string;
  url: string;
  source: string;
  long?: boolean;
}

// Curated, well-known MiSTer scripts that can be downloaded straight into /media/fat/Scripts. URLs are limited to
// GitHub (validated on the backend). Descriptions are in Korean.
export const recommendedScripts: RecommendedScript[] = [
  {
    fileName: 'update_all.sh',
    title: 'Update All',
    description: 'MiSTer를 통째로 최신으로 맞추는 가장 인기 있는 스크립트입니다. 코어/메뉴, 아케이드 MRA, 치트, 게임 목록 등을 한 번에 내려받아 동기화합니다. 설치 후 update_all.ini로 받을 항목을 고를 수 있습니다.',
    url: 'https://raw.githubusercontent.com/theypsilon/Update_All_MiSTer/master/update_all.sh',
    source: 'theypsilon/Update_All_MiSTer',
    long: true,
  },
  {
    fileName: 'ini_settings.sh',
    title: 'INI 설정 도우미',
    description: 'MiSTer.ini의 주요 옵션을 텍스트 메뉴로 고르며 설정하는 공식 스크립트입니다(미스터 콘솔용).',
    url: 'https://raw.githubusercontent.com/MiSTer-devel/Scripts_MiSTer/master/ini_settings.sh',
    source: 'MiSTer-devel/Scripts_MiSTer',
  },
  {
    // Scripts_MiSTer 루트에서 other_authors/ 로 이동됨 — 루트 URL은 404.
    fileName: 'wifi.sh',
    title: 'Wi-Fi 설정',
    description: 'MiSTer의 무선 네트워크(SSID/비밀번호)를 설정하는 공식 스크립트입니다.',
    url: 'https://raw.githubusercontent.com/MiSTer-devel/Scripts_MiSTer/master/other_authors/wifi.sh',
    source: 'MiSTer-devel/Scripts_MiSTer',
  },
  {
    fileName: 'timezone.sh',
    title: '시간대 설정',
    description: 'MiSTer의 시간대(타임존)를 설정해 시계를 맞춥니다.',
    url: 'https://raw.githubusercontent.com/MiSTer-devel/Scripts_MiSTer/master/timezone.sh',
    source: 'MiSTer-devel/Scripts_MiSTer',
  },
  {
    fileName: 'samba_on.sh',
    title: 'Samba 파일 공유 켜기',
    description: 'SMB 공유를 켜서 PC 탐색기에서 /media/fat에 바로 접근할 수 있게 합니다.',
    url: 'https://raw.githubusercontent.com/MiSTer-devel/Scripts_MiSTer/master/samba_on.sh',
    source: 'MiSTer-devel/Scripts_MiSTer',
  },
  {
    // Scripts_MiSTer 루트에서 other_authors/ 로 이동됨 — 루트 URL은 404.
    fileName: 'fast_USB_polling_on.sh',
    title: 'USB 폴링 빠르게',
    description: 'USB 컨트롤러 폴링 속도를 높여 입력 지연을 줄입니다.',
    url: 'https://raw.githubusercontent.com/MiSTer-devel/Scripts_MiSTer/master/other_authors/fast_USB_polling_on.sh',
    source: 'MiSTer-devel/Scripts_MiSTer',
  },
];

// License/legal/setup boilerplate that should NOT be shown as a "description".
const SCRIPT_NOISE = /(free software|redistribute|gnu|general public license|public license|without any warranty|warranty|merchantability|fitness for a particular|foundation|copyright|\(c\)|all rights reserved|either version|at your option|should have received|<http|licenses\/?>|version \d+ of the license|terms of the|this program is|distributed in the hope|along with this program|spdx-license|^author\b|^license\b|^set [-+]|^export\b|^#!\/)/i;

// Best-effort description from a shell script's top comments, skipping license/legal/setup boilerplate.
export function scriptHeaderComment(content: string): string {
  const lines = content.split('\n');
  const collected: string[] = [];
  for (let index = 0; index < lines.length && index < 80; index += 1) {
    const raw = lines[index];
    if (index === 0 && raw.startsWith('#!')) continue;
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    if (!trimmed.startsWith('#')) {
      if (collected.length > 0) break; // reached real code after collecting a description
      continue;
    }
    const text = trimmed.replace(/^#+/, '').replace(/[-=*_~#]{3,}/g, '').trim();
    if (!text || SCRIPT_NOISE.test(text)) continue;
    collected.push(text);
    if (collected.join(' ').length > 500) break;
  }
  return collected.join('\n').slice(0, 800);
}

export function isLikelyLongScript(fileName: string, catalog?: MisterScriptCatalogEntry): boolean {
  if (catalog?.long) return true;
  return /(update|download|install)/i.test(fileName);
}
