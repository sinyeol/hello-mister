import type { CutLineSettings, CutLineStyle, MmRect, TemplateCanvas } from '@sticker-v1/types';

export const defaultCutLineSettings: CutLineSettings = {
  enabled: true,
  style: 'corner-marks',
  widthMm: 0.1,
  color: '#ff0000',
  cornerMarkLengthMm: 3,
  cornerMarkInsetMm: 0,
};

export const cutLineWidthOptionsMm = [0.1, 0.15, 0.2, 0.3, 0.5] as const;

export const cutLineStyleLabels: Record<CutLineStyle, string> = {
  solid: '실선',
  dashed: '점선',
  dotted: '파선',
  'corner-marks': 'ㄱ자 코너',
};

function normalizeCutLineStyle(style: unknown): CutLineStyle {
  const raw = String(style ?? '').trim().toLowerCase();
  const compact = raw.replace(/[\s_-]+/g, '');
  if (
    compact === 'cornermarks' ||
    compact === 'cornermark' ||
    raw === 'ㄱ자 코너' ||
    raw === '네 모서리 ㄱ자 마크' ||
    raw === 'corner mark' ||
    raw === 'corner marks'
  ) {
    return 'corner-marks';
  }
  if (raw === 'dashed' || raw === 'dash' || raw === '점선') return 'dashed';
  if (raw === 'dotted' || raw === 'dot' || raw === '파선' || raw === '긴 점선') return 'dotted';
  if (raw === 'solid' || raw === '실선') return 'solid';
  return defaultCutLineSettings.style;
}

function optionalFiniteNumber(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : undefined;
}

export function normalizeCutLineSettings(settings?: Partial<CutLineSettings>): CutLineSettings {
  const cutLineOffsetMm = optionalFiniteNumber(settings?.cutLineOffsetMm);
  const cutLineOffsetXmm = optionalFiniteNumber(settings?.cutLineOffsetXmm);
  const cutLineOffsetYmm = optionalFiniteNumber(settings?.cutLineOffsetYmm);
  const cutLineOffsetTopMm = optionalFiniteNumber(settings?.cutLineOffsetTopMm);
  const cutLineOffsetBottomMm = optionalFiniteNumber(settings?.cutLineOffsetBottomMm);
  const cutLineOffsetLeftMm = optionalFiniteNumber(settings?.cutLineOffsetLeftMm);
  const cutLineOffsetRightMm = optionalFiniteNumber(settings?.cutLineOffsetRightMm);
  const cornerRadiusMm = optionalFiniteNumber(settings?.cornerRadiusMm);

  return {
    ...defaultCutLineSettings,
    ...settings,
    style: normalizeCutLineStyle(settings?.style),
    widthMm: Math.max(0.05, Number(settings?.widthMm ?? defaultCutLineSettings.widthMm)),
    cornerMarkLengthMm: Math.max(0.5, Number(settings?.cornerMarkLengthMm ?? defaultCutLineSettings.cornerMarkLengthMm)),
    cornerMarkInsetMm: Number(settings?.cornerMarkInsetMm ?? defaultCutLineSettings.cornerMarkInsetMm),
    color: settings?.color || defaultCutLineSettings.color,
    ...(cutLineOffsetMm === undefined ? {} : { cutLineOffsetMm }),
    ...(cutLineOffsetXmm === undefined ? {} : { cutLineOffsetXmm }),
    ...(cutLineOffsetYmm === undefined ? {} : { cutLineOffsetYmm }),
    ...(cutLineOffsetTopMm === undefined ? {} : { cutLineOffsetTopMm }),
    ...(cutLineOffsetBottomMm === undefined ? {} : { cutLineOffsetBottomMm }),
    ...(cutLineOffsetLeftMm === undefined ? {} : { cutLineOffsetLeftMm }),
    ...(cutLineOffsetRightMm === undefined ? {} : { cutLineOffsetRightMm }),
    ...(cornerRadiusMm === undefined ? {} : { cornerRadiusMm: Math.max(0, cornerRadiusMm) }),
  };
}

export function cutLineDashArrayMm(style: CutLineStyle) {
  if (style === 'dashed') return [3, 2];
  if (style === 'dotted') return [0.5, 1.5];
  return [];
}

export type CutLineSegment = {
  x1Mm: number;
  y1Mm: number;
  x2Mm: number;
  y2Mm: number;
};

export type CutLineGeometryMm = {
  rect: MmRect;
  radiusMm: number;
};

function firstFinite(...values: Array<number | undefined>) {
  return values.find((value): value is number => Number.isFinite(value));
}

export function getCutLineGeometryMm(
  rect: MmRect,
  settings?: Partial<CutLineSettings>,
  canvas?: Pick<TemplateCanvas, 'cutOffsetMm' | 'cornerRadiusMm' | 'cuttingLineRadiusMm'>,
): CutLineGeometryMm {
  const normalized = normalizeCutLineSettings(settings);
  const fallbackOffset = firstFinite(normalized.cutLineOffsetMm, canvas?.cutOffsetMm, 0) ?? 0;
  const xOffset = firstFinite(normalized.cutLineOffsetXmm, fallbackOffset) ?? fallbackOffset;
  const yOffset = firstFinite(normalized.cutLineOffsetYmm, fallbackOffset) ?? fallbackOffset;
  const left = firstFinite(normalized.cutLineOffsetLeftMm, xOffset) ?? xOffset;
  const right = firstFinite(normalized.cutLineOffsetRightMm, xOffset) ?? xOffset;
  const top = firstFinite(normalized.cutLineOffsetTopMm, yOffset) ?? yOffset;
  const bottom = firstFinite(normalized.cutLineOffsetBottomMm, yOffset) ?? yOffset;
  const width = Math.max(0, rect.widthMm - left - right);
  const height = Math.max(0, rect.heightMm - top - bottom);
  const radius = Math.max(0, firstFinite(normalized.cornerRadiusMm, canvas?.cuttingLineRadiusMm, canvas?.cornerRadiusMm, 0) ?? 0);

  return {
    rect: {
      xMm: rect.xMm + left,
      yMm: rect.yMm + top,
      widthMm: width,
      heightMm: height,
    },
    radiusMm: Math.min(radius, width / 2, height / 2),
  };
}

export function roundedRectPathMm(rect: MmRect, radiusMm: number) {
  const right = rect.xMm + rect.widthMm;
  const bottom = rect.yMm + rect.heightMm;
  const radius = Math.min(Math.max(0, radiusMm), rect.widthMm / 2, rect.heightMm / 2);
  if (radius <= 0) {
    return `M ${rect.xMm} ${rect.yMm} H ${right} V ${bottom} H ${rect.xMm} Z`;
  }
  return [
    `M ${rect.xMm + radius} ${rect.yMm}`,
    `H ${right - radius}`,
    `Q ${right} ${rect.yMm} ${right} ${rect.yMm + radius}`,
    `V ${bottom - radius}`,
    `Q ${right} ${bottom} ${right - radius} ${bottom}`,
    `H ${rect.xMm + radius}`,
    `Q ${rect.xMm} ${bottom} ${rect.xMm} ${bottom - radius}`,
    `V ${rect.yMm + radius}`,
    `Q ${rect.xMm} ${rect.yMm} ${rect.xMm + radius} ${rect.yMm}`,
    'Z',
  ].join(' ');
}

export function cornerMarkSegmentsForGeometryMm(geometry: CutLineGeometryMm, settings: CutLineSettings): CutLineSegment[] {
  const length = Math.max(0.5, settings.cornerMarkLengthMm);
  const inset = settings.cornerMarkInsetMm;
  const x = geometry.rect.xMm + inset;
  const y = geometry.rect.yMm + inset;
  const width = Math.max(0, geometry.rect.widthMm - inset * 2);
  const height = Math.max(0, geometry.rect.heightMm - inset * 2);
  const radius = Math.min(Math.max(0, geometry.radiusMm), width / 2, height / 2);
  const markLength = Math.min(length, width / 2, height / 2);
  const right = x + width;
  const bottom = y + height;
  const leftTangentX = x + radius;
  const rightTangentX = right - radius;
  const topTangentY = y + radius;
  const bottomTangentY = bottom - radius;

  return [
    { x1Mm: x, y1Mm: topTangentY + markLength, x2Mm: x, y2Mm: topTangentY },
    { x1Mm: leftTangentX, y1Mm: y, x2Mm: leftTangentX + markLength, y2Mm: y },
    { x1Mm: rightTangentX - markLength, y1Mm: y, x2Mm: rightTangentX, y2Mm: y },
    { x1Mm: right, y1Mm: topTangentY, x2Mm: right, y2Mm: topTangentY + markLength },
    { x1Mm: right, y1Mm: bottomTangentY - markLength, x2Mm: right, y2Mm: bottomTangentY },
    { x1Mm: rightTangentX, y1Mm: bottom, x2Mm: rightTangentX - markLength, y2Mm: bottom },
    { x1Mm: leftTangentX + markLength, y1Mm: bottom, x2Mm: leftTangentX, y2Mm: bottom },
    { x1Mm: x, y1Mm: bottomTangentY, x2Mm: x, y2Mm: bottomTangentY - markLength },
  ];
}

export function cornerMarkSegmentsMm(
  rect: MmRect,
  settings: CutLineSettings,
  canvas?: Pick<TemplateCanvas, 'cutOffsetMm' | 'cornerRadiusMm' | 'cuttingLineRadiusMm'>,
): CutLineSegment[] {
  return cornerMarkSegmentsForGeometryMm(getCutLineGeometryMm(rect, settings, canvas), settings);
}

export function hexToRgb01(color: string) {
  const normalized = color.trim().replace(/^#/, '');
  const value = normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized.padEnd(6, '0').slice(0, 6);
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return {
    r: Number.isFinite(red) ? red / 255 : 0,
    g: Number.isFinite(green) ? green / 255 : 0,
    b: Number.isFinite(blue) ? blue / 255 : 0,
  };
}
