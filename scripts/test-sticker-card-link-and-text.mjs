// Card link picker ranking and card text tokens (2026-09-16).
// 1) A card whose stored link broke must surface its real game near the top of the picker instead of an
//    alphabetical dump of the whole library.
// 2) Template text layers expand {manufacturer} / {year} / {genre} style tokens from the facts the MiSTer scan
//    stored on the card, through ONE resolver shared by the card editor, the sheet editor and PNG/PDF/print.
import assert from 'node:assert/strict';
import { importTs, readRepoFile } from './sticker-v1-test-utils.mjs';

const { rankCardLinkCandidates } = await importTs('src/features/sticker-v1/utils/cardLinkCandidates.ts');
const { cardSlotText, cardTextTokens, expandCardTextTokens } = await importTs('src/features/sticker-v1/utils/cardTemplateText.ts');

// --- link picker ranking ---
const entry = (id, title, systemId, relativePath, platformGroup = 'Arcade') => ({
  id,
  title,
  systemId,
  platformGroup,
  relativePath,
  absolutePath: `/media/fat/${platformGroup === 'Arcade' ? '_Arcade' : `games/${systemId}`}/${relativePath}`,
  romName: relativePath.split('/').pop(),
});

const library = [
  entry('e_sf3', 'Street Fighter III 3rd Strike', 'CPS-3', 'Street Fighter III 3rd Strike (Japan 990608).mra'),
  entry('e_sf2', 'Street Fighter II', 'CPS-1', 'Street Fighter II (World).mra'),
  entry('e_zoo', 'Zoo Keeper', 'Arcade', 'Zoo Keeper.mra'),
  entry('e_sonic', 'Sonic The Hedgehog', 'Genesis', 'Sonic The Hedgehog.md', 'Console'),
  entry('e_aero', 'Aero Fighters', 'Arcade', 'Aero Fighters.mra'),
];

// A broken card still remembers where it pointed: the same file under a renamed platform must rank first even
// though the user typed nothing, and unrelated games must not pad the list.
const brokenCard = {
  title: 'Street Fighter III 3rd Strike',
  systemId: 'jtcps3',
  platformGroup: 'Arcade',
  absolutePath: '/media/fat/_Arcade/Street Fighter III 3rd Strike (Japan 990608).mra',
  relativePath: 'Street Fighter III 3rd Strike (Japan 990608).mra',
};
const ranked = rankCardLinkCandidates(library, brokenCard, '');
assert.equal(ranked[0].entry.id, 'e_sf3', 'the exact same path ranks first with no query typed');
assert.ok(ranked[0].reasons.includes('같은 경로'), 'the top candidate explains why it matched');
assert.ok(!ranked.some((candidate) => candidate.entry.id === 'e_sonic'), 'an unrelated console game is hidden when nothing matches it');
assert.ok(ranked.some((candidate) => candidate.entry.id === 'e_zoo'), 'same-group games stay available as fallbacks');

// Platform alone still beats nothing, and the card's title breaks the tie.
const noPathCard = { title: 'Street Fighter II', systemId: 'CPS-1', platformGroup: 'Arcade' };
const rankedNoPath = rankCardLinkCandidates(library, noPathCard, '');
assert.equal(rankedNoPath[0].entry.id, 'e_sf2', 'same platform plus matching title ranks first');
assert.ok(rankedNoPath[0].reasons.includes('제목 일치') && rankedNoPath[0].reasons.includes('같은 플랫폼'), 'both reasons are reported');

// What the user types outranks what the card remembers.
const rankedQuery = rankCardLinkCandidates(library, brokenCard, 'zoo');
assert.equal(rankedQuery[0].entry.id, 'e_zoo', 'a typed query wins over the remembered path');
assert.equal(rankedQuery.length, 1, 'only query matches are listed while a query is active');
assert.deepEqual(rankCardLinkCandidates(library, brokenCard, 'nothingmatches'), [], 'a query with no match returns nothing');

// A card that never had a link falls back to the query only.
assert.deepEqual(rankCardLinkCandidates(library, {}, ''), [], 'no card metadata and no query means no guesses');
assert.equal(rankCardLinkCandidates(library, {}, 'sonic')[0].entry.id, 'e_sonic', 'query-only search still works');
assert.equal(rankCardLinkCandidates(library, brokenCard, '', 2).length, 2, 'the candidate list is capped');

// --- card text tokens ---
const card = {
  id: 'card_1',
  gameId: 'game_1',
  categoryId: 'cat_1',
  layoutMode: 'CUSTOM',
  printOrder: 0,
  coordinateLockKey: 'card:1',
  mister: {
    misterSource: 'mister',
    misterPlatformGroup: 'Arcade',
    misterSystemId: 'CPS-3',
    misterFolderPath: '/media/fat/_Arcade',
    misterRelativePath: 'sf3.mra',
    misterAbsolutePath: '/media/fat/_Arcade/sf3.mra',
    misterLaunchText: '',
    misterManufacturer: 'Capcom',
    misterReleaseYear: '1999',
    misterGenre: 'Fighter - Versus',
    misterPlayers: '2 (simultaneous)',
    misterRegion: 'Japan',
    misterNumButtons: 6,
  },
  front: { side: 'front', titleText: 'Street Fighter III', categoryLabel: '아케이드', platformLabel: 'CPS-3' },
  back: { side: 'back', categoryId: 'cat_1', generatedFallback: false, categoryLabel: '아케이드 뒷면' },
};

const tokens = cardTextTokens(card, 'back');
assert.equal(tokens.manufacturer, 'Capcom');
assert.equal(tokens.year, '1999');
assert.equal(tokens.genre, 'Fighter - Versus');
assert.equal(tokens.buttons, '6버튼');
assert.equal(tokens.info, 'Capcom · 1999 · Fighter - Versus', 'the info token is the usual one-line credit');
assert.equal(tokens.category, '아케이드 뒷면', 'the category token follows the rendered side');
assert.equal(cardTextTokens(card, 'front').category, '아케이드');

assert.equal(expandCardTextTokens('{manufacturer} · {year} · {genre}', tokens), 'Capcom · 1999 · Fighter - Versus');
assert.equal(expandCardTextTokens('{title} ({year})', tokens), 'Street Fighter III (1999)');
assert.equal(expandCardTextTokens('{players} · {buttons}', tokens), '2 (simultaneous) · 6버튼');
assert.equal(expandCardTextTokens('제조사 없음', tokens), '제조사 없음', 'plain text is untouched');
assert.equal(expandCardTextTokens('{unknownToken}', tokens), '{unknownToken}', 'unknown tokens are left visible instead of silently vanishing');

// A hyphenated value must survive the separator cleanup.
assert.equal(expandCardTextTokens('{genre}', tokens), 'Fighter - Versus', 'a spaced dash inside a value is preserved');
const partial = cardTextTokens({ ...card, mister: { ...card.mister, misterManufacturer: undefined, misterGenre: undefined } }, 'back');
assert.equal(expandCardTextTokens('{manufacturer} · {year} · {genre}', partial), '1999', 'separators left by empty tokens are dropped');
assert.equal(expandCardTextTokens('{manufacturer} · {year}', partial), '1999');
const noFacts = cardTextTokens({ ...card, mister: undefined }, 'back');
assert.equal(expandCardTextTokens('{manufacturer} · {year} · {genre}', noFacts), '', 'a card without facts renders an empty line, not stray separators');
assert.equal(noFacts.title, 'Street Fighter III', 'title still comes from the card itself');

// --- the shared resolver keeps the historical slot-type mapping ---
assert.equal(cardSlotText({ id: 'l1', slotType: 'titleText' }, card, 'front'), 'Street Fighter III');
assert.equal(cardSlotText({ id: 'l2', slotType: 'categoryLabel' }, card, 'back'), '아케이드 뒷면');
assert.equal(cardSlotText({ id: 'l3', slotType: 'brandText' }, card, 'front'), 'Hello Mister');
assert.equal(cardSlotText({ id: 'l4', slotType: 'mainImage' }, card, 'front'), '이미지 없음');
assert.equal(cardSlotText({ id: 'l5', type: 'text', data: { text: '{info}' } }, card, 'back'), 'Capcom · 1999 · Fighter - Versus', 'a free text layer expands tokens');
assert.equal(cardSlotText({ id: 'l6', type: 'text', data: { text: 'Hello Mister' } }, card, 'back'), 'Hello Mister');

// --- both render paths must use the shared resolver, or the editor and the printed sheet would drift ---
for (const file of ['src/features/sticker-v1/components/cards/CardPreview.tsx', 'src/features/sticker-v1/components/cards/EditableCardTemplatePreview.tsx']) {
  const source = readRepoFile(file);
  assert.match(source, /import \{ cardSlotText \} from '@sticker-v1\/utils\/cardTemplateText'/, `${file} uses the shared text resolver`);
  assert.doesNotMatch(source, /function slotText\(/, `${file} must not keep a private copy of the text resolution`);
}

const albumSource = readRepoFile('src/features/sticker-v1/pages/CardAlbumPage.tsx');
assert.match(albumSource, /rankCardLinkCandidates\(zaparooLibrary\.entries, \{/, 'the link picker uses the ranked candidates');
assert.match(albumSource, /cardFactsFromLibraryEntry\(entry\)/, 'linking a card copies the game facts onto it');
assert.match(albumSource, /async function refreshCardGameFacts/, 'already-saved cards can be refilled with the game facts');

console.log('Sticker card link ranking and text token tests passed.');
