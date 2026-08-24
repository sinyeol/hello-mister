import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const romTypes = readFileSync(new URL('../src/types/rom.ts', import.meta.url), 'utf8');
const sanitizer = readFileSync(new URL('../src/services/rom/exportSanitizer.ts', import.meta.url), 'utf8');
const validationAnalysis = readFileSync(new URL('../src/services/rom/romValidationRecordAnalysisService.ts', import.meta.url), 'utf8');
const dryRunReport = readFileSync(new URL('../src/services/rom/romDryRunReportService.ts', import.meta.url), 'utf8');
const simulationReport = readFileSync(new URL('../src/services/rom/romSimulationReportService.ts', import.meta.url), 'utf8');
const policyMessages = readFileSync(new URL('../src/services/rom/romPolicyMessageService.ts', import.meta.url), 'utf8');
const readiness = readFileSync(new URL('../src/services/rom/romTransferReadinessService.ts', import.meta.url), 'utf8');
const gamePage = readFileSync(new URL('../src/pages/GameManagementPage.tsx', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../docs/DEVLOG.md', import.meta.url), 'utf8');
const main = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../electron/preload.mjs', import.meta.url), 'utf8');

assert.match(packageJson.scripts.test, /test:phase-eleven/, 'npm test should include phase eleven checks');

for (const typeName of [
  'RomDryRunValidationGrade',
  'RomDryRunValidationComparison',
  'RomDryRunValidationFilter',
  'RomDryRunValidationSort',
  'RomDryRunReport',
  'RomSimulatedTransferRecord',
  'RomSimulatedTransferReport',
  'RomTransferReadinessChecklist',
]) {
  assert.match(romTypes, new RegExp(typeName), `${typeName} should exist`);
}

assert.match(sanitizer, /secretKeyPattern/, 'export sanitizer should remove secret-like fields');
assert.match(sanitizer, /maskLocalPath/, 'export sanitizer should mask local full paths');
assert.match(sanitizer, /includeFullLocalPaths/, 'export sanitizer should support explicit full path export');

assert.match(validationAnalysis, /calculateValidationGrade/, 'validation grade calculation should exist');
assert.match(validationAnalysis, /compareValidationRecords/, 'validation record comparison should exist');
assert.match(validationAnalysis, /filterValidationRecords/, 'validation record filtering should exist');
assert.match(validationAnalysis, /sortValidationRecords/, 'validation record sorting should exist');

assert.match(dryRunReport, /RomDryRunReportService/, 'dry-run report service should exist');
assert.match(dryRunReport, /ROM dry-run 검증 리포트/, 'dry-run report should support Markdown output');
assert.match(dryRunReport, /canExecute: false/, 'dry-run report should state canExecute false');
assert.match(dryRunReport, /sanitizeForExport/, 'dry-run report should sanitize exports');

assert.match(simulationReport, /RomSimulationReportService/, 'simulation report service should exist');
assert.match(simulationReport, /이 리포트는 시뮬레이션 결과입니다/, 'simulation report must identify simulation');
assert.match(simulationReport, /원격 MiSTer에는 어떤 파일도 쓰지 않았습니다/, 'simulation report must say no remote writes');
assert.match(simulationReport, /실제 ROM 복사가 아닙니다/, 'simulation report must say it is not real copy');
assert.match(simulationReport, /remoteWritesPerformed: false/, 'simulation records should preserve no-write invariant');

for (const text of [
  '덮어쓰기 예정 파일은 백업 계획 없이는 진행할 수 없습니다',
  '임시 파일명으로 업로드한 뒤 검증 후 전환',
  'SHA-256 검증은 사용자가 직접 선택',
  'host key mismatch',
  '시뮬레이션 취소만 지원',
  '자동 rollback은 제한적',
]) {
  assert.match(policyMessages, new RegExp(text), `policy message should include ${text}`);
}

assert.match(policyMessages, /formatPreflightBlocker/, 'preflight blocker Korean formatter should exist');
assert.match(policyMessages, /KILL_SWITCH_ACTIVE/, 'kill switch message should be explicit');
assert.match(policyMessages, /FEATURE_FLAG_DISABLED/, 'feature flag disabled message should be explicit');

assert.match(readiness, /createDefaultReadinessChecklist/, 'readiness checklist default should exist');
assert.match(readiness, /실제 MiSTer에서 dry-run 검증 기록 3회 이상/, 'readiness checklist should require real-device dry-runs');
assert.match(readiness, /write IPC가 아직 노출되지 않았는지 확인/, 'readiness checklist should include write IPC check');
assert.match(readiness, /raw command IPC가 없는지 확인/, 'readiness checklist should include raw command check');
assert.match(readiness, /canConsiderRealTransfer: false/, 'readiness checklist must not enable real transfer');

for (const uiText of [
  'Markdown 리포트',
  'JSON 리포트',
  '검증 기록 메모',
  '이전/현재 기록 비교',
  '시뮬레이션 기록과 리포트',
  '실제 전송 기능 검토 체크리스트',
  '실제 전송 활성화',
]) {
  assert.match(gamePage, new RegExp(uiText), `Game page should show ${uiText}`);
}

for (const docsText of [
  '11차 작업',
  'dry-run 검증 리포트',
  'simulated transfer 리포트',
  '실제 transfer adapter 전 체크리스트',
  'export sanitize',
]) {
  assert.match(readme, new RegExp(docsText), `README should document ${docsText}`);
}

assert.doesNotMatch(main, /ipcMain\.handle\('rom:(copy|transfer|mkdir|rename|overwrite|upload|delete)/i, 'main must not expose ROM write IPC');
assert.doesNotMatch(preload, /ipcRenderer\.invoke\('rom:(copy|transfer|mkdir|rename|overwrite|upload|delete)/i, 'preload must not expose ROM write IPC');
assert.doesNotMatch(preload, /rawCommand|execCommand|runCommand/i, 'raw command IPC must remain hidden');

console.log('Phase eleven ROM readiness report tests passed.');
