import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const main = read('electron/main.mjs');
const preload = read('electron/preload.mjs');
const desktopTypes = read('src/types/desktop.ts');
const zaparooTypes = read('src/types/zaparoo.ts');
const zaparooClient = read('src/services/zaparoo/zaparooApiClient.ts');
const zaparooLaunch = read('src/services/zaparoo/zaparooLaunchService.ts');
const zaparooMedia = read('src/services/zaparoo/zaparooMediaService.ts');
const stickerBridge = read('src/features/sticker-v1/services/mister/misterBridge.ts');
const misterFpgaPage = read('src/features/sticker-v1/pages/MisterFpgaPage.tsx');
const cardAlbumPage = read('src/features/sticker-v1/pages/CardAlbumPage.tsx');

assert.match(zaparooTypes, /ZaparooApiTarget/, 'Zaparoo API target type should exist');
assert.match(zaparooTypes, /ZaparooRunResult/, 'Zaparoo run result type should exist');
assert.match(zaparooTypes, /ZaparooReaderWriteResult/, 'Zaparoo readers.write result type should exist');

assert.match(zaparooClient, /jsonrpc: '2\.0'/, 'Zaparoo client should format JSON-RPC 2.0 requests');
assert.match(zaparooClient, /zaparooDefaultPort = 7497/, 'Zaparoo client should default to port 7497');
assert.match(zaparooClient, /zaparooDefaultEndpoint = '\/api\/v0\.1'/, 'Zaparoo client should use /api/v0.1');
assert.match(zaparooClient, /\/run\/\$\{encodeURIComponent\(zapScript\)\}/, 'Zaparoo /run/ fallback URL should encode ZapScript');
assert.match(zaparooClient, /zaparooRun/, 'desktop client should expose fixed run API');
assert.match(zaparooClient, /zaparooWriteReader/, 'desktop client should expose fixed readers.write API');
assert.match(zaparooLaunch, /launchWithZaparooCore/, 'launch service should wrap Zaparoo Core launch');
assert.match(zaparooMedia, /searchZaparooMediaForTitle/, 'media service should support media.search lookup by title');

assert.match(main, /zaparooDefaultPort = 7497/, 'Electron main should know Zaparoo port');
assert.match(main, /zaparooDefaultEndpoint = '\/api\/v0\.1'/, 'Electron main should know Zaparoo endpoint');
assert.match(main, /method: 'POST'/, 'Electron main should call JSON-RPC over HTTP POST');
assert.match(main, /media\.search/, 'Electron main should expose media.search');
assert.match(main, /media\.browse/, 'Electron main should expose media.browse');
assert.match(main, /media\.lookup/, 'Electron main should expose media.lookup');
assert.match(main, /readers\.write/, 'Electron main should expose readers.write');
assert.match(main, /ipcMain\.handle\('zaparoo:run'/, 'Electron main should expose fixed Zaparoo run IPC');
assert.match(main, /ipcMain\.handle\('zaparoo:readers-write'/, 'Electron main should expose fixed NFC write IPC');
assert.doesNotMatch(main, /ipcMain\.handle\('zaparoo:rpc'/, 'Electron main must not expose arbitrary Zaparoo RPC IPC');

assert.match(preload, /zaparooGetStatus/, 'preload should expose Zaparoo status API');
assert.match(preload, /zaparooSearchMedia/, 'preload should expose Zaparoo media search API');
assert.match(preload, /zaparooRun/, 'preload should expose Zaparoo run API');
assert.match(preload, /zaparooWriteReader/, 'preload should expose Zaparoo NFC write API');
assert.match(desktopTypes, /zaparooRun/, 'desktop types should include Zaparoo run API');
assert.match(desktopTypes, /zaparooWriteReader/, 'desktop types should include Zaparoo readers.write API');

assert.match(stickerBridge, /new ZaparooApiClient\(\)\.runZapScript/, 'v1 launch bridge should call Zaparoo run');
assert.match(stickerBridge, /client\.listReaders/, 'v1 NFC bridge should check reader list before writing');
assert.match(stickerBridge, /client\.writeReader/, 'v1 NFC bridge should call readers.write');
assert.doesNotMatch(stickerBridge, /raw.*command|command:raw/i, 'v1 bridge must not expose raw command execution');

assert.match(misterFpgaPage, /Zaparoo Core API/, 'MiSTer game list should show Zaparoo status');
assert.match(misterFpgaPage, /launchLibraryEntry/, 'game list should use the shared launch handler');
assert.match(misterFpgaPage, /sendEntryToNfc/, 'game list should route selected game to NFC management');
assert.match(misterFpgaPage, /searchMediaForEntry/, 'game list should connect media.search to entries');
assert.match(cardAlbumPage, /new HttpMiSTerBridgeClient\(\)\.writeTag/, 'card album NFC button should write directly through the safe Zaparoo bridge');
assert.match(cardAlbumPage, /addMiSTerTagJob/, 'card album NFC write should record the tag write job');
assert.match(cardAlbumPage, /NFC 태그에 바로 쓰기/, 'card album NFC button should communicate direct tag writing');
assert.doesNotMatch(cardAlbumPage, /navigate\('\/stickers\/nfc'/, 'card album NFC button should not route to NFC management');

assert.match(cardAlbumPage, /const updateIndexItem = useCallback/, 'card album index updates should use a stable callback');
assert.match(cardAlbumPage, /hasPatchChange/, 'card album index updates should skip no-op thumbnail patches');
assert.doesNotMatch(cardAlbumPage, /\[generateThumbnail, item, onThumbnailLoaded, onThumbnailStatusChange\]/, 'thumbnail loader must not reload on every parent render through the whole item object');
assert.match(cardAlbumPage, /thumbnailCacheKey,[\s\S]*thumbnailStaleCacheKey,[\s\S]*thumbnailStatus/, 'thumbnail loader should depend on stable thumbnail cache fields');

assert.doesNotMatch(main, /ipcMain\.handle\('rom:(copy|transfer|mkdir|rename|overwrite|delete|upload)'/, 'ROM write IPC must remain absent');
assert.doesNotMatch(preload, /rom:(copy|transfer|mkdir|rename|overwrite|delete|upload)/, 'preload must not expose ROM write IPC');
assert.doesNotMatch(preload, /raw.*command|command:raw/i, 'raw command IPC must remain absent');
assert.doesNotMatch(main, /password.*writeJsonFile|privateKey.*writeJsonFile|passphrase.*writeJsonFile|token.*writeJsonFile/i, 'secrets must not be written to appData JSON in plaintext');

console.log('phase eighteen Zaparoo Core launch and NFC workflow tests passed.');
