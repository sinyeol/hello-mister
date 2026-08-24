import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function read(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

function listFiles(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

const repoRoot = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const packageJson = JSON.parse(read('package.json'));
const mainEntry = read('src/main.tsx');
const viteConfig = read('vite.config.ts');
const desktopTypes = read('src/types/desktop.ts');
const stickerApp = read('src/features/sticker-v1/app/App.tsx');
const studioPage = read('src/pages/StickerStudioPage.tsx');
const v2Layout = read('src/components/layout/AppLayout.tsx');
const stickerBridge = read('src/features/sticker-v1/services/mister/misterBridge.ts');
const misterFpgaPage = read('src/features/sticker-v1/pages/MisterFpgaPage.tsx');
const main = read('electron/main.mjs');
const preload = read('electron/preload.mjs');
const connectionPage = read('src/pages/MisterConnectionPage.tsx');
const profileStore = read('src/services/mister/profileStore.ts');
const cardEditorPage = read('src/features/sticker-v1/pages/CardEditorPage.tsx');

assert.equal(packageJson.scripts['test:phase-fifteen'], 'node scripts/test-phase-fifteen-sticker-studio-mvp.mjs', 'phase fifteen test script should exist');
assert.ok(packageJson.scripts.test.includes('test:phase-fifteen'), 'main test script should include phase fifteen');

assert.match(mainEntry, /path="\/stickers\/\*"/, 'v1 sticker routes should be mounted below /stickers');
assert.match(mainEntry, /Navigate to="\/stickers\/mister"/, 'default route should open the MiSTer game list');
assert.match(studioPage, /features\/sticker-v1\/app\/App/, 'sticker route should import the copied v1 app module, not a placeholder MVP hub');
assert.match(studioPage, /StickerV1ContentHost/, 'sticker route should mount v1 data hydration in the v2 content area');
assert.match(studioPage, /StickerV1Routes/, 'sticker route should use the original v1 feature pages');
assert.doesNotMatch(studioPage, /StickerV1App/, 'sticker route must not let the full v1 shell replace the v2 shell');
assert.match(v2Layout, /id: 'stickers'[\s\S]*\/stickers\/mister[\s\S]*\/stickers\/editor/, 'v2 sidebar should own sticker submenu navigation');
assert.match(v2Layout, /\/stickers\/nfc/, 'v2 sidebar should still expose NFC management navigation');
assert.match(v2Layout, /게임 라이브러리|게임 목록/, 'v2 sidebar should use the game list naming');
assert.doesNotMatch(v2Layout, /스티커 홈/, 'sticker home should not be exposed');
assert.doesNotMatch(v2Layout, /to: '\/stickers\/project-games'/, 'project games should not be exposed in the sticker sidebar');
assert.doesNotMatch(v2Layout, /if \(stickerRoute\)\s*\{\s*return <Outlet \/>;\s*\}/, 'v2 sidebar should remain visible on sticker routes');
assert.match(viteConfig, /@sticker-v1/, 'Vite should resolve the imported v1 sticker feature alias');
assert.match(mainEntry, /features\/sticker-v1\/styles\/globals\.css/, 'v1 sticker styles should be loaded in v2');

assert.match(stickerApp, /PersistenceHydrator/, 'v1 app should keep its original startup hydration flow');
assert.match(stickerApp, /loadCardAlbumIndexFromIndexedDb/, 'v1 card album persistence should be hydrated');
assert.match(stickerApp, /loadPersistedTemplatesFromIndexedDb/, 'v1 template persistence should be hydrated');
assert.match(stickerApp, /getSavedAssetSourceMetadata/, 'v1 image source metadata should be hydrated');
assert.match(stickerApp, /loadZaparooLibraryStateFromIndexedDb/, 'v1 NFC/TapTo library data should be hydrated without using the old folder as runtime');
assert.match(stickerApp, /export function StickerV1ContentHost/, 'v1 app should expose a reusable content host');
assert.match(stickerApp, /export function StickerV1Routes/, 'v1 app should expose feature routes separately from the full shell');

const expectedStickerRoutes = [
  ['images', 'AssetLoadingPage'],
  ['mister', 'MisterFpgaPage'],
  ['nfc', 'MisterFpgaPage'],
  ['editor', 'CardEditorPage'],
  ['album', 'CardAlbumPage'],
  ['templates', 'TemplateManagementPage'],
  ['template-editor', 'LayoutEditorPage'],
  ['output', 'ExportPreviewPage'],
];
for (const [route, component] of expectedStickerRoutes) {
  assert.match(stickerApp, new RegExp(`path="${route}"[\\s\\S]*${component}`), `v1 ${component} should be reachable at /stickers/${route}`);
}
assert.match(stickerApp, /path="project-games" element=\{<Navigate to="\/stickers\/mister" replace \/>\}/, 'legacy project games alias should redirect to the MiSTer game list');
assert.match(stickerApp, /path="cards" element=\{<Navigate to="\/stickers\/editor" replace \/>\}/, 'cards alias should preserve the working card route');

for (const [route, label] of [
  ['/stickers/mister', '게임 라이브러리'],
  ['/stickers/editor', '카드편집'],
  ['/stickers/images', '이미지/에셋'],
  ['/stickers/templates', '템플릿'],
  ['/stickers/output', '출력/시트'],
  ['/stickers/nfc', 'NFC 관리'],
]) {
  assert.match(v2Layout, new RegExp(`to: '${route.replaceAll('/', '\\/')}'[\\s\\S]*label: '${label}'`), `${label} submenu should navigate inside /stickers`);
}
assert.doesNotMatch(v2Layout, /label: '작업 카드'/, 'old working card sidebar label should be removed');
assert.match(stickerApp, /StickerV1ContentHost\(\{ children \}[\s\S]*\{children\}/, 'v1 content host should render inside the v2 layout via children instead of forcing its own shell');

assert.match(cardEditorPage, /preserveImageOverridesForTemplateChange/, 'template changes should preserve existing card image transforms');
assert.match(cardEditorPage, /preservedOverrideForTemplateTarget/, 'template changes should map existing image transforms to the next template image slot');
assert.match(cardEditorPage, /DEFAULT_BATCH_IMAGE_CENTER_ZOOM_STEPS = mainImageDefaultCenteredZoomSteps/, 'batch image matching should use the v1 centered zoom default');
assert.match(cardEditorPage, /applyCenteredImageZoom\(baseTransform, DEFAULT_BATCH_IMAGE_CENTER_ZOOM_STEPS\)/, 'newly matched main images should receive the v1 default centered zoom');
assert.match(cardEditorPage, /forceDefaultMainZoom: target === 'main'/, 'batch image matching should force the v1 center zoom even when a template has a saved image transform');
assert.match(cardEditorPage, /cardImageMatchesAsset/, 'batch image matching should detect existing card images before changing transforms');
assert.match(cardEditorPage, /if \(!mainAlreadyAssigned\) \{[\s\S]*fitOverrideForTemplateLayer\(template, layer, main, 'stretch', 'main'\)/, 'batch image matching should only apply the 25-step main image zoom to newly matched images');
assert.match(cardEditorPage, /batchMatchApplied: true[\s\S]*centerZoomStepsApplied: DEFAULT_BATCH_IMAGE_CENTER_ZOOM_STEPS[\s\S]*beforeTransform[\s\S]*afterTransform/, 'batch image matching should expose development diagnostics for the applied 25-step center zoom');
assert.doesNotMatch(cardEditorPage, /slotOverrides: mainDefault \? \{ \[getLayerOverrideKey\(mainDefault\.layer\)\]: mainDefault\.override \} : \{\}/, 'template changes must not reset image transforms to a default override');

assert.match(misterFpgaPage, /게임 리스트 동기화/, 'v1 library sync wording should be updated to game list sync');
assert.match(misterFpgaPage, /importDisabledPlatformKeys/, 'game list sync should keep explicit import exclusion state');
assert.match(misterFpgaPage, /선택한 항목만/, 'game list sync should tell users only selected items are imported');

assert.match(stickerBridge, /helloMisterDesktopApi/, 'v1 MiSTer bridge should use the v2 desktop adapter when packaged');
assert.match(stickerBridge, /fingerprintMister/, 'v1 MiSTer connection should use v2 read-only SSH fingerprinting');
assert.match(stickerBridge, /inspectSshHostKey/, 'v1 MiSTer connection should check host keys through v2');
assert.match(stickerBridge, /listRemoteGames/, 'v1 MiSTer game list should use v2 read-only game folder listing when possible');
assert.match(stickerBridge, /NFC.*잠겨|안전 정책상/, 'v1 NFC write action should remain locked in v2');
assert.match(stickerBridge, /실행.*잠겨|안전 정책상/, 'v1 remote launch action should remain locked or guarded in v2');

for (const dependency of ['konva', 'react-konva', 'pdf-lib', 'jszip', 'papaparse', 'zustand']) {
  assert.ok(packageJson.dependencies[dependency], `${dependency} should be merged into v2 dependencies for v1 sticker features`);
}

assert.match(desktopTypes, /zaparooDesktop/, 'desktop types should expose v1-compatible zaparooDesktop bridge');
assert.match(preload, /zaparooDesktop/, 'preload should expose v1-compatible zaparooDesktop bridge');
assert.match(main, /zaparoo:save-file/, 'main should support local sticker export save dialogs');
assert.match(main, /zaparoo:capture-html-png/, 'main should support local HTML capture for sticker exports');
assert.match(main, /zaparoo:read-file-data-url/, 'main should support safe local image inlining for sticker exports');

assert.match(connectionPage, /MiSTer IP/, 'MiSTer connection should be direct-IP based');
assert.match(connectionPage, /defaultMisterPassword = '1'/, 'default MiSTer password input value should be 1');
assert.match(connectionPage, /saveProfilePassword/, 'password save should go through safe storage instead of profile JSON');
assert.match(connectionPage, /autoConnect: false/, 'direct IP profiles should persist autoConnect disabled');
assert.match(connectionPage, /deleteProfile\(target/, 'saved MiSTer profiles should be removable');
assert.match(profileStore, /deleteProfile/, 'profile store should delete saved MiSTer profiles');
assert.match(main, /safeStorage\.encryptString/, 'main should encrypt saved MiSTer passwords');
assert.doesNotMatch(connectionPage.match(/const profile: MisterDeviceProfile = \{[\s\S]*?\n {4}\};/)?.[0] ?? '', /password\s*:/i, 'direct IP persisted profile object must not include password values');

const copiedStickerFiles = listFiles(path.join(repoRoot, 'src', 'features', 'sticker-v1'))
  .filter((filePath) => /\.(ts|tsx|js|jsx|css|json|svg)$/.test(filePath));
assert.ok(copiedStickerFiles.length > 50, 'v1 sticker source should be copied into v2 as a real feature, not left as a placeholder');
for (const filePath of copiedStickerFiles) {
  const text = fs.readFileSync(filePath, 'utf8');
  assert.doesNotMatch(text, /zaparoo-nfc-card-stickers[\\/]/, `${path.relative(repoRoot, filePath)} must not runtime-reference the v1 folder`);
}

assert.doesNotMatch(main, /ipcMain\.handle\('rom:(copy|transfer|mkdir|rename|overwrite|upload|delete)/i, 'main must not expose ROM write IPC');
assert.doesNotMatch(preload, /ipcRenderer\.invoke\('rom:(copy|transfer|mkdir|rename|overwrite|upload|delete)/i, 'preload must not expose ROM write IPC');
assert.doesNotMatch(preload, /rawCommand|execCommand|runCommand/i, 'preload must not expose raw command IPC');

console.log('phase fifteen v1 sticker app base restoration tests passed');
