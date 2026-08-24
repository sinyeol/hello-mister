import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../electron/preload.mjs', import.meta.url), 'utf8');
const remote = readFileSync(new URL('../src/services/mister/remote.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/types/mister.ts', import.meta.url), 'utf8');
const desktopTypes = readFileSync(new URL('../src/types/desktop.ts', import.meta.url), 'utf8');
const taskQueue = readFileSync(new URL('../src/services/tasks/taskQueue.ts', import.meta.url), 'utf8');
const connectionPage = readFileSync(new URL('../src/pages/MisterConnectionPage.tsx', import.meta.url), 'utf8');
const backupPage = readFileSync(new URL('../src/pages/BackupDiagnosticsPage.tsx', import.meta.url), 'utf8');

assert.match(types, /SshKnownHostHistoryEntry/, 'host key history type should exist');
assert.match(main, /known-ssh-host-history\.json/, 'known host history should have a separate store');
assert.match(main, /sanitizeKnownHostHistory/, 'known host history should be sanitized');
assert.doesNotMatch(main.match(/function sanitizeKnownHostHistory[\s\S]*?\n}/)?.[0] ?? '', /password|privateKey|passphrase|token/i, 'known host history must not save secrets');
assert.match(main, /replace-blocked-remove-old-trust-first/, 'host key mismatch should not be replaced directly');
assert.match(main, /action: 'removed'/, 'known host removal should be recorded in history');
assert.match(preload, /listSshKnownHostHistory/, 'preload should expose known host history listing');
assert.match(desktopTypes, /listSshKnownHostHistory/, 'desktop API type should expose known host history listing');

assert.match(connectionPage, /pendingTrust/, 'basic connection should keep first host key confirmation state');
assert.match(connectionPage, /새 MiSTer 장치 신뢰 키 등록/, 'first host key should use a simplified confirmation panel');
assert.match(connectionPage, /이 MiSTer 신뢰하고 연결/, 'user must explicitly trust a new key');
assert.match(connectionPage, /status === 'mismatch'/, 'host key mismatch should be handled explicitly');
assert.match(connectionPage, /HOST_KEY_MISMATCH/, 'host key mismatch should be recorded as a classified error');
assert.match(connectionPage, /고급 모드의 내부 진단에서 상세를 확인/, 'detailed mismatch review should be moved out of basic flow');

for (const code of [
  'NETWORK_TIMEOUT',
  'CONNECTION_REFUSED',
  'HOST_KEY_UNTRUSTED',
  'HOST_KEY_MISMATCH',
  'AUTH_FAILED',
  'SSH_NEGOTIATION_FAILED',
  'SFTP_UNAVAILABLE',
  'REMOTE_PATH_MISSING',
  'NOT_MISTER',
  'READ_PERMISSION_DENIED',
  'COMMAND_BLOCKED',
  'UNKNOWN_REMOTE_ERROR',
]) {
  assert.match(remote, new RegExp(`${code}: \\{`), `${code} should have an error guide`);
}
assert.doesNotMatch(remote, /AUTH_FAILED[\s\S]{0,260}password.*\$\{/i, 'AUTH_FAILED guide should not echo secrets');

assert.match(main, /task-log\.json/, 'task logs should persist in appData JSON');
assert.match(main, /sanitizeTaskLog/, 'main process should sanitize task logs');
assert.match(taskQueue, /maxTaskLogCount = 100/, 'task queue should keep only 100 recent logs');
assert.match(taskQueue, /loadTaskLogs/, 'task queue should load persisted logs');
assert.match(taskQueue, /saveTaskLogs/, 'task queue should save persisted logs');
assert.match(taskQueue, /exportTaskLogs/, 'task queue should export sanitized logs');
assert.match(taskQueue, /secretKeyPattern/, 'task queue should sanitize secret-like fields');

assert.match(remote, /runReadOnlyIntegrationTest/, 'read-only integration test service should exist');
assert.match(remote, /Boolean\(input\.sessionId\)/, 'integration test should guard session credential state');
assert.match(remote, /knownHost/, 'integration test should guard trusted host key state');
assert.match(backupPage, /read-only/, 'diagnostics page should expose safe integration test panel');
assert.match(backupPage, /host key|knownHost|HOST_KEY_UNTRUSTED/i, 'diagnostics page should show host key guard state');
assert.doesNotMatch(preload, /rawCommand|execCommand|runCommand/i, 'raw command IPC must remain hidden');

assert.match(remote, /stripDiagnosticSecrets/, 'diagnostics should strip secrets');
assert.match(remote, /private.*path\|key.*path/i, 'diagnostics should mask private key paths');

console.log('Phase five trust history and persistent log tests passed.');
