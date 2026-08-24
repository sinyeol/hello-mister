import type { AssetKind, AssetLibrary, AssetSource, LocalAsset } from '@sticker-v1/types';
import { createId } from '@sticker-v1/utils/ids';
import { normalizeName } from '@sticker-v1/utils/normalizeName';
import { assetStableKey } from '@sticker-v1/utils/assetReferences';
import { removeFileExtension, safeExtension, safeFileName, safeString, splitPathParts } from '@sticker-v1/utils/pathParts';
import { autoRoleKindForPath, findAssetFolderRuleByName, findKnownAssetFolderIndex } from './assetFolderRoles';
import { isAssetKindEnabled, isAssetSourceEnabled, loadAssetSourceGroupSettings } from './assetSourceGroups';

const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg']);

function getExtension(fileName: string | null | undefined) {
  return safeExtension(fileName);
}

function filePath(file: File) {
  const rawPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  return safeString(rawPath, safeFileName(file.name, 'unknown-image'));
}

function detectKind(file: File, source: AssetSource): AssetKind {
  if (source.role && source.role !== 'mixed') return source.role;
  return autoRoleKindForPath(filePath(file)) ?? 'unknown';
}

function launchBoxMetadata(file: File) {
  const fallbackName = safeFileName(file.name, 'unknown-image');
  const originalPath = filePath(file);
  const parts = splitPathParts(originalPath);
  const folderIndex = findKnownAssetFolderIndex(parts);
  const folderName = folderIndex === -1 ? undefined : parts[folderIndex];
  const assetType = folderName ? safeString(folderName, 'Unassigned') : 'Unassigned';
  const platform = folderIndex > 0 ? safeString(parts[folderIndex - 1], '') : '';
  const nameWithoutExtension = removeFileExtension(fallbackName);
  return {
    originalPath,
    filename: fallbackName,
    platform,
    assetType,
    role: findAssetFolderRuleByName(folderName)?.role,
    normalizedFileName: normalizeName(nameWithoutExtension),
  };
}

function stableAssetId(source: AssetSource, metadata: ReturnType<typeof launchBoxMetadata>, kind: AssetKind) {
  const seed = `${source.id}:${metadata.originalPath}:${kind}`;
  return `asset_${normalizeName(seed).replace(/[^a-z0-9]+/g, '_')}`;
}

export function buildAssetLibrary(files: File[]): AssetLibrary {
  return buildAssetLibraryFromSources([{ id: 'source_legacy', label: 'Browser selected files', status: 'connected', persistence: 'file-list-metadata', assetCount: files.length, files }]);
}

export function buildAssetLibraryFromSources(sources: AssetSource[]): AssetLibrary {
  const loadedAt = new Date().toISOString();
  const assetsById: Record<string, LocalAsset> = {};
  const folders: AssetLibrary['folders'] = {};
  const groupSettings = loadAssetSourceGroupSettings();

  sources.forEach((source) => {
    if (!isAssetSourceEnabled(source, groupSettings)) return;
    (source.files ?? []).forEach((file) => {
      try {
        const filename = safeFileName(file?.name, 'unknown-image');
        const format = getExtension(filename);
        if (!imageExtensions.has(format)) return;

        const kind = detectKind(file, source);
        if (!isAssetKindEnabled(kind, groupSettings)) return;
        const metadata = launchBoxMetadata(file);
        const sourceId = safeString(source.id, 'unknown-source');
        const sourceLabel = safeString(source.label, 'Unknown source');
        const asset: LocalAsset = {
          id: stableAssetId(source, metadata, kind) || createId('asset'),
          sourceId,
          sourceLabel,
          kind,
          name: metadata.filename,
          normalizedName: normalizeName(metadata.filename),
          path: metadata.originalPath || metadata.filename,
          originalPath: metadata.originalPath || metadata.filename,
          platform: metadata.platform,
          assetType: metadata.assetType || 'Unassigned',
          normalizedFileName: metadata.normalizedFileName || normalizeName(removeFileExtension(metadata.filename)),
          file,
          objectUrl: URL.createObjectURL(file),
          mimeType: file.type || undefined,
          format: format as LocalAsset['format'],
          importedAt: loadedAt,
        };
        asset.stableAssetKey = assetStableKey(asset);

        assetsById[asset.id] = asset;
        folders[kind] ??= { kind, displayName: kind, files: [] };
        folders[kind]?.files.push(asset);
      } catch {
        // One malformed File record should not fail the entire image index.
      }
    });
  });

  return {
    id: createId('asset_library'),
    rootName: sources.map((source) => source.label).join(', ') || 'No local folder loaded',
    folders,
    assetsById,
    loadedAt,
  };
}

export function flattenAssetLibrary(library: AssetLibrary) {
  return Object.values(library.assetsById);
}
