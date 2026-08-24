import type { SavedCardRecord } from '@sticker-v1/types';

const DEFAULT_MAX_SINGLE_CARD_BASE_LENGTH = 80;
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*]+/g;

export interface CardExportZipFilenameOptions {
  now?: Date;
  existingFilenames?: Iterable<string>;
  maxBaseLength?: number;
}

interface SingleCardName {
  baseName: string;
  fallback: boolean;
}

function readableString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function looseObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function trimUnsafeFilenameEdges(value: string) {
  return value.replace(/^[\s.]+/, '').replace(/[\s.]+$/, '').replace(/[\s._-]+$/, '');
}

export function sanitizeCardExportFilenameBase(value: string, maxLength = DEFAULT_MAX_SINGLE_CARD_BASE_LENGTH) {
  const withoutControlCharacters = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 ? ' ' : character;
  }).join('');

  let safe = withoutControlCharacters
    .normalize('NFC')
    .replace(INVALID_FILENAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[-_.]{2,}/g, (match) => match[0])
    .trim();

  safe = trimUnsafeFilenameEdges(safe);
  if (!safe) return '';

  const characters = Array.from(safe);
  if (characters.length <= maxLength) return safe;

  let truncated = characters.slice(0, maxLength).join('');
  const wordBoundary = Math.max(truncated.lastIndexOf(' '), truncated.lastIndexOf('-'), truncated.lastIndexOf('_'));
  if (wordBoundary >= Math.floor(maxLength * 0.6)) truncated = truncated.slice(0, wordBoundary);

  return trimUnsafeFilenameEdges(truncated);
}

export function selectSingleCardExportName(record: SavedCardRecord, maxBaseLength = DEFAULT_MAX_SINGLE_CARD_BASE_LENGTH): SingleCardName {
  const recordFields = record as SavedCardRecord & Record<string, unknown>;
  const cardFields = record.card as SavedCardRecord['card'] & Record<string, unknown>;
  const misterFields = looseObject(record.mister);
  const candidates = [
    readableString(recordFields.linkedGameTitle),
    readableString(cardFields.linkedGameTitle),
    readableString(misterFields.linkedGameTitle),
    readableString(recordFields.gameName),
    readableString(cardFields.gameName),
    readableString(misterFields.gameName),
    readableString(record.title),
    readableString(cardFields.title),
    readableString(record.card.front.titleText),
    readableString(recordFields.name),
    readableString(cardFields.name),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const baseName = sanitizeCardExportFilenameBase(candidate, maxBaseLength);
    if (baseName) return { baseName, fallback: false };
  }

  return { baseName: 'card', fallback: true };
}

function localTimestampForCards(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function uniqueFilename(firstFilename: string, suffixedFilename: (suffix: number) => string, existingFilenames?: Iterable<string>) {
  if (!existingFilenames) return firstFilename;

  const existing = new Set(Array.from(existingFilenames, (filename) => filename.toLocaleLowerCase()));
  if (!existing.has(firstFilename.toLocaleLowerCase())) return firstFilename;

  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = suffixedFilename(suffix);
    if (!existing.has(candidate.toLocaleLowerCase())) return candidate;
  }

  return suffixedFilename(Date.now());
}

export function createCardExportZipFilename(records: SavedCardRecord[], options: CardExportZipFilenameOptions = {}) {
  if (records.length === 1) {
    const { baseName, fallback } = selectSingleCardExportName(records[0], options.maxBaseLength);
    if (fallback) {
      return uniqueFilename('card.zip', (suffix) => `card-${suffix}.zip`, options.existingFilenames);
    }
    return uniqueFilename(`${baseName}-card.zip`, (suffix) => `${baseName}-${suffix}-card.zip`, options.existingFilenames);
  }

  const timestamp = localTimestampForCards(options.now ?? new Date());
  return uniqueFilename(`${timestamp}-cards.zip`, (suffix) => `${timestamp}-cards-${suffix}.zip`, options.existingFilenames);
}
