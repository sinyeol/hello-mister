import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const flashService = readFileSync(new URL('../src/services/sd/sdFlash.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');

// Renderer service: real flash routes through the desktop IPC, dry-run stays non-destructive.
assert.match(flashService, /DesktopSdFlashService/, 'desktop flash service should exist');
assert.match(flashService, /flashSdImage/, 'service should call the flashSdImage IPC');
assert.match(flashService, /실제 쓰기를 수행하지 않/, 'dry-run path must clearly avoid destructive writes');

// Electron backend safety invariants for the real flash engine.
assert.match(main, /async function flashSdImage/, 'main should expose flashSdImage');
assert.match(main, /시스템 디스크에는 쓸 수 없습니다/, 'system disk must be refused');
assert.match(main, /removable SD\/USB가 아니라 차단/, 'non-removable drives must be refused');
assert.match(main, /확인 문구가 대상 드라이브 문자와 일치하지 않습니다/, 'typed confirmation must match the target drive letter');

// dry-run must return BEFORE preparing/launching the elevated writer.
const flashBody = main.slice(main.indexOf('async function flashSdImage'));
const dryReturnIdx = flashBody.indexOf('실제 포맷, 파티션 변경, 쓰기 작업은 수행하지 않았습니다');
const elevateIdx = flashBody.indexOf('관리자 권한 작업을 준비합니다');
assert.ok(dryReturnIdx > -1 && elevateIdx > -1, 'both dry-run and elevation markers should exist');
assert.ok(dryReturnIdx < elevateIdx, 'dry-run must return before the elevated write path');

// The elevated worker re-validates the disk before any destructive operation.
assert.match(main, /refused: system disk/, 'worker must refuse the system disk');
assert.match(main, /Clear-Disk -Number \$DiskNumber -RemoveData/, 'worker clears partitions before raw write');
assert.match(main, /PhysicalDrive/, 'worker writes to the raw physical drive');

console.log('SD flash safety tests passed.');
