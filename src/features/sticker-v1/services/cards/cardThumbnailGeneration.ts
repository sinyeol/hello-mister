import type { AssetLibrary, CardThumbnailStatus, Category, LocalAsset, SavedCardRecord, Template } from '@sticker-v1/types';
import { missingUsedImageReferences, uniqueCardImageReferences } from '@sticker-v1/services/assets/cardImagePersistence';
import { restoreUsedImageAssets } from '@sticker-v1/services/assets/usedImageCache';
import {
  loadCardThumbnailBlob,
  patchSavedCardRecord,
  saveCardThumbnailBlob,
} from '@sticker-v1/services/cards/savedCardsPersistence';
import { createExportSummary } from '@sticker-v1/services/export/exportSummary';
import { renderCardPng } from '@sticker-v1/services/export/exportPng';
import { assetReferenceCacheKey } from '@sticker-v1/utils/assetReferences';
import { cardAlbumIndexItemFromRecord } from '@sticker-v1/utils/cardAlbumIndex';

export interface CardThumbnailGenerationContext {
  assetLibrary?: AssetLibrary;
  categories: Category[];
  templates: Template[];
  dpi?: number;
}

export type CardThumbnailGenerationStatus =
  | 'ready'
  | 'failedButPreviousKept'
  | 'missingAssets';

export interface CardThumbnailGenerationResult {
  status: CardThumbnailGenerationStatus;
  blob?: Blob;
  cacheKey?: string;
  previousKept: boolean;
  restoredAssetCount: number;
  missingAssetCount: number;
  error?: string;
}

function isDevelopmentHost() {
  return typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
}

function logThumbnailDiagnostics(record: SavedCardRecord, message: string, detail: Record<string, unknown>) {
  if (!isDevelopmentHost()) return;
  console.debug('[Card thumbnail]', message, { cardId: record.id, title: record.title, ...detail });
}

function assetsByIdWithRestoredAssets(baseAssetsById: Record<string, LocalAsset>, restoredAssets: LocalAsset[]) {
  if (restoredAssets.length === 0) return baseAssetsById;
  const next = { ...baseAssetsById };
  restoredAssets.forEach((asset) => {
    next[asset.id] = asset;
  });
  return next;
}

function revokeRestoredAssets(restoredAssets: LocalAsset[]) {
  restoredAssets.forEach((asset) => {
    if (asset.objectUrl?.startsWith('blob:')) URL.revokeObjectURL(asset.objectUrl);
  });
}

async function markThumbnailStatus(
  record: SavedCardRecord,
  status: CardThumbnailStatus,
  patch?: Pick<SavedCardRecord, 'thumbnailError' | 'thumbnailStaleCacheKey' | 'thumbnailUpdatedAt'>,
) {
  await patchSavedCardRecord(record.id, {
    thumbnailStatus: status,
    thumbnailStaleCacheKey: patch?.thumbnailStaleCacheKey,
    thumbnailError: patch?.thumbnailError,
    thumbnailUpdatedAt: patch?.thumbnailUpdatedAt,
    updatedAt: record.updatedAt,
  });
}

export async function regenerateSavedCardThumbnail(
  record: SavedCardRecord,
  context: CardThumbnailGenerationContext,
): Promise<CardThumbnailGenerationResult> {
  const cacheKey = cardAlbumIndexItemFromRecord(record).thumbnailCacheKey;
  const previousCacheKey = record.thumbnailStaleCacheKey;
  const previousThumbnail = previousCacheKey ? await loadCardThumbnailBlob(record.id, previousCacheKey) : undefined;
  const baseAssetsById = context.assetLibrary?.assetsById ?? {};
  const references = uniqueCardImageReferences([record.card]);
  const missingBeforeRestore = missingUsedImageReferences([record.card], baseAssetsById);
  const restoredAssets = missingBeforeRestore.length > 0 ? await restoreUsedImageAssets(missingBeforeRestore) : [];
  const renderAssetsById = assetsByIdWithRestoredAssets(baseAssetsById, restoredAssets);
  const missingAfterRestore = missingUsedImageReferences([record.card], renderAssetsById);
  const category = context.categories.find((candidate) => candidate.id === record.categoryId);

  logThumbnailDiagnostics(record, 'generation started', {
    referenceCount: references.length,
    missingBeforeRestore: missingBeforeRestore.length,
    restoredAssetCount: restoredAssets.length,
    missingAfterRestore: missingAfterRestore.map((reference) => assetReferenceCacheKey(reference)),
    cacheKey,
    previousCacheKey,
  });

  try {
    if (missingAfterRestore.length > 0) {
      const error = `Missing thumbnail image assets: ${missingAfterRestore.map((reference) => reference.displayName ?? reference.filename ?? assetReferenceCacheKey(reference)).join(', ')}`;
      await markThumbnailStatus(record, previousThumbnail ? 'failedButPreviousKept' : 'missingAssets', {
        thumbnailStaleCacheKey: previousCacheKey,
        thumbnailError: error,
      });
      logThumbnailDiagnostics(record, 'generation missing assets', {
        previousKept: Boolean(previousThumbnail),
        missingAssetCount: missingAfterRestore.length,
      });
      return {
        status: previousThumbnail ? 'failedButPreviousKept' : 'missingAssets',
        previousKept: Boolean(previousThumbnail),
        restoredAssetCount: restoredAssets.length,
        missingAssetCount: missingAfterRestore.length,
        error,
      };
    }

    const summary = createExportSummary(1, 1, 0, context.dpi ?? 120);
    const blob = await renderCardPng(
      record.card,
      category,
      renderAssetsById,
      context.templates,
      'front',
      { cardTitle: record.title, dpi: context.dpi ?? 120, summary },
    );
    if (summary.missingImageCount > 0) {
      const error = summary.warnings.map((warning) => warning.message).join(' ');
      await markThumbnailStatus(record, previousThumbnail ? 'failedButPreviousKept' : 'missingAssets', {
        thumbnailStaleCacheKey: previousCacheKey,
        thumbnailError: error,
      });
      logThumbnailDiagnostics(record, 'generation kept previous after render warnings', {
        previousKept: Boolean(previousThumbnail),
        missingImageCount: summary.missingImageCount,
      });
      return {
        status: previousThumbnail ? 'failedButPreviousKept' : 'missingAssets',
        previousKept: Boolean(previousThumbnail),
        restoredAssetCount: restoredAssets.length,
        missingAssetCount: summary.missingImageCount,
        error,
      };
    }

    if (cacheKey) await saveCardThumbnailBlob(record.id, blob, cacheKey);
    await markThumbnailStatus(record, 'ready', {
      thumbnailStaleCacheKey: undefined,
      thumbnailError: undefined,
      thumbnailUpdatedAt: new Date().toISOString(),
    });
    logThumbnailDiagnostics(record, 'generation ready', {
      restoredAssetCount: restoredAssets.length,
      previousKept: false,
      cacheKey,
    });
    return {
      status: 'ready',
      blob,
      cacheKey,
      previousKept: false,
      restoredAssetCount: restoredAssets.length,
      missingAssetCount: 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown thumbnail render error';
    await markThumbnailStatus(record, previousThumbnail ? 'failedButPreviousKept' : 'missingAssets', {
      thumbnailStaleCacheKey: previousCacheKey,
      thumbnailError: message,
    });
    logThumbnailDiagnostics(record, 'generation failed', {
      previousKept: Boolean(previousThumbnail),
      error: message,
    });
    return {
      status: previousThumbnail ? 'failedButPreviousKept' : 'missingAssets',
      previousKept: Boolean(previousThumbnail),
      restoredAssetCount: restoredAssets.length,
      missingAssetCount: 0,
      error: message,
    };
  } finally {
    revokeRestoredAssets(restoredAssets);
  }
}
