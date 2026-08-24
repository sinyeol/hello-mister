import type {
  ZaparooApiResult,
  ZaparooAllowedIpsRecommendationMode,
  ZaparooConfigApplyResult,
  ZaparooApiTarget,
  ZaparooConfigDiagnostics,
  ZaparooConfigPatchPlan,
  ZaparooMediaBrowseResult,
  ZaparooMediaItem,
  ZaparooMediaLookupResult,
  ZaparooMediaSearchResult,
  ZaparooReaderWriteResult,
  ZaparooReadersResult,
  ZaparooRunResult,
  ZaparooRpcPayload,
  ZaparooStatusResult,
  ZaparooTokenReadRequest,
  ZaparooTokenReadResult,
} from '../../types/zaparoo';

export const zaparooDefaultPort = 7497;
export const zaparooDefaultEndpoint = '/api/v0.1';

function uuidLike() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `zaparoo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function formatZaparooJsonRpcRequest(method: string, params?: unknown, id = uuidLike()): ZaparooRpcPayload {
  return params === undefined
    ? { jsonrpc: '2.0', id, method }
    : { jsonrpc: '2.0', id, method, params };
}

export function zaparooFallbackRunUrl(target: ZaparooApiTarget, zapScript: string) {
  const host = target.host.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  const port = target.port || zaparooDefaultPort;
  return `http://${host}:${port}/run/${encodeURIComponent(zapScript)}`;
}

export function zaparooUnavailableResult(message: string): ZaparooApiResult {
  return {
    ok: false,
    message,
    checkedAt: new Date().toISOString(),
    error: { message },
  };
}

export function normalizeZaparooMediaItems(result: unknown): ZaparooMediaItem[] {
  const rawItems = Array.isArray(result)
    ? result
    : Array.isArray((result as { items?: unknown[] })?.items)
      ? (result as { items: unknown[] }).items
      : Array.isArray((result as { results?: unknown[] })?.results)
        ? (result as { results: unknown[] }).results
        : result
          ? [result]
          : [];

  return rawItems.map((item, index) => {
    const record = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const name = String(record.name || record.title || record.label || '');
    return {
      id: String(record.id || record.uuid || `${name || 'media'}-${index}`),
      name,
      title: String(record.title || record.name || ''),
      system: record.system ? String(record.system) : undefined,
      systemId: record.systemId ? String(record.systemId) : record.system ? String(record.system) : undefined,
      path: record.path ? String(record.path) : record.file ? String(record.file) : undefined,
      zapScript: record.zapScript ? String(record.zapScript) : record.zapscript ? String(record.zapscript) : undefined,
      tags: Array.isArray(record.tags) ? record.tags.map(String) : undefined,
      raw: item,
    };
  });
}

export class ZaparooApiClient {
  private api() {
    return typeof window !== 'undefined' ? window.helloMisterDesktop : undefined;
  }

  async getStatus(target?: ZaparooApiTarget): Promise<ZaparooStatusResult> {
    const fn = this.api()?.zaparooGetStatus;
    if (!fn) return zaparooUnavailableResult('Electron Zaparoo API bridge를 사용할 수 없습니다.') as ZaparooStatusResult;
    return fn(target);
  }

  async getVersion(target?: ZaparooApiTarget): Promise<ZaparooApiResult> {
    const fn = this.api()?.zaparooGetVersion;
    if (!fn) return zaparooUnavailableResult('Electron Zaparoo version bridge를 사용할 수 없습니다.');
    return fn(target);
  }

  async health(target?: ZaparooApiTarget): Promise<ZaparooApiResult> {
    const fn = this.api()?.zaparooHealth;
    if (!fn) return zaparooUnavailableResult('Electron Zaparoo health bridge를 사용할 수 없습니다.');
    return fn(target);
  }

  async searchMedia(query: string, target?: ZaparooApiTarget): Promise<ZaparooMediaSearchResult> {
    const fn = this.api()?.zaparooSearchMedia;
    if (!fn) return { ...zaparooUnavailableResult('Electron Zaparoo media.search bridge를 사용할 수 없습니다.'), items: [] };
    return fn({ target, query });
  }

  async browseMedia(path?: string, target?: ZaparooApiTarget): Promise<ZaparooMediaBrowseResult> {
    const fn = this.api()?.zaparooBrowseMedia;
    if (!fn) return { ...zaparooUnavailableResult('Electron Zaparoo media.browse bridge를 사용할 수 없습니다.'), items: [] };
    return fn({ target, path });
  }

  async lookupMedia(system: string, name: string, target?: ZaparooApiTarget): Promise<ZaparooMediaLookupResult> {
    const fn = this.api()?.zaparooLookupMedia;
    if (!fn) return { ...zaparooUnavailableResult('Electron Zaparoo media.lookup bridge를 사용할 수 없습니다.'), items: [] };
    return fn({ target, system, name });
  }

  async runZapScript(zapScript: string, target?: ZaparooApiTarget, options: { allowFallbackRun?: boolean } = {}): Promise<ZaparooRunResult> {
    const fn = this.api()?.zaparooRun;
    if (!fn) return zaparooUnavailableResult('Electron Zaparoo run bridge를 사용할 수 없습니다.') as ZaparooRunResult;
    return fn({ target, zapScript, allowFallbackRun: options.allowFallbackRun ?? true });
  }

  async readConfigDiagnostics(sessionId?: string): Promise<ZaparooConfigDiagnostics> {
    const fn = this.api()?.zaparooReadConfigDiagnostics;
    if (!fn) {
      return {
        ok: false,
        status: 'not-checked',
        path: '/media/fat/zaparoo/config.toml',
        serviceFound: false,
        allowRun: { present: false, values: [], count: 0, empty: true },
        allowedIps: { present: false, values: [], count: 0, empty: true },
        message: 'Electron Zaparoo config 진단 bridge를 사용할 수 없습니다.',
        checkedAt: new Date().toISOString(),
      };
    }
    return fn(sessionId);
  }

  async previewConfigApply(sessionId?: string, mode: ZaparooAllowedIpsRecommendationMode = 'single-ip'): Promise<ZaparooConfigPatchPlan> {
    const fn = this.api()?.zaparooPreviewConfigApply;
    if (!fn) {
      return {
        ok: false,
        path: '/media/fat/zaparoo/config.toml',
        recommendation: { mode, apiPort: 7497, apiListen: '0.0.0.0', allowedIps: [], allowRun: [], notes: [] },
        changes: [],
        diffPreview: '',
        nextPreview: '',
        changed: false,
        backupFileName: '',
        remoteBackupPath: '',
        localBackupRelativePath: '',
        safetyMessages: [],
        message: 'Electron Zaparoo config ?? bridge? ??? ? ????.',
      };
    }
    return fn({ sessionId, mode });
  }

  async applyConfigRecommendation(request: { sessionId?: string; mode?: ZaparooAllowedIpsRecommendationMode; confirmed: boolean; allowLocalBackupOnly?: boolean }): Promise<ZaparooConfigApplyResult> {
    const fn = this.api()?.zaparooApplyConfigRecommendation;
    if (!fn) {
      return {
        ok: false,
        path: '/media/fat/zaparoo/config.toml',
        remoteBackupOk: false,
        localBackupOk: false,
        applied: false,
        reloadAttempted: false,
        reloadOk: false,
        message: 'Electron Zaparoo config ?? bridge? ??? ? ????.',
      };
    }
    return fn(request);
  }

  async listReaders(target?: ZaparooApiTarget): Promise<ZaparooReadersResult> {
    const fn = this.api()?.zaparooListReaders;
    if (!fn) return { ...zaparooUnavailableResult('Electron Zaparoo readers bridge를 사용할 수 없습니다.'), readers: [] };
    return fn(target);
  }

  async writeReader(text: string, target?: ZaparooApiTarget): Promise<ZaparooReaderWriteResult> {
    const fn = this.api()?.zaparooWriteReader;
    if (!fn) return zaparooUnavailableResult('Electron Zaparoo readers.write bridge를 사용할 수 없습니다.') as ZaparooReaderWriteResult;
    return fn({ target, text });
  }

  async readTokenOnce(request: ZaparooTokenReadRequest = {}): Promise<ZaparooTokenReadResult> {
    const fn = this.api()?.zaparooReadTokenOnce;
    if (!fn) {
      return {
        ...zaparooUnavailableResult('Electron Zaparoo token event bridge를 사용할 수 없습니다.'),
        status: 'error',
        code: 'ZAPAROO_EVENTS_UNAVAILABLE',
      } as ZaparooTokenReadResult;
    }
    return fn(request);
  }

  async cancelTokenRead(requestId: string): Promise<{ ok: boolean; message: string }> {
    const fn = this.api()?.zaparooCancelTokenRead;
    if (!fn) return { ok: false, message: 'Electron Zaparoo token event cancel bridge를 사용할 수 없습니다.' };
    return fn(requestId);
  }
}
