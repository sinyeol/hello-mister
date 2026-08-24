import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const main = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../electron/preload.mjs', import.meta.url), 'utf8');
const desktopTypes = readFileSync(new URL('../src/types/desktop.ts', import.meta.url), 'utf8');
const romTypes = readFileSync(new URL('../src/types/rom.ts', import.meta.url), 'utf8');
const localRomService = readFileSync(new URL('../src/services/rom/localRomService.ts', import.meta.url), 'utf8');
const platformService = readFileSync(new URL('../src/services/rom/romPlatformService.ts', import.meta.url), 'utf8');
const conflictService = readFileSync(new URL('../src/services/rom/romConflictService.ts', import.meta.url), 'utf8');
const storageService = readFileSync(new URL('../src/services/rom/romStorageCheckService.ts', import.meta.url), 'utf8');
const planningService = readFileSync(new URL('../src/services/rom/romPlanningService.ts', import.meta.url), 'utf8');
const gamePage = readFileSync(new URL('../src/pages/GameManagementPage.tsx', import.meta.url), 'utf8');
const remote = readFileSync(new URL('../src/services/mister/remote.ts', import.meta.url), 'utf8');

assert.match(packageJson.scripts.test, /test:phase-seven/, 'npm test should include phase seven checks');

assert.match(romTypes, /LocalRomCandidate/, 'local ROM candidate type should exist');
assert.match(romTypes, /LocalRomScanOptions/, 'local ROM scan options type should exist');
assert.match(romTypes, /RemoteGameFolderSnapshot/, 'remote folder snapshot type should exist');
assert.match(romTypes, /RomStorageDryRun/, 'storage dry-run type should exist');
assert.match(main, /rom:select-files/, 'Electron main should expose read-only ROM file selection');
assert.match(main, /rom:select-folder/, 'Electron main should expose read-only ROM folder selection');
assert.match(main, /localRomMetadata/, 'local ROM metadata reader should exist');
assert.match(main, /fs\.stat/, 'local ROM metadata should use read-only stat');
assert.match(preload, /selectLocalRomFiles/, 'preload should expose ROM file selection');
assert.match(preload, /selectLocalRomFolder/, 'preload should expose ROM folder selection');
assert.match(desktopTypes, /selectLocalRomFiles/, 'desktop type should expose ROM file selection');
assert.match(localRomService, /selectFiles/, 'renderer service should call file selection adapter');

assert.match(platformService, /\.nes'.*NES/s, '.nes should recommend NES');
assert.match(platformService, /\.sfc'.*\.smc'.*SNES/s, 'SNES extensions should be mapped');
assert.match(platformService, /ambiguousExtensions = new Set\(\['\.zip', '\.cue', '\.bin', '\.chd', '\.iso'/, 'zip and CD formats should be ambiguous');
assert.match(platformService, /autoSelectable: !ambiguous/, 'ambiguous formats must not be auto-selected');
assert.match(platformService, /manualPlatform[\s\S]*romPlatformCandidates\.find/, 'manual platform override should take priority');

assert.match(remote, /listGameFolderFiles/, 'remote read service should expose folder file listing');
assert.match(main, /mister:remote:list-game-folder-files/, 'main should expose read-only remote folder snapshot IPC');
assert.match(main, /isSafeRemoteGameFolderPath/, 'remote folder file listing should validate /media/fat/games path');
assert.match(main, /sftpReadDir\(sftp, folderPath\)/, 'remote folder snapshot should use readdir only');

assert.match(conflictService, /targetFolderMissing/, 'missing target folder should be a conflict');
assert.match(conflictService, /sameNameSameSize/, 'same name and same size conflict should be detected');
assert.match(conflictService, /sameNameDifferentSize/, 'same name different size conflict should be detected');
assert.match(conflictService, /needsManualPlatform/, 'manual platform-needed conflict should be detected');

assert.match(storageService, /insufficient-space/, 'storage dry-run should detect insufficient space');
assert.match(storageService, /low-headroom/, 'storage dry-run should warn on low headroom');
assert.match(storageService, /oneGiB/, 'storage dry-run should keep a safety reserve');

assert.match(planningService, /dryRun: true/, 'copy plan should be dry-run');
assert.match(planningService, /readOnly: true/, 'copy plan should be read-only');
assert.match(planningService, /copyLater/, 'copy action should only be a future plan action');
assert.match(planningService, /blocked/, 'blocked action should be available for unsafe cases');
assert.match(gamePage, /실제 복사 실행/, 'copy execution button should remain disabled');
assert.match(gamePage, /JSON에 로컬 전체 경로 포함/, 'full local path export should be explicit opt-in');
assert.match(gamePage, /maskRomDryRunResult/, 'plan JSON export should be sanitizable');
assert.match(gamePage, /로컬 전체 경로를 숨긴 JSON/, 'default JSON export should hide local full paths');

const folderSnapshotBlock = main.match(/function isSafeRemoteGameFolderPath[\s\S]*?async function listScriptFiles/)?.[0] ?? '';
const localRomBlock = main.match(/async function localRomMetadata[\s\S]*?function registerIpc/)?.[0] ?? '';
const romIpcBlock = main.match(/ipcMain\.handle\('rom:select-files'[\s\S]*?ipcMain\.handle\('file:sha256'/)?.[0] ?? '';

assert.ok(folderSnapshotBlock, 'remote game folder snapshot implementation should be inspectable');
assert.ok(localRomBlock, 'local ROM selection implementation should be inspectable');
assert.ok(romIpcBlock, 'ROM selection IPC implementation should be inspectable');

for (const source of [folderSnapshotBlock, localRomBlock, romIpcBlock, preload, desktopTypes, remote, localRomService, platformService, conflictService, storageService, planningService]) {
  assert.doesNotMatch(source, /\b(copyFile|writeFile|unlink|rename|chmod|chown|scp)\b|rm\(|sftp\.put|rom:copy|rom:delete|rom:rename|rom:overwrite/i, 'phase seven must not expose ROM write/delete/rename actions');
  assert.doesNotMatch(source, /rawCommand|execCommand|runCommand/i, 'raw command IPC must remain hidden');
}
assert.doesNotMatch(gamePage, /helloMisterDesktop\?.*(copy|delete|rename|overwrite)|rom:(copy|delete|rename|overwrite)/i, 'Game page must not call ROM write/delete/rename adapters');
assert.doesNotMatch(gamePage, /rawCommand|execCommand|runCommand/i, 'raw command IPC must remain hidden from Game page');

console.log('Phase seven ROM dry-run planning tests passed.');
