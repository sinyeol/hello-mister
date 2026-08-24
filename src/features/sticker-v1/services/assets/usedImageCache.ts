import type { AssetLibrary, AssetReference, LocalAsset } from '@sticker-v1/types';
import { assetReferenceCacheKey, assetReferenceFromAsset } from '@sticker-v1/utils/assetReferences';

const dbName = 'zaparoo-used-images';
const dbVersion = 1;
const storeName = 'usedImages';

interface CachedUsedImage {
  reference: AssetReference;
  blob: Blob;
  mimeType?: string;
  cachedAt: string;
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function blobFromAsset(asset: LocalAsset) {
  if (asset.file) return asset.file;
  if (asset.objectUrl?.startsWith('data:') || asset.objectUrl?.startsWith('blob:')) {
    return fetch(asset.objectUrl).then((response) => response.blob());
  }
  return undefined;
}

function normalizeReference(reference: AssetReference, blob?: Blob, mimeType?: string): AssetReference {
  const cacheKey = assetReferenceCacheKey(reference);
  return {
    ...reference,
    cacheKey,
    stableAssetKey: reference.stableAssetKey ?? reference.stableKey,
    filename: reference.filename ?? reference.name,
    originalFilename: reference.originalFilename ?? reference.filename ?? reference.name,
    displayName: reference.displayName ?? reference.name,
    mimeType: mimeType || reference.mimeType || blob?.type || undefined,
  };
}

export async function cacheUsedImageBlob(reference: AssetReference, blob: Blob, mimeType?: string) {
  const normalizedReference = normalizeReference(reference, blob, mimeType);
  if (typeof indexedDB === 'undefined') return normalizedReference;
  const db = await openDb();
  const cached: CachedUsedImage = {
    reference: normalizedReference,
    blob,
    mimeType: mimeType || blob.type || undefined,
    cachedAt: new Date().toISOString(),
  };
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(cached, normalizedReference.cacheKey);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
  return normalizedReference;
}

export async function cacheUsedAsset(asset?: LocalAsset) {
  if (!asset) return;
  const reference = assetReferenceFromAsset(asset);
  if (!reference) return;
  const blob = await blobFromAsset(asset);
  if (!blob) return;
  return cacheUsedImageBlob(reference, blob, asset.mimeType);
}

export async function getCachedUsedImageBlob(reference: AssetReference) {
  if (typeof indexedDB === 'undefined') return undefined;
  const db = await openDb();
  const cacheKey = assetReferenceCacheKey(reference);
  return new Promise<CachedUsedImage | undefined>((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(cacheKey);
    request.onsuccess = () => resolve(request.result as CachedUsedImage | undefined);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

export async function restoreUsedImageAssets(
  references: Array<AssetReference | undefined>,
  onProgress?: (progress: { processed: number; total: number; reference: AssetReference }) => void,
) {
  const uniqueReferences = Array.from(
    new Map(references.filter((reference): reference is AssetReference => Boolean(reference)).map((reference) => [assetReferenceCacheKey(reference), reference])).values(),
  );
  if (typeof indexedDB === 'undefined' || uniqueReferences.length === 0) return [];
  const db = await openDb();
  const assets: LocalAsset[] = [];
  try {
    for (const [index, reference] of uniqueReferences.entries()) {
      onProgress?.({ processed: index + 1, total: uniqueReferences.length, reference });
      const cacheKey = assetReferenceCacheKey(reference);
      const cached = await new Promise<CachedUsedImage | undefined>((resolve, reject) => {
        const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(cacheKey);
        request.onsuccess = () => resolve(request.result as CachedUsedImage | undefined);
        request.onerror = () => reject(request.error);
      });
      if (cached?.blob) {
        const cachedReference = normalizeReference(cached.reference ?? reference, cached.blob, cached.mimeType);
        assets.push({
          id: cachedReference.assetId ?? `used_${cacheKey.replace(/[^a-z0-9]+/gi, '_')}`,
          sourceId: cachedReference.sourceId ?? 'used-image-cache',
          sourceLabel: cachedReference.sourceLabel ?? 'Used image cache',
          kind: cachedReference.kind,
          name: cachedReference.name,
          normalizedName: cachedReference.normalizedName,
          normalizedFileName: cachedReference.normalizedFileName,
          path: cachedReference.path,
          originalPath: cachedReference.originalPath,
          platform: cachedReference.platform,
          assetType: cachedReference.assetType,
          objectUrl: URL.createObjectURL(cached.blob),
          mimeType: cached.mimeType || cached.blob.type || undefined,
          width: cachedReference.width,
          height: cachedReference.height,
          importedAt: cached.cachedAt,
        });
      }
    }
  } finally {
    db.close();
  }
  return assets;
}

export function mergeAssetsIntoLibrary(library: AssetLibrary, restoredAssets: LocalAsset[]): AssetLibrary {
  if (restoredAssets.length === 0) return library;
  const assetsById = { ...library.assetsById };
  const folders: AssetLibrary['folders'] = { ...library.folders };
  restoredAssets.forEach((asset) => {
    assetsById[asset.id] = asset;
    const existingFolder = folders[asset.kind];
    const files = existingFolder?.files.filter((candidate) => candidate.id !== asset.id) ?? [];
    folders[asset.kind] = {
      kind: asset.kind,
      displayName: existingFolder?.displayName ?? asset.kind,
      files: [...files, asset],
    };
  });
  return {
    ...library,
    rootName: library.rootName || 'Used image cache',
    assetsById,
    folders,
  };
}
