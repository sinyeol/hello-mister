// Ported from v1 scripts/test-pagination-and-scan.mjs (minus the v1 HTTP bridge parts).
// Behavioural checks for list pagination, sheet item move/duplicate, cut line geometry and placement identity,
// plus source contracts that keep the sheet editor, PNG, PDF and direct print on ONE shared A4 render path.
import assert from 'node:assert/strict';
import { importTs, readRepoFile } from './sticker-v1-test-utils.mjs';

const { clampPage, pageCountFor, paginateItems } = await importTs('src/features/sticker-v1/utils/pagination.ts');
const {
  createSheetCardItems,
  duplicateSheetCardIds,
  duplicateSheetItems,
  moveSheetItem,
  sheetCardIdsFromItems,
} = await importTs('src/features/sticker-v1/services/export/sheetEditorState.ts');
const { createSheetPlacements } = await importTs('src/features/sticker-v1/export/sheetLayout.ts');
const {
  cornerMarkSegmentsForGeometryMm,
  getCutLineGeometryMm,
  normalizeCutLineSettings,
  roundedRectPathMm,
} = await importTs('src/features/sticker-v1/utils/cutLines.ts');

// --- list pagination (100 per page) ---
const items = Array.from({ length: 283 }, (_, index) => index + 1);
assert.equal(pageCountFor(items.length, 100), 3, '283 results with page size 100 should show 3 pages');
assert.deepEqual(paginateItems(items, 1, 100).items, items.slice(0, 100), 'page 1 shows items 1-100');
assert.deepEqual(paginateItems(items, 2, 100).items, items.slice(100, 200), 'page 2 shows items 101-200');
assert.deepEqual(paginateItems(items, 3, 100).items, items.slice(200), 'page 3 shows items 201-283');
assert.equal(clampPage(0, 3), 1, 'page input below 1 clamps to page 1');
assert.equal(clampPage(9, 3), 3, 'page input above total clamps to last page');
assert.equal(clampPage(Number.NaN, 3), 1, 'invalid page input clamps to page 1');

// --- sheet duplicates by card id ---
const duplicatedOnce = duplicateSheetCardIds(['card_1', 'card_2'], 'card_1', 1);
assert.deepEqual(duplicatedOnce.cardIds, ['card_1', 'card_2', 'card_1'], 'duplicate by 1 appends one extra copy into the next empty sheet slot');
assert.equal(duplicatedOnce.addedCount, 1, 'duplicate by 1 reports one added copy');
assert.deepEqual(
  duplicateSheetCardIds(['card_1', 'card_2'], 'card_1', 5).cardIds,
  ['card_1', 'card_2', 'card_1', 'card_1', 'card_1', 'card_1', 'card_1'],
  'duplicate by 5 fills empty sheet slots without reordering existing cards or creating album records',
);
assert.deepEqual(duplicateSheetCardIds(['card_1', 'card_2'], 'missing', 2).cardIds, ['card_1', 'card_2'], 'duplicate with missing card leaves sheet unchanged');

// --- sheet items: stable ids survive moves and duplicates ---
const sheetItems = createSheetCardItems(['card_1', 'card_2', 'card_3'], 99);
const movedSheetItems = moveSheetItem(sheetItems, sheetItems[0].sheetItemId, sheetItems[2].sheetItemId);
assert.deepEqual(sheetCardIdsFromItems(movedSheetItems), ['card_2', 'card_3', 'card_1'], 'moving a sheet card changes placement order only');
assert.equal(movedSheetItems[2].sheetItemId, sheetItems[0].sheetItemId, 'moved sheet item keeps the same stable sheet item id');
assert.equal(sheetItems[0].cardId, 'card_1', 'moving a sheet card does not mutate the original item record');

const duplicatedSheetItems = duplicateSheetItems(sheetItems, sheetItems[0].sheetItemId, 2, 100);
assert.deepEqual(sheetCardIdsFromItems(duplicatedSheetItems.items), ['card_1', 'card_2', 'card_3', 'card_1', 'card_1'], 'sheet duplicate fills later empty slots without reordering existing cards');
assert.equal(new Set(duplicatedSheetItems.items.map((item) => item.sheetItemId)).size, duplicatedSheetItems.items.length, 'duplicated sheet references each get stable unique item ids');
assert.equal(duplicatedSheetItems.items[3].cardId, sheetItems[0].cardId, 'duplicated sheet items keep the same source card id');
assert.notEqual(duplicatedSheetItems.items[3].sheetItemId, sheetItems[0].sheetItemId, 'duplicated sheet items get new sheet item ids');

// --- cut line geometry shared by preview, cutting file and print ---
const normalizedCutSettings = normalizeCutLineSettings({
  style: 'solid',
  cornerRadiusMm: '6',
  cutLineOffsetLeftMm: '1.25',
  cutLineOffsetRightMm: '2',
  cutLineOffsetTopMm: '0.5',
  cutLineOffsetBottomMm: '1',
  widthMm: '0.15',
});
assert.equal(normalizedCutSettings.cornerRadiusMm, 6, 'saved string R value is normalized into a usable millimeter radius');
const cutGeometry = getCutLineGeometryMm({ xMm: 10, yMm: 20, widthMm: 53.98, heightMm: 85.6 }, normalizedCutSettings);
assert.equal(cutGeometry.rect.xMm, 11.25, 'saved left cutting offset changes exported cut geometry');
assert.equal(cutGeometry.rect.yMm, 20.5, 'saved top cutting offset changes exported cut geometry');
assert.equal(cutGeometry.radiusMm, 6, 'saved R value is preserved in shared cut geometry');
assert.match(roundedRectPathMm(cutGeometry.rect, cutGeometry.radiusMm), /Q/, 'R > 0 produces rounded rectangle path geometry');
const tangentCornerMarks = cornerMarkSegmentsForGeometryMm(cutGeometry, normalizeCutLineSettings({ ...normalizedCutSettings, style: 'corner-marks', cornerMarkLengthMm: 3 }));
assert.equal(tangentCornerMarks[0].y2Mm, cutGeometry.rect.yMm + cutGeometry.radiusMm, 'corner mark mode respects saved R by placing marks on rounded-corner tangents');

// --- placements keep sheet item identity (React keys / coordinate locks are per item, not per slot) ---
const placementPairs = createSheetPlacements(movedSheetItems, {
  pageSize: 'A4',
  orientation: 'LANDSCAPE',
  columns: 5,
  rows: 2,
  outerMarginMm: 8,
  gapMm: 2,
  labelHeightMm: 6,
  cardWidthMm: 53.98,
  cardHeightMm: 85.6,
  dpi: 300,
  includeBack: false,
  sideMode: 'front',
  alignmentCorrection: 'NONE',
  exportPdf: true,
  exportPng: true,
  zipPng: true,
});
assert.equal(placementPairs.length, 1, 'three cards fit on one sheet');
assert.equal(placementPairs[0].frontPlacements[2].sheetItemId, sheetItems[0].sheetItemId, 'print placements preserve moved sheet item identity');
assert.equal(placementPairs[0].frontPlacements[2].coordinateLockKey, sheetItems[0].sheetItemId, 'placement React identity is based on sheet item id, not slot index');

// --- source contracts: one shared A4 render path for sheet editor, PNG, PDF and direct print ---
const printSheetSource = readRepoFile('src/features/sticker-v1/components/export/PrintSheetPreview.tsx');
assert.match(printSheetSource, /data-print-sheet-a4="true"/, 'sheet preview marks the exact A4 DOM node used by PNG and PDF export');
assert.match(printSheetSource, /data-sheet-side=\{side\}/, 'sheet preview exposes side metadata for shared sheet exports');
assert.match(printSheetSource, /key=\{sheetItemId\}/, 'print sheet preview keys cards by stable sheet item id');
assert.match(printSheetSource, /shouldRotateLandscape/, 'print sheet preview detects landscape cards');
assert.match(printSheetSource, /CutLineOverlay/, 'print sheet preview renders cut lines as a placement overlay');

const exportPreviewSource = readRepoFile('src/features/sticker-v1/pages/ExportPreviewPage.tsx');
assert.match(exportPreviewSource, /moveSheetItem\(current, fromSheetItemId, toSheetItemId\)/, 'sheet editor moves stable sheet items instead of copied card data');
assert.match(exportPreviewSource, /async function renderCurrentSheetImages/, 'PNG and PDF export must first render the print-ready Sheet Editor DOM');
assert.match(exportPreviewSource, /renderPrintSheetElementsToPngBlobs\(root, exportDpi\)/, 'sheet exports must capture the visible A4 sheet DOM as their source image');
assert.match(exportPreviewSource, /exportSheetImagesPdf\(sheetImages/, 'PDF export must consume the shared rendered sheet images');
assert.match(exportPreviewSource, /exportRenderedSheetPngZip\(sheetImages/, 'PNG export must consume the same rendered sheet images as PDF');
assert.match(exportPreviewSource, /renderedSheetImagesForPrint = await renderCurrentSheetImages\(\)/, 'direct print must render the same A4 sheet images used by PNG and PDF export');
assert.match(exportPreviewSource, /openSystemPrintDialogFromSheetImages\(renderedSheetImagesForPrint\)/, 'direct print must print the shared sheet-level rendered images instead of copied card DOM');
assert.match(exportPreviewSource, /print-color-adjust: exact/, 'direct print window must ask the browser to preserve printed colors');
assert.match(exportPreviewSource, /printCurrentSheetDirect/, 'top-level print action opens system print after preparation');
assert.match(exportPreviewSource, /async function exportCurrentPrintSheetToPdf/, 'PDF export is routed through one current-sheet export function');
assert.doesNotMatch(exportPreviewSource, /exportCardsPdf|exportCardsPngZip/, 'print/export page must not call independent card-level PNG/PDF exporters');

const exportPdfSource = readRepoFile('src/features/sticker-v1/services/export/exportPdf.ts');
assert.match(exportPdfSource, /exportSheetImagesPdf/, 'PDF export must accept pre-rendered Sheet Editor A4 images');
assert.doesNotMatch(exportPdfSource, /drawPdfCutLine|renderCardPng|createSheetPlacements/, 'PDF export must not rebuild sheets, cards or cut geometry independently');

const sheetDomExportSource = readRepoFile('src/features/sticker-v1/services/export/sheetDomExport.ts');
assert.match(sheetDomExportSource, /querySelectorAll<HTMLElement>\('\[data-print-sheet-a4="true"\]'\)/, 'shared sheet export captures the Sheet Editor A4 DOM nodes');
assert.match(sheetDomExportSource, /foreignObject/, 'shared sheet export renders the Sheet Editor DOM into a sheet image');
assert.match(sheetDomExportSource, /window\.getComputedStyle/, 'shared sheet export preserves the Sheet Editor visual CSS, including clipping');
assert.match(sheetDomExportSource, /exportRenderedSheetPngZip/, 'PNG export must save the same rendered sheet images used by PDF');
assert.match(sheetDomExportSource, /captureSheetHtmlWithElectron/, 'shared sheet export must fall back to Electron sheet-level HTML capture if foreignObject canvas export is tainted');
assert.match(sheetDomExportSource, /images\.length === 1/, 'single sheet PNG export should save a direct PNG instead of forcing an archive');

const downloadSource = readRepoFile('src/features/sticker-v1/services/export/download.ts');
assert.match(downloadSource, /export async function saveBytes/, 'export saving must provide an awaitable saveBytes flow');
assert.match(downloadSource, /window\.zaparooDesktop\?\.saveFile/, 'export saving must use the Electron save dialog bridge when available');

const electronMainSource = readRepoFile('electron/main.mjs');
const electronPreloadSource = readRepoFile('electron/preload.mjs');
assert.match(electronMainSource, /zaparoo:save-file/, 'Electron main process must expose a save dialog and file write bridge');
assert.match(electronMainSource, /zaparoo:capture-html-png/, 'Electron main process must expose sheet-level HTML PNG capture for tainted foreignObject fallback');
assert.match(electronMainSource, /capturePage/, 'Electron sheet capture fallback must capture the sanitized A4 sheet HTML as a PNG');
assert.match(electronPreloadSource, /saveFile/, 'Electron preload must expose the save file bridge to the renderer');
assert.match(electronPreloadSource, /captureHtmlAsPng/, 'Electron preload must expose the sheet-level HTML capture bridge to the renderer');
assert.match(electronPreloadSource, /readFileAsDataUrl/, 'Electron preload must expose the local image file data URL bridge to the renderer');
assert.match(electronPreloadSource, /fetchImageAsDataUrl/, 'Electron preload must expose the remote image data URL bridge to the renderer');
assert.match(electronPreloadSource, /getPathForFile/, 'Electron preload must expose File to absolute path resolution for Image Management source paths');

console.log('Sticker pagination, sheet item and print pipeline tests passed.');
