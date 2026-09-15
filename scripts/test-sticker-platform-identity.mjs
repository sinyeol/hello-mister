// Regression test for new-platform discovery of arcade cores installed flat under /media/fat/_Arcade.
// 2026-09-15: CPS-3 (jtcps3) MRAs were split into their own platform, but the identity keys inherited "arcade"
// from the _Arcade folder name, so the platform collided with the generic "Arcade" platform, never appeared as a
// new platform and could not be imported at all.
import assert from 'node:assert/strict';
import { importTs, readRepoFile } from './sticker-v1-test-utils.mjs';

const { parseMiSTerPathList } = await importTs('src/features/sticker-v1/services/mister/misterScan.ts');
const { arcadeCorePlatformName, isGenericArcadeSystemId } = await importTs('src/features/sticker-v1/services/mister/misterCoreRegistry.ts');
const { platformIdentityKeys, normalizePlatformAliasKey } = await importTs('src/features/sticker-v1/utils/platformNormalization.ts');

const NL = String.fromCharCode(10);
const parsed = parseMiSTerPathList([
  '/media/fat/_Arcade/Street Fighter III 3rd Strike Fight for the Future (Japan 990608, NO CD).mra',
  '/media/fat/_Arcade/Zoo Keeper.mra',
  '/media/fat/_Arcade/_CPS-2/Street Fighter Alpha 3 (Euro 980904).mra',
  '/media/fat/games/NES/Contra.nes',
].join(NL));
const entries = Array.isArray(parsed) ? parsed : parsed.entries;
const [flatCps3, flatGeneric, folderCps2, nes] = entries;

const identity = (entry) => platformIdentityKeys({
  platformKey: `${entry.platformGroup}/${entry.systemId}`,
  platformGroup: entry.platformGroup,
  systemId: entry.systemId,
  folderName: entry.folderName,
  displayName: entry.systemId,
});

// --- flat _Arcade MRAs start generic and get split by their <rbf> core name ---
assert.equal(flatCps3.platformGroup, 'Arcade', 'flat _Arcade MRA belongs to the Arcade group');
assert.equal(isGenericArcadeSystemId(flatCps3.systemId), true, 'flat _Arcade MRA starts with the generic Arcade systemId');
assert.equal(arcadeCorePlatformName('jtcps3'), 'CPS-3', 'jtcps3 core is labelled CPS-3 like CPS-1 / CPS-2');
assert.equal(arcadeCorePlatformName('jtcps2'), 'CPS-2', 'jtcps2 core keeps its CPS-2 label');
assert.equal(flatCps3.playable, true, 'a "(NO CD)" arcade MRA is playable');

// --- identity keys: the _Arcade menu folder must not make every split core look like the generic Arcade platform ---
const splitCps3 = { ...flatCps3, systemId: arcadeCorePlatformName('jtcps3') };
const genericKeys = identity(flatGeneric);
const cps3Keys = identity(splitCps3);
assert.ok(genericKeys.includes('arcade'), 'the generic Arcade platform still identifies as "arcade"');
assert.ok(!cps3Keys.includes('arcade'), 'a split arcade core must not inherit the "arcade" identity from the _Arcade folder');
assert.ok(cps3Keys.includes('cps3'), 'CPS-3 identifies as cps3');
assert.equal(cps3Keys.some((key) => genericKeys.includes(key)), false, 'CPS-3 shares no identity key with the generic Arcade platform, so it is discovered as a new platform');

// --- a real _Arcade/_CPS-2 folder and an rbf-split jtcps2 core still dedupe to the same platform ---
const splitCps2 = { ...flatGeneric, systemId: arcadeCorePlatformName('jtcps2') };
assert.ok(identity(folderCps2).some((key) => identity(splitCps2).includes(key)), 'folder-based CPS-2 and rbf-split CPS-2 share an identity key');
assert.equal(normalizePlatformAliasKey('CPS-3'), 'cps3', 'CPS-3 spelling variants normalize to cps3');
assert.equal(normalizePlatformAliasKey('cps 3'), 'cps3', 'CPS 3 spelling variants normalize to cps3');

// --- console platforms are unaffected: the games root is ignored, the core folder still counts ---
const nesKeys = identity(nes);
assert.ok(nesKeys.includes('nes'), 'NES keeps its core folder identity');
assert.ok(!nesKeys.includes('games'), 'the games root folder is not an identity');
assert.ok(!identity({ ...nes, folderName: 'games' }).includes('games'), 'a games menu-root folder name is ignored');

// --- the "새 플랫폼 발견 시" scan-filter setting must actually drive what happens after a scan ---
const misterPage = readRepoFile('src/features/sticker-v1/pages/MisterFpgaPage.tsx');
assert.match(misterPage, /autoHandledDiscoveryRef/, 'the MiSTer page applies the new-platform behavior automatically after a scan');
assert.match(misterPage, /behavior === 'addEnabled'[\s\S]{0,200}\.merge\(keys\)/, '"가져오기로 추가" merges newly discovered platforms without a manual click');
assert.match(misterPage, /merge: mergeDiscoveredPlatformsToLibrary, apply: applyDiscoveredPlatformStates/, 'automatic handling reuses the same merge/apply handlers as the manual buttons');
assert.match(misterPage, /\.apply\(unknownScannedPlatforms, behavior === 'ignore' \? 'ignored' : 'disabled'\)/, '"숨김" and "제외로 추가" are applied to every newly discovered platform in one library update');
assert.match(misterPage, /value="addEnabled">가져오기로 추가 - 스캔 직후 자동으로 병합</, 'the option label explains that platforms are merged right after the scan');

console.log('Sticker platform identity tests passed.');
