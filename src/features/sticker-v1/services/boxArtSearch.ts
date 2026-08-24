// Web image / box-art search sources for the card editor. Each source opens an external
// browser search for the game title so the user can find and download front box art.
// Verified search URL formats (2026-06): Google Images, LaunchBox Games Database
// (/games/results/<name>), SteamGridDB (?term=), TheGamesDB (?name=).

export interface BoxArtSearchSource {
  id: string;
  label: string;
  hint: string;
  build: (query: string) => string;
}

const knownExtensions = /\.(mra|sfc|smc|nes|md|gen|bin|gb|gbc|gba|n64|z64|pce|ws|wsc|ngp|ngc|lnx|a26|a52|a78|col|sms|gg|neo|zip|chd|cue|iso|rom|eZ\d|mgl)$/i;

/** Strip region/version parens, bracketed groups, extensions and underscores for cleaner web search. */
export function cleanGameTitleForSearch(title: string | undefined): string {
  if (!title) return '';
  return title
    .replace(knownExtensions, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export const BOX_ART_SEARCH_SOURCES: BoxArtSearchSource[] = [
  {
    id: 'google-images',
    label: 'Google 이미지',
    hint: '게임명으로 박스아트 이미지 검색',
    build: (q) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`${q} game box art`)}`,
  },
  {
    id: 'launchbox',
    label: 'LaunchBox DB',
    hint: '프론트 박스아트 다운로드 (LaunchBox Games Database)',
    build: (q) => `https://gamesdb.launchbox-app.com/games/results/${encodeURIComponent(q)}`,
  },
  {
    id: 'steamgriddb',
    label: 'SteamGridDB',
    hint: '박스아트/그리드 이미지 다운로드',
    build: (q) => `https://www.steamgriddb.com/search/grids?term=${encodeURIComponent(q)}`,
  },
  {
    id: 'thegamesdb',
    label: 'TheGamesDB',
    hint: '플랫폼별 박스아트 DB',
    build: (q) => `https://thegamesdb.net/search.php?name=${encodeURIComponent(q)}`,
  },
];

/** Open a URL in the user's default browser (Electron shell), falling back to a new tab in the browser dev build. */
export async function openExternalSearchUrl(url: string): Promise<void> {
  const api = typeof window !== 'undefined' ? window.helloMisterDesktop : undefined;
  if (api?.openExternalUrl) {
    try {
      await api.openExternalUrl(url);
      return;
    } catch {
      // fall through to window.open
    }
  }
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
