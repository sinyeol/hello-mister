import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../electron/preload.mjs', import.meta.url), 'utf8');
const remote = readFileSync(new URL('../src/services/mister/remote.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/types/mister.ts', import.meta.url), 'utf8');
const connectionPage = readFileSync(new URL('../src/pages/MisterConnectionPage.tsx', import.meta.url), 'utf8');

assert.match(types, /SshKnownHostEntry/, 'known host type should exist');
assert.match(types, /SshHostKeyCheckResult/, 'host key check result type should exist');
assert.match(types, /RemoteErrorCode/, 'remote error code type should exist');

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
  assert.ok(types.includes(`'${code}'`), `${code} should be part of RemoteErrorCode`);
  assert.ok(main.includes(code), `${code} should be classified in main process`);
}

assert.match(main, /known-ssh-hosts\.json/, 'known hosts should use a separate store');
assert.match(main, /sanitizeKnownHost/, 'known host entries should be sanitized');
assert.doesNotMatch(main.match(/function sanitizeKnownHost[\s\S]*?\n}/)?.[0] ?? '', /password|privateKey|passphrase|token/i, 'known host store must not save secrets');
assert.match(main, /parseHostKey/, 'host key parsing should exist');
assert.match(main, /SHA256/, 'SHA256 fingerprint should be used');
assert.match(main, /HOST_KEY_MISMATCH/, 'host key mismatch should be classified');
assert.match(main, /HOST_KEY_UNTRUSTED/, 'untrusted host key should be classified');
assert.match(main, /compareHostKey/, 'host key compare should gate SSH use');

assert.match(preload, /inspectSshHostKey/, 'preload should expose host key inspection action');
assert.match(preload, /trustSshHostKey/, 'preload should expose trust action');
assert.match(preload, /removeSshKnownHost/, 'preload should expose known host removal for advanced flows');
assert.doesNotMatch(preload, /rawCommand|execCommand|runCommand/i, 'raw command IPC must remain hidden');

assert.match(remote, /formatHostKeyStatus/, 'host key status formatter should exist');
assert.match(remote, /stripDiagnosticSecrets/, 'diagnostic secrets should be removed');
assert.match(connectionPage, /새 MiSTer 장치 신뢰 키 등록/, 'connection UI should include simplified host key trust flow');
assert.match(connectionPage, /이 MiSTer 신뢰하고 연결/, 'connection UI should include trust button');
assert.match(connectionPage, /고급 모드의 내부 진단에서 상세를 확인/, 'basic mismatch UI should point detailed review to advanced internal diagnostics');
assert.match(connectionPage, /status === 'mismatch'/, 'mismatch should block direct trust');

console.log('Phase four SSH trust tests passed.');
