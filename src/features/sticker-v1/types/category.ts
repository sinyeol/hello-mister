import type { EntityId, HexColor } from './shared';

export interface CategoryColorPalette {
  primary: HexColor;
  secondary: HexColor;
  accent: HexColor;
  neutral: HexColor;
}

export interface Category {
  id: EntityId;
  name: string;
  displayName: string;
  palette: CategoryColorPalette;
  defaultFrontTemplateId?: EntityId;
  defaultBackTemplateId?: EntityId;
  backImagePath?: string;
  backImageFileId?: EntityId;
  logoPath?: string;
  logoFileId?: EntityId;
  enabled: boolean;
}

export type CategoryPalette = CategoryColorPalette;
