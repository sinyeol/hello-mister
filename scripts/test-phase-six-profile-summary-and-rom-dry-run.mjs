import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const main = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../electron/preload.mjs', import.meta.url), 'utf8');
const desktopTypes = readFileSync(new URL('../src/types/desktop.ts', import.meta.url), 'utf8');
const misterTypes = readFileSync(new URL('../src/types/mister.ts', import.meta.url), 'utf8');
const remote = readFileSync(new URL('../src/services/mister/remote.ts', import.meta.url), 'utf8');
const profileSummary = readFileSync(new URL('../src/services/mister/profileSummary.ts', import.meta.url), 'utf8');
const connectionPage = readFileSync(new URL('../src/pages/MisterConnectionPage.tsx', import.meta.url), 'utf8');
const backupPage = readFileSync(new URL('../src/pages/BackupDiagnosticsPage.tsx', import.meta.url), 'utf8');
const gamePage = readFileSync(new URL('../src/pages/GameManagementPage.tsx', import.meta.url), 'utf8');
const romTypes = readFileSync(new URL('../src/types/rom.ts', import.meta.url), 'utf8');
const romPlanning = readFileSync(new URL('../src/services/rom/romPlanningService.ts', import.meta.url), 'utf8');
const romConflict = readFileSync(new URL('../src/services/rom/romConflictService.ts', import.meta.url), 'utf8');
const romStorage = readFileSync(new URL('../src/services/rom/romStorageCheckService.ts', import.meta.url), 'utf8');

assert.match(packageJson.scripts.test, /test:phase-six/, 'npm test should include phase six checks');

assert.match(misterTypes, /MisterProfileSummary/, 'profile summary type should exist');
assert.match(main, /mister-profile-summary\.json/, 'profile summaries should persist in a separate appData JSON file');
assert.match(main, /sanitizeProfileSummary/, 'profile summary persistence should be sanitized');
assert.match(preload, /loadMisterProfileSummaries/, 'preload should expose profile summary load');
assert.match(preload, /saveMisterProfileSummary/, 'preload should expose profile summary save');
assert.match(preload, /clearMisterProfileSummary/, 'preload should expose profile summary clear');
assert.match(desktopTypes, /MisterProfileSummary/, 'desktop API type should include profile summaries');
assert.match(profileSummary, /password\|privateKey\|passphrase\|token\|secret\|credential\|rawCommand/i, 'profile summary store should strip secrets');
assert.doesNotMatch(profileSummary.match(/interface|export interface/g)?.join('') ?? '', /password|privateKey|passphrase|token/i, 'profile summary type should not define credential fields');

assert.match(misterTypes, /ReadOnlyIntegrationTestSummary/, 'integration result should include a summary structure');
assert.match(remote, /successfulSteps/, 'integration summary should count successful steps');
assert.match(remote, /blockedSteps/, 'integration summary should count blocked steps');
assert.match(remote, /AUTH_FAILED/, 'integration guard should classify missing session as auth failed');
assert.match(remote, /HOST_KEY_UNTRUSTED/, 'integration guard should classify missing host key trust');

assert.match(connectionPage, /readOnlySummary/, 'connection profile cards should show cached read-only summary');
assert.match(connectionPage, /summaryStore\.saveSummary/, 'connection flow should update profile summary cache');
assert.match(connectionPage, /setSummaries\(await summaryStore\.loadSummaries/, 'connection flow should refresh summary state after updates');
assert.match(connectionPage, /saveProfilePassword/, 'connection page should save passwords only through the safe profile password store');
assert.match(connectionPage, /fingerprintSavedProfile/, 'saved profiles should connect through the main-process stored password flow');
assert.match(connectionPage, /password: passwordOverride \|\| defaultMisterPassword/, 'unsaved/manual attempts can pass an in-memory password for the current attempt');
assert.doesNotMatch(connectionPage, /const profile: MisterDeviceProfile = \{[\s\S]{0,900}password\s*:/i, 'persisted profile objects should not include password fields');

assert.match(backupPage, /runReadOnlyTest|read-only|ReadOnlyIntegration/i, 'manual read-only verification panel should exist');
assert.match(backupPage, /createProfileSummaryFromIntegration/, 'integration result should update profile summary');
assert.match(backupPage, /taskQueue/, 'manual flow should record task logs');

assert.match(romTypes, /RomFileCandidate/, 'ROM candidate type should exist');
assert.match(romTypes, /RomCopyPlan/, 'ROM copy plan type should exist');
assert.match(romTypes, /RomDryRunResult/, 'ROM dry-run result type should exist');
assert.match(romPlanning, /dryRun: true/, 'ROM planning should still model copy-before-check semantics internally');
assert.match(romPlanning, /readOnly: true/, 'ROM planning remains read-only until transfer is deliberately opened');
assert.match(gamePage, /dry-run|미리 검사|복사 전 확인/, 'game page should expose ROM pre-copy checking');
assert.match(gamePage, /disabled/, 'ROM write actions should remain guarded in the UI');
for (const source of [romPlanning, romConflict, romStorage]) {
  assert.doesNotMatch(source, /\b(copyFile|writeFile|unlink|rename|chmod|chown|scp)\b|rm\(|sftp\.put/i, 'ROM dry-run code must not expose write actions');
}
assert.doesNotMatch(gamePage, /helloMisterDesktop\?.*(copy|delete|rename|overwrite)|rom:(copy|delete|rename|overwrite)/i, 'Game page must not call ROM write/delete/rename adapters');

assert.doesNotMatch(preload, /rawCommand|execCommand|runCommand/i, 'raw command IPC must remain hidden');
assert.match(remote, /stripDiagnosticSecrets/, 'diagnostics should continue stripping secrets');

console.log('Phase six profile summary and ROM dry-run tests passed.');