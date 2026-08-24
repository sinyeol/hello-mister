import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const main = read('electron/main.mjs');
const preload = read('electron/preload.mjs');
const defaultScanFilters = read('src/features/sticker-v1/config/defaultMisterScanFilters.json');
const platformNormalization = read('src/features/sticker-v1/utils/platformNormalization.ts');
const misterScan = read('src/features/sticker-v1/services/mister/misterScan.ts');
const misterTitle = read('src/features/sticker-v1/services/mister/misterTitle.ts');
const misterBridge = read('src/features/sticker-v1/services/mister/misterBridge.ts');
const misterCatalog = read('src/features/sticker-v1/data/misterPlatformCatalog.ts');
const desktopTypes = read('src/types/desktop.ts');
const zaparooTypes = read('src/features/sticker-v1/types/zaparooLibrary.ts');
const zaparooLibrary = read('src/features/sticker-v1/services/zaparoo/zaparooLibrary.ts');
const misterFpgaPage = read('src/features/sticker-v1/pages/MisterFpgaPage.tsx');

assert.ok(platformNormalization.includes("['pgm', 'pgm']"), 'PGM should normalize to a stable platform key');
assert.ok(platformNormalization.includes("['igs pgm', 'pgm']"), 'IGS PGM should normalize to the PGM platform key');
assert.ok(platformNormalization.includes("['poly game master', 'pgm']"), 'PolyGame Master aliases should normalize to PGM');
assert.ok(platformNormalization.includes('aliases?: string[]'), 'platform identity should compare custom platform aliases');
assert.ok(platformNormalization.includes('sourceRoots?: string[]'), 'platform identity should compare custom source roots');

assert.ok(misterScan.includes('const arcadeChild = parts[arcadeIndex + 1]'), 'Arcade child folders should be considered for custom platform identity');
assert.ok(misterScan.includes("return arcadeChild || 'Arcade'"), '_Arcade/PGM should scan as a PGM system instead of plain Arcade');
assert.ok(misterScan.includes('isLikelyPlayablePath(line)'), '_Arcade subfolder .zip/.rom files should stay playable through the existing extension allowlist');
assert.ok(misterScan.includes('relativePath'), 'Arcade relative paths should remain available for launch/NFC payload generation');

assert.ok(defaultScanFilters.includes('"/media/fat/games"'), 'game list sync roots should include /media/fat/games');
assert.ok(defaultScanFilters.includes('"/media/fat/_Arcade"'), 'game list sync roots should include /media/fat/_Arcade');
assert.ok(misterBridge.includes("desktopLibraryScanRoots = ['/media/fat/games', '/media/fat/_Arcade']"), 'desktop library sync should force both games and _Arcade roots');
assert.ok(misterBridge.includes('desktopScanRootForPath(folder.path)'), 'desktop scan should group folders by games or _Arcade root');

assert.ok(main.includes('remotePaths.arcade'), 'Electron main should know the _Arcade root');
assert.ok(main.includes("|| /^\\/media\\/fat\\/_Arcade$/i.test(value)"), 'read-only folder listing should allow the _Arcade root for root MRA files');
assert.ok(main.includes("|| /^\\/media\\/fat\\/_Arcade\\/[^/\\\\]+$/i.test(value)"), 'read-only folder listing should allow one-level _Arcade subfolders such as PGM');
assert.ok(main.includes('normalizeRemoteGameScanOptions'), 'read-only game folder listing should normalize bounded scan depth options');
assert.ok(main.includes('scanDepth'), 'read-only game folder listing should support scanDepth');
assert.ok(main.includes('recursive'), 'read-only game folder listing should support explicit recursive scans');
assert.ok(main.includes('maxFiles'), 'recursive scans should keep a max file count guard');
assert.ok(main.includes('folders.push({ path: entryPath, depth: current.depth + 1 })'), 'scanDepth 2 and 3 should traverse safe child folders');
assert.ok(main.includes('foldersScanned'), 'nested scan results should report scanned folder count');
assert.ok(main.includes('failedFolders'), 'nested scan results should report failed folder count without killing the full scan');
assert.ok(main.includes('excludedFiles'), 'nested scan results should report excluded unsafe file names');
assert.ok(main.includes('depthLimitedFolders'), 'nested scan results should report folders skipped by scanDepth');
assert.ok(desktopTypes.includes('depthLimitedFolders?: number'), 'renderer API types should expose depth-limited folder diagnostics');

assert.ok(misterCatalog.includes("type?: 'default' | 'custom' | 'classification-folder'"), 'platform catalog should persist custom and classification folder records');
assert.ok(misterCatalog.includes('sourceRoots?: string[]'), 'custom platform catalog should remember source roots such as /media/fat/_Arcade/PGM');
assert.ok(misterCatalog.includes('scanDepth?: number'), 'custom platform catalog should remember bounded scan depth');
assert.ok(misterCatalog.includes('recursive?: boolean'), 'custom platform catalog should remember recursive scan opt-in');
assert.ok(misterCatalog.includes('coreRoot?: string'), 'custom platform catalog should remember optional core folders');
assert.ok(misterCatalog.includes('launchTemplate?: string'), 'custom platform catalog should remember the launch format');
assert.ok(misterCatalog.includes('cardCategory?: string'), 'custom platform catalog should remember the card category');

assert.ok(zaparooTypes.includes('classificationFolderPlatformKeys?: string[]'), 'library state should persist classification-only folder choices');
assert.ok(zaparooLibrary.includes('classificationFolderPlatformKeys: []'), 'empty library state should initialize classification-only folder choices');
assert.ok(zaparooLibrary.includes('classificationFolderPlatformKeys: state.classificationFolderPlatformKeys ?? []'), 'library persistence should keep classification-only folder choices');

assert.ok(misterFpgaPage.includes('customPlatformDraft'), 'custom platform registration modal state should exist');
assert.ok(misterFpgaPage.includes('customPlatformMergeKey'), 'custom platform merge selection state should exist');
assert.ok(misterFpgaPage.includes('defaultCustomPlatformDraft'), 'manual custom platform creation should provide defaults');
assert.ok(misterFpgaPage.includes('openManualCustomPlatformRegistration'), 'game list sync should expose a manual custom platform creation flow');
assert.ok(misterFpgaPage.includes('openCustomPlatformRegistration'), 'new platform rows should open a custom platform registration flow');
assert.ok(misterFpgaPage.includes('registerCustomPlatformFromDraft'), 'custom platform registration should persist the draft');
assert.ok(misterFpgaPage.includes('mergeCustomPlatformToLibrary'), 'custom platform merge should be an explicit user action');
assert.ok(misterFpgaPage.includes('customPlatformCandidateEntries'), 'custom platform merge should collect games from the registered source root');
assert.ok(misterBridge.includes('scanCustomPlatformSource'), 'custom platform source roots should have a direct read-only scan path');
assert.ok(misterBridge.includes('api.listRemoteGameFolderFiles(session.sessionId, sourceRoot'), 'custom platform direct scan should read the registered sourceRoot itself');
assert.ok(misterBridge.includes('resolvedMiSTerPath: absolutePath'), 'direct custom scans should preserve the full MiSTer path for card launch and NFC');
assert.ok(misterBridge.includes('customPlatformEntryFromRemoteFile'), 'direct custom scans should build candidates without the general platform parser');
assert.ok(misterBridge.includes('nfcPayload: launchText'), 'direct custom scans should create a launch payload from the nested MRA path');
assert.ok(misterBridge.includes("launchMode: 'absolute-path'"), 'custom platform candidates should launch by the full MiSTer path');
assert.ok(misterBridge.includes('titleFromCustomPlatformPath'), 'custom platform candidates should derive titles from MRA file or parent folder names');
assert.ok(misterBridge.includes("if (/^(game|default|index|rom)$/i.test(baseName) && parentFolderName)"), 'generic MRA filenames should fall back to the parent folder title');
assert.ok(misterBridge.includes('CustomPlatformScanDiagnostics'), 'custom platform scans should expose detailed diagnostics');
assert.ok(misterBridge.includes('totalFiles'), 'custom diagnostics should separate total discovered files from candidates');
assert.ok(misterBridge.includes('mraFiles'), 'custom diagnostics should count MRA files');
assert.ok(misterBridge.includes('extensionExcludedFiles'), 'custom diagnostics should count extension-excluded files');
assert.ok(misterBridge.includes('duplicateFullPathFiles'), 'custom diagnostics should count duplicate full MiSTer paths');
assert.ok(misterBridge.includes('excludedExtensionCounts'), 'custom diagnostics should summarize excluded extensions');
assert.ok(misterBridge.includes("extension === '.mra'"), 'custom diagnostics should count .MRA/.mra files case-insensitively after lowercasing');
assert.ok(misterBridge.includes('acceptedPathKeys.has(pathKey)'), 'custom candidates should only dedupe by full MiSTer path');
assert.ok(misterBridge.includes('diagnostics.unsupportedFiles = 0'), 'custom platform MRA candidates must not be excluded as unsupported after passing the extension filter');
const customSourceScanFunction = misterBridge.slice(
  misterBridge.indexOf('async scanCustomPlatformSource'),
  misterBridge.indexOf('async getScanFilterConfig'),
);
assert.doesNotMatch(customSourceScanFunction, /parseMiSTerPathList/, 'custom sourceRoot candidates should not be removed by the general MiSTer path parser');
assert.ok(customSourceScanFunction.includes('uniqueAcceptedFiles.map((entry, index) => customPlatformEntryFromRemoteFile'), 'all extension-accepted custom files should become candidates');
assert.ok(misterFpgaPage.includes('refreshCustomPlatformSourceScan'), 'custom platform UI should provide a direct sourceRoot scan action');
assert.ok(misterFpgaPage.includes('sourceRoot 스캔'), 'custom platform UI should expose a sourceRoot scan button');
assert.ok(misterFpgaPage.includes('전체 파일'), 'custom platform UI should show total scanned files');
assert.ok(misterFpgaPage.includes('MRA 파일'), 'custom platform UI should show MRA file count');
assert.ok(misterFpgaPage.includes('확장자 제외'), 'custom platform UI should show extension-excluded counts');
assert.ok(misterFpgaPage.includes('중복 경로 제외'), 'custom platform UI should show duplicate path counts');
assert.ok(misterFpgaPage.includes('customPlatformScanRangeLabel'), 'custom platform UI should use user-facing scan range labels');
assert.ok(misterFpgaPage.includes('하위 폴더 1단계까지'), 'scanDepth 2 should be described as one child-folder level');
assert.ok(misterFpgaPage.includes('MRA 기반 아케이드는 .mra를 게임 후보로 보고'), 'UI should explain why .zip ROM bundles are excluded for MRA-based arcade platforms');
assert.ok(misterFpgaPage.includes('knownCatalogIdentityKeys'), 'new platform discovery should exclude already registered custom platforms');
assert.ok(misterFpgaPage.includes('existingPlatformIdentityKeys'), 'new platform discovery should still exclude platforms already present in the library');
assert.ok(misterFpgaPage.includes('sourceRootForDiscovery'), 'custom platform registration should store source roots');
assert.ok(misterFpgaPage.includes('markDiscoveredPlatformAsClassificationFolder'), 'unknown folders can be marked as classification-only');
assert.ok(misterFpgaPage.includes('lastScanEntries.slice(0, 0).forEach'), 'scan-only unknown platforms should not be auto-added to import checkboxes before registration');
assert.ok(misterFpgaPage.includes('setSelectedImportPlatformKeys((current) => current.filter((key) => key !== platformKey))'), 'registered custom platforms should stay unchecked until the user selects them');

assert.ok(misterFpgaPage.includes('PGM, IGS PGM, PolyGame Master'), 'PGM registration should seed useful aliases');
assert.ok(misterFpgaPage.includes('/media/fat/_Arcade/PGM'), 'manual custom platform defaults should use the PGM game folder');
assert.ok(misterFpgaPage.includes('scanDepth: 2'), 'manual custom platform defaults should scan two levels for /PGM/Game/Game.mra layouts');
assert.ok(misterFpgaPage.includes('recursive: false'), 'manual custom platform defaults should not enable full recursive scans');
assert.ok(misterFpgaPage.includes('entryMatchesCustomPlatformSource'), 'custom platform candidates should apply sourceRoot plus scanDepth filtering');
assert.ok(misterFpgaPage.includes('relativeDepthFromSourceRoot'), 'custom platform scan depth should compare depth relative to sourceRoot');
assert.ok(misterFpgaPage.includes('/media/fat/_Arcade/cores'), 'manual custom platform defaults should include an optional Arcade core folder');
assert.ok(misterFpgaPage.includes('.mra'), 'manual custom platform defaults should prefer MRA entries');
assert.ok(misterFpgaPage.includes('**launch:{misterPath}'), 'manual custom platform defaults should keep the safe Zaparoo launch format');
assert.ok(misterFpgaPage.includes('Core folder (optional)'), 'custom platform creation should expose an optional core folder field');
assert.ok(misterFpgaPage.includes('스캔 범위'), 'custom platform creation should expose a scan range option');
assert.ok(misterFpgaPage.includes('바로 아래만'), 'scan range should allow depth 1');
assert.ok(misterFpgaPage.includes('2단계까지'), 'scan range should default to depth 2');
assert.ok(misterFpgaPage.includes('3단계까지'), 'scan range should allow depth 3');
assert.ok(misterFpgaPage.includes('전체 하위 폴더'), 'scan range should expose explicit recursive opt-in');
assert.ok(misterFpgaPage.includes('선택한 폴더 바로 아래에는 대상 파일이 없습니다. 스캔 범위를 2단계 이상으로 변경해 보세요.'), 'zero candidate state should guide the user to increase scan depth');
assert.ok(misterFpgaPage.includes('customPlatformDraftCandidateCount'), 'custom platform creation should show candidate counts before merge');
assert.ok(misterFpgaPage.includes('void mergeCustomPlatformToLibrary(item.platformKey)'), 'custom platform UI should provide an explicit library merge button');
assert.ok(misterFpgaPage.includes('entryMatchesCustomPlatformSource(entry, sourceRootPrefixes'), 'custom platform merge should be scoped to the selected sourceRoot and scan depth');
assert.ok(misterFpgaPage.includes('platformStatuses'), 'MiSTer scan status should expose per-platform scan rows instead of only root rows');
assert.ok(misterFpgaPage.includes('buildPlatformScanStatuses'), 'MiSTer scan status should be derived from actual scan entries by platform');
assert.ok(misterFpgaPage.includes('플랫폼별 스캔 상태'), 'MiSTer scan UI should show platform-level status');
assert.ok(misterFpgaPage.includes('libraryAbsolutePathKeys'), 'import duplicate counts should use existing absolute MiSTer paths');
const candidateFunction = misterFpgaPage.slice(
  misterFpgaPage.indexOf('function customPlatformCandidateEntries'),
  misterFpgaPage.indexOf('function customPlatformDraftCandidateCount'),
);
assert.doesNotMatch(candidateFunction, /entry\.playable|entry\.ignored|entry\.bios|entry\.firmware|entry\.systemFile/, 'custom sourceRoot candidates should not be removed by general import classification filters');
assert.ok(candidateFunction.includes('customPlatformSourceScans[item.platformKey]?.entries'), 'custom platform candidates should include direct sourceRoot scan results');
assert.ok(misterFpgaPage.includes('sourceRootEntries = await refreshCustomPlatformSourceScan(item.platformKey)'), 'custom platform merge should direct-scan sourceRoot before reporting zero candidates');
assert.ok(misterFpgaPage.includes('const existingLibraryPaths = new Set(zaparooLibrary.entries.map((entry) => entry.absolutePath))'), 'custom platform merge should skip duplicate fullMiSTerPath values');
assert.ok(misterFpgaPage.includes('const newCustomEntries = sourceRootEntries.filter((entry) => !existingLibraryPaths.has(entry.absolutePath))'), 'custom platform merge should only add new sourceRoot games');
assert.ok(misterBridge.includes('scanDepth: 2'), '_Arcade subfolder scan should read one nested game folder level by default');
assert.ok(misterBridge.includes("folder.path.startsWith('/media/fat/_Arcade/')"), '_Arcade/PGM scan should receive the depth-2 option');
assert.ok(misterTitle.includes("if (/^(game|default|index|rom)$/i.test(cleaned) && parentName)"), 'generic nested MRA filenames should fall back to the parent folder game title (titleFromPath in misterTitle.ts)');
assert.ok(misterScan.includes('launchValue'), 'nested MRA paths should continue to produce launch/NFC values through existing scan entries');
const registerFunction = misterFpgaPage.slice(
  misterFpgaPage.indexOf('function registerCustomPlatformFromDraft'),
  misterFpgaPage.indexOf('function mergeCustomPlatformToLibrary'),
);
assert.doesNotMatch(registerFunction, /setMiSTerEntries/, 'custom platform registration must not auto-merge games');
assert.ok(misterFpgaPage.includes("setMiSTerEntries(Array.from(existingMisterEntriesByPath.values()), 'bridge-scan', newCustomEntries.map((entry) => entry.id))"), 'custom platform merge button should merge sourceRoot games into the MiSTer game list library');
assert.ok(misterFpgaPage.includes('setSelectedPlatform('), 'custom platform merge should switch the game list to the registered platform');
assert.ok(zaparooLibrary.includes('absolute-path:'), 'Zaparoo library entry ids should prefer full MiSTer paths so same-title arcade entries are not collapsed');
assert.ok(zaparooLibrary.includes('existingEntriesByPath'), 'Zaparoo library merge should find old entries by absolute path when ids changed');

assert.doesNotMatch(preload, /raw.*command|command:raw/i, 'raw command IPC must remain absent');
assert.doesNotMatch(main, /ipcMain\.handle\('remote:(write|delete|rename|mkdir|upload)'/, 'generic remote write IPC must remain absent');
assert.doesNotMatch(main, /password.*writeJsonFile|privateKey.*writeJsonFile|passphrase.*writeJsonFile|token.*writeJsonFile/i, 'secrets must not be written to appData JSON in plaintext');

console.log('phase twenty-four custom platform sync tests passed.');
