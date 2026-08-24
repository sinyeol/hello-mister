import type { ImageFitMode, SlotOverride } from '@sticker-v1/types';
import { resizeRectFromCenterPreserveAspect } from '@sticker-v1/utils/cardGeometry';

export interface ImageTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX?: number;
  scaleY?: number;
  fitMode?: ImageFitMode;
  rotation?: number;
  cropTop?: number;
  cropRight?: number;
  cropBottom?: number;
  cropLeft?: number;
}

export const defaultHeroTransform: ImageTransform = {
  x: 72,
  y: 260,
  width: 756,
  height: 820,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
};

export const imageTransformLimits = {
  minWidth: 12,
  minHeight: 12,
  maxWidth: 7200,
  maxHeight: 11416,
};

export const mainImageDefaultCenteredZoomSteps = 25;

export function applyCenteredImageZoom(transform: ImageTransform, steps: number, edgeDeltaPx = 1): ImageTransform {
  const stepCount = Math.abs(Math.trunc(steps));
  const direction = steps >= 0 ? 1 : -1;
  let next = { ...transform };
  for (let index = 0; index < stepCount; index += 1) {
    const resized = resizeRectFromCenterPreserveAspect(
      next,
      direction * edgeDeltaPx,
      imageTransformLimits.minWidth,
      imageTransformLimits.minHeight,
    );
    const widthScale = resized.width / Math.max(next.width, 1);
    const heightScale = resized.height / Math.max(next.height, 1);
    const resizeScale = Number.isFinite(widthScale) && Number.isFinite(heightScale)
      ? (widthScale + heightScale) / 2
      : 1;
    const currentScale = Number.isFinite(next.scaleX) && Number.isFinite(next.scaleY)
      ? ((next.scaleX ?? 1) + (next.scaleY ?? next.scaleX ?? 1)) / 2
      : (next.scaleX ?? next.scaleY ?? 1);
    const uniformScale = Math.max(0.0001, currentScale * resizeScale);
    next = {
      ...next,
      ...resized,
      scaleX: uniformScale,
      scaleY: uniformScale,
    };
  }
  return next;
}

export function applyMainImageDefaultZoom(transform: ImageTransform): ImageTransform {
  return applyCenteredImageZoom(transform, mainImageDefaultCenteredZoomSteps);
}

export function resolveImageTransform(override?: SlotOverride): ImageTransform {
  const scaleX = override?.scaleX ?? 1;
  const scaleY = override?.scaleY ?? scaleX;

  return clampImageTransform({
    x: override?.x ?? defaultHeroTransform.x,
    y: override?.y ?? defaultHeroTransform.y,
    width: override?.width ?? defaultHeroTransform.width * scaleX,
    height: override?.height ?? defaultHeroTransform.height * scaleY,
    scaleX,
    scaleY,
    fitMode: override?.fitMode,
    rotation: override?.rotation ?? 0,
    cropTop: override?.cropTop ?? 0,
    cropRight: override?.cropRight ?? 0,
    cropBottom: override?.cropBottom ?? 0,
    cropLeft: override?.cropLeft ?? 0,
  });
}

export function toHeroSlotOverride(transform: ImageTransform): SlotOverride {
  return {
    x: transform.x,
    y: transform.y,
    width: transform.width,
    height: transform.height,
    scaleX: transform.scaleX ?? transform.width / defaultHeroTransform.width,
    scaleY: transform.scaleY ?? transform.height / defaultHeroTransform.height,
    fitMode: transform.fitMode,
    rotation: transform.rotation,
    cropTop: transform.cropTop,
    cropRight: transform.cropRight,
    cropBottom: transform.cropBottom,
    cropLeft: transform.cropLeft,
  };
}

export function clampImageTransform(transform: ImageTransform): ImageTransform {
  return {
    ...transform,
    width: Math.min(Math.max(transform.width, imageTransformLimits.minWidth), imageTransformLimits.maxWidth),
    height: Math.min(Math.max(transform.height, imageTransformLimits.minHeight), imageTransformLimits.maxHeight),
  };
}

function withScaleFromStart(start: ImageTransform, width: number, height: number): ImageTransform {
  const widthScale = width / Math.max(start.width, 1);
  const heightScale = height / Math.max(start.height, 1);
  return {
    ...start,
    width,
    height,
    scaleX: (start.scaleX ?? 1) * widthScale,
    scaleY: (start.scaleY ?? 1) * heightScale,
  };
}

export function resizeFromTopLeft(
  start: ImageTransform,
  pointer: { x: number; y: number },
  lockAspectRatio: boolean,
): ImageTransform {
  const rawWidth = Math.max(pointer.x - start.x, imageTransformLimits.minWidth);
  const rawHeight = Math.max(pointer.y - start.y, imageTransformLimits.minHeight);

  if (lockAspectRatio) {
    const requestedScale = Math.max(rawWidth / Math.max(start.width, 1), rawHeight / Math.max(start.height, 1));
    const minScale = Math.max(imageTransformLimits.minWidth / Math.max(start.width, 1), imageTransformLimits.minHeight / Math.max(start.height, 1));
    const maxScale = Math.min(imageTransformLimits.maxWidth / Math.max(start.width, 1), imageTransformLimits.maxHeight / Math.max(start.height, 1));
    const scale = Math.min(Math.max(requestedScale, minScale), maxScale);
    return {
      ...withScaleFromStart(start, start.width * scale, start.height * scale),
      x: start.x,
      y: start.y,
    };
  }

  const width = Math.min(Math.max(rawWidth, imageTransformLimits.minWidth), imageTransformLimits.maxWidth);
  const height = Math.min(Math.max(rawHeight, imageTransformLimits.minHeight), imageTransformLimits.maxHeight);
  return {
    ...withScaleFromStart(start, width, height),
    x: start.x,
    y: start.y,
  };
}

export function resizeToSizeFromTopLeft(
  start: ImageTransform,
  size: { width: number; height: number },
): ImageTransform {
  return clampImageTransform({
    ...withScaleFromStart(start, size.width, size.height),
    x: start.x,
    y: start.y,
  });
}
