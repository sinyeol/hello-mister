import type { ExportSideMode, SheetCardItem } from '@sticker-v1/types';

export interface PrintPageDescriptor {
  sheetIndex: number;
  side: 'front' | 'back';
}

export function clearActiveSheetPageCardIds(cardIds: string[], pageIndex: number, cardsPerSheet: number) {
  if (cardsPerSheet <= 0 || cardIds.length === 0) return cardIds;
  const safePageIndex = Math.max(0, Math.floor(pageIndex));
  const start = safePageIndex * cardsPerSheet;
  if (start >= cardIds.length) return cardIds;
  return [...cardIds.slice(0, start), ...cardIds.slice(start + cardsPerSheet)];
}

export function createSheetCardItems(cardIds: string[], seed = Date.now()): SheetCardItem[] {
  return cardIds.map((cardId, index) => ({
    cardId,
    sheetItemId: `sheet-item:${seed}:${index}:${cardId}`,
  }));
}

export function sheetCardIdsFromItems(items: SheetCardItem[]) {
  return items.map((item) => item.cardId);
}

export function clearActiveSheetPageItems(items: SheetCardItem[], pageIndex: number, cardsPerSheet: number) {
  if (cardsPerSheet <= 0 || items.length === 0) return items;
  const safePageIndex = Math.max(0, Math.floor(pageIndex));
  const start = safePageIndex * cardsPerSheet;
  if (start >= items.length) return items;
  return [...items.slice(0, start), ...items.slice(start + cardsPerSheet)];
}

export function moveSheetItem(items: SheetCardItem[], fromSheetItemId: string, toSheetItemId: string) {
  const fromIndex = items.findIndex((item) => item.sheetItemId === fromSheetItemId);
  const toIndex = items.findIndex((item) => item.sheetItemId === toSheetItemId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return items;
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function duplicateSheetItems(items: SheetCardItem[], sheetItemId: string, additionalCopies: number, seed = Date.now()) {
  const quantity = Math.max(0, Math.floor(additionalCopies));
  if (!sheetItemId || quantity <= 0) return { items, addedCount: 0 };
  const selectedIndex = items.findIndex((item) => item.sheetItemId === sheetItemId);
  if (selectedIndex === -1) return { items, addedCount: 0 };
  const source = items[selectedIndex];
  const existingIds = new Set(items.map((item) => item.sheetItemId));
  const copies = Array.from({ length: quantity }, (_, index) => ({
    ...source,
    sheetItemId: uniqueDuplicateSheetItemId(source, seed, index, existingIds),
  }));
  return {
    items: [...items, ...copies],
    addedCount: quantity,
  };
}

export function duplicateSheetCardIds(cardIds: string[], cardId: string, additionalCopies: number) {
  const quantity = Math.max(0, Math.floor(additionalCopies));
  if (!cardId || quantity <= 0) return { cardIds, addedCount: 0 };
  const selectedIndex = cardIds.indexOf(cardId);
  if (selectedIndex === -1) return { cardIds, addedCount: 0 };
  const copies = Array.from({ length: quantity }, () => cardId);
  return {
    cardIds: [...cardIds, ...copies],
    addedCount: quantity,
  };
}

function uniqueDuplicateSheetItemId(source: SheetCardItem, seed: number, index: number, existingIds: Set<string>) {
  const baseId = `sheet-item:${seed}:copy:${index}:${source.sheetItemId}:${source.cardId}`;
  let candidate = baseId;
  let suffix = 2;
  while (existingIds.has(candidate)) {
    candidate = `${baseId}:${suffix}`;
    suffix += 1;
  }
  existingIds.add(candidate);
  return candidate;
}

export function createPrintPageDescriptors(cardCount: number, cardsPerSheet: number, sideMode: ExportSideMode): PrintPageDescriptor[] {
  if (cardCount <= 0 || cardsPerSheet <= 0) return [];
  const sheetCount = Math.ceil(cardCount / cardsPerSheet);
  return Array.from({ length: sheetCount }, (_, sheetIndex) => {
    if (sideMode === 'front') return [{ sheetIndex, side: 'front' as const }];
    if (sideMode === 'back') return [{ sheetIndex, side: 'back' as const }];
    return [
      { sheetIndex, side: 'front' as const },
      { sheetIndex, side: 'back' as const },
    ];
  }).flat();
}
