// Arcade database integration (2026-09-15): the <rbf>/<setname> listing parser, the mad_db.json normalizer, core
// display names learned from the database, per-game metadata, and the library merge rule that lets a raw core
// name (jtcps3) follow its proper platform name (CPS-3) without touching custom platform names.
import assert from 'node:assert/strict';
import { importTs, readRepoFile } from './sticker-v1-test-utils.mjs';
import { ARCADE_DATABASE_REMOTE_PATH, normalizeArcadeDatabase, parseArcadeCoreListing } from '../electron/arcade-database.mjs';

const NL = String.fromCharCode(10);

// --- grep -Ho listing -> cores + setnames per .mra path ---
const listing = [
  '/media/fat/_Arcade/Red Earth (Asia 961121, NO CD).mra:    <rbf>jtcps3',
  '/media/fat/_Arcade/Red Earth (Asia 961121, NO CD).mra:    <setname>redearthn',
  '/media/fat/_Arcade/Zoo Keeper.mra:<rbf alt="zookeep">zookeep',
  '/media/fat/_Arcade/Zoo Keeper.mra:<setname>zookeep',
  '/media/fat/_Arcade/Zoo Keeper.mra:<rbf>second-declaration-ignored',
  'garbage line without a tag',
].join(NL);
const parsed = parseArcadeCoreListing(listing);
assert.equal(parsed.cores['/media/fat/_Arcade/Red Earth (Asia 961121, NO CD).mra'], 'jtcps3', 'rbf is read per path');
assert.equal(parsed.setnames['/media/fat/_Arcade/Red Earth (Asia 961121, NO CD).mra'], 'redearthn', 'setname is read per path');
assert.equal(parsed.cores['/media/fat/_Arcade/Zoo Keeper.mra'], 'zookeep', 'rbf tags with attributes are parsed and the first declaration wins');
assert.equal(parsed.setnames['/media/fat/_Arcade/Zoo Keeper.mra'], 'zookeep', 'setname follows the same path key');
assert.equal(Object.keys(parsed.cores).length, 2, 'lines without a tag are ignored');
assert.equal(ARCADE_DATABASE_REMOTE_PATH, '/media/fat/Scripts/.config/arcade-organizer/data.zip', 'database lives in the arcade organizer config folder');

// --- mad_db.json -> compact entries ---
const raw = {
  '': { name: 'ignored: empty setname' },
  sfiii3n: {
    name: 'Street Fighter III 3rd Strike Fight for the Future (JP 990608, NO CD)',
    file: 'Street Fighter III 3rd Strike Fight for the Future (JP 990608, NO CD).mra',
    platform: ['Capcom CPS-3'],
    category: ['Fighter - Versus'],
    manufacturer: ['Capcom'],
    year: 1999,
    region: 'Japan',
    players: '2 (simultaneous)',
    num_buttons: 6,
    rotation: 0,
    resolution: '15kHz',
    move_inputs: ['8-way'],
    series: ['Street Fighter'],
    alternative: true,
    bootleg: false,
    homebrew: false,
  },
  weird: { name: 'Weird', platform: 'Single String', year: '1985', rotation: 90, players: 1 },
};
const db = normalizeArcadeDatabase(raw);
assert.equal(db.entryCount, 2, 'empty setnames are skipped');
assert.equal(db.entries.sfiii3n.platform, 'Capcom CPS-3', 'first platform becomes the display platform');
assert.deepEqual(db.entries.sfiii3n.platforms, ['Capcom CPS-3']);
assert.equal(db.entries.sfiii3n.category, 'Fighter - Versus');
assert.equal(db.entries.sfiii3n.manufacturer, 'Capcom');
assert.equal(db.entries.sfiii3n.year, 1999);
assert.equal(db.entries.sfiii3n.numButtons, 6);
assert.equal(db.entries.sfiii3n.alternative, true);
assert.equal(db.entries.sfiii3n.bootleg, false);
assert.equal('specialControls' in db.entries.sfiii3n, false, 'empty lists are dropped from the cache');
assert.equal(db.entries.weird.platform, 'Single String', 'string platforms are accepted');
assert.equal(db.entries.weird.year, 1985, 'numeric strings become numbers');
assert.equal(db.entries.weird.rotation, 90);
assert.equal(db.entries.weird.players, '1', 'numeric player counts become text');

// --- core display names + metadata fields ---
const { arcadeCoreDisplayNames, arcadeMetadataForEntry, orientationFromRotation } = await importTs('src/features/sticker-v1/services/mister/arcadeDatabase.ts');
const { arcadeCorePlatformName } = await importTs('src/features/sticker-v1/services/mister/misterCoreRegistry.ts');
const cores = { '/a.mra': 'jtsimson', '/b.mra': 'jtsimson', '/c.mra': 'jtsimson', '/d.mra': 'jtcps3', '/e.mra': 'nodb' };
const setnames = { '/a.mra': 'simpsons', '/b.mra': 'simpsons2p', '/c.mra': 'vendetta', '/d.mra': 'sfiii3n', '/e.mra': 'missing' };
const database = {
  simpsons: { name: 'The Simpsons', platform: 'Konami Simpsons' },
  simpsons2p: { name: 'The Simpsons (2 Players)', platform: 'Konami Simpsons' },
  vendetta: { name: 'Vendetta', platform: 'Konami Vendetta' },
  sfiii3n: db.entries.sfiii3n,
};
const names = arcadeCoreDisplayNames(Object.keys(cores), cores, setnames, database);
assert.equal(names.get('jtsimson'), 'Konami Simpsons', 'the majority database platform names a core');
assert.equal(names.get('jtcps3'), 'Capcom CPS-3');
assert.equal(names.has('nodb'), false, 'cores without database entries get no learned name');
assert.equal(arcadeCorePlatformName('jtsimson', names.get('jtsimson')), 'Konami Simpsons', 'unknown cores take the database name');
assert.equal(arcadeCorePlatformName('jtcps3', names.get('jtcps3')), 'CPS-3', 'the curated table keeps precedence, so existing platform keys stay stable');
assert.equal(arcadeCorePlatformName('mystery', undefined), 'mystery', 'raw rbf when nothing else is known');
assert.equal(arcadeCorePlatformName('mystery', '   '), 'mystery', 'blank database names are ignored');

const meta = arcadeMetadataForEntry('jtcps3', 'sfiii3n', db.entries.sfiii3n);
assert.equal(meta.genre, 'Fighter - Versus');
assert.equal(meta.releaseYear, '1999');
assert.equal(meta.manufacturer, 'Capcom');
assert.equal(meta.orientation, 'horizontal');
assert.equal(meta.metadataSource, 'external');
assert.equal(meta.arcade.rbf, 'jtcps3');
assert.equal(meta.arcade.setname, 'sfiii3n');
assert.equal(meta.arcade.numButtons, 6);
assert.equal(meta.arcade.alternative, true);
const bare = arcadeMetadataForEntry('jtcps3', 'unknownset', undefined);
assert.equal(bare.metadataSource, undefined, 'no database entry: metadata source stays unset');
assert.equal(bare.arcade.rbf, 'jtcps3', 'core identity is still recorded');
assert.deepEqual(arcadeMetadataForEntry(undefined, undefined, undefined), {}, 'nothing known: nothing added');
assert.equal(orientationFromRotation(270), 'vertical');
assert.equal(orientationFromRotation(180), 'horizontal');
assert.equal(orientationFromRotation(undefined), 'unknown');

// --- library merge: raw core names follow the proper platform name; custom platform names and manual data stay ---
const lib = await importTs('src/features/sticker-v1/services/zaparoo/zaparooLibrary.ts');
const scan = await importTs('src/features/sticker-v1/services/mister/misterScan.ts');
const parsedScan = scan.parseMiSTerPathList([
  '/media/fat/_Arcade/Red Earth (Asia 961121, NO CD).mra',
  '/media/fat/_Arcade/_PGM/Knights of Valour.mra',
  '/media/fat/_Arcade/Zoo Keeper.mra',
].join(NL));
const entries = Array.isArray(parsedScan) ? parsedScan : parsedScan.entries;
const [redEarth, knights, zooKeeper] = entries;
const config = { host: '192.168.10.11', port: 22, username: 'root', authMethod: 'password' };
const options = { config, scanSource: 'bridge-scan', forceImportEntryIds: entries.map((entry) => entry.id) };

const first = lib.mergeMiSTerLibraryIntoZaparooLibrary(lib.emptyZaparooLibraryState, [
  { ...redEarth, systemId: 'jtcps3', arcade: { rbf: 'jtcps3' } },
  { ...knights, systemId: 'My PGM', arcade: { rbf: 'IGSPGM' } },
  { ...zooKeeper, systemId: 'Arcade' },
], options);
assert.deepEqual(first.entries.map((entry) => entry.systemId).sort(), ['Arcade', 'My PGM', 'jtcps3'], 'first import keeps the scanned names');

const second = lib.mergeMiSTerLibraryIntoZaparooLibrary(first, [
  {
    ...redEarth,
    systemId: 'CPS-3',
    genre: 'Fighter - Versus Co-op',
    releaseYear: '1996',
    manufacturer: 'Capcom',
    orientation: 'horizontal',
    metadataSource: 'external',
    arcade: { rbf: 'jtcps3', setname: 'redearthn', platform: 'Capcom CPS-3', numButtons: 6 },
  },
  { ...knights, systemId: 'IGS PGM', arcade: { rbf: 'IGSPGM' } },
  { ...zooKeeper, systemId: 'Taito Zoo Keeper', arcade: { rbf: 'zookeep' } },
], options);
const byPath = (path) => second.entries.find((entry) => entry.absolutePath === path);
assert.equal(byPath(redEarth.absolutePath).systemId, 'CPS-3', 'a raw core name follows the platform name of the rescan');
assert.equal(byPath(redEarth.absolutePath).genre, 'Fighter - Versus Co-op', 'database genre is stored on the library entry');
assert.equal(byPath(redEarth.absolutePath).releaseYear, '1996');
assert.equal(byPath(redEarth.absolutePath).metadataSource, 'external');
assert.equal(byPath(redEarth.absolutePath).arcade.setname, 'redearthn', 'arcade identity is merged into the entry');
assert.equal(byPath(knights.absolutePath).systemId, 'My PGM', 'a custom platform name is not overwritten by a rescan');
assert.equal(byPath(zooKeeper.absolutePath).systemId, 'Taito Zoo Keeper', 'the generic Arcade bucket follows the new platform name');
assert.equal(second.entries.length, 3, 'renames update entries in place instead of duplicating them');

// --- MiSTer game list UI: arcade metadata should be sortable, filterable, and visible per row ---
const misterFpgaPage = readRepoFile('src/features/sticker-v1/pages/MisterFpgaPage.tsx');
assert.ok(misterFpgaPage.includes('정렬: 장르'), 'game list sort should offer a genre option');
assert.ok(misterFpgaPage.includes('정렬: 연도'), 'game list sort should offer a year option');
assert.ok(misterFpgaPage.includes('정렬: 제조사'), 'game list sort should offer a manufacturer option');
assert.ok(misterFpgaPage.includes('metadataFilter'), 'game list should track a genre/manufacturer/year metadata filter');
assert.ok(misterFpgaPage.includes('필터 지우기'), 'game list should expose a clear-filter action while a metadata filter is active');
assert.ok(misterFpgaPage.includes('${entry.arcade.numButtons}버튼'), 'row metadata line should show the arcade button count');

console.log('Sticker arcade database tests passed.');
