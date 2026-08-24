import type { EntityId, MmRect } from './shared';

export type BackAlignmentCorrection =
  | 'NONE'
  | 'FLIP_HORIZONTAL'
  | 'FLIP_VERTICAL'
  | 'FLIP_BOTH';

export type ExportSideMode = 'front' | 'back' | 'duplex';
export type CutLineStyle = 'solid' | 'dashed' | 'dotted' | 'corner-marks';

export interface CutLineSettings {
  enabled: boolean;
  style: CutLineStyle;
  widthMm: number;
  color: string;
  cornerMarkLengthMm: number;
  cornerMarkInsetMm: number;
  cutLineOffsetMm?: number;
  cutLineOffsetXmm?: number;
  cutLineOffsetYmm?: number;
  cutLineOffsetTopMm?: number;
  cutLineOffsetBottomMm?: number;
  cutLineOffsetLeftMm?: number;
  cutLineOffsetRightMm?: number;
  cornerRadiusMm?: number;
}

export interface SheetLayoutSettings {
  pageSize: 'A4' | 'A3';
  orientation: 'LANDSCAPE';
  columns: 5;
  rows: 2;
  outerMarginMm: number;
  /** Optional per-edge margins (mm). When all are undefined/0, the grid is centered (legacy A4 behaviour). */
  marginTopMm?: number;
  marginBottomMm?: number;
  marginLeftMm?: number;
  marginRightMm?: number;
  gapMm: number;
  /** Optional separate card gaps (mm). Fall back to gapMm when undefined. */
  gapXmm?: number;
  gapYmm?: number;
  labelHeightMm?: number;
  cardWidthMm: 53.98;
  cardHeightMm: 85.6;
}

export interface ExportSettings extends SheetLayoutSettings {
  alignmentCorrection: BackAlignmentCorrection;
  exportPdf: boolean;
  exportPng: boolean;
  zipPng: boolean;
  includeBack: boolean;
  sideMode?: ExportSideMode;
  dpi?: 300 | 600;
  cutLineSettings?: CutLineSettings;
}

export interface SheetCardPlacement extends MmRect {
  cardId: EntityId;
  sheetItemId?: EntityId;
  sheetIndex: number;
  indexOnSheet: number;
  row: number;
  column: number;
  labelHeightMm?: number;
  coordinateLockKey: string;
}

export interface SheetCardItem {
  sheetItemId: EntityId;
  cardId: EntityId;
}

export interface PrintSheet {
  id: EntityId;
  sheetIndex: number;
  side: 'front' | 'back';
  pageNumber: number;
  placements: SheetCardPlacement[];
  alignmentCorrection?: BackAlignmentCorrection;
}

export interface SheetPair {
  sheetIndex: number;
  frontPlacements: SheetCardPlacement[];
  backPlacements: SheetCardPlacement[];
  frontPageNumber: number;
  backPageNumber: number;
}
