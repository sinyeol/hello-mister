export const MAX_BATCH_CARD_CREATE_COUNT = 30;

export const batchCardCreateLimitMessage = `한 번에 최대 ${MAX_BATCH_CARD_CREATE_COUNT}개까지 카드 작업을 만들 수 있습니다.`;

export function isBatchCardCreateCountAllowed(count: number) {
  return count >= 1 && count <= MAX_BATCH_CARD_CREATE_COUNT;
}
