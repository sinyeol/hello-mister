import { CardEditorPage as V1CardEditorPage } from '../features/sticker-v1/pages/CardEditorPage';
import { StickerV1Hydrator } from '../features/sticker-v1/StickerV1Hydrator';

export function StickerEditorPage() {
  return (
    <StickerV1Hydrator>
      <V1CardEditorPage />
    </StickerV1Hydrator>
  );
}