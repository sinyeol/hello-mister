import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const readiness = read('src/services/zaparoo/zaparooNfcReadiness.ts');
const misterPage = read('src/features/sticker-v1/pages/MisterFpgaPage.tsx');
const cardAlbum = read('src/features/sticker-v1/pages/CardAlbumPage.tsx');
const bridge = read('src/features/sticker-v1/services/mister/misterBridge.ts');
const main = read('electron/main.mjs');
const preload = read('electron/preload.mjs');

assert.match(readiness, /ACTIVE_MISTER_REQUIRED/, 'NFC readiness should distinguish missing active MiSTer');
assert.match(readiness, /ZAPAROO_API_DISCONNECTED/, 'NFC readiness should distinguish disconnected Zaparoo API');
assert.match(readiness, /NFC_READER_MISSING/, 'NFC readiness should distinguish missing NFC reader');
assert.match(readiness, /PAYLOAD_INVALID/, 'NFC readiness should distinguish invalid payload');
assert.match(readiness, /READY/, 'NFC readiness should expose ready state');
assert.match(readiness, /NFC 리더 연결됨/, 'ready formatter should show reader connection message');
assert.match(readiness, /MiSTer 연결 메뉴에서 먼저 연결하세요/, 'missing active profile formatter should guide to MiSTer connection');
assert.match(readiness, /Zaparoo API에 연결되지 않았습니다/, 'API disconnected formatter should mention Zaparoo API');
assert.match(readiness, /NFC 리더가 연결되지 않았습니다/, 'reader missing formatter should mention NFC reader');
assert.match(readiness, /NFC에 쓸 실행 경로가 올바르지 않습니다/, 'invalid payload formatter should mention launch path');

assert.match(misterPage, /useActiveMisterProfile/, 'NFC screen should use shared active MiSTer profile');
assert.match(misterPage, /nfcRouteActiveMister/, 'NFC route should retain active MiSTer snapshot from game/card navigation');
assert.match(misterPage, /effectiveActiveMister/, 'NFC screen should use effective active MiSTer from renderer or route state');
assert.match(misterPage, /getZaparooNfcWriteReadiness/, 'NFC screen should use readiness rules for write enablement');
assert.match(misterPage, /\w*Status\?\.ok/, 'NFC write readiness should depend on Zaparoo API status');
assert.match(misterPage, /\w*Status\?\.readers\?\.length/, 'NFC write readiness should depend on reader count');
assert.match(misterPage, /disabled=\{!nfcWriteReadiness\.canWrite\}/, 'tag write button should be enabled by readiness state');
assert.match(misterPage, /Zaparoo readers/, 'NFC screen should show Zaparoo reader status');
assert.match(misterPage, /NFC 리더 상태/, 'NFC screen should focus the status panel on reader connection state');
assert.match(misterPage, /게임이 선택되면 NFC에 쓸 실행 텍스트를 자동으로 준비합니다/, 'NFC screen should explain automatic launch text generation');
assert.match(misterPage, /manualLaunchText \|\| launchPreview\?\.text/, 'NFC screen should show generated launch text by default when a game is selected');
assert.doesNotMatch(misterPage, new RegExp(`실행 텍스트 ${'생성'}`), 'NFC screen should not show a manual launch text generation button');
assert.doesNotMatch(misterPage, new RegExp(`NFC Payload ${'Preview'}`), 'NFC screen should not show a payload preview panel');
assert.doesNotMatch(misterPage, new RegExp(`선택 ${'이유'}:`), 'NFC screen should not show internal path selection reasoning');
assert.doesNotMatch(misterPage, new RegExp(`NTAG215 payload ${'준비됨'}`), 'NFC screen should not show payload-prepared status as reader state');
assert.doesNotMatch(misterPage, new RegExp(['태그 읽기 가능: ', 'payload', '가 ', '없어도'].join('')), 'NFC screen should not show payload-specific read readiness copy');
assert.doesNotMatch(misterPage, /활성 MiSTer 연결 세션이 없습니다\. 먼저 MiSTer에 연결하세요\./, 'NFC write should not show stale SSH-session-only error');

assert.match(cardAlbum, /new HttpMiSTerBridgeClient\(\)\.writeTag/, 'card album NFC action should write directly through the safe bridge');
assert.match(cardAlbum, /NFC 쓰기 완료\. 태그에 실행 데이터가 기록되었습니다\./, 'card album should show direct NFC write success');
assert.doesNotMatch(cardAlbum, /navigate\('\/stickers\/nfc'/, 'card album NFC action should no longer navigate to NFC management');
assert.match(bridge, /client\.listReaders/, 'NFC bridge should check readers through Zaparoo API');
assert.match(bridge, /client\.writeReader/, 'NFC bridge should write through readers.write');
assert.doesNotMatch(bridge, /if \(!connectionId\) \{\s*const message = 'MiSTer 연결이 필요합니다/, 'Zaparoo NFC write must not require SSH session id alone');

assert.doesNotMatch(main, /ipcMain\.handle\('rom:(copy|transfer|mkdir|rename|overwrite|delete|upload)'/, 'ROM write IPC must remain absent');
assert.doesNotMatch(preload, /rom:(copy|transfer|mkdir|rename|overwrite|delete|upload)/, 'preload must not expose ROM write IPC');
assert.doesNotMatch(preload, /raw.*command|command:raw/i, 'raw command IPC must remain absent');
assert.doesNotMatch(main, /password.*writeJsonFile|privateKey.*writeJsonFile|passphrase.*writeJsonFile|token.*writeJsonFile/i, 'secrets must not be written to appData JSON in plaintext');

console.log('phase twenty-one NFC readiness tests passed.');
