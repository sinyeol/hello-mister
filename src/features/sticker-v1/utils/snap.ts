import type { TemplateCanvas } from '@sticker-v1/types';
import {
  canvasXToCenteredMm,
  canvasYToCenteredMm,
  centeredMmToCanvasX,
  centeredMmToCanvasY,
  getCanvasPxPerMm,
} from '@sticker-v1/utils/cardGeometry';

export function snapMm(valueMm: number, stepMm = 1) {
  return Math.round(valueMm / stepMm) * stepMm;
}

export function snapCanvasPxToMmGrid(valuePx: number, pxPerMm: number, stepMm = 1) {
  return snapMm(valuePx / pxPerMm, stepMm) * pxPerMm;
}

export function snapLayerPositionToGridAndCenter(
  position: { x: number; y: number },
  size: { width: number; height: number },
  canvas: Pick<TemplateCanvas, 'width' | 'height' | 'orientation'>,
  options: { stepMm?: number; thresholdMm?: number } = {},
) {
  const stepMm = options.stepMm ?? 1;
  const thresholdMm = options.thresholdMm ?? 0.5;
  const { xPxPerMm, yPxPerMm } = getCanvasPxPerMm(canvas);
  let x = centeredMmToCanvasX(snapMm(canvasXToCenteredMm(position.x, canvas), stepMm), canvas);
  let y = centeredMmToCanvasY(snapMm(canvasYToCenteredMm(position.y, canvas), stepMm), canvas);

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const xThreshold = thresholdMm * xPxPerMm;
  const yThreshold = thresholdMm * yPxPerMm;
  const xCandidates = [x, x + size.width / 2, x + size.width];
  const yCandidates = [y, y + size.height / 2, y + size.height];
  const xSnap = xCandidates.find((candidate) => Math.abs(candidate - centerX) <= xThreshold);
  const ySnap = yCandidates.find((candidate) => Math.abs(candidate - centerY) <= yThreshold);

  if (xSnap !== undefined) x += centerX - xSnap;
  if (ySnap !== undefined) y += centerY - ySnap;
  return { x, y };
}

export function snapPointToGridAndCenter(
  point: { x: number; y: number },
  canvas: Pick<TemplateCanvas, 'width' | 'height' | 'orientation'>,
  options: { stepMm?: number; thresholdMm?: number } = {},
) {
  return snapLayerPositionToGridAndCenter(point, { width: 0, height: 0 }, canvas, options);
}

export interface SnapGuideLine {
  axis: 'x' | 'y';
  position: number;
}

export interface SmartSnapResult {
  x: number;
  y: number;
  guides: SnapGuideLine[];
}

// Photoshop/Illustrator-style smart guides: snap the dragged rect's left/center/right (and top/center/bottom) to any
// candidate line (other objects' edges & centers, card edges & center, cut-line edges) within the threshold, and report
// the lines that actually snapped so the editor can draw guide lines. Picks the nearest candidate per axis.
export function computeSmartSnap(
  rect: { x: number; y: number; width: number; height: number },
  candidates: { x: number[]; y: number[] },
  canvas: Pick<TemplateCanvas, 'width' | 'height' | 'orientation'>,
  options: { thresholdMm?: number } = {},
): SmartSnapResult {
  const thresholdMm = options.thresholdMm ?? 0.6;
  const { xPxPerMm, yPxPerMm } = getCanvasPxPerMm(canvas);
  const xThreshold = thresholdMm * xPxPerMm;
  const yThreshold = thresholdMm * yPxPerMm;
  let { x, y } = rect;
  const guides: SnapGuideLine[] = [];

  let bestXShift = 0;
  let bestXDist = xThreshold + 1;
  let bestXLine: number | null = null;
  for (const line of candidates.x) {
    for (const point of [x, x + rect.width / 2, x + rect.width]) {
      const dist = Math.abs(point - line);
      if (dist <= xThreshold && dist < bestXDist) {
        bestXDist = dist;
        bestXShift = line - point;
        bestXLine = line;
      }
    }
  }
  if (bestXLine !== null) {
    x += bestXShift;
    guides.push({ axis: 'x', position: bestXLine });
  }

  let bestYShift = 0;
  let bestYDist = yThreshold + 1;
  let bestYLine: number | null = null;
  for (const line of candidates.y) {
    for (const point of [y, y + rect.height / 2, y + rect.height]) {
      const dist = Math.abs(point - line);
      if (dist <= yThreshold && dist < bestYDist) {
        bestYDist = dist;
        bestYShift = line - point;
        bestYLine = line;
      }
    }
  }
  if (bestYLine !== null) {
    y += bestYShift;
    guides.push({ axis: 'y', position: bestYLine });
  }

  return { x, y, guides };
}
