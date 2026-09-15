// Ported from v1 scripts/test-sheet-editor.mjs. Guards the print rules in CLAUDE.md §7:
// A4 = 2 x 5 = 10 cards, 10 cards = 1 page, 20 cards = 2 pages, never a blank page, front/back share one placement list,
// and "Clear Sheet" only empties the active page.
import assert from 'node:assert/strict';
import { importTs, installBrowserGlobals } from './sticker-v1-test-utils.mjs';

installBrowserGlobals();

const {
  clearActiveSheetPageItems,
  createPrintPageDescriptors,
  createSheetCardItems,
  sheetCardIdsFromItems,
} = await importTs('src/features/sticker-v1/services/export/sheetEditorState.ts');
const { loadSavedPrintSheets, savePrintSheets } = await importTs('src/features/sticker-v1/services/export/savedSheets.ts');
const { computeSheetGrid, createSheetPlacements } = await importTs('src/features/sticker-v1/export/sheetLayout.ts');
const { getPageDimsMm } = await importTs('src/features/sticker-v1/export/pageDimensions.ts');

const cardIds = (count) => Array.from({ length: count }, (_, index) => `card_${index + 1}`);
const a4Settings = {
  pageSize: 'A4',
  orientation: 'LANDSCAPE',
  columns: 5,
  rows: 2,
  outerMarginMm: 0,
  gapMm: 0,
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
};

// --- A4 sheet grid: 2 x 5 = 10 cards ---
assert.deepEqual(getPageDimsMm({ pageSize: 'A4' }), { widthMm: 297, heightMm: 210 }, 'A4 landscape sheet is 297 x 210 mm');
const grid = computeSheetGrid(a4Settings);
assert.equal(grid.columns, 5, 'A4 sheet has 5 columns');
assert.equal(grid.rows, 2, 'A4 sheet has 2 rows');
assert.equal(grid.perSheet, 10, 'A4 sheet holds 10 cards');
const legacyGrid = computeSheetGrid({ ...a4Settings, outerMarginMm: 8, gapMm: 2 });
assert.equal(legacyGrid.perSheet, 10, 'legacy 8 mm margin / 2 mm gap settings still fit 10 cards per A4 sheet');

// --- sheet count: 10 = 1 page, 20 = 2 pages, no empty sheets ---
assert.equal(createSheetPlacements(cardIds(1), a4Settings).length, 1, '1 card = 1 sheet');
assert.equal(createSheetPlacements(cardIds(10), a4Settings).length, 1, '10 cards = 1 sheet');
assert.equal(createSheetPlacements(cardIds(11), a4Settings).length, 2, '11 cards = 2 sheets');
assert.equal(createSheetPlacements(cardIds(20), a4Settings).length, 2, '20 cards = 2 sheets');
assert.equal(createSheetPlacements(cardIds(0), a4Settings).length, 0, '0 cards = no sheet at all');

const twoSheets = createSheetPlacements(cardIds(20), a4Settings);
assert.deepEqual(twoSheets.map((sheet) => sheet.frontPlacements.length), [10, 10], 'both sheets are full, nothing spills into a third page');
assert.deepEqual(twoSheets.map((sheet) => [sheet.frontPageNumber, sheet.backPageNumber]), [[1, 2], [3, 4]], 'duplex page numbers run 1-2 then 3-4 without gaps');
const placementIdentity = (placement) => [placement.cardId, placement.sheetItemId, placement.row, placement.column, placement.xMm, placement.yMm, placement.widthMm, placement.heightMm];
twoSheets.forEach((sheet, sheetIndex) => {
  assert.equal(sheet.sheetIndex, sheetIndex, 'sheet index follows placement order');
  assert.deepEqual(sheet.backPlacements.map(placementIdentity), sheet.frontPlacements.map(placementIdentity), 'back placements are derived from the same placement list as the front (no drift)');
  assert.deepEqual(sheet.frontPlacements.map((placement) => placement.cardId), cardIds(20).slice(sheetIndex * 10, sheetIndex * 10 + 10), 'card order is preserved across sheets');
  sheet.frontPlacements.forEach((placement) => {
    assert.ok(placement.xMm >= 0 && placement.xMm + placement.widthMm <= 297 + 1e-6, `card ${placement.cardId} stays inside the A4 width`);
    assert.ok(placement.yMm >= 0 && placement.yMm + placement.heightMm + placement.labelHeightMm <= 210 + 1e-6, `card ${placement.cardId} stays inside the A4 height`);
  });
});

// --- print page descriptors: never a blank page between or after sheets ---
const describe = (count, sideMode) => createPrintPageDescriptors(count, 10, sideMode).map((page) => `${page.sheetIndex}:${page.side}`);
assert.equal(createPrintPageDescriptors(1, 10, 'front').length, 1, '1 card prints 1 page');
assert.equal(createPrintPageDescriptors(10, 10, 'front').length, 1, '10 cards print 1 page');
assert.equal(createPrintPageDescriptors(11, 10, 'front').length, 2, '11 cards print 2 pages');
assert.equal(createPrintPageDescriptors(20, 10, 'front').length, 2, '20 cards print 2 pages');
assert.deepEqual(describe(20, 'front'), ['0:front', '1:front'], 'front mode renders no blank pages between or after sheets');
assert.deepEqual(describe(20, 'back'), ['0:back', '1:back'], 'back mode renders only back pages');
assert.deepEqual(describe(20, 'duplex'), ['0:front', '0:back', '1:front', '1:back'], 'duplex mode alternates front/back per sheet without blank pages');
assert.equal(createPrintPageDescriptors(0, 10, 'front').length, 0, 'empty sheets are not rendered for print');

// --- Clear Sheet: only the active page is emptied ---
const twentyIds = cardIds(20);
const items = createSheetCardItems(twentyIds, 7);
assert.deepEqual(sheetCardIdsFromItems(clearActiveSheetPageItems(items, 0, 10)), twentyIds.slice(10), 'clearing page 1 removes only the first 10 slots');
assert.deepEqual(sheetCardIdsFromItems(clearActiveSheetPageItems(items, 1, 10)), twentyIds.slice(0, 10), 'clearing page 2 keeps page 1 intact');
assert.deepEqual(clearActiveSheetPageItems(items, 5, 10), items, 'clearing a page that does not exist changes nothing');
assert.equal(items.length, 20, 'clear sheet does not mutate the original item list');

// --- Clear Sheet must not touch saved sheets, and the saved-sheet store stays backward compatible ---
const legacySavedSheet = {
  id: 'sheet_legacy_front',
  name: 'Legacy front sheet',
  side: 'front',
  pageIndex: 0,
  cardIds: twentyIds,
  placements: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const savedJob = {
  id: 'job_duplex',
  name: '인쇄 묶음 테스트',
  sideMode: 'duplex',
  cardIds: cardIds(30),
  settings: a4Settings,
  sheetCount: 3,
  createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
};
await savePrintSheets([legacySavedSheet, savedJob]);
const loaded = loadSavedPrintSheets();
assert.equal(loaded.length, 2, 'saved sheets are persisted');
clearActiveSheetPageItems(items, 0, 10);
assert.equal(loadSavedPrintSheets().length, 2, 'clear sheet must not delete saved sheets');
const loadedLegacy = loaded.find((sheet) => sheet.id === 'sheet_legacy_front');
assert.equal(loadedLegacy.sideMode, 'front', 'legacy per-page saved sheets are upgraded to a sideMode');
assert.deepEqual(loadedLegacy.cardIds, twentyIds, 'legacy saved sheet keeps its card ids');
const loadedJob = loaded.find((sheet) => sheet.id === 'job_duplex');
assert.equal(loadedJob.sideMode, 'duplex', 'saved job keeps its side mode');
assert.equal(loadedJob.sheetCount, 3, 'saved job keeps its sheet count');
assert.equal(loadedJob.cardIds.length, 30, 'saved job keeps the whole batch (30 cards = 3 sheets)');
assert.equal(loadedJob.settings.pageSize, 'A4', 'saved job keeps its export settings snapshot');

console.log('Sticker sheet editor and print page tests passed.');
