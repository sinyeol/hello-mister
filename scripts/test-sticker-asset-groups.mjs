// Ported from v1 scripts/test-asset-source-groups.mjs. Guards CLAUDE.md §9: the Clear Logo image group is
// disabled by default, and the toggle state drives LaunchBox folder scanning and cache hydration alike.
import assert from 'node:assert/strict';
import { importTs, installBrowserGlobals } from './sticker-v1-test-utils.mjs';

installBrowserGlobals();

const groups = await importTs('src/features/sticker-v1/services/assets/assetSourceGroups.ts');
const folderRoles = await importTs('src/features/sticker-v1/services/assets/assetFolderRoles.ts');

const defaults = groups.defaultAssetSourceGroupSettings;
assert.equal(defaults.front, true, 'Front is enabled by default');
assert.equal(defaults.background, true, 'Background is enabled by default');
assert.equal(defaults.logo, false, 'Logo / Clear Logo is disabled by default');

assert.equal(groups.isAssetKindEnabled('box-front', defaults), true, 'Box - Front remains enabled');
assert.equal(groups.isAssetKindEnabled('fanart-box-front', defaults), true, 'Fanart - Front remains enabled');
assert.equal(groups.isAssetKindEnabled('background', defaults), true, 'Background remains enabled');
assert.equal(groups.isAssetKindEnabled('clear-logo', defaults), false, 'Clear Logo is skipped when Logo is disabled');

assert.deepEqual(folderRoles.launchBoxAutoScanFolderNames(defaults), ['Box - Front', 'Fanart - Front'], 'LaunchBox optimized scan skips Clear Logo while Logo group is disabled');

const logoEnabled = { ...defaults, logo: true };
assert.deepEqual(folderRoles.launchBoxAutoScanFolderNames(logoEnabled), ['Box - Front', 'Fanart - Front', 'Clear Logo'], 'Enabling Logo makes Clear Logo folders available');

const library = {
  id: 'asset_library_test',
  folders: {},
  assetsById: {
    front: { id: 'front', kind: 'box-front', name: 'Sonic.png', normalizedName: 'sonic' },
    logo: { id: 'logo', kind: 'clear-logo', name: 'Sonic Logo.png', normalizedName: 'sonic logo' },
    background: { id: 'background', kind: 'background', name: 'Sonic BG.png', normalizedName: 'sonic bg' },
  },
};
const filtered = groups.filterAssetLibraryByEnabledGroups(library, defaults);
assert.equal(Boolean(filtered.assetsById.front), true, 'Front asset remains in cache hydration');
assert.equal(Boolean(filtered.assetsById.background), true, 'Background asset remains in cache hydration');
assert.equal(Boolean(filtered.assetsById.logo), false, 'Logo asset is not hydrated when disabled');

const reenabled = groups.filterAssetLibraryByEnabledGroups(library, logoEnabled);
assert.equal(Boolean(reenabled.assetsById.logo), true, 'Logo asset is available after re-enabling');

// The persisted toggle round-trips through localStorage and the loader falls back to the defaults.
assert.deepEqual(groups.loadAssetSourceGroupSettings(), defaults, 'missing settings fall back to the defaults (Clear Logo off)');
groups.saveAssetSourceGroupSettings(logoEnabled);
assert.equal(groups.loadAssetSourceGroupSettings().logo, true, 'saved group settings are loaded back');

console.log('Sticker asset source group tests passed.');
