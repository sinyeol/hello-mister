import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../electron/preload.mjs', import.meta.url), 'utf8');
const remote = readFileSync(new URL('../src/services/mister/remote.ts', import.meta.url), 'utf8');
const profileStore = readFileSync(new URL('../src/services/mister/profileStore.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/types/mister.ts', import.meta.url), 'utf8');

assert.match(types, /SshCredentialInput/, 'SSH credential input type should exist');
assert.match(types, /MisterRemoteFingerprint/, 'remote fingerprint type should exist');
assert.match(types, /DiagnosticPackage/, 'diagnostic package type should exist');

assert.match(remote, /sanitizeCredentialInput/, 'credential sanitizer should exist');
assert.match(remote, /stripDiagnosticSecrets/, 'diagnostic package should remove secrets');
assert.match(remote, /formatFingerprintSummary/, 'fingerprint summary formatter should exist');
assert.match(remote, /formatRemotePathStatus/, 'remote path status formatter should exist');

assert.match(profileStore, /passwordMode/, 'profile store may persist password mode policy');
assert.doesNotMatch(profileStore.match(/function sanitizeProfile[\\s\\S]*?\\n}/)?.[0] ?? '', /password\s*:/i, 'profile records must not include a persisted password field');
assert.doesNotMatch(profileStore, /privateKey\s*:/i, 'profile store must not persist private keys');
assert.doesNotMatch(profileStore, /passphrase\s*:/i, 'profile store must not persist passphrases');
assert.doesNotMatch(profileStore, /token\s*:/i, 'profile store must not persist tokens');

assert.match(main, /sshSessions = new Map/, 'SSH session credentials should be memory-only');
assert.match(main, /세션 인증 정보를 메모리에서 지웠습니다|sshSessions\.delete/s, 'session clear path should exist');
assert.match(main, /assertReadOnlyCommand/, 'read-only command whitelist should exist');
assert.match(main, /commandContainsForbiddenToken/, 'forbidden command guard should exist');
for (const forbidden of ['rm', 'mv', 'cp', 'dd', 'mkfs', 'parted', 'fdisk', 'reboot', 'shutdown', 'chmod', 'chown', 'mount', 'umount', 'wget', 'curl', 'bash', 'source']) {
  assert.ok(main.includes(forbidden), `forbidden command ${forbidden} should be guarded`);
}

assert.doesNotMatch(preload, /execCommand|rawCommand|runCommand/i, 'preload must not expose raw command execution');
assert.match(preload, /fingerprintMister/, 'preload should expose fingerprint action only');
assert.match(preload, /readRemoteMisterIni/, 'preload should expose INI read action');
assert.match(preload, /listRemoteGames/, 'preload should expose games list action');
assert.match(preload, /listRemoteScripts/, 'preload should expose scripts list action');

console.log('Phase three remote read-only tests passed.');
