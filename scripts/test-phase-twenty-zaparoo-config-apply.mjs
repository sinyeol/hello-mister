import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

async function importApplyService() {
  const source = read('src/services/zaparoo/zaparooConfigApplyService.ts')
    .replace("import { zaparooConfigPath } from './zaparooConfigDiagnostics';", "const zaparooConfigPath = '/media/fat/zaparoo/config.toml';");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

const service = await importApplyService();
const {
  buildZaparooConfigPatchPlan,
  createZaparooConfigRecommendation,
  formatZaparooConfigApplyResult,
  isAllowedZaparooConfigWritePath,
  validateZaparooConfigApplyBackups,
  zaparooConfigBackupFileName,
  zaparooSettingsReloadFailureMessage,
} = service;

const fixedDate = new Date('2026-05-29T12:34:56Z');
const singleIp = createZaparooConfigRecommendation('single-ip', ['192.168.1.50']);
assert.deepEqual(singleIp.allowedIps, ['192.168.1.50'], 'single IP recommendation should include only the current PC IP');
assert.deepEqual(singleIp.allowRun, ['**launch:/media/fat/(games|_Arcade)/.*'], 'allow_run recommendation should be conservative');

const subnet = createZaparooConfigRecommendation('subnet-24', ['192.168.1.50']);
assert.deepEqual(subnet.allowedIps, ['192.168.1.0/24'], '/24 recommendation should include the local subnet');

const noService = buildZaparooConfigPatchPlan('[media]\npath = "/media/fat/games"\n', singleIp, fixedDate);
assert.match(noService.nextPreview, /\[service\]/, 'missing service section should be added');
assert.match(noService.nextPreview, /api_port = 7497/, 'api_port should be added');
assert.match(noService.nextPreview, /api_listen = "0\.0\.0\.0"/, 'api_listen should be added');
assert.match(noService.nextPreview, /allowed_ips = \[/, 'allowed_ips should be added');
assert.match(noService.nextPreview, /allow_run = \[/, 'allow_run should be added');
assert.match(noService.nextPreview, /\[media\]/, 'existing sections should be preserved');
assert.equal(noService.remoteBackupPath, '/media/fat/zaparoo/backups/config.toml.20260529-123456.bak', 'remote backup path should be deterministic');
assert.equal(noService.localBackupRelativePath, 'backups/zaparoo/config.toml.20260529-123456.bak', 'local backup relative path should be deterministic');
assert.match(noService.diffPreview, /\+ \[service\]/, 'diff should show service section addition');

const existingService = buildZaparooConfigPatchPlan('[service]\napi_port = 7497\n\n[other]\nvalue = true\n', singleIp, fixedDate);
assert.match(existingService.nextPreview, /\[service\][\s\S]*allowed_ips = \[/, 'existing service section should receive allowed_ips');
assert.match(existingService.nextPreview, /\[service\][\s\S]*allow_run = \[/, 'existing service section should receive allow_run');
assert.match(existingService.nextPreview, /\[other\]\nvalue = true/, 'later sections should remain intact');

const updatedValues = buildZaparooConfigPatchPlan('[service]\nallowed_ips = ["10.0.0.3"]\nallow_run = ["old"]\n', singleIp, fixedDate);
assert.ok(updatedValues.changes.some((change) => change.key === 'allowed_ips' && change.action === 'update'), 'allowed_ips change should be marked update');
assert.ok(updatedValues.changes.some((change) => change.key === 'allow_run' && change.action === 'update'), 'allow_run change should be marked update');
assert.match(updatedValues.diffPreview, /# allowed_ips: update/, 'diff should include allowed_ips update');
assert.match(updatedValues.diffPreview, /# allow_run: update/, 'diff should include allow_run update');

assert.equal(zaparooConfigBackupFileName(fixedDate), 'config.toml.20260529-123456.bak', 'backup file name should match required timestamp format');
assert.equal(isAllowedZaparooConfigWritePath('/media/fat/zaparoo/config.toml'), true, 'config.toml write path should be allowed');
assert.equal(isAllowedZaparooConfigWritePath('/media/fat/zaparoo/backups/config.toml.20260529-123456.bak'), true, 'timestamped backup path should be allowed');
assert.equal(isAllowedZaparooConfigWritePath('/media/fat/zaparoo/mappings/foo.txt'), false, 'other Zaparoo paths must be blocked');
assert.equal(isAllowedZaparooConfigWritePath('/media/fat/games/NES/foo.nes'), false, 'ROM paths must be blocked');

assert.equal(validateZaparooConfigApplyBackups({ confirmed: false, localBackupOk: true, remoteBackupOk: true }).ok, false, 'confirmation should be required');
assert.equal(validateZaparooConfigApplyBackups({ confirmed: true, localBackupOk: false, remoteBackupOk: false }).ok, false, 'backup-less apply should be blocked');
const remoteFailed = validateZaparooConfigApplyBackups({ confirmed: true, localBackupOk: true, remoteBackupOk: false });
assert.equal(remoteFailed.ok, false, 'remote backup failure should require extra confirmation');
assert.equal(remoteFailed.requiresLocalBackupOnlyConfirmation, true, 'local-only continuation should be explicit');
assert.equal(validateZaparooConfigApplyBackups({ confirmed: true, localBackupOk: true, remoteBackupOk: false, allowLocalBackupOnly: true }).ok, true, 'local backup only should pass when explicitly confirmed');

assert.match(zaparooSettingsReloadFailureMessage(), /reload에 실패했습니다/, 'settings.reload failure message should guide restart');
assert.match(formatZaparooConfigApplyResult({ ok: false, path: '/media/fat/zaparoo/config.toml', remoteBackupOk: false, localBackupOk: true, applied: false, reloadAttempted: false, reloadOk: false, requiresLocalBackupOnlyConfirmation: true, message: 'remote backup failed' }), /로컬 백업만으로 계속/, 'formatter should mention local backup confirmation');
assert.match(formatZaparooConfigApplyResult({ ok: true, path: '/media/fat/zaparoo/config.toml', remoteBackupOk: true, localBackupOk: true, applied: true, reloadAttempted: true, reloadOk: false, message: 'reload failed' }), /재시작하거나 MiSTer를 재부팅/, 'formatter should mention restart when reload fails');

const main = read('electron/main.mjs');
const preload = read('electron/preload.mjs');
const desktopTypes = read('src/types/desktop.ts');
const misterPage = read('src/features/sticker-v1/pages/MisterFpgaPage.tsx');
const readme = read('docs/DEVLOG.md');

assert.match(main, /ipcMain\.handle\('zaparoo:config:preview-apply'/, 'main should expose fixed preview apply IPC');
assert.match(main, /ipcMain\.handle\('zaparoo:config:apply'/, 'main should expose fixed config apply IPC');
assert.match(main, /isAllowedZaparooConfigWritePath/, 'main must guard every remote config write path');
assert.match(main, /sftpWriteZaparooConfigFile/, 'main should use a narrow SFTP write helper');
assert.match(main, /settings\.reload/, 'main should try settings.reload after applying config');
assert.match(preload, /zaparooPreviewConfigApply/, 'preload should expose preview apply API');
assert.match(preload, /zaparooApplyConfigRecommendation/, 'preload should expose apply API');
assert.match(desktopTypes, /zaparooApplyConfigRecommendation/, 'desktop types should include config apply API');
assert.match(misterPage, /developerMode && \(/, 'Zaparoo config apply wizard should be gated behind developer mode');
assert.match(misterPage, /추천 설정 만들기/, 'MiSTer game list should show recommendation wizard');
assert.match(misterPage, /백업 후 적용/, 'MiSTer game list should expose explicit backup apply button');
assert.match(misterPage, /원격 파일 쓰기는 Zaparoo config\.toml과 해당 백업 파일로만 제한됩니다/, 'UI should state narrow remote write scope');
assert.match(readme, /Zaparoo config.toml 안전 적용 마법사/, 'README should document the safe config apply wizard');

assert.doesNotMatch(main, /ipcMain\.handle\('zaparoo:rpc'/, 'arbitrary Zaparoo RPC IPC must remain absent');
assert.doesNotMatch(preload, /raw.*command|command:raw/i, 'raw command IPC must remain absent');
assert.doesNotMatch(main, /ipcMain\.handle\('rom:(copy|transfer|mkdir|rename|overwrite|delete|upload)'/, 'ROM write IPC must remain absent');
assert.doesNotMatch(preload, /rom:(copy|transfer|mkdir|rename|overwrite|delete|upload)/, 'preload must not expose ROM write IPC');

console.log('phase twenty Zaparoo safe config apply wizard tests passed.');
