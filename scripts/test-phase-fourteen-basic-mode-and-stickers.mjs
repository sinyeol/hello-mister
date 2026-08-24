import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const packageJson = JSON.parse(read('package.json'));
const mainEntry = read('src/main.tsx');
const layout = read('src/components/layout/AppLayout.tsx');
const viewMode = read('src/services/app/viewMode.ts');
const stickerPage = read('src/pages/StickerStudioPage.tsx');
const stickerApp = read('src/features/sticker-v1/app/App.tsx');
const stickerBridge = read('src/features/sticker-v1/services/mister/misterBridge.ts');
const settingsPage = read('src/pages/SettingsPage.tsx');
const connectionPage = read('src/pages/MisterConnectionPage.tsx');
const profileStore = read('src/services/mister/profileStore.ts');
const main = read('electron/main.mjs');
const preload = read('electron/preload.mjs');
const desktopTypes = read('src/types/desktop.ts');

assert.equal(packageJson.scripts['test:phase-fourteen'], 'node scripts/test-phase-fourteen-basic-mode-and-stickers.mjs', 'phase fourteen test script should exist');
assert.ok(packageJson.scripts.test.includes('test:phase-fourteen'), 'main test script should include phase fourteen');

assert.match(viewMode, /type AppMode = 'basic' \| 'advanced'/, 'app should use two mode structure');
assert.match(viewMode, /if \(value === 'developer'\) return 'advanced'/, 'stored developer mode should migrate to advanced');
assert.match(viewMode, /return 'basic'/, 'unknown mode should fall back to basic');

assert.match(layout, /const sidebarGroups(?:: SidebarGroup\[\])? = \[/, 'v2 sidebar should define grouped parent menus');
assert.match(layout, /id: 'mister'[\s\S]*id: 'stickers'[\s\S]*id: 'settings'/, 'top-level menu order should be MiSTer FPGA, sticker production, settings');
assert.match(layout, /label: 'MiSTer FPGA'/, 'sidebar should include MiSTer FPGA parent');
assert.match(layout, /label: '스티커 제작'/, 'sidebar should include sticker production parent');
assert.match(layout, /label: '설정'/, 'sidebar should include settings parent');
assert.match(layout, /SIDEBAR_GROUP_STORAGE_KEYS/, 'sidebar group expanded state should be persisted');
assert.match(layout, /mister: false, stickers: false, settings: false/, 'sidebar parent menus should default to collapsed');
for (const route of [
  '/stickers/mister',
  '/stickers/templates',
  '/stickers/editor',
  '/stickers/images',
  '/stickers/album',
  '/stickers/output',
  '/stickers/template-editor',
  '/stickers/nfc',
]) {
  assert.match(layout, new RegExp(`to: '${route.replaceAll('/', '\\/')}'`), `${route} should be exposed in v2 sidebar`);
}
assert.doesNotMatch(layout, /to: '\/stickers\/project-games'/, 'project games should not be exposed in the v2 sticker sidebar');
for (const route of [
  '/mister',
  '/games',
  '/sd-card',
  '/ini',
  '/scripts',
  '/controller-setup',
]) {
  assert.match(layout, new RegExp(`to: '${route.replaceAll('/', '\\/')}'`), `${route} should be exposed under MiSTer FPGA`);
}
assert.match(layout, /label: '게임 목록'/, 'MiSTer library should be exposed as a game list menu');
assert.match(layout, /label: '카드편집'/, 'working card sidebar label should be simplified to card edit');
assert.doesNotMatch(layout, /label: '작업 카드'/, 'old working card sidebar label should be removed');
assert.doesNotMatch(layout, /스티커 홈/, 'sticker home submenu should be removed');
assert.doesNotMatch(layout, /if \(stickerRoute\)\s*\{\s*return <Outlet \/>;\s*\}/, 'v2 shell must not disappear on /stickers routes');
assert.match(layout, /<main className=\{`content/, 'v2 content area should remain the route host');
assert.match(layout, /<Outlet \/>/, 'v2 AppLayout should continue to render nested route content');
assert.match(layout, /label: 'MiSTer 게임 롬 관리'/, 'game menu should use the current ROM management label');
assert.doesNotMatch(layout, /label: '홈'/, 'home menu should be removed');
assert.doesNotMatch(layout, /label: '동기화'/, 'sync menu should be removed');
assert.match(layout, /minimumMode: 'basic'/, 'basic nav items should be marked');
assert.match(layout, /minimumMode: 'advanced'/, 'advanced nav items should be marked');
assert.doesNotMatch(layout, /minimumMode: 'developer'|\/developer|개발자 도구/, 'developer nav items should be removed');
assert.match(layout, /modeMeets\(viewMode, item\.minimumMode\)/, 'nav filtering should use mode hierarchy');
assert.match(layout, /nav-toggle/, 'sticker parent should be an expandable toggle');
assert.match(layout, /toggleGroup\(group\.id\)/, 'parent menu click should expand and collapse without navigation');
assert.match(layout, /isRouteInGroup\(location\.pathname, group\)/, 'active child routes should activate their parent group');
assert.match(layout, /setExpandedGroups/, 'active child routes should be able to auto-expand their parent group');

assert.match(mainEntry, /path="\/stickers\/\*"/, 'v1 sticker routes should be mounted at /stickers/*');
assert.match(mainEntry, /path="\/" element=\{<Navigate to="\/stickers\/mister" replace \/>\}/, 'app should start on the MiSTer game list instead of Home');
assert.match(mainEntry, /path="\/mister" element=\{<MisterConnectionPage \/>\}/, 'MiSTer connection should be available at /mister');
assert.match(mainEntry, /path="\/connection" element=\{<Navigate to="\/mister" replace \/>\}/, 'legacy /connection route should redirect to /mister');
assert.doesNotMatch(mainEntry, /SyncPage|path="\/sync"/, 'sync route should be removed');
assert.match(stickerPage, /StickerV1ContentHost/, 'sticker route should use the v1 content host');
assert.match(stickerPage, /StickerV1Routes/, 'sticker route should render v1 feature routes in the v2 content area');
assert.doesNotMatch(stickerPage, /StickerV1App/, 'sticker route must not mount the full v1 app shell');
assert.match(stickerApp, /export function StickerV1ContentHost/, 'v1 app should export a content-only host');
assert.match(stickerApp, /export function StickerV1Routes/, 'v1 app should export reusable v1 feature routes');
assert.match(stickerApp, /<Route index element=\{<Navigate to="\/stickers\/mister" replace \/>\}/, 'v1 index route should open the MiSTer game list');
assert.match(stickerApp, /path="images" element=\{lazyRoute\(<AssetLoadingPage \/>\)\}/, 'v1 image page should be reachable below /stickers');
assert.match(stickerApp, /path="mister" element=\{lazyRoute\(<MisterFpgaPage \/>\)\}/, 'v1 MiSTer game list page should be reachable below /stickers');
assert.match(stickerApp, /path="nfc" element=\{lazyRoute\(<MisterFpgaPage \/>\)\}/, 'NFC submenu should route to the v1 MiSTer/NFC page');
assert.match(stickerApp, /path="project-games" element=\{<Navigate to="\/stickers\/mister" replace \/>\}/, 'legacy project games route should redirect to the MiSTer game list');
assert.match(stickerApp, /path="cards" element=\{<Navigate to="\/stickers\/editor" replace \/>\}/, 'cards alias should redirect to the v1 working card editor');
assert.match(stickerApp, /path="editor" element=\{lazyRoute\(<CardEditorPage \/>\)\}/, 'v1 working card editor should be reachable below /stickers');
assert.match(stickerApp, /path="templates"[\s\S]*TemplateManagementPage/, 'v1 template page should be reachable below /stickers');
assert.match(stickerApp, /export function StickerV1ContentHost\(\{ children \}: \{ children: ReactElement \}\)[\s\S]*\{children\}/, 'v1 shell should support content-only embedding without owning the outer app');
assert.doesNotMatch(stickerApp, /<Outlet/, 'v1 shell must not own an outer route outlet in the v2 content host');

assert.match(stickerBridge, /helloMisterDesktopApi/, 'v1 MiSTer bridge should integrate with the v2 desktop read-only IPC');
assert.match(stickerBridge, /fingerprintMister/, 'v1 MiSTer connection should use the v2 read-only fingerprint adapter in Electron');
assert.match(stickerBridge, /inspectSshHostKey/, 'v1 MiSTer connection should use v2 host key checks');
assert.match(stickerBridge, /trustSshHostKey/, 'v1 MiSTer connection should allow simple first-use trust registration');
assert.match(stickerBridge, /listRemoteGames/, 'v1 game list sync should use v2 read-only remote game listing when available');
assert.match(stickerBridge, /안전 정책상/, 'dangerous v1 bridge actions should return a v2 safety lock message');

assert.match(settingsPage, /기본 모드/, 'settings should expose basic mode');
assert.match(settingsPage, /고급 모드/, 'settings should expose advanced mode');
assert.doesNotMatch(settingsPage, /개발자 모드|개발자 도구|Developer Mode/, 'settings should not expose developer mode');

assert.match(connectionPage, /MiSTer IP/, 'basic MiSTer connection should use direct IP input');
assert.match(connectionPage, /defaultUsername = 'root'/, 'default username should be root');
assert.match(connectionPage, /defaultMisterPassword = '1'/, 'default MiSTer password input value should be 1');
assert.match(connectionPage, /autoConnect: false/, 'saved direct IP profiles should persist autoConnect disabled');
assert.doesNotMatch(connectionPage, /if \(autoConnect\).*connectProfile/s, 'saving a profile must not trigger automatic connection');
assert.doesNotMatch(connectionPage, /defaultProfile\?\.autoConnect/, 'app start should not auto-connect saved profiles');
assert.match(connectionPage, /> 연결</, 'manual connection should be the explicit read-only connection action');
assert.match(connectionPage, /setDeleteTarget/, 'saved profiles should expose delete flow');
assert.match(connectionPage, /deleteKnownHost/, 'profile deletion should offer optional SSH known host removal');
assert.match(connectionPage, /saveProfilePassword/, 'saved profile password should go through safe storage');
assert.match(profileStore, /deleteProfile/, 'profile store should support profile deletion');
assert.match(desktopTypes, /deleteMisterProfile/, 'desktop API should expose safe profile deletion');
assert.match(desktopTypes, /saveMisterProfilePassword/, 'desktop API should expose encrypted password saving');
assert.match(preload, /mister:profiles:delete/, 'preload should expose profile deletion IPC');
assert.match(main, /mister:profiles:delete/, 'main should implement profile deletion IPC');
assert.match(main, /safeStorage/, 'main should use Electron safeStorage for saved passwords');

assert.doesNotMatch(stickerPage + mainEntry + layout, /zaparoo-nfc-card-stickers(?:\\\\|\/)/, 'v2 sticker feature must not depend on the v1 folder path');
assert.doesNotMatch(main, /ipcMain\.handle\('rom:(copy|transfer|mkdir|rename|overwrite|upload|delete)/i, 'main must not expose ROM write IPC');
assert.doesNotMatch(preload, /ipcRenderer\.invoke\('rom:(copy|transfer|mkdir|rename|overwrite|upload|delete)/i, 'preload must not expose ROM write IPC');
assert.doesNotMatch(preload, /rawCommand|execCommand|runCommand/i, 'preload must not expose raw command IPC');

console.log('phase fourteen basic mode and v1 sticker sidebar integration tests passed');
