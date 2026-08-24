import { ExportPreviewPage as V1ExportPreviewPage } from '../features/sticker-v1/pages/ExportPreviewPage';
import { StickerV1Hydrator } from '../features/sticker-v1/StickerV1Hydrator';

export function StickerSheetOutputPage() {
  return (
    <StickerV1Hydrator>
      <V1ExportPreviewPage />
    </StickerV1Hydrator>
  );
}