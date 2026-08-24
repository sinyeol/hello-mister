import type { CardSide, EntityId, Rect, Transform2D } from './shared';
import type { ImageFitMode } from './card';

export type TemplateType = CardSide;
export type TemplateSource = 'UPLOADED' | 'EDITOR' | 'LEGACY_BUILT_IN';
export type TemplateOrientation = 'portrait' | 'landscape';
export type TemplateThumbnailStatus = 'ready' | 'generating' | 'stale' | 'failed';

export type TemplateSlotType =
  | 'mainImage'
  | 'gameLogo'
  | 'background'
  | 'platformLogo'
  | 'heroImage'
  | 'titleImage'
  | 'titleText'
  | 'categoryLabel'
  | 'platformLabel'
  | 'brandLogo'
  | 'brandText'
  | 'backgroundArt'
  | 'footerBar'
  | 'sideStrip'
  | 'badge'
  | 'overlayFrame';

export type TemplateLayerType = 'background' | 'slot' | 'shape' | 'text' | 'image' | 'overlay';
export type TemplateShapeType = 'rectangle' | 'roundedRectangle' | 'ellipse' | 'line';
export type TemplateImageTransformMode = 'linked' | 'separate';
export type TemplateFillTexture =
  | 'paper'
  | 'noise'
  | 'brushedMetal'
  | 'carbonFiber'
  | 'diagonalStripe'
  | 'dotPattern'
  | 'scanline'
  | 'halftone'
  | 'plasticGloss'
  | 'gridPattern'
  | 'dashedPattern'
  | 'circuitPattern'
  | 'retroCrt'
  | 'neonGlow'
  | 'darkVignette'
  | 'lightVignette'
  | 'metalGradient'
  | 'glassReflection'
  | 'fabric'
  | 'pixelPattern';

export type TemplateTextureParams = {
  scale?: number;
  intensity?: number;
  opacity?: number;
  angle?: number;
  contrast?: number;
  brightness?: number;
  color1?: string;
  color2?: string;
  spacing?: number;
  grainSize?: number;
};

export type TemplateCornerRadii = {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
};

export type TemplateFillStyle =
  | { type: 'solid'; color: string; opacity?: number }
  | { type: 'none'; opacity?: number }
  | { type: 'linearGradient'; colors: [string, string]; angle?: number; opacity?: number }
  | { type: 'radialGradient'; colors: [string, string]; opacity?: number }
  | { type: 'texture'; texture: TemplateFillTexture; color?: string; secondaryColor?: string; opacity?: number; textureParams?: TemplateTextureParams };

export interface TemplateCanvas {
  width: number;
  height: number;
  orientation?: TemplateOrientation;
  cornerRadius: number;
  safeMargin: number;
  cornerRadiusMm?: number;
  cutOffsetMm?: number;
  safeMarginMm?: number;
  visualMargin?: number;
  cardBackgroundColor?: string;
  cardColor?: string;
  stickerBackgroundColor?: string | null;
  cuttingLineRadiusMm?: number;
  printCardColor?: boolean;
}

export interface TemplateSlot extends Rect {
  id: EntityId;
  slotType: TemplateSlotType;
  label?: string;
  cornerRadius?: number;
  cornerRadiusMm?: number;
  required?: boolean;
  locked?: boolean;
  accepts?: Array<'image' | 'text' | 'logo' | 'color'>;
  defaultValue?: string;
  dataBinding?: string;
}

export interface TemplateLayer extends Partial<Rect>, Transform2D {
  id: EntityId;
  type: TemplateLayerType;
  slotType?: TemplateSlotType;
  slot?: TemplateSlot;
  fill?: string;
  stroke?: string;
  cornerRadius?: number;
  cornerRadiusMm?: number;
  cornerRadii?: TemplateCornerRadii;
  cornerRadiiMm?: TemplateCornerRadii;
  locked?: boolean;
  zIndex?: number;
  imageFitMode?: ImageFitMode;
  data?: Record<string, unknown>;
}

export interface ShapeLayer extends TemplateLayer {
  type: 'shape';
  slot?: undefined;
  slotType?: undefined;
  data?: Record<string, unknown> & {
    kind?: 'shape';
    shapeType?: TemplateShapeType;
    shapeKind?: TemplateShapeType;
    label?: string;
    fillNone?: boolean;
    fillStyle?: TemplateFillStyle;
    strokeNone?: boolean;
    strokeWidth?: number;
    visible?: boolean;
  };
}

export interface Template {
  id: EntityId;
  name: string;
  type: TemplateType;
  orientation?: TemplateOrientation;
  canvas: TemplateCanvas;
  layers: TemplateLayer[];
  slots?: TemplateSlot[];
  builtIn?: boolean;
  source: TemplateSource;
  layoutPresetId?: EntityId | 'CUSTOM';
  version?: number;
  previewVersion?: string;
  thumbnailCacheKey?: string;
  thumbnailVersion?: number;
  thumbnailStatus?: TemplateThumbnailStatus;
  thumbnailStaleCacheKey?: string;
  thumbnailError?: string;
  thumbnailUpdatedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string;
}

export interface FrontTemplate extends Template {
  type: 'front';
}

export interface BackTemplate extends Template {
  type: 'back';
}

export interface LayoutPreset {
  id: EntityId | 'CUSTOM';
  name: string;
  frontTemplateId: EntityId;
  backTemplateId?: EntityId;
  builtIn: boolean;
  description?: string;
}

export type TemplateDefinition = Template;
