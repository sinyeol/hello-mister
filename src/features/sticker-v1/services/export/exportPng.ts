import JSZip from 'jszip';
import type { CardItem, Category, CutLineSettings, ExportSettings, LocalAsset, Template, TemplateCanvas, TemplateLayer, TemplateTextureParams } from '@sticker-v1/types';
import { downloadBytes } from '@sticker-v1/services/export/download';
import { toSlug } from '@sticker-v1/utils/slug';
import { getTemplateLayerFrame, getTemplateLayerImageTransform } from '@sticker-v1/utils/cardTemplateTransforms';
import { templateForCardSide } from '@sticker-v1/utils/cardTemplateSnapshots';
import { resolveAssetReference } from '@sticker-v1/utils/assetReferences';
import { imageCropSourceRect as imageCropSourceRectPx } from '@sticker-v1/utils/imageCrop';
import {
  canvasCutOffsetPx,
  cardPhysicalSizeForCanvas,
  getCardBackgroundColor,
  getCuttingLineRadiusMm,
  getStickerBackgroundColor,
  imageCornerRadiiPx,
  layerCornerRadiiPx,
  mmToCanvasPx,
} from '@sticker-v1/utils/cardGeometry';
import { addExportWarning, createExportSummary, type ExportSummary } from '@sticker-v1/services/export/exportSummary';
import {
  templateShapeFillValue,
  templateShapeFillStyle,
  templateShapeKind,
  templateShapeStrokeValue,
  templateShapeStrokeWidth,
} from '@sticker-v1/utils/templateShapes';
import { cornerMarkSegmentsForGeometryMm, cutLineDashArrayMm, getCutLineGeometryMm, normalizeCutLineSettings } from '@sticker-v1/utils/cutLines';
import { normalizeTemplateForRender } from '@sticker-v1/utils/templateRenderNormalize';

const CANVAS = { width: 900, height: 1427 };

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not create PNG blob.'));
    }, 'image/png');
  });
}

function renderPlaceholderPng(message: string, canvasSize = CANVAS) {
  const canvas = document.createElement('canvas');
  canvas.width = canvasSize.width;
  canvas.height = canvasSize.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas rendering is not available.');
  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#E53935';
  ctx.lineWidth = 4;
  ctx.setLineDash([16, 12]);
  ctx.strokeRect(24, 24, canvas.width - 48, canvas.height - 48);
  ctx.fillStyle = '#334155';
  ctx.font = 'bold 36px sans-serif';
  drawText(ctx, message, 48, canvas.height / 2, canvas.width - 96);
  return canvasToBlob(canvas);
}

function orderedLayers(template: Template) {
  return [...template.layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
}

function layerRect(layer: TemplateLayer, template: Template, outputCanvas: { width: number; height: number }) {
  const frame = getTemplateLayerFrame(layer, template.canvas);
  return {
    x: (frame.x / template.canvas.width) * outputCanvas.width,
    y: (frame.y / template.canvas.height) * outputCanvas.height,
    width: (frame.width / template.canvas.width) * outputCanvas.width,
    height: (frame.height / template.canvas.height) * outputCanvas.height,
  };
}

function slotText(layer: TemplateLayer, card: CardItem, side: 'front' | 'back') {
  if (layer.slotType === 'categoryLabel') return side === 'front' ? card.front.categoryLabel : card.back.categoryLabel;
  if (layer.slotType === 'platformLabel') return card.front.platformLabel;
  if (layer.slotType === 'brandText') return 'Hello Mister';
  if (layer.slotType === 'titleText') return card.front.titleText;
  if (layer.slotType === 'gameLogo') return card.front.titleText;
  if (layer.slotType === 'platformLogo') return card.front.platformLabel;
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

function isImageSlot(layer: TemplateLayer) {
  return [
    'backgroundArt',
    'heroImage',
    'mainImage',
    'titleImage',
    'gameLogo',
    'brandLogo',
    'platformLogo',
    'background',
  ].includes(String(layer.slotType));
}

function imageTransformRect(
  layer: TemplateLayer,
  baseRect: { x: number; y: number; width: number; height: number },
  transform: { x?: number; y?: number; width?: number; height?: number },
) {
  const frame = getTemplateLayerFrame(layer);
  return {
    x: baseRect.x + ((transform?.x ?? 0) / frame.width) * baseRect.width,
    y: baseRect.y + ((transform?.y ?? 0) / frame.height) * baseRect.height,
    width: ((transform?.width ?? frame.width) / frame.width) * baseRect.width,
    height: ((transform?.height ?? frame.height) / frame.height) * baseRect.height,
  };
}

function imageCropSourceRect(
  image: HTMLImageElement,
  transform: { cropTop?: number; cropRight?: number; cropBottom?: number; cropLeft?: number },
) {
  return imageCropSourceRectPx(
    { width: image.naturalWidth || image.width || 1, height: image.naturalHeight || image.height || 1 },
    transform,
  );
}

function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number) {
  ctx.fillText(text.length > 48 ? `${text.slice(0, 45)}...` : text, x, y, maxWidth);
}

function roundRectPath(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; width: number; height: number }, radius: number) {
  const r = Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2));
  ctx.beginPath();
  ctx.moveTo(rect.x + r, rect.y);
  ctx.lineTo(rect.x + rect.width - r, rect.y);
  ctx.quadraticCurveTo(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + r);
  ctx.lineTo(rect.x + rect.width, rect.y + rect.height - r);
  ctx.quadraticCurveTo(rect.x + rect.width, rect.y + rect.height, rect.x + rect.width - r, rect.y + rect.height);
  ctx.lineTo(rect.x + r, rect.y + rect.height);
  ctx.quadraticCurveTo(rect.x, rect.y + rect.height, rect.x, rect.y + rect.height - r);
  ctx.lineTo(rect.x, rect.y + r);
  ctx.quadraticCurveTo(rect.x, rect.y, rect.x + r, rect.y);
  ctx.closePath();
}

function roundRectPathWithRadii(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  radii: { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number },
) {
  const tl = Math.max(0, Math.min(radii.topLeft, rect.width / 2, rect.height / 2));
  const tr = Math.max(0, Math.min(radii.topRight, rect.width / 2, rect.height / 2));
  const br = Math.max(0, Math.min(radii.bottomRight, rect.width / 2, rect.height / 2));
  const bl = Math.max(0, Math.min(radii.bottomLeft, rect.width / 2, rect.height / 2));
  ctx.beginPath();
  ctx.moveTo(rect.x + tl, rect.y);
  ctx.lineTo(rect.x + rect.width - tr, rect.y);
  if (tr > 0) ctx.quadraticCurveTo(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + tr);
  else ctx.lineTo(rect.x + rect.width, rect.y);
  ctx.lineTo(rect.x + rect.width, rect.y + rect.height - br);
  if (br > 0) ctx.quadraticCurveTo(rect.x + rect.width, rect.y + rect.height, rect.x + rect.width - br, rect.y + rect.height);
  else ctx.lineTo(rect.x + rect.width, rect.y + rect.height);
  ctx.lineTo(rect.x + bl, rect.y + rect.height);
  if (bl > 0) ctx.quadraticCurveTo(rect.x, rect.y + rect.height, rect.x, rect.y + rect.height - bl);
  else ctx.lineTo(rect.x, rect.y + rect.height);
  ctx.lineTo(rect.x, rect.y + tl);
  if (tl > 0) ctx.quadraticCurveTo(rect.x, rect.y, rect.x + tl, rect.y);
  else ctx.lineTo(rect.x, rect.y);
  ctx.closePath();
}

function canvasPxScale(template: Template, outputCanvas: { width: number; height: number }) {
  return (outputCanvas.width / template.canvas.width + outputCanvas.height / template.canvas.height) / 2;
}

function scaleRadii(radii: { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number }, scale: number) {
  return {
    topLeft: radii.topLeft * scale,
    topRight: radii.topRight * scale,
    bottomRight: radii.bottomRight * scale,
    bottomLeft: radii.bottomLeft * scale,
  };
}

function layerOutputCornerRadii(layer: TemplateLayer, template: Template, outputCanvas: { width: number; height: number }) {
  const scale = canvasPxScale(template, outputCanvas);
  return scaleRadii(
    layerCornerRadiiPx(layer, template.canvas, {
      width: layer.width ?? layer.slot?.width ?? template.canvas.width,
      height: layer.height ?? layer.slot?.height ?? template.canvas.height,
    }),
    scale,
  );
}

function imageOutputCornerRadii(
  layer: TemplateLayer,
  template: Template,
  imageRect: { width: number; height: number },
  outputCanvas: { width: number; height: number },
) {
  const scale = canvasPxScale(template, outputCanvas);
  return scaleRadii(
    imageCornerRadiiPx(layer, template.canvas, {
      width: imageRect.width / scale,
      height: imageRect.height / scale,
    }),
    scale,
  );
}

function clipLayerRect(ctx: CanvasRenderingContext2D, layer: TemplateLayer, template: Template, rect: { x: number; y: number; width: number; height: number }, outputCanvas: { width: number; height: number }) {
  roundRectPathWithRadii(ctx, rect, layerOutputCornerRadii(layer, template, outputCanvas));
  ctx.clip();
}

function clipImageRect(
  ctx: CanvasRenderingContext2D,
  layer: TemplateLayer,
  template: Template,
  imageRect: { x: number; y: number; width: number; height: number },
  outputCanvas: { width: number; height: number },
) {
  roundRectPathWithRadii(ctx, imageRect, imageOutputCornerRadii(layer, template, imageRect, outputCanvas));
  ctx.clip();
}

function visiblePaint(value: string) {
  return value !== 'transparent' && value !== 'none';
}

function texturePattern(
  ctx: CanvasRenderingContext2D,
  texture: string,
  color: string,
  secondaryColor: string,
  params: TemplateTextureParams = {},
) {
  const patternCanvas = document.createElement('canvas');
  const scale = Math.max(0.35, Number(params.scale ?? 1));
  const intensity = Math.max(0, Math.min(1, Number(params.intensity ?? 0.55)));
  const opacity = Math.max(0, Math.min(1, Number(params.opacity ?? 0.45)));
  const patternSize = Math.max(6, Math.round(16 * scale));
  patternCanvas.width = patternSize;
  patternCanvas.height = patternSize;
  const patternCtx = patternCanvas.getContext('2d');
  if (!patternCtx) return color;
  patternCtx.fillStyle = color;
  patternCtx.fillRect(0, 0, patternCanvas.width, patternCanvas.height);
  patternCtx.strokeStyle = secondaryColor;
  patternCtx.fillStyle = secondaryColor;
  patternCtx.globalAlpha = opacity * intensity;
  switch (texture) {
    case 'diagonalStripe':
      patternCtx.lineWidth = 3;
      patternCtx.beginPath();
      patternCtx.moveTo(-4, 16);
      patternCtx.lineTo(16, -4);
      patternCtx.moveTo(4, 20);
      patternCtx.lineTo(20, 4);
      patternCtx.stroke();
      break;
    case 'dotPattern':
      patternCtx.beginPath();
      patternCtx.arc(4, 4, 2, 0, Math.PI * 2);
      patternCtx.fill();
      break;
    case 'scanline':
      patternCtx.lineWidth = 1;
      patternCtx.beginPath();
      patternCtx.moveTo(0, 4);
      patternCtx.lineTo(16, 4);
      patternCtx.stroke();
      break;
    case 'carbonFiber':
      patternCtx.fillRect(0, 0, 8, 8);
      patternCtx.fillRect(8, 8, 8, 8);
      break;
    case 'halftone':
      patternCtx.beginPath();
      patternCtx.arc(5, 5, 3, 0, Math.PI * 2);
      patternCtx.arc(13, 13, 1.5, 0, Math.PI * 2);
      patternCtx.fill();
      break;
    case 'brushedMetal':
      patternCtx.lineWidth = 1;
      for (let y = 2; y < 16; y += 4) {
        patternCtx.beginPath();
        patternCtx.moveTo(0, y);
        patternCtx.lineTo(16, y);
        patternCtx.stroke();
      }
      break;
    case 'plasticGloss':
      patternCtx.globalAlpha = 0.24;
      patternCtx.fillRect(0, 0, 16, 7);
      break;
    case 'noise':
      for (let index = 0; index < 12; index += 1) patternCtx.fillRect((index * 7) % 16, (index * 5) % 16, 1, 1);
      break;
    case 'gridPattern':
      patternCtx.lineWidth = 1;
      patternCtx.strokeRect(0.5, 0.5, 15, 15);
      patternCtx.beginPath();
      patternCtx.moveTo(8, 0);
      patternCtx.lineTo(8, 16);
      patternCtx.moveTo(0, 8);
      patternCtx.lineTo(16, 8);
      patternCtx.stroke();
      break;
    case 'dashedPattern':
      patternCtx.lineWidth = 2;
      patternCtx.setLineDash([4, 3]);
      patternCtx.beginPath();
      patternCtx.moveTo(1, 4);
      patternCtx.lineTo(16, 4);
      patternCtx.moveTo(1, 12);
      patternCtx.lineTo(16, 12);
      patternCtx.stroke();
      patternCtx.setLineDash([]);
      break;
    case 'circuitPattern':
      patternCtx.lineWidth = 1.2;
      patternCtx.beginPath();
      patternCtx.moveTo(2, 4);
      patternCtx.lineTo(7, 4);
      patternCtx.lineTo(7, 8);
      patternCtx.lineTo(14, 8);
      patternCtx.moveTo(4, 14);
      patternCtx.lineTo(10, 14);
      patternCtx.lineTo(10, 10);
      patternCtx.lineTo(15, 10);
      patternCtx.stroke();
      patternCtx.fillRect(1, 3, 2, 2);
      patternCtx.fillRect(14, 7, 2, 2);
      break;
    case 'retroCrt':
      patternCtx.lineWidth = 1;
      for (let y = 2; y < 16; y += 4) {
        patternCtx.beginPath();
        patternCtx.moveTo(0, y);
        patternCtx.lineTo(16, y);
        patternCtx.stroke();
      }
      patternCtx.globalAlpha = 0.18;
      patternCtx.fillRect(4, 0, 1, 16);
      patternCtx.fillRect(11, 0, 1, 16);
      break;
    case 'neonGlow':
      patternCtx.globalAlpha = 0.28;
      patternCtx.beginPath();
      patternCtx.arc(8, 8, 5, 0, Math.PI * 2);
      patternCtx.fill();
      break;
    case 'darkVignette':
      patternCtx.globalAlpha = 0.22;
      patternCtx.fillStyle = '#000000';
      patternCtx.fillRect(0, 0, 16, 16);
      patternCtx.globalAlpha = 0.35;
      patternCtx.fillStyle = color;
      patternCtx.fillRect(4, 4, 8, 8);
      break;
    case 'lightVignette':
      patternCtx.globalAlpha = 0.24;
      patternCtx.fillRect(3, 3, 10, 10);
      break;
    case 'metalGradient': {
      const gradient = patternCtx.createLinearGradient(0, 0, 16, 0);
      gradient.addColorStop(0, color);
      gradient.addColorStop(0.5, secondaryColor);
      gradient.addColorStop(1, color);
      patternCtx.globalAlpha = 0.5;
      patternCtx.fillStyle = gradient;
      patternCtx.fillRect(0, 0, 16, 16);
      break;
    }
    case 'glassReflection':
      patternCtx.globalAlpha = 0.24;
      patternCtx.fillRect(0, 0, 16, 6);
      patternCtx.lineWidth = 1;
      patternCtx.beginPath();
      patternCtx.moveTo(3, 15);
      patternCtx.lineTo(15, 3);
      patternCtx.stroke();
      break;
    case 'fabric':
      patternCtx.lineWidth = 0.8;
      patternCtx.beginPath();
      patternCtx.moveTo(0, 4);
      patternCtx.lineTo(16, 4);
      patternCtx.moveTo(0, 12);
      patternCtx.lineTo(16, 12);
      patternCtx.moveTo(4, 0);
      patternCtx.lineTo(4, 16);
      patternCtx.moveTo(12, 0);
      patternCtx.lineTo(12, 16);
      patternCtx.stroke();
      break;
    case 'pixelPattern':
      patternCtx.fillRect(0, 0, 5, 5);
      patternCtx.fillRect(10, 0, 6, 5);
      patternCtx.fillRect(5, 5, 5, 5);
      patternCtx.fillRect(0, 10, 5, 6);
      patternCtx.fillRect(10, 10, 6, 6);
      break;
    case 'paper':
    default:
      patternCtx.lineWidth = 0.7;
      patternCtx.beginPath();
      patternCtx.moveTo(1, 3);
      patternCtx.lineTo(15, 3);
      patternCtx.moveTo(2, 9);
      patternCtx.lineTo(14, 9);
      patternCtx.stroke();
  }
  return ctx.createPattern(patternCanvas, 'repeat') ?? color;
}

function shapeCanvasFillStyle(
  ctx: CanvasRenderingContext2D,
  layer: TemplateLayer,
  rect: { x: number; y: number; width: number; height: number },
) {
  const style = templateShapeFillStyle(layer);
  if (style.type === 'none') return undefined;
  if (style.type === 'solid') return style.color;
  if (style.type === 'linearGradient') {
    const angle = ((style.angle ?? 45) * Math.PI) / 180;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const dx = Math.cos(angle) * rect.width / 2;
    const dy = Math.sin(angle) * rect.height / 2;
    const gradient = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    gradient.addColorStop(0, style.colors[0]);
    gradient.addColorStop(1, style.colors[1]);
    return gradient;
  }
  if (style.type === 'radialGradient') {
    const gradient = ctx.createRadialGradient(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      0,
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      Math.max(rect.width, rect.height) / 2,
    );
    gradient.addColorStop(0, style.colors[0]);
    gradient.addColorStop(1, style.colors[1]);
    return gradient;
  }
  return texturePattern(ctx, style.texture, style.color ?? '#f3f4f6', style.secondaryColor ?? '#ffffff', style.textureParams);
}

function drawConfiguredCutLine(
  ctx: CanvasRenderingContext2D,
  physicalSize: { width: number; height: number },
  outputCanvas: { width: number; height: number },
  settings?: Partial<CutLineSettings>,
  canvas?: Pick<TemplateCanvas, 'cutOffsetMm' | 'cornerRadiusMm' | 'cuttingLineRadiusMm'>,
) {
  const cutLineSettings = normalizeCutLineSettings(settings);
  if (!cutLineSettings.enabled) return;
  const placement = { xMm: 0, yMm: 0, widthMm: physicalSize.width, heightMm: physicalSize.height };
  const geometry = getCutLineGeometryMm(placement, cutLineSettings, canvas);
  const xScale = outputCanvas.width / physicalSize.width;
  const yScale = outputCanvas.height / physicalSize.height;
  const lineScale = (xScale + yScale) / 2;
  const toPxRect = (rect: typeof placement) => ({
    x: rect.xMm * xScale,
    y: rect.yMm * yScale,
    width: rect.widthMm * xScale,
    height: rect.heightMm * yScale,
  });

  ctx.save();
  ctx.strokeStyle = cutLineSettings.color;
  ctx.lineWidth = Math.max(1, cutLineSettings.widthMm * lineScale);
  ctx.setLineDash(cutLineDashArrayMm(cutLineSettings.style).map((value) => value * lineScale));
  ctx.lineCap = cutLineSettings.style === 'dotted' ? 'round' : 'butt';
  ctx.lineJoin = 'round';

  if (cutLineSettings.style === 'corner-marks') {
    cornerMarkSegmentsForGeometryMm(geometry, cutLineSettings).forEach((segment) => {
      ctx.beginPath();
      ctx.moveTo(segment.x1Mm * xScale, segment.y1Mm * yScale);
      ctx.lineTo(segment.x2Mm * xScale, segment.y2Mm * yScale);
      ctx.stroke();
    });
    ctx.restore();
    return;
  }

  roundRectPath(ctx, toPxRect(geometry.rect), geometry.radiusMm * lineScale);
  ctx.stroke();
  ctx.restore();
}

function drawTemplateShape(
  ctx: CanvasRenderingContext2D,
  layer: TemplateLayer,
  template: Template,
  rect: { x: number; y: number; width: number; height: number },
  outputCanvas: { width: number; height: number },
) {
  const kind = templateShapeKind(layer);
  const scale = canvasPxScale(template, outputCanvas);
  const strokeWidth = Math.min(templateShapeStrokeWidth(layer) * scale, rect.width, rect.height);
  const halfStroke = strokeWidth / 2;
  const fill = templateShapeFillValue(layer);
  const stroke = templateShapeStrokeValue(layer);

  ctx.save();
  ctx.globalAlpha = layer.opacity ?? 1;
  ctx.setLineDash([]);

  if (kind === 'line') {
    if (strokeWidth > 0 && visiblePaint(stroke)) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(rect.x + halfStroke, rect.y + rect.height / 2);
      ctx.lineTo(rect.x + Math.max(halfStroke, rect.width - halfStroke), rect.y + rect.height / 2);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  const shapeRect = {
    x: rect.x + halfStroke,
    y: rect.y + halfStroke,
    width: Math.max(0, rect.width - strokeWidth),
    height: Math.max(0, rect.height - strokeWidth),
  };

  if (kind === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(
      shapeRect.x + shapeRect.width / 2,
      shapeRect.y + shapeRect.height / 2,
      shapeRect.width / 2,
      shapeRect.height / 2,
      0,
      0,
      Math.PI * 2,
    );
  } else {
    // Match TemplateShapeLayer's unified R: radius defined on the OUTER box; the drawn path is the stroke centreline
    // (inset by halfStroke), so its radius = outer R − halfStroke. Keeps PNG export pixel-consistent with the editor.
    const outerRadii = layerCornerRadiiPx(layer, template.canvas, {
      width: rect.width / scale,
      height: rect.height / scale,
    });
    roundRectPathWithRadii(ctx, shapeRect, {
      topLeft: Math.max(0, outerRadii.topLeft * scale - halfStroke),
      topRight: Math.max(0, outerRadii.topRight * scale - halfStroke),
      bottomRight: Math.max(0, outerRadii.bottomRight * scale - halfStroke),
      bottomLeft: Math.max(0, outerRadii.bottomLeft * scale - halfStroke),
    });
  }

  const canvasFillStyle = shapeCanvasFillStyle(ctx, layer, shapeRect);
  if (canvasFillStyle && visiblePaint(fill)) {
    ctx.fillStyle = canvasFillStyle;
    ctx.fill();
  }
  if (strokeWidth > 0 && visiblePaint(stroke)) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
  }
  ctx.restore();
}

export function makeCardPngFilename(categoryName: string, title: string, side: 'front' | 'back') {
  return `${toSlug(categoryName)}__${toSlug(title)}__${side}.png`;
}

export async function renderCardPng(
  card: CardItem,
  category: Category | undefined,
  assetsById: Record<string, LocalAsset>,
  templates: Template[],
  side: 'front' | 'back',
  options?: { summary?: ExportSummary; cardTitle?: string; dpi?: number; showCutLine?: boolean; cutLineSettings?: Partial<CutLineSettings> },
) {
  const canvas = document.createElement('canvas');
  const palette = category?.palette ?? {
    primary: '#111111',
    secondary: '#F5F5F5',
    accent: '#F36C21',
    neutral: '#D9D9D9',
  };
  const sourceTemplate = templateForCardSide(card, templates, side);
  const template = sourceTemplate ? normalizeTemplateForRender(sourceTemplate) : undefined;
  const baseCanvas = template?.canvas ?? CANVAS;
  const dpi = options?.dpi ?? 300;
  const physicalSize = template ? cardPhysicalSizeForCanvas(template.canvas) : { width: 53.98, height: 85.6 };
  const outputCanvas = {
    width: Math.max(baseCanvas.width, Math.round((physicalSize.width / 25.4) * dpi)),
    height: Math.max(baseCanvas.height, Math.round((physicalSize.height / 25.4) * dpi)),
    orientation: template?.canvas.orientation,
    cutOffsetMm: template?.canvas.cutOffsetMm,
    safeMarginMm: template?.canvas.safeMarginMm,
  };
  canvas.width = outputCanvas.width;
  canvas.height = outputCanvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas rendering is not available.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.fillStyle = template?.canvas.printCardColor ? getCardBackgroundColor(template.canvas, palette.secondary) : '#ffffff';
  ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);

  if (!template) {
    ctx.strokeStyle = '#A3A3A3';
    ctx.setLineDash([12, 8]);
    ctx.strokeRect(8, 8, outputCanvas.width - 16, outputCanvas.height - 16);
    ctx.fillStyle = '#666666';
    ctx.font = 'bold 42px sans-serif';
    drawText(ctx, 'Template unassigned', outputCanvas.width * 0.23, outputCanvas.height / 2, outputCanvas.width * 0.58);
    return canvasToBlob(canvas);
  }

  const stickerFill = getStickerBackgroundColor(template.canvas, palette.secondary);
  if (visiblePaint(stickerFill)) {
    const scale = canvasPxScale(template, outputCanvas);
    const cutOffset = canvasCutOffsetPx(template.canvas) * scale;
    ctx.fillStyle = stickerFill;
    roundRectPath(
      ctx,
      {
        x: cutOffset,
        y: cutOffset,
        width: Math.max(0, outputCanvas.width - cutOffset * 2),
        height: Math.max(0, outputCanvas.height - cutOffset * 2),
      },
      mmToCanvasPx(getCuttingLineRadiusMm(template.canvas), template.canvas) * scale,
    );
    ctx.fill();
  }

  for (const layer of orderedLayers(template)) {
    if (layer.data?.visible === false) continue;
    if (layer.type === 'background') {
      continue;
    }

    const rect = layerRect(layer, template, outputCanvas);
    if (layer.type === 'shape') {
      drawTemplateShape(ctx, layer, template, rect, outputCanvas);
      continue;
    }
    const imageDataUrl = templateImageDataUrl(layer);
    const asset = imageDataUrl ? undefined : slotAsset(layer, card, assetsById, side);
    const transform = getTemplateLayerImageTransform(layer, card, side);
    if (asset?.objectUrl) {
      try {
        const image = await loadImage(asset.objectUrl);
        const imageRect = imageTransformRect(layer, rect, transform);
        const sourceRect = imageCropSourceRect(image, transform);
        ctx.save();
        clipLayerRect(ctx, layer, template, rect, outputCanvas);
        clipImageRect(ctx, layer, template, imageRect, outputCanvas);
        ctx.drawImage(image, sourceRect.sx, sourceRect.sy, sourceRect.sw, sourceRect.sh, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
        ctx.restore();
        continue;
      } catch (error) {
        addExportWarning(options?.summary, {
          cardId: card.id,
          cardTitle: options?.cardTitle ?? card.front.titleText,
          side,
          kind: 'missing-image',
          message: `${asset.name} 이미지를 불러오지 못했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
        });
      }
    }
    if (imageDataUrl) {
      try {
        const image = await loadImage(imageDataUrl);
        const imageRect = imageTransformRect(layer, rect, transform);
        const sourceRect = imageCropSourceRect(image, transform);
        ctx.save();
        clipLayerRect(ctx, layer, template, rect, outputCanvas);
        clipImageRect(ctx, layer, template, imageRect, outputCanvas);
        ctx.drawImage(image, sourceRect.sx, sourceRect.sy, sourceRect.sw, sourceRect.sh, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
        ctx.restore();
        continue;
      } catch (error) {
        addExportWarning(options?.summary, {
          cardId: card.id,
          cardTitle: options?.cardTitle ?? card.front.titleText,
          side,
          kind: 'missing-image',
          message: `템플릿 이미지를 불러오지 못했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
        });
      }
    }

    if (isImageSlot(layer)) {
      addExportWarning(options?.summary, {
        cardId: card.id,
        cardTitle: options?.cardTitle ?? card.front.titleText,
        side,
        kind: 'missing-image',
        message: `${layer.slot?.label ?? layer.slotType ?? '이미지 슬롯'}에 사용할 이미지를 찾지 못해 대체 표시를 사용했습니다.`,
      });
    }

    if (layer.fill) {
      ctx.fillStyle = layer.fill;
      roundRectPathWithRadii(ctx, rect, layerOutputCornerRadii(layer, template, outputCanvas));
      ctx.fill();
    }
    const text = layer.slotType === 'titleImage' || layer.slotType === 'gameLogo' ? card.front.titleText : slotText(layer, card, side);
    if (text) {
      ctx.fillStyle = String(layer.data?.color ?? palette.neutral);
      ctx.font = `${layer.slotType === 'titleText' || layer.slotType === 'brandText' ? 'bold ' : ''}${Math.max(18, Math.min(52, rect.height * 0.28))}px sans-serif`;
      drawText(ctx, String(text), rect.x + 10, rect.y + rect.height * 0.58, Math.max(rect.width - 20, 20));
    }
  }

  if (options?.showCutLine !== false) {
    drawConfiguredCutLine(ctx, physicalSize, outputCanvas, options?.cutLineSettings, template.canvas);
  }

  return canvasToBlob(canvas);
}

export async function exportCardsPngZip(
  cards: CardItem[],
  gamesById: Record<string, { title: string }>,
  categoriesById: Record<string, Category>,
  assetsById: Record<string, LocalAsset>,
  templates: Template[],
  settings?: Pick<ExportSettings, 'includeBack' | 'rows' | 'columns' | 'sideMode' | 'dpi' | 'cutLineSettings'>,
) {
  const zip = new JSZip();
  const printableCards = cards.filter((card) => !card.deleted);
  const sideMode = settings?.sideMode ?? (settings?.includeBack === false ? 'front' : 'duplex');
  const includeFront = sideMode !== 'back';
  const includeBack = sideMode !== 'front';
  const dpi = settings?.dpi ?? 300;
  const perSheet = (settings?.rows ?? 2) * (settings?.columns ?? 5);
  const sheetCount = Math.ceil(printableCards.length / perSheet);
  const summary = createExportSummary(printableCards.length, includeFront ? sheetCount : 0, includeBack ? sheetCount : 0, dpi);

  for (const card of printableCards) {
    const category = categoriesById[card.categoryId];
    const game = gamesById[card.gameId];
    const categoryName = category?.displayName ?? 'unknown-category';
    const title = game?.title ?? card.gameId;
    if (includeFront) {
      const front = await renderCardPng(card, category, assetsById, templates, 'front', { summary, cardTitle: title, dpi, cutLineSettings: settings?.cutLineSettings }).catch(async (error) => {
        addExportWarning(summary, {
          cardId: card.id,
          cardTitle: title,
          side: 'front',
          kind: 'placeholder',
          message: `앞면 PNG 렌더링 실패로 대체 이미지를 사용했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
        });
        return renderPlaceholderPng('앞면 렌더링 실패');
      });
      zip.file(makeCardPngFilename(categoryName, title, 'front'), front);
    }
    if (includeBack) {
      const back = await renderCardPng(card, category, assetsById, templates, 'back', { summary, cardTitle: title, dpi, cutLineSettings: settings?.cutLineSettings }).catch(async (error) => {
        addExportWarning(summary, {
          cardId: card.id,
          cardTitle: title,
          side: 'back',
          kind: 'placeholder',
          message: `뒷면 PNG 렌더링 실패로 대체 이미지를 사용했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
        });
        return renderPlaceholderPng('뒷면 렌더링 실패');
      });
      zip.file(makeCardPngFilename(categoryName, title, 'back'), back);
    }
  }

  const bytes = await zip.generateAsync({ type: 'uint8array' });
  downloadBytes(bytes, 'hello-mister-card-stickers-png.zip', 'application/zip');
  return { summary };
}
