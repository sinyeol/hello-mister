import type { ImageFitMode } from '@sticker-v1/types';
import type { ImageTransform } from '@sticker-v1/utils/imageTransform';

export interface FitSourceSize {
  width?: number;
  height?: number;
}

export interface FitBounds {
  width: number;
  height: number;
}

export const imageFitModeLabels: Record<ImageFitMode, string> = {
  cover: 'Fill / Cover',
  contain: 'Fit / Contain',
  stretch: 'Stretch',
  original: 'Original',
};

export function defaultFitModeForSlot(slotType?: string): ImageFitMode {
  return slotType === 'gameLogo' || slotType === 'platformLogo' || slotType === 'titleImage' || slotType === 'brandLogo'
    ? 'contain'
    : 'cover';
}

export function fitImageToBounds(mode: ImageFitMode, source: FitSourceSize, bounds: FitBounds): ImageTransform {
  const sourceWidth = Math.max(source.width ?? bounds.width, 1);
  const sourceHeight = Math.max(source.height ?? bounds.height, 1);
  const boundsWidth = Math.max(bounds.width, 1);
  const boundsHeight = Math.max(bounds.height, 1);

  if (mode === 'stretch') {
    return {
      x: 0,
      y: 0,
      width: boundsWidth,
      height: boundsHeight,
      scaleX: boundsWidth / sourceWidth,
      scaleY: boundsHeight / sourceHeight,
      fitMode: mode,
      rotation: 0,
    };
  }

  if (mode === 'original') {
    const scale = Math.min(1, boundsWidth / sourceWidth, boundsHeight / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    return {
      x: (boundsWidth - width) / 2,
      y: (boundsHeight - height) / 2,
      width,
      height,
      scaleX: scale,
      scaleY: scale,
      fitMode: mode,
      rotation: 0,
    };
  }

  const scale =
    mode === 'cover'
      ? Math.max(boundsWidth / sourceWidth, boundsHeight / sourceHeight)
      : Math.min(boundsWidth / sourceWidth, boundsHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (boundsWidth - width) / 2,
    y: (boundsHeight - height) / 2,
    width,
    height,
    scaleX: scale,
    scaleY: scale,
    fitMode: mode,
    rotation: 0,
  };
}
