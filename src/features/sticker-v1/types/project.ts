import type { AssetLibrary, LocalAsset, AssetMatchResult, MameMappingDataset } from './assets';
import type { CardAlbumIndexItem, CardItem, SavedCardRecord } from './card';
import type { Category } from './category';
import type { ExportSettings } from './export';
import type { GameEntry } from './game';
import type { LayoutPreset, Template } from './template';
import type { MiSTerState } from './mister';
import type { ZaparooLibraryState } from './zaparooLibrary';
import type { EntityId, ISODateString } from './shared';

export interface Project {
  id: EntityId;
  name: string;
  categories: Category[];
  games: GameEntry[];
  assets: LocalAsset[];
  assetLibrary?: AssetLibrary;
  mameMapping: MameMappingDataset;
  matches: Record<EntityId, AssetMatchResult>;
  cards: CardItem[];
  savedCards: SavedCardRecord[];
  savedCardIndex: CardAlbumIndexItem[];
  printQueueIds: string[];
  templates: Template[];
  layoutPresets: LayoutPreset[];
  exportSettings: ExportSettings;
  mister: MiSTerState;
  zaparooLibrary: ZaparooLibraryState;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface AppState {
  activeProjectId?: EntityId;
  project: Project;
  selectedCardId?: EntityId;
  selectedTemplateId?: EntityId;
  currentRoute?: string;
  isDirty: boolean;
}

export type ProjectState = Project;
