import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fingerprint = readFileSync(new URL('../src/services/mister/fingerprint.ts', import.meta.url), 'utf8');
const profileStore = readFileSync(new URL('../src/services/mister/profileStore.ts', import.meta.url), 'utf8');
const sdDetection = readFileSync(new URL('../src/services/sd/sdCardDetection.ts', import.meta.url), 'utf8');
const taskQueue = readFileSync(new URL('../src/services/tasks/taskQueue.ts', import.meta.url), 'utf8');
const sdPage = readFileSync(new URL('../src/pages/SdCardManagementPage.tsx', import.meta.url), 'utf8');
const misterPage = readFileSync(new URL('../src/pages/MisterConnectionPage.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../electron/preload.mjs', import.meta.url), 'utf8');

assert.match(fingerprint, /MiSTer @ \$\{candidate\.ipAddress\} \/ MAC \$\{suffix\}/, 'duplicate hostname display should include IP and MAC suffix');
assert.match(fingerprint, /candidate\.ipAddress/, 'candidate display should be anchored by IP address');
assert.match(fingerprint, /formatPortProbeSummary/, 'port probe formatter should exist');

assert.match(profileStore, /sanitizeProfile/, 'profile store should sanitize records before persistence');
assert.match(profileStore, /alias/, 'profile store should keep alias');
assert.match(profileStore, /ipAddress/, 'profile store should keep IP address');
assert.match(profileStore, /macAddress/, 'profile store should keep MAC address');
assert.match(profileStore, /passwordMode/, 'profile store may persist password mode policy');
assert.match(profileStore, /savedSafeStorage/, 'profile store should understand encrypted saved password mode');
assert.match(profileStore, /saveProfilePassword/, 'profile store should route password saves through desktop safe storage');
assert.match(profileStore, /autoConnect: false/, 'profile store should disable auto-connect during sanitization');
assert.match(profileStore, /deleteProfile/, 'profile store should support saved MiSTer deletion');
assert.doesNotMatch(profileStore.match(/function sanitizeProfile[\\s\\S]*?\\n}/)?.[0] ?? '', /password\s*:/i, 'profile records must not include a persisted password field');
assert.doesNotMatch(profileStore, /privateKey\s*:/i, 'profile store must not persist private keys');
assert.doesNotMatch(profileStore, /passphrase\s*:/i, 'profile store must not persist passphrases');
assert.doesNotMatch(profileStore, /token\s*:/i, 'profile store must not persist tokens');

assert.match(main, /safeStorage/, 'Electron main should use safeStorage for saved MiSTer passwords');
assert.match(main, /mister-profile-credentials\.json/, 'encrypted credential entries should live in a separate appData file');
assert.match(preload, /saveMisterProfilePassword/, 'preload should expose encrypted password save IPC');

assert.match(sdDetection, /isDriveSelectableForMrFusion/, 'drive selectability helper should exist');
assert.match(sdDetection, /drive\.systemDisk/, 'system drives must be rejected');
assert.match(sdDetection, /formatSdStructureSummary/, 'SD structure formatter should exist');
assert.match(sdPage, /inspectStructure/, 'SD structure check UI should exist');

assert.match(taskQueue, /subscribe/, 'task queue logging should support UI subscriptions');
assert.match(misterPage, /MiSTer IP/, 'basic MiSTer connection should use direct IP input');
assert.match(misterPage, /defaultMisterPassword = '1'/, 'default MiSTer password input value should remain 1');
assert.match(misterPage, /> 연결</, 'direct IP profiles should connect only through an explicit manual connection button');
assert.match(misterPage, /autoConnect: false/, 'direct IP profiles should not auto-connect by default');
assert.match(misterPage, /setDeleteTarget/, 'saved MiSTer profiles should be deletable');
assert.doesNotMatch(misterPage, /연결 테스트/, 'user-facing connection action should be named 연결');

assert.doesNotMatch(preload, /rawCommand|execCommand|runCommand/i, 'raw command IPC must remain hidden');
assert.doesNotMatch(preload, /ipcRenderer\.invoke\('rom:(copy|transfer|mkdir|rename|overwrite|upload|delete)/i, 'ROM write IPC must remain hidden');

console.log('Phase two safety tests passed.');