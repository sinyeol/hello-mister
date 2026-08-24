import type { TemplateCanvas, TemplateCornerRadii, TemplateLayer } from '@sticker-v1/types';

export const id1CardWidthMm = 85.6;
export const id1CardHeightMm = 53.98;
export const id1CardCornerRadiusMm = 3.18;

export const cardPhysicalSizeMm = {
  width: id1CardHeightMm,
  height: id1CardWidthMm,
};

export const fixedCardOutlineRadiusMm = id1CardCornerRadiusMm;

export const defaultCardBackgroundColor = '#111111';
export const defaultStickerBackgroundColor = '#111111';

export const defaultTemplateCanvas = {
  width: 900,
  height: 1427,
  orientation: 'portrait' as const,
  cornerRadiusMm: id1CardCornerRadiusMm,
  cuttingLineRadiusMm: id1CardCornerRadiusMm,
  cutOffsetMm: 1,
  safeMarginMm: 1,
  visualMargin: 32,
  cardBackgroundColor: defaultCardBackgroundColor,
  cardColor: defaultCardBackgroundColor,
  stickerBackgroundColor: defaultStickerBackgroundColor,
};

export function getCardBackgroundColor(canvas: Pick<TemplateCanvas, 'cardBackgroundColor' | 'cardColor'>, fallback = defaultCardBackgroundColor) {
  return canvas.cardBackgroundColor ?? canvas.cardColor ?? fallback;
}

export function getStickerBackgroundColor(
  canvas: Pick<TemplateCanvas, 'stickerBackgroundColor' | 'cardBackgroundColor' | 'cardColor'>,
  fallback = defaultStickerBackgroundColor,
) {
  return canvas.stickerBackgroundColor ?? fallback ?? getCardBackgroundColor(canvas);
}

export function getCuttingLineRadiusMm(canvas: Pick<TemplateCanvas, 'cuttingLineRadiusMm' | 'cornerRadiusMm'> = defaultTemplateCanvas) {
  return canvas.cuttingLineRadiusMm ?? canvas.cornerRadiusMm ?? id1CardCornerRadiusMm;
}

export function cardPhysicalSizeForCanvas(canvas: Pick<TemplateCanvas, 'width' | 'height' | 'orientation'> = defaultTemplateCanvas) {
  const orientation = canvas.orientation ?? (canvas.width > canvas.height ? 'landscape' : 'portrait');
  return orientation === 'landscape'
    ? { width: id1CardWidthMm, height: id1CardHeightMm }
    : cardPhysicalSizeMm;
}

export function cardAspectRatio(canvas: Pick<TemplateCanvas, 'width' | 'height' | 'orientation'> = defaultTemplateCanvas) {
  const physicalSize = cardPhysicalSizeForCanvas(canvas);
  return physicalSize.width / physicalSize.height;
}

export function getCanvasPxPerMm(canvas: Pick<TemplateCanvas, 'width' | 'height' | 'orientation'> = defaultTemplateCanvas) {
  const physicalSize = cardPhysicalSizeForCanvas(canvas);
  const xPxPerMm = canvas.width / physicalSize.width;
  const yPxPerMm = canvas.height / physicalSize.height;
  return {
    xPxPerMm,
    yPxPerMm,
    pxPerMm: (xPxPerMm + yPxPerMm) / 2,
  };
}

export function mmToCanvasXPx(mm: number, canvas: Pick<TemplateCanvas, 'width' | 'height' | 'orientation'> = defaultTemplateCanvas) {
  return mm * getCanvasPxPerMm(canvas).xPxPerMm;
}

export function mmToCanvasYPx(mm: number, canvas: Pick<TemplateCanvas, 'width' | 'height' | 'orientation'> = defaultTemplateCanvas) {
  return mm * getCanvasPxPerMm(canvas).yPxPerMm;
}

export function mmToCanvasPx(mm: number, canvas: Pick<TemplateCanvas, 'width' | 'height' | 'orientation'> = defaultTemplateCanvas) {
  return mm * getCanvasPxPerMm(canvas).pxPerMm;
}

export function canvasPxToMm(px: number, canvas: Pick<TemplateCanvas, 'width' | 'height' | 'orientation'> = defaultTemplateCanvas) {
  return px / getCanvasPxPerMm(canvas).pxPerMm;
}

export function canvasXToCenteredMm(x: number, canvas: Pick<TemplateCanvas, 'width' | 'height' | 'orientation'> = defaultTemplateCanvas) {
  return (x - canvas.width / 2) / getCanvasPxPerMm(canvas).xPxPerMm;
}

export function canvasYToCenteredMm(y: number, canvas: Pick<TemplateCanvas, 'width' | 'height' | 'orientation'> = defaultTemplateCanvas) {
  return (canvas.height / 2 - y) / getCanvasPxPerMm(canvas).yPxPerMm;
}

export function centeredMmToCanvasX(xMm: number, canvas: Pick<TemplateCanvas, 'width' | 'height' | 'orientation'> = defaultTemplateCanvas) {
  return canvas.width / 2 + xMm * getCanvasPxPerMm(canvas).xPxPerMm;
}

export function centeredMmToCanvasY(yMm: number, canvas: Pick<TemplateCanvas, 'width' | 'height' | 'orientation'> = defaultTemplateCanvas) {
  return canvas.height / 2 - yMm * getCanvasPxPerMm(canvas).yPxPerMm;
}

export function canvasCornerRadiusPx(canvas: TemplateCanvas) {
  return mmToCanvasPx(getCuttingLineRadiusMm(canvas), canvas);
}

export function cardOutlineCornerRadiusPx(canvas: TemplateCanvas) {
  return mmToCanvasPx(fixedCardOutlineRadiusMm, canvas);
}

export function canvasSafeMarginPx(canvas: TemplateCanvas) {
  return mmToCanvasPx(canvas.safeMarginMm ?? canvasPxToMm(canvas.safeMargin ?? 0, canvas), canvas);
}

export function canvasCutOffsetPx(canvas: TemplateCanvas) {
  return mmToCanvasPx(canvas.cutOffsetMm ?? 0, canvas);
}

export function cuttingLineInsetFromCardPx(canvas: TemplateCanvas) {
  return canvasCutOffsetPx(canvas);
}

export function safeMarginInsetFromCuttingLinePx(canvas: TemplateCanvas) {
  return canvasSafeMarginPx(canvas);
}

export function safeMarginInsetFromCardPx(canvas: TemplateCanvas) {
  // The safe margin is always measured from the cutting line inward:
  // card outline -> cut offset(mm) -> cutting line -> safe margin(mm).
  return Math.max(0, cuttingLineInsetFromCardPx(canvas) + safeMarginInsetFromCuttingLinePx(canvas));
}

export function safeMarginCornerRadiusPx(canvas: TemplateCanvas) {
  return canvasCornerRadiusPx(canvas);
}

export function mmRadiusCss(mm: number, canvas: Pick<TemplateCanvas, 'width' | 'height' | 'orientation'> = defaultTemplateCanvas) {
  const xPercent = (mmToCanvasXPx(mm, canvas) / canvas.width) * 100;
  const yPercent = (mmToCanvasYPx(mm, canvas) / canvas.height) * 100;
  return `${xPercent}% / ${yPercent}%`;
}

export function cardOutlineRadiusCss(canvas: TemplateCanvas) {
  return mmRadiusCss(id1CardCornerRadiusMm, canvas);
}

export function cuttingLineRadiusCss(canvas: TemplateCanvas) {
  return mmRadiusCss(getCuttingLineRadiusMm(canvas), canvas);
}

export function safeMarginRadiusCss(canvas: TemplateCanvas) {
  return cuttingLineRadiusCss(canvas);
}

export function clampRadiusPx(radiusPx: number, width: number, height: number) {
  const safeRadius = Math.max(0, radiusPx);
  const maxRadius = Math.max(0, Math.min(width, height) / 2);
  return Math.min(safeRadius, maxRadius);
}

export function uniformCornerRadii(value: number): TemplateCornerRadii {
  return {
    topLeft: value,
    topRight: value,
    bottomRight: value,
    bottomLeft: value,
  };
}

function numericCorner(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

export function normalizeCornerRadiiMm(layer: TemplateLayer, canvas: TemplateCanvas): TemplateCornerRadii {
  const fallback = layer.cornerRadiusMm ?? layer.slot?.cornerRadiusMm ?? canvasPxToMm(layer.cornerRadius ?? layer.slot?.cornerRadius ?? 0, canvas);
  const stored = layer.cornerRadiiMm ?? layer.cornerRadii ?? (layer.data?.cornerRadiiMm as Partial<TemplateCornerRadii> | undefined);
  if (!stored) return uniformCornerRadii(fallback);
  return {
    topLeft: numericCorner(stored.topLeft, fallback),
    topRight: numericCorner(stored.topRight, fallback),
    bottomRight: numericCorner(stored.bottomRight, fallback),
    bottomLeft: numericCorner(stored.bottomLeft, fallback),
  };
}

export function imageCornerRadiusInheritsSlot(layer: TemplateLayer) {
  return layer.data?.imageCornerRadiusInheritSlot !== false;
}

export function normalizeImageCornerRadiiMm(layer: TemplateLayer, canvas: TemplateCanvas): TemplateCornerRadii {
  if (imageCornerRadiusInheritsSlot(layer)) return normalizeCornerRadiiMm(layer, canvas);

  const imageData = layer.data ?? {};
  const explicitRadiusMm = Number(imageData.imageCornerRadiusMm);
  const legacyRadiusPx = Number(imageData.imageCornerRadius);
  const fallback = Number.isFinite(explicitRadiusMm)
    ? Math.max(0, explicitRadiusMm)
    : Number.isFinite(legacyRadiusPx)
      ? canvasPxToMm(Math.max(0, legacyRadiusPx), canvas)
      : 0;
  const stored = imageData.imageCornerRadiiMm as Partial<TemplateCornerRadii> | undefined;
  if (!stored) return uniformCornerRadii(fallback);
  return {
    topLeft: numericCorner(stored.topLeft, fallback),
    topRight: numericCorner(stored.topRight, fallback),
    bottomRight: numericCorner(stored.bottomRight, fallback),
    bottomLeft: numericCorner(stored.bottomLeft, fallback),
  };
}

export function layerCornerRadiusPx(layer: TemplateLayer, canvas: TemplateCanvas) {
  const radiusMm = layer.cornerRadiusMm ?? layer.slot?.cornerRadiusMm;
  if (radiusMm !== undefined) return mmToCanvasPx(radiusMm, canvas);
  return layer.cornerRadius ?? layer.slot?.cornerRadius ?? 0;
}

export function clampedLayerCornerRadiusPx(
  layer: TemplateLayer,
  canvas: TemplateCanvas,
  size: { width?: number; height?: number } = {},
) {
  const width = size.width ?? layer.width ?? layer.slot?.width ?? canvas.width;
  const height = size.height ?? layer.height ?? layer.slot?.height ?? canvas.height;
  return clampRadiusPx(layerCornerRadiusPx(layer, canvas), width, height);
}

export function normalizeCornerRadiiForRect(radii: TemplateCornerRadii, width: number, height: number): TemplateCornerRadii {
  const next = {
    topLeft: Math.max(0, radii.topLeft),
    topRight: Math.max(0, radii.topRight),
    bottomRight: Math.max(0, radii.bottomRight),
    bottomLeft: Math.max(0, radii.bottomLeft),
  };
  const horizontalTop = next.topLeft + next.topRight;
  const horizontalBottom = next.bottomLeft + next.bottomRight;
  const verticalLeft = next.topLeft + next.bottomLeft;
  const verticalRight = next.topRight + next.bottomRight;
  const scales = [
    horizontalTop > 0 ? width / horizontalTop : 1,
    horizontalBottom > 0 ? width / horizontalBottom : 1,
    verticalLeft > 0 ? height / verticalLeft : 1,
    verticalRight > 0 ? height / verticalRight : 1,
  ];
  const scale = Math.min(1, ...scales.filter((value) => Number.isFinite(value) && value >= 0));
  if (scale >= 1) return next;
  return {
    topLeft: next.topLeft * scale,
    topRight: next.topRight * scale,
    bottomRight: next.bottomRight * scale,
    bottomLeft: next.bottomLeft * scale,
  };
}

export function layerCornerRadiiPx(
  layer: TemplateLayer,
  canvas: TemplateCanvas,
  size: { width?: number; height?: number } = {},
) {
  const width = size.width ?? layer.width ?? layer.slot?.width ?? canvas.width;
  const height = size.height ?? layer.height ?? layer.slot?.height ?? canvas.height;
  const radiiMm = normalizeCornerRadiiMm(layer, canvas);
  return normalizeCornerRadiiForRect(
    {
      topLeft: mmToCanvasPx(radiiMm.topLeft, canvas),
      topRight: mmToCanvasPx(radiiMm.topRight, canvas),
      bottomRight: mmToCanvasPx(radiiMm.bottomRight, canvas),
      bottomLeft: mmToCanvasPx(radiiMm.bottomLeft, canvas),
    },
    width,
    height,
  );
}

function cornerRadiiCssFromPx(radii: TemplateCornerRadii, width: number, height: number) {
  const uniformRadius =
    Math.abs(radii.topLeft - radii.topRight) < 0.01 &&
    Math.abs(radii.topRight - radii.bottomRight) < 0.01 &&
    Math.abs(radii.bottomRight - radii.bottomLeft) < 0.01;
  if (uniformRadius) {
    const radiusPx = radii.topLeft;
    return `${width > 0 ? (radiusPx / width) * 100 : 0}% / ${height > 0 ? (radiusPx / height) * 100 : 0}%`;
  }
  const x = (value: number) => (width > 0 ? (value / width) * 100 : 0);
  const y = (value: number) => (height > 0 ? (value / height) * 100 : 0);
  return `${x(radii.topLeft)}% ${x(radii.topRight)}% ${x(radii.bottomRight)}% ${x(radii.bottomLeft)}% / ${y(radii.topLeft)}% ${y(radii.topRight)}% ${y(radii.bottomRight)}% ${y(radii.bottomLeft)}%`;
}

export function imageCornerRadiiPx(
  layer: TemplateLayer,
  canvas: TemplateCanvas,
  size: { width?: number; height?: number } = {},
) {
  const width = size.width ?? layer.width ?? layer.slot?.width ?? canvas.width;
  const height = size.height ?? layer.height ?? layer.slot?.height ?? canvas.height;
  const radiiMm = normalizeImageCornerRadiiMm(layer, canvas);
  return normalizeCornerRadiiForRect(
    {
      topLeft: mmToCanvasPx(radiiMm.topLeft, canvas),
      topRight: mmToCanvasPx(radiiMm.topRight, canvas),
      bottomRight: mmToCanvasPx(radiiMm.bottomRight, canvas),
      bottomLeft: mmToCanvasPx(radiiMm.bottomLeft, canvas),
    },
    width,
    height,
  );
}

export function layerCornerRadiusCss(layer: TemplateLayer, canvas: TemplateCanvas) {
  const width = layer.width ?? layer.slot?.width ?? canvas.width;
  const height = layer.height ?? layer.slot?.height ?? canvas.height;
  const radii = layerCornerRadiiPx(layer, canvas, { width, height });
  return cornerRadiiCssFromPx(radii, width, height);
}

export function imageCornerRadiusCss(
  layer: TemplateLayer,
  canvas: TemplateCanvas,
  size: { width?: number; height?: number } = {},
) {
  const width = size.width ?? layer.width ?? layer.slot?.width ?? canvas.width;
  const height = size.height ?? layer.height ?? layer.slot?.height ?? canvas.height;
  const radii = imageCornerRadiiPx(layer, canvas, { width, height });
  return cornerRadiiCssFromPx(radii, width, height);
}

export function canvasInsetRectPercent(insetPx: number, canvas: Pick<TemplateCanvas, 'width' | 'height'>) {
  const left = (insetPx / canvas.width) * 100;
  const top = (insetPx / canvas.height) * 100;
  return {
    left: `${left}%`,
    top: `${top}%`,
    width: `${Math.max(0, ((canvas.width - insetPx * 2) / canvas.width) * 100)}%`,
    height: `${Math.max(0, ((canvas.height - insetPx * 2) / canvas.height) * 100)}%`,
  };
}

export function layerCornerRadiusMm(layer: TemplateLayer, canvas: TemplateCanvas) {
  return layer.cornerRadiusMm ?? layer.slot?.cornerRadiusMm ?? canvasPxToMm(layer.cornerRadius ?? layer.slot?.cornerRadius ?? 0, canvas);
}

export function canvasToUiY(internalY: number, height: number, canvasHeight: number) {
  return canvasHeight - internalY - height;
}

export function uiToCanvasY(uiY: number, height: number, canvasHeight: number) {
  return canvasHeight - height - uiY;
}

export function resizeRectFromCenter(
  rect: { x: number; y: number; width: number; height: number },
  deltaPx: number,
  minWidth = 1,
  minHeight = 1,
) {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const width = Math.max(minWidth, rect.width + deltaPx * 2);
  const height = Math.max(minHeight, rect.height + deltaPx * 2);
  return {
    ...rect,
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  };
}

export function resizeRectFromCenterPreserveAspect(
  rect: { x: number; y: number; width: number; height: number },
  edgeDeltaPx: number,
  minWidth = 1,
  minHeight = 1,
) {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const safeWidth = Math.max(1, rect.width);
  const safeHeight = Math.max(1, rect.height);
  const widthScale = (safeWidth + edgeDeltaPx * 2) / safeWidth;
  const heightScale = (safeHeight + edgeDeltaPx * 2) / safeHeight;
  const desiredScale = edgeDeltaPx < 0 ? Math.min(widthScale, heightScale) : Math.max(widthScale, heightScale);
  const minScale = Math.max(minWidth / safeWidth, minHeight / safeHeight);
  const scale = Math.max(minScale, desiredScale);
  const width = safeWidth * scale;
  const height = safeHeight * scale;
  return {
    ...rect,
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  };
}
