import JSZip from 'jszip';
import type {
  MameAliasRow,
  MameIndexes,
  MameMappingDataset,
  MameMasterRow,
  MameMachine,
  MameUserOverride,
} from '@sticker-v1/types';
import { normalizeName } from '@sticker-v1/utils/normalizeName';

const dbName = 'zaparoo-mame';
const dbVersion = 1;
const storeName = 'datasets';
const activeDatasetKey = 'active';
const metaStorageKey = 'zaparoo.mameDatasetMeta.v1';
const masterHeaders = ['rom_name', 'display_title', 'parent_rom', 'is_clone', 'category'];
const aliasHeaders = ['rom_name', 'alias', 'alias_normalized', 'alias_type', 'priority'];

export const emptyMameMapping: MameMappingDataset = {
  machines: [],
  indexes: {
    romName: {},
    parentRom: {},
    displayTitle: {},
    alias: {},
  },
  userOverrides: {},
  masterRows: [],
  aliasRows: [],
};

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet<T>(key: string) {
  const db = await openDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

async function idbSet<T>(key: string, value: T) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

async function idbDelete(key: string) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

function addIndexValue(index: Record<string, string[]>, key: string | undefined, romName: string) {
  if (!key) return;
  index[key] = Array.from(new Set([...(index[key] ?? []), romName]));
}

function titleAliases(title: string) {
  const normalized = normalizeName(title);
  const firstDash = normalizeName(title.split(/\s+-\s+/)[0] ?? title);
  const withoutThe = normalized.replace(/^the\s+/, '');
  return Array.from(new Set([normalized, firstDash, withoutThe].filter(Boolean)));
}

function buildIndexes(machines: MameMachine[]): MameIndexes {
  const indexes: MameIndexes = { romName: {}, parentRom: {}, displayTitle: {}, alias: {} };
  machines.forEach((machine) => {
    indexes.romName[machine.normalizedRomName] = machine.romName;
    addIndexValue(indexes.parentRom, machine.normalizedParentRom, machine.romName);
    addIndexValue(indexes.displayTitle, machine.normalizedDisplayTitle, machine.romName);
    machine.normalizedAliases.forEach((alias) => addIndexValue(indexes.alias, alias, machine.romName));
  });
  return indexes;
}

function machineFromElement(element: Element): MameMachine | undefined {
  const romName = element.getAttribute('name')?.trim() ?? '';
  if (!romName) return undefined;
  const displayTitle = element.querySelector('description')?.textContent?.trim() || romName;
  const parentRom = element.getAttribute('cloneof')?.trim() || element.getAttribute('romof')?.trim() || undefined;
  const year = element.querySelector('year')?.textContent?.trim() || undefined;
  const manufacturer = element.querySelector('manufacturer')?.textContent?.trim() || undefined;
  const input = element.querySelector('input');
  const display = element.querySelector('display');
  const normalizedRomName = normalizeName(romName);
  const normalizedDisplayTitle = normalizeName(displayTitle);
  return {
    romName,
    displayTitle,
    parentRom,
    isClone: Boolean(parentRom),
    year,
    manufacturer,
    players: input?.getAttribute('players') ?? undefined,
    rotation: display?.getAttribute('rotate') ?? undefined,
    category: 'Arcade',
    normalizedRomName,
    normalizedDisplayTitle,
    normalizedParentRom: parentRom ? normalizeName(parentRom) : undefined,
    normalizedAliases: titleAliases(displayTitle),
  };
}

function parseXmlContent(xml: string, sourceFileName: string): MameMappingDataset {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) throw new Error('Could not parse MAME XML. Please check that the file is valid XML.');
  const machines = Array.from(doc.querySelectorAll('machine, game'))
    .map(machineFromElement)
    .filter((machine): machine is MameMachine => Boolean(machine));
  if (machines.length === 0) throw new Error('No MAME machine entries were found in the XML.');
  const version = doc.documentElement.getAttribute('build') ?? doc.documentElement.getAttribute('version') ?? undefined;
  const meta = {
    id: `mame_${Date.now()}`,
    sourceFileName,
    version,
    machineCount: machines.length,
    cloneCount: machines.filter((machine) => machine.isClone).length,
    loadedAt: new Date().toISOString(),
    status: 'ready' as const,
  };
  return {
    ...emptyMameMapping,
    meta,
    machines,
    indexes: buildIndexes(machines),
  };
}

export async function parseMameXmlFile(file: File): Promise<MameMappingDataset> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.zip')) {
    const zip = await JSZip.loadAsync(file);
    const xmlFile = Object.values(zip.files).find((entry) => !entry.dir && entry.name.toLowerCase().endsWith('.xml'));
    if (!xmlFile) throw new Error('No XML file was found inside the ZIP.');
    return parseXmlContent(await xmlFile.async('string'), file.name);
  }
  return parseXmlContent(await file.text(), file.name);
}

export async function loadMameMapping(): Promise<MameMappingDataset> {
  const dataset = await idbGet<MameMappingDataset>(activeDatasetKey);
  return dataset ? { ...emptyMameMapping, ...dataset } : emptyMameMapping;
}

export async function persistMameMapping(mapping: MameMappingDataset) {
  await idbSet(activeDatasetKey, mapping);
  if (mapping.meta) localStorage.setItem(metaStorageKey, JSON.stringify(mapping.meta));
  else localStorage.removeItem(metaStorageKey);
}

export async function clearMameMapping() {
  await idbDelete(activeDatasetKey);
  localStorage.removeItem(metaStorageKey);
}

export function loadMameMetaFromLocalStorage() {
  try {
    return JSON.parse(localStorage.getItem(metaStorageKey) ?? 'null') as MameMappingDataset['meta'] | null;
  } catch {
    return null;
  }
}

export function isMameMappingReady(mapping: MameMappingDataset) {
  return mapping.machines.length > 0 && mapping.meta?.status === 'ready';
}

export function mameOverrideKey(gameTitle: string, categoryId: string) {
  return `${categoryId}:${normalizeName(gameTitle)}`;
}

export function withMameUserOverride(
  mapping: MameMappingDataset,
  override: Omit<MameUserOverride, 'updatedAt'>,
): MameMappingDataset {
  const nextOverride: MameUserOverride = { ...override, updatedAt: new Date().toISOString() };
  return {
    ...mapping,
    userOverrides: {
      ...mapping.userOverrides,
      [nextOverride.key]: nextOverride,
    },
  };
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseCsv(content: string) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  const headers = parseCsvLine(lines[0] ?? '').map((header) => header.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
  });
  return { headers, rows };
}

function validateHeaders(headers: string[], required: string[], label: string) {
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length > 0) throw new Error(`${label} CSV is missing required header(s): ${missing.join(', ')}`);
}

export function parseMameMasterCsv(content: string): MameMasterRow[] {
  const { headers, rows } = parseCsv(content);
  validateHeaders(headers, masterHeaders, 'MAME master');
  return rows
    .map<MameMasterRow | undefined>((row) => {
      const romName = String(row.rom_name ?? '').trim();
      const displayTitle = String(row.display_title ?? '').trim();
      if (!romName || !displayTitle) return undefined;
      const parentRom = String(row.parent_rom ?? '').trim();
      return {
        romName,
        displayTitle,
        parentRom,
        isClone: String(row.is_clone ?? '').toLowerCase() === 'true' || String(row.is_clone ?? '') === '1',
        category: String(row.category ?? '').trim(),
        normalizedRomName: normalizeName(romName),
        normalizedDisplayTitle: normalizeName(displayTitle),
        normalizedParentRom: parentRom ? normalizeName(parentRom) : undefined,
      };
    })
    .filter((row): row is MameMasterRow => Boolean(row));
}

export function parseMameAliasesCsv(content: string): MameAliasRow[] {
  const { headers, rows } = parseCsv(content);
  validateHeaders(headers, aliasHeaders, 'MAME aliases');
  return rows
    .map((row) => {
      const romName = String(row.rom_name ?? '').trim();
      const alias = String(row.alias ?? '').trim();
      if (!romName || !alias) return undefined;
      const providedNormalized = String(row.alias_normalized ?? '').trim();
      return {
        romName,
        alias,
        aliasNormalized: providedNormalized || normalizeName(alias),
        aliasType: String(row.alias_type ?? '').trim(),
        priority: Number(row.priority ?? 0),
        normalizedRomName: normalizeName(romName),
      };
    })
    .filter((row): row is MameAliasRow => Boolean(row));
}
