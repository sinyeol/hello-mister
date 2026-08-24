import type { CardAlbumIndexItem, SavedCardRecord } from '@sticker-v1/types';

export const CARD_ALBUM_THUMBNAIL_CACHE_VERSION = 3;

export function cardAlbumThumbnailCacheKey(savedCardId: string, updatedAt: string) {
  return `card-thumbnail:v${CARD_ALBUM_THUMBNAIL_CACHE_VERSION}:${savedCardId}:${updatedAt}`;
}

export function cardAlbumPlatform(record: Pick<SavedCardRecord, 'mister' | 'categoryId'>) {
  if (record.mister) return `${record.mister.misterPlatformGroup}/${record.mister.misterSystemId}`;
  return record.categoryId || '미분류';
}

export function cardAlbumIndexItemFromRecord(record: SavedCardRecord): CardAlbumIndexItem {
  return {
    id: record.id,
    title: record.title,
    platform: cardAlbumPlatform(record),
    categoryId: record.categoryId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    thumbnailCacheKey: cardAlbumThumbnailCacheKey(record.id, record.updatedAt),
    thumbnailStatus: record.thumbnailStatus ?? 'ready',
    thumbnailStaleCacheKey: record.thumbnailStaleCacheKey,
    thumbnailError: record.thumbnailError,
    thumbnailUpdatedAt: record.thumbnailUpdatedAt,
    cachedLinkStatus: record.mister?.zaparooLibraryEntryId ? 'linked' : 'unlinked',
    favorite: record.favorite,
    deletedAt: record.deletedAt,
    importedAt: record.importedAt,
    importSource: record.importSource,
    mister: record.mister,
  };
}

export function albumIndexTime(item: Pick<CardAlbumIndexItem, 'createdAt' | 'updatedAt'>) {
  const updated = Date.parse(item.updatedAt);
  if (Number.isFinite(updated)) return updated;
  const created = Date.parse(item.createdAt);
  return Number.isFinite(created) ? created : 0;
}

export function sortAlbumIndexByUpdatedDesc(a: CardAlbumIndexItem, b: CardAlbumIndexItem) {
  return albumIndexTime(b) - albumIndexTime(a) || a.title.localeCompare(b.title);
}

export function takeRecentAlbumIndexItems(items: CardAlbumIndexItem[], count: number) {
  return [...items].sort(sortAlbumIndexByUpdatedDesc).slice(0, count);
}

export function savedCardSearchTextFromIndex(item: CardAlbumIndexItem) {
  return `${item.title} ${item.platform ?? ''} ${item.categoryId ?? ''} ${item.mister?.misterRelativePath ?? ''} ${item.mister?.misterAbsolutePath ?? ''}`;
}
