import type { ExportSettings, ExportSideMode, SheetCardPlacement } from '@sticker-v1/types';

// A saved sheet is one PRINT JOB (the whole batch), not a single physical page:
// 30 cards = one saved job that renders as 3 sheets, kept together. This lets the user
// group by platform / printed-vs-unprinted. Legacy per-page fields are kept optional for back-compat.
export interface SavedPrintSheet {
  id: string;
  name: string;
  /** The whole job's side mode (front / back / duplex). */
  sideMode: ExportSideMode;
  /** Full ordered card id list for the entire job (all pages). */
  cardIds: string[];
  /** Full export settings snapshot (용지/여백/카드 간격/품질해상도/컷팅라인) captured at save time. */
  settings?: ExportSettings;
  /** Frozen first-page placements for the list thumbnail (so it never reflows with live settings). */
  thumbnailPlacements?: SheetCardPlacement[];
  /** Which side the thumbnail shows. */
  thumbnailSide?: 'front' | 'back';
  /** Total physical sheet count of the job at save time. */
  sheetCount?: number;
  createdAt: string;
  updatedAt: string;
  /** @deprecated legacy single-page fields from the old per-page save model. */
  side?: 'front' | 'back';
  /** @deprecated */
  pageIndex?: number;
  /** @deprecated */
  placements?: SheetCardPlacement[];
}

const storageKey = 'zaparoo.print.savedSheets.v1';
const dbName = 'zaparoo-manager-print-sheets';
const storeName = 'savedSheets';

function normalizeSheet(candidate: unknown): SavedPrintSheet | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const sheet = candidate as Partial<SavedPrintSheet>;
  if (!sheet.id || !sheet.name) return null;
  const sideMode: ExportSideMode = sheet.sideMode ?? (sheet.side === 'back' ? 'back' : 'front');
  return {
    id: String(sheet.id),
    name: String(sheet.name),
    sideMode,
    cardIds: Array.isArray(sheet.cardIds) ? sheet.cardIds.map(String) : [],
    settings: sheet.settings && typeof sheet.settings === 'object' ? (sheet.settings as ExportSettings) : undefined,
    thumbnailPlacements: Array.isArray(sheet.thumbnailPlacements) ? sheet.thumbnailPlacements : undefined,
    thumbnailSide: sheet.thumbnailSide === 'back' ? 'back' : sheet.thumbnailSide === 'front' ? 'front' : undefined,
    sheetCount: Number.isFinite(sheet.sheetCount) ? Number(sheet.sheetCount) : undefined,
    createdAt: sheet.createdAt ?? new Date().toISOString(),
    updatedAt: sheet.updatedAt ?? sheet.createdAt ?? new Date().toISOString(),
    side: sheet.side === 'back' ? 'back' : sheet.side === 'front' ? 'front' : undefined,
    pageIndex: Number.isFinite(sheet.pageIndex) ? Number(sheet.pageIndex) : undefined,
    placements: Array.isArray(sheet.placements) ? sheet.placements : undefined,
  };
}

function loadLocalStorageMirror(): SavedPrintSheet[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(normalizeSheet).filter((sheet): sheet is SavedPrintSheet => Boolean(sheet)) : [];
  } catch {
    return [];
  }
}

function saveLocalStorageMirror(sheets: SavedPrintSheet[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey, JSON.stringify(sheets));
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = window.indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

function getAllSheetsFromDb(db: IDBDatabase): Promise<SavedPrintSheet[]> {
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => {
      const records = Array.isArray(request.result) ? request.result.map(normalizeSheet).filter((sheet): sheet is SavedPrintSheet => Boolean(sheet)) : [];
      resolve(records.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
    };
    request.onerror = () => resolve([]);
  });
}

function putAllSheetsToDb(db: IDBDatabase, sheets: SavedPrintSheet[]): Promise<void> {
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.clear();
    sheets.forEach((sheet) => store.put(sheet));
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export function loadSavedPrintSheets(): SavedPrintSheet[] {
  return loadLocalStorageMirror();
}

export async function hydrateSavedPrintSheets(): Promise<SavedPrintSheet[]> {
  const db = await openDb();
  if (!db) return loadLocalStorageMirror();
  const fromDb = await getAllSheetsFromDb(db);
  db.close();
  if (fromDb.length > 0) {
    saveLocalStorageMirror(fromDb);
    return fromDb;
  }
  const mirrored = loadLocalStorageMirror();
  if (mirrored.length > 0) await savePrintSheets(mirrored);
  return mirrored;
}

export async function savePrintSheets(sheets: SavedPrintSheet[]) {
  const normalized = sheets.map(normalizeSheet).filter((sheet): sheet is SavedPrintSheet => Boolean(sheet));
  saveLocalStorageMirror(normalized);
  const db = await openDb();
  if (!db) return;
  await putAllSheetsToDb(db, normalized);
  db.close();
}

// Default name is just a timestamp so jobs are distinguishable; the side/paper/dpi/card/sheet
// metadata is shown separately in the list row (no need to repeat it in the name).
export function makeSavedJobName(createdAt = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `인쇄 묶음 ${createdAt.getMonth() + 1}/${createdAt.getDate()} ${pad(createdAt.getHours())}:${pad(createdAt.getMinutes())}`;
}
