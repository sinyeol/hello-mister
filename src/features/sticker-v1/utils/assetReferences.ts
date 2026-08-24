import type { AssetReference, LocalAsset } from '@sticker-v1/types';
import { normalizeName } from '@sticker-v1/utils/normalizeName';

function normalizedPart(value?: string) {
  return normalizeName(value ?? '').trim();
}

export function assetStableKey(asset: Pick<LocalAsset, 'kind' | 'name' | 'normalizedName' | 'path' | 'originalPath' | 'platform' | 'assetType' | 'normalizedFileName'>) {
  return [
    normalizedPart(asset.platform),
    normalizedPart(asset.kind),
    normalizedPart(asset.assetType),
    normalizedPart(asset.originalPath ?? asset.path),
    normalizedPart(asset.normalizedFileName ?? asset.normalizedName ?? asset.name),
  ].join('|');
}

export function assetReferenceFromAsset(asset?: LocalAsset): AssetReference | undefined {
  if (!asset) return undefined;
  const stableKey = assetStableKey(asset);
  return {
    assetId: asset.id,
    cacheKey: stableKey,
    stableKey,
    stableAssetKey: stableKey,
    kind: asset.kind,
    name: asset.name,
    filename: asset.name,
    originalFilename: asset.name,
    displayName: asset.name,
    normalizedName: asset.normalizedName,
    path: asset.path,
    originalPath: asset.originalPath,
    platform: asset.platform,
    assetType: asset.assetType,
    normalizedFileName: asset.normalizedFileName,
    sourceId: asset.sourceId,
    sourceLabel: asset.sourceLabel,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
  };
}

export function assetReferenceCacheKey(reference: AssetReference) {
  return reference.cacheKey || reference.stableAssetKey || reference.stableKey;
}

export function resolveAssetReference(
  assetsById: Record<string, LocalAsset>,
  assetId?: string,
  reference?: AssetReference,
) {
  const byId = assetId ? assetsById[assetId] : undefined;
  if (byId?.objectUrl) return byId;
  if (!reference) return undefined;
  const referenceStableKey = assetReferenceCacheKey(reference);
  const assets = Object.values(assetsById);
  const byStableKey = assets.find((asset) => assetStableKey(asset) === referenceStableKey && asset.objectUrl);
  if (byStableKey) return byStableKey;

  const referencePath = normalizedPart(reference.originalPath ?? reference.path);
  const referenceFile = normalizedPart(reference.normalizedFileName ?? reference.normalizedName ?? reference.name);
  const byPathOrFile = assets
    .map((asset) => {
    if (reference.kind && asset.kind !== reference.kind) return false;
    const assetPath = normalizedPart(asset.originalPath ?? asset.path);
    const assetFile = normalizedPart(asset.normalizedFileName ?? asset.normalizedName ?? asset.name);
      if (!asset.objectUrl || !((referencePath && assetPath === referencePath) || (referenceFile && assetFile === referenceFile))) return false;
      const platformScore = reference.platform && normalizedPart(asset.platform) === normalizedPart(reference.platform) ? 1 : 0;
      const pathScore = referencePath && assetPath === referencePath ? 2 : 0;
      return { asset, score: pathScore + platformScore };
    })
    .filter((candidate): candidate is { asset: LocalAsset; score: number } => Boolean(candidate))
    .sort((a, b) => b.score - a.score)[0]?.asset;
  if (byPathOrFile) return byPathOrFile;
  return byId ?? assets.find((asset) => assetStableKey(asset) === referenceStableKey);
}
