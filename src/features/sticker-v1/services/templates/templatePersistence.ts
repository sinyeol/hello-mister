import type { Template } from '@sticker-v1/types';

const templateStorageKey = 'zaparoo.userTemplates.v1';
const templateMetaKey = 'zaparoo.userTemplates.meta.v1';
const dbName = 'zaparoo-templates';
const dbVersion = 2;
const storeName = 'state';
export const templateThumbnailStoreName = 'templateThumbnails';
const activeStateKey = 'userTemplates';

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
      if (!request.result.objectStoreNames.contains(templateThumbnailStoreName)) request.result.createObjectStore(templateThumbnailStoreName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet<T>(key: string) {
  const db = await openDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

async function idbSet<T>(key: string, value: T) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

function isUserTemplate(template: Template) {
  return !template.builtIn && template.source !== 'LEGACY_BUILT_IN';
}

export function loadPersistedTemplates(): Template[] {
  return loadLegacyTemplates();
}

function loadLegacyTemplates(): Template[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(templateStorageKey) ?? '[]') as Template[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function loadPersistedTemplatesFromIndexedDb(): Promise<Template[]> {
  const indexedTemplates = await idbGet<Template[]>(activeStateKey);
  if (indexedTemplates) return indexedTemplates;
  const legacyTemplates = loadLegacyTemplates();
  if (legacyTemplates.length > 0) {
    persistUserTemplates(legacyTemplates);
    localStorage.removeItem(templateStorageKey);
  }
  return legacyTemplates;
}

export function persistUserTemplates(templates: Template[]) {
  const userTemplates = templates.filter(isUserTemplate);
  void idbSet(activeStateKey, userTemplates);
  localStorage.setItem(templateMetaKey, JSON.stringify({ count: userTemplates.length, updatedAt: new Date().toISOString() }));
  localStorage.removeItem(templateStorageKey);
}

export function upsertPersistedTemplate(template: Template, currentTemplates: Template[]) {
  const nextTemplates = [...currentTemplates.filter((candidate) => candidate.id !== template.id), template];
  persistUserTemplates(nextTemplates);
  return nextTemplates;
}

export function deletePersistedTemplate(templateId: string, currentTemplates: Template[]) {
  const nextTemplates = currentTemplates.filter((template) => template.id !== templateId);
  persistUserTemplates(nextTemplates);
  return nextTemplates;
}
