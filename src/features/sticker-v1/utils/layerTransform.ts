import type { TemplateLayer } from '@sticker-v1/types';

export interface LayerTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  cropTop?: number;
  cropRight?: number;
  cropBottom?: number;
  cropLeft?: number;
}

export const layerTransformLimits = {
  minWidth: 24,
  minHeight: 24,
  maxWidth: 1800,
  maxHeight: 2854,
};

export const imageTransformLimits = {
  minWidth: 12,
  minHeight: 12,
  maxWidth: 7200,
  maxHeight: 11416,
};

type TransformLimits = typeof layerTransformLimits;

export function resolveLayerTransform(layer: TemplateLayer): LayerTransform {
  return {
    x: layer.x ?? 120,
    y: layer.y ?? 180,
    width: Math.min(Math.max(layer.width ?? 360, layerTransformLimits.minWidth), layerTransformLimits.maxWidth),
    height: Math.min(Math.max(layer.height ?? 180, layerTransformLimits.minHeight), layerTransformLimits.maxHeight),
    rotation: layer.rotation ?? 0,
    opacity: layer.opacity ?? 1,
  };
}

export function resizeLayerFromTopLeft(
  start: LayerTransform,
  pointer: { x: number; y: number },
  lockAspectRatio: boolean,
  limits: TransformLimits = layerTransformLimits,
): LayerTransform {
  let width = Math.max(pointer.x - start.x, limits.minWidth);
  let height = Math.max(pointer.y - start.y, limits.minHeight);

  if (lockAspectRatio) {
    const scale = Math.max(width / start.width, height / start.height);
    width = start.width * scale;
    height = start.height * scale;
  }

  width = Math.min(Math.max(width, limits.minWidth), limits.maxWidth);
  height = Math.min(Math.max(height, limits.minHeight), limits.maxHeight);

  return {
    ...start,
    width,
    height,
  };
}

export function resizeLayerToSizeFromTopLeft(
  start: LayerTransform,
  size: { width: number; height: number },
  limits: TransformLimits = layerTransformLimits,
) {
  const width = Math.min(Math.max(size.width, limits.minWidth), limits.maxWidth);
  const height = Math.min(Math.max(size.height, limits.minHeight), limits.maxHeight);

  return {
    ...start,
    width,
    height,
  };
}
