import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const connectionPage = read('src/pages/MisterConnectionPage.tsx');
const activeBanner = read('src/components/mister/ActiveMisterBanner.tsx');
const activeProfile = read('src/services/mister/activeProfile.ts');
const profileStore = read('src/services/mister/profileStore.ts');
const desktopTypes = read('src/types/desktop.ts');
const misterTypes = read('src/types/mister.ts');
const main = read('electron/main.mjs');
const preload = read('electron/preload.mjs');
const gamePage = read('src/pages/GameManagementPage.tsx');
const iniPage = read('src/pages/IniSettingsPage.tsx');
const scriptPage = read('src/pages/ScriptManagementPage.tsx');
const controllerPage = read('src/pages/ControllerManagementPage.tsx');
const stickerMisterPage = read('src/features/sticker-v1/pages/MisterFpgaPage.tsx');

assert.match(connectionPage, /defaultMisterPassword = '1'/, 'password input default should stay 1');
assert.match(connectionPage, /saveProfilePassword/, 'profile password should be saved through safe storage adapter');
assert.match(connectionPage, /fingerprintSavedProfile/, 'saved profiles should connect through stored encrypted password flow');
assert.match(connectionPage, /setActiveMisterProfile/, 'successful connection should update activeMisterProfile');
assert.match(connectionPage, /clearActiveMisterProfile\(profileId\)/, 'failed or blocked connection should clear matching active profile');
assert.match(connectionPage, /clearActiveMisterProfile\(target\.id\)/, 'profile delete should clear active profile');
assert.match(connectionPage, /연결은 사용자가 버튼을 눌렀을 때만 확인합니다/, 'saving should keep connection manual');
assert.match(connectionPage, /MiSTer 연결됨/, 'successful connection status should use generic MiSTer connected wording');
assert.doesNotMatch(connectionPage, /읽기 전용 연결|읽기 전용 확인|세션 인증|session-only|연결 테스트/, 'connection page should avoid stale read-only/session/test wording');
assert.match(activeBanner, /MiSTer 연결됨/, 'shared active MiSTer banner should use generic connected wording');
assert.doesNotMatch(activeBanner, /읽기 전용 연결|읽기 전용 확인|session-only|세션 인증/, 'shared active MiSTer banner should not show stale read-only/session wording');

assert.match(activeProfile, /ActiveMisterProfile/, 'active profile service should exist');
assert.match(activeProfile, /sessionId/, 'active profile should carry the read-only session id');
assert.doesNotMatch(activeProfile, /password|privateKey|passphrase|token/i, 'active profile must not store credentials');

assert.match(misterTypes, /interface ActiveMisterProfile/, 'active profile type should be declared');
assert.match(profileStore, /autoConnect: false/, 'profile store should force autoConnect false');
assert.match(profileStore, /saveMisterProfilePassword/, 'profile store should use desktop safe storage for password saving');
assert.match(desktopTypes, /saveMisterProfilePassword/, 'desktop bridge should expose safe password save');
assert.match(desktopTypes, /fingerprintSavedMisterProfile/, 'desktop bridge should expose saved-profile fingerprint');

assert.match(main, /safeStorage\.encryptString/, 'main should encrypt stored passwords');
assert.match(main, /cipherText/, 'credential store should persist cipherText, not plain password');
assert.match(main, /deleteProfilePassword\(profileId\)/, 'profile delete should remove encrypted password');
assert.doesNotMatch(main, /ipcMain\.handle\('rom:(copy|transfer|mkdir|rename|overwrite|delete|upload)'/, 'ROM write IPC must remain absent');
assert.doesNotMatch(preload, /rom:(copy|transfer|mkdir|rename|overwrite|delete|upload)/, 'preload must not expose ROM write IPC');
assert.doesNotMatch(preload, /raw.*command|command:raw/i, 'raw command IPC must remain absent');

assert.match(gamePage, /RomFileExplorerPanel/, 'ROM management should mount the shared active MiSTer ROM explorer');
assert.doesNotMatch(gamePage, /ActiveMisterBanner/, 'ROM management should not show the generic read-only active MiSTer banner');
assert.match(gamePage, /PC에서 추가할 ROM 선택/, 'ROM add flow should use user-friendly PC ROM wording');
assert.match(gamePage, /MiSTer 대상 폴더/, 'remote games wording should be MiSTer target folder');
assert.match(gamePage, /복사 전 확인/, 'user-facing ROM check flow should say copy-before-check');
assert.match(gamePage, /실제 복사 실행[\s\S]*disabled/, 'actual copy button should remain disabled');
assert.match(gamePage, /ROM 삭제 잠김/, 'ROM delete tab should remain locked');
assert.match(gamePage, /MiSTer 간 복사 잠김/, 'MiSTer-to-MiSTer copy tab should remain locked');

for (const [label, source] of [
  ['INI settings', iniPage],
  ['Script management', scriptPage],
  ['Controller management', controllerPage],
]) {
  assert.match(source, /ActiveMisterBanner/, `${label} should use shared active MiSTer banner`);
}

assert.match(stickerMisterPage, /useActiveMisterProfile/, 'v1 MiSTer game list should read the shared active profile');
assert.match(stickerMisterPage, /activeMisterIp/, 'v1 MiSTer game list should apply the active profile IP');

console.log('phase sixteen manual MiSTer connection and ROM management flow tests passed.');
