import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const main = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../electron/preload.mjs', import.meta.url), 'utf8');
const romTypes = readFileSync(new URL('../src/types/rom.ts', import.meta.url), 'utf8');
const gamePage = readFileSync(new URL('../src/pages/GameManagementPage.tsx', import.meta.url), 'utf8');
const platformService = readFileSync(new URL('../src/services/rom/romPlatformService.ts', import.meta.url), 'utf8');
const scanService = readFileSync(new URL('../src/services/rom/romScanPerformanceService.ts', import.meta.url), 'utf8');
const validationService = readFileSync(new URL('../src/services/rom/romDryRunValidationService.ts', import.meta.url), 'utf8');
const summaryService = readFileSync(new URL('../src/services/rom/romPlanSummaryService.ts', import.meta.url), 'utf8');
const persistenceService = readFileSync(new URL('../src/services/rom/romPlanPersistenceService.ts', import.meta.url), 'utf8');
const transferService = readFileSync(new URL('../src/services/rom/romTransferService.ts', import.meta.url), 'utf8');
const transferDesign = readFileSync(new URL('../src/services/rom/romTransferDesign.ts', import.meta.url), 'utf8');

assert.match(packageJson.scripts.test, /test:phase-nine/, 'npm test should include phase nine checks');

assert.match(romTypes, /LocalRomScanProgress/, 'scan progress type should exist');
assert.match(romTypes, /LocalRomScanCancellation/, 'scan cancellation type should exist');
assert.match(romTypes, /LocalRomScanPerformanceWarning/, 'scan warning type should exist');
assert.match(romTypes, /RomHashProgress/, 'hash progress type should exist');
assert.match(romTypes, /RomDryRunValidationSession/, 'ROM dry-run validation session type should exist');
assert.match(romTypes, /RomPlanSummary/, 'ROM plan summary type should exist');
assert.match(romTypes, /RomTransferDesignPhase/, 'transfer design types should exist');

assert.match(scanService, /const warningThreshold = 500/, '500 file warning threshold should exist');
assert.match(scanService, /const strongWarningThreshold = 2000/, '2000 file strong warning threshold should exist');
assert.match(scanService, /const blockedThreshold = 10000/, '10000 file block threshold should exist');
assert.match(scanService, /isRecursiveScanAllowed\(recursive: boolean, userOptedIn: boolean\)/, 'recursive scan should remain opt-in');
assert.match(scanService, /requestCancellation/, 'scan cancellation formatter should exist');
assert.match(scanService, /createHashProgress/, 'hash progress should be explicit and manual');

for (const ext of ['.a26', '.a52', '.a78', '.lnx', '.col', '.z80', '.tap', '.tzx', '.d64', '.g64', '.t64', '.prg', '.st', '.msa']) {
  assert.match(platformService, new RegExp(`'\\${ext}'`), `${ext} should be mapped`);
}

for (const ext of ['.zip', '.7z', '.cue', '.bin', '.chd', '.iso', '.vhd', '.dsk', '.rom', '.adf', '.hdf', '.xdf', '.dim', '.hdi']) {
  assert.match(platformService, new RegExp(`ambiguousExtensions[\\s\\S]*'\\${ext}'`), `${ext} should require manual platform selection`);
}

assert.match(platformService, /manualPlatform[\s\S]*romPlatformCandidates\.find/, 'manual override should be preferred over automatic guess');

assert.match(validationService, /NO_SESSION_CREDENTIAL/, 'validation should block remote steps without session credential');
assert.match(validationService, /HOST_KEY_MISMATCH/, 'validation should block remote steps on host key mismatch');
assert.match(validationService, /remote-games-snapshot/, 'validation should include remote games snapshot step');
assert.match(validationService, /copy-plan-dry-run/, 'validation should include final copy plan dry-run step');

assert.match(summaryService, /copyLaterCount/, 'plan summary should count copyLater');
assert.match(summaryService, /replaceLaterCount/, 'plan summary should count replaceLater');
assert.match(summaryService, /folderCreationCount/, 'plan summary should count folder creation');
assert.match(summaryService, /filterRomPlanItems/, 'plan filter helper should exist');
assert.match(summaryService, /sortRomPlanItems/, 'plan sort helper should exist');

assert.match(gamePage, /대량 ROM 스캔 상태/, 'UI should show large ROM scan status');
assert.match(gamePage, /10000개 이상 스캔을 명시적으로 허용/, 'UI should require explicit allow for very large scans');
assert.match(gamePage, /스캔 취소/, 'UI should expose scan cancellation');
assert.match(gamePage, /ROM dry-run 검증/, 'UI should include dry-run validation panel');
assert.match(gamePage, /복사 계획 요약/, 'UI should include copy plan summary');
assert.match(gamePage, /미지원 확장자 모두 block/, 'UI should include bulk unsupported-extension block action');
assert.match(gamePage, /targetFolderMissing/, 'UI should filter target folder missing plans');
assert.match(gamePage, /transfer adapter 설계와 rollback 한계/, 'UI should document transfer design and rollback limits');
assert.match(gamePage, /실제 복사 실행/, 'actual copy button should remain visible but disabled');
assert.match(gamePage, /<button className="button danger" disabled/, 'actual copy button should be disabled');

assert.match(persistenceService, /appVersion: '\d+\.\d+\.\d+'/, 'saved plan metadata should include app version');
assert.match(persistenceService, /includesFullLocalPaths/, 'saved plan should record full path export option');
assert.match(persistenceService, /conflictSummary/, 'saved plan should include conflict summary');
assert.match(persistenceService, /filePath: file\.fileName/, 'local full paths should be masked by default');
assert.match(persistenceService, /secretPattern/, 'plan persistence should keep secret sanitizer');

assert.match(transferDesign, /upload-temp-file/, 'transfer design should include temp upload phase');
assert.match(transferDesign, /TEMP_FILES_CAN_REMAIN/, 'transfer design should document rollback limits');
assert.match(transferDesign, /backup-policy/, 'transfer design should list implementation prerequisites');
assert.match(transferService, /ROM_TRANSFER_DISABLED/, 'executeTransfer should remain disabled');

assert.doesNotMatch(main, /ipcMain\.handle\('rom:(copy|transfer|mkdir|rename|overwrite|upload|delete)/i, 'main must not expose ROM write IPC');
assert.doesNotMatch(preload, /ipcRenderer\.invoke\('rom:(copy|transfer|mkdir|rename|overwrite|upload|delete)/i, 'preload must not expose ROM write IPC');
// ROM-boundary sources must still contain zero file-write / command-exec primitives.
for (const source of [preload, transferService, transferDesign]) {
  assert.doesNotMatch(source, /\bsftp\.(put|mkdir|rename|unlink)|createWriteStream|scp|execCommand|runCommand/i, 'ROM boundary must not implement upload/mkdir/rename/delete/raw command execution');
}
// The Electron main process now hosts guarded, user-confirmed write features (the SD setup wizard
// streams installer images/scripts to LOCAL disk via createWriteStream; INI/controller edits go
// through backup+confirm SFTP wrappers). Those are legitimate and unrelated to ROM safety. Main is
// still held to the invariants that keep the ROM lock and remote-write guards un-bypassable: no RAW
// sftp write methods (guarded wrappers only) and no raw command execution.
assert.doesNotMatch(main, /\bsftp\.(put|mkdir|rename|unlink)|\bscp\b|execCommand|runCommand/i, 'main must not use raw SFTP write methods or raw command execution (guarded wrappers only)');

console.log('Phase nine ROM dry-run validation tests passed.');
