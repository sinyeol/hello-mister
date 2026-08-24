export type StickerImageAssetType =
  | 'cover'
  | 'title'
  | 'logo'
  | 'marquee'
  | 'screenshot'
  | 'background'
  | 'templateAsset'
  | 'unknown';

export type StickerCardStatus = 'draft' | 'ready' | 'printed' | 'archived';
export type StickerViewMode = 'grid' | 'list';
export type StickerPaperPreset = 'A4' | 'Letter';
export type StickerCardSizePreset = 'nfc-card' | 'sticker-label' | 'custom';

export interface StickerImageItem {
  imageId: string;
  sourceId: string;
  fileName: string;
  basename: string;
  extension: string;
  sizeBytes: number;
  modifiedAt?: string;
  localPath: string;
  maskedPath: string;
  width?: number;
  height?: number;
  assetType: StickerImageAssetType;
  normalizedName: string;
  possibleGameTitle?: string;
  possiblePlatform?: string;
  importedAt: string;
  updatedAt: string;
}

export interface StickerImageScanOptions {
  recursive?: boolean;
  maxFiles?: number;
}

export interface StickerImageScanResult {
  ok: boolean;
  cancelled?: boolean;
  sourceType: 'files' | 'folder';
  rootPath?: string;
  items: StickerImageItem[];
  warnings: string[];
  message: string;
}

export interface StickerImageLibraryStore {
  schemaVersion: 1;
  appVersion?: string;
  images: StickerImageItem[];
  updatedAt: string;
}

export interface StickerTemplateSlot {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
}

export interface StickerTextSlot {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  color: string;
  weight?: 'normal' | 'bold';
}

export interface StickerTemplate {
  templateId: string;
  name: string;
  description: string;
  version: string;
  size: {
    width: number;
    height: number;
    unit: 'mm';
  };
  background: {
    color: string;
    accentColor?: string;
  };
  imageSlots: StickerTemplateSlot[];
  textSlots: StickerTextSlot[];
  nfcPathSlot?: string;
  printSafeArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  bleed: number;
  createdAt: string;
  updatedAt: string;
  isBuiltIn: boolean;
  isFavorite?: boolean;
  isDefault?: boolean;
}

export interface StickerTemplateStore {
  schemaVersion: 1;
  appVersion?: string;
  templates: StickerTemplate[];
  defaultTemplateId?: string;
  updatedAt: string;
}

export interface StickerCard {
  cardId: string;
  title: string;
  subtitle?: string;
  platform?: string;
  gameTitle?: string;
  templateId: string;
  imageId?: string;
  imagePath?: string;
  launchPathCandidate?: string;
  nfcPathCandidate?: string;
  notes?: string;
  tags: string[];
  status: StickerCardStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface StickerCardStore {
  schemaVersion: 1;
  appVersion?: string;
  cards: StickerCard[];
  updatedAt: string;
}

export interface StickerSheet {
  sheetId: string;
  name: string;
  paperPreset: StickerPaperPreset;
  cardSizePreset: StickerCardSizePreset;
  customCardWidthMm?: number;
  customCardHeightMm?: number;
  rows: number;
  columns: number;
  gapMm: number;
  marginMm: number;
  selectedCardIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StickerSheetStore {
  schemaVersion: 1;
  appVersion?: string;
  sheets: StickerSheet[];
  updatedAt: string;
}

export interface StickerStudioSummary {
  imageCount: number;
  templateCount: number;
  userTemplateCount: number;
  cardCount: number;
  activeCardCount: number;
  sheetCount: number;
  latestUpdatedAt?: string;
}

export interface StickerSheetLayoutItem {
  cardId: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  row: number;
  column: number;
}

export interface StickerSheetLayout {
  paperWidthMm: number;
  paperHeightMm: number;
  cardWidthMm: number;
  cardHeightMm: number;
  items: StickerSheetLayoutItem[];
  warnings: string[];
}
