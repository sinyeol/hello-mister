import type { AssetLibrary, LocalAsset } from '@sticker-v1/types';
import { assetStableKey } from '@sticker-v1/utils/assetReferences';
import { normalizeName } from '@sticker-v1/utils/normalizeName';
import { removeFileExtension, safeExtension, safeFileName, safeString } from '@sticker-v1/utils/pathParts';
import { filterAssetLibraryByEnabledGroups } from './assetSourceGroups';

const dbName = 'zaparoo-assets';
const dbVersion = 2;
const storeName = 'assetIndexCache';
const cacheKey = 'current';

type CachedAsset = Omit<LocalAsset, 'file' | 'objectUrl'>;

interface CachedAssetLibrary {
  id: string;
  rootName?: string;
  loadedAt?: string;
  assetsById: Record<string, CachedAsset>;
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('directoryHandles')) request.result.createObjectStore('directoryHandles');
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function stripRuntimeAsset(asset: LocalAsset): CachedAsset {
  const cached: Partial<LocalAsset> = { ...asset };
  delete cached.file;
  delete cached.objectUrl;
  return cached as CachedAsset;
}

function hydrateCachedAsset(id: string, asset: Partial<LocalAsset> | undefined): LocalAsset | undefined {
  if (!asset || typeof asset !== 'object') return undefined;
  const name = safeFileName(asset.name ?? asset.originalPath ?? asset.path, 'unknown-image');
  const normalizedName = safeString(asset.normalizedName, normalizeName(name));
  const originalPath = safeString(asset.originalPath ?? asset.path, name);
  const kind = asset.kind ?? 'unknown';
  const hydrated: LocalAsset = {
    ...asset,
    id: safeString(asset.id, id),
    sourceId: safeString(asset.sourceId, 'cached-index'),
    sourceLabel: safeString(asset.sourceLabel, 'Cached image index'),
    kind,
    name,
    normalizedName,
    path: safeString(asset.path, originalPath),
    originalPath,
    platform: safeString(asset.platform, ''),
    assetType: safeString(asset.assetType, 'Unassigned'),
    normalizedFileName: safeString(asset.normalizedFileName, normalizeName(removeFileExtension(name))),
    mimeType: asset.mimeType,
    format: (asset.format ?? safeExtension(name)) as LocalAsset['format'],
    importedAt: asset.importedAt,
  };
  hydrated.stableAssetKey = asset.stableAssetKey ?? assetStableKey(hydrated);
  return hydrated;
}

export async function saveAssetLibraryCache(library: AssetLibrary) {
  if (typeof indexedDB === 'undefined') return;
  const cached: CachedAssetLibrary = {
    id: library.id,
    rootName: library.rootName,
    loadedAt: library.loadedAt,
    assetsById: Object.fromEntries(Object.values(library.assetsById).map((asset) => [asset.id, stripRuntimeAsset(asset)])),
  };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(cached, cacheKey);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

export async function loadAssetLibraryCache(options: { includeDisabledGroups?: boolean } = {}): Promise<AssetLibrary | undefined> {
  if (typeof indexedDB === 'undefined') return undefined;
  const db = await openDb();
  const cached = await new Promise<CachedAssetLibrary | undefined>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).get(cacheKey);
    request.onsuccess = () => resolve(request.result as CachedAssetLibrary | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  if (!cached) return undefined;

  const assetsById = Object.fromEntries(
    Object.entries(cached.assetsById ?? {})
      .map(([id, asset]) => hydrateCachedAsset(id, asset))
      .filter((asset): asset is LocalAsset => Boolean(asset))
      .map((asset) => [asset.id, asset]),
  );
  const folders: AssetLibrary['folders'] = {};
  Object.values(assetsById).forEach((asset) => {
    folders[asset.kind] ??= { kind: asset.kind, displayName: asset.kind, files: [] };
    folders[asset.kind]?.files.push(asset);
  });

  const library = {
    id: cached.id,
    rootName: cached.rootName,
    loadedAt: cached.loadedAt,
    assetsById,
    folders,
  };
  return options.includeDisabledGroups ? library : filterAssetLibraryByEnabledGroups(library);
}

export async function clearAssetLibraryCache() {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(cacheKey);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}
