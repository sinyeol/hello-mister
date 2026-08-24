import type { CardItem, SlotOverride, Template, TemplateCanvas, TemplateLayer } from '@sticker-v1/types';
import type { ImageTransform } from '@sticker-v1/utils/imageTransform';

const imageSlotTypes = new Set([
  'mainImage',
  'gameLogo',
  'background',
  'platformLogo',
  'heroImage',
  'titleImage',
  'brandLogo',
  'backgroundArt',
]);

export function orderedTemplateLayers(template: Template) {
  return [...template.layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
}

export function isTemplateImageLayer(layer?: TemplateLayer) {
  return Boolean(layer?.slotType && imageSlotTypes.has(layer.slotType));
}

export function getLayerOverrideKey(layer: TemplateLayer) {
  return layer.id;
}

export function getCardLayerOverride(card: CardItem, layer: TemplateLayer, side: 'front' | 'back') {
  const overrides = side === 'front' ? card.front.slotOverrides : card.back.slotOverrides;
  return overrides?.[getLayerOverrideKey(layer)] ?? (layer.slotType ? overrides?.[layer.slotType] : undefined);
}

export function getTemplateLayerSavedImageTransform(layer: TemplateLayer) {
  return layer.data?.imageTransform as Partial<ImageTransform> | undefined;
}

function finiteLayerNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function layerRenderWidth(layer: TemplateLayer) {
  return Math.max(1, finiteLayerNumber(layer.width, finiteLayerNumber(layer.slot?.width, 1)));
}

function layerRenderHeight(layer: TemplateLayer) {
  return Math.max(1, finiteLayerNumber(layer.height, finiteLayerNumber(layer.slot?.height, 1)));
}

export function getTemplateLayerFrame(layer: TemplateLayer, canvas?: Pick<TemplateCanvas, 'width' | 'height'>) {
  return {
    x: finiteLayerNumber(layer.x, finiteLayerNumber(layer.slot?.x, 0)),
    y: finiteLayerNumber(layer.y, finiteLayerNumber(layer.slot?.y, 0)),
    width: Math.max(1, finiteLayerNumber(layer.width, finiteLayerNumber(layer.slot?.width, canvas?.width ?? 1))),
    height: Math.max(1, finiteLayerNumber(layer.height, finiteLayerNumber(layer.slot?.height, canvas?.height ?? 1))),
  };
}

export function hasTemplateLayerSavedImageTransform(layer: TemplateLayer) {
  const transform = getTemplateLayerSavedImageTransform(layer);
  if (!transform || typeof transform !== 'object') return false;
  return [
    transform.x,
    transform.y,
    transform.width,
    transform.height,
    transform.scaleX,
    transform.scaleY,
    transform.rotation,
    transform.cropTop,
    transform.cropRight,
    transform.cropBottom,
    transform.cropLeft,
  ].some((value) => Number.isFinite(Number(value))) || typeof transform.fitMode === 'string';
}

export function getTemplateLayerImageTransform(
  layer: TemplateLayer,
  card?: CardItem,
  side: 'front' | 'back' = 'front',
): ImageTransform {
  const cardOverride = card ? getCardLayerOverride(card, layer, side) : undefined;
  const templateTransform = getTemplateLayerSavedImageTransform(layer);
  const fallbackWidth = layerRenderWidth(layer);
  const fallbackHeight = layerRenderHeight(layer);
  return {
    x: cardOverride?.x ?? templateTransform?.x ?? 0,
    y: cardOverride?.y ?? templateTransform?.y ?? 0,
    width: cardOverride?.width ?? templateTransform?.width ?? fallbackWidth,
    height: cardOverride?.height ?? templateTransform?.height ?? fallbackHeight,
    scaleX: cardOverride?.scaleX ?? templateTransform?.scaleX ?? 1,
    scaleY: cardOverride?.scaleY ?? cardOverride?.scaleX ?? templateTransform?.scaleY ?? templateTransform?.scaleX ?? 1,
    fitMode: cardOverride?.fitMode ?? templateTransform?.fitMode,
    rotation: cardOverride?.rotation ?? templateTransform?.rotation ?? 0,
    cropTop: cardOverride?.cropTop ?? templateTransform?.cropTop ?? 0,
    cropRight: cardOverride?.cropRight ?? templateTransform?.cropRight ?? 0,
    cropBottom: cardOverride?.cropBottom ?? templateTransform?.cropBottom ?? 0,
    cropLeft: cardOverride?.cropLeft ?? templateTransform?.cropLeft ?? 0,
  };
}

export function toSlotOverride(transform: ImageTransform, fitMode?: SlotOverride['fitMode']): SlotOverride {
  return {
    x: transform.x,
    y: transform.y,
    width: transform.width,
    height: transform.height,
    scaleX: transform.scaleX ?? 1,
    scaleY: transform.scaleY ?? transform.scaleX ?? 1,
    rotation: transform.rotation,
    fitMode,
    cropTop: transform.cropTop,
    cropRight: transform.cropRight,
    cropBottom: transform.cropBottom,
    cropLeft: transform.cropLeft,
  };
}
