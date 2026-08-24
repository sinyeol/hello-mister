import { CardAlbumPage as V1CardAlbumPage } from '../features/sticker-v1/pages/CardAlbumPage';
import { StickerV1Hydrator } from '../features/sticker-v1/StickerV1Hydrator';

export function StickerAlbumPage() {
  return (
    <StickerV1Hydrator>
      <V1CardAlbumPage />
    </StickerV1Hydrator>
  );
}