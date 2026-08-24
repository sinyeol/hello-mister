export type ImageCropValues = {
  cropTop?: number;
  cropRight?: number;
  cropBottom?: number;
  cropLeft?: number;
};

export type ImageNaturalSize = {
  width?: number;
  height?: number;
};

const minVisibleSourcePx = 1;

function finiteNonNegative(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

export function hasNaturalImageSize(size?: ImageNaturalSize) {
  return Number(size?.width) > 0 && Number(size?.height) > 0;
}

export function clampImageCropPx(crop: ImageCropValues, naturalSize?: ImageNaturalSize): Required<ImageCropValues> {
  const width = Math.max(minVisibleSourcePx, Math.floor(Number(naturalSize?.width ?? 0)));
  const height = Math.max(minVisibleSourcePx, Math.floor(Number(naturalSize?.height ?? 0)));

  const cropLeft = Math.min(finiteNonNegative(crop.cropLeft), Math.max(0, width - minVisibleSourcePx));
  let cropRight = Math.min(finiteNonNegative(crop.cropRight), Math.max(0, width - cropLeft - minVisibleSourcePx));
  const cropTop = Math.min(finiteNonNegative(crop.cropTop), Math.max(0, height - minVisibleSourcePx));
  let cropBottom = Math.min(finiteNonNegative(crop.cropBottom), Math.max(0, height - cropTop - minVisibleSourcePx));

  if (cropLeft + cropRight >= width) {
    cropRight = Math.max(0, width - cropLeft - minVisibleSourcePx);
  }
  if (cropTop + cropBottom >= height) {
    cropBottom = Math.max(0, height - cropTop - minVisibleSourcePx);
  }

  return { cropTop, cropRight, cropBottom, cropLeft };
}

export function imageCropInsetPercent(crop: ImageCropValues, naturalSize?: ImageNaturalSize) {
  if (!hasNaturalImageSize(naturalSize)) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  const clamped = clampImageCropPx(crop, naturalSize);
  const width = Math.max(minVisibleSourcePx, Number(naturalSize?.width));
  const height = Math.max(minVisibleSourcePx, Number(naturalSize?.height));
  return {
    top: (clamped.cropTop / height) * 100,
    right: (clamped.cropRight / width) * 100,
    bottom: (clamped.cropBottom / height) * 100,
    left: (clamped.cropLeft / width) * 100,
  };
}

export function imageCropSourceRect(
  naturalSize: Required<ImageNaturalSize>,
  crop: ImageCropValues,
) {
  const clamped = clampImageCropPx(crop, naturalSize);
  const width = Math.max(minVisibleSourcePx, Number(naturalSize.width));
  const height = Math.max(minVisibleSourcePx, Number(naturalSize.height));
  return {
    sx: clamped.cropLeft,
    sy: clamped.cropTop,
    sw: Math.max(minVisibleSourcePx, width - clamped.cropLeft - clamped.cropRight),
    sh: Math.max(minVisibleSourcePx, height - clamped.cropTop - clamped.cropBottom),
  };
}
