import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const main = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../electron/preload.mjs', import.meta.url), 'utf8');
const desktopTypes = readFileSync(new URL('../src/types/desktop.ts', import.meta.url), 'utf8');
const romTypes = readFileSync(new URL('../src/types/rom.ts', import.meta.url), 'utf8');
const gamePage = readFileSync(new URL('../src/pages/GameManagementPage.tsx', import.meta.url), 'utf8');
const planningService = readFileSync(new URL('../src/services/rom/romPlanningService.ts', import.meta.url), 'utf8');
const policyService = readFileSync(new URL('../src/services/rom/romPolicyService.ts', import.meta.url), 'utf8');
const backupService = readFileSync(new URL('../src/services/rom/romBackupService.ts', import.meta.url), 'utf8');
const transferService = readFileSync(new URL('../src/services/rom/romTransferService.ts', import.meta.url), 'utf8');
const persistenceService = readFileSync(new URL('../src/services/rom/romPlanPersistenceService.ts', import.meta.url), 'utf8');

assert.match(packageJson.scripts.test, /test:phase-eight/, 'npm test should include phase eight checks');

assert.match(romTypes, /RomConflictResolutionPolicy/, 'conflict resolution policy type should exist');
assert.match(romTypes, /RemoteFolderCreationPlan/, 'remote folder creation plan type should exist');
assert.match(romTypes, /RomBackupPlan/, 'backup plan type should exist');
assert.match(romTypes, /RomFinalConfirmationSummary/, 'final confirmation summary type should exist');
assert.match(romTypes, /RomTransferPreparationResult/, 'transfer preparation type should exist');
assert.match(romTypes, /SavedRomPlan/, 'saved ROM plan type should exist');

assert.match(policyService, /conflictType: 'sameNameSameSize'[\s\S]*defaultAction: 'skip'/, 'sameNameSameSize should default to skip');
assert.match(policyService, /conflictType: 'sameNameDifferentSize'[\s\S]*defaultAction: 'needsUserDecision'/, 'sameNameDifferentSize should require user decision');
assert.match(policyService, /allowedActions: \['skip', 'replaceLater', 'renameLocalFileLater', 'block'\]/, 'sameNameDifferentSize should offer safe choices');
assert.match(policyService, /conflictType: 'targetFolderMissing'[\s\S]*'createFolderLater'[\s\S]*'chooseDifferentFolder'[\s\S]*'block'/, 'targetFolderMissing should offer folder dry-run choices');
assert.match(policyService, /conflictType: 'ambiguousPlatform'[\s\S]*defaultAction: 'needsUserDecision'/, 'ambiguous platform should be blocked until manual choice');
assert.match(policyService, /conflictType: 'unsupportedExtension'[\s\S]*defaultAction: 'block'/, 'unsupported extension should be blocked');
assert.match(policyService, /raw\.includes\('\.\.'\)/, 'folder validation should block parent traversal');
assert.match(policyService, /raw\.includes\('\/'\).*raw\.includes\('\\\\'\)/s, 'folder validation should block path separators');
assert.match(policyService, /\^\[a-zA-Z\]:/, 'folder validation should block Windows absolute paths');
assert.match(policyService, /targetRemotePath = validation\.ok \? `\$\{gamesBasePath\}\/\$\{validation\.normalizedName\}`/, 'folder plan should remain inside /media/fat/games');
assert.match(policyService, /transferEnabled: false/, 'final confirmation should keep transfer disabled');

assert.match(planningService, /getPolicyForConflict\(conflictType\)\.defaultAction/, 'planning should use centralized conflict policies');
assert.match(planningService, /actionOverrides/, 'planning should support per-file policy overrides');
assert.match(planningService, /schemaVersion: 1/, 'copy plans should include schema version');

assert.match(backupService, /replaceLater/, 'backup plan should target replaceLater items');
assert.match(backupService, /requiredBeforeCopy: true/, 'backup items should be required before copy');
assert.match(backupService, /MISSING_BACKUP_PLAN/, 'missing backup plan should block replaceLater');
assert.doesNotMatch(backupService, /\b(copyFile|writeFile|sftp\.put|mkdir|rename|unlink)\b/i, 'backup service must not perform real IO');

assert.match(transferService, /ROM_TRANSFER_DISABLED/, 'transfer service should return disabled error');
assert.match(transferService, /executeTransfer\(\)/, 'executeTransfer stub should exist');
assert.doesNotMatch(transferService, /sftp\.put|createWriteStream|mkdir|rename|unlink|copyFile|writeFile/i, 'transfer service must not implement remote writes');

assert.match(persistenceService, /includeFullLocalPaths/, 'saved plan export should support explicit full-path opt-in');
assert.match(persistenceService, /filePath: file\.fileName/, 'saved plan should mask local full path by default');
assert.match(persistenceService, /secretPattern/, 'saved plan persistence should strip secrets');

assert.match(gamePage, /충돌\/용량 검사와 복사 계획/, 'UI should include conflict policy area');
assert.match(gamePage, /대상 폴더 생성 dry-run/, 'UI should include folder creation dry-run area');
assert.match(gamePage, /복사 전 백업 계획/, 'UI should include backup plan area');
assert.match(gamePage, /ROM 최종 확인/, 'UI should include final confirmation modal');
assert.match(gamePage, /DRY RUN ONLY/, 'final confirmation should require dry-run phrase');
assert.match(gamePage, /실제 복사 실행/, 'copy execution button should be visible');
assert.match(gamePage, /disabled title="실제 복사는 다음 단계/, 'copy execution must remain disabled');
assert.match(gamePage, /selectRomBackupFolder/, 'UI should select backup folder for dry-run plan only');
assert.match(gamePage, /loadSavedPlan/, 'UI should load saved plans');
assert.match(gamePage, /deleteSavedPlan/, 'UI should delete saved local plans');

assert.match(main, /rom:select-backup-folder/, 'main should expose backup folder selection only');
assert.match(main, /rom:plans:load/, 'main should load saved plans');
assert.match(main, /rom:plans:save/, 'main should save local dry-run plans');
assert.match(main, /sanitizeSavedRomPlan/, 'main should sanitize saved plans');
assert.match(preload, /selectRomBackupFolder/, 'preload should expose backup folder selection');
assert.match(preload, /loadSavedRomPlans/, 'preload should expose saved plan load');
assert.match(desktopTypes, /SavedRomPlan/, 'desktop API should type saved ROM plans');

assert.doesNotMatch(main, /ipcMain\.handle\('rom:(copy|transfer|mkdir|rename|overwrite)/i, 'main must not expose ROM remote write IPC handlers');
assert.doesNotMatch(preload, /ipcRenderer\.invoke\('rom:(copy|transfer|mkdir|rename|overwrite)/i, 'preload must not expose ROM remote write IPC calls');

for (const source of [desktopTypes, gamePage, planningService, policyService, backupService, transferService, persistenceService]) {
  assert.doesNotMatch(source, /rom:(copy|transfer|mkdir|rename|overwrite)|sftp\.put|createWriteStream|scp|execCommand|runCommand/i, 'phase eight must not expose remote write/raw command IPC');
}

console.log('Phase eight ROM transfer policy tests passed.');
