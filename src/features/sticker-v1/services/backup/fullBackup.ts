import JSZip from 'jszip';
import type { AssetLibrary, AssetReference, MiSTerState, SavedCardRecord, Template, ZaparooLibraryState } from '@sticker-v1/types';
import { cardImageReferences } from '@sticker-v1/services/assets/cardImagePersistence';
import { cacheUsedImageBlob, getCachedUsedImageBlob } from '@sticker-v1/services/assets/usedImageCache';
import { assetReferenceCacheKey } from '@sticker-v1/utils/assetReferences';

interface FullBackupManifestAsset {
  stableKey: string;
  filename: string;
  mimeType?: string;
  bundlePath: string;
  reference: AssetReference;
}

export interface FullBackupData {
  zaparooLibrary: ZaparooLibraryState;
  mister: MiSTerState;
  templates: Template[];
  savedCards: SavedCardRecord[];
  assetLibrary?: AssetLibrary;
  settings?: Record<string, unknown>;
}

export interface ParsedFullBackup {
  manifest: {
    format: 'zaparoo-full-backup';
    version: 1;
    exportedAt: string;
    cardCount: number;
    templateCount: number;
    libraryEntryCount: number;
    assets: FullBackupManifestAsset[];
    warnings: string[];
  };
  zaparooLibrary: ZaparooLibraryState;
  mister: MiSTerState;
  templates: Template[];
  savedCards: SavedCardRecord[];
  assetLibrary?: AssetLibrary;
}

function safeFileName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9가-힣_-]+/g, '-').replace(/^-+|-+$/g, '') || 'asset';
}

export async function buildFullBackup(data: FullBackupData) {
  const zip = new JSZip();
  const warnings: string[] = [];
  const manifestAssets: FullBackupManifestAsset[] = [];
  const uniqueRefs = new Map<string, AssetReference>();
  data.savedCards.forEach((record) => {
    cardImageReferences(record.card).forEach((reference) => uniqueRefs.set(assetReferenceCacheKey(reference), reference));
  });

  for (const reference of uniqueRefs.values()) {
    const cached = await getCachedUsedImageBlob(reference);
    if (!cached?.blob) {
      warnings.push(`used image cache에서 이미지를 찾지 못했습니다: ${reference.name}`);
      continue;
    }
    const filename = safeFileName(reference.name ?? reference.filename ?? 'asset');
    const bundlePath = `used-images/${manifestAssets.length + 1}-${filename}`;
    zip.file(bundlePath, cached.blob);
    manifestAssets.push({
      stableKey: assetReferenceCacheKey(reference),
      filename,
      mimeType: cached.mimeType || cached.blob.type || reference.mimeType,
      bundlePath,
      reference,
    });
  }

  const manifest: ParsedFullBackup['manifest'] = {
    format: 'zaparoo-full-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    cardCount: data.savedCards.length,
    templateCount: data.templates.length,
    libraryEntryCount: data.zaparooLibrary.entries.length,
    assets: manifestAssets,
    warnings,
  };

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('zaparoo-library.json', JSON.stringify(data.zaparooLibrary, null, 2));
  zip.file('mister-profiles.json', JSON.stringify(data.mister, null, 2));
  zip.file('templates/templates.json', JSON.stringify(data.templates, null, 2));
  zip.file('cards/cards.json', JSON.stringify(data.savedCards, null, 2));
  if (data.assetLibrary) zip.file('asset-index.json', JSON.stringify(data.assetLibrary, null, 2));
  zip.file('settings.json', JSON.stringify(data.settings ?? {}, null, 2));

  return { blob: await zip.generateAsync({ type: 'blob' }), manifest };
}

export async function parseFullBackup(file: File): Promise<ParsedFullBackup> {
  const zip = await JSZip.loadAsync(file);
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new Error('manifest.json이 없는 백업 ZIP입니다.');
  const manifest = JSON.parse(await manifestFile.async('text')) as ParsedFullBackup['manifest'];
  if (manifest.format !== 'zaparoo-full-backup') throw new Error('지원하지 않는 전체 백업 형식입니다.');

  const libraryFile = zip.file('zaparoo-library.json');
  const misterFile = zip.file('mister-profiles.json');
  const templatesFile = zip.file('templates/templates.json');
  const cardsFile = zip.file('cards/cards.json');
  if (!libraryFile || !misterFile || !templatesFile || !cardsFile) {
    throw new Error('백업 ZIP에 필수 데이터 파일이 부족합니다.');
  }

  await Promise.all(
    manifest.assets.map(async (asset) => {
      const zipAsset = zip.file(asset.bundlePath);
      if (!zipAsset) return;
      const blob = await zipAsset.async('blob');
      await cacheUsedImageBlob(asset.reference, blob, asset.mimeType);
    }),
  );

  const assetIndexFile = zip.file('asset-index.json');
  return {
    manifest,
    zaparooLibrary: JSON.parse(await libraryFile.async('text')) as ZaparooLibraryState,
    mister: JSON.parse(await misterFile.async('text')) as MiSTerState,
    templates: JSON.parse(await templatesFile.async('text')) as Template[],
    savedCards: JSON.parse(await cardsFile.async('text')) as SavedCardRecord[],
    assetLibrary: assetIndexFile ? (JSON.parse(await assetIndexFile.async('text')) as AssetLibrary) : undefined,
  };
}
