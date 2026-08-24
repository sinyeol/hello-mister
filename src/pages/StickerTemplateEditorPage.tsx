import { LayoutEditorPage as V1LayoutEditorPage } from '../features/sticker-v1/pages/LayoutEditorPage';
import { StickerV1Hydrator } from '../features/sticker-v1/StickerV1Hydrator';

export function StickerTemplateEditorPage() {
  return (
    <StickerV1Hydrator>
      <V1LayoutEditorPage />
    </StickerV1Hydrator>
  );
}