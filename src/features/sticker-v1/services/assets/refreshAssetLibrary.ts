import { buildAssetLibraryFromSources } from './assetIndex';
import { saveAssetLibraryCache } from './assetIndexCache';
import { getSavedAssetSourceMetadata, refreshAssetSource } from './assetSources';
import { filterAssetLibraryByEnabledGroups, isAssetSourceEnabled, loadAssetSourceGroupSettings } from './assetSourceGroups';
import { mergeAssetsIntoLibrary } from './usedImageCache';
import type { AssetLibrary, AssetSource } from '@sticker-v1/types';

export interface AssetLibraryRefreshResult {
  library: AssetLibrary;
  indexed: number;
  refreshedSources: number;
  changed: boolean;
}

/**
 * Re-scan the saved (directory-handle) image source folders from disk and rebuild the asset library,
 * so images added to those folders since the last scan (e.g. box art just downloaded) become available
 * without leaving the editor. In-session runtime assets (objectUrl-backed) are preserved.
 */
export async function refreshAssetLibraryFromDisk(currentLibrary?: AssetLibrary): Promise<AssetLibraryRefreshResult> {
  const groupSettings = loadAssetSourceGroupSettings();
  const saved = getSavedAssetSourceMetadata();
  // Only directory-handle sources can be re-scanned from disk (file-list sources don't persist their files);
  // they are the LaunchBox-style image folders we want to pick up newly added box art from.
  const directorySources = saved.filter(
    (source) => source.persistence === 'directory-handle' && isAssetSourceEnabled(source, groupSettings),
  );

  const refreshed = (
    await Promise.all(directorySources.map((source) => refreshAssetSource(source.id).catch(() => undefined)))
  ).filter((source): source is AssetSource => Boolean(source));

  const activeSources = refreshed.filter((source) => source.files?.length && isAssetSourceEnabled(source, groupSettings));
  let library = filterAssetLibraryByEnabledGroups(buildAssetLibraryFromSources(activeSources), groupSettings);

  const runtimeAssets = Object.values(currentLibrary?.assetsById ?? {}).filter((asset) => asset.objectUrl);
  if (runtimeAssets.length > 0) {
    library = mergeAssetsIntoLibrary(library, runtimeAssets);
  }

  await saveAssetLibraryCache(library).catch(() => undefined);

  return {
    library,
    indexed: Object.keys(library.assetsById).length,
    refreshedSources: refreshed.length,
    changed: refreshed.some((source) => source.scanChanged),
  };
}
