// Ported from v1 scripts/test-card-album-performance.mjs and test-card-album-lightweight-index.mjs.
// Guards CLAUDE.md §10: Card Album opens with 20 recent cards, pages in units of 100, and the album grid works
// from a lightweight metadata index (thumbnail cache + link status) instead of full card records.
import assert from 'node:assert/strict';
import { importTs, readRepoFile } from './sticker-v1-test-utils.mjs';

const { paginateItems } = await importTs('src/features/sticker-v1/utils/pagination.ts');
const { takeRecentSavedCards } = await importTs('src/features/sticker-v1/utils/cardAlbumLoading.ts');
const {
  CARD_ALBUM_THUMBNAIL_CACHE_VERSION,
  cardAlbumIndexItemFromRecord,
  savedCardSearchTextFromIndex,
  sortAlbumIndexByUpdatedDesc,
  takeRecentAlbumIndexItems,
} = await importTs('src/features/sticker-v1/utils/cardAlbumIndex.ts');

// --- pagination: 20 recent first, then 100 per page ---
const albumCards = Array.from({ length: 1000 }, (_, index) => ({ id: `saved_${index + 1}`, title: `Game ${index + 1}` }));
const savedRecords = albumCards.map((card, index) => ({
  ...card,
  categoryId: 'cat',
  createdAt: `2026-01-01T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
  updatedAt: `2026-01-01T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
  card: { front: { titleText: card.title }, back: {}, gameId: card.id },
}));

const firstPage = paginateItems(albumCards, 1, 100);
const tenthPage = paginateItems(albumCards, 10, 100);
const searchResult = albumCards.filter((card) => card.title.includes('99'));
const searchedPage = paginateItems(searchResult, 1, 100);
const initialRecent = takeRecentSavedCards(savedRecords, 20);

assert.equal(initialRecent.length, 20, 'opening Card Album should initially take only 20 recent cards');
assert.equal(initialRecent[0].id, 'saved_60', 'recent cards should prefer updatedAt and preserve saved order on ties');
assert.equal(firstPage.totalItems, 1000, 'album pagination should keep total count');
assert.equal(firstPage.totalPages, 10, '1000 cards at 100 per page should produce 10 pages');
assert.equal(firstPage.items.length, 100, 'only current page cards should render initially');
assert.equal(firstPage.items[0].id, 'saved_1', 'page 1 starts with first card');
assert.equal(firstPage.items[99].id, 'saved_100', 'page 1 ends at card 100');
assert.equal(tenthPage.items[0].id, 'saved_901', 'page 10 starts at card 901');
assert.equal(tenthPage.items[99].id, 'saved_1000', 'page 10 ends at card 1000');
assert.equal(searchedPage.currentPage, 1, 'search/filter result should start from page 1');
assert.ok(searchedPage.items.length < 100, 'filtered result under page size should render one small page');

// --- lightweight album index: metadata only, no card design payloads ---
const records = Array.from({ length: 50 }, (_, index) => ({
  id: `saved_${index + 1}`,
  title: `Game ${index + 1}`,
  categoryId: 'Genesis',
  createdAt: `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
  updatedAt: `2026-01-01T00:01:${String(index % 60).padStart(2, '0')}.000Z`,
  card: {
    id: `card_${index + 1}`,
    front: { titleText: `Game ${index + 1}`, heroImageAssetRef: { stableKey: 'huge-artwork-ref' } },
    back: {},
    giantDesignPayload: 'x'.repeat(10_000),
  },
  mister: index === 0
    ? {
        zaparooLibraryEntryId: 'lib_1',
        misterPlatformGroup: 'Console',
        misterSystemId: 'Genesis',
        misterRelativePath: 'Sonic.md',
        misterAbsolutePath: '/media/fat/games/Genesis/Sonic.md',
      }
    : undefined,
}));

const indexItems = records.map(cardAlbumIndexItemFromRecord);
const newest = [...indexItems].sort(sortAlbumIndexByUpdatedDesc);
const recent20 = takeRecentAlbumIndexItems(indexItems, 20);

assert.equal(indexItems.length, records.length, 'metadata index should include one item per card');
assert.equal('card' in indexItems[0], false, 'album metadata must not contain full card design data');
assert.equal('giantDesignPayload' in indexItems[0], false, 'album metadata must not contain large design payloads');
assert.equal(indexItems[0].thumbnailCacheKey, `card-thumbnail:v${CARD_ALBUM_THUMBNAIL_CACHE_VERSION}:saved_1:${records[0].updatedAt}`, 'metadata should point at the versioned thumbnail cache');
assert.equal(indexItems[0].cachedLinkStatus, 'linked', 'cached MiSTer link status should be present on the index item');
assert.equal(indexItems[0].platform, 'Console/Genesis', 'platform should be lightweight display metadata');
assert.equal(recent20.length, 20, 'initial album view should use only 20 recent items');
assert.deepEqual(recent20.map((item) => item.id), newest.slice(0, 20).map((item) => item.id), 'recent items should sort by updatedAt');
assert.match(savedCardSearchTextFromIndex(indexItems[0]), /Genesis/, 'search text should be built from metadata only');

// --- source contracts: the album page loads metadata and thumbnails first, full data only on demand ---
const albumPageSource = readRepoFile('src/features/sticker-v1/pages/CardAlbumPage.tsx');
assert.match(albumPageSource, /loadRecentCardAlbumIndexFromIndexedDb/, 'Card Album should load recent metadata first');
assert.match(albumPageSource, /loadCardThumbnailBlob/, 'Card Album should read cached thumbnails first');
assert.match(albumPageSource, /loadSavedCardFullData/, 'full card data should be loaded only for explicit actions or missing thumbnail generation');
assert.match(albumPageSource, /object-contain/, 'Card Album thumbnails should use contain fit so landscape cards are not cropped');

const persistenceSource = readRepoFile('src/features/sticker-v1/services/cards/savedCardsPersistence.ts');
assert.match(persistenceSource, /cardMeta/, 'persistence should include a cardMeta store');
assert.match(persistenceSource, /cardFullData/, 'persistence should include a cardFullData store');
assert.match(persistenceSource, /cardThumbnails/, 'persistence should include a cardThumbnails store');
assert.match(persistenceSource, /deleteCardThumbnailBlobs/, 'permanent delete should remove thumbnail cache records');

console.log('Sticker card album tests passed.');
