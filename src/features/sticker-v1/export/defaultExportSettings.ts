import type { ExportSettings } from '@sticker-v1/types';

export const defaultExportSettings: ExportSettings = {
  pageSize: 'A4',
  orientation: 'LANDSCAPE',
  columns: 5,
  rows: 2,
  outerMarginMm: 0,
  gapMm: 1.2,
  labelHeightMm: 6,
  cardWidthMm: 53.98,
  cardHeightMm: 85.6,
  alignmentCorrection: 'NONE',
  exportPdf: true,
  exportPng: true,
  zipPng: true,
  includeBack: false,
  sideMode: 'front',
  dpi: 300,
  cutLineSettings: {
    enabled: true,
    style: 'corner-marks',
    widthMm: 0.1,
    color: '#ff0000',
    cornerMarkLengthMm: 3,
    cornerMarkInsetMm: 0,
  },
};
