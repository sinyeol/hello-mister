import type { CardItem, Template } from '@sticker-v1/types';
import { renderCardPng } from '@sticker-v1/services/export/exportPng';
import { saveTemplateThumbnailBlob } from '@sticker-v1/services/templates/templateThumbnailCache';
import { normalizeTemplateForRender } from '@sticker-v1/utils/templateRenderNormalize';

export const TEMPLATE_THUMBNAIL_RENDER_VERSION = 1;

export interface TemplateThumbnailGenerationResult {
  status: 'ready' | 'failed';
  blob?: Blob;
  cacheKey?: string;
  version: number;
  updatedAt?: string;
  error?: string;
}

function isDevelopmentHost() {
  return typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
}

function logTemplateThumbnail(message: string, detail: Record<string, unknown>) {
  if (!isDevelopmentHost()) return;
  console.debug('[Template thumbnail]', message, detail);
}

export function makeTemplateThumbnailCacheKey(templateId: string, timestamp = new Date().toISOString()) {
  return `template-thumb:v${TEMPLATE_THUMBNAIL_RENDER_VERSION}:${templateId}:${timestamp}:${Math.random().toString(36).slice(2, 8)}`;
}

export function templatePreviewCard(template: Template): CardItem {
  const renderTemplate = normalizeTemplateForRender(template);
  return {
    id: `template-preview-${renderTemplate.id}`,
    gameId: `template-preview-game-${renderTemplate.id}`,
    categoryId: 'template-preview',
    layoutMode: 'CUSTOM',
    printOrder: 0,
    coordinateLockKey: `template-preview:${renderTemplate.id}`,
    front: {
      side: 'front',
      titleText: renderTemplate.name,
      templateId: renderTemplate.type === 'front' ? renderTemplate.id : undefined,
      platformLabel: '템플릿',
      categoryLabel: '템플릿',
    },
    back: {
      side: 'back',
      templateId: renderTemplate.type === 'back' ? renderTemplate.id : undefined,
      categoryId: 'template-preview',
      categoryLabel: '템플릿',
      generatedFallback: false,
    },
  };
}

function templateForThumbnail(template: Template): Template {
  const normalizedTemplate = normalizeTemplateForRender(template);
  return {
    ...normalizedTemplate,
    canvas: {
      ...normalizedTemplate.canvas,
      printCardColor: true,
    },
  };
}

export async function regenerateTemplateThumbnail(
  template: Template,
  options: { oldCacheKey?: string; dpi?: number } = {},
): Promise<TemplateThumbnailGenerationResult> {
  const sourceTemplate = normalizeTemplateForRender(template);
  const updatedAt = new Date().toISOString();
  const cacheKey = makeTemplateThumbnailCacheKey(sourceTemplate.id, updatedAt);
  const renderTemplate = templateForThumbnail(sourceTemplate);

  logTemplateThumbnail('generation started', {
    templateId: sourceTemplate.id,
    templateName: sourceTemplate.name,
    templateUpdatedAt: sourceTemplate.updatedAt,
    oldThumbnailCacheKey: options.oldCacheKey,
    newThumbnailCacheKey: cacheKey,
    rendererVersion: TEMPLATE_THUMBNAIL_RENDER_VERSION,
  });

  try {
    const blob = await renderCardPng(
      templatePreviewCard(renderTemplate),
      undefined,
      {},
      [renderTemplate],
      renderTemplate.type,
      { cardTitle: renderTemplate.name, dpi: options.dpi ?? 150, showCutLine: false },
    );

    if (!blob || blob.size <= 0) throw new Error('Generated thumbnail blob is empty.');

    await saveTemplateThumbnailBlob(sourceTemplate.id, blob, cacheKey);
    logTemplateThumbnail('generation ready', {
      templateId: sourceTemplate.id,
      templateName: sourceTemplate.name,
      templateUpdatedAt: sourceTemplate.updatedAt,
      oldThumbnailCacheKey: options.oldCacheKey,
      newThumbnailCacheKey: cacheKey,
      thumbnailBlobSize: blob.size,
      rendererVersion: TEMPLATE_THUMBNAIL_RENDER_VERSION,
    });

    return {
      status: 'ready',
      blob,
      cacheKey,
      version: TEMPLATE_THUMBNAIL_RENDER_VERSION,
      updatedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown template thumbnail render error';
    logTemplateThumbnail('generation failed', {
      templateId: sourceTemplate.id,
      templateName: sourceTemplate.name,
      templateUpdatedAt: sourceTemplate.updatedAt,
      oldThumbnailCacheKey: options.oldCacheKey,
      newThumbnailCacheKey: cacheKey,
      rendererVersion: TEMPLATE_THUMBNAIL_RENDER_VERSION,
      error: message,
    });
    return {
      status: 'failed',
      version: TEMPLATE_THUMBNAIL_RENDER_VERSION,
      error: message,
    };
  }
}
