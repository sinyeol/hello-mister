import type { StickerCard, StickerImageItem, StickerTemplate } from '../../types/stickers';
import { stickerImageSrc } from '../../services/stickers/stickerUtils';

interface StickerCardPreviewProps {
  card: StickerCard;
  template?: StickerTemplate;
  image?: StickerImageItem;
  compact?: boolean;
}

function textForSlot(card: StickerCard, slotId: string) {
  if (slotId === 'title') return card.title || '제목 없음';
  if (slotId === 'subtitle') return card.subtitle || card.gameTitle || '';
  if (slotId === 'platform') return card.platform || '';
  if (slotId === 'path') return card.nfcPathCandidate || card.launchPathCandidate || '';
  return card.title || '';
}

export function StickerCardPreview({ card, template, image, compact = false }: StickerCardPreviewProps) {
  const resolvedTemplate = template;
  const background = resolvedTemplate?.background.color || '#f8fafc';
  const accent = resolvedTemplate?.background.accentColor || '#0891b2';
  return (
    <div
      className={`sticker-card-preview ${compact ? 'compact' : ''}`}
      style={{ background, borderColor: accent }}
      aria-label={`${card.title || '스티커 카드'} 미리보기`}
    >
      <div className="sticker-card-accent" style={{ background: accent }} />
      {resolvedTemplate?.imageSlots.map((slot) => (
        <div
          key={slot.id}
          className="sticker-card-image-slot"
          style={{
            left: `${slot.x}%`,
            top: `${slot.y}%`,
            width: `${slot.width}%`,
            height: `${slot.height}%`,
            borderRadius: `${slot.radius || 0}px`,
          }}
        >
          {image ? (
            <img src={stickerImageSrc(image.localPath)} alt={image.fileName} />
          ) : (
            <span>이미지 없음</span>
          )}
        </div>
      ))}
      {resolvedTemplate?.textSlots.map((slot) => (
        <div
          key={slot.id}
          className="sticker-card-text-slot"
          style={{
            left: `${slot.x}%`,
            top: `${slot.y}%`,
            width: `${slot.width}%`,
            fontSize: `${slot.fontSize * (compact ? 1.2 : 1.45)}px`,
            color: slot.color,
            fontWeight: slot.weight || 'normal',
          }}
        >
          {textForSlot(card, slot.id)}
        </div>
      ))}
      {!resolvedTemplate && (
        <div className="sticker-card-text-slot fallback">
          <strong>{card.title || '제목 없음'}</strong>
          <span>{card.platform || '플랫폼 미지정'}</span>
        </div>
      )}
    </div>
  );
}
