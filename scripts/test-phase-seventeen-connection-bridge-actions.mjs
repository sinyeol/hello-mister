import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const main = read('electron/main.mjs');
const preload = read('electron/preload.mjs');
const desktopTypes = read('src/types/desktop.ts');
const activeProfile = read('src/services/mister/activeProfile.ts');
const stickerHydrator = read('src/features/sticker-v1/StickerV1Hydrator.tsx');
const stickerBridge = read('src/features/sticker-v1/services/mister/misterBridge.ts');
const projectStore = read('src/features/sticker-v1/store/projectStore.ts');
const zaparooLibrary = read('src/features/sticker-v1/services/zaparoo/zaparooLibrary.ts');
const platformNormalization = read('src/features/sticker-v1/utils/platformNormalization.ts');
const misterFpgaPage = read('src/features/sticker-v1/pages/MisterFpgaPage.tsx');
const cardAlbumPage = read('src/features/sticker-v1/pages/CardAlbumPage.tsx');

assert.match(main, /let activeMisterProfile/, 'Electron main should keep an active MiSTer profile in memory');
assert.match(main, /mister:active-profile:get/, 'main should expose active profile read IPC');
assert.match(main, /mister:active-profile:set/, 'main should expose active profile set IPC');
assert.match(main, /mister:active-profile:clear/, 'main should expose active profile clear IPC');
assert.match(preload, /getActiveMisterProfile/, 'preload should expose active profile read API');
assert.match(preload, /setActiveMisterProfile/, 'preload should expose active profile set API');
assert.match(preload, /clearActiveMisterProfile/, 'preload should expose active profile clear API');
assert.match(desktopTypes, /getActiveMisterProfile/, 'desktop types should include active profile read API');
assert.match(desktopTypes, /setActiveMisterProfile/, 'desktop types should include active profile set API');
assert.match(desktopTypes, /clearActiveMisterProfile/, 'desktop types should include active profile clear API');

assert.match(activeProfile, /syncActiveMisterProfileFromDesktop/, 'renderer active profile should sync with Electron main memory');
assert.match(activeProfile, /setActiveMisterProfile\?\.\(profile\)/, 'renderer active profile should update Electron main when connection succeeds');
assert.match(activeProfile, /연결된 MiSTer 없음/, 'empty active profile label should be readable Korean');
assert.doesNotMatch(activeProfile, /password|privateKey|passphrase|token/i, 'active profile state must not contain secrets');

assert.match(stickerHydrator, /useActiveMisterProfile/, 'v1 sticker hydrator should consume the v2 active profile');
assert.match(stickerHydrator, /setMiSTerConnection/, 'v1 sticker hydrator should inject the active MiSTer into the v1 store');
assert.match(stickerHydrator, /v2 MiSTer 연결 메뉴에서 연결된 장치를 v1 스티커 기능과 공유합니다/, 'v1 store should explain that it shares the v2 connection');

assert.match(stickerBridge, /listRemoteGameFolderFiles/, 'v1 bridge scan should read 1-level files from each MiSTer games folder');
assert.match(stickerBridge, /parseMiSTerPathList\(remoteFiles\.map/, 'v1 bridge scan should convert remote files into v1 MiSTerScanEntry items');
assert.match(stickerBridge, /getActiveMisterProfile/, 'v1 library sync should hydrate from the Electron main active MiSTer profile');
assert.match(stickerBridge, /fingerprintSavedMisterProfile/, 'v1 library sync should reconnect read-only through safeStorage when the session id is missing');
assert.match(stickerBridge, /sessionId: session\.sessionId/, 'v1 library sync scan should return the resolved v2 read-only session id');
assert.match(stickerBridge, /setActiveMisterProfile/, 'v1 connection flow should publish successful connections as the v2 active profile');
assert.match(stickerBridge, /ZaparooApiClient/, 'card launch and NFC writing should use the fixed-method Zaparoo Core API bridge');
assert.match(stickerBridge, /runZapScript/, 'card launch should call the Zaparoo run bridge instead of raw SSH');
assert.doesNotMatch(stickerBridge, /raw.*command|command:raw/i, 'v1 bridge must not expose raw command execution');

assert.match(projectStore, /forceImportEntryIds/, 'manual game-list import should be able to force selected entries through default-excluded filters');
assert.match(zaparooLibrary, /forcedImportIds\.has\(entry\.id\)/, 'library merge should import explicitly selected entries even when their platform is disabled by default');
assert.match(platformNormalization, /\['neo geo', 'neogeo'\]/, 'platform normalization should treat Neo Geo variants as the same platform');
assert.match(platformNormalization, /\['_arcade', 'arcade'\]/, 'platform normalization should treat _Arcade and Arcade as the same platform');
assert.match(platformNormalization, /\['super nintendo', 'snes'\]/, 'platform normalization should treat Super Nintendo and SNES as the same platform');
assert.match(platformNormalization, /\['mega drive', 'genesis'\]/, 'platform normalization should treat Mega Drive and Genesis aliases as the same platform');
assert.match(platformNormalization, /\['tgfx16', 'pce'\]/, 'platform normalization should treat TGFX16 and PCE aliases as the same platform');
assert.match(misterFpgaPage, /getActiveMisterProfile/, 'library sync should hydrate active MiSTer from Electron main before scan');
assert.match(misterFpgaPage, /scanLibrary\(scanConfig, scanConnectionId\)/, 'library sync should pass the active profile session to read-only scan');
assert.match(misterFpgaPage, /setSelectedImportPlatformKeys\(\[\]\)/, 'new library sync scan sessions should start with every import platform unchecked');
assert.match(misterFpgaPage, /selectedImportPlatformSet\.has\(platformKey\)/, 'platform import checkboxes should use session selection state, not catalog default selection');
assert.match(misterFpgaPage, /existingPlatformIdentityKeys/, 'new platform discovery should compare scanned platforms against existing library platforms');
assert.match(misterFpgaPage, /platformIdentityKeys/, 'platform comparison should use normalized platform identity keys');
assert.match(misterFpgaPage, /안전을 위해 기본값은 모두 제외입니다/, 'import UI should explain that every platform is excluded by default');
assert.match(misterFpgaPage, /기존 게임 리스트에 없는 플랫폼만 표시합니다/, 'new platform UI should explain it excludes existing library platforms');
assert.match(misterFpgaPage, /새 플랫폼이 없습니다/, 'new platform UI should show a no-new-platforms empty state');
assert.doesNotMatch(misterFpgaPage, /return catalogItem\?\.defaultImportEnabled \?\? true/, 'platform import checkboxes must not default to catalog-enabled selections');
assert.match(misterFpgaPage, /MiSTer 연결이 필요합니다\. 먼저 MiSTer 연결 메뉴에서 연결하세요\./, 'library sync should show a user-facing connection-required message');
assert.doesNotMatch(misterFpgaPage, /Library Sync에는 활성 브리지 세션/, 'basic library sync failure should not mention an active bridge session');
assert.match(misterFpgaPage, /refreshMiSTerEntriesForDevice\(.*?{[\s\S]*?scanSource: 'bridge-scan'[\s\S]*?importAllowlistIds: scanPreviewEntries\.map/, 'manual import should pass selected entry ids into the merge step');
assert.match(misterFpgaPage, /NfcRouteState/, 'NFC management should accept route state from game/card actions');

assert.match(cardAlbumPage, /useActiveMisterProfile/, 'card album should use the shared v2 active MiSTer profile');
assert.match(cardAlbumPage, /activeMister\?\.sessionId/, 'card album launch should fall back to active MiSTer session when v1 store has not caught up');
assert.match(cardAlbumPage, /MiSTer 연결 메뉴에서 먼저 연결하세요/, 'card album should show a clear connection-required message');

assert.doesNotMatch(main, /ipcMain\.handle\('rom:(copy|transfer|mkdir|rename|overwrite|delete|upload)'/, 'ROM write IPC must remain absent');
assert.doesNotMatch(preload, /rom:(copy|transfer|mkdir|rename|overwrite|delete|upload)/, 'preload must not expose ROM write IPC');
assert.doesNotMatch(preload, /raw.*command|command:raw/i, 'raw command IPC must remain absent');
assert.doesNotMatch(main, /password.*writeJsonFile|privateKey.*writeJsonFile|passphrase.*writeJsonFile|token.*writeJsonFile/i, 'secrets must not be written to appData JSON in plaintext');

console.log('phase seventeen connection persistence and v1 bridge action tests passed.');
