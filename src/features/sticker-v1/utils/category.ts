import type { Category, CategoryColorPalette } from '@sticker-v1/types';
import { createId } from './ids';
import { toSlug } from './slug';

export const defaultNewCategoryPalette: CategoryColorPalette = {
  primary: '#222222',
  secondary: '#F5F5F5',
  accent: '#F36C21',
  neutral: '#D9D9D9',
};

export function toCategoryName(value: string) {
  return toSlug(value);
}

export function createCategory(displayName: string): Category {
  return {
    id: createId('cat'),
    name: toCategoryName(displayName) || 'custom-category',
    displayName,
    palette: defaultNewCategoryPalette,
    enabled: true,
  };
}

export function validateCategory(category: Category) {
  const errors: string[] = [];
  if (!category.displayName.trim()) errors.push('Display name is required.');
  if (!category.name.trim()) errors.push('Internal name is required.');
  return errors;
}
