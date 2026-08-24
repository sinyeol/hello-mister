import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const romTypes = readFileSync(new URL('../src/types/rom.ts', import.meta.url), 'utf8');
const safetyPolicy = readFileSync(new URL('../src/services/rom/romTransferSafetyPolicy.ts', import.meta.url), 'utf8');
const featureFlags = readFileSync(new URL('../src/services/rom/romTransferFeatureFlags.ts', import.meta.url), 'utf8');
const preflight = readFileSync(new URL('../src/services/rom/romTransferPreflightService.ts', import.meta.url), 'utf8');
const simulatedTransfer = readFileSync(new URL('../src/services/rom/romSimulatedTransferService.ts', import.meta.url), 'utf8');
const validationRecords = readFileSync(new URL('../src/services/rom/romValidationRecordService.ts', import.meta.url), 'utf8');
const sanitizer = readFileSync(new URL('../src/services/rom/exportSanitizer.ts', import.meta.url), 'utf8');
const transferService = readFileSync(new URL('../src/services/rom/romTransferService.ts', import.meta.url), 'utf8');
const gamePage = readFileSync(new URL('../src/pages/GameManagementPage.tsx', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../docs/DEVLOG.md', import.meta.url), 'utf8');
const main = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../electron/preload.mjs', import.meta.url), 'utf8');

assert.match(packageJson.scripts.test, /test:phase-ten/, 'npm test should include phase ten checks');

for (const typeName of [
  'RomDryRunValidationRecord',
  'RomTransferSafetyPolicy',
  'RomTransferFeatureFlags',
  'RomTransferKillSwitchState',
  'RomTransferPreflightResult',
  'RomSimulatedTransferSession',
]) {
  assert.match(romTypes, new RegExp(typeName), `${typeName} should exist`);
}

assert.match(safetyPolicy, /requireBackupForReplace: true/, 'replaceLater must require backup policy');
assert.match(safetyPolicy, /\.__hello-mister-uploading/, 'temp file suffix policy should be explicit');
assert.match(safetyPolicy, /requireExplicitHashForLargeFiles: true/, 'large hash verification should require opt-in');
assert.match(safetyPolicy, /AUTH_FAILED[\s\S]*HOST_KEY_MISMATCH/, 'auth and host key mismatch should be non-retryable');
assert.match(safetyPolicy, /simulatedCancelOnly: true/, 'cancel policy should be simulated-only in phase ten');
assert.match(safetyPolicy, /remoteCleanupImplemented: false/, 'remote cleanup must not be implemented');

assert.match(featureFlags, /transferEnabled: false/, 'transfer flag should default disabled');
assert.match(featureFlags, /uploadEnabled: false/, 'upload flag should default disabled');
assert.match(featureFlags, /mkdirEnabled: false/, 'mkdir flag should default disabled');
assert.match(featureFlags, /overwriteEnabled: false/, 'overwrite flag should default disabled');
assert.match(featureFlags, /deleteEnabled: false/, 'delete flag should default disabled');
assert.match(featureFlags, /renameEnabled: false/, 'rename flag should default disabled');
assert.match(featureFlags, /romTransferKillSwitch: true/, 'global kill switch should default active');

assert.match(preflight, /NO_SESSION_CREDENTIAL/, 'preflight should block missing session credentials');
assert.match(preflight, /HOST_KEY_MISMATCH/, 'preflight should block host key mismatch');
assert.match(preflight, /MISSING_BACKUP_PLAN/, 'preflight should block replace without backup plan');
assert.match(preflight, /canExecute: false/, 'preflight canExecute should remain false');

assert.match(simulatedTransfer, /remoteWritesPerformed: false/, 'simulation must record zero remote writes');
assert.match(simulatedTransfer, /network-timeout/, 'simulation should support network timeout failure mode');
assert.match(simulatedTransfer, /verify-failed/, 'simulation should support verify failure mode');
assert.match(simulatedTransfer, /storage-changed/, 'simulation should support storage changed failure mode');
assert.match(simulatedTransfer, /user-cancel/, 'simulation should support user cancel mode');
assert.doesNotMatch(simulatedTransfer, /\bsftp\.(put|mkdir|rename|unlink)|createWriteStream|scp|execCommand|runCommand/i, 'simulation must not implement remote write/raw command operations');

assert.match(sanitizer, /secretKeyPattern/, 'shared export sanitizer should remove secrets');
assert.match(validationRecords, /sanitizeForExport/, 'validation record store should use shared sanitizer');
assert.match(validationRecords, /includesFullLocalPaths: false/, 'validation records should hide full paths by default');
assert.doesNotMatch(validationRecords, /localPath:/, 'validation record exports should not persist local full path fields');

assert.match(transferService, /ROM_TRANSFER_DISABLED/, 'executeTransfer should keep disabled result');
assert.match(transferService, /ROM_TRANSFER_LOCKED/, 'executeTransfer should expose locked result while kill switch is active');
assert.doesNotMatch(transferService, /\bsftp\.(put|mkdir|rename|unlink)|createWriteStream|scp|execCommand|runCommand/i, 'transfer service must not implement remote writes/raw command operations');

for (const uiText of [
  '실제 장치 dry-run 검증 기록',
  '전송 안전 정책',
  '전송 preflight와 시뮬레이션',
  '원격 파일 변경 없음',
  '실제 복사 아님',
  'preflight 다시 계산',
]) {
  assert.match(gamePage, new RegExp(uiText), `Game page should show ${uiText}`);
}

for (const docsText of [
  '10차 작업',
  'feature flag / kill switch',
  'simulated transfer runner',
  'preflight guard 조건',
  '실제 ROM 복사가 계속 disabled인 이유',
]) {
  assert.match(readme, new RegExp(docsText), `README should document ${docsText}`);
}

assert.doesNotMatch(main, /ipcMain\.handle\('rom:(copy|transfer|mkdir|rename|overwrite|upload|delete)/i, 'main must not expose ROM write IPC');
assert.doesNotMatch(preload, /ipcRenderer\.invoke\('rom:(copy|transfer|mkdir|rename|overwrite|upload|delete)/i, 'preload must not expose ROM write IPC');
assert.doesNotMatch(preload, /rawCommand|execCommand|runCommand/i, 'raw command IPC must remain hidden');

console.log('Phase ten ROM transfer lock tests passed.');
