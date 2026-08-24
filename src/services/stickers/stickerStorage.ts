import type {
  StickerCard,
  StickerCardStore,
  StickerImageItem,
  StickerImageLibraryStore,
  StickerImageScanOptions,
  StickerImageScanResult,
  StickerSheet,
  StickerSheetStore,
  StickerStudioSummary,
  StickerTemplate,
  StickerTemplateStore,
} from '../../types/stickers';
import {
  builtInStickerTemplates,
  canDeleteStickerTemplate,
  createDefaultStickerSheet,
  createEmptyStickerCard,
  mergeUniqueById,
  nowIso,
} from './stickerUtils';

const storageKeys = {
  images: 'hello-mister-v2-sticker-image-library',
  templates: 'hello-mister-v2-sticker-templates',
  cards: 'hello-mister-v2-sticker-cards',
  sheets: 'hello-mister-v2-sticker-sheets',
};

function fallbackGet<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? JSON.parse(stored) as T : fallback;
  } catch {
    return fallback;
  }
}

function fallbackSet<T>(key: string, value: T) {
  if (typeof window === 'undefined') return value;
  window.localStorage.setItem(key, JSON.stringify(value, null, 2));
  return value;
}

export function createDefaultImageLibraryStore(images: StickerImageItem[] = []): StickerImageLibraryStore {
  return { schemaVersion: 1, images, updatedAt: nowIso() };
}

export function createDefaultTemplateStore(): StickerTemplateStore {
  const templates = builtInStickerTemplates();
  return {
    schemaVersion: 1,
    templates,
    defaultTemplateId: templates.find((template) => template.isDefault)?.templateId || templates[0]?.templateId,
    updatedAt: nowIso(),
  };
}

export function createDefaultCardStore(cards: StickerCard[] = []): StickerCardStore {
  return { schemaVersion: 1, cards, updatedAt: nowIso() };
}

export function createDefaultSheetStore(sheets: StickerSheet[] = []): StickerSheetStore {
  return { schemaVersion: 1, sheets, updatedAt: nowIso() };
}

export function normalizeTemplateStore(store?: Partial<StickerTemplateStore>): StickerTemplateStore {
  const defaults = createDefaultTemplateStore();
  const storedTemplates = Array.isArray(store?.templates) ? store.templates : [];
  const templates = mergeUniqueById([...defaults.templates, ...storedTemplates], 'templateId');
  return {
    schemaVersion: 1,
    appVersion: store?.appVersion,
    templates,
    defaultTemplateId: store?.defaultTemplateId || defaults.defaultTemplateId,
    updatedAt: store?.updatedAt || nowIso(),
  };
}

export function summarizeStickerStudio(
  images: StickerImageLibraryStore,
  templates: StickerTemplateStore,
  cards: StickerCardStore,
  sheets: StickerSheetStore,
): StickerStudioSummary {
  const activeCards = cards.cards.filter((card) => !card.deletedAt);
  const dates = [
    images.updatedAt,
    templates.updatedAt,
    cards.updatedAt,
    sheets.updatedAt,
    ...activeCards.map((card) => card.updatedAt),
  ].filter(Boolean).sort();
  return {
    imageCount: images.images.length,
    templateCount: templates.templates.length,
    userTemplateCount: templates.templates.filter((template) => !template.isBuiltIn).length,
    cardCount: cards.cards.length,
    activeCardCount: activeCards.length,
    sheetCount: sheets.sheets.length,
    latestUpdatedAt: dates[dates.length - 1],
  };
}

export class StickerStorageService {
  async selectImages(): Promise<StickerImageScanResult> {
    if (typeof window !== 'undefined' && window.helloMisterDesktop?.selectStickerImageFiles) {
      return window.helloMisterDesktop.selectStickerImageFiles();
    }
    return { ok: false, cancelled: true, sourceType: 'files', items: [], warnings: [], message: '브라우저 fallback에서는 이미지 파일 선택이 제한됩니다.' };
  }

  async selectImageFolder(options: StickerImageScanOptions): Promise<StickerImageScanResult> {
    if (typeof window !== 'undefined' && window.helloMisterDesktop?.selectStickerImageFolder) {
      return window.helloMisterDesktop.selectStickerImageFolder(options);
    }
    return { ok: false, cancelled: true, sourceType: 'folder', items: [], warnings: [], message: '브라우저 fallback에서는 이미지 폴더 선택이 제한됩니다.' };
  }

  async loadImageLibrary(): Promise<StickerImageLibraryStore> {
    if (typeof window !== 'undefined' && window.helloMisterDesktop?.loadStickerImageLibrary) {
      return window.helloMisterDesktop.loadStickerImageLibrary();
    }
    return fallbackGet(storageKeys.images, createDefaultImageLibraryStore());
  }

  async saveImageLibrary(store: StickerImageLibraryStore): Promise<StickerImageLibraryStore> {
    const next = { ...store, schemaVersion: 1 as const, updatedAt: nowIso() };
    if (typeof window !== 'undefined' && window.helloMisterDesktop?.saveStickerImageLibrary) {
      return window.helloMisterDesktop.saveStickerImageLibrary(next);
    }
    return fallbackSet(storageKeys.images, next);
  }

  async loadTemplates(): Promise<StickerTemplateStore> {
    if (typeof window !== 'undefined' && window.helloMisterDesktop?.loadStickerTemplates) {
      return normalizeTemplateStore(await window.helloMisterDesktop.loadStickerTemplates());
    }
    return normalizeTemplateStore(fallbackGet(storageKeys.templates, createDefaultTemplateStore()));
  }

  async saveTemplates(store: StickerTemplateStore): Promise<StickerTemplateStore> {
    const next = normalizeTemplateStore({ ...store, updatedAt: nowIso() });
    if (typeof window !== 'undefined' && window.helloMisterDesktop?.saveStickerTemplates) {
      return window.helloMisterDesktop.saveStickerTemplates(next);
    }
    return fallbackSet(storageKeys.templates, next);
  }

  async loadCards(): Promise<StickerCardStore> {
    if (typeof window !== 'undefined' && window.helloMisterDesktop?.loadStickerCards) {
      return window.helloMisterDesktop.loadStickerCards();
    }
    return fallbackGet(storageKeys.cards, createDefaultCardStore());
  }

  async saveCards(store: StickerCardStore): Promise<StickerCardStore> {
    const next = { ...store, schemaVersion: 1 as const, updatedAt: nowIso() };
    if (typeof window !== 'undefined' && window.helloMisterDesktop?.saveStickerCards) {
      return window.helloMisterDesktop.saveStickerCards(next);
    }
    return fallbackSet(storageKeys.cards, next);
  }

  async loadSheets(): Promise<StickerSheetStore> {
    if (typeof window !== 'undefined' && window.helloMisterDesktop?.loadStickerSheets) {
      return window.helloMisterDesktop.loadStickerSheets();
    }
    return fallbackGet(storageKeys.sheets, createDefaultSheetStore());
  }

  async saveSheets(store: StickerSheetStore): Promise<StickerSheetStore> {
    const next = { ...store, schemaVersion: 1 as const, updatedAt: nowIso() };
    if (typeof window !== 'undefined' && window.helloMisterDesktop?.saveStickerSheets) {
      return window.helloMisterDesktop.saveStickerSheets(next);
    }
    return fallbackSet(storageKeys.sheets, next);
  }

  async loadSummary(): Promise<StickerStudioSummary> {
    const [images, templates, cards, sheets] = await Promise.all([
      this.loadImageLibrary(),
      this.loadTemplates(),
      this.loadCards(),
      this.loadSheets(),
    ]);
    return summarizeStickerStudio(images, templates, cards, sheets);
  }

  async upsertCard(card: StickerCard): Promise<StickerCardStore> {
    const store = await this.loadCards();
    const timestamp = nowIso();
    const nextCard = {
      ...createEmptyStickerCard(card.templateId),
      ...card,
      updatedAt: timestamp,
      createdAt: card.createdAt || timestamp,
    };
    return this.saveCards({
      ...store,
      cards: [nextCard, ...store.cards.filter((item) => item.cardId !== nextCard.cardId)],
    });
  }

  async upsertTemplate(template: StickerTemplate): Promise<StickerTemplateStore> {
    const store = await this.loadTemplates();
    return this.saveTemplates({
      ...store,
      templates: [template, ...store.templates.filter((item) => item.templateId !== template.templateId)],
    });
  }

  async deleteTemplate(templateId: string): Promise<StickerTemplateStore> {
    const store = await this.loadTemplates();
    const target = store.templates.find((template) => template.templateId === templateId);
    if (!target || !canDeleteStickerTemplate(target)) return store;
    return this.saveTemplates({ ...store, templates: store.templates.filter((template) => template.templateId !== templateId) });
  }

  async upsertSheet(sheet: StickerSheet = createDefaultStickerSheet()): Promise<StickerSheetStore> {
    const store = await this.loadSheets();
    const timestamp = nowIso();
    const next = { ...sheet, updatedAt: timestamp, createdAt: sheet.createdAt || timestamp };
    return this.saveSheets({ ...store, sheets: [next, ...store.sheets.filter((item) => item.sheetId !== next.sheetId)] });
  }
}

export const stickerStorage = new StickerStorageService();
