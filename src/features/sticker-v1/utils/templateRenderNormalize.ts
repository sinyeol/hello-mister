import type { Template, TemplateCanvas, TemplateCornerRadii, TemplateFillStyle, TemplateLayer, TemplateLayerType, TemplateSource, TemplateType } from '@sticker-v1/types';
import { defaultCardBackgroundColor, defaultStickerBackgroundColor, defaultTemplateCanvas } from '@sticker-v1/utils/cardGeometry';

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeCornerRadii(value: unknown, fallback = 0): TemplateCornerRadii {
  if (value && typeof value === 'object') {
    const radii = value as Partial<TemplateCornerRadii>;
    return {
      topLeft: finiteNumber(radii.topLeft, fallback),
      topRight: finiteNumber(radii.topRight, fallback),
      bottomRight: finiteNumber(radii.bottomRight, fallback),
      bottomLeft: finiteNumber(radii.bottomLeft, fallback),
    };
  }
  return {
    topLeft: fallback,
    topRight: fallback,
    bottomRight: fallback,
    bottomLeft: fallback,
  };
}

function textureFallback(style: Extract<TemplateFillStyle, { type: 'texture' }>): TemplateFillStyle {
  const first = style.color ?? style.textureParams?.color1;
  const second = style.secondaryColor ?? style.textureParams?.color2;
  if (first && second && first !== second) {
    return { type: 'linearGradient', colors: [first, second], angle: style.textureParams?.angle ?? 45, opacity: style.opacity };
  }
  return { type: 'solid', color: first ?? second ?? '#ffffff', opacity: style.opacity };
}

function normalizeFillStyle(style: unknown): unknown {
  if (!style || typeof style !== 'object') return style;
  const fillStyle = style as TemplateFillStyle;
  if (fillStyle.type === 'texture') return textureFallback(fillStyle);
  if (fillStyle.type === 'linearGradient' || fillStyle.type === 'radialGradient') {
    const colors = Array.isArray(fillStyle.colors) ? fillStyle.colors : ['#ffffff', '#e5e7eb'];
    return {
      ...fillStyle,
      colors: [String(colors[0] ?? '#ffffff'), String(colors[1] ?? '#e5e7eb')],
    };
  }
  if (fillStyle.type === 'solid') return { ...fillStyle, color: fillStyle.color ?? '#ffffff' };
  if (fillStyle.type === 'none') return fillStyle;
  return style;
}

function normalizeLayer(layer: Partial<TemplateLayer>, canvas: TemplateCanvas, index: number): TemplateLayer {
  const data = { ...(layer.data ?? {}) };
  data.fillStyle = normalizeFillStyle(data.fillStyle);
  if (!Array.isArray(data.effects)) data.effects = [];
  const cornerFallback = finiteNumber(layer.cornerRadius, 0);
  const normalizedX = finiteNumber(layer.x, finiteNumber(layer.slot?.x, 0));
  const normalizedY = finiteNumber(layer.y, finiteNumber(layer.slot?.y, 0));
  const normalizedWidth = finiteNumber(layer.width, finiteNumber(layer.slot?.width, canvas.width));
  const normalizedHeight = finiteNumber(layer.height, finiteNumber(layer.slot?.height, canvas.height));
  const layerType: TemplateLayerType =
    layer.type === 'background' || layer.type === 'slot' || layer.type === 'shape' || layer.type === 'text' || layer.type === 'image' || layer.type === 'overlay'
      ? layer.type
      : 'slot';
  return {
    ...layer,
    id: layer.id || `recovered-layer-${index}`,
    type: layerType,
    x: normalizedX,
    y: normalizedY,
    width: normalizedWidth,
    height: normalizedHeight,
    rotation: finiteNumber(layer.rotation, 0),
    opacity: finiteNumber(layer.opacity, 1),
    cornerRadius: cornerFallback,
    cornerRadii: normalizeCornerRadii(layer.cornerRadii, cornerFallback),
    cornerRadiiMm: normalizeCornerRadii(layer.cornerRadiiMm, finiteNumber(layer.cornerRadiusMm, 0)),
    fill: layer.fill,
    stroke: layer.stroke,
    data,
    slot: layer.slot
      ? {
          ...layer.slot,
          x: finiteNumber(layer.slot.x, normalizedX),
          y: finiteNumber(layer.slot.y, normalizedY),
          width: finiteNumber(layer.slot.width, normalizedWidth),
          height: finiteNumber(layer.slot.height, normalizedHeight),
          cornerRadius: finiteNumber(layer.slot.cornerRadius, cornerFallback),
        }
      : layer.slot,
  } as TemplateLayer;
}

export function normalizeTemplateForRender(template: Partial<Template> | null | undefined): Template {
  const sourceTemplate = template ?? {};
  const sourceLayers = Array.isArray(sourceTemplate.layers) ? sourceTemplate.layers : [];
  const legacyBackgroundLayer = sourceLayers.find((layer) => layer?.type === 'background');
  const cardBackgroundColor = sourceTemplate.canvas?.cardBackgroundColor ?? sourceTemplate.canvas?.cardColor ?? defaultCardBackgroundColor;
  const stickerBackgroundColor = sourceTemplate.canvas?.stickerBackgroundColor ?? legacyBackgroundLayer?.fill ?? cardBackgroundColor ?? defaultStickerBackgroundColor;
  const cuttingLineRadiusMm = finiteNumber(
    sourceTemplate.canvas?.cuttingLineRadiusMm,
    finiteNumber(sourceTemplate.canvas?.cornerRadiusMm, defaultTemplateCanvas.cornerRadiusMm),
  );
  const canvas: TemplateCanvas = {
    ...defaultTemplateCanvas,
    ...(sourceTemplate.canvas ?? {}),
    width: finiteNumber(sourceTemplate.canvas?.width, defaultTemplateCanvas.width),
    height: finiteNumber(sourceTemplate.canvas?.height, defaultTemplateCanvas.height),
    safeMargin: finiteNumber(sourceTemplate.canvas?.safeMargin, 0),
    cornerRadius: finiteNumber(sourceTemplate.canvas?.cornerRadius, 0),
    cardBackgroundColor,
    cardColor: cardBackgroundColor,
    stickerBackgroundColor,
    cuttingLineRadiusMm,
    cornerRadiusMm: cuttingLineRadiusMm,
  };
  const layers = sourceLayers.map((layer, index) => normalizeLayer(layer, canvas, index));
  const templateType: TemplateType = sourceTemplate.type === 'back' ? 'back' : 'front';
  const templateSource: TemplateSource =
    sourceTemplate.source === 'UPLOADED' || sourceTemplate.source === 'LEGACY_BUILT_IN' || sourceTemplate.source === 'EDITOR'
      ? sourceTemplate.source
      : 'EDITOR';
  return {
    ...sourceTemplate,
    id: sourceTemplate.id ?? `template-recovered-${Date.now()}`,
    name: sourceTemplate.name || 'Recovered Template',
    type: templateType,
    source: templateSource,
    canvas,
    layers,
    slots: Array.isArray(sourceTemplate.slots) ? sourceTemplate.slots : layers.map((layer) => layer.slot).filter(Boolean) as Template['slots'],
    thumbnailStatus: sourceTemplate.thumbnailStatus ?? 'ready',
  };
}
