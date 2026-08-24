import type { ShapeLayer, TemplateCanvas, TemplateFillStyle, TemplateLayer, TemplateShapeType } from '@sticker-v1/types';
import { canvasPxToMm, clampedLayerCornerRadiusPx, mmToCanvasPx, normalizeCornerRadiiMm, uniformCornerRadii } from '@sticker-v1/utils/cardGeometry';

export type TemplateShapeKind = TemplateShapeType;
export const defaultShapeRadiusMm = 3;
export const defaultShapeStrokeWidthPx = 2;
export const minShapeSizePx = 1;

export function templateShapeKind(layer?: TemplateLayer): TemplateShapeKind {
  const value = String(layer?.data?.shapeType ?? layer?.data?.shapeKind ?? '');
  if (value === 'rounded-rectangle') return 'roundedRectangle';
  if (value === 'roundedRectangle' || value === 'ellipse' || value === 'line') return value;
  return 'rectangle';
}

export function isTemplateShapeLayer(layer?: TemplateLayer) {
  return layer?.type === 'shape';
}

export function templateShapeFillValue(layer: TemplateLayer) {
  return isTemplateShapeFillTransparent(layer) ? 'none' : templateShapePaintValue(layer);
}

function templateShapePaintValue(layer: TemplateLayer) {
  const fillStyle = templateShapeFillStyle(layer);
  if (fillStyle.type === 'solid') return fillStyle.color;
  return layer.fill ?? '#ffffff';
}

function legacyTextureFallbackFillStyle(style: Extract<TemplateFillStyle, { type: 'texture' }>, layer: TemplateLayer): TemplateFillStyle {
  const primary = style.color ?? style.textureParams?.color1 ?? layer.fill ?? '#ffffff';
  const secondary = style.secondaryColor ?? style.textureParams?.color2;
  if (secondary && secondary !== primary) {
    return {
      type: 'linearGradient',
      colors: [primary, secondary],
      angle: Number(style.textureParams?.angle ?? 45),
      opacity: style.opacity,
    };
  }
  return { type: 'solid', color: primary, opacity: style.opacity };
}

export function templateShapeFillStyle(layer: TemplateLayer): TemplateFillStyle {
  const value = layer.data?.fillStyle;
  if (value && typeof value === 'object' && 'type' in value) {
    const style = value as TemplateFillStyle;
    if (style.type === 'texture') return legacyTextureFallbackFillStyle(style, layer);
    if (style.type === 'none' || style.type === 'solid' || style.type === 'linearGradient' || style.type === 'radialGradient') {
      return style;
    }
  }
  if (isTemplateShapeFillTransparent(layer)) return { type: 'none' };
  return { type: 'solid', color: layer.fill ?? '#ffffff' };
}

export function templateShapeStrokeValue(layer: TemplateLayer) {
  return layer.data?.strokeNone === true ? 'transparent' : (layer.stroke ?? '#111827');
}

export function templateShapeStrokeWidth(layer: TemplateLayer) {
  return layer.data?.strokeNone === true ? 0 : Math.max(0, Number(layer.data?.strokeWidth ?? defaultShapeStrokeWidthPx));
}

function cssColorHasZeroAlpha(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === '' || normalized === 'none' || normalized === 'transparent') return true;
  if (/^#(?:[0-9a-f]{4}|[0-9a-f]{8})$/i.test(normalized)) {
    const alphaHex = normalized.length === 5 ? normalized[4] + normalized[4] : normalized.slice(7, 9);
    return Number.parseInt(alphaHex, 16) === 0;
  }
  const rgbaMatch = normalized.match(/^rgba?\((.*)\)$/);
  if (!rgbaMatch) return false;
  const parts = rgbaMatch[1].split(/[,/]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 4) return false;
  const alpha = parts[3].endsWith('%') ? Number.parseFloat(parts[3]) / 100 : Number.parseFloat(parts[3]);
  return Number.isFinite(alpha) && alpha <= 0;
}

export function isTemplateShapeFillTransparent(layer: TemplateLayer) {
  if (layer.data?.fillNone === true) return true;
  const fillStyle = layer.data?.fillStyle as Partial<TemplateFillStyle> | undefined;
  if (fillStyle?.type === 'none') return true;
  const fillOpacity = Number(layer.data?.fillOpacity ?? layer.data?.opacityFill);
  if (Number.isFinite(fillOpacity) && fillOpacity <= 0) return true;
  if (layer.fill === null || layer.fill === undefined) return true;
  return cssColorHasZeroAlpha(String(layer.fill));
}

export function templateShapeStrokeWidthMm(layer: TemplateLayer, canvas: Pick<TemplateCanvas, 'width' | 'height' | 'orientation'>) {
  return canvasPxToMm(templateShapeStrokeWidth(layer), canvas);
}

export function templateShapeRadiusPx(layer: TemplateLayer, canvas: TemplateCanvas) {
  const kind = templateShapeKind(layer);
  if (kind === 'ellipse') return Math.min(layer.width ?? canvas.width, layer.height ?? canvas.height) / 2;
  if (kind === 'line') return 0;
  return clampedLayerCornerRadiusPx(layer, canvas);
}

export function normalizeShapeLayer(layer: TemplateLayer, canvas: TemplateCanvas, fallbackName = 'Shape'): ShapeLayer {
  const shapeType = templateShapeKind(layer);
  const radiusMm =
    layer.cornerRadiusMm ??
    (Number.isFinite(Number(layer.cornerRadius)) ? canvasPxToMm(Number(layer.cornerRadius), canvas) : defaultShapeRadiusMm);
  const nextRadiusMm = shapeType === 'roundedRectangle' ? radiusMm : (Number.isFinite(radiusMm) ? radiusMm : defaultShapeRadiusMm);
  const supportsCornerRadius = shapeType === 'rectangle' || shapeType === 'roundedRectangle';
  const cornerRadiiMm = supportsCornerRadius
    ? normalizeCornerRadiiMm({ ...layer, cornerRadiusMm: nextRadiusMm }, canvas)
    : uniformCornerRadii(0);
  const x = Number.isFinite(Number(layer.x)) ? Number(layer.x) : 160;
  const y = Number.isFinite(Number(layer.y)) ? Number(layer.y) : 220;
  const width = Math.max(minShapeSizePx, Number.isFinite(Number(layer.width)) ? Number(layer.width) : (shapeType === 'line' ? 360 : 260));
  const height = Math.max(minShapeSizePx, Number.isFinite(Number(layer.height)) ? Number(layer.height) : (shapeType === 'line' ? 8 : 180));
  return {
    ...layer,
    type: 'shape',
    slot: undefined,
    slotType: undefined,
    x,
    y,
    width,
    height,
    rotation: layer.rotation ?? 0,
    opacity: layer.opacity ?? 1,
    fill: layer.data?.fillNone === true ? (layer.fill ?? '#ffffff') : (layer.fill ?? (shapeType === 'line' ? 'transparent' : '#ffffff')),
    stroke: layer.stroke ?? '#111827',
    cornerRadiusMm: nextRadiusMm,
    cornerRadius: mmToCanvasPx(nextRadiusMm, canvas),
    cornerRadiiMm,
    cornerRadii: {
      topLeft: mmToCanvasPx(cornerRadiiMm.topLeft, canvas),
      topRight: mmToCanvasPx(cornerRadiiMm.topRight, canvas),
      bottomRight: mmToCanvasPx(cornerRadiiMm.bottomRight, canvas),
      bottomLeft: mmToCanvasPx(cornerRadiiMm.bottomLeft, canvas),
    },
    data: {
      ...layer.data,
      kind: 'shape',
      shapeType,
      shapeKind: shapeType,
      label: String(layer.data?.label ?? fallbackName),
      visible: layer.data?.visible === false ? false : true,
      cornerRadiiMm,
      fillStyle: (layer.data?.fillStyle as TemplateFillStyle | undefined) ?? (layer.data?.fillNone === true ? { type: 'none' } : undefined),
      strokeWidth: Number.isFinite(Number(layer.data?.strokeWidth)) ? Number(layer.data?.strokeWidth) : (shapeType === 'line' ? 3 : defaultShapeStrokeWidthPx),
    },
  };
}
