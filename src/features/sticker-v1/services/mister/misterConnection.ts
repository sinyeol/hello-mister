import { requiredMiSTerPaths } from '@sticker-v1/services/mister/misterPersistence';
import type { MiSTerConnectionConfig, MiSTerConnectionState } from '@sticker-v1/types';
import { HttpMiSTerBridgeClient } from './misterBridge';

export interface MiSTerConnectionAdapter {
  testConnection(config: MiSTerConnectionConfig): Promise<Pick<MiSTerConnectionState, 'status' | 'message' | 'zaparooInstalled' | 'requiredPaths' | 'connectionId' | 'zaparooCommand' | 'zaparooCommandStatus'>>;
}

export class BrowserMiSTerConnectionAdapter implements MiSTerConnectionAdapter {
  async testConnection(config: MiSTerConnectionConfig) {
    if (!config.host.trim()) {
      return {
        status: 'failed' as const,
        message: 'MiSTer address is required.',
        zaparooInstalled: false,
        requiredPaths: Object.fromEntries(requiredMiSTerPaths.map((path) => [path, 'unknown' as const])),
      };
    }

    return {
      status: 'unavailable' as const,
      message:
        'SSH/SFTP is modeled but cannot be opened directly from this browser-only app. Attach a local bridge/backend adapter to perform the actual MiSTer path checks.',
      zaparooInstalled: undefined,
      requiredPaths: Object.fromEntries(requiredMiSTerPaths.map((path) => [path, 'unavailable' as const])),
    };
  }
}

export class BridgeMiSTerConnectionAdapter implements MiSTerConnectionAdapter {
  private bridge = new HttpMiSTerBridgeClient();

  async testConnection(config: MiSTerConnectionConfig) {
    return this.bridge.testConnection(config);
  }
}

export async function testMiSTerConnection(config: MiSTerConnectionConfig, adapter: MiSTerConnectionAdapter = new BrowserMiSTerConnectionAdapter()) {
  return adapter.testConnection(config);
}
