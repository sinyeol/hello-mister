import type { StickerCardStore, StickerImageLibraryStore, StickerSheetStore, StickerTemplateStore } from '../../types/stickers';
import { maskStickerLocalPath } from './stickerUtils';

const secretKeyPattern = /password|privateKey|passphrase|token|secret|credential|rawCommand/i;

export function sanitizeStickerExport<T>(value: T, options: { includeFullLocalPaths?: boolean } = {}): T {
  return JSON.parse(JSON.stringify(value, (key, innerValue) => {
    if (secretKeyPattern.test(key)) return '[removed]';
    if (typeof innerValue === 'string' && /path$/i.test(key)) {
      return maskStickerLocalPath(innerValue, Boolean(options.includeFullLocalPaths));
    }
    return innerValue;
  }));
}

export function sanitizeStickerLibraryExport(store: StickerImageLibraryStore, includeFullLocalPaths = false) {
  return sanitizeStickerExport(store, { includeFullLocalPaths });
}

export function sanitizeStickerTemplateExport(store: StickerTemplateStore) {
  return sanitizeStickerExport(store);
}

export function sanitizeStickerCardExport(store: StickerCardStore, includeFullLocalPaths = false) {
  return sanitizeStickerExport(store, { includeFullLocalPaths });
}

export function sanitizeStickerSheetExport(store: StickerSheetStore) {
  return sanitizeStickerExport(store);
}
