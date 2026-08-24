import { TemplateManagementPage as V1TemplateManagementPage } from '../features/sticker-v1/pages/TemplateManagementPage';
import { StickerV1Hydrator } from '../features/sticker-v1/StickerV1Hydrator';

export function StickerTemplatePage() {
  return (
    <StickerV1Hydrator>
      <V1TemplateManagementPage />
    </StickerV1Hydrator>
  );
}