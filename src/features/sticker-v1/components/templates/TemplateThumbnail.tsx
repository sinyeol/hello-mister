import { useMemo } from 'react';
import { CardPreview } from '@sticker-v1/components/cards/CardPreview';
import { templatePreviewCard } from '@sticker-v1/services/templates/templateThumbnailGeneration';
import type { CardItem, Template } from '@sticker-v1/types';
import { cardAspectRatio } from '@sticker-v1/utils/cardGeometry';
import { normalizeTemplateForRender } from '@sticker-v1/utils/templateRenderNormalize';

export function TemplateThumbnail({
  template,
  size,
  thumbnailUrl,
  thumbnailCacheKey,
  disablePreview = false,
}: {
  template: Template;
  size: number;
  thumbnailUrl?: string;
  thumbnailCacheKey?: string;
  disablePreview?: boolean;
}) {
  const renderTemplate = useMemo(() => normalizeTemplateForRender(template), [template]);
  const isLandscape = renderTemplate.canvas.orientation === 'landscape' || renderTemplate.canvas.width > renderTemplate.canvas.height;
  const aspectRatio = cardAspectRatio(renderTemplate.canvas);
  const frameWidth = isLandscape ? size : size * aspectRatio;
  const frameHeight = isLandscape ? size / aspectRatio : size;
  const previewCard: CardItem = useMemo(() => templatePreviewCard(renderTemplate), [renderTemplate]);

  if (disablePreview) return <TemplateThumbnailPlaceholder size={size} label="썸네일 없이 표시 중" />;

  return (
    <div className="flex w-full items-center justify-center bg-neutral-100 py-2" style={{ minHeight: frameHeight + 16 }}>
      <div className="overflow-hidden rounded bg-white shadow-sm" style={{ width: frameWidth, height: frameHeight }}>
        {thumbnailUrl ? (
          <img
            key={thumbnailCacheKey}
            src={thumbnailUrl}
            alt={`${renderTemplate.name} thumbnail`}
            className="h-full w-full object-contain object-center"
          />
        ) : (
          <CardPreview
            card={previewCard}
            assetsById={{}}
            templates={[renderTemplate]}
            side={renderTemplate.type}
            showGuides={false}
            hideCardOutline={false}
          />
        )}
      </div>
    </div>
  );
}

export function TemplateThumbnailPlaceholder({ size, label = '썸네일을 표시할 수 없습니다.' }: { size: number; label?: string }) {
  return (
    <div className="flex w-full items-center justify-center bg-neutral-100 py-2" style={{ minHeight: Math.round(size * 0.72) + 16 }}>
      <div
        className="grid place-items-center rounded border border-dashed border-neutral-300 bg-neutral-50 px-3 text-center text-xs font-medium text-neutral-500"
        style={{ width: size, height: Math.max(96, Math.round(size * 0.62)) }}
      >
        {label}
      </div>
    </div>
  );
}
