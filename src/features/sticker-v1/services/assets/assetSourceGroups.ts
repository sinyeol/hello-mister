import type { AssetKind, AssetLibrary, AssetSource, LocalAsset } from '@sticker-v1/types';

export type AssetSourceGroup = 'front' | 'logo' | 'background';
export type AssetSourceGroupSettings = Record<AssetSourceGroup, boolean>;

const settingsKey = 'zaparoo.assetSourceGroups.v1';

export const defaultAssetSourceGroupSettings: AssetSourceGroupSettings = {
  front: true,
  logo: false,
  background: true,
};

export const assetSourceGroupLabels: Record<AssetSourceGroup, string> = {
  front: 'Front',
  logo: 'Logo / Clear Logo',
  background: 'Background',
};

export const assetSourceGroupDescriptions: Record<AssetSourceGroup, string> = {
  front: '카드 Main Image 후보입니다. Box - Front와 Fanart - Front를 사용합니다.',
  logo: 'Clear Logo 후보입니다. 기본값은 꺼짐이며, 켜면 Logo 폴더와 매칭 후보를 불러옵니다.',
  background: '템플릿/배경 후보입니다. Background 폴더를 수동으로 추가해 사용합니다.',
};

function normalizeSettings(value: Partial<AssetSourceGroupSettings> | undefined): AssetSourceGroupSettings {
  return {
    front: typeof value?.front === 'boolean' ? value.front : defaultAssetSourceGroupSettings.front,
    logo: typeof value?.logo === 'boolean' ? value.logo : defaultAssetSourceGroupSettings.logo,
    background: typeof value?.background === 'boolean' ? value.background : defaultAssetSourceGroupSettings.background,
  };
}

export function loadAssetSourceGroupSettings(): AssetSourceGroupSettings {
  if (typeof localStorage === 'undefined') return { ...defaultAssetSourceGroupSettings };
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(settingsKey) ?? '{}') as Partial<AssetSourceGroupSettings>);
  } catch {
    return { ...defaultAssetSourceGroupSettings };
  }
}

export function saveAssetSourceGroupSettings(settings: AssetSourceGroupSettings) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(settingsKey, JSON.stringify(normalizeSettings(settings)));
}

export function updateAssetSourceGroupEnabled(group: AssetSourceGroup, enabled: boolean) {
  const next = { ...loadAssetSourceGroupSettings(), [group]: enabled };
  saveAssetSourceGroupSettings(next);
  return next;
}

export function assetKindToSourceGroup(kind: AssetKind | 'mixed' | undefined): AssetSourceGroup | undefined {
  if (kind === 'box-front' || kind === 'fanart-box-front') return 'front';
  if (kind === 'clear-logo' || kind === 'platform-logo' || kind === 'marquee' || kind === 'wheel') return 'logo';
  if (kind === 'background') return 'background';
  return undefined;
}

export function isAssetSourceGroupEnabled(group: AssetSourceGroup | undefined, settings = loadAssetSourceGroupSettings()) {
  if (!group) return true;
  return settings[group] !== false;
}

export function isAssetKindEnabled(kind: AssetKind | 'mixed' | undefined, settings = loadAssetSourceGroupSettings()) {
  return isAssetSourceGroupEnabled(assetKindToSourceGroup(kind), settings);
}

export function assetSourceGroupForSource(source: Pick<AssetSource, 'role'>) {
  return assetKindToSourceGroup(source.role);
}

export function isAssetSourceEnabled(source: Pick<AssetSource, 'role'>, settings = loadAssetSourceGroupSettings()) {
  return isAssetSourceGroupEnabled(assetSourceGroupForSource(source), settings);
}

export function filterAssetsByEnabledGroups<T extends LocalAsset>(assets: T[], settings = loadAssetSourceGroupSettings()) {
  return assets.filter((asset) => isAssetKindEnabled(asset.kind, settings));
}

export function filterAssetLibraryByEnabledGroups(library: AssetLibrary, settings = loadAssetSourceGroupSettings()): AssetLibrary {
  const assetsById = Object.fromEntries(filterAssetsByEnabledGroups(Object.values(library.assetsById), settings).map((asset) => [asset.id, asset]));
  const folders: AssetLibrary['folders'] = {};
  Object.values(assetsById).forEach((asset) => {
    folders[asset.kind] ??= { kind: asset.kind, displayName: library.folders[asset.kind]?.displayName ?? asset.kind, files: [] };
    folders[asset.kind]?.files.push(asset);
  });
  return { ...library, folders, assetsById };
}
