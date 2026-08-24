import JSZip from 'jszip';
import type { Template, TemplateLayer } from '@sticker-v1/types';

interface TemplateBundleAssetManifest {
  assetId: string;
  filename: string;
  layerId: string;
  slotId?: string;
  slotType?: string;
  mimeType: string;
  bundlePath: string;
  originalSourcePath?: string;
}

interface TemplateBundleManifest {
  format: 'zaparoo-template-bundle';
  version: 1;
  exportedAt: string;
  templateId: string;
  templateName: string;
  assets: TemplateBundleAssetManifest[];
  warnings: string[];
}

function safeFileName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9가-힣._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'template';
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) return undefined;
  const mimeType = match[1] || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? '';
  return { mimeType, isBase64, payload };
}

function extensionForMime(mimeType: string) {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('svg')) return 'svg';
  return 'bin';
}

function cloneTemplate(template: Template) {
  const clone = JSON.parse(JSON.stringify(template)) as Template;
  stripTemplateThumbnailMetadata(clone);
  return clone;
}

function stripTemplateThumbnailMetadata(template: Template) {
  delete template.thumbnailCacheKey;
  delete template.thumbnailVersion;
  delete template.thumbnailStatus;
  delete template.thumbnailStaleCacheKey;
  delete template.thumbnailError;
  delete template.thumbnailUpdatedAt;
  return template;
}

function layerData(layer: TemplateLayer) {
  return (layer.data ?? {}) as Record<string, unknown>;
}

export async function buildTemplateBundle(template: Template) {
  const zip = new JSZip();
  const templateForBundle = cloneTemplate(template);
  const manifest: TemplateBundleManifest = {
    format: 'zaparoo-template-bundle',
    version: 1,
    exportedAt: new Date().toISOString(),
    templateId: template.id,
    templateName: template.name,
    assets: [],
    warnings: [],
  };

  templateForBundle.layers = templateForBundle.layers.map((layer) => {
    const data = layerData(layer);
    const imageDataUrl = typeof data.imageDataUrl === 'string' ? data.imageDataUrl : undefined;
    if (!imageDataUrl) return layer;

    const parsed = parseDataUrl(imageDataUrl);
    if (!parsed) {
      manifest.warnings.push(`${layer.id} 이미지 data URL을 bundle asset으로 변환하지 못했습니다.`);
      return layer;
    }

    const filename = `${safeFileName(String(data.imageName ?? layer.slot?.label ?? layer.id))}.${extensionForMime(parsed.mimeType)}`;
    const bundlePath = `assets/${layer.id}-${filename}`;
    if (parsed.isBase64) {
      zip.file(bundlePath, parsed.payload, { base64: true });
    } else {
      zip.file(bundlePath, decodeURIComponent(parsed.payload));
    }
    manifest.assets.push({
      assetId: String(data.imageAssetId ?? layer.id),
      filename,
      layerId: layer.id,
      slotId: layer.slot?.id,
      slotType: layer.slotType,
      mimeType: parsed.mimeType,
      bundlePath,
      originalSourcePath: typeof data.imageSourcePath === 'string' ? data.imageSourcePath : undefined,
    });

    const nextData = { ...data };
    delete nextData.imageDataUrl;
    nextData.imageBundlePath = bundlePath;
    return { ...layer, data: nextData };
  });

  zip.file('template.json', JSON.stringify(templateForBundle, null, 2));
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  return {
    blob: await zip.generateAsync({ type: 'blob' }),
    manifest,
  };
}

export async function parseTemplateBundle(file: File): Promise<{ template: Template; manifest: TemplateBundleManifest }> {
  const zip = await JSZip.loadAsync(file);
  const templateFile = zip.file('template.json');
  const manifestFile = zip.file('manifest.json');
  if (!templateFile || !manifestFile) throw new Error('template.json 또는 manifest.json이 없는 bundle입니다.');

  const template = JSON.parse(await templateFile.async('string')) as Template;
  const manifest = JSON.parse(await manifestFile.async('string')) as TemplateBundleManifest;
  if (manifest.format !== 'zaparoo-template-bundle') throw new Error('지원하지 않는 template bundle 형식입니다.');

  const assetsByLayer = new Map(manifest.assets.map((asset) => [asset.layerId, asset]));
  template.layers = await Promise.all(
    template.layers.map(async (layer) => {
      const asset = assetsByLayer.get(layer.id);
      if (!asset) return layer;
      const bundledFile = zip.file(asset.bundlePath);
      if (!bundledFile) return layer;
      const base64 = await bundledFile.async('base64');
      return {
        ...layer,
        data: {
          ...layer.data,
          imageDataUrl: `data:${asset.mimeType};base64,${base64}`,
          imageName: asset.filename,
          imageBundlePath: asset.bundlePath,
        },
      };
    }),
  );

  const now = new Date().toISOString();
  stripTemplateThumbnailMetadata(template);
  return {
    template: {
      ...template,
      id: `${template.id}_import_${Date.now()}`,
      name: `${template.name} (imported)`,
      builtIn: false,
      source: 'EDITOR',
      createdAt: now,
      updatedAt: now,
    },
    manifest,
  };
}
