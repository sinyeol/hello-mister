import type { MiSTerState } from '@sticker-v1/types';

const legacyMisterStateKey = 'zaparoo.mister.state.v1';
const misterPrefsKey = 'zaparoo.mister.preferences.v1';
const dbName = 'zaparoo-mister';
const dbVersion = 1;
const storeName = 'state';
const activeStateKey = 'active';

export const requiredMiSTerPaths = [
  '/media/fat',
  '/media/fat/games',
  '/media/fat/_Arcade',
  '/media/fat/zaparoo/config.toml',
];

export const defaultMiSTerState: MiSTerState = {
  connection: {
    config: {
      host: '',
      port: 22,
      username: 'root',
      protocol: 'ssh-sftp',
      authMethod: 'password',
    },
    bridgeUrl: 'http://127.0.0.1:37321',
    bridgeEnabled: true,
    status: 'idle',
    zaparooCommandStatus: 'unknown',
    requiredPaths: Object.fromEntries(requiredMiSTerPaths.map((path) => [path, 'unknown'])),
  },
  library: {
    entries: [],
    platformGroups: [],
    systemIds: [],
    folderNames: [],
    scanStatus: 'idle',
  },
  mapping: {
    aliases: [],
    overrides: [],
  },
  tagJobs: [],
};

function sanitizeMiSTerState(state: MiSTerState): MiSTerState {
  return {
    ...state,
    connection: {
      ...state.connection,
      connectionId: undefined,
      config: {
        ...state.connection.config,
        password: undefined,
      },
    },
  };
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet<T>(key: string) {
  const db = await openDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

async function idbSet<T>(key: string, value: T) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

function mergeMiSTerState(state?: Partial<MiSTerState> | null): MiSTerState {
  return {
    ...defaultMiSTerState,
    ...state,
    connection: {
      ...defaultMiSTerState.connection,
      ...state?.connection,
      config: {
        ...defaultMiSTerState.connection.config,
        ...state?.connection?.config,
      },
      requiredPaths: {
        ...defaultMiSTerState.connection.requiredPaths,
        ...state?.connection?.requiredPaths,
      },
    },
    library: {
      ...defaultMiSTerState.library,
      ...state?.library,
      entries: state?.library?.entries ?? [],
    },
    mapping: {
      ...defaultMiSTerState.mapping,
      ...state?.mapping,
      aliases: state?.mapping?.aliases ?? [],
      overrides: state?.mapping?.overrides ?? [],
    },
    tagJobs: state?.tagJobs ?? [],
  };
}

function loadLocalPreferences(): Partial<MiSTerState> | null {
  try {
    return JSON.parse(localStorage.getItem(misterPrefsKey) ?? 'null') as Partial<MiSTerState> | null;
  } catch {
    return null;
  }
}

export function loadMiSTerState(): MiSTerState {
  const preferences = loadLocalPreferences();
  try {
    const legacy = JSON.parse(localStorage.getItem(legacyMisterStateKey) ?? 'null') as MiSTerState | null;
    return mergeMiSTerState({ ...legacy, ...preferences });
  } catch {
    return mergeMiSTerState(preferences);
  }
}

export function persistMiSTerState(state: MiSTerState) {
  const sanitized = sanitizeMiSTerState(state);
  void idbSet(activeStateKey, sanitized);
  localStorage.setItem(
    misterPrefsKey,
    JSON.stringify({
      connection: {
        config: sanitized.connection.config,
        bridgeUrl: sanitized.connection.bridgeUrl,
        bridgeEnabled: sanitized.connection.bridgeEnabled,
      },
    }),
  );
  localStorage.removeItem(legacyMisterStateKey);
}

export async function loadMiSTerStateFromIndexedDb(): Promise<MiSTerState> {
  const indexedState = await idbGet<MiSTerState>(activeStateKey);
  return mergeMiSTerState({ ...indexedState, ...loadLocalPreferences() });
}
