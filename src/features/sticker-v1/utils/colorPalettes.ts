import type { TemplateFillStyle, TemplateFillTexture, TemplateTextureParams } from '@sticker-v1/types';

export type PlatformPaletteKey =
  | 'Arcade'
  | 'Neo Geo'
  | 'CPS1'
  | 'CPS2'
  | 'CPS3'
  | 'CAVE'
  | 'NES'
  | 'SNES'
  | 'Genesis / Mega Drive'
  | 'PlayStation / PS1'
  | 'PC Engine'
  | 'Game Boy'
  | 'Game Boy Advance';

export const basicColorPalette = [
  '#000000',
  '#ffffff',
  '#ff0000',
  '#00ff00',
  '#0000ff',
  '#ffff00',
  '#ff00ff',
  '#00ffff',
  '#808080',
  '#f3f4f6',
];

export const platformColorPalettes: Record<PlatformPaletteKey, string[]> = {
  Arcade: ['#111111', '#e60012', '#ffcc00', '#00a2ff', '#ffffff', '#2b2b2b'],
  'Neo Geo': ['#000000', '#ffffff', '#d4af37', '#c00000', '#1f1f1f', '#808080'],
  CPS1: ['#1b1b1b', '#ffcc00', '#e53935', '#2f80ed', '#ffffff'],
  CPS2: ['#1f2a44', '#f2c94c', '#eb5757', '#56ccf2', '#ffffff'],
  CPS3: ['#111827', '#ef4444', '#f97316', '#e5e7eb', '#6b7280'],
  CAVE: ['#0b0b0f', '#8b5cf6', '#ec4899', '#22d3ee', '#ffffff'],
  NES: ['#7c7c7c', '#bc0000', '#000000', '#ffffff', '#d8d8d8'],
  SNES: ['#4f43ae', '#8e44ad', '#d8d8d8', '#3b3b3b', '#ffffff'],
  'Genesis / Mega Drive': ['#000000', '#ffffff', '#e60012', '#0072ce', '#2b2b2b'],
  'PlayStation / PS1': ['#111111', '#ffffff', '#005baa', '#e60012', '#f7d117', '#00a651'],
  'PC Engine': ['#ffffff', '#e60012', '#f5f5f5', '#222222', '#b0b0b0'],
  'Game Boy': ['#8bac0f', '#306230', '#0f380f', '#9bbc0f', '#ffffff'],
  'Game Boy Advance': ['#3f51b5', '#6a5acd', '#ffffff', '#ffcc00', '#222222'],
};

const savedColorsKey = 'zaparoo.savedColors.v1';
const savedStylesKey = 'zaparoo.savedStyles.v1';
const maxSavedColors = 32;
const maxSavedStyles = 32;

export type SavedStyle =
  | { id: string; type: 'solid'; color: string; opacity?: number; name?: string; createdAt: string }
  | { id: string; type: 'none' | 'noStroke'; name?: string; createdAt: string }
  | { id: string; type: 'linearGradient'; colors: [string, string]; angle?: number; opacity?: number; name?: string; createdAt: string }
  | { id: string; type: 'radialGradient'; colors: [string, string]; opacity?: number; name?: string; createdAt: string }
  | { id: string; type: 'texture'; texture: TemplateFillTexture; color?: string; secondaryColor?: string; opacity?: number; textureParams?: TemplateTextureParams; name?: string; createdAt: string };

export function normalizeHexColor(value: string) {
  const compact = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(compact)) {
    return `#${compact.split('').map((char) => char + char).join('')}`.toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(compact)) return `#${compact.toLowerCase()}`;
  return undefined;
}

export function loadSavedColors() {
  try {
    const parsed = JSON.parse(localStorage.getItem(savedColorsKey) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value) => normalizeHexColor(String(value))).filter((value): value is string => Boolean(value));
  } catch {
    return [];
  }
}

export function saveSavedColors(colors: string[]) {
  const normalized = Array.from(new Set(colors.map((color) => normalizeHexColor(color)).filter((color): color is string => Boolean(color))));
  localStorage.setItem(savedColorsKey, JSON.stringify(normalized.slice(0, maxSavedColors)));
  return normalized.slice(0, maxSavedColors);
}

export function addSavedColor(colors: string[], color: string) {
  const normalized = normalizeHexColor(color);
  if (!normalized) return colors;
  return saveSavedColors([normalized, ...colors.filter((candidate) => normalizeHexColor(candidate) !== normalized)]);
}

export function removeSavedColor(colors: string[], color: string) {
  const normalized = normalizeHexColor(color);
  return saveSavedColors(colors.filter((candidate) => normalizeHexColor(candidate) !== normalized));
}

function makeSavedStyleId() {
  return `style-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeStyleColors(style: SavedStyle): SavedStyle {
  if (style.type === 'solid') return { ...style, color: normalizeHexColor(style.color) ?? '#000000' };
  if (style.type === 'linearGradient' || style.type === 'radialGradient') {
    return {
      ...style,
      colors: [
        normalizeHexColor(style.colors[0]) ?? '#000000',
        normalizeHexColor(style.colors[1]) ?? '#ffffff',
      ],
    };
  }
  if (style.type === 'texture') {
    return {
      ...style,
      color: normalizeHexColor(style.color ?? '#000000'),
      secondaryColor: normalizeHexColor(style.secondaryColor ?? '#ffffff'),
    };
  }
  return style;
}

export function savedStyleFingerprint(style: SavedStyle) {
  const normalized = normalizeStyleColors(style);
  const rest = { ...normalized } as Record<string, unknown>;
  delete rest.id;
  delete rest.createdAt;
  delete rest.name;
  return JSON.stringify(rest);
}

function coerceSavedStyle(value: unknown): SavedStyle | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<SavedStyle>;
  const createdAt = typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString();
  const id = typeof candidate.id === 'string' ? candidate.id : makeSavedStyleId();
  if (candidate.type === 'solid') {
    const color = normalizeHexColor(String(candidate.color ?? ''));
    if (!color) return undefined;
    return { id, type: 'solid', color, opacity: Number(candidate.opacity ?? 1), createdAt, name: candidate.name };
  }
  if (candidate.type === 'none' || candidate.type === 'noStroke') return { id, type: candidate.type, createdAt, name: candidate.name };
  if (candidate.type === 'linearGradient' || candidate.type === 'radialGradient') {
    const colors = Array.isArray(candidate.colors) ? candidate.colors : [];
    const first = normalizeHexColor(String(colors[0] ?? ''));
    const second = normalizeHexColor(String(colors[1] ?? ''));
    if (!first || !second) return undefined;
    if (candidate.type === 'linearGradient') {
      return { id, type: 'linearGradient', colors: [first, second], angle: Number(candidate.angle ?? 45), opacity: Number(candidate.opacity ?? 1), createdAt, name: candidate.name };
    }
    return { id, type: 'radialGradient', colors: [first, second], opacity: Number(candidate.opacity ?? 1), createdAt, name: candidate.name };
  }
  if (candidate.type === 'texture') {
    return {
      id,
      type: 'texture',
      texture: (candidate.texture as TemplateFillTexture | undefined) ?? 'paper',
      color: normalizeHexColor(String(candidate.color ?? '#000000')),
      secondaryColor: normalizeHexColor(String(candidate.secondaryColor ?? '#ffffff')),
      opacity: Number(candidate.opacity ?? 1),
      textureParams: typeof candidate.textureParams === 'object' && candidate.textureParams ? candidate.textureParams as TemplateTextureParams : undefined,
      createdAt,
      name: candidate.name,
    };
  }
  return undefined;
}

export function fillStyleToSavedStyle(style: TemplateFillStyle, fallbackColor: string): SavedStyle {
  const createdAt = new Date().toISOString();
  if (style.type === 'none') return { id: makeSavedStyleId(), type: 'none', createdAt };
  if (style.type === 'solid') return { id: makeSavedStyleId(), type: 'solid', color: normalizeHexColor(style.color) ?? normalizeHexColor(fallbackColor) ?? '#000000', opacity: style.opacity, createdAt };
  if (style.type === 'linearGradient') return { id: makeSavedStyleId(), type: 'linearGradient', colors: [normalizeHexColor(style.colors[0]) ?? '#000000', normalizeHexColor(style.colors[1]) ?? '#ffffff'], angle: style.angle, opacity: style.opacity, createdAt };
  if (style.type === 'radialGradient') return { id: makeSavedStyleId(), type: 'radialGradient', colors: [normalizeHexColor(style.colors[0]) ?? '#000000', normalizeHexColor(style.colors[1]) ?? '#ffffff'], opacity: style.opacity, createdAt };
  return {
    id: makeSavedStyleId(),
    type: 'texture',
    texture: style.texture,
    color: normalizeHexColor(style.color ?? fallbackColor),
    secondaryColor: normalizeHexColor(style.secondaryColor ?? '#ffffff'),
    opacity: style.opacity,
    textureParams: style.textureParams,
    createdAt,
  };
}

export function loadSavedStyles() {
  try {
    const parsed = JSON.parse(localStorage.getItem(savedStylesKey) ?? '[]');
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map(coerceSavedStyle).filter((style): style is SavedStyle => Boolean(style));
    }
  } catch {
    // Fall back to legacy saved colors.
  }
  return loadSavedColors().map((color) => ({
    id: makeSavedStyleId(),
    type: 'solid' as const,
    color,
    createdAt: new Date().toISOString(),
  }));
}

export function saveSavedStyles(styles: SavedStyle[]) {
  const next: SavedStyle[] = [];
  const seen = new Set<string>();
  for (const style of styles) {
    const normalized = normalizeStyleColors(style);
    const fingerprint = savedStyleFingerprint(normalized);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    next.push(normalized);
    if (next.length >= maxSavedStyles) break;
  }
  localStorage.setItem(savedStylesKey, JSON.stringify(next));
  return next;
}

export function addSavedStyle(styles: SavedStyle[], style: SavedStyle) {
  return saveSavedStyles([style, ...styles]);
}

export function removeSavedStyle(styles: SavedStyle[], id: string) {
  return saveSavedStyles(styles.filter((style) => style.id !== id));
}
