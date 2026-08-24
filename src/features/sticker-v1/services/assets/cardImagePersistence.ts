import type { AssetReference, CardItem, LocalAsset } from '@sticker-v1/types';
import { cacheUsedAsset } from '@sticker-v1/services/assets/usedImageCache';
import { assetReferenceCacheKey, assetReferenceFromAsset, resolveAssetReference } from '@sticker-v1/utils/assetReferences';

type CardFaceName = 'front' | 'back';
type FrontImageIdKey = 'backgroundImageAssetId' | 'heroImageAssetId' | 'titleImageAssetId' | 'brandLogoAssetId';
type FrontImageRefKey = 'backgroundImageAssetRef' | 'heroImageAssetRef' | 'titleImageAssetRef' | 'brandLogoAssetRef';
type BackImageIdKey = 'backgroundImageAssetId' | 'brandLogoAssetId';
type BackImageRefKey = 'backgroundImageAssetRef' | 'brandLogoAssetRef';

type CardImageSlot =
  | { face: 'front'; idKey: FrontImageIdKey; refKey: FrontImageRefKey; label: string }
  | { face: 'back'; idKey: BackImageIdKey; refKey: BackImageRefKey; label: string };

const cardImageSlots: CardImageSlot[] = [
  { face: 'front', idKey: 'backgroundImageAssetId', refKey: 'backgroundImageAssetRef', label: 'front background' },
  { face: 'front', idKey: 'heroImageAssetId', refKey: 'heroImageAssetRef', label: 'Main Image' },
  { face: 'front', idKey: 'titleImageAssetId', refKey: 'titleImageAssetRef', label: 'Clear Logo' },
  { face: 'front', idKey: 'brandLogoAssetId', refKey: 'brandLogoAssetRef', label: 'front logo' },
  { face: 'back', idKey: 'backgroundImageAssetId', refKey: 'backgroundImageAssetRef', label: 'back background' },
  { face: 'back', idKey: 'brandLogoAssetId', refKey: 'brandLogoAssetRef', label: 'back logo' },
];

function cloneCard(card: CardItem) {
  return JSON.parse(JSON.stringify(card)) as CardItem;
}

function getFace(card: CardItem, face: CardFaceName) {
  return face === 'front' ? card.front : card.back;
}

function getImageId(card: CardItem, slot: CardImageSlot) {
  const face = getFace(card, slot.face);
  return face[slot.idKey as never] as string | undefined;
}

function getImageRef(card: CardItem, slot: CardImageSlot) {
  const face = getFace(card, slot.face);
  return face[slot.refKey as never] as AssetReference | undefined;
}

function setImageRef(card: CardItem, slot: CardImageSlot, assetId: string | undefined, reference: AssetReference | undefined) {
  if (slot.face === 'front') {
    card.front = {
      ...card.front,
      [slot.idKey]: assetId,
      [slot.refKey]: reference,
    };
    return;
  }
  card.back = {
    ...card.back,
    [slot.idKey]: assetId,
    [slot.refKey]: reference,
  };
}

function needsCanonicalReference(reference: AssetReference | undefined) {
  return Boolean(reference && (!reference.cacheKey || !reference.stableAssetKey || !reference.filename || !reference.displayName));
}

export function cardImageReferences(card: CardItem) {
  return cardImageSlots
    .map((slot) => getImageRef(card, slot))
    .filter((reference): reference is AssetReference => Boolean(reference));
}

export function uniqueCardImageReferences(cards: CardItem[]) {
  const unique = new Map<string, AssetReference>();
  cards.forEach((card) => {
    cardImageReferences(card).forEach((reference) => unique.set(assetReferenceCacheKey(reference), reference));
  });
  return Array.from(unique.values());
}

export function missingUsedImageReferences(cards: CardItem[], assetsById: Record<string, LocalAsset>) {
  return uniqueCardImageReferences(cards).filter((reference) => {
    const asset = resolveAssetReference(assetsById, reference.assetId, reference);
    return !asset?.objectUrl;
  });
}

export function cardImageReferenceKey(cards: CardItem[]) {
  return cards
    .flatMap((card) =>
      cardImageSlots.map((slot) => {
        const reference = getImageRef(card, slot);
        return [
          card.id,
          slot.face,
          slot.idKey,
          getImageId(card, slot) ?? '',
          reference ? assetReferenceCacheKey(reference) : '',
          reference?.cacheKey ?? '',
        ].join(':');
      }),
    )
    .sort()
    .join('|');
}

export async function ensureCardImagesCached(card: CardItem, assetsById: Record<string, LocalAsset>) {
  let changed = false;
  let cachedCount = 0;
  const warnings: string[] = [];
  const nextCard = cloneCard(card);

  for (const slot of cardImageSlots) {
    const assetId = getImageId(nextCard, slot);
    const reference = getImageRef(nextCard, slot);
    if (!assetId && !reference) continue;

    const asset = resolveAssetReference(assetsById, assetId, reference);
    if (!asset) {
      if (!reference?.cacheKey) warnings.push(`${slot.label} 이미지를 현재 asset index에서 찾지 못했습니다.`);
      continue;
    }

    if (reference?.cacheKey && !needsCanonicalReference(reference)) continue;

    try {
      const cachedReference = await cacheUsedAsset(asset);
      const fallbackReference = cachedReference ?? assetReferenceFromAsset(asset);
      if (!fallbackReference) continue;

      const nextCacheKey = assetReferenceCacheKey(fallbackReference);
      const currentCacheKey = reference ? assetReferenceCacheKey(reference) : undefined;
      const nextAssetId = asset.id;
      if (assetId !== nextAssetId || currentCacheKey !== nextCacheKey || needsCanonicalReference(reference)) {
        setImageRef(nextCard, slot, nextAssetId, fallbackReference);
        changed = true;
      }
      if (cachedReference) {
        cachedCount += 1;
      } else {
        warnings.push(`${slot.label} 이미지를 영구 캐시에 저장하지 못해 현재 asset index로만 임시 복원됩니다.`);
      }
    } catch (error) {
      warnings.push(error instanceof Error ? `${slot.label} 이미지 캐시 저장 실패: ${error.message}` : `${slot.label} 이미지 캐시 저장 실패`);
    }
  }

  return { card: changed ? nextCard : card, changed, cachedCount, warnings };
}
