import { normalizeName } from '@sticker-v1/utils/normalizeName';

// Ranking for the card album's "connect this card to a game" picker. A card whose stored link broke still knows
// where it used to point (platform, system, path, title), so candidates are ranked by how close they are to THAT
// card instead of alphabetically. Without this a broken card opens a 30,000-entry list sorted by title.

export interface CardLinkTargetInfo {
  title?: string;
  systemId?: string;
  platformGroup?: string;
  absolutePath?: string;
  relativePath?: string;
}

// Structural subset of ZaparooLibraryEntry, so this module stays free of library/store imports and testable.
export interface CardLinkCandidateEntry {
  id: string;
  title: string;
  systemId: string;
  platformGroup: string;
  relativePath: string;
  absolutePath: string;
  romName?: string;
}

export interface RankedCardLinkCandidate<T extends CardLinkCandidateEntry> {
  entry: T;
  score: number;
  /** Short Korean labels shown as chips so the user can see WHY a candidate is near the top. */
  reasons: string[];
}

function fileName(path: string | undefined) {
  if (!path) return '';
  return path.split('/').pop()?.trim().toLowerCase() ?? '';
}

function lower(value: string | undefined) {
  return (value ?? '').trim().toLowerCase();
}

function titleTokens(value: string | undefined) {
  return new Set(normalizeName(value ?? '').split(' ').filter((token) => token.length > 1));
}

// Similarity between one library entry and the card's stored link target. Path equality is decisive, then file
// name, then title, then platform. Returns 0 when nothing matches so an empty query can hide unrelated games.
function similarityScore(entry: CardLinkCandidateEntry, target: CardLinkTargetInfo) {
  const reasons: string[] = [];
  let score = 0;

  const targetPath = lower(target.absolutePath);
  if (targetPath && lower(entry.absolutePath) === targetPath) {
    score += 1000;
    reasons.push('같은 경로');
  } else {
    const targetFile = fileName(target.absolutePath) || fileName(target.relativePath);
    if (targetFile && fileName(entry.absolutePath) === targetFile) {
      score += 300;
      reasons.push('같은 파일명');
    } else if (target.relativePath && lower(entry.relativePath) === lower(target.relativePath)) {
      score += 250;
      reasons.push('같은 상대경로');
    }
  }

  const targetTitle = normalizeName(target.title ?? '');
  const entryTitle = normalizeName(entry.title);
  if (targetTitle && entryTitle === targetTitle) {
    score += 200;
    reasons.push('제목 일치');
  } else if (targetTitle && entryTitle && (entryTitle.includes(targetTitle) || targetTitle.includes(entryTitle))) {
    score += 60;
    reasons.push('제목 유사');
  } else if (targetTitle && entryTitle) {
    const targetSet = titleTokens(target.title);
    const shared = Array.from(titleTokens(entry.title)).filter((token) => targetSet.has(token)).length;
    if (shared > 0) {
      score += Math.min(40, shared * 15);
      reasons.push(`단어 ${shared}개 일치`);
    }
  }

  const sameSystem = Boolean(target.systemId) && normalizeName(entry.systemId) === normalizeName(target.systemId ?? '');
  const sameGroup = Boolean(target.platformGroup) && lower(entry.platformGroup) === lower(target.platformGroup);
  if (sameSystem && sameGroup) {
    score += 120;
    reasons.push('같은 플랫폼');
  } else if (sameSystem) {
    score += 80;
    reasons.push('같은 시스템');
  } else if (sameGroup) {
    score += 20;
    reasons.push('같은 그룹');
  }

  return { score, reasons };
}

// Query score mirrors the previous picker behaviour (exact > prefix > contains > any field), scaled so it
// dominates the similarity bonus: what the user typed always outranks what the card remembers.
function queryScore(entry: CardLinkCandidateEntry, query: string) {
  if (!query) return 0;
  const title = normalizeName(entry.title);
  if (title === query) return 400;
  if (title.startsWith(query)) return 300;
  if (title.includes(query)) return 200;
  if (normalizeName(`${entry.systemId} ${entry.romName ?? ''} ${entry.relativePath}`).includes(query)) return 100;
  return -1;
}

export function rankCardLinkCandidates<T extends CardLinkCandidateEntry>(
  entries: T[],
  target: CardLinkTargetInfo,
  query: string,
  limit = 60,
): Array<RankedCardLinkCandidate<T>> {
  const normalizedQuery = normalizeName(query);
  const ranked: Array<RankedCardLinkCandidate<T>> = [];
  for (const entry of entries) {
    const fromQuery = queryScore(entry, normalizedQuery);
    if (fromQuery < 0) continue;
    const { score: fromSimilarity, reasons } = similarityScore(entry, target);
    // With no query, an unrelated game has nothing to offer: hide it instead of padding the list alphabetically.
    if (!normalizedQuery && fromSimilarity === 0) continue;
    ranked.push({ entry, score: fromQuery + fromSimilarity, reasons });
  }
  ranked.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title));
  return ranked.slice(0, limit);
}
