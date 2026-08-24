import type { GameEntry } from '@sticker-v1/types';
import { createId } from '@sticker-v1/utils/ids';

export interface ParsedGameRow {
  id: string;
  title: string;
  categoryId: string;
  source: 'TEXT' | 'TXT' | 'CSV' | 'SAMPLE';
  errors: string[];
}

export function parseTextGames(input: string, defaultCategoryId: string): ParsedGameRow[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((title) => ({
      id: createId('row'),
      title,
      categoryId: defaultCategoryId,
      source: 'TEXT' as const,
      errors: title ? [] : ['Title is required.'],
    }));
}

export function rowsToGameEntries(rows: ParsedGameRow[]): GameEntry[] {
  return rows
    .filter((row) => row.title.trim() && row.categoryId)
    .map((row) => ({
      id: row.id,
      title: row.title.trim(),
      categoryId: row.categoryId,
    }));
}
