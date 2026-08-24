import { create } from 'zustand';
import { defaultExportSettings } from '@sticker-v1/export/defaultExportSettings';
import { defaultCategories } from '@sticker-v1/mock/defaultCategories';
import { emptyAssetLibrary } from '@sticker-v1/mock/sampleAssets';
import {
  deleteSavedCardRecord,
  getCardFullData,
  loadPrintQueueIds,
  patchSavedCardRecord,
  permanentlyDeleteSavedCardRecord,
  persistPrintQueueIds,
  persistSavedCards,
  restoreSavedCardRecord,
  upsertSavedCardRecord,
} from '@sticker-v1/services/cards/savedCardsPersistence';
import { regenerateSavedCardThumbnail } from '@sticker-v1/services/cards/cardThumbnailGeneration';
import { generateCardsFromProject } from '@sticker-v1/services/cards/generateCards';
import { loadPersistedGames, persistGames } from '@sticker-v1/services/games/gamePersistence';
import { emptyMameMapping, clearMameMapping, persistMameMapping } from '@sticker-v1/services/mame/mameMapping';
import { matchMiSTerEntryImages } from '@sticker-v1/services/mister/misterImageMatching';
import { loadMiSTerState, persistMiSTerState } from '@sticker-v1/services/mister/misterPersistence';
import { summarizeMiSTerEntries } from '@sticker-v1/services/mister/misterScan';
import { buildLaunchPreview, buildZaparooLaunchText } from '@sticker-v1/services/mister/zaparooLaunch';
import {
  deletePersistedTemplate,
  loadPersistedTemplates,
  persistUserTemplates,
  upsertPersistedTemplate,
} from '@sticker-v1/services/templates/templatePersistence';
import {
  emptyZaparooLibraryState,
  createZaparooLibraryBackup,
  markZaparooEntryCard,
  mergeMiSTerLibraryIntoZaparooLibrary,
  persistZaparooLibraryState,
  reconcileZaparooLibraryCardLinks,
  unmarkZaparooEntryCard,
  zaparooLibraryEntryIdForMiSTerEntry,
} from '@sticker-v1/services/zaparoo/zaparooLibrary';
import type { CardLinkInput, DeviceIdentityInput } from '@sticker-v1/services/zaparoo/zaparooLibrary';
import type {
  AssetLibrary,
  AssetMatchResult,
  CardAlbumIndexItem,
  CardItem,
  Category,
  ExportSettings,
  GameEntry,
  MameMappingDataset,
  MiSTerConnectionConfig,
  MiSTerConnectionState,
  MiSTerLibraryCache,
  MiSTerLibraryScanSource,
  MiSTerMappingState,
  MiSTerScanEntry,
  MiSTerState,
  TagWriteJob,
  ProjectState,
  SavedCardRecord,
  Template,
  ZaparooLibraryEntry,
  ZaparooLibraryState,
} from '@sticker-v1/types';
import { cardAlbumIndexItemFromRecord } from '@sticker-v1/utils/cardAlbumIndex';

interface ProjectStore extends ProjectState {
  setProjectName: (name: string) => void;
  setCategories: (categories: Category[]) => void;
  addCategory: (category: Category) => void;
  updateCategory: (categoryId: string, patch: Partial<Category>) => void;
  deleteCategory: (categoryId: string) => void;
  setGames: (games: GameEntry[]) => void;
  setAssetLibrary: (assetLibrary: AssetLibrary) => void;
  setMameMapping: (mapping: MameMappingDataset) => void;
  clearMameMapping: () => void;
  setMatches: (matches: Record<string, AssetMatchResult>) => void;
  setMiSTerConnection: (patch: Partial<MiSTerConnectionState>) => void;
  setMiSTerState: (mister: MiSTerState) => void;
  setZaparooLibrary: (library: ZaparooLibraryState) => void;
  updateMiSTerConnectionConfig: (patch: Partial<MiSTerConnectionConfig>) => void;
  setMiSTerLibrary: (library: MiSTerLibraryCache) => void;
  setMiSTerEntries: (entries: MiSTerScanEntry[], scanSource?: MiSTerLibraryScanSource, forceImportEntryIds?: string[]) => void;
  refreshMiSTerEntriesForDevice: (
    entries: MiSTerScanEntry[],
    identity: DeviceIdentityInput,
    options?: { scanSource?: MiSTerLibraryScanSource; forceImportEntryIds?: string[]; importAllowlistIds?: string[]; config?: MiSTerConnectionConfig },
  ) => void;
  setMiSTerMapping: (mapping: MiSTerMappingState) => void;
  addMiSTerTagJob: (job: TagWriteJob) => void;
  runMiSTerImageMatching: () => void;
  createCardsFromMiSTerEntries: (entryIds: string[]) => void;
  createCardsFromZaparooEntries: (entryIds: string[]) => void;
  generateCards: () => void;
  updateCard: (cardId: string, patch: Partial<CardItem>) => void;
  deleteCard: (cardId: string) => void;
  duplicateCard: (cardId: string) => void;
  resetCard: (cardId: string) => void;
  clearWorkingCards: () => void;
  restoreWorkingCards: (cards: CardItem[]) => void;
  removeWorkingCard: (cardId: string) => void;
  hydrateSavedCards: (savedCards: SavedCardRecord[], printQueueIds: string[]) => void;
  hydrateSavedCardIndex: (savedCardIndex: CardAlbumIndexItem[], printQueueIds: string[]) => void;
  importSavedCards: (records: SavedCardRecord[]) => void;
  hydrateTemplates: (templates: Template[]) => void;
  saveCard: (cardId: string, title?: string) => void;
  saveCardAsNew: (cardId: string, title?: string) => void;
  loadSavedCardToEditor: (savedCardId: string) => void;
  updateSavedCard: (savedCardId: string, patch: Partial<SavedCardRecord>) => void;
  deleteSavedCard: (savedCardId: string) => void;
  restoreSavedCard: (savedCardId: string) => void;
  permanentlyDeleteSavedCard: (savedCardId: string) => void;
  duplicateSavedCard: (savedCardId: string) => void;
  toggleSavedCardFavorite: (savedCardId: string) => void;
  setPrintQueue: (savedCardIds: string[]) => void;
  addSavedCardToPrintQueue: (savedCardId: string) => void;
  removeSavedCardFromPrintQueue: (savedCardId: string) => void;
  removePrintQueueAt: (index: number) => void;
  clearPrintQueue: () => void;
  reorderPrintQueue: (fromIndex: number, toIndex: number) => void;
  updateExportSettings: (patch: Partial<ExportSettings>) => void;
  addTemplate: (template: Template) => void;
  updateTemplate: (templateId: string, patch: Partial<Template>) => void;
  refreshTemplatePreview: (templateId: string, previewVersion: string) => void;
  updateTemplateThumbnail: (
    templateId: string,
    patch: Pick<
      Partial<Template>,
      | 'previewVersion'
      | 'thumbnailCacheKey'
      | 'thumbnailVersion'
      | 'thumbnailStatus'
      | 'thumbnailStaleCacheKey'
      | 'thumbnailError'
      | 'thumbnailUpdatedAt'
    >,
  ) => void;
  deleteTemplate: (templateId: string) => void;
  restoreTemplate: (templateId: string) => void;
  permanentlyDeleteTemplate: (templateId: string) => void;
  duplicateTemplate: (templateId: string) => void;
}

const now = new Date().toISOString();
const initialTemplates = loadPersistedTemplates();
const initialSavedCards: SavedCardRecord[] = [];
const initialPrintQueueIds = loadPrintQueueIds();
const initialGames = loadPersistedGames([]);
const initialMiSTer = loadMiSTerState();

function cloneCardForSave(card: CardItem): CardItem {
  return JSON.parse(JSON.stringify(card)) as CardItem;
}

// Freeze the card's front/back templates onto the card so it renders even if the global template
// library later changes (re-import with a new id, deletion, etc.). This is what prevents the
// "템플릿 없음" blank when album cards are later opened on the output page. Existing snapshots are kept.
function withEmbeddedTemplateSnapshots(card: CardItem, templates: Template[]): CardItem {
  const byKey = new Map((card.embeddedTemplateSnapshots ?? []).map((template) => [`${template.id}:${template.type}`, template]));
  const front = templates.find((template) => template.id === card.front.templateId && template.type === 'front');
  const back = templates.find((template) => template.id === card.back.templateId && template.type === 'back');
  if (front) byKey.set(`${front.id}:front`, front);
  if (back) byKey.set(`${back.id}:back`, back);
  const snapshots = Array.from(byKey.values());
  if (snapshots.length === 0) return card;
  return { ...card, embeddedTemplateSnapshots: snapshots };
}

function savedCardTitle(card: CardItem, games: GameEntry[], fallback?: string) {
  return fallback?.trim() || games.find((game) => game.id === card.gameId)?.title || card.front.titleText || card.id;
}

function queueThumbnailRegeneration(record: SavedCardRecord, state: Pick<ProjectState, 'assetLibrary' | 'categories' | 'templates'>) {
  void regenerateSavedCardThumbnail(record, {
    assetLibrary: state.assetLibrary,
    categories: state.categories,
    templates: state.templates,
    dpi: 120,
  }).then((result) => {
    useProjectStore.setState((current) => ({
      savedCards: current.savedCards.map((candidate) =>
        candidate.id === record.id
          ? {
              ...candidate,
              thumbnailStatus: result.status === 'ready' ? 'ready' : result.status,
              thumbnailStaleCacheKey: result.status === 'ready' ? undefined : candidate.thumbnailStaleCacheKey,
              thumbnailError: result.status === 'ready' ? undefined : result.error,
              thumbnailUpdatedAt: result.status === 'ready' ? new Date().toISOString() : candidate.thumbnailUpdatedAt,
            }
          : candidate,
      ),
      savedCardIndex: current.savedCardIndex.map((item) =>
        item.id === record.id
          ? {
              ...item,
              thumbnailStatus: result.status === 'ready' ? 'ready' : result.status,
              thumbnailStaleCacheKey: result.status === 'ready' ? undefined : item.thumbnailStaleCacheKey,
              thumbnailError: result.status === 'ready' ? undefined : result.error,
              thumbnailUpdatedAt: result.status === 'ready' ? new Date().toISOString() : item.thumbnailUpdatedAt,
            }
          : item,
      ),
    }));
  });
}

function activeSavedCardIndexIds(items: CardAlbumIndexItem[]) {
  return new Set(items.filter((item) => !item.deletedAt).map((item) => item.id));
}

// The card index is always in memory (full SavedCardRecords are loaded lazily), so reconcile must run off the index
// or it would see zero cards and wipe every entry's hasCard on each scan.
function cardLinkInputsFromIndex(items: CardAlbumIndexItem[]): CardLinkInput[] {
  return items.map((item) => ({
    id: item.id,
    linkedEntryId: item.mister?.zaparooLibraryEntryId,
    title: item.title,
    systemId: item.mister?.misterSystemId,
    absolutePath: item.mister?.misterAbsolutePath,
    updatedAt: item.updatedAt,
    deletedAt: item.deletedAt,
  }));
}

function persistNextMiSTer(state: MiSTerState) {
  persistMiSTerState(state);
  return state;
}

function categoryForMiSTerEntry(entry: MiSTerScanEntry, categories: Category[]) {
  return (
    categories.find((category) => category.name.toLowerCase() === entry.systemId.toLowerCase()) ??
    categories.find((category) => category.displayName.toLowerCase() === entry.systemId.toLowerCase()) ??
    categories.find((category) => category.displayName.toLowerCase().includes(entry.platformGroup.toLowerCase())) ??
    categories[0]
  );
}

function gameFromMiSTerEntry(entry: MiSTerScanEntry, categories: Category[], zaparooLibraryEntryId?: string): GameEntry {
  const category = categoryForMiSTerEntry(entry, categories);
  const launchPreview = buildLaunchPreview(entry, 'absolute-path');
  const launchText = launchPreview.text || buildZaparooLaunchText(entry);
  return {
    id: `game_${entry.id}`,
    title: entry.title,
    categoryId: category?.id ?? '',
    metadata: {
      sourceImage: entry.imageMatch?.assetId,
      mister: {
        misterSource: 'mister',
        zaparooLibraryEntryId,
        misterPlatformGroup: entry.platformGroup,
        misterSystemId: entry.systemId,
        misterFolderPath: entry.folderPath,
        misterRelativePath: entry.relativePath,
        misterAbsolutePath: entry.absolutePath,
        misterLaunchText: launchText,
        originalLibraryPath: launchPreview.originalLibraryPath,
        resolvedMiSTerPath: launchPreview.resolvedMiSTerPath,
        nfcPayload: launchPreview.nfcPayload,
        nfcPayloadSource: launchPreview.resolutionSource,
      },
    },
  };
}

function cardFromMiSTerEntry(entry: MiSTerScanEntry, game: GameEntry, categories: Category[]): CardItem {
  const category = categoryForMiSTerEntry(entry, categories);
  const frontTemplateId = game.metadata?.templateId ?? category?.defaultFrontTemplateId;
  const backTemplateId = category?.defaultBackTemplateId;
  return {
    id: `card_${entry.id}`,
    gameId: game.id,
    categoryId: game.categoryId,
    layoutMode: frontTemplateId ? 'CUSTOM' : 'UNASSIGNED',
    customTemplateId: frontTemplateId,
    printOrder: 0,
    coordinateLockKey: `card:mister:${entry.id}`,
    mister: game.metadata?.mister,
    front: {
      side: 'front',
      templateId: frontTemplateId,
      layoutMode: frontTemplateId ? 'CUSTOM' : 'UNASSIGNED',
      heroImageAssetId: entry.imageMatch?.assetId,
      titleText: entry.title,
      categoryLabel: category?.displayName ?? entry.systemId,
      platformLabel: entry.systemId,
    },
    back: {
      side: 'back',
      templateId: backTemplateId,
      categoryId: game.categoryId,
      backgroundImageAssetId: category?.backImageFileId,
      generatedFallback: !category?.backImageFileId,
      categoryLabel: category?.displayName ?? entry.systemId,
    },
  };
}

function miSTerEntryFromZaparooEntry(entry: ZaparooLibraryEntry): MiSTerScanEntry {
  return {
    id: entry.id,
    source: 'mister',
    platformGroup: entry.platformGroup,
    systemId: entry.systemId,
    folderName: entry.folderName,
    folderPath: entry.absolutePath.split('/').slice(0, -1).join('/'),
    relativePath: entry.relativePath,
    absolutePath: entry.absolutePath,
    title: entry.title,
    romName: entry.romName,
    region: entry.region,
    disc: entry.disc,
    kind: entry.kind,
    launchMode: entry.launchMode,
    launchValue: entry.launchValue,
    originalLibraryPath: entry.originalLibraryPath,
    resolvedMiSTerPath: entry.resolvedMiSTerPath,
    nfcPayload: entry.nfcPayload,
    nfcPayloadSource: entry.nfcPayloadSource,
    imageMatchKey: entry.imageMatchKey,
    imageMatch: {
      state: entry.imageMatchState,
      assetId: entry.imageAssetId,
      candidates: [],
      reason: '미스터 게임 리스트 entry',
    },
    hasCard: entry.hasCard,
    linkedCardId: entry.latestCardId,
    imageMatched: entry.imageMatchState === 'matched',
    launchReady: entry.launchReady,
    pathValid: entry.pathValid,
    aliasApplied: entry.aliasApplied,
    scannedAt: entry.lastSyncedAt,
  };
}

export const useProjectStore = create<ProjectStore>((set) => ({
  id: 'project_initial',
  name: 'Untitled Hello Mister Project',
  categories: defaultCategories,
  games: initialGames,
  assets: [],
  assetLibrary: emptyAssetLibrary,
  mameMapping: emptyMameMapping,
  matches: {},
  cards: [],
  savedCards: initialSavedCards,
  savedCardIndex: [],
  printQueueIds: initialPrintQueueIds,
  templates: initialTemplates,
  layoutPresets: [],
  exportSettings: defaultExportSettings,
  mister: initialMiSTer,
  zaparooLibrary: emptyZaparooLibraryState,
  createdAt: now,
  updatedAt: now,
  setProjectName: (name) => set({ name, updatedAt: new Date().toISOString() }),
  setCategories: (categories) => set({ categories, updatedAt: new Date().toISOString() }),
  addCategory: (category) =>
    set((state) => ({ categories: [...state.categories, category], updatedAt: new Date().toISOString() })),
  updateCategory: (categoryId, patch) =>
    set((state) => ({
      categories: state.categories.map((category) =>
        category.id === categoryId ? { ...category, ...patch } : category,
      ),
      updatedAt: new Date().toISOString(),
    })),
  deleteCategory: (categoryId) =>
    set((state) => {
      const categories = state.categories.filter((category) => category.id !== categoryId);
      const fallbackCategoryId = categories[0]?.id ?? '';
      return {
        categories,
        games: state.games.map((game) =>
          game.categoryId === categoryId ? { ...game, categoryId: fallbackCategoryId } : game,
        ),
        updatedAt: new Date().toISOString(),
      };
    }),
  setGames: (games) =>
    set(() => {
      persistGames(games);
      return { games, updatedAt: new Date().toISOString() };
    }),
  setAssetLibrary: (assetLibrary) =>
    set({
      assetLibrary,
      assets: Object.values(assetLibrary.assetsById),
      updatedAt: new Date().toISOString(),
    }),
  setMameMapping: (mameMapping) =>
    set(() => {
      void persistMameMapping(mameMapping);
      return { mameMapping, updatedAt: new Date().toISOString() };
    }),
  clearMameMapping: () =>
    set(() => {
      void clearMameMapping();
      return { mameMapping: emptyMameMapping, updatedAt: new Date().toISOString() };
    }),
  setMatches: (matches) => set({ matches, updatedAt: new Date().toISOString() }),
  setMiSTerState: (mister) =>
    set((state) => {
      const hasRuntimeSession = Boolean(state.mister.connection.connectionId && state.mister.connection.status === 'connected');
      const nextMiSTer = hasRuntimeSession && !mister.connection.connectionId
        ? {
            ...mister,
            connection: {
              ...mister.connection,
              ...state.mister.connection,
              config: {
                ...mister.connection.config,
                ...state.mister.connection.config,
              },
            },
          }
        : mister;
      persistMiSTerState(nextMiSTer);
      return { mister: nextMiSTer, updatedAt: new Date().toISOString() };
    }),
  setZaparooLibrary: (library) =>
    set((state) => {
      // Reconcile card links against the in-memory card index on every full set (hydration, backup restore) so
      // entry.hasCard reflects the saved cards even before any scan, and stale stored entry ids self-heal by path.
      const zaparooLibrary = reconcileZaparooLibraryCardLinks(library, cardLinkInputsFromIndex(state.savedCardIndex));
      persistZaparooLibraryState(zaparooLibrary);
      return { zaparooLibrary, updatedAt: new Date().toISOString() };
    }),
  setMiSTerConnection: (patch) =>
    set((state) => {
      const mister = persistNextMiSTer({
        ...state.mister,
        connection: { ...state.mister.connection, ...patch },
      });
      return { mister, updatedAt: new Date().toISOString() };
    }),
  updateMiSTerConnectionConfig: (patch) =>
    set((state) => {
      const mister = persistNextMiSTer({
        ...state.mister,
        connection: {
          ...state.mister.connection,
          config: { ...state.mister.connection.config, ...patch },
        },
      });
      return { mister, updatedAt: new Date().toISOString() };
    }),
  setMiSTerLibrary: (library) =>
    set((state) => {
      const mister = persistNextMiSTer({ ...state.mister, library });
      return { mister, updatedAt: new Date().toISOString() };
    }),
  setMiSTerEntries: (entries, scanSource = 'path-list', forceImportEntryIds = []) =>
    set((state) => {
      const summary = summarizeMiSTerEntries(entries);
      const mister = persistNextMiSTer({
        ...state.mister,
        library: {
          ...state.mister.library,
          entries,
          ...summary,
          lastSyncedAt: new Date().toISOString(),
          scanStatus: 'ready',
        },
      });
      const zaparooLibrary = createZaparooLibraryBackup(mergeMiSTerLibraryIntoZaparooLibrary(state.zaparooLibrary, entries, {
        config: state.mister.connection.config,
        scanSource,
        forceImportEntryIds,
      }), 'auto-merge');
      persistZaparooLibraryState(zaparooLibrary);
      return { mister, zaparooLibrary, updatedAt: new Date().toISOString() };
    }),
  refreshMiSTerEntriesForDevice: (entries, identity, options = {}) =>
    set((state) => {
      const summary = summarizeMiSTerEntries(entries);
      const mister = persistNextMiSTer({
        ...state.mister,
        library: {
          ...state.mister.library,
          entries,
          ...summary,
          lastSyncedAt: new Date().toISOString(),
          scanStatus: 'ready',
        },
      });
      // Refresh card links from the card index first so prune sees accurate linkedCardIds (the entry's own
      // linkedCardIds can be stale), then prune:true keeps card-linked entries as unavailable instead of deleting.
      const reconciled = reconcileZaparooLibraryCardLinks(state.zaparooLibrary, cardLinkInputsFromIndex(state.savedCardIndex));
      const zaparooLibrary = createZaparooLibraryBackup(mergeMiSTerLibraryIntoZaparooLibrary(reconciled, entries, {
        config: options.config ?? state.mister.connection.config,
        scanSource: options.scanSource ?? 'bridge-scan',
        forceImportEntryIds: options.forceImportEntryIds,
        importAllowlistIds: options.importAllowlistIds,
        identity,
        prune: true,
      }), 'auto-merge');
      persistZaparooLibraryState(zaparooLibrary);
      return { mister, zaparooLibrary, updatedAt: new Date().toISOString() };
    }),
  setMiSTerMapping: (mapping) =>
    set((state) => {
      const mister = persistNextMiSTer({ ...state.mister, mapping });
      return { mister, updatedAt: new Date().toISOString() };
    }),
  addMiSTerTagJob: (job) =>
    set((state) => {
      const mister = persistNextMiSTer({ ...state.mister, tagJobs: [job, ...state.mister.tagJobs] });
      return { mister, updatedAt: new Date().toISOString() };
    }),
  runMiSTerImageMatching: () =>
    set((state) => {
      const entries = matchMiSTerEntryImages(state.mister.library.entries, state.assetLibrary, state.mister.mapping);
      const summary = summarizeMiSTerEntries(entries);
      const mister = persistNextMiSTer({
        ...state.mister,
        library: { ...state.mister.library, entries, ...summary, lastSyncedAt: new Date().toISOString(), scanStatus: 'ready' },
      });
      const zaparooLibrary = mergeMiSTerLibraryIntoZaparooLibrary(state.zaparooLibrary, entries, {
        config: state.mister.connection.config,
        scanSource: 'path-list',
      });
      persistZaparooLibraryState(zaparooLibrary);
      return { mister, zaparooLibrary, updatedAt: new Date().toISOString() };
    }),
  createCardsFromMiSTerEntries: (entryIds) =>
    set((state) => {
      const selectedEntries = state.mister.library.entries.filter((entry) => entryIds.includes(entry.id));
      if (selectedEntries.length === 0) return state;
      const games = [...state.games];
      const cards = [...state.cards];
      selectedEntries.forEach((entry, index) => {
        const zaparooLibraryEntryId = zaparooLibraryEntryIdForMiSTerEntry(entry);
        const game = gameFromMiSTerEntry(entry, state.categories, zaparooLibraryEntryId);
        const existingGameIndex = games.findIndex((candidate) => candidate.id === game.id);
        if (existingGameIndex === -1) games.push(game);
        else games[existingGameIndex] = game;
        const card = { ...cardFromMiSTerEntry(entry, game, state.categories), printOrder: cards.length + index };
        const existingCardIndex = cards.findIndex((candidate) => candidate.id === card.id);
        if (existingCardIndex === -1) cards.push(card);
        else cards[existingCardIndex] = card;
      });
      persistGames(games);
      const entries = state.mister.library.entries.map((entry) =>
        entryIds.includes(entry.id)
          ? { ...entry, hasCard: true, linkedCardId: `card_${entry.id}` }
          : entry,
      );
      const mister = persistNextMiSTer({
        ...state.mister,
        library: { ...state.mister.library, entries },
      });
      const zaparooLibrary = mergeMiSTerLibraryIntoZaparooLibrary(state.zaparooLibrary, entries, {
        config: state.mister.connection.config,
        scanSource: 'path-list',
      });
      persistZaparooLibraryState(zaparooLibrary);
      return { games, cards, mister, zaparooLibrary, updatedAt: new Date().toISOString() };
    }),
  createCardsFromZaparooEntries: (entryIds) =>
    set((state) => {
      const selectedEntries = state.zaparooLibrary.entries
        .filter((entry) => entryIds.includes(entry.id))
        .map(miSTerEntryFromZaparooEntry);
      if (selectedEntries.length === 0) return state;
      const games = [...state.games];
      const cards = [...state.cards];
      selectedEntries.forEach((entry, index) => {
        const game = gameFromMiSTerEntry(entry, state.categories, entry.id);
        const existingGameIndex = games.findIndex((candidate) => candidate.id === game.id);
        if (existingGameIndex === -1) games.push(game);
        else games[existingGameIndex] = game;
        const card = { ...cardFromMiSTerEntry(entry, game, state.categories), printOrder: cards.length + index };
        const existingCardIndex = cards.findIndex((candidate) => candidate.id === card.id);
        if (existingCardIndex === -1) cards.push(card);
        else cards[existingCardIndex] = card;
      });
      persistGames(games);
      return { games, cards, updatedAt: new Date().toISOString() };
    }),
  generateCards: () =>
    set((state) => ({
      cards: generateCardsFromProject(state.games, state.categories, state.matches),
      updatedAt: new Date().toISOString(),
    })),
  updateCard: (cardId, patch) =>
    set((state) => ({
      cards: state.cards.map((card) => (card.id === cardId ? { ...card, ...patch } : card)),
      updatedAt: new Date().toISOString(),
    })),
  deleteCard: (cardId) =>
    set((state) => ({
      cards: state.cards.map((card) => (card.id === cardId ? { ...card, deleted: true } : card)),
      updatedAt: new Date().toISOString(),
    })),
  duplicateCard: (cardId) =>
    set((state) => {
      const source = state.cards.find((card) => card.id === cardId);
      if (!source) return state;
      const copy: CardItem = {
        ...source,
        id: `${source.id}_copy_${Date.now()}`,
        printOrder: state.cards.length,
        coordinateLockKey: `card:${state.cards.length}:${source.gameId}:copy`,
        duplicatedFromId: source.id,
      };
      return { cards: [...state.cards, copy], updatedAt: new Date().toISOString() };
    }),
  resetCard: (cardId) =>
    set((state) => {
      const target = state.cards.find((card) => card.id === cardId);
      if (!target) return state;
      const regenerated = generateCardsFromProject(
        state.games.filter((game) => game.id === target.gameId),
        state.categories,
        state.matches,
      )[0];
      if (!regenerated) return state;
      return {
        cards: state.cards.map((card) =>
          card.id === cardId
            ? { ...regenerated, id: card.id, printOrder: card.printOrder, coordinateLockKey: card.coordinateLockKey }
            : card,
        ),
        updatedAt: new Date().toISOString(),
      };
    }),
  clearWorkingCards: () => set({ cards: [], updatedAt: new Date().toISOString() }),
  restoreWorkingCards: (cards) => set({ cards, updatedAt: new Date().toISOString() }),
  removeWorkingCard: (cardId) =>
    set((state) => ({
      cards: state.cards.filter((card) => card.id !== cardId),
      updatedAt: new Date().toISOString(),
    })),
  hydrateSavedCards: (savedCards, printQueueIds) =>
    set(() => ({
      savedCards,
      savedCardIndex: savedCards.map(cardAlbumIndexItemFromRecord),
      printQueueIds: printQueueIds.filter((id) => savedCards.some((record) => record.id === id && !record.deletedAt)),
      updatedAt: new Date().toISOString(),
    })),
  hydrateSavedCardIndex: (savedCardIndex, printQueueIds) =>
    set(() => ({
      savedCardIndex,
      printQueueIds: printQueueIds.filter((id) => savedCardIndex.some((item) => item.id === id && !item.deletedAt)),
      updatedAt: new Date().toISOString(),
    })),
  importSavedCards: (records) =>
    set((state) => {
      if (records.length === 0) return state;
      const savedCards = [...state.savedCards, ...records];
      const savedCardIndex = [...state.savedCardIndex, ...records.map(cardAlbumIndexItemFromRecord)];
      const zaparooLibrary = records.reduce(
        (library, record) => markZaparooEntryCard(library, record.mister?.zaparooLibraryEntryId, record.id),
        state.zaparooLibrary,
      );
      if (state.savedCards.length > 0) persistSavedCards(savedCards);
      else records.forEach((record) => void upsertSavedCardRecord(record));
      persistZaparooLibraryState(zaparooLibrary);
      return { savedCards, savedCardIndex, zaparooLibrary, updatedAt: new Date().toISOString() };
    }),
  hydrateTemplates: (templates) => set({ templates, updatedAt: new Date().toISOString() }),
  saveCard: (cardId, title) =>
    set((state) => {
      const card = state.cards.find((candidate) => candidate.id === cardId);
      if (!card) return state;
      const existing = state.savedCards.find((candidate) => candidate.card.id === cardId);
      const timestamp = new Date().toISOString();
      const previousThumbnailCacheKey = existing ? cardAlbumIndexItemFromRecord(existing).thumbnailCacheKey : undefined;
      const record: SavedCardRecord = {
        id: existing?.id ?? `saved_${cardId}`,
        title: savedCardTitle(card, state.games, title ?? existing?.title),
        categoryId: card.categoryId,
        card: cloneCardForSave(withEmbeddedTemplateSnapshots(card, state.templates)),
        mister: card.mister,
        thumbnailStatus: previousThumbnailCacheKey ? 'staleNeedsRegeneration' : 'generating',
        thumbnailStaleCacheKey: previousThumbnailCacheKey,
        thumbnailError: undefined,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      const savedCards = [...state.savedCards.filter((candidate) => candidate.id !== record.id), record];
      const savedCardIndex = [...state.savedCardIndex.filter((candidate) => candidate.id !== record.id), cardAlbumIndexItemFromRecord(record)];
      void upsertSavedCardRecord(record);
      const mister = card.mister
        ? persistNextMiSTer({
            ...state.mister,
            library: {
              ...state.mister.library,
              entries: state.mister.library.entries.map((entry) =>
                entry.relativePath === card.mister?.misterRelativePath
                  ? { ...entry, hasCard: true, linkedCardId: record.id }
                  : entry,
              ),
            },
          })
        : state.mister;
      const zaparooLibrary = markZaparooEntryCard(state.zaparooLibrary, card.mister?.zaparooLibraryEntryId, record.id);
      queueThumbnailRegeneration(record, state);
      persistZaparooLibraryState(zaparooLibrary);
      return { savedCards, savedCardIndex, mister, zaparooLibrary, updatedAt: timestamp };
    }),
  saveCardAsNew: (cardId, title) =>
    set((state) => {
      const card = state.cards.find((candidate) => candidate.id === cardId);
      if (!card) return state;
      const timestamp = new Date().toISOString();
      const savedCardId = `saved_${cardId}_${Date.now()}`;
      const record: SavedCardRecord = {
        id: savedCardId,
        title: savedCardTitle(card, state.games, title),
        categoryId: card.categoryId,
        card: cloneCardForSave(withEmbeddedTemplateSnapshots({ ...card, id: `card_${savedCardId}`, coordinateLockKey: `card:saved:${savedCardId}` }, state.templates)),
        mister: card.mister,
        thumbnailStatus: 'generating',
        thumbnailError: undefined,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const savedCards = [...state.savedCards, record];
      const savedCardIndex = [...state.savedCardIndex, cardAlbumIndexItemFromRecord(record)];
      void upsertSavedCardRecord(record);
      const mister = card.mister
        ? persistNextMiSTer({
            ...state.mister,
            library: {
              ...state.mister.library,
              entries: state.mister.library.entries.map((entry) =>
                entry.relativePath === card.mister?.misterRelativePath
                  ? { ...entry, hasCard: true, linkedCardId: record.id }
                  : entry,
              ),
            },
          })
        : state.mister;
      const zaparooLibrary = markZaparooEntryCard(state.zaparooLibrary, card.mister?.zaparooLibraryEntryId, record.id);
      queueThumbnailRegeneration(record, state);
      persistZaparooLibraryState(zaparooLibrary);
      return { savedCards, savedCardIndex, mister, zaparooLibrary, updatedAt: timestamp };
    }),
  loadSavedCardToEditor: (savedCardId) =>
    set((state) => {
      const record = state.savedCards.find((candidate) => candidate.id === savedCardId);
      if (!record) {
        void getCardFullData(savedCardId).then((loaded) => {
          if (!loaded) return;
          const card = cloneCardForSave(loaded.card);
          useProjectStore.setState((current) => ({
            cards: [...current.cards.filter((candidate) => candidate.id !== card.id), card],
            savedCards: [...current.savedCards.filter((candidate) => candidate.id !== loaded.id), loaded],
            savedCardIndex: [...current.savedCardIndex.filter((candidate) => candidate.id !== loaded.id), cardAlbumIndexItemFromRecord(loaded)],
            updatedAt: new Date().toISOString(),
          }));
        });
        return state;
      }
      const card = cloneCardForSave(record.card);
      return {
        cards: [...state.cards.filter((candidate) => candidate.id !== card.id), card],
        updatedAt: new Date().toISOString(),
      };
    }),
  updateSavedCard: (savedCardId, patch) =>
    set((state) => {
      const savedCards = state.savedCards.map((record) => {
        if (record.id !== savedCardId) return record;
        const nextRecord = { ...record, ...patch, updatedAt: new Date().toISOString() };
        return {
          ...nextRecord,
          categoryId: nextRecord.card?.categoryId ?? nextRecord.categoryId,
        };
      });
      const changed = savedCards.find((record) => record.id === savedCardId);
      if (changed) void upsertSavedCardRecord(changed);
      else void patchSavedCardRecord(savedCardId, patch);
      const timestamp = new Date().toISOString();
      const savedCardIndex = changed
        ? state.savedCardIndex.map((item) => (item.id === savedCardId ? cardAlbumIndexItemFromRecord(changed) : item))
        : state.savedCardIndex.map((item) => (item.id === savedCardId ? { ...item, ...patch, updatedAt: timestamp } : item));
      return { savedCards, savedCardIndex, updatedAt: timestamp };
    }),
  deleteSavedCard: (savedCardId) =>
    set((state) => {
      const timestamp = new Date().toISOString();
      const savedCards = state.savedCards.map((record) =>
        record.id === savedCardId ? { ...record, deletedAt: timestamp, updatedAt: timestamp } : record,
      );
      const savedCardIndex = state.savedCardIndex.map((item) =>
        item.id === savedCardId ? { ...item, deletedAt: timestamp, updatedAt: timestamp } : item,
      );
      const remainingSavedCardIds = activeSavedCardIndexIds(savedCardIndex);
      const printQueueIds = state.printQueueIds.filter((id) => id !== savedCardId);
      const zaparooLibrary = unmarkZaparooEntryCard(state.zaparooLibrary, savedCardId, remainingSavedCardIds);
      void deleteSavedCardRecord(savedCardId);
      persistPrintQueueIds(printQueueIds);
      persistZaparooLibraryState(zaparooLibrary);
      return { savedCards, savedCardIndex, printQueueIds, zaparooLibrary, updatedAt: timestamp };
    }),
  restoreSavedCard: (savedCardId) =>
    set((state) => {
      const timestamp = new Date().toISOString();
      const restored = state.savedCards.find((record) => record.id === savedCardId);
      const savedCards = state.savedCards.map((record) => {
        if (record.id !== savedCardId) return record;
        return { ...record, deletedAt: undefined, updatedAt: timestamp };
      });
      const savedCardIndex = state.savedCardIndex.map((item) =>
        item.id === savedCardId ? { ...item, deletedAt: undefined, updatedAt: timestamp } : item,
      );
      const restoredMeta = restored ?? state.savedCardIndex.find((item) => item.id === savedCardId);
      const zaparooLibrary = markZaparooEntryCard(state.zaparooLibrary, restoredMeta?.mister?.zaparooLibraryEntryId, savedCardId);
      void restoreSavedCardRecord(savedCardId);
      persistZaparooLibraryState(zaparooLibrary);
      return { savedCards, savedCardIndex, zaparooLibrary, updatedAt: timestamp };
    }),
  permanentlyDeleteSavedCard: (savedCardId) =>
    set((state) => {
      const savedCards = state.savedCards.filter((record) => record.id !== savedCardId);
      const savedCardIndex = state.savedCardIndex.filter((item) => item.id !== savedCardId);
      const remainingSavedCardIds = activeSavedCardIndexIds(savedCardIndex);
      const printQueueIds = state.printQueueIds.filter((id) => id !== savedCardId);
      const zaparooLibrary = unmarkZaparooEntryCard(state.zaparooLibrary, savedCardId, remainingSavedCardIds);
      void permanentlyDeleteSavedCardRecord(savedCardId);
      persistPrintQueueIds(printQueueIds);
      persistZaparooLibraryState(zaparooLibrary);
      return { savedCards, savedCardIndex, printQueueIds, zaparooLibrary, updatedAt: new Date().toISOString() };
    }),
  duplicateSavedCard: (savedCardId) =>
    set((state) => {
      const source = state.savedCards.find((record) => record.id === savedCardId);
      if (!source) return state;
      const timestamp = new Date().toISOString();
      const id = `${source.id}_copy_${Date.now()}`;
      const copy: SavedCardRecord = {
        ...JSON.parse(JSON.stringify(source)),
        id,
        title: `${source.title} Copy`,
        card: { ...source.card, id: `card_${id}`, coordinateLockKey: `card:saved:${id}` },
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const savedCards = [...state.savedCards, copy];
      const savedCardIndex = [...state.savedCardIndex, cardAlbumIndexItemFromRecord(copy)];
      void upsertSavedCardRecord(copy);
      return { savedCards, savedCardIndex, updatedAt: timestamp };
    }),
  toggleSavedCardFavorite: (savedCardId) =>
    set((state) => {
      const timestamp = new Date().toISOString();
      const savedCards = state.savedCards.map((record) =>
        record.id === savedCardId
          ? { ...record, favorite: !record.favorite, updatedAt: timestamp }
          : record,
      );
      const changed = savedCards.find((record) => record.id === savedCardId);
      if (changed) void upsertSavedCardRecord(changed);
      else {
        const current = state.savedCardIndex.find((item) => item.id === savedCardId);
        void patchSavedCardRecord(savedCardId, { favorite: !current?.favorite, updatedAt: timestamp });
      }
      const savedCardIndex = state.savedCardIndex.map((item) =>
        item.id === savedCardId ? { ...item, favorite: !item.favorite, updatedAt: timestamp } : item,
      );
      return { savedCards, savedCardIndex, updatedAt: timestamp };
    }),
  setPrintQueue: (savedCardIds) =>
    set((state) => {
      const validIds = savedCardIds.filter((id) =>
        state.savedCardIndex.length > 0
          ? state.savedCardIndex.some((item) => item.id === id && !item.deletedAt)
          : state.savedCards.some((record) => record.id === id && !record.deletedAt),
      );
      persistPrintQueueIds(validIds);
      return { printQueueIds: validIds, updatedAt: new Date().toISOString() };
    }),
  addSavedCardToPrintQueue: (savedCardId) =>
    set((state) => {
      const exists = state.savedCardIndex.length > 0
        ? state.savedCardIndex.some((item) => item.id === savedCardId && !item.deletedAt)
        : state.savedCards.some((record) => record.id === savedCardId && !record.deletedAt);
      if (!exists) return state;
      const printQueueIds = [...state.printQueueIds, savedCardId];
      persistPrintQueueIds(printQueueIds);
      return { printQueueIds, updatedAt: new Date().toISOString() };
    }),
  removeSavedCardFromPrintQueue: (savedCardId) =>
    set((state) => {
      const index = state.printQueueIds.indexOf(savedCardId);
      if (index === -1) return state;
      const printQueueIds = [...state.printQueueIds];
      printQueueIds.splice(index, 1);
      persistPrintQueueIds(printQueueIds);
      return { printQueueIds, updatedAt: new Date().toISOString() };
    }),
  removePrintQueueAt: (index) =>
    set((state) => {
      if (index < 0 || index >= state.printQueueIds.length) return state;
      const printQueueIds = [...state.printQueueIds];
      printQueueIds.splice(index, 1);
      persistPrintQueueIds(printQueueIds);
      return { printQueueIds, updatedAt: new Date().toISOString() };
    }),
  clearPrintQueue: () =>
    set(() => {
      persistPrintQueueIds([]);
      return { printQueueIds: [], updatedAt: new Date().toISOString() };
    }),
  reorderPrintQueue: (fromIndex, toIndex) =>
    set((state) => {
      const printQueueIds = [...state.printQueueIds];
      if (fromIndex < 0 || toIndex < 0 || fromIndex >= printQueueIds.length || toIndex >= printQueueIds.length) {
        return state;
      }
      const [item] = printQueueIds.splice(fromIndex, 1);
      printQueueIds.splice(toIndex, 0, item);
      persistPrintQueueIds(printQueueIds);
      return { printQueueIds, updatedAt: new Date().toISOString() };
    }),
  updateExportSettings: (patch) =>
    set((state) => ({
      exportSettings: { ...state.exportSettings, ...patch },
      updatedAt: new Date().toISOString(),
    })),
  addTemplate: (template) =>
    set((state) => ({
      templates: upsertPersistedTemplate(template, state.templates),
      updatedAt: new Date().toISOString(),
    })),
  updateTemplate: (templateId, patch) =>
    set((state) => {
      const templates = state.templates.map((template) =>
        template.id === templateId ? { ...template, ...patch, updatedAt: new Date().toISOString() } : template,
      );
      persistUserTemplates(templates);
      return { templates, updatedAt: new Date().toISOString() };
    }),
  refreshTemplatePreview: (templateId, previewVersion) =>
    set((state) => {
      const templates = state.templates.map((template) =>
        template.id === templateId ? { ...template, previewVersion } : template,
      );
      persistUserTemplates(templates);
      return { templates, updatedAt: new Date().toISOString() };
    }),
  updateTemplateThumbnail: (templateId, patch) =>
    set((state) => {
      const templates = state.templates.map((template) =>
        template.id === templateId
          ? {
              ...template,
              ...patch,
            }
          : template,
      );
      persistUserTemplates(templates);
      return { templates, updatedAt: new Date().toISOString() };
    }),
  deleteTemplate: (templateId) =>
    set((state) => {
      const now = new Date().toISOString();
      const templates = state.templates.map((template) =>
        template.id === templateId ? { ...template, deletedAt: now, updatedAt: now } : template,
      );
      persistUserTemplates(templates);
      return { templates, updatedAt: now };
    }),
  restoreTemplate: (templateId) =>
    set((state) => {
      const now = new Date().toISOString();
      const templates = state.templates.map((template) =>
        template.id === templateId ? { ...template, deletedAt: undefined, updatedAt: now } : template,
      );
      persistUserTemplates(templates);
      return { templates, updatedAt: now };
    }),
  permanentlyDeleteTemplate: (templateId) =>
    set((state) => ({
      templates: deletePersistedTemplate(templateId, state.templates),
      updatedAt: new Date().toISOString(),
    })),
  duplicateTemplate: (templateId) =>
    set((state) => {
      const source = state.templates.find((template) => template.id === templateId);
      if (!source) return state;
      const copy: Template = {
        ...source,
        id: `${source.id}_copy_${Date.now()}`,
        name: `${source.name} Copy`,
        builtIn: false,
        source: 'EDITOR',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return { templates: upsertPersistedTemplate(copy, state.templates), updatedAt: new Date().toISOString() };
    }),
}));
