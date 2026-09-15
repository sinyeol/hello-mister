import type { CardItem } from '@sticker-v1/types/card';
import type { TemplateLayer } from '@sticker-v1/types/template';

// Single source of truth for the text a template layer shows on a card. The card editor preview, the sheet
// editor, PNG/PDF export and system print all render through this, so editor and output can never drift
// (CLAUDE.md §7). It also expands {manufacturer} / {year} / {genre} style tokens from the metadata the MiSTer
// scan stored on the card, which is how arcade facts land on the card back without a per-card edit.

export type CardTextTokens = Record<string, string>;

function joinParts(parts: Array<string | undefined>, separator = ' · ') {
  return parts.map((part) => (part ?? '').trim()).filter(Boolean).join(separator);
}

export function cardTextTokens(card: CardItem, side: 'front' | 'back'): CardTextTokens {
  const mister = card.mister;
  const manufacturer = mister?.misterManufacturer ?? '';
  const year = mister?.misterReleaseYear ?? '';
  const genre = mister?.misterGenre ?? '';
  const players = mister?.misterPlayers ?? '';
  const region = mister?.misterRegion ?? '';
  const buttons = mister?.misterNumButtons ? `${mister.misterNumButtons}버튼` : '';
  return {
    title: card.front.titleText ?? '',
    category: (side === 'front' ? card.front.categoryLabel : card.back.categoryLabel) ?? '',
    platform: card.front.platformLabel ?? mister?.misterSystemId ?? '',
    system: mister?.misterSystemId ?? card.front.platformLabel ?? '',
    manufacturer,
    year,
    genre,
    players,
    region,
    buttons,
    // Convenience token for the usual one-line credit on the card back.
    info: joinParts([manufacturer, year, genre]),
  };
}

// A separator is "·" / "|" anywhere, or "-", "–", "—", "/", "," surrounded by spaces. The space requirement keeps
// hyphenated words intact ("Fighter - Versus Co-op" splits at the spaced dash only, never inside "Co-op").
const separatorPattern = /\s*[·|]\s*|\s+[-–—/,]\s+/;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Drops separators left dangling by an empty token, so "{manufacturer} · {year} · {genre}" with only a year
// renders "1999" instead of " ·  · 1999". Only the line's FIRST separator kind is treated as a separator, so a
// dash inside a value ("Fighter - Versus") survives on a line joined by "·".
function tidyLine(line: string) {
  const collapsed = line.replace(/\s+/g, ' ').trim();
  const first = collapsed.match(separatorPattern);
  if (!first) return collapsed;
  const separator = first[0].trim();
  const escaped = escapeRegExp(separator);
  const splitter = separator === '·' || separator === '|'
    ? new RegExp(`\\s*${escaped}\\s*`, 'g')
    : new RegExp(`\\s+${escaped}\\s+`, 'g');
  const parts = collapsed.split(splitter).map((part) => part.trim()).filter(Boolean);
  return parts.join(` ${separator} `);
}

function tidySeparators(value: string) {
  return value.split('\n').map(tidyLine).join('\n').trim();
}

export function expandCardTextTokens(text: string, tokens: CardTextTokens) {
  if (!text.includes('{')) return text;
  const expanded = text.replace(/\{([a-zA-Z]+)\}/g, (match, name: string) => {
    const key = name.toLowerCase();
    return key in tokens ? tokens[key] : match;
  });
  return tidySeparators(expanded);
}

// The layer's raw text before token expansion. Mirrors the historical slot-type mapping so existing templates
// keep rendering exactly what they did.
function rawSlotText(layer: TemplateLayer, card: CardItem, side: 'front' | 'back') {
  if (layer.slotType === 'categoryLabel') return side === 'front' ? card.front.categoryLabel : card.back.categoryLabel;
  if (layer.slotType === 'platformLabel') return card.front.platformLabel;
  if (layer.slotType === 'brandText') return 'Hello Mister';
  if (layer.slotType === 'titleText') return card.front.titleText;
  if (layer.slotType === 'gameLogo') return card.front.titleText;
  if (layer.slotType === 'platformLogo') return card.front.platformLabel;
  if (layer.slotType === 'heroImage' || layer.slotType === 'mainImage' || layer.slotType === 'backgroundArt' || layer.slotType === 'background') return '이미지 없음';
  if (layer.data?.text) return String(layer.data.text);
  return layer.slot?.label ?? layer.slotType ?? '';
}

export function cardSlotText(layer: TemplateLayer, card: CardItem, side: 'front' | 'back') {
  const raw = rawSlotText(layer, card, side);
  if (!raw) return raw;
  return expandCardTextTokens(String(raw), cardTextTokens(card, side));
}
