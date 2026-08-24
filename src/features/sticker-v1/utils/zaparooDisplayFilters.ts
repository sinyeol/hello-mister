import type { ZaparooLibraryEntry } from '@sticker-v1/types';
import { normalizeName } from '@sticker-v1/utils/normalizeName';

const nonPlayableKinds = new Set(['bios', 'firmware', 'system']);
const nonPlayablePathTokens = new Set(['bios', 'boot', 'firmware', 'system', 'updates', 'cheats', 'saves']);

export function isBiosLikeEntry(entry: ZaparooLibraryEntry) {
  if (entry.bios || entry.firmware || entry.systemFile || entry.ignored) return true;
  if (nonPlayableKinds.has(String(entry.kind))) return true;
  const pathParts = normalizeName(`${entry.folderName} ${entry.relativePath} ${entry.absolutePath}`)
    .split(' ')
    .filter(Boolean);
  return pathParts.some((part) => nonPlayablePathTokens.has(part));
}

export function isPlayableLibraryEntry(entry: ZaparooLibraryEntry) {
  if (isBiosLikeEntry(entry)) return false;
  if (entry.playable === true) return true;
  if (entry.playable === false) return false;
  return entry.launchReady !== false;
}

export function platformHasPlayableEntry(entries: ZaparooLibraryEntry[]) {
  return entries.some(isPlayableLibraryEntry);
}

export function platformPlayableStats(entries: ZaparooLibraryEntry[]) {
  const playableCount = entries.filter(isPlayableLibraryEntry).length;
  const nonPlayableCount = entries.length - playableCount;
  const biosSystemCount = entries.filter(isBiosLikeEntry).length;
  return {
    playableCount,
    nonPlayableCount,
    biosSystemCount,
    hiddenReason: playableCount === 0 ? 'no playable game entries' : undefined,
  };
}
