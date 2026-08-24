import type { AssetKind, AssetSource, AssetSourceMetadata, AssetSourceScanMode } from '@sticker-v1/types';
import { createId } from '@sticker-v1/utils/ids';
import { safeExtension, safeFileName } from '@sticker-v1/utils/pathParts';
import { autoRoleKindForPath, launchBoxAutoScanFolderNames } from './assetFolderRoles';
import { isAssetKindEnabled, isAssetSourceEnabled, loadAssetSourceGroupSettings } from './assetSourceGroups';

const metadataKey = 'zaparoo.assetSources.v1';
const dbName = 'zaparoo-assets';
const storeName = 'directoryHandles';
const dbVersion = 2;
const defaultScanMode: AssetSourceScanMode = 'launchbox-optimized';

function getExtension(fileName: string | null | undefined) {
  return safeExtension(fileName);
}

function isImageFile(file: File | undefined) {
  return ['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(getExtension(file?.name));
}

function detectRoleFromFiles(files: File[]): AssetKind | 'mixed' {
  const roles = new Set<AssetKind>();
  files.forEach((file) => {
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || safeFileName(file.name);
    const role = autoRoleKindForPath(path);
    if (role) roles.add(role);
  });
  return roles.size === 1 ? [...roles][0] : 'mixed';
}

function scanSignature(files: File[]) {
  let totalSize = 0;
  let latestModified = 0;
  files.forEach((file) => {
    totalSize += Number.isFinite(file.size) ? file.size : 0;
    latestModified = Math.max(latestModified, Number.isFinite(file.lastModified) ? file.lastModified : 0);
  });
  return `${files.length}:${totalSize}:${latestModified}`;
}

function filePathHint(file: File | undefined) {
  if (!file) return '';
  const fileWithPath = file as (File & { webkitRelativePath?: string; path?: string }) | undefined;
  const desktopPath = typeof window !== 'undefined' ? window.zaparooDesktop?.getPathForFile?.(file) : undefined;
  return desktopPath || fileWithPath?.path || fileWithPath?.webkitRelativePath || file.name || '';
}

function parentPath(path: string | undefined) {
  if (!path) return '';
  const normalized = path.trim();
  const separatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return separatorIndex > 0 ? normalized.slice(0, separatorIndex) : '';
}

function commonFolderPath(files: File[], fallback: string) {
  const parents = files.map((file) => parentPath(filePathHint(file))).filter(Boolean);
  if (parents.length === 0) return fallback;
  const separator = parents.some((path) => path.includes('\\')) ? '\\' : '/';
  const splitParents = parents.map((path) => path.replace(/\\/g, '/').split('/').filter(Boolean));
  const commonParts: string[] = [];
  for (let index = 0; index < splitParents[0].length; index += 1) {
    const part = splitParents[0][index];
    if (splitParents.every((parts) => parts[index] === part)) commonParts.push(part);
    else break;
  }
  return commonParts.length > 0 ? commonParts.join(separator) : parents[0] || fallback;
}

function persistedPathHint(source: Partial<AssetSourceMetadata>) {
  const config = source.config && typeof source.config === 'object' ? source.config : undefined;
  return [source.folderPath, source.path, source.rootPath, source.directoryPath, source.location, config?.folderPath, config?.path, config?.rootPath, config?.directoryPath, config?.location]
    .map((candidate) => (typeof candidate === 'string' ? candidate.trim() : ''))
    .find(Boolean);
}

function disabledSource(source: AssetSourceMetadata): AssetSource {
  return { ...source, status: 'disabled', scanChanged: false, files: undefined };
}

function fileRole(file: File, fallback: AssetKind | 'mixed' | undefined) {
  return autoRoleKindForPath((file as File & { webkitRelativePath?: string }).webkitRelativePath || safeFileName(file.name)) ?? fallback;
}

function loadMetadata(): AssetSourceMetadata[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(metadataKey) ?? '[]') as AssetSourceMetadata[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((source) => source && typeof source === 'object')
      .map((source) => {
        const folderPath = persistedPathHint(source);
        const config = source.config && typeof source.config === 'object' ? source.config : undefined;
        return {
          id: typeof source.id === 'string' ? source.id : createId('asset_source'),
          label: typeof source.label === 'string' && source.label.trim() ? source.label : 'Unknown source',
          folderPath,
          path: typeof source.path === 'string' ? source.path : undefined,
          rootPath: typeof source.rootPath === 'string' ? source.rootPath : undefined,
          directoryPath: typeof source.directoryPath === 'string' ? source.directoryPath : undefined,
          location: typeof source.location === 'string' ? source.location : undefined,
          config,
          role: source.role,
          status: source.status ?? 'needs-reconnect',
          persistence: source.persistence ?? 'file-list-metadata',
          scanMode: source.scanMode ?? defaultScanMode,
          scanSignature: source.scanSignature,
          scanChanged: false,
          scanError: source.scanError,
          lastLoadedAt: source.lastLoadedAt,
          assetCount: Number.isFinite(source.assetCount) ? source.assetCount : 0,
        };
      });
  } catch {
    return [];
  }
}

function saveMetadata(sources: AssetSourceMetadata[]) {
  localStorage.setItem(metadataKey, JSON.stringify(sources));
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
      if (!request.result.objectStoreNames.contains('assetIndexCache')) request.result.createObjectStore('assetIndexCache');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function putHandle(id: string, handle: FileSystemDirectoryHandle) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(handle, id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function getHandle(id: string) {
  const db = await openDb();
  const handle = await new Promise<FileSystemDirectoryHandle | undefined>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).get(id);
    request.onsuccess = () => resolve(request.result as FileSystemDirectoryHandle | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return handle;
}

async function deleteHandle(id: string) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function collectFiles(handle: FileSystemDirectoryHandle, prefix = ''): Promise<File[]> {
  const files: File[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind === 'file') {
      const file = await entry.getFile();
      Object.defineProperty(file, 'webkitRelativePath', {
        value: `${prefix}${file.name}`,
        configurable: true,
      });
      files.push(file);
    } else {
      files.push(...(await collectFiles(entry, `${prefix}${entry.name}/`)));
    }
  }
  return files;
}

async function getChildDirectory(handle: FileSystemDirectoryHandle, name: string) {
  try {
    return await handle.getDirectoryHandle(name);
  } catch {
    return undefined;
  }
}

async function collectLaunchBoxImageFiles(handle: FileSystemDirectoryHandle) {
  const groupSettings = loadAssetSourceGroupSettings();
  const files: File[] = [];
  let matchedLaunchBoxShape = false;

  for await (const platformEntry of handle.values()) {
    if (platformEntry.kind !== 'directory') continue;
    const platformHandle = platformEntry;
    const wantedFolders = await Promise.all(
      launchBoxAutoScanFolderNames(groupSettings).map(async (folderName) => ({
        folderName,
        handle: await getChildDirectory(platformHandle, folderName),
      })),
    );
    const availableFolders = wantedFolders.filter((entry): entry is { folderName: string; handle: FileSystemDirectoryHandle } => Boolean(entry.handle));
    if (availableFolders.length === 0) continue;
    matchedLaunchBoxShape = true;
    for (const folder of availableFolders) {
      files.push(...(await collectFiles(folder.handle, `${handle.name}/${platformEntry.name}/${folder.folderName}/`)));
    }
  }

  return matchedLaunchBoxShape ? files : undefined;
}

async function collectAssetSourceFiles(handle: FileSystemDirectoryHandle, scanMode: AssetSourceScanMode) {
  if (scanMode === 'launchbox-optimized') return (await collectLaunchBoxImageFiles(handle)) ?? [];
  return collectFiles(handle, `${handle.name}/`);
}

async function hasReadPermission(handle: FileSystemDirectoryHandle) {
  if (!handle.queryPermission) return true;
  const current = await handle.queryPermission({ mode: 'read' });
  if (current === 'granted') return true;
  if (!handle.requestPermission) return false;
  return (await handle.requestPermission({ mode: 'read' })) === 'granted';
}

function upsertMetadata(source: AssetSourceMetadata) {
  const existing = loadMetadata();
  const index = existing.findIndex((candidate) => candidate.id === source.id);
  if (index === -1) {
    saveMetadata([...existing, source]);
    return;
  }
  const next = [...existing];
  next[index] = source;
  saveMetadata(next);
}

export function getSavedAssetSourceMetadata() {
  return loadMetadata();
}

export function updateAssetSourceRole(sourceId: string, role: AssetKind | 'mixed') {
  const groupSettings = loadAssetSourceGroupSettings();
  const existing = loadMetadata();
  const next = existing.map((source) =>
    source.id === sourceId ? { ...source, role, status: isAssetKindEnabled(role, groupSettings) ? ('needs-refresh' as const) : ('disabled' as const) } : source,
  );
  saveMetadata(next);
  return next.find((source) => source.id === sourceId);
}

export function updateAssetSourceScanMode(sourceId: string, scanMode: AssetSourceScanMode) {
  const existing = loadMetadata();
  const next = existing.map((source) => (source.id === sourceId ? { ...source, scanMode, status: 'needs-refresh' as const } : source));
  saveMetadata(next);
  return next.find((source) => source.id === sourceId);
}

export function supportsDirectoryHandlePersistence() {
  return typeof window.showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined';
}

export function isDirectoryPickerAbort(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && /aborted|abort/i.test(error.message)) return true;
  return false;
}

export async function addDirectoryAssetSource(options: { scanMode?: AssetSourceScanMode } = {}): Promise<AssetSource | undefined> {
  if (!window.showDirectoryPicker) return undefined;
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await window.showDirectoryPicker();
  } catch (error) {
    if (isDirectoryPickerAbort(error)) return undefined;
    throw error;
  }
  const scanMode = options.scanMode ?? defaultScanMode;
  const groupSettings = loadAssetSourceGroupSettings();
  const directRole = scanMode === 'manual-folder' ? autoRoleKindForPath(handle.name) : undefined;
  if (directRole && !isAssetKindEnabled(directRole, groupSettings)) {
    const source: AssetSource = {
      id: createId('asset_source'),
      label: handle.name,
      folderPath: handle.name,
      role: directRole,
      status: 'disabled',
      persistence: 'directory-handle',
      scanMode,
      scanSignature: 'disabled',
      lastLoadedAt: new Date().toISOString(),
      assetCount: 0,
      handle,
    };
    await putHandle(source.id, handle);
    upsertMetadata(source);
    return source;
  }
  const files = await collectAssetSourceFiles(handle, scanMode);
  const imageCount = files.filter(isImageFile).length;
  const role = detectRoleFromFiles(files);
  const enabled = isAssetKindEnabled(role, groupSettings);
  const folderPath = commonFolderPath(files, handle.name);
  const source: AssetSource = {
    id: createId('asset_source'),
    label: handle.name,
    folderPath,
    role,
    status: enabled ? 'ready' : 'disabled',
    persistence: 'directory-handle',
    scanMode,
    scanSignature: scanSignature(files),
    lastLoadedAt: new Date().toISOString(),
    assetCount: enabled ? imageCount : 0,
    files: enabled ? files : undefined,
    handle,
  };
  await putHandle(source.id, handle);
  upsertMetadata(source);
  return source;
}

export function addFileListAssetSource(files: File[], label = 'Selected files'): AssetSource {
  const groupSettings = loadAssetSourceGroupSettings();
  const imageCount = files.filter(isImageFile).length;
  const role = detectRoleFromFiles(files);
  const enabled = isAssetKindEnabled(role, groupSettings);
  const folderPath = commonFolderPath(files, label);
  const source: AssetSource = {
    id: createId('asset_source'),
    label,
    folderPath,
    role,
    status: enabled ? 'ready' : 'disabled',
    persistence: 'file-list-metadata',
    scanMode: 'manual-folder',
    scanSignature: scanSignature(files),
    lastLoadedAt: new Date().toISOString(),
    assetCount: enabled ? imageCount : 0,
    files: enabled ? files : undefined,
  };
  upsertMetadata(source);
  return source;
}

export async function restoreAssetSources(): Promise<AssetSource[]> {
  const metadata = loadMetadata();
  const groupSettings = loadAssetSourceGroupSettings();
  const restored = await Promise.all(
    metadata.map(async (source): Promise<AssetSource> => {
      try {
        if (!isAssetSourceEnabled(source, groupSettings)) return disabledSource(source);
        if (source.persistence !== 'directory-handle') {
          return { ...source, status: 'needs-reconnect' };
        }

        const handle = await getHandle(source.id);
        if (!handle || !(await hasReadPermission(handle))) {
          return { ...source, status: 'needs-refresh' };
        }

        const files = await collectAssetSourceFiles(handle, source.scanMode ?? defaultScanMode);
        const nextSignature = scanSignature(files);
        const role = source.role ?? detectRoleFromFiles(files);
        const enabledFiles = files.filter((file) => isAssetKindEnabled(fileRole(file, role), groupSettings));
        return {
          ...source,
          label: handle.name,
          folderPath: commonFolderPath(enabledFiles.length > 0 ? enabledFiles : files, source.folderPath ?? handle.name),
          role,
          status: 'ready',
          lastLoadedAt: new Date().toISOString(),
          assetCount: enabledFiles.filter(isImageFile).length,
          scanSignature: nextSignature,
          scanChanged: nextSignature !== source.scanSignature,
          scanError: undefined,
          files: enabledFiles,
          handle,
        };
      } catch (error) {
        return {
          ...source,
          status: 'error',
        scanError: error instanceof Error ? error.message : 'Image source scan failed.',
        scanChanged: false,
        };
      }
    }),
  );

  saveMetadata(restored.map((source) => ({
    ...source,
    files: undefined,
    handle: undefined,
  })));
  return restored;
}

export async function removeAssetSource(sourceId: string) {
  saveMetadata(loadMetadata().filter((source) => source.id !== sourceId));
  await deleteHandle(sourceId);
}

export async function refreshAssetSource(sourceId: string): Promise<AssetSource | undefined> {
  const metadata = loadMetadata().find((source) => source.id === sourceId);
  if (!metadata) return undefined;
  const groupSettings = loadAssetSourceGroupSettings();

  if (!isAssetSourceEnabled(metadata, groupSettings)) {
    const source = disabledSource(metadata);
    upsertMetadata(source);
    return source;
  }

  if (metadata.persistence !== 'directory-handle') {
    const source = { ...metadata, status: 'needs-reconnect' as const };
    upsertMetadata(source);
    return source;
  }

  const handle = await getHandle(metadata.id);
  if (!handle || !(await hasReadPermission(handle))) {
    const source = { ...metadata, status: 'needs-refresh' as const };
    upsertMetadata(source);
    return source;
  }

  const files = await collectAssetSourceFiles(handle, metadata.scanMode ?? defaultScanMode);
  const nextSignature = scanSignature(files);
  const role = metadata.role ?? detectRoleFromFiles(files);
  const enabledFiles = files.filter((file) => isAssetKindEnabled(fileRole(file, role), groupSettings));
  const source: AssetSource = {
    ...metadata,
    label: handle.name,
    folderPath: commonFolderPath(enabledFiles.length > 0 ? enabledFiles : files, metadata.folderPath ?? handle.name),
    role,
    status: 'ready',
    lastLoadedAt: new Date().toISOString(),
    assetCount: enabledFiles.filter(isImageFile).length,
    scanSignature: nextSignature,
    scanChanged: nextSignature !== metadata.scanSignature,
    scanError: undefined,
    files: enabledFiles,
    handle,
  };
  upsertMetadata(source);
  return source;
}
