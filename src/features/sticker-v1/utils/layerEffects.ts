import type { CSSProperties } from 'react';
import type { TemplateLayer } from '@sticker-v1/types';
import { createId } from '@sticker-v1/utils/ids';

export type LayerEffectType =
  | 'opacity'
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'blur'
  | 'grayscale'
  | 'sepia'
  | 'hueRotate'
  | 'dropShadow'
  | 'glow'
  | 'outline'
  | 'scanline'
  | 'noise'
  | 'vignette';

export type LayerEffect = {
  id: string;
  type: LayerEffectType;
  enabled: boolean;
  settings: {
    amount?: number;
    radius?: number;
    color?: string;
    offsetX?: number;
    offsetY?: number;
    opacity?: number;
    thickness?: number;
    spacing?: number;
  };
};

export const layerEffectLabels: Record<LayerEffectType, string> = {
  opacity: '투명도',
  brightness: '밝기',
  contrast: '대비',
  saturation: '채도',
  blur: '블러',
  grayscale: '흑백',
  sepia: '세피아',
  hueRotate: '색조 회전',
  dropShadow: '그림자',
  glow: '글로우',
  outline: '외곽선',
  scanline: '스캔라인',
  noise: '노이즈',
  vignette: '비네팅',
};

export const imageLayerEffectOptions: LayerEffectType[] = [
  'opacity',
  'brightness',
  'contrast',
  'saturation',
  'blur',
  'grayscale',
  'sepia',
  'hueRotate',
  'dropShadow',
  'glow',
  'outline',
  'scanline',
  'noise',
  'vignette',
];

export const shapeLayerEffectOptions: LayerEffectType[] = [
  'opacity',
  'blur',
  'dropShadow',
  'glow',
  'outline',
  'noise',
  'vignette',
];

export function defaultLayerEffect(type: LayerEffectType): LayerEffect {
  const id = createId('effect');
  if (type === 'opacity') return { id, type, enabled: true, settings: { amount: 90 } };
  if (type === 'brightness' || type === 'contrast' || type === 'saturation') {
    return { id, type, enabled: true, settings: { amount: 110 } };
  }
  if (type === 'grayscale' || type === 'sepia') {
    return { id, type, enabled: true, settings: { amount: 100 } };
  }
  if (type === 'hueRotate') return { id, type, enabled: true, settings: { amount: 30 } };
  if (type === 'blur') return { id, type, enabled: true, settings: { radius: 2 } };
  if (type === 'dropShadow') {
    return { id, type, enabled: true, settings: { color: '#000000', radius: 6, offsetX: 2, offsetY: 3 } };
  }
  if (type === 'outline') return { id, type, enabled: true, settings: { color: '#ffffff', radius: 1 } };
  if (type === 'scanline') return { id, type, enabled: true, settings: { amount: 24 } };
  if (type === 'noise') return { id, type, enabled: true, settings: { amount: 18 } };
  if (type === 'vignette') return { id, type, enabled: true, settings: { amount: 28 } };
  return { id, type, enabled: true, settings: { color: '#00e5ff', radius: 8 } };
}

function coerceEffect(value: unknown): LayerEffect | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<LayerEffect>;
  if (!candidate.type || !(candidate.type in layerEffectLabels)) return undefined;
  return {
    id: typeof candidate.id === 'string' ? candidate.id : createId('effect'),
    type: candidate.type,
    enabled: candidate.enabled !== false,
    settings: typeof candidate.settings === 'object' && candidate.settings ? candidate.settings : {},
  };
}

export function getLayerEffects(layer: TemplateLayer): LayerEffect[] {
  const raw = layer.data?.effects;
  if (!Array.isArray(raw)) return [];
  return raw.map(coerceEffect).filter((effect): effect is LayerEffect => Boolean(effect));
}

export function layerEffectSummary(layer: TemplateLayer) {
  const enabled = getLayerEffects(layer).filter((effect) => effect.enabled);
  if (enabled.length === 0) return '효과 없음';
  return enabled.map((effect) => layerEffectLabels[effect.type]).join(', ');
}

export function effectAmountBounds(type: LayerEffectType) {
  if (type === 'opacity') return { min: 0, max: 100, step: 1, unit: '%' };
  if (type === 'brightness' || type === 'contrast' || type === 'saturation') return { min: 0, max: 200, step: 1, unit: '%' };
  if (type === 'grayscale' || type === 'sepia') return { min: 0, max: 100, step: 1, unit: '%' };
  if (type === 'hueRotate') return { min: 0, max: 360, step: 1, unit: '°' };
  if (type === 'scanline' || type === 'noise' || type === 'vignette') return { min: 0, max: 100, step: 1, unit: '%' };
  return { min: 0, max: 40, step: 1, unit: 'px' };
}

export function layerEffectStyle(layer: TemplateLayer): CSSProperties {
  const filters: string[] = [];
  const shadows: string[] = [];
  let opacityMultiplier = 1;

  for (const effect of getLayerEffects(layer)) {
    if (!effect.enabled) continue;
    const amount = Number(effect.settings.amount ?? 100);
    const radius = Math.max(0, Number(effect.settings.radius ?? 0));
    const color = String(effect.settings.color ?? '#000000');
    const effectOpacity = Math.max(0, Math.min(100, Number(effect.settings.opacity ?? amount))) / 100;
    if (effect.type === 'opacity') opacityMultiplier *= Math.max(0, Math.min(100, amount)) / 100;
    if (effect.type === 'brightness') filters.push(`brightness(${amount}%)`);
    if (effect.type === 'contrast') filters.push(`contrast(${amount}%)`);
    if (effect.type === 'saturation') filters.push(`saturate(${amount}%)`);
    if (effect.type === 'grayscale') filters.push(`grayscale(${amount}%)`);
    if (effect.type === 'sepia') filters.push(`sepia(${amount}%)`);
    if (effect.type === 'hueRotate') filters.push(`hue-rotate(${amount}deg)`);
    if (effect.type === 'blur') filters.push(`blur(${radius}px)`);
    if (effect.type === 'dropShadow') {
      filters.push(`drop-shadow(${Number(effect.settings.offsetX ?? 2)}px ${Number(effect.settings.offsetY ?? 3)}px ${radius}px ${color}${Math.round(effectOpacity * 255).toString(16).padStart(2, '0')})`);
    }
    if (effect.type === 'glow') shadows.push(`0 0 ${radius}px ${color}`);
    if (effect.type === 'outline') shadows.push(`0 0 0 ${Math.max(1, Number(effect.settings.thickness ?? radius))}px ${color}`);
    if (effect.type === 'scanline') {
      shadows.push(`inset 0 0 0 9999px rgba(0,0,0,${effectOpacity / 8})`);
    }
    if (effect.type === 'noise') {
      filters.push(`contrast(${100 + Math.max(0, Math.min(100, amount)) / 4}%)`);
    }
    if (effect.type === 'vignette') {
      shadows.push(`inset 0 0 ${Math.max(4, amount)}px rgba(0,0,0,0.32)`);
    }
  }

  return {
    filter: filters.length > 0 ? filters.join(' ') : undefined,
    boxShadow: shadows.length > 0 ? shadows.join(', ') : undefined,
    opacity: opacityMultiplier < 1 ? opacityMultiplier : undefined,
  };
}
