import type { EntityId, CardSide, Transform2D } from './shared';
import type { MiSTerCardMetadata } from './mister';
import type { AssetReference } from './assets';
import type { Template } from './template';

/**
 * Legacy migration marker only. Active rendering is template-id based and must not branch on this value.
 */
export type LayoutMode = 'A' | 'B' | 'CUSTOM' | 'UNASSIGNED';

export interface SlotOverride extends Transform2D {
  width?: number;
  height?: number;
  assetId?: EntityId;
  text?: string;
  visible?: boolean;
  fitMode?: ImageFitMode;
  cropTop?: number;
  cropRight?: number;
  cropBottom?: number;
  cropLeft?: number;
}

export type ImageFitMode = 'cover' | 'contain' | 'stretch' | 'original';

export interface CardFace {
  side: 'front';
  templateId?: EntityId;
  layoutMode?: LayoutMode;
  backgroundImageAssetId?: EntityId;
  backgroundImageAssetRef?: AssetReference;
  heroImageAssetId?: EntityId;
  heroImageAssetRef?: AssetReference;
  titleImageAssetId?: EntityId;
  titleImageAssetRef?: AssetReference;
  titleText?: string;
  categoryLabel?: string;
  platformLabel?: string;
  brandLogoAssetId?: EntityId;
  brandLogoAssetRef?: AssetReference;
  slotOverrides?: Record<string, SlotOverride>;
}

export interface CardBack {
  side: 'back';
  templateId?: EntityId;
  categoryId: EntityId;
  backgroundImageAssetId?: EntityId;
  backgroundImageAssetRef?: AssetReference;
  generatedFallback: boolean;
  categoryLabel?: string;
  brandLogoAssetId?: EntityId;
  brandLogoAssetRef?: AssetReference;
  slotOverrides?: Record<string, SlotOverride>;
}

export interface CardItem {
  id: EntityId;
  gameId: EntityId;
  categoryId: EntityId;
  layoutMode: LayoutMode;
  customTemplateId?: EntityId;
  front: CardFace;
  back: CardBack;
  printOrder: number;
  coordinateLockKey: string;
  deleted?: boolean;
  duplicatedFromId?: EntityId;
  mister?: MiSTerCardMetadata;
  embeddedTemplateSnapshots?: Template[];
  templateImportStatus?: 'library' | 'embeddedSnapshot' | 'missing';
}

export interface SavedCardRecord {
  id: EntityId;
  title: string;
  categoryId: EntityId;
  card: CardItem;
  favorite?: boolean;
  mister?: MiSTerCardMetadata;
  deletedAt?: string;
  importedAt?: string;
  importSource?: string;
  thumbnailStatus?: CardThumbnailStatus;
  thumbnailStaleCacheKey?: string;
  thumbnailError?: string;
  thumbnailUpdatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type CardThumbnailStatus =
  | 'ready'
  | 'generating'
  | 'staleNeedsRegeneration'
  | 'failedButPreviousKept'
  | 'missingAssets';

export interface CardAlbumIndexItem {
  id: EntityId;
  title: string;
  platform?: string;
  categoryId?: EntityId;
  createdAt: string;
  updatedAt: string;
  thumbnailCacheKey?: string;
  thumbnailStatus?: CardThumbnailStatus;
  thumbnailStaleCacheKey?: string;
  thumbnailError?: string;
  thumbnailUpdatedAt?: string;
  cachedLinkStatus?: 'linked' | 'unlinked' | 'unknown';
  favorite?: boolean;
  deletedAt?: string;
  importedAt?: string;
  importSource?: string;
  mister?: MiSTerCardMetadata;
  tags?: string[];
}

export type CardSideData = CardFace | CardBack;
export type CardDesign = CardItem;
export type CardRenderableSide = CardSide;
