import JSZip from 'jszip';
import type { AssetReference, LocalAsset, SavedCardRecord, Template } from '@sticker-v1/types';
import { cardImageReferences } from '@sticker-v1/services/assets/cardImagePersistence';
import { cacheUsedImageBlob, getCachedUsedImageBlob } from '@sticker-v1/services/assets/usedImageCache';
import { assetReferenceCacheKey, resolveAssetReference } from '@sticker-v1/utils/assetReferences';

interface CardBundleManifestAsset {
  stableKey: string;
  filename: string;
  mimeType?: string;
  bundlePath: string;
  reference: AssetReference;
}

interface CardBundleManifest {
  format: 'zaparoo-card-bundle';
  version: 1;
  exportedAt: string;
  cardCount: number;
  assets: CardBundleManifestAsset[];
  templates: Array<{ id: string; name: string; type: string }>;
  warnings: string[];
}

function safeFileName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9가-힣._-]+/g, '-').replace(/^-+|-+$/g, '') || 'asset';
}

async function blobFromAsset(asset?: LocalAsset) {
  if (!asset) return undefined;
  if (asset.file) return asset.file;
  if (asset.objectUrl?.startsWith('data:') || asset.objectUrl?.startsWith('blob:')) return fetch(asset.objectUrl).then((response) => response.blob());
  return undefined;
}

export async function buildCardBundle(
  records: SavedCardRecord[],
  assetsById: Record<string, LocalAsset>,
  templates: Template[],
) {
  const zip = new JSZip();
  const warnings: string[] = [];
  const manifestAssets: CardBundleManifestAsset[] = [];
  const uniqueRefs = new Map<string, AssetReference>();
  records.forEach((record) => cardImageReferences(record.card).forEach((reference) => uniqueRefs.set(assetReferenceCacheKey(reference), reference)));

  for (const reference of uniqueRefs.values()) {
    const cachedImage = await getCachedUsedImageBlob(reference);
    const asset = cachedImage?.blob ? undefined : resolveAssetReference(assetsById, reference.assetId, reference);
    const blob = cachedImage?.blob ?? (await blobFromAsset(asset));
    if (!blob) {
      warnings.push(`이미지 파일을 bundle에 포함하지 못했습니다: ${reference.name}`);
      continue;
    }
    const filename = safeFileName(reference.name);
    const bundlePath = `assets/${manifestAssets.length + 1}-${filename}`;
    zip.file(bundlePath, blob);
    manifestAssets.push({
      stableKey: reference.stableKey,
      filename,
      mimeType: cachedImage?.mimeType || asset?.mimeType || blob.type || undefined,
      bundlePath,
      reference,
    });
  }

  const templateIds = new Set<string>();
  records.forEach((record) => {
    if (record.card.front.templateId) templateIds.add(record.card.front.templateId);
    if (record.card.back.templateId) templateIds.add(record.card.back.templateId);
  });
  const includedTemplates = templates.filter((template) => templateIds.has(template.id));

  const manifest: CardBundleManifest = {
    format: 'zaparoo-card-bundle',
    version: 1,
    exportedAt: new Date().toISOString(),
    cardCount: records.length,
    assets: manifestAssets,
    templates: includedTemplates.map((template) => ({ id: template.id, name: template.name, type: template.type })),
    warnings,
  };

  zip.file('cards.json', JSON.stringify(records, null, 2));
  zip.file('templates/templates.json', JSON.stringify(includedTemplates, null, 2));
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  return { blob: await zip.generateAsync({ type: 'blob' }), manifest };
}

export async function parseCardBundle(file: File) {
  const zip = await JSZip.loadAsync(file);
  const manifestFile = zip.file('manifest.json');
  const cardsFile = zip.file('cards.json');
  if (!manifestFile || !cardsFile) throw new Error('cards.json 또는 manifest.json이 없는 카드 bundle입니다.');
  const manifest = JSON.parse(await manifestFile.async('text')) as CardBundleManifest;
  if (manifest.format !== 'zaparoo-card-bundle') throw new Error('지원하지 않는 카드 bundle 형식입니다.');
  const records = JSON.parse(await cardsFile.async('text')) as SavedCardRecord[];
  const templatesFile = zip.file('templates/templates.json');
  const templates = templatesFile ? (JSON.parse(await templatesFile.async('text')) as Template[]) : [];

  await Promise.all(
    manifest.assets.map(async (asset) => {
      const zipAsset = zip.file(asset.bundlePath);
      if (!zipAsset) return;
      const blob = await zipAsset.async('blob');
      await cacheUsedImageBlob(asset.reference, blob, asset.mimeType);
    }),
  );

  const timestamp = Date.now();
  return {
    records: records.map((record, index) => ({
      ...record,
      id: `${record.id}_import_${timestamp}_${index}`,
      title: record.title,
      importedAt: new Date().toISOString(),
      importSource: file.name,
      card: {
        ...record.card,
        id: `${record.card.id}_import_${timestamp}_${index}`,
        coordinateLockKey: `card:import:${timestamp}:${index}`,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    templates,
    manifest,
  };
}
