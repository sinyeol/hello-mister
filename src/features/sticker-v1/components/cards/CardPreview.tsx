import type { CardItem, Category, LocalAsset, Template, TemplateLayer } from '@sticker-v1/types';
import { TemplateShapeLayer } from '@sticker-v1/components/cards/TemplateShapeLayer';
import {
  cardOutlineRadiusCss,
  canvasCutOffsetPx,
  canvasInsetRectPercent,
  cuttingLineRadiusCss,
  getCardBackgroundColor,
  getStickerBackgroundColor,
  imageCornerRadiusCss,
  layerCornerRadiusCss,
  safeMarginInsetFromCardPx,
  safeMarginRadiusCss,
} from '@sticker-v1/utils/cardGeometry';
import { getTemplateLayerFrame, getTemplateLayerImageTransform, orderedTemplateLayers } from '@sticker-v1/utils/cardTemplateTransforms';
import { resolveAssetReference } from '@sticker-v1/utils/assetReferences';
import { templateForCardSide } from '@sticker-v1/utils/cardTemplateSnapshots';
import { isTemplateShapeLayer } from '@sticker-v1/utils/templateShapes';
import { imageCropInsetPercent, type ImageNaturalSize } from '@sticker-v1/utils/imageCrop';
import { layerEffectStyle } from '@sticker-v1/utils/layerEffects';
import { normalizeTemplateForRender } from '@sticker-v1/utils/templateRenderNormalize';

interface CardPreviewProps {
  card: CardItem;
  category?: Category;
  assetsById: Record<string, LocalAsset>;
  templates: Template[];
  side: 'front' | 'back';
  showGuides?: boolean;
  showCutLine?: boolean;
  showSafeMargin?: boolean;
  cutLineColor?: string;
  hideCardOutline?: boolean;
}

function layerStyle(layer: TemplateLayer, template: Template) {
  const effects = layerEffectStyle(layer);
  const effectOpacity = typeof effects.opacity === 'number' ? effects.opacity : 1;
  const frame = getTemplateLayerFrame(layer, template.canvas);
  return {
    left: `${(frame.x / template.canvas.width) * 100}%`,
    top: `${(frame.y / template.canvas.height) * 100}%`,
    width: `${(frame.width / template.canvas.width) * 100}%`,
    height: `${(frame.height / template.canvas.height) * 100}%`,
    opacity: (layer.opacity ?? 1) * effectOpacity,
    filter: effects.filter,
    boxShadow: effects.boxShadow,
    transform: `rotate(${layer.rotation ?? 0}deg)`,
    zIndex: layer.zIndex,
  };
}

function imageNaturalSizeForLayer(layer: TemplateLayer, asset?: LocalAsset): ImageNaturalSize {
  return {
    width: asset?.width ?? Number(layer.data?.imageNaturalWidth ?? 0),
    height: asset?.height ?? Number(layer.data?.imageNaturalHeight ?? 0),
  };
}

function imageTransformStyle(
  layer: TemplateLayer,
  template: Template,
  card: CardItem,
  side: 'front' | 'back',
  naturalSize?: ImageNaturalSize,
  resolvedTransform?: ReturnType<typeof getTemplateLayerImageTransform>,
) {
  const transform = resolvedTransform ?? getTemplateLayerImageTransform(layer, card, side);
  const templateTransform = layer.data?.imageTransform as { opacity?: number } | undefined;
  const cropInset = imageCropInsetPercent(transform, naturalSize);
  const frame = getTemplateLayerFrame(layer, template.canvas);
  return {
    left: `${(transform.x / frame.width) * 100}%`,
    top: `${(transform.y / frame.height) * 100}%`,
    width: `${(transform.width / frame.width) * 100}%`,
    height: `${(transform.height / frame.height) * 100}%`,
    opacity: templateTransform?.opacity ?? 1,
    transform: `rotate(${transform.rotation ?? 0}deg)`,
    transformOrigin: 'top left',
    clipPath: `inset(${cropInset.top}% ${cropInset.right}% ${cropInset.bottom}% ${cropInset.left}%)`,
    borderRadius: imageCornerRadiusCss(layer, template.canvas, { width: transform.width, height: transform.height }),
  };
}

function slotText(layer: TemplateLayer, card: CardItem, side: 'front' | 'back') {
  if (layer.slotType === 'categoryLabel') return side === 'front' ? card.front.categoryLabel : card.back.categoryLabel;
  if (layer.slotType === 'platformLabel') return card.front.platformLabel;
  if (layer.slotType === 'brandText') return 'Hello Mister';
  if (layer.slotType === 'titleText') return card.front.titleText;
  if (layer.slotType === 'gameLogo') return card.front.titleText;
  if (layer.slotType === 'platformLogo') return card.front.platformLabel;
  if (layer.slotType === 'heroImage' || layer.slotType === 'mainImage' || layer.slotType === 'backgroundArt' || layer.slotType === 'background') return '이미지 없음';
  if (layer.data?.text) return String(layer.data.text);
  return layer.slot?.label ?? layer.slotType ?? '';
}

function slotAsset(layer: TemplateLayer, card: CardItem, assetsById: Record<string, LocalAsset>, side: 'front' | 'back') {
  if (side === 'back' && (layer.slotType === 'backgroundArt' || layer.slotType === 'heroImage' || layer.slotType === 'background' || layer.slotType === 'mainImage')) {
    return resolveAssetReference(assetsById, card.back.backgroundImageAssetId, card.back.backgroundImageAssetRef);
  }
  if (side === 'back' && (layer.slotType === 'titleImage' || layer.slotType === 'gameLogo' || layer.slotType === 'brandLogo' || layer.slotType === 'platformLogo')) {
    return resolveAssetReference(assetsById, card.back.brandLogoAssetId, card.back.brandLogoAssetRef);
  }
  if (layer.slotType === 'heroImage' || layer.slotType === 'mainImage') {
    return resolveAssetReference(assetsById, card.front.heroImageAssetId, card.front.heroImageAssetRef);
  }
  if (layer.slotType === 'titleImage' || layer.slotType === 'gameLogo') {
    return resolveAssetReference(assetsById, card.front.titleImageAssetId, card.front.titleImageAssetRef);
  }
  if (layer.slotType === 'brandLogo' || layer.slotType === 'platformLogo') {
    const assetId = side === 'front' ? card.front.brandLogoAssetId : card.back.brandLogoAssetId;
    const assetRef = side === 'front' ? card.front.brandLogoAssetRef : card.back.brandLogoAssetRef;
    return resolveAssetReference(assetsById, assetId, assetRef);
  }
  if (layer.slotType === 'background') {
    return resolveAssetReference(assetsById, card.front.backgroundImageAssetId, card.front.backgroundImageAssetRef);
  }
  return undefined;
}

function templateImageDataUrl(layer: TemplateLayer) {
  return typeof layer.data?.imageDataUrl === 'string' ? layer.data.imageDataUrl : undefined;
}

const loggedBackTemplateImageDiagnostics = new Set<string>();

function logBackTemplateImageDiagnostics(card: CardItem, template: Template, layer: TemplateLayer, transform: ReturnType<typeof getTemplateLayerImageTransform>) {
  if (typeof window === 'undefined' || !['localhost', '127.0.0.1'].includes(window.location.hostname)) return;
  if (template.type !== 'back' || !layer.slotType) return;
  const key = `${card.id}:${template.id}:${layer.id}:${JSON.stringify({
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height,
    slot: layer.slot ? { x: layer.slot.x, y: layer.slot.y, width: layer.slot.width, height: layer.slot.height } : undefined,
    transform,
  })}`;
  if (loggedBackTemplateImageDiagnostics.has(key)) return;
  loggedBackTemplateImageDiagnostics.add(key);
  console.debug('[CardPreview] back template image bounds', {
    cardId: card.id,
    templateId: template.id,
    templateName: template.name,
    templateSide: template.type,
    canvas: template.canvas,
    layerId: layer.id,
    slotType: layer.slotType,
    layerBounds: getTemplateLayerFrame(layer, template.canvas),
    slotBounds: layer.slot ? { x: layer.slot.x, y: layer.slot.y, width: layer.slot.width, height: layer.slot.height } : undefined,
    savedImageTransform: layer.data?.imageTransform,
    resolvedImageTransform: transform,
  });
}

export function CardPreview({
  card,
  category,
  assetsById,
  templates,
  side,
  showGuides = false,
  showCutLine = false,
  showSafeMargin = false,
  cutLineColor = '#E53935',
  hideCardOutline = false,
}: CardPreviewProps) {
  const palette = category?.palette ?? {
    primary: '#111111',
    secondary: '#f5f5f5',
    accent: '#f36c21',
    neutral: '#d9d9d9',
  };
  const rawTemplate = templateForCardSide(card, templates, side);

  if (!rawTemplate) {
    return (
      <div
        className="flex aspect-[53.98/85.6] w-full items-center justify-center overflow-hidden rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-4 text-center text-xs font-medium text-neutral-500 shadow-surface"
      >
        템플릿 없음
      </div>
    );
  }
  const template = normalizeTemplateForRender(rawTemplate);

  const showCutGuide = showGuides || showCutLine;
  const showSafeGuide = showGuides || showSafeMargin;

  return (
    <div
      className={`relative w-full ${
        hideCardOutline
          ? 'overflow-hidden border-0 shadow-none'
          : showGuides
            ? 'overflow-visible border-2 border-neutral-900 shadow-surface'
            : 'overflow-hidden border border-line shadow-surface'
      }`}
      style={{
        aspectRatio: `${template.canvas.width} / ${template.canvas.height}`,
        background: getCardBackgroundColor(template.canvas, palette.secondary),
        borderRadius: cardOutlineRadiusCss(template.canvas),
      }}
    >
      {showCutGuide && (
        <div
          className="pointer-events-none absolute z-40 border-2 shadow-[0_0_0_1px_rgba(255,255,255,0.85)]"
          style={{
            ...canvasInsetRectPercent(canvasCutOffsetPx(template.canvas), template.canvas),
            borderColor: cutLineColor,
            borderRadius: cuttingLineRadiusCss(template.canvas),
          }}
        />
      )}
      {showSafeGuide && (
        <div
          className="pointer-events-none absolute z-40 border border-dashed border-neutral-950/90 shadow-[0_0_0_1px_rgba(255,255,255,0.9)]"
          style={{
            ...canvasInsetRectPercent(safeMarginInsetFromCardPx(template.canvas), template.canvas),
            borderRadius: safeMarginRadiusCss(template.canvas),
          }}
        />
      )}
      <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
        <div
          className="pointer-events-none absolute"
          style={{
            ...canvasInsetRectPercent(canvasCutOffsetPx(template.canvas), template.canvas),
            background: getStickerBackgroundColor(template.canvas, palette.secondary),
            borderRadius: cuttingLineRadiusCss(template.canvas),
            zIndex: 0,
          }}
        />
        {orderedTemplateLayers(template).map((layer) => {
          if (layer.data?.visible === false) return null;
          if (layer.type === 'background') {
            return null;
          }
          if (isTemplateShapeLayer(layer)) {
            return (
              <div key={layer.id} className="absolute" style={layerStyle(layer, template)}>
                <TemplateShapeLayer layer={layer} canvas={template.canvas} />
              </div>
            );
          }
          const imageDataUrl = templateImageDataUrl(layer);
          const asset = imageDataUrl ? undefined : slotAsset(layer, card, assetsById, side);
          const imageTransform = getTemplateLayerImageTransform(layer, card, side);
          if (side === 'back' && (imageDataUrl || asset)) logBackTemplateImageDiagnostics(card, template, layer, imageTransform);
          const text = slotText(layer, card, side);
          return (
            <div
              key={layer.id}
              className="absolute flex items-center justify-center overflow-hidden px-1 text-center text-[10px] font-semibold"
              style={{
                ...layerStyle(layer, template),
                background: layer.fill ?? (asset || imageDataUrl ? 'transparent' : 'rgba(255,255,255,0.35)'),
                borderRadius: layerCornerRadiusCss(layer, template.canvas),
                color: layer.data?.color ? String(layer.data.color) : palette.neutral,
              }}
            >
              {asset?.objectUrl ? (
                <img
                  src={asset.objectUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="absolute max-w-none"
                  style={imageTransformStyle(layer, template, card, side, imageNaturalSizeForLayer(layer, asset), imageTransform)}
                />
              ) : imageDataUrl ? (
                <img
                  src={imageDataUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="absolute max-w-none object-cover"
                  style={imageTransformStyle(layer, template, card, side, imageNaturalSizeForLayer(layer), imageTransform)}
                />
              ) : layer.slotType === 'titleImage' || layer.slotType === 'gameLogo' ? (
                card.front.titleText
              ) : (
                text
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
