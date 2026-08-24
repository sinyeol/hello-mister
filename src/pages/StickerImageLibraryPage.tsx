import { AssetLoadingPage as V1AssetLoadingPage } from '../features/sticker-v1/pages/AssetLoadingPage';
import { StickerV1Hydrator } from '../features/sticker-v1/StickerV1Hydrator';

export function StickerImageLibraryPage() {
  return (
    <StickerV1Hydrator>
      <V1AssetLoadingPage />
    </StickerV1Hydrator>
  );
}