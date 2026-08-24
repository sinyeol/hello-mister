import type { EntityId } from './shared';
import type { MiSTerCardMetadata } from './mister';

export interface GameEntry {
  id: EntityId;
  title: string;
  categoryId: EntityId;
  metadata?: {
    year?: string;
    developer?: string;
    description?: string;
    sourceImage?: string;
    titleImage?: string;
    templateId?: string;
    mister?: MiSTerCardMetadata;
  };
}
