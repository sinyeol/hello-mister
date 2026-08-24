import type {
  MiSTerConnectionConfig,
  MiSTerLibraryProfile,
  MiSTerLibraryScanSource,
  MiSTerScanEntry,
  ZaparooLibraryEntry,
  ZaparooLibraryState,
} from '@sticker-v1/types';
import { buildLaunchPreview } from '@sticker-v1/services/mister/zaparooLaunch';
import { titleFromPath } from '@sticker-v1/services/mister/misterTitle';
import { normalizeName } from '@sticker-v1/utils/normalizeName';

const dbName = 'zaparoo-library';
const dbVersion = 1;
const storeName = 'state';
const activeStateKey = 'active';

export const emptyZaparooLibraryState: ZaparooLibraryState = {
  profiles: [],
  entries: [],
  hiddenPlatformKeys: [],
  importDisabledPlatformKeys: [],
  importEnabledPlatformKeys: [],
  customPlatformCatalog: [],
  ignoredUnknownPlatformKeys: [],
  classificationFolderPlatformKeys: [],
  backups: [],
};

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

function slug(value: string) {
  return normalizeName(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

// Deterministic FNV-1a hash → base36. slug() runs values through normalizeName(), which strips
// region/version markers like "(Japan)" / "(World)" — so different versions of the same arcade game
// (Hook (Japan), Hook (US), Hook (World)) slugged identically and collapsed into ONE library entry.
// Appending a hash of the FULL dedupe key keeps each distinct file a distinct entry while still
// collapsing genuinely-identical keys (same path re-scanned, or the same game on two devices).
function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizedMiSTerPathKey(path?: string) {
  return String(path ?? '').trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/g, '').toLowerCase();
}

export function deviceIdFromConfig(config: MiSTerConnectionConfig, fallbackName = 'Manual MiSTer') {
  const seed = config.host.trim()
    ? `${config.host}:${config.port}:${config.username}`
    : `${fallbackName}:${config.username || 'root'}:${config.port || 22}`;
  return `mister_device_${slug(seed)}`;
}

// A usable hardware MAC tells two physically-distinct MiSTers apart even when they share the "MiSTer" hostname,
// and stays stable across DHCP IP changes. Reject empty / all-zero / broadcast placeholders (which cloned SD
// cards or a missing NIC can report) so identity falls back to host/IP instead of merging two devices into one.
export function isUsableMacAddress(mac?: string): boolean {
  if (!mac) return false;
  const hex = mac.trim().toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12) return false;
  // 020304050607 = stock MiSTer MAC shared by every device/cloned SD → cannot distinguish devices.
  return hex !== '000000000000' && hex !== 'ffffffffffff' && hex !== '020304050607';
}

// The SD card CID is unique per physical microSD (even cloned ones) → the most reliable device identity.
export function isUsableSdCid(cid?: string): boolean {
  if (!cid) return false;
  const hex = cid.trim().toLowerCase().replace(/[^0-9a-f]/g, '');
  return hex.length >= 16 && !/^(0+|f+)$/.test(hex);
}

const hexKey = (value?: string) => (value ? value.trim().toLowerCase().replace(/[^0-9a-f]/g, '') : '');

export interface DeviceIdentityInput {
  profileId?: string;
  hostname?: string;
  macAddress?: string;
  sdCid?: string;
  host?: string;
  port?: number;
  username?: string;
}

// Prefer a stable identity (SD CID > profileId > usable MAC > hostname); fall back to the legacy
// host:port:username slug. Keeping deviceIdFromConfig as the fallback means historic entries/profiles
// keep resolving to the same id, and resolveProfileDeviceId re-finds a device that gains a CID later.
export function deviceIdForIdentity(input: DeviceIdentityInput, fallbackName = 'Manual MiSTer') {
  if (isUsableSdCid(input.sdCid)) return `mister_device_${slug(`cid:${hexKey(input.sdCid)}`)}`;
  if (input.profileId?.trim()) return `mister_device_${slug(input.profileId)}`;
  if (isUsableMacAddress(input.macAddress)) return `mister_device_${slug(`mac:${input.macAddress}`)}`;
  if (input.hostname?.trim()) return `mister_device_${slug(`host:${input.hostname}`)}`;
  return deviceIdFromConfig(
    {
      host: input.host ?? '',
      port: input.port ?? 22,
      username: input.username ?? 'root',
      protocol: 'ssh-sftp',
      authMethod: 'password',
    },
    fallbackName,
  );
}

// Reuse an existing profile's deviceId when this physical MiSTer was already scanned under a legacy/alias id,
// so switching to stable identity never duplicates the device or orphans its entries.
export function resolveProfileDeviceId(profiles: MiSTerLibraryProfile[], identity: DeviceIdentityInput, fallbackName = 'Manual MiSTer') {
  const stableId = deviceIdForIdentity(identity, fallbackName);
  const legacyId = deviceIdFromConfig(
    {
      host: identity.host ?? '',
      port: identity.port ?? 22,
      username: identity.username ?? 'root',
      protocol: 'ssh-sftp',
      authMethod: 'password',
    },
    fallbackName,
  );
  const candidateIds = new Set([stableId, legacyId]);
  // NOTE: do NOT match by hostname — cloned MiSTer SD cards share the same hostname (e.g. "MiSTer"), which would
  // wrongly merge two physically-distinct devices into one. profileId/deviceId/alias and the hardware-unique MAC
  // are the reliable identity keys.
  const match = profiles.find((profile) => {
    if (candidateIds.has(profile.deviceId)) return true;
    if (profile.stableDeviceId && candidateIds.has(profile.stableDeviceId)) return true;
    if (profile.aliasDeviceIds?.some((aliasId) => candidateIds.has(aliasId))) return true;
    // SD CID is the reliable per-card identity; match it first.
    if (isUsableSdCid(identity.sdCid) && isUsableSdCid(profile.sdCid) && hexKey(identity.sdCid) === hexKey(profile.sdCid)) return true;
    // Only match by MAC when it is a usable (non-stock) hardware MAC — cloned SDs share the stock MAC and
    // would otherwise be merged into one device.
    if (isUsableMacAddress(identity.macAddress) && isUsableMacAddress(profile.macAddress) && hexKey(identity.macAddress) === hexKey(profile.macAddress)) return true;
    return false;
  });
  return { deviceId: match?.deviceId ?? stableId, stableId, legacyId, matchedProfileId: match?.deviceId };
}

export function dedupeKeyForMiSTerEntry(entry: MiSTerScanEntry) {
  const normalizedAbsolutePath = normalizedMiSTerPathKey(entry.absolutePath);
  if (normalizedAbsolutePath) return `absolute-path:${normalizedAbsolutePath}`;

  const normalizedTitle = normalizeName(entry.title);
  const normalizedSystem = normalizeName(entry.systemId);
  if (normalizedSystem && normalizedTitle) return `launch-title:${normalizedSystem}:${normalizedTitle}`;

  const normalizedRom = normalizeName(entry.romName);
  if (normalizedSystem && normalizedRom) return `rom:${normalizedSystem}:${normalizedRom}`;

  const normalizedRelativePath = normalizeName(entry.relativePath);
  if (normalizedRelativePath) return `relative-path:${normalizedRelativePath}`;

  return `title:${normalizedSystem}:${normalizedTitle}`;
}

export function zaparooLibraryEntryIdForMiSTerEntry(entry: MiSTerScanEntry) {
  const key = dedupeKeyForMiSTerEntry(entry);
  return `zlib_${slug(key)}_${stableHash(key)}`;
}

function createLibraryEntry(entry: MiSTerScanEntry, deviceId: string, now: string): ZaparooLibraryEntry {
  const launchPreview = buildLaunchPreview(entry, 'absolute-path');
  return {
    id: zaparooLibraryEntryIdForMiSTerEntry(entry),
    sourceDevices: [deviceId],
    sourceRefs: [{
      deviceId,
      sourceEntryId: entry.id,
      absolutePath: entry.absolutePath,
      relativePath: entry.relativePath,
      launchValue: entry.launchValue,
      originalLibraryPath: launchPreview.originalLibraryPath,
      resolvedMiSTerPath: launchPreview.resolvedMiSTerPath,
      nfcPayload: launchPreview.nfcPayload,
      nfcPayloadSource: launchPreview.resolutionSource,
      scannedAt: entry.scannedAt,
    }],
    platformGroup: entry.platformGroup,
    systemId: entry.systemId,
    folderName: entry.folderName,
    relativePath: entry.relativePath,
    absolutePath: entry.absolutePath,
    title: entry.title,
    normalizedTitle: normalizeName(entry.title),
    romName: entry.romName,
    region: entry.region,
    disc: entry.disc,
    kind: entry.kind,
    launchMode: entry.launchMode,
    launchValue: entry.launchValue,
    originalLibraryPath: launchPreview.originalLibraryPath,
    resolvedMiSTerPath: launchPreview.resolvedMiSTerPath,
    nfcPayload: launchPreview.nfcPayload,
    nfcPayloadSource: launchPreview.resolutionSource,
    imageMatchKey: entry.imageMatchKey,
    imageMatchState: entry.imageMatch?.state ?? (entry.imageMatched ? 'matched' : 'unmatched'),
    imageAssetId: entry.imageMatch?.assetId,
    orientation: 'unknown',
    metadataSource: 'scan',
    linkedCardIds: entry.linkedCardId ? [entry.linkedCardId] : [],
    latestCardId: entry.linkedCardId,
    hasCard: entry.hasCard,
    launchReady: entry.launchReady,
    playable: entry.playable,
    bios: entry.bios,
    firmware: entry.firmware,
    systemFile: entry.systemFile,
    ignored: entry.ignored,
    classificationReason: entry.classificationReason,
    pathValid: entry.pathValid,
    aliasApplied: entry.aliasApplied,
    lastSyncedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function mergeLibraryEntry(existing: ZaparooLibraryEntry, entry: MiSTerScanEntry, deviceId: string, now: string): ZaparooLibraryEntry {
  const launchPreview = buildLaunchPreview(entry, 'absolute-path');
  const sourceDevices = Array.from(new Set([...existing.sourceDevices, deviceId]));
  const existingRefIndex = existing.sourceRefs.findIndex(
    (ref) => ref.deviceId === deviceId && ref.sourceEntryId === entry.id,
  );
  const sourceRef = {
    deviceId,
    sourceEntryId: entry.id,
    absolutePath: entry.absolutePath,
    relativePath: entry.relativePath,
    launchValue: entry.launchValue,
    originalLibraryPath: launchPreview.originalLibraryPath,
    resolvedMiSTerPath: launchPreview.resolvedMiSTerPath,
    nfcPayload: launchPreview.nfcPayload,
    nfcPayloadSource: launchPreview.resolutionSource,
    scannedAt: entry.scannedAt,
  };
  const sourceRefs = existingRefIndex === -1
    ? [...existing.sourceRefs, sourceRef]
    : existing.sourceRefs.map((ref, index) => (index === existingRefIndex ? sourceRef : ref));
  return {
    ...existing,
    sourceDevices,
    sourceRefs,
    // Titles are always path-derived (no user-custom titles), so refresh them from the fresh scan. Without
    // this, an entry scanned before a titleFromPath fix keeps its stale title forever (e.g. "04" instead of
    // "Sonic The Hedgehog") because the merge otherwise preserves the old value.
    title: entry.title,
    normalizedTitle: normalizeName(entry.title),
    romName: entry.romName || existing.romName,
    launchValue: entry.launchValue || existing.launchValue,
    originalLibraryPath: launchPreview.originalLibraryPath || existing.originalLibraryPath,
    resolvedMiSTerPath: launchPreview.resolvedMiSTerPath || existing.resolvedMiSTerPath,
    nfcPayload: launchPreview.nfcPayload || existing.nfcPayload,
    nfcPayloadSource: launchPreview.resolutionSource || existing.nfcPayloadSource,
    imageMatchState: entry.imageMatch?.state ?? existing.imageMatchState,
    imageAssetId: entry.imageMatch?.assetId ?? existing.imageAssetId,
    aliasApplied: existing.aliasApplied || entry.aliasApplied,
    launchReady: existing.launchReady || entry.launchReady,
    playable: existing.playable || entry.playable,
    bios: existing.bios && entry.bios,
    firmware: existing.firmware && entry.firmware,
    systemFile: existing.systemFile && entry.systemFile,
    ignored: existing.ignored && entry.ignored,
    classificationReason: entry.classificationReason ?? existing.classificationReason,
    pathValid: existing.pathValid === false || entry.pathValid === false ? false : existing.pathValid ?? entry.pathValid,
    lastSyncedAt: now,
    updatedAt: now,
  };
}

export function mergeMiSTerLibraryIntoZaparooLibrary(
  state: ZaparooLibraryState,
  entries: MiSTerScanEntry[],
  options: {
    config: MiSTerConnectionConfig;
    deviceName?: string;
    scanSource: MiSTerLibraryScanSource;
    forceImportEntryIds?: string[];
    identity?: DeviceIdentityInput;
    prune?: boolean;
    // When provided, only these entry ids (plus forced) are imported. Used by per-device refresh so a full
    // scan can prune without importing pending/unknown platforms (CLAUDE.md §14 opt-in safety).
    importAllowlistIds?: string[];
  },
) {
  const now = new Date().toISOString();
  // Identify the device by its hardware MAC when one is available: it stays stable across DHCP IP changes and
  // distinguishes multiple MiSTers that all share the "MiSTer" hostname. Fall back to host/IP when the MAC is
  // missing or a placeholder (cloned SD card / no NIC) to avoid merging two devices into one. resolveProfileDeviceId
  // reuses an already-scanned profile (matched by id/alias/MAC) so enabling this never orphans entries or card links.
  const identity = {
    ...(options.identity ?? {}),
    host: options.identity?.host ?? options.config.host,
    port: options.identity?.port ?? options.config.port,
    username: options.identity?.username ?? options.config.username,
  };
  const canUseStableIdentity = isUsableSdCid(identity.sdCid) || isUsableMacAddress(identity.macAddress) || Boolean(identity.profileId?.trim());
  const resolvedIdentity = canUseStableIdentity ? resolveProfileDeviceId(state.profiles, identity, options.deviceName) : null;
  const deviceId = resolvedIdentity?.deviceId ?? deviceIdFromConfig(options.config, options.deviceName);
  const deviceName = options.deviceName?.trim() || options.config.host || 'Manual MiSTer';
  const existingProfile = state.profiles.find((profile) => profile.deviceId === deviceId);
  const disabledPlatformKeys = new Set(state.importDisabledPlatformKeys ?? []);
  const forcedImportIds = new Set(options.forceImportEntryIds ?? []);
  const importAllowlist = options.importAllowlistIds ? new Set(options.importAllowlistIds) : null;
  const importableEntries = entries.filter((entry) => forcedImportIds.has(entry.id)
    || (importAllowlist
      ? importAllowlist.has(entry.id)
      : !disabledPlatformKeys.has(`${entry.platformGroup}/${entry.systemId}`)));
  const entriesByDedupe = new Map(state.entries.map((entry) => [entry.id, entry]));
  const existingEntriesByPath = new Map<string, ZaparooLibraryEntry>();
  state.entries.forEach((entry) => {
    [entry.absolutePath, entry.resolvedMiSTerPath, ...entry.sourceRefs.map((ref) => ref.absolutePath)]
      .map(normalizedMiSTerPathKey)
      .filter(Boolean)
      .forEach((pathKey) => existingEntriesByPath.set(pathKey, entry));
  });

  importableEntries.forEach((entry) => {
    const id = zaparooLibraryEntryIdForMiSTerEntry(entry);
    const pathKey = normalizedMiSTerPathKey(entry.absolutePath);
    const existing = entriesByDedupe.get(id) ?? existingEntriesByPath.get(pathKey);
    const merged = existing ? mergeLibraryEntry(existing, entry, deviceId, now) : createLibraryEntry(entry, deviceId, now);
    entriesByDedupe.set(merged.id, { ...merged, available: true, unavailableSince: undefined });
  });

  if (options.prune) {
    // Presence is judged from the raw scan (not the import-filtered set) so disabled-platform games that
    // physically remain on the device are not pruned. Only this device's contribution is touched.
    const scannedIds = new Set(entries.map((entry) => zaparooLibraryEntryIdForMiSTerEntry(entry)));
    const scannedPathKeys = new Set(entries.map((entry) => normalizedMiSTerPathKey(entry.absolutePath)).filter(Boolean));
    Array.from(entriesByDedupe.values()).forEach((entry) => {
      if (!entry.sourceDevices.includes(deviceId)) return;
      const deviceRef = entry.sourceRefs.find((ref) => ref.deviceId === deviceId);
      const stillPresent = scannedIds.has(entry.id)
        || scannedPathKeys.has(normalizedMiSTerPathKey(entry.absolutePath))
        || (deviceRef ? scannedPathKeys.has(normalizedMiSTerPathKey(deviceRef.absolutePath)) : false);
      if (stillPresent) return;
      const sourceDevices = entry.sourceDevices.filter((candidate) => candidate !== deviceId);
      const sourceRefs = entry.sourceRefs.filter((ref) => ref.deviceId !== deviceId);
      if (sourceDevices.length > 0) {
        entriesByDedupe.set(entry.id, { ...entry, sourceDevices, sourceRefs, updatedAt: now });
        return;
      }
      if (entry.linkedCardIds.length > 0) {
        // Never delete a card-linked logical entry; keep it but flag it unavailable until a device reports it again.
        entriesByDedupe.set(entry.id, { ...entry, sourceDevices, sourceRefs, available: false, unavailableSince: entry.unavailableSince ?? now, updatedAt: now });
        return;
      }
      entriesByDedupe.delete(entry.id);
    });
  }

  const platforms = Array.from(new Set(entries.map((entry) => `${entry.platformGroup}/${entry.systemId}`))).sort();
  const playableEntryCount = entries.filter((entry) => entry.playable !== false && !entry.bios && !entry.firmware && !entry.systemFile && !entry.ignored).length;
  const profile: MiSTerLibraryProfile = {
    ...existingProfile,
    deviceId,
    deviceName: existingProfile?.deviceName ?? deviceName,
    alias: existingProfile?.alias,
    host: options.config.host || undefined,
    username: options.config.username || undefined,
    port: options.config.port || undefined,
    lastSyncAt: now,
    entryCount: entries.length,
    mergedEntryCount: importableEntries.length,
    playableEntryCount,
    nonPlayableEntryCount: Math.max(0, entries.length - playableEntryCount),
    importDisabledPlatformKeys: existingProfile?.importDisabledPlatformKeys ?? [],
    platforms,
    scanSource: options.scanSource,
    entryIds: importableEntries.map((entry) => entry.id),
    // Record the MAC-based stable id + alias ids so this device is re-found by MAC after a DHCP IP change,
    // and so a host-based lookup (legacy id) still maps here. Only meaningful when a usable MAC was present.
    stableDeviceId: resolvedIdentity?.stableId ?? existingProfile?.stableDeviceId,
    aliasDeviceIds: resolvedIdentity
      ? Array.from(new Set([
        ...(existingProfile?.aliasDeviceIds ?? []),
        resolvedIdentity.stableId,
        resolvedIdentity.legacyId,
      ].filter((id) => id && id !== deviceId)))
      : (existingProfile?.aliasDeviceIds ?? []),
    hostname: identity.hostname ?? existingProfile?.hostname,
    macAddress: identity.macAddress ?? existingProfile?.macAddress,
    sdCid: identity.sdCid ?? existingProfile?.sdCid,
  };

  return {
    activeProfileId: deviceId,
    profiles: [...state.profiles.filter((candidate) => candidate.deviceId !== deviceId), profile]
      .sort((a, b) => b.lastSyncAt.localeCompare(a.lastSyncAt)),
    entries: Array.from(entriesByDedupe.values()).sort((a, b) => a.title.localeCompare(b.title)),
    hiddenPlatformKeys: state.hiddenPlatformKeys ?? [],
    importDisabledPlatformKeys: state.importDisabledPlatformKeys ?? [],
    importEnabledPlatformKeys: state.importEnabledPlatformKeys ?? [],
    customPlatformCatalog: state.customPlatformCatalog ?? [],
    ignoredUnknownPlatformKeys: state.ignoredUnknownPlatformKeys ?? [],
    classificationFolderPlatformKeys: state.classificationFolderPlatformKeys ?? [],
    backups: state.backups ?? [],
    updatedAt: now,
  } satisfies ZaparooLibraryState;
}

export function updateMiSTerProfileInZaparooLibrary(
  state: ZaparooLibraryState,
  profileId: string,
  patch: Partial<MiSTerLibraryProfile>,
) {
  return {
    ...state,
    profiles: state.profiles.map((profile) => (profile.deviceId === profileId ? { ...profile, ...patch } : profile)),
    updatedAt: new Date().toISOString(),
  } satisfies ZaparooLibraryState;
}

export function createZaparooLibraryBackup(state: ZaparooLibraryState, reason: 'manual' | 'auto-merge' | 'restore-point' = 'manual') {
  const createdAt = new Date().toISOString();
  const snapshot: ZaparooLibraryState = {
    ...state,
    backups: [],
    updatedAt: createdAt,
  };
  return {
    ...state,
    backups: [
      {
        id: `zlib_backup_${Date.now()}`,
        createdAt,
        entryCount: state.entries.length,
        profileCount: state.profiles.length,
        reason,
        state: snapshot,
      },
      ...(state.backups ?? []),
    ].slice(0, 3),
    updatedAt: createdAt,
  } satisfies ZaparooLibraryState;
}

export function restoreZaparooLibraryBackup(state: ZaparooLibraryState, backupId: string) {
  const backup = state.backups?.find((candidate) => candidate.id === backupId);
  if (!backup) return state;
  return {
    ...backup.state,
    backups: state.backups ?? [],
    updatedAt: new Date().toISOString(),
  } satisfies ZaparooLibraryState;
}

export function deleteZaparooLibraryBackup(state: ZaparooLibraryState, backupId: string) {
  return {
    ...state,
    backups: (state.backups ?? []).filter((backup) => backup.id !== backupId),
    updatedAt: new Date().toISOString(),
  } satisfies ZaparooLibraryState;
}

export function setActiveZaparooProfile(state: ZaparooLibraryState, profileId: string | undefined) {
  return {
    ...state,
    activeProfileId: profileId,
    updatedAt: new Date().toISOString(),
  } satisfies ZaparooLibraryState;
}

export function removeMiSTerProfileFromZaparooLibrary(state: ZaparooLibraryState, profileId: string) {
  const now = new Date().toISOString();
  const profiles = state.profiles.filter((profile) => profile.deviceId !== profileId);
  const entries = state.entries.flatMap((entry) => {
    if (!entry.sourceDevices.includes(profileId)) return [entry];
    const sourceDevices = entry.sourceDevices.filter((deviceId) => deviceId !== profileId);
    if (sourceDevices.length === 0) return [];
    return [{
      ...entry,
      sourceDevices,
      sourceRefs: entry.sourceRefs.filter((ref) => ref.deviceId !== profileId),
      updatedAt: now,
    }];
  });
  return {
    ...state,
    activeProfileId: state.activeProfileId === profileId ? profiles[0]?.deviceId : state.activeProfileId,
    profiles,
    entries,
    updatedAt: now,
  } satisfies ZaparooLibraryState;
}

export function markZaparooEntryCard(state: ZaparooLibraryState, entryId: string | undefined, savedCardId: string) {
  if (!entryId) return state;
  const now = new Date().toISOString();
  return {
    ...state,
    entries: state.entries.map((entry) => {
      if (entry.id !== entryId) return entry;
      return {
        ...entry,
        linkedCardIds: Array.from(new Set([...entry.linkedCardIds, savedCardId])),
        latestCardId: savedCardId,
        hasCard: true,
        updatedAt: now,
      };
    }),
    updatedAt: now,
  };
}

// Minimal fields needed to (re)link a saved card to a library entry. Works for both the full SavedCardRecord and
// the always-in-memory CardAlbumIndexItem, so reconcile never depends on lazily-loaded full card records.
export interface CardLinkInput {
  id: string;
  linkedEntryId?: string;
  title?: string;
  systemId?: string;
  absolutePath?: string;
  updatedAt?: string;
  deletedAt?: string;
}

export interface ZaparooEntryLookup {
  byId: Map<string, ZaparooLibraryEntry>;
  byPath: Map<string, ZaparooLibraryEntry>;
  bySystemTitle: Map<string, ZaparooLibraryEntry[]>;
}

export function buildZaparooEntryLookup(entries: ZaparooLibraryEntry[]): ZaparooEntryLookup {
  const byId = new Map<string, ZaparooLibraryEntry>();
  const byPath = new Map<string, ZaparooLibraryEntry>();
  const bySystemTitle = new Map<string, ZaparooLibraryEntry[]>();
  entries.forEach((entry) => {
    byId.set(entry.id, entry);
    entry.sourceRefs.forEach((ref) => {
      const key = normalizedMiSTerPathKey(ref.absolutePath);
      if (key && !byPath.has(key)) byPath.set(key, entry);
    });
    const stKey = `${normalizeName(entry.systemId)}|${normalizeName(entry.title)}`;
    bySystemTitle.set(stKey, [...(bySystemTitle.get(stKey) ?? []), entry]);
  });
  return { byId, byPath, bySystemTitle };
}

// Resolve the library entry a card points at. The stored entry id can be stale (an entry's id changes when its
// dedupe key changes — e.g. a game gained an absolute path so its id flipped from launch-title to absolute-path
// based), so fall back to matching by absolute path, then a unique system+title.
export function resolveEntryForCardLink(
  card: Pick<CardLinkInput, 'linkedEntryId' | 'absolutePath' | 'systemId' | 'title'>,
  lookup: ZaparooEntryLookup,
): ZaparooLibraryEntry | undefined {
  if (card.linkedEntryId) {
    const byId = lookup.byId.get(card.linkedEntryId);
    if (byId) return byId;
  }
  const pathKey = normalizedMiSTerPathKey(card.absolutePath);
  if (pathKey) {
    const byPath = lookup.byPath.get(pathKey);
    if (byPath) return byPath;
  }
  const title = normalizeName(card.title ?? '');
  const system = normalizeName(card.systemId ?? '');
  if (system && title) {
    const matches = lookup.bySystemTitle.get(`${system}|${title}`);
    if (matches && matches.length === 1) return matches[0];
  }
  return undefined;
}

function entryLinkSignature(entries: ZaparooLibraryEntry[]) {
  return entries
    .map((entry) => `${entry.id}:${entry.latestCardId ?? ''}:${entry.linkedCardIds.join(',')}:${entry.hasCard ? '1' : '0'}`)
    .join('|');
}

export function reconcileZaparooLibraryCardLinks(state: ZaparooLibraryState, cards: CardLinkInput[]) {
  const now = new Date().toISOString();
  const lookup = buildZaparooEntryLookup(state.entries);
  const activeCards = cards
    .filter((card) => !card.deletedAt)
    .sort((a, b) => (a.updatedAt ?? '').localeCompare(b.updatedAt ?? ''));
  const linksByEntry = new Map<string, string[]>();

  activeCards.forEach((card) => {
    const entry = resolveEntryForCardLink(card, lookup);
    if (!entry) return;
    linksByEntry.set(entry.id, [...(linksByEntry.get(entry.id) ?? []), card.id]);
  });

  const before = entryLinkSignature(state.entries);
  const entries = state.entries.map((entry) => {
    const linkedCardIds = linksByEntry.get(entry.id) ?? [];
    return {
      ...entry,
      linkedCardIds,
      latestCardId: linkedCardIds.at(-1),
      hasCard: linkedCardIds.length > 0,
      updatedAt: linkedCardIds.join(',') === entry.linkedCardIds.join(',') && entry.latestCardId === linkedCardIds.at(-1) ? entry.updatedAt : now,
    };
  });
  if (before === entryLinkSignature(entries)) return state;
  return { ...state, entries, updatedAt: now } satisfies ZaparooLibraryState;
}

export function unmarkZaparooEntryCard(state: ZaparooLibraryState, savedCardId: string, remainingSavedCardIds: Set<string>) {
  const now = new Date().toISOString();
  return {
    ...state,
    entries: state.entries.map((entry) => {
      if (!entry.linkedCardIds.includes(savedCardId)) return entry;
      const linkedCardIds = entry.linkedCardIds.filter((id) => id !== savedCardId && remainingSavedCardIds.has(id));
      return {
        ...entry,
        linkedCardIds,
        latestCardId: entry.latestCardId === savedCardId ? linkedCardIds.at(-1) : entry.latestCardId,
        hasCard: linkedCardIds.length > 0,
        updatedAt: now,
      };
    }),
    updatedAt: now,
  };
}

// One-shot title repair applied on load: entries scanned before the numbering-prefix titleFromPath fix hold
// raw titles (e.g. "04" for "04. Sonic The Hedgehog (USA).md"). Re-derive from the stored path so existing
// libraries display correctly without requiring a re-scan. Titles are always path-derived (no user-custom
// titles), so this is safe and idempotent — correctly-titled entries are left untouched.
function migrateEntryTitles(state: ZaparooLibraryState): ZaparooLibraryState {
  if (!Array.isArray(state.entries) || state.entries.length === 0) return state;
  let changed = false;
  const entries = state.entries.map((entry) => {
    const path = entry.absolutePath || entry.resolvedMiSTerPath || entry.relativePath;
    if (!path) return entry;
    const freshTitle = titleFromPath(path);
    if (!freshTitle || freshTitle === entry.title) return entry;
    changed = true;
    return { ...entry, title: freshTitle, normalizedTitle: normalizeName(freshTitle) };
  });
  return changed ? { ...state, entries } : state;
}

export async function loadZaparooLibraryStateFromIndexedDb() {
  return migrateEntryTitles({
    ...emptyZaparooLibraryState,
    ...(await idbGet<ZaparooLibraryState>(activeStateKey)),
  });
}

export function persistZaparooLibraryState(state: ZaparooLibraryState) {
  void idbSet(activeStateKey, state);
}
