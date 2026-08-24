import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const packageJson = JSON.parse(read('package.json'));
const viteConfig = read('vite.config.ts');
const main = read('electron/main.mjs');
const preload = read('electron/preload.mjs');
const desktopTypes = read('src/types/desktop.ts');
const settingsPage = read('src/pages/SettingsPage.tsx');
const homePage = read('src/pages/HomePage.tsx');
const backupPage = read('src/pages/BackupDiagnosticsPage.tsx');
const gamePage = read('src/pages/GameManagementPage.tsx');
const reviewService = read('src/services/review/reviewChecklistService.ts');
const runtimeService = read('src/services/app/runtimeEnvironment.ts');
const appDataService = read('src/services/app/appDataStorage.ts');
const rendererEntry = read('src/main.tsx');

assert.equal(packageJson.name, 'hello-mister-v2', 'package name should remain the v2 project');
assert.match(packageJson.version, /^\d+\.\d+\.\d+$/, 'package version should be a semver string');
assert.match(packageJson.description, /Hello Mister v2\.\d/, 'package metadata should use a Hello Mister v2.x name');
assert.ok(packageJson.scripts['desktop:review'], 'desktop review script should exist');
assert.ok(packageJson.scripts['package:review'], 'package review script should exist');
assert.ok(packageJson.scripts['smoke:electron'], 'electron smoke script should exist');
assert.ok(packageJson.scripts.test.includes('test:phase-twelve'), 'main test script should include phase twelve');
assert.match(viteConfig, /base:\s*['"]\.\/['"]/, 'Vite build must use relative asset paths for file:// Electron review builds');

assert.match(desktopTypes, /DesktopRuntimeEnvironment/, 'desktop runtime type should exist');
assert.match(desktopTypes, /AppDataStorageStatus/, 'appData storage type should exist');
assert.match(preload, /getRuntimeEnvironment/, 'preload should expose runtime environment read API');
assert.match(preload, /getAppDataStorageStatus/, 'preload should expose appData read API');
assert.match(preload, /openAppDataFolder/, 'preload should expose safe appData folder open API');
assert.match(main, /app:runtime-environment/, 'main should expose runtime environment IPC');
assert.match(main, /app:data-status/, 'main should expose appData status IPC');
assert.match(main, /app:open-data-folder/, 'main should expose appData folder open IPC');
assert.match(main, /shell\.openPath/, 'appData folder open should use Electron shell.openPath');

assert.match(runtimeService, /browser-fallback/, 'runtime formatter should support browser fallback mode');
assert.match(runtimeService, /ROM 전송 잠금/, 'runtime formatter should show transfer lock state');
assert.match(appDataService, /secret 없음/, 'appData status formatter should mention secret-free state');
assert.match(appDataService, /브라우저 fallback/, 'appData status formatter should handle browser fallback');

assert.match(homePage, /검토 모드/, 'home page should show review mode section');
assert.match(homePage, /실제 ROM transfer locked/, 'home page should show locked ROM transfer state');
assert.match(settingsPage, /실행 상태/, 'settings page should show runtime status');
assert.match(settingsPage, /안전 잠금/, 'settings page should show the safety-lock summary');
assert.match(settingsPage, /raw command IPC 없음/, 'settings page should state that raw command IPC is absent');
assert.doesNotMatch(main, /ipcMain\.handle\(['"]app:(delete|clear|reset)/i, 'appData delete/clear/reset IPC must not exist');
assert.match(backupPage, /실제 MiSTer read-only 검토 체크리스트/, 'backup diagnostics should include read-only checklist');
assert.match(gamePage, /ROM dry-run 실사용 검토 체크리스트/, 'game page should include ROM dry-run checklist');
assert.match(reviewService, /password\/privateKey\/passphrase\/token\/raw command는 포함하지 않습니다/, 'review exports should state secret exclusion');
assert.match(reviewService, /실제 전송 검토 가능/, 'ROM review checklist should support review grade labels');
assert.match(rendererEntry, /화면을 불러오지 못했습니다/, 'renderer entry should show a recoverable Korean bootstrap error');

const visibleBrandingSource = [
  read('package.json'),
  homePage,
  backupPage,
  gamePage,
].join('\n');
assert.doesNotMatch(visibleBrandingSource, /ZAPAROO|Zaparoo|자파루/, 'visible v2 branding should not contain old app names');
// The settings page carries the legal notice (non-affiliation + third-party GPL credits), which necessarily
// REFERS to Zaparoo/trademark owners. Referential use is allowed; the old app branding is still forbidden.
assert.doesNotMatch(settingsPage, /자파루|ZAPAROO 매니저|Zaparoo Manager|ZAPAROO-Manager/i, 'settings must not contain the old app names');
assert.match(settingsPage, /제휴·후원·승인 관계가 없습니다/, 'settings should carry the non-affiliation disclaimer');
assert.match(settingsPage, /Wizzo Pty Ltd/, 'settings should attribute the Zaparoo trademark to its owner');
assert.match(settingsPage, /번들하지 않으며/, 'settings should state third-party GPL software is downloaded, not bundled');

assert.doesNotMatch(main, /ipcMain\.handle\('rom:(copy|transfer|mkdir|rename|overwrite|upload|delete)/i, 'main must not expose ROM write IPC');
assert.doesNotMatch(preload, /ipcRenderer\.invoke\('rom:(copy|transfer|mkdir|rename|overwrite|upload|delete)/i, 'preload must not expose ROM write IPC');
assert.doesNotMatch(preload, /rawCommand|execCommand|runCommand/i, 'preload must not expose raw command IPC');

console.log('phase twelve desktop review checks passed');
