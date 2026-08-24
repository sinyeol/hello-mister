import { templateThumbnailStoreName } from '@sticker-v1/services/templates/templatePersistence';

const dbName = 'zaparoo-templates';
const dbVersion = 2;
const stateStoreName = 'state';

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(stateStoreName)) request.result.createObjectStore(stateStoreName);
      if (!request.result.objectStoreNames.contains(templateThumbnailStoreName)) request.result.createObjectStore(templateThumbnailStoreName);
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

function templateThumbnailKey(templateId: string, cacheKey?: string) {
  return cacheKey || `template-thumb:${templateId}`;
}

export async function loadTemplateThumbnailBlob(templateId: string, cacheKey?: string): Promise<Blob | undefined> {
  if (!cacheKey) return undefined;
  return idbGet<Blob>(templateThumbnailStoreName, templateThumbnailKey(templateId, cacheKey));
}

export async function saveTemplateThumbnailBlob(templateId: string, blob: Blob, cacheKey: string) {
  await idbSet(templateThumbnailStoreName, templateThumbnailKey(templateId, cacheKey), blob);
}

export async function deleteTemplateThumbnailBlob(templateId: string, cacheKey?: string) {
  if (!cacheKey) return;
  await idbDelete(templateThumbnailStoreName, templateThumbnailKey(templateId, cacheKey));
}
