import { normalizeZaparooMediaItems, ZaparooApiClient } from './zaparooApiClient';
import type { ZaparooApiTarget, ZaparooMediaItem } from '../../types/zaparoo';

export function mediaMatchStatus(items: ZaparooMediaItem[]) {
  if (items.length === 0) return '미연결';
  if (items.length === 1) return '후보 1개';
  return `후보 ${items.length}개`;
}

export async function searchZaparooMediaForTitle(title: string, target?: ZaparooApiTarget) {
  const result = await new ZaparooApiClient().searchMedia(title, target);
  return {
    ...result,
    items: result.items.length ? result.items : normalizeZaparooMediaItems(result.result),
  };
}
