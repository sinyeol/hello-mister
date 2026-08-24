import { ZaparooApiClient } from './zaparooApiClient';
import type { ZaparooApiTarget, ZaparooRunResult } from '../../types/zaparoo';

export function firstZaparooLaunchCandidate(candidates: Array<string | undefined | null>) {
  return candidates.map((candidate) => String(candidate || '').trim()).find(Boolean) || '';
}

export function zaparooLaunchMissingMessage() {
  return '실행 경로가 없습니다. 게임 리스트와 카드를 다시 연결하거나 Zaparoo media database에서 매칭하세요.';
}

export async function launchWithZaparooCore(target: ZaparooApiTarget | undefined, zapScript: string): Promise<ZaparooRunResult> {
  if (!zapScript.trim()) {
    return {
      ok: false,
      zapScript,
      message: zaparooLaunchMissingMessage(),
      error: { message: zaparooLaunchMissingMessage() },
      checkedAt: new Date().toISOString(),
    };
  }
  return new ZaparooApiClient().runZapScript(zapScript, target, { allowFallbackRun: true });
}
