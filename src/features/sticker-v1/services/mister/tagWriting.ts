import { HttpMiSTerBridgeClient } from '@sticker-v1/services/mister/misterBridge';
import type { MiSTerConnectionConfig, TagWriteJob, TagWritePayload } from '@sticker-v1/types';

export interface TagWriteAdapter {
  write(payload: TagWritePayload): Promise<TagWriteJob>;
  read(): Promise<{ ok: boolean; readText?: string; message: string }>;
  verify(payload: TagWritePayload): Promise<{ ok: boolean; readText?: string; message: string }>;
}

export class TextExportTagWriteAdapter implements TagWriteAdapter {
  async write(payload: TagWritePayload): Promise<TagWriteJob> {
    const now = new Date().toISOString();
    return {
      id: `tag_job_${Date.now()}`,
      mode: 'text-export',
      payload,
      status: payload.valid ? 'ready' : 'failed',
      logs: payload.valid
        ? ['NFC 텍스트가 생성되었습니다. 직접 쓰기에는 MiSTer USB 리더와 로컬 브리지 연결이 필요합니다.']
        : ['Payload validation failed.', ...payload.warnings],
      createdAt: now,
      updatedAt: now,
    };
  }

  async verify(payload: TagWritePayload) {
    return {
      ok: payload.valid,
      readText: payload.valid ? payload.launchText : undefined,
      message: payload.valid ? '텍스트 export payload가 유효합니다.' : 'Payload가 유효하지 않아 검증할 수 없습니다.',
    };
  }

  async read(): Promise<{ ok: boolean; readText?: string; message: string }> {
    return {
      ok: false,
      message: '텍스트 export 모드에서는 물리 태그를 읽을 수 없습니다. 실제 Read에는 로컬 브리지와 MiSTer USB NFC 리더 연결이 필요합니다.',
    };
  }
}

export class MiSTerBridgeTagWriteAdapter implements TagWriteAdapter {
  constructor(private config: MiSTerConnectionConfig, private connectionId?: string) {}

  async write(payload: TagWritePayload): Promise<TagWriteJob> {
    if (!payload.valid) {
      const now = new Date().toISOString();
      return {
        id: `tag_job_${Date.now()}`,
        mode: 'mister-reader',
        payload,
        status: 'failed',
        logs: ['Payload validation failed before bridge write.', ...payload.warnings],
        createdAt: now,
        updatedAt: now,
      };
    }
    const result = await new HttpMiSTerBridgeClient().writeTag(this.config, payload, this.connectionId);
    return result.job;
  }

  async read() {
    return new HttpMiSTerBridgeClient().readTag(this.config, this.connectionId);
  }

  async verify(payload: TagWritePayload) {
    return new HttpMiSTerBridgeClient().verifyTag(this.config, payload, this.connectionId);
  }
}
