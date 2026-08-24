import type { GameEntry } from '@sticker-v1/types';

const gamesStorageKey = 'zaparoo.games.v1';

export function loadPersistedGames(fallback: GameEntry[]) {
  try {
    const parsed = JSON.parse(localStorage.getItem(gamesStorageKey) ?? '[]') as GameEntry[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function persistGames(games: GameEntry[]) {
  localStorage.setItem(gamesStorageKey, JSON.stringify(games));
}
