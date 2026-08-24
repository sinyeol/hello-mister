import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const packageJson = JSON.parse(read('package.json'));
const viewMode = read('src/services/app/viewMode.ts');
const uiText = read('src/services/app/uiText.ts');
const advancedSection = read('src/components/common/AdvancedSection.tsx');
const layout = read('src/components/layout/AppLayout.tsx');
const styles = read('src/styles.css');
const mainEntry = read('src/main.tsx');
const connectionPage = read('src/pages/MisterConnectionPage.tsx');
const gamePage = read('src/pages/GameManagementPage.tsx');
const settingsPage = read('src/pages/SettingsPage.tsx');
const main = read('electron/main.mjs');
const preload = read('electron/preload.mjs');

assert.equal(packageJson.scripts['test:phase-thirteen'], 'node scripts/test-phase-thirteen-ui-simplification.mjs', 'phase thirteen test script should exist');
assert.ok(packageJson.scripts.test.includes('test:phase-thirteen'), 'main test script should include phase thirteen');

assert.match(viewMode, /export type AppMode = 'basic' \| 'advanced';/, 'app mode type should support only basic and advanced');
assert.match(viewMode, /if \(value === 'developer'\) return 'advanced'/, 'stored developer mode should migrate to advanced');
assert.match(viewMode, /if \(value === 'simple'\) return 'basic'/, 'legacy simple mode should migrate to basic');
assert.match(viewMode, /return 'basic'/, 'unknown app mode should normalize to basic');
assert.match(viewMode, /hello-mister-v2-view-mode/, 'view mode should persist in localStorage');

assert.match(layout, /기본/, 'layout should expose basic mode toggle');
assert.match(layout, /고급/, 'layout should expose advanced mode toggle');
assert.doesNotMatch(layout, /개발자|Developer|\/developer/, 'layout should not expose developer mode or developer tools');
assert.match(layout, /mode-\$\{viewMode\}/, 'layout should expose mode class for density rules');
assert.match(layout, /id: 'mister'[\s\S]*id: 'stickers'[\s\S]*id: 'settings'/, 'sidebar should keep MiSTer FPGA, sticker production, settings as the only top-level groups');
assert.match(layout, /label: 'MiSTer FPGA'/, 'layout should expose MiSTer FPGA as a parent menu');
assert.match(layout, /label: '스티커 제작'/, 'layout should keep sticker creation as a parent menu');
assert.match(layout, /label: '설정'/, 'layout should expose settings as a parent menu');
assert.match(layout, /label: 'MiSTer 게임 롬 관리'/, 'basic mode should use the ROM management label');
assert.doesNotMatch(layout, /label: '홈'/, 'home menu should be removed from the sidebar');
assert.doesNotMatch(layout, /label: '동기화'/, 'sync menu should be removed from the sidebar');
assert.match(layout, /nav-toggle/, 'parent menus should be toggle buttons');
assert.match(layout, /mister: false, stickers: false, settings: false/, 'parent menus should default to collapsed');
assert.match(layout, /SIDEBAR_GROUP_STORAGE_KEYS/, 'expanded state should be persisted per parent group');
assert.match(layout, /toggleGroup\(group\.id\)/, 'parent menu click should expand and collapse without navigation');
assert.match(layout, /isRouteInGroup\(location\.pathname, group\)/, 'active routes should mark their parent group active');
assert.doesNotMatch(layout, /<NavLink to=\{item\.to\} className=\{\(\) => `nav-item \$\{stickerRoute/, 'sticker parent should not navigate when clicked');
assert.match(mainEntry, /<Navigate to="\/stickers\/mister" replace \/>/, 'root route should open the MiSTer game list screen');
assert.match(mainEntry, /path="\/mister" element=\{<MisterConnectionPage \/>\}/, 'MiSTer connection route should be /mister');
assert.match(mainEntry, /path="\/connection" element=\{<Navigate to="\/mister" replace \/>\}/, 'legacy /connection should redirect without staying in the sidebar');
assert.match(styles, /\.mode-basic \.route-games/, 'basic mode should reduce Game page density');
assert.match(styles, /\.mode-basic \.route-backup/, 'basic mode should reduce Backup/Diagnostics density');
assert.match(styles, /\.mode-basic \.route-connection/, 'basic mode should reduce MiSTer connection density');
assert.match(styles, /\.mode-advanced \.route-games/, 'advanced mode should keep heavy game details organized');
assert.doesNotMatch(styles, /\.mode-(basic|advanced) \.route-connection > \.section-card:last-of-type/, 'basic/advanced connection pages must not hide the saved MiSTer list as the last card');

assert.match(advancedSection, /minimumMode = 'advanced'/, 'advanced sections should default to advanced mode');
assert.doesNotMatch(advancedSection, /minimumMode === 'developer'/, 'advanced sections should no longer use a developer-only branch');
assert.match(connectionPage, /MiSTer IP/, 'connection page should prioritize direct IP input');
assert.match(connectionPage, /title="저장된 MiSTer"/, 'connection page should keep the saved MiSTer list in the basic flow');
assert.match(connectionPage, /Electron safeStorage/, 'connection page should explain encrypted password storage');
assert.match(connectionPage, /> 연결</, 'manual connection should be the explicit read-only connection action');
assert.match(connectionPage, /자동검색/, 'auto-discovery should remain an auxiliary action');
assert.match(gamePage, /게임 관리 흐름|복사 전 확인|ROM/, 'game page should show simplified flow summary');
assert.match(gamePage, /visiblePlans/, 'game page should limit plan rows in basic mode');
assert.match(settingsPage, /앱 모드|기본 모드|고급 모드/, 'settings page should expose the two app modes');
assert.doesNotMatch(settingsPage, /개발자 모드|개발자 도구|Developer Mode/, 'settings page should not expose developer mode wording');
assert.match(settingsPage, /appData|IPC|내부 진단/, 'settings page should keep appData details in advanced internal diagnostics');

for (const [term, label] of [
  ['dry-run', '미리 검사'],
  ['simulated transfer', '복사 시뮬레이션'],
  ['preflight guard', '실행 전 안전 검사'],
  ['kill switch', '전송 전체 잠금'],
  ['feature flag', '기능 잠금 설정'],
]) {
  assert.ok(uiText.includes(`'${term}': '${label}'`), `${term} terminology should be user friendly`);
}

assert.match(gamePage + settingsPage, /실제 ROM transfer locked|실제 ROM 복사|실제 전송 잠금|잠겨/, 'actual ROM transfer should remain visibly locked or guarded');
assert.doesNotMatch(main, /ipcMain\.handle\('rom:(copy|transfer|mkdir|rename|overwrite|upload|delete)/i, 'main must not expose ROM write IPC');
assert.doesNotMatch(preload, /ipcRenderer\.invoke\('rom:(copy|transfer|mkdir|rename|overwrite|upload|delete)/i, 'preload must not expose ROM write IPC');
assert.doesNotMatch(preload, /rawCommand|execCommand|runCommand/i, 'preload must not expose raw command IPC');

const visibleBrandingSource = [read('package.json'), read('src/components/layout/AppLayout.tsx')].join('\n');
assert.doesNotMatch(visibleBrandingSource, /ZAPAROO|Zaparoo|자파루/, 'visible branding should stay on Hello Mister');

console.log('phase thirteen UI simplification tests passed');
