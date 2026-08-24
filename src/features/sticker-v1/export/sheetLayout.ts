import type { ExportSettings, SheetCardItem, SheetCardPlacement, SheetPair } from '@sticker-v1/types';
import { getPageDimsMm } from '@sticker-v1/export/pageDimensions';

function sheetItemFromInput(input: string | SheetCardItem, index: number): SheetCardItem {
  if (typeof input === 'string') return { cardId: input, sheetItemId: `sheet-item:${index}:${input}` };
  return input;
}

function firstFinite(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

export interface SheetGrid {
  pageWidthMm: number;
  pageHeightMm: number;
  columns: number;
  rows: number;
  perSheet: number;
  labelHeightMm: number;
  gapX: number;
  gapY: number;
  startX: number;
  startY: number;
  colPitch: number;
  rowPitch: number;
}

// Auto-fit grid: fit as many cards as the (paper − margins) area allows, centered within that usable area.
// With zero margins on A4 this reproduces the legacy 5x2 centered layout pixel-for-pixel. Single source for both the
// placement builder and the UI (so the displayed "N per sheet" matches the real output).
export function computeSheetGrid(settings: ExportSettings): SheetGrid {
  const page = getPageDimsMm(settings);
  const labelHeightMm = settings.labelHeightMm ?? 6;
  const gapX = firstFinite(settings.gapXmm, settings.gapMm, 0);
  const gapY = firstFinite(settings.gapYmm, settings.gapMm, 0);
  const marginLeft = firstFinite(settings.marginLeftMm, settings.outerMarginMm, 0);
  const marginRight = firstFinite(settings.marginRightMm, settings.outerMarginMm, 0);
  const marginTop = firstFinite(settings.marginTopMm, settings.outerMarginMm, 0);
  const marginBottom = firstFinite(settings.marginBottomMm, settings.outerMarginMm, 0);

  const usableWidth = Math.max(0, page.widthMm - marginLeft - marginRight);
  const usableHeight = Math.max(0, page.heightMm - marginTop - marginBottom);
  const colPitch = settings.cardWidthMm + gapX;
  const rowPitch = settings.cardHeightMm + labelHeightMm + gapY;
  const columns = Math.max(1, Math.floor((usableWidth + gapX) / colPitch));
  const rows = Math.max(1, Math.floor((usableHeight + gapY) / rowPitch));

  const gridWidth = columns * settings.cardWidthMm + (columns - 1) * gapX;
  const gridHeight = rows * settings.cardHeightMm + rows * labelHeightMm + (rows - 1) * gapY;
  const startX = marginLeft + Math.max(0, (usableWidth - gridWidth) / 2);
  const startY = marginTop + Math.max(0, (usableHeight - gridHeight) / 2);

  return {
    pageWidthMm: page.widthMm,
    pageHeightMm: page.heightMm,
    columns,
    rows,
    perSheet: columns * rows,
    labelHeightMm,
    gapX,
    gapY,
    startX,
    startY,
    colPitch,
    rowPitch,
  };
}

export function createSheetPlacements(cardItems: Array<string | SheetCardItem>, settings: ExportSettings): SheetPair[] {
  const { columns, perSheet, labelHeightMm, startX, startY, colPitch, rowPitch } = computeSheetGrid(settings);
  const sheetCount = Math.ceil(cardItems.length / perSheet);

  return Array.from({ length: sheetCount }, (_, sheetIndex) => {
    const itemsForSheet = cardItems.slice(sheetIndex * perSheet, (sheetIndex + 1) * perSheet).map((item, index) => sheetItemFromInput(item, sheetIndex * perSheet + index));
    const placements: SheetCardPlacement[] = itemsForSheet.map((item, indexOnSheet) => {
      const row = Math.floor(indexOnSheet / columns);
      const column = indexOnSheet % columns;
      return {
        cardId: item.cardId,
        sheetItemId: item.sheetItemId,
        sheetIndex,
        indexOnSheet,
        row,
        column,
        xMm: startX + column * colPitch,
        yMm: startY + row * rowPitch,
        widthMm: settings.cardWidthMm,
        heightMm: settings.cardHeightMm,
        labelHeightMm,
        coordinateLockKey: item.sheetItemId,
      };
    });

    return {
      sheetIndex,
      frontPlacements: placements,
      backPlacements: placements.map((placement) => ({ ...placement })),
      frontPageNumber: sheetIndex * 2 + 1,
      backPageNumber: sheetIndex * 2 + 2,
    };
  });
}
