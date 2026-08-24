import type { CardAlbumIndexItem, SavedCardRecord } from '@sticker-v1/types';
import { cardAlbumIndexItemFromRecord, cardAlbumThumbnailCacheKey } from '@sticker-v1/utils/cardAlbumIndex';

const savedCardsKey = 'zaparoo.savedCards.v1';
const printQueueKey = 'zaparoo.printQueue.v1';
const savedCardsMetaKey = 'zaparoo.savedCards.meta.v1';
const dbName = 'zaparoo-cards';
const dbVersion = 3;
const legacyStateStoreName = 'state';
const cardMetaStoreName = 'cardMeta';
const cardFullDataStoreName = 'cardFullData';
const cardThumbnailStoreName = 'cardThumbnails';
const cardMetaUpdatedAtIndexName = 'updatedAt';
const savedCardsStateKey = 'savedCards';
const printQueueStateKey = 'printQueue';

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(legacyStateStoreName)) request.result.createObjectStore(legacyStateStoreName);
      const metaStore = request.result.objectStoreNames.contains(cardMetaStoreName)
        ? request.transaction?.objectStore(cardMetaStoreName)
        : request.result.createObjectStore(cardMetaStoreName, { keyPath: 'id' });
      if (metaStore && !metaStore.indexNames.contains(cardMetaUpdatedAtIndexName)) {
        metaStore.createIndex(cardMetaUpdatedAtIndexName, 'updatedAt');
      }
      if (!request.result.objectStoreNames.contains(cardFullDataStoreName)) request.result.createObjectStore(cardFullDataStoreName, { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains(cardThumbnailStoreName)) request.result.createObjectStore(cardThumbnailStoreName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet<T>(storeName: string, key: string) {
  const db = await openDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

async function idbSet<T>(storeName: string, key: string, value: T) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

async function idbDelete(storeName: string, key: string) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

async function idbDeleteKeysByPrefix(storeName: string, prefixes: string[]) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const key = String(cursor.key);
      if (prefixes.some((prefix) => key.startsWith(prefix))) cursor.delete();
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  }).finally(() => db.close());
}

async function idbPutInline<T>(storeName: string, value: T) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

async function idbGetAll<T>(storeName: string) {
  const db = await openDb();
  return new Promise<T[]>((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    request.onsuccess = () => resolve((request.result as T[]) ?? []);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

async function idbGetRecentCardMeta(limit: number) {
  const db = await openDb();
  return new Promise<CardAlbumIndexItem[]>((resolve, reject) => {
    const results: CardAlbumIndexItem[] = [];
    const store = db.transaction(cardMetaStoreName, 'readonly').objectStore(cardMetaStoreName);
    const source = store.indexNames.contains(cardMetaUpdatedAtIndexName)
      ? store.index(cardMetaUpdatedAtIndexName)
      : store;
    const request = source.openCursor(null, 'prev');
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || results.length >= limit) {
        resolve(results);
        return;
      }
      results.push(cursor.value as CardAlbumIndexItem);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

async function clearStore(storeName: string, db: IDBDatabase) {
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function loadLegacySavedCards(): SavedCardRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(savedCardsKey) ?? '[]') as SavedCardRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function persistSplitCardStores(cards: SavedCardRecord[]) {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDb();
  try {
    await clearStore(cardMetaStoreName, db);
    await clearStore(cardFullDataStoreName, db);
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([cardMetaStoreName, cardFullDataStoreName], 'readwrite');
      const metaStore = transaction.objectStore(cardMetaStoreName);
      const fullStore = transaction.objectStore(cardFullDataStoreName);
      cards.forEach((record) => {
        metaStore.put(cardAlbumIndexItemFromRecord(record));
        fullStore.put(record);
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function migrateLegacySavedCardsToSplitStores(): Promise<CardAlbumIndexItem[]> {
  const existingMeta = await idbGetAll<CardAlbumIndexItem>(cardMetaStoreName);
  if (existingMeta.length > 0) return existingMeta;
  const indexedCards = await idbGet<SavedCardRecord[]>(legacyStateStoreName, savedCardsStateKey);
  const legacyCards = indexedCards ?? loadLegacySavedCards();
  if (legacyCards.length > 0) {
    await persistSplitCardStores(legacyCards);
    await idbSet(legacyStateStoreName, savedCardsStateKey, legacyCards);
    localStorage.removeItem(savedCardsKey);
    return legacyCards.map(cardAlbumIndexItemFromRecord);
  }
  return [];
}

export function loadSavedCards(): SavedCardRecord[] {
  return loadLegacySavedCards();
}

export async function loadSavedCardsFromIndexedDb(): Promise<SavedCardRecord[]> {
  const fullRecords = await idbGetAll<SavedCardRecord>(cardFullDataStoreName);
  if (fullRecords.length > 0) return fullRecords;
  const indexedCards = await idbGet<SavedCardRecord[]>(legacyStateStoreName, savedCardsStateKey);
  if (indexedCards) {
    await persistSplitCardStores(indexedCards);
    return indexedCards;
  }
  const legacyCards = loadLegacySavedCards();
  if (legacyCards.length > 0) {
    persistSavedCards(legacyCards);
    localStorage.removeItem(savedCardsKey);
  }
  return legacyCards;
}

export async function loadCardAlbumIndexFromIndexedDb(): Promise<CardAlbumIndexItem[]> {
  return (await idbGetAll<CardAlbumIndexItem>(cardMetaStoreName)).map((item) => ({
    ...item,
    thumbnailCacheKey: cardAlbumThumbnailCacheKey(item.id, item.updatedAt),
  }));
}

export async function loadRecentCardAlbumIndexFromIndexedDb(limit: number): Promise<CardAlbumIndexItem[]> {
  return (await idbGetRecentCardMeta(limit)).map((item) => ({
    ...item,
    thumbnailCacheKey: cardAlbumThumbnailCacheKey(item.id, item.updatedAt),
  }));
}

export async function loadSavedCardFullData(savedCardId: string): Promise<SavedCardRecord | undefined> {
  const record = await idbGet<SavedCardRecord>(cardFullDataStoreName, savedCardId);
  if (record) return record;
  return (await loadSavedCardsFromIndexedDb()).find((candidate) => candidate.id === savedCardId);
}

export const getCardFullData = loadSavedCardFullData;

export async function loadSavedCardsByIdsFromIndexedDb(ids: string[]): Promise<SavedCardRecord[]> {
  const records = await Promise.all(ids.map((id) => loadSavedCardFullData(id)));
  return records.filter((record): record is SavedCardRecord => Boolean(record));
}

export const getManyCardFullData = loadSavedCardsByIdsFromIndexedDb;
export const preloadCardFullData = loadSavedCardsByIdsFromIndexedDb;

export async function upsertSavedCardRecord(record: SavedCardRecord) {
  await Promise.all([
    idbPutInline(cardMetaStoreName, cardAlbumIndexItemFromRecord(record)),
    idbPutInline(cardFullDataStoreName, record),
  ]);
}

export async function patchSavedCardRecord(
  savedCardId: string,
  patch: Partial<SavedCardRecord> | ((record: SavedCardRecord) => SavedCardRecord),
) {
  const current = await loadSavedCardFullData(savedCardId);
  if (!current) return undefined;
  const next = typeof patch === 'function'
    ? patch(current)
    : { ...current, ...patch, updatedAt: patch.updatedAt ?? new Date().toISOString() };
  await upsertSavedCardRecord(next);
  return next;
}

export async function deleteSavedCardRecord(savedCardId: string) {
  const timestamp = new Date().toISOString();
  return patchSavedCardRecord(savedCardId, { deletedAt: timestamp, updatedAt: timestamp });
}

export async function restoreSavedCardRecord(savedCardId: string) {
  const timestamp = new Date().toISOString();
  return patchSavedCardRecord(savedCardId, (record) => ({ ...record, deletedAt: undefined, updatedAt: timestamp }));
}

export async function permanentlyDeleteSavedCardRecord(savedCardId: string) {
  await Promise.all([
    idbDelete(cardMetaStoreName, savedCardId),
    idbDelete(cardFullDataStoreName, savedCardId),
    deleteCardThumbnailBlobs(savedCardId),
  ]);
}

export function persistSavedCards(cards: SavedCardRecord[]) {
  void idbSet(legacyStateStoreName, savedCardsStateKey, cards);
  void persistSplitCardStores(cards);
  localStorage.setItem(savedCardsMetaKey, JSON.stringify({ count: cards.length, updatedAt: new Date().toISOString() }));
  localStorage.removeItem(savedCardsKey);
}

function cardThumbnailKey(savedCardId: string, cacheKey?: string) {
  return cacheKey || `card-thumbnail:${savedCardId}`;
}

export async function loadCardThumbnailBlob(savedCardId: string, cacheKey?: string): Promise<Blob | undefined> {
  return idbGet<Blob>(cardThumbnailStoreName, cardThumbnailKey(savedCardId, cacheKey));
}

export async function saveCardThumbnailBlob(savedCardId: string, blob: Blob, cacheKey?: string) {
  await idbSet(cardThumbnailStoreName, cardThumbnailKey(savedCardId, cacheKey), blob);
}

export async function deleteCardThumbnailBlobs(savedCardId: string) {
  await idbDeleteKeysByPrefix(cardThumbnailStoreName, [
    `card-thumbnail:${savedCardId}:`,
    `card-thumbnail:v1:${savedCardId}:`,
    `card-thumbnail:v2:${savedCardId}:`,
    `card-thumbnail:v3:${savedCardId}:`,
  ]);
  await idbDelete(cardThumbnailStoreName, `card-thumbnail:${savedCardId}`).catch(() => undefined);
}

export function loadPrintQueueIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(printQueueKey) ?? '[]') as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function loadPrintQueueIdsFromIndexedDb(): Promise<string[]> {
  const indexedQueue = await idbGet<string[]>(legacyStateStoreName, printQueueStateKey);
  return indexedQueue ?? loadPrintQueueIds();
}

export function persistPrintQueueIds(ids: string[]) {
  void idbSet(legacyStateStoreName, printQueueStateKey, ids);
  localStorage.setItem(printQueueKey, JSON.stringify(ids));
}
