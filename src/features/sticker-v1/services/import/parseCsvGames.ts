import type { Category } from '@sticker-v1/types';
import { createId } from '@sticker-v1/utils/ids';
import { toCategoryName } from '@sticker-v1/utils/category';
import type { ParsedGameRow } from './parseTextGames';

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

function findCategoryId(value: string, categories: Category[], fallbackCategoryId: string) {
  const normalized = toCategoryName(value);
  return (
    categories.find(
      (category) => category.id === value || category.name === normalized || toCategoryName(category.displayName) === normalized,
    )?.id ?? fallbackCategoryId
  );
}

export function parseCsvGames(input: string, categories: Category[], fallbackCategoryId: string): ParsedGameRow[] {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase());
  const titleIndex = headers.indexOf('title');
  const categoryIndex = headers.indexOf('category');

  if (titleIndex === -1 || categoryIndex === -1) {
    return [
      {
        id: createId('row'),
        title: '',
        categoryId: fallbackCategoryId,
        source: 'CSV',
        errors: ['CSV must include title and category columns.'],
      },
    ];
  }

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const title = cells[titleIndex]?.trim() ?? '';
    const categoryValue = cells[categoryIndex]?.trim() ?? '';
    const errors: string[] = [];
    if (!title) errors.push('Title is required.');
    if (!categoryValue) errors.push('Category is required.');

    return {
      id: createId('row'),
      title,
      categoryId: findCategoryId(categoryValue, categories, fallbackCategoryId),
      source: 'CSV',
      errors,
    };
  });
}
