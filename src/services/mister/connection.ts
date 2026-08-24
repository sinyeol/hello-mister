import type { MisterConnectionAttempt, MisterConnectionResult } from '../../types/mister';
import { createMockFingerprint } from './fingerprint';

export interface MisterConnectionService {
  connect(attempt: MisterConnectionAttempt): Promise<MisterConnectionResult>;
  renameAlias(profileId: string, alias: string): Promise<MisterConnectionResult>;
}

export class DryRunMisterConnectionService implements MisterConnectionService {
  async connect(attempt: MisterConnectionAttempt): Promise<MisterConnectionResult> {
    return {
      ok: true,
      status: attempt.dryRun ? 'dry-run' : '연결됨',
      message: attempt.dryRun
        ? 'dry-run: 실제 SSH 연결을 열지 않고 fingerprint 확인 흐름만 시뮬레이션했습니다.'
        : '연결 adapter가 연결됨을 반환했습니다.',
      fingerprint: createMockFingerprint('192.168.0.42', '42AF'),
      logs: [
        `candidate=${attempt.candidateId}`,
        '포트 후보: 22, 445',
        '확인 예정 경로: /media/fat, /media/fat/games, /media/fat/Scripts, /media/fat/MiSTer.ini',
      ],
    };
  }

  async renameAlias(profileId: string, alias: string): Promise<MisterConnectionResult> {
    return {
      ok: true,
      status: 'dry-run',
      message: `dry-run: ${profileId} 별칭을 "${alias}"로 저장할 예정입니다.`,
      logs: ['장치 hostname은 변경하지 않습니다.', '별칭은 앱 내부 프로필에만 저장됩니다.'],
    };
  }
}
