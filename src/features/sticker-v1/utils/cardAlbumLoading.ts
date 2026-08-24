import type { SavedCardRecord } from '@sticker-v1/types';

function recordTime(value?: string) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function recentCardTime(record: SavedCardRecord) {
  return recordTime(record.updatedAt) || recordTime(record.createdAt);
}

export function takeRecentSavedCards(records: SavedCardRecord[], limit: number) {
  const safeLimit = Math.max(0, limit);
  if (safeLimit === 0) return [];
  const recent: Array<{ record: SavedCardRecord; index: number }> = [];
  records.forEach((record, index) => {
    const candidate = { record, index };
    const insertAt = recent.findIndex((current) => {
      const timeDiff = recentCardTime(candidate.record) - recentCardTime(current.record);
      return timeDiff > 0 || (timeDiff === 0 && candidate.index < current.index);
    });
    if (insertAt === -1) {
      if (recent.length < safeLimit) recent.push(candidate);
      return;
    }
    recent.splice(insertAt, 0, candidate);
    if (recent.length > safeLimit) recent.pop();
  });
  return recent.map(({ record }) => record);
}

export function savedCardSearchText(record: SavedCardRecord) {
  return [
    record.title,
    record.card.front.titleText,
    record.card.front.platformLabel,
    record.mister?.misterSystemId,
    record.mister?.misterPlatformGroup,
    record.mister?.misterRelativePath,
  ]
    .filter(Boolean)
    .join(' ');
}
