import type { SheetLayoutSettings } from '@sticker-v1/types';

export interface PageDimsMm {
  widthMm: number;
  heightMm: number;
}

// Single source of truth for the physical paper size used by the sheet grid, preview, export and print paths.
// Orientation is LANDSCAPE today. A4 MUST return exactly {297,210} so existing A4 sheets stay pixel-identical.
export function getPageDimsMm(settings: Pick<SheetLayoutSettings, 'pageSize'>): PageDimsMm {
  if (settings.pageSize === 'A3') return { widthMm: 420, heightMm: 297 };
  return { widthMm: 297, heightMm: 210 };
}
