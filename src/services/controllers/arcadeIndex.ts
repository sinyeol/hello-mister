import { controllerDesktopService } from './controllerDesktopService';
import type { ArcadeGameMeta } from '../../types/controllers';

// Arcade game index (setname → {name, count, names}) cached in memory + localStorage. Building it scans all MRAs once
// (~15s); afterwards lookups are instant and survive restarts. MRAs rarely change, so a manual rebuild is enough.
const STORAGE_KEY = 'hello-mister-v2:arcade-index-v2';
let memoryCache: Record<string, ArcadeGameMeta> | null = null;

export function getCachedArcadeIndex(): Record<string, ArcadeGameMeta> | null {
  if (memoryCache) return memoryCache;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) { memoryCache = JSON.parse(raw) as Record<string, ArcadeGameMeta>; return memoryCache; }
  } catch { /* ignore */ }
  return null;
}

export async function buildArcadeIndex(profileId: string | undefined): Promise<{ ok: boolean; count: number; message: string }> {
  const result = await controllerDesktopService.readArcadeIndex(profileId);
  if (result.ok) {
    memoryCache = result.index;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(result.index)); } catch { /* ignore */ }
    return { ok: true, count: Object.keys(result.index).length, message: result.message };
  }
  return { ok: false, count: 0, message: result.message };
}

export function lookupArcadeMeta(game: string): ArcadeGameMeta | undefined {
  const index = getCachedArcadeIndex();
  return index ? index[game.toLowerCase()] : undefined;
}

export function lookupArcadeNames(game: string): string[] | undefined {
  return lookupArcadeMeta(game)?.names;
}
