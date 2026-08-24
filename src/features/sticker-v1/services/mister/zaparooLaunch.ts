import type {
  MiSTerCardMetadata,
  MiSTerLaunchMode,
  MiSTerLaunchPreview,
  MiSTerPathResolutionSource,
  MiSTerPlatformGroup,
  MiSTerScanEntry,
  MiSTerScanEntryKind,
  TagWritePayload,
} from '@sticker-v1/types';

const ntag215UsableBytes = 492;
const mediaFatPrefix = '/media/fat/';

export interface MiSTerPathResolutionInput {
  id?: string;
  title?: string;
  platform?: string;
  platformGroup?: MiSTerPlatformGroup;
  systemId?: string;
  folderName?: string;
  folderPath?: string;
  relativePath?: string;
  absolutePath?: string;
  romName?: string;
  kind?: MiSTerScanEntryKind;
  launchValue?: string;
  originalLibraryPath?: string;
  resolvedMiSTerPath?: string;
  nfcPayload?: string;
  pathValid?: boolean;
}

interface PlatformFolderMapping {
  folder: string;
  aliases: string[];
}

interface PathResolutionResult {
  source: MiSTerPathResolutionSource;
  originalLibraryPath: string;
  resolvedMiSTerPath: string;
  nfcPayload: string;
  warnings: string[];
  valid: boolean;
  platformFolder?: string;
  reason: string;
}

interface TagPayloadOptions {
  allowRelativePath?: boolean;
}

const platformFolderMappings: PlatformFolderMapping[] = [
  { folder: 'Genesis', aliases: ['genesis', 'mega drive', 'megadrive', 'md'] },
  { folder: 'NES', aliases: ['nes', 'nintendo entertainment system', 'famicom'] },
  { folder: 'SNES', aliases: ['snes', 'super nintendo', 'super famicom', 'sfc'] },
  { folder: 'NeoGeo', aliases: ['neo geo', 'neogeo', 'neo-geo'] },
  { folder: 'TurboGrafx16', aliases: ['turbografx-16', 'turbografx16', 'pc engine', 'pcengine', 'tgfx16', 'tg16'] },
  { folder: 'Gameboy', aliases: ['game boy', 'gameboy', 'gb'] },
  { folder: 'GBA', aliases: ['gba', 'game boy advance', 'gameboy advance'] },
  { folder: '_Arcade', aliases: ['arcade', 'mra'] },
];

function normalizePlatformKey(value?: string) {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeSlashes(value?: string) {
  return (value ?? '').replace(/\\/g, '/').trim();
}

function stripLaunchPrefix(value?: string) {
  const normalized = normalizeSlashes(value);
  return normalized.startsWith('**launch:') ? normalized.slice('**launch:'.length).trim() : normalized;
}

function splitPath(value?: string) {
  return normalizeSlashes(value).split('/').map((part) => part.trim()).filter(Boolean);
}

function joinPath(...parts: string[]) {
  return parts
    .flatMap((part) => splitPath(part))
    .join('/')
    .replace(/\/+/g, '/');
}

function cleanRelativePath(value?: string) {
  return joinPath(value ?? '');
}

function isMediaFatPath(value?: string) {
  return stripLaunchPrefix(value).startsWith(mediaFatPrefix);
}

function ensureLaunchPayload(path: string) {
  return path ? `**launch:${path}` : '';
}

function isArcadeEntry(input: MiSTerPathResolutionInput) {
  const haystack = [
    input.platform,
    input.platformGroup,
    input.systemId,
    input.folderName,
    input.kind,
    input.relativePath,
    input.absolutePath,
    input.launchValue,
  ].join(' ');
  return input.kind === 'mra' || /\.mra$/i.test(haystack) || normalizePlatformKey(haystack).includes('arcade');
}

function platformFolderFor(input: MiSTerPathResolutionInput) {
  if (isArcadeEntry(input)) return '_Arcade';
  const candidates = [
    input.platform,
    input.systemId,
    input.folderName,
    input.platformGroup,
    ...splitPath(input.relativePath).slice(0, 3),
    ...splitPath(input.absolutePath).slice(-4, -1),
  ].map(normalizePlatformKey).filter(Boolean);
  return platformFolderMappings.find((mapping) =>
    mapping.aliases.some((alias) => candidates.includes(normalizePlatformKey(alias))) ||
    candidates.includes(normalizePlatformKey(mapping.folder)),
  )?.folder;
}

function platformAliasKeys(folder?: string) {
  if (!folder) return new Set<string>();
  const mapping = platformFolderMappings.find((candidate) => candidate.folder === folder);
  return new Set([folder, ...(mapping?.aliases ?? [])].map(normalizePlatformKey));
}

function firstUsefulPath(input: MiSTerPathResolutionInput) {
  return [
    input.originalLibraryPath,
    input.relativePath,
    input.romName,
    input.absolutePath && !isMediaFatPath(input.absolutePath) ? input.absolutePath : undefined,
  ].map(normalizeSlashes).find(Boolean) ?? '';
}

function stripMediaFatBase(path: string, platformFolder: string) {
  const absolute = stripLaunchPrefix(path);
  if (!absolute.startsWith(mediaFatPrefix)) return '';
  const arcadePrefix = '/media/fat/_Arcade/';
  if (platformFolder === '_Arcade' && absolute.startsWith(arcadePrefix)) return cleanRelativePath(absolute.slice(arcadePrefix.length));
  const gamesPrefix = `/media/fat/games/${platformFolder}/`;
  if (absolute.startsWith(gamesPrefix)) return cleanRelativePath(absolute.slice(gamesPrefix.length));
  const genericGamesPrefix = '/media/fat/games/';
  if (absolute.startsWith(genericGamesPrefix)) {
    const parts = splitPath(absolute.slice(genericGamesPrefix.length));
    return cleanRelativePath(parts.slice(1).join('/'));
  }
  return cleanRelativePath(absolute.slice(mediaFatPrefix.length));
}

function relativeRomPath(input: MiSTerPathResolutionInput, platformFolder: string) {
  const original = firstUsefulPath(input);
  if (!original) return '';
  if (isMediaFatPath(original)) return stripMediaFatBase(original, platformFolder);

  const parts = splitPath(original);
  if (parts.length === 0) return '';
  const aliasKeys = platformAliasKeys(platformFolder);
  const lowerFirst = normalizePlatformKey(parts[0]);

  if (lowerFirst === 'media' && normalizePlatformKey(parts[1]) === 'fat') {
    return stripMediaFatBase(`/${parts.join('/')}`, platformFolder);
  }
  if (lowerFirst === 'games' && parts.length > 2) {
    return cleanRelativePath(parts.slice(2).join('/'));
  }
  if (lowerFirst === 'arcade' || lowerFirst === 'mra' || lowerFirst === '_arcade') {
    return cleanRelativePath(parts.slice(1).join('/'));
  }
  if ((lowerFirst === '_console' || lowerFirst === '_computer') && parts.length > 2) {
    return cleanRelativePath(parts.slice(2).join('/'));
  }
  if (aliasKeys.has(lowerFirst)) {
    return cleanRelativePath(parts.slice(1).join('/'));
  }

  const platformSegmentIndex = parts.findIndex((part) => aliasKeys.has(normalizePlatformKey(part)));
  if (platformSegmentIndex >= 0 && platformSegmentIndex < parts.length - 1) {
    return cleanRelativePath(parts.slice(platformSegmentIndex + 1).join('/'));
  }

  const looksLikeLocalAbsolute = /^[a-z]:$/i.test(parts[0]) || original.startsWith('/') || original.startsWith('//');
  if (looksLikeLocalAbsolute && parts.length > 1) return cleanRelativePath(parts.at(-1));
  return cleanRelativePath(original);
}

function exactMediaFatPath(input: MiSTerPathResolutionInput) {
  const resolved = stripLaunchPrefix(input.resolvedMiSTerPath);
  if (isMediaFatPath(resolved)) return { path: resolved, source: 'resolvedMiSTerPath' as const };

  const absolute = stripLaunchPrefix(input.absolutePath);
  if (isMediaFatPath(absolute)) return { path: absolute, source: 'importedAbsolutePath' as const };

  const launchValue = stripLaunchPrefix(input.launchValue);
  if (isMediaFatPath(launchValue)) return { path: launchValue, source: 'importedAbsolutePath' as const };

  const nfcPayload = stripLaunchPrefix(input.nfcPayload);
  if (isMediaFatPath(nfcPayload)) return { path: nfcPayload, source: 'resolvedMiSTerPath' as const };

  return undefined;
}

function relativeLaunchText(input: MiSTerPathResolutionInput) {
  const path = cleanRelativePath(input.originalLibraryPath || input.relativePath || input.launchValue || input.romName || '');
  if (!path && input.systemId && input.title) return `${input.systemId}/${input.title}`;
  return path;
}

export function resolveMiSTerPath(input: MiSTerPathResolutionInput, preferredMode: MiSTerLaunchMode = 'absolute-path'): PathResolutionResult {
  const warnings: string[] = [];
  const title = input.title || '선택한 게임';
  const platform = input.platform || input.systemId || input.folderName || input.platformGroup || '';
  const originalLibraryPath = firstUsefulPath(input);

  if (!platform) warnings.push('플랫폼 정보가 없습니다.');
  if (!originalLibraryPath && !isMediaFatPath(input.resolvedMiSTerPath) && !isMediaFatPath(input.absolutePath) && !isMediaFatPath(input.launchValue)) {
    warnings.push('원본 라이브러리 경로가 비어 있습니다.');
  }

  if (preferredMode === 'relative-path') {
    const text = relativeLaunchText(input);
    const byteLength = new TextEncoder().encode(text).byteLength;
    if (!text) warnings.push('relative path mode에서 쓸 경로가 없습니다.');
    if (byteLength > ntag215UsableBytes) warnings.push(`NFC payload가 ${byteLength} bytes로 NTAG215 권장 한도 ${ntag215UsableBytes} bytes를 초과합니다.`);
    return {
      source: 'relativePathMode',
      originalLibraryPath,
      resolvedMiSTerPath: '',
      nfcPayload: text,
      warnings,
      valid: warnings.length === 0,
      reason: 'Advanced relative path mode를 사용자가 직접 선택했습니다.',
    };
  }

  const exact = exactMediaFatPath(input);
  if (exact) {
    const payload = ensureLaunchPayload(exact.path);
    const byteLength = new TextEncoder().encode(payload).byteLength;
    if (byteLength > ntag215UsableBytes) warnings.push(`NFC payload가 ${byteLength} bytes로 NTAG215 권장 한도 ${ntag215UsableBytes} bytes를 초과합니다.`);
    return {
      source: exact.source,
      originalLibraryPath: originalLibraryPath || stripMediaFatBase(exact.path, platformFolderFor(input) ?? ''),
      resolvedMiSTerPath: exact.path,
      nfcPayload: payload,
      warnings,
      valid: warnings.length === 0,
      platformFolder: platformFolderFor(input),
      reason: exact.source === 'resolvedMiSTerPath'
        ? '이미 저장된 resolved MiSTer 절대 경로를 그대로 사용합니다.'
        : 'MiSTer에서 가져온 /media/fat/ 절대 경로를 재구성하지 않고 그대로 사용합니다.',
    };
  }

  const platformFolder = platformFolderFor(input);
  if (!platformFolder) {
    warnings.push('이 플랫폼에 대한 MiSTer 폴더 매핑이 없습니다. 전역 platform mapping에 추가한 뒤 다시 시도하세요.');
    return {
      source: 'missing',
      originalLibraryPath,
      resolvedMiSTerPath: '',
      nfcPayload: '',
      warnings,
      valid: false,
      reason: `${title}의 MiSTer 폴더를 결정하지 못했습니다.`,
    };
  }

  const romPath = relativeRomPath(input, platformFolder);
  if (!romPath) warnings.push('MiSTer 절대 경로를 만들 원본 ROM 경로가 없습니다.');
  const resolvedMiSTerPath = romPath
    ? platformFolder === '_Arcade'
      ? `/${joinPath('media/fat/_Arcade', romPath)}`
      : `/${joinPath('media/fat/games', platformFolder, romPath)}`
    : '';
  const payload = ensureLaunchPayload(resolvedMiSTerPath);
  const byteLength = new TextEncoder().encode(payload).byteLength;
  if (payload && !payload.startsWith('**launch:')) warnings.push('NFC payload는 **launch:로 시작해야 합니다.');
  if (resolvedMiSTerPath && !resolvedMiSTerPath.startsWith(mediaFatPrefix)) warnings.push('resolved MiSTer path는 /media/fat/로 시작해야 합니다.');
  if (byteLength > ntag215UsableBytes) warnings.push(`NFC payload가 ${byteLength} bytes로 NTAG215 권장 한도 ${ntag215UsableBytes} bytes를 초과합니다.`);

  return {
    source: 'platformMapping',
    originalLibraryPath,
    resolvedMiSTerPath,
    nfcPayload: payload,
    warnings,
    valid: warnings.length === 0 && Boolean(payload),
    platformFolder,
    reason: `${platformFolder} platform mapping과 원본 라이브러리 경로를 조합해 MiSTer 절대 경로를 만들었습니다.`,
  };
}

function buildFallbackEntry(metadata: MiSTerCardMetadata, title: string): MiSTerScanEntry {
  const relativePath = metadata.originalLibraryPath || metadata.misterRelativePath;
  const absolutePath = metadata.resolvedMiSTerPath || metadata.misterAbsolutePath;
  return {
    id: metadata.zaparooLibraryEntryId ?? `card_metadata_${title}`,
    source: 'mister',
    platformGroup: metadata.misterPlatformGroup,
    systemId: metadata.misterSystemId,
    folderName: metadata.misterSystemId,
    folderPath: metadata.misterFolderPath,
    relativePath,
    absolutePath,
    title,
    romName: relativePath.split('/').pop() ?? title,
    kind: absolutePath.endsWith('.mra') || relativePath.endsWith('.mra') ? 'mra' : 'rom',
    launchMode: 'absolute-path',
    launchValue: metadata.nfcPayload || metadata.misterLaunchText,
    imageMatchKey: title,
    hasCard: true,
    imageMatched: false,
    launchReady: Boolean(metadata.nfcPayload || metadata.resolvedMiSTerPath || metadata.misterAbsolutePath || metadata.misterRelativePath),
    scannedAt: new Date().toISOString(),
  };
}

export function buildLaunchPreviewFromMetadata(metadata: MiSTerCardMetadata, title: string, preferredMode: MiSTerLaunchMode = 'absolute-path') {
  return buildLaunchPreview({
    ...buildFallbackEntry(metadata, title),
    originalLibraryPath: metadata.originalLibraryPath,
    resolvedMiSTerPath: metadata.resolvedMiSTerPath,
    nfcPayload: metadata.nfcPayload,
  }, preferredMode);
}

// Zaparoo NFC writing defaults to absolute MiSTer launch paths. Relative paths are
// intentionally available only when the user explicitly selects relative path mode.
export function buildZaparooLaunchText(entry: MiSTerScanEntry, preferredMode: MiSTerLaunchMode = 'absolute-path') {
  return buildLaunchPreview(entry, preferredMode).text;
}

export function buildLaunchPreview(entry: MiSTerScanEntry & Partial<MiSTerPathResolutionInput>, preferredMode: MiSTerLaunchMode = 'absolute-path'): MiSTerLaunchPreview {
  const resolution = resolveMiSTerPath(entry, preferredMode);
  const text = resolution.nfcPayload;
  const byteLength = new TextEncoder().encode(text).byteLength;
  const warnings = [...resolution.warnings];
  if (entry.pathValid === false) warnings.push('원본 경로가 유효하지 않은 것으로 표시되어 있습니다.');
  return {
    entryId: entry.id,
    title: entry.title,
    mode: preferredMode,
    text,
    reason: resolution.reason,
    byteLength,
    valid: resolution.valid && warnings.length === 0,
    warnings,
    originalLibraryPath: resolution.originalLibraryPath,
    resolvedMiSTerPath: resolution.resolvedMiSTerPath,
    nfcPayload: resolution.nfcPayload,
    resolutionSource: resolution.source,
    validationStatus: resolution.valid && warnings.length === 0 ? 'valid' : resolution.nfcPayload ? 'warning' : 'invalid',
  };
}

export function buildTagPayload(launchText: string, options: TagPayloadOptions = {}): TagWritePayload {
  const trimmed = launchText.trim();
  const byteLength = new TextEncoder().encode(trimmed).byteLength;
  const warnings: string[] = [];
  if (byteLength === 0) warnings.push('NFC payload가 비어 있습니다.');
  if (byteLength > ntag215UsableBytes) warnings.push(`Payload가 ${byteLength} bytes로 NTAG215 권장 한도 ${ntag215UsableBytes} bytes를 초과합니다.`);

  if (options.allowRelativePath) {
    if (!trimmed.includes('/') && !trimmed.startsWith('@') && !trimmed.startsWith('**launch:')) {
      warnings.push('Relative path mode에서도 파일명만 단독으로 쓰는 것은 권장하지 않습니다.');
    }
  } else {
    if (trimmed && !trimmed.startsWith('**launch:')) warnings.push('NFC payload는 **launch:로 시작해야 합니다.');
    const resolvedPath = stripLaunchPrefix(trimmed);
    if (trimmed.startsWith('**launch:') && !resolvedPath.startsWith(mediaFatPrefix)) {
      warnings.push('MiSTer NFC payload 경로는 /media/fat/로 시작해야 합니다.');
    }
  }

  return {
    tagType: 'NTAG215',
    launchText: trimmed,
    byteLength,
    valid: warnings.length === 0,
    warnings,
  };
}
