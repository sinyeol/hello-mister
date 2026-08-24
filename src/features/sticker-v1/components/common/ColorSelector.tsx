import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { TemplateFillStyle } from '@sticker-v1/types';
import {
  addSavedStyle,
  fillStyleToSavedStyle,
  loadSavedStyles,
  normalizeHexColor,
  removeSavedStyle,
  type SavedStyle,
} from '@sticker-v1/utils/colorPalettes';

const colorDragMime = 'application/x-zaparoo-color';
const styleDragMime = 'application/x-zaparoo-style';

type RgbColor = { r: number; g: number; b: number };
type HsvColor = { h: number; s: number; v: number };
type HslColor = { h: number; s: number; l: number };
type EyeDropperConstructor = new () => { open: () => Promise<{ sRGBHex: string }> };

type ColorSelectorProps = {
  label: string;
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
  compact?: boolean;
  allowTransparent?: boolean;
  transparent?: boolean;
  transparentLabel?: string;
  transparentStyleType?: 'none' | 'noStroke';
  onTransparentChange?: (transparent: boolean) => void;
  allowFillStyles?: boolean;
  fillStyle?: TemplateFillStyle;
  onFillStyleChange?: (style: TemplateFillStyle) => void;
  onLiveSessionStart?: () => void;
  onLiveApply?: () => void;
  onLiveChange?: (color: string) => void;
  onLiveTransparentChange?: (transparent: boolean) => void;
  onLiveFillStyleChange?: (style: TemplateFillStyle) => void;
  onLiveCommit?: () => void;
  onLiveCancel?: () => void;
};

function clampChannel(value: number) {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}

function hexToRgb(hex: string): RgbColor {
  const normalized = normalizeHexColor(hex) ?? '#000000';
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

function rgbToHex(rgb: RgbColor) {
  return `#${[rgb.r, rgb.g, rgb.b].map((channel) => clampChannel(channel).toString(16).padStart(2, '0')).join('')}`;
}

function rgbToHsv(rgb: RgbColor): HsvColor {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

function hsvToRgb(hsv: HsvColor): RgbColor {
  const h = ((hsv.h % 360) + 360) % 360;
  const s = Math.min(1, Math.max(0, hsv.s));
  const v = Math.min(1, Math.max(0, hsv.v));
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: clampChannel((r + m) * 255),
    g: clampChannel((g + m) * 255),
    b: clampChannel((b + m) * 255),
  };
}

function hsvToHex(hsv: HsvColor) {
  return rgbToHex(hsvToRgb(hsv));
}

function rgbToHsl(rgb: RgbColor): HslColor {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
  }
  if (h < 0) h += 360;
  return { h, s, l };
}

function hslToRgb(hsl: HslColor): RgbColor {
  const h = ((hsl.h % 360) + 360) % 360;
  const s = Math.min(1, Math.max(0, hsl.s));
  const l = Math.min(1, Math.max(0, hsl.l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: clampChannel((r + m) * 255),
    g: clampChannel((g + m) * 255),
    b: clampChannel((b + m) * 255),
  };
}

function hslToHex(hsl: HslColor) {
  return rgbToHex(hslToRgb(hsl));
}

function spectrumPointToHex(xRatio: number, yRatio: number) {
  const hue = Math.min(359.999, Math.max(0, xRatio) * 360);
  const lightness = 1 - Math.min(1, Math.max(0, yRatio));
  return hslToHex({ h: hue, s: 1, l: lightness });
}

function adjustContrast(rgb: RgbColor, contrastPercent: number) {
  const factor = Math.max(0, contrastPercent / 100);
  return {
    r: clampChannel(128 + (rgb.r - 128) * factor),
    g: clampChannel(128 + (rgb.g - 128) * factor),
    b: clampChannel(128 + (rgb.b - 128) * factor),
  };
}

function fallbackFillStyle(style: TemplateFillStyle | undefined, fallbackColor: string, transparent?: boolean): TemplateFillStyle {
  if (!style) return transparent ? { type: 'none' } : { type: 'solid', color: fallbackColor };
  if (style.type === 'texture') return { type: 'solid', color: normalizeHexColor(style.color ?? fallbackColor) ?? fallbackColor, opacity: style.opacity };
  return style;
}

function styleColor(style: SavedStyle, fallback = '#000000') {
  if (style.type === 'solid') return normalizeHexColor(style.color) ?? fallback;
  if (style.type === 'linearGradient' || style.type === 'radialGradient') return normalizeHexColor(style.colors[0]) ?? fallback;
  if (style.type === 'texture') return normalizeHexColor(style.color ?? fallback) ?? fallback;
  return fallback;
}

function savedStyleLabel(style: SavedStyle) {
  if (style.type === 'solid') return `단색 ${style.color}`;
  if (style.type === 'none') return '채우기 없음';
  if (style.type === 'noStroke') return '선 없음';
  if (style.type === 'linearGradient') return `선형 그라디언트 ${style.colors[0]} → ${style.colors[1]}`;
  if (style.type === 'radialGradient') return `방사형 그라디언트 ${style.colors[0]} → ${style.colors[1]}`;
  return '저장된 스타일';
}

function savedStylePreviewStyle(style: SavedStyle): CSSProperties {
  if (style.type === 'solid') return { backgroundColor: style.color };
  if (style.type === 'linearGradient') return { backgroundImage: `linear-gradient(${style.angle ?? 45}deg, ${style.colors[0]}, ${style.colors[1]})` };
  if (style.type === 'radialGradient') return { backgroundImage: `radial-gradient(circle, ${style.colors[0]}, ${style.colors[1]})` };
  if (style.type === 'texture') return { backgroundColor: style.color ?? '#ffffff' };
  return {};
}

function SavedStyleButton({ style, selected, disabled, onClick }: { style: SavedStyle; selected?: boolean; disabled?: boolean; onClick: () => void }) {
  const dragColor = styleColor(style);
  return (
    <button
      type="button"
      disabled={disabled}
      draggable={!disabled}
      title={savedStyleLabel(style)}
      aria-label={savedStyleLabel(style)}
      onClick={onClick}
      onDragStart={(event) => {
        if (disabled) return;
        event.dataTransfer.setData(colorDragMime, dragColor);
        event.dataTransfer.setData(styleDragMime, JSON.stringify(style));
        event.dataTransfer.setData('text/plain', dragColor);
        event.dataTransfer.effectAllowed = 'copy';
      }}
      className={`relative h-8 w-8 overflow-hidden rounded border ${style.type === 'none' || style.type === 'noStroke' ? 'image-thumb-frame' : 'bg-white'} ${selected ? 'border-primary ring-2 ring-primary/25' : 'border-black/30'} shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28)] disabled:opacity-40`}
      style={style.type === 'none' || style.type === 'noStroke' ? undefined : savedStylePreviewStyle(style)}
    >
      {(style.type === 'none' || style.type === 'noStroke') && <span className="absolute left-1/2 top-1/2 h-px w-9 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-red-500" />}
    </button>
  );
}

function eyeDropperSupported() {
  return typeof window !== 'undefined' && 'EyeDropper' in window;
}

export function ColorSelector({
  label,
  value,
  onChange,
  disabled,
  compact,
  allowTransparent,
  transparent,
  transparentLabel = '투명 / 없음',
  transparentStyleType = 'none',
  onTransparentChange,
  allowFillStyles,
  fillStyle,
  onFillStyleChange,
  onLiveSessionStart,
  onLiveApply,
  onLiveChange,
  onLiveTransparentChange,
  onLiveFillStyleChange,
  onLiveCommit,
  onLiveCancel,
}: ColorSelectorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectorIdRef = useRef(`color-selector-${Math.random().toString(36).slice(2)}`);
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const originalSnapshotRef = useRef<{ color: string; transparent: boolean; fillStyle: TemplateFillStyle } | null>(null);
  const cancelEditorRef = useRef<() => void>(() => undefined);
  const [open, setOpen] = useState(false);
  const [selectedStop, setSelectedStop] = useState<0 | 1>(0);
  const [contrastValue, setContrastValue] = useState(100);
  const [savedStyles, setSavedStyles] = useState<SavedStyle[]>(() => loadSavedStyles().filter((style) => style.type !== 'texture'));
  const [selectedSavedStyleIds, setSelectedSavedStyleIds] = useState<string[]>([]);
  const normalizedValue = normalizeHexColor(value) ?? '#000000';
  const committedFillStyle = fallbackFillStyle(fillStyle, normalizedValue, transparent);
  const [draftFillStyle, setDraftFillStyle] = useState<TemplateFillStyle>(committedFillStyle);
  const [draftColor, setDraftColor] = useState(normalizedValue);
  const [draftTransparent, setDraftTransparent] = useState(Boolean(transparent));
  const activeFillStyle = open ? draftFillStyle : committedFillStyle;
  const activeTransparent = open ? draftTransparent : Boolean(transparent);
  const selectedColor = allowFillStyles
    ? activeFillStyle.type === 'linearGradient' || activeFillStyle.type === 'radialGradient'
      ? normalizeHexColor(activeFillStyle.colors[selectedStop] ?? normalizedValue) ?? normalizedValue
      : activeFillStyle.type === 'solid'
        ? normalizeHexColor(activeFillStyle.color) ?? normalizedValue
        : draftColor
    : draftColor;
  const selectedRgb = hexToRgb(selectedColor);
  const selectedHsv = rgbToHsv(selectedRgb);
  const selectedHsl = rgbToHsl(selectedRgb);
  const [hexDraft, setHexDraft] = useState(selectedColor);
  const contrastBaseColorRef = useRef(selectedColor);

  useEffect(() => setHexDraft(selectedColor), [selectedColor]);
  useEffect(() => {
    if (!open) contrastBaseColorRef.current = selectedColor;
  }, [open, selectedColor]);
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => firstInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      cancelEditorRef.current();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') cancelEditorRef.current();
    }
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    function handleOtherEditorOpen(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail : undefined;
      if (detail && detail !== selectorIdRef.current) cancelEditorRef.current();
    }
    window.addEventListener('zaparoo-color-editor-open', handleOtherEditorOpen);
    return () => window.removeEventListener('zaparoo-color-editor-open', handleOtherEditorOpen);
  }, [open]);

  function publishLive(nextFillStyle: TemplateFillStyle, nextColor: string, nextTransparent: boolean) {
    if (disabled) return;
    onLiveApply?.();
    if (allowFillStyles) {
      const liveFillStyleChange = onLiveFillStyleChange ?? onFillStyleChange;
      if (liveFillStyleChange) {
        liveFillStyleChange(nextFillStyle);
        return;
      }
    }
    const liveTransparentChange = onLiveTransparentChange ?? onTransparentChange;
    const liveChange = onLiveChange ?? onChange;
    liveTransparentChange?.(nextTransparent);
    if (!nextTransparent) liveChange(nextColor);
  }

  function openEditor() {
    window.dispatchEvent(new CustomEvent('zaparoo-color-editor-open', { detail: selectorIdRef.current }));
    originalSnapshotRef.current = {
      color: normalizedValue,
      transparent: Boolean(transparent),
      fillStyle: committedFillStyle,
    };
    onLiveSessionStart?.();
    setDraftFillStyle(committedFillStyle);
    setDraftColor(normalizedValue);
    setDraftTransparent(Boolean(transparent));
    setSelectedSavedStyleIds([]);
    setContrastValue(100);
    setOpen(true);
  }

  function closeEditor() {
    setOpen(false);
    setSelectedSavedStyleIds([]);
  }

  function cancelEditor() {
    const original = originalSnapshotRef.current;
    if (original) {
      setDraftFillStyle(original.fillStyle);
      setDraftColor(original.color);
      setDraftTransparent(original.transparent);
      publishLive(original.fillStyle, original.color, original.transparent);
    }
    onLiveCancel?.();
    originalSnapshotRef.current = null;
    closeEditor();
  }
  cancelEditorRef.current = cancelEditor;

  function updateGradientStop(color: string, stopIndex = selectedStop) {
    if (activeFillStyle.type !== 'linearGradient' && activeFillStyle.type !== 'radialGradient') return;
    const nextColors = [...activeFillStyle.colors] as [string, string];
    nextColors[stopIndex] = color;
    const nextStyle = { ...activeFillStyle, colors: nextColors };
    setDraftFillStyle(nextStyle);
    if (stopIndex === 0) setDraftColor(color);
    publishLive(nextStyle, color, false);
  }

  function applyColor(color: string) {
    const normalized = normalizeHexColor(color);
    if (!normalized || disabled) return;
    setDraftTransparent(false);
    setSelectedSavedStyleIds([]);
    if (allowFillStyles) {
      if (activeFillStyle.type === 'linearGradient' || activeFillStyle.type === 'radialGradient') {
        updateGradientStop(normalized);
        return;
      }
      const nextStyle: TemplateFillStyle = { type: 'solid', color: normalized };
      setDraftFillStyle(nextStyle);
      setDraftColor(normalized);
      publishLive(nextStyle, normalized, false);
      return;
    }
    setDraftColor(normalized);
    publishLive(activeFillStyle, normalized, false);
  }

  function applyRgb(rgb: RgbColor) {
    applyColor(rgbToHex(rgb));
  }

  function applyHsv(patch: Partial<HsvColor>) {
    applyColor(hsvToHex({ ...selectedHsv, ...patch }));
  }

  function applySpectrumPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const nextHue = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const nextLightness = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    applyColor(spectrumPointToHex(nextHue, nextLightness));
  }

  function currentSavedStyle(): SavedStyle {
    if (allowFillStyles) return fillStyleToSavedStyle(activeFillStyle, selectedColor);
    if (activeTransparent) return { id: `style-${Date.now().toString(36)}`, type: transparentStyleType, createdAt: new Date().toISOString() };
    return { id: `style-${Date.now().toString(36)}`, type: 'solid', color: selectedColor, createdAt: new Date().toISOString() };
  }

  function saveCurrentStyle() {
    setSavedStyles((current) => addSavedStyle(current, currentSavedStyle()).filter((style) => style.type !== 'texture'));
  }

  function confirmEditor() {
    if (disabled) return;
    if (allowFillStyles && onFillStyleChange) {
      if (activeFillStyle.type === 'none') {
        onTransparentChange?.(true);
        onFillStyleChange({ type: 'none' });
      } else {
        onTransparentChange?.(false);
        onFillStyleChange(activeFillStyle);
      }
      onLiveCommit?.();
      originalSnapshotRef.current = null;
      closeEditor();
      return;
    }
    if (activeTransparent) {
      onTransparentChange?.(true);
    } else {
      onTransparentChange?.(false);
      onChange(selectedColor);
    }
    onLiveCommit?.();
    originalSnapshotRef.current = null;
    closeEditor();
  }

  function currentPreviewStyle(): CSSProperties {
    const style = currentSavedStyle();
    if (style.type === 'none' || style.type === 'noStroke') return {};
    return savedStylePreviewStyle(style);
  }

  function handleCurrentStyleDragStart(event: DragEvent<HTMLElement>) {
    const style = currentSavedStyle();
    event.dataTransfer.setData(colorDragMime, styleColor(style, selectedColor));
    event.dataTransfer.setData(styleDragMime, JSON.stringify(style));
    event.dataTransfer.setData('text/plain', styleColor(style, selectedColor));
    event.dataTransfer.effectAllowed = 'copy';
  }

  function handleSavedStylesDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    if (disabled) return;
    saveCurrentStyle();
  }

  function applySavedStyle(style: SavedStyle) {
    if (disabled || style.type === 'texture') return;
    setSelectedSavedStyleIds([style.id]);
    if (style.type === 'none' || style.type === 'noStroke') {
      setTransparent(true);
      return;
    }
    setDraftTransparent(false);
    if (allowFillStyles) {
      if (style.type === 'solid' && (activeFillStyle.type === 'linearGradient' || activeFillStyle.type === 'radialGradient')) {
        updateGradientStop(style.color);
        return;
      }
      if (style.type === 'solid') {
        const nextStyle: TemplateFillStyle = { type: 'solid', color: style.color, opacity: style.opacity };
        setDraftFillStyle(nextStyle);
        setDraftColor(style.color);
        publishLive(nextStyle, style.color, false);
        return;
      }
      if (style.type === 'linearGradient') {
        const nextStyle: TemplateFillStyle = { type: 'linearGradient', colors: style.colors, angle: style.angle, opacity: style.opacity };
        setDraftFillStyle(nextStyle);
        setDraftColor(style.colors[0]);
        publishLive(nextStyle, style.colors[0], false);
        return;
      }
      if (style.type === 'radialGradient') {
        const nextStyle: TemplateFillStyle = { type: 'radialGradient', colors: style.colors, opacity: style.opacity };
        setDraftFillStyle(nextStyle);
        setDraftColor(style.colors[0]);
        publishLive(nextStyle, style.colors[0], false);
        return;
      }
    }
    const nextColor = styleColor(style, selectedColor);
    setDraftColor(nextColor);
    publishLive(activeFillStyle, nextColor, false);
  }

  function commitHex() {
    const normalized = normalizeHexColor(hexDraft);
    if (!normalized) {
      setHexDraft(selectedColor);
      return;
    }
    applyColor(normalized);
    setHexDraft(normalized);
  }

  function setFillType(type: TemplateFillStyle['type']) {
    if (!allowFillStyles || disabled || type === 'texture') return;
    setSelectedSavedStyleIds([]);
    if (type === 'none') {
      const nextStyle: TemplateFillStyle = { type: 'none' };
      setDraftTransparent(true);
      setDraftFillStyle(nextStyle);
      publishLive(nextStyle, selectedColor, true);
      return;
    }
    setDraftTransparent(false);
    const nextStyle: TemplateFillStyle =
      type === 'linearGradient'
        ? { type, colors: [selectedColor, '#ffffff'], angle: 45 }
        : type === 'radialGradient'
          ? { type, colors: [selectedColor, '#ffffff'] }
          : { type: 'solid', color: selectedColor };
    setDraftFillStyle(nextStyle);
    publishLive(nextStyle, selectedColor, false);
  }

  function applyDroppedColor(event: DragEvent<HTMLElement>, stopIndex: 0 | 1) {
    event.preventDefault();
    const color = event.dataTransfer.getData(colorDragMime) || event.dataTransfer.getData('text/plain');
    const normalized = normalizeHexColor(color);
    if (!normalized || disabled) return;
    setSelectedStop(stopIndex);
    setSelectedSavedStyleIds([]);
    if (allowFillStyles && (activeFillStyle.type === 'linearGradient' || activeFillStyle.type === 'radialGradient')) {
      updateGradientStop(normalized, stopIndex);
      return;
    }
    applyColor(normalized);
  }

  function setTransparent(nextTransparent: boolean) {
    setDraftTransparent(nextTransparent);
    setSelectedSavedStyleIds([]);
    const nextStyle: TemplateFillStyle = nextTransparent ? { type: 'none' } : { type: 'solid', color: selectedColor };
    if (allowFillStyles) setDraftFillStyle(nextStyle);
    publishLive(allowFillStyles ? nextStyle : activeFillStyle, selectedColor, nextTransparent);
  }

  function updateGradientAngle(angle: number) {
    if (!allowFillStyles || activeFillStyle.type !== 'linearGradient') return;
    const nextStyle: TemplateFillStyle = { ...activeFillStyle, angle };
    setDraftFillStyle(nextStyle);
    publishLive(nextStyle, selectedColor, false);
  }

  async function pickWithEyeDropper() {
    if (!eyeDropperSupported() || disabled) return;
    try {
      const EyeDropper = (window as Window & { EyeDropper?: EyeDropperConstructor }).EyeDropper;
      if (!EyeDropper) return;
      const result = await new EyeDropper().open();
      applyColor(result.sRGBHex);
    } catch {
      // User cancellation is normal for the eyedropper.
    }
  }

  const eyeDropperAvailable = eyeDropperSupported();

  return (
    <div ref={rootRef} className="relative text-sm" data-editor-ui="true">
      <div className={compact ? 'inline-flex items-center gap-1' : 'flex items-center justify-between gap-2 rounded-md border border-line bg-white px-2 py-1.5'}>
        {!compact && <span className="min-w-0 truncate font-medium">{label}</span>}
        <button
          type="button"
          disabled={disabled}
          onClick={() => (open ? cancelEditor() : openEditor())}
          className={compact ? 'inline-flex items-center gap-1 rounded border border-line bg-white px-1.5 py-1 text-[11px] font-medium hover:bg-neutral-50 disabled:opacity-40' : 'inline-flex items-center gap-2 rounded border border-line bg-white px-2 py-1 text-xs font-medium hover:bg-neutral-50 disabled:opacity-40'}
          title={`${label} 선택`}
        >
          <span
            className="image-thumb-frame h-5 w-5 overflow-hidden rounded border border-black/20"
            style={Boolean(transparent) || committedFillStyle.type === 'none' ? undefined : committedFillStyle.type === 'linearGradient' ? { backgroundImage: `linear-gradient(${committedFillStyle.angle ?? 45}deg, ${committedFillStyle.colors[0]}, ${committedFillStyle.colors[1]})` } : committedFillStyle.type === 'radialGradient' ? { backgroundImage: `radial-gradient(circle, ${committedFillStyle.colors[0]}, ${committedFillStyle.colors[1]})` } : { backgroundColor: committedFillStyle.color }}
          />
          {compact ? '수정' : '선택'}
        </button>
      </div>

      {open && (
        <div className="mt-2 rounded-xl border border-neutral-300 bg-white p-3 text-neutral-900 shadow-sm" data-editor-ui="true">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">{label}</span>
            {allowTransparent && (
              <button type="button" disabled={disabled} onClick={() => setTransparent(!(activeTransparent || activeFillStyle.type === 'none'))} className={`rounded border px-2 py-1 text-xs font-medium ${activeTransparent || activeFillStyle.type === 'none' ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-neutral-300 text-neutral-700'}`}>
                {transparentLabel}
              </button>
            )}
          </div>

          {allowFillStyles && (
            <label className="mt-3 block text-xs">
              <span className="font-medium text-neutral-700">채우기 방식</span>
              <select disabled={disabled} value={activeFillStyle.type === 'texture' ? 'solid' : activeFillStyle.type} onChange={(event) => setFillType(event.target.value as TemplateFillStyle['type'])} className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-2 text-neutral-900">
                <option value="solid">단색</option>
                <option value="none">채우기 없음</option>
                <option value="linearGradient">선형 그라디언트</option>
                <option value="radialGradient">방사형 그라디언트</option>
              </select>
            </label>
          )}

          {allowFillStyles && (activeFillStyle.type === 'linearGradient' || activeFillStyle.type === 'radialGradient') && (
            <div className="mt-3 grid gap-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                {([0, 1] as const).map((index) => {
                  const stopColor = normalizeHexColor(activeFillStyle.colors[index] ?? (index === 0 ? normalizedValue : '#ffffff')) ?? (index === 0 ? normalizedValue : '#ffffff');
                  return (
                    <button key={index} type="button" disabled={disabled} onClick={() => setSelectedStop(index)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => applyDroppedColor(event, index)} className={`rounded-md border p-2 text-left ${selectedStop === index ? 'border-sky-500 bg-sky-50 ring-2 ring-sky-200' : 'border-neutral-300 bg-neutral-50'}`}>
                      <span className="block font-medium">색상 {index + 1}</span>
                      <span className="mt-1 flex items-center gap-2"><span className="h-5 w-5 rounded border border-black/20" style={{ backgroundColor: stopColor }} /><span className="truncate">{stopColor}</span></span>
                    </button>
                  );
                })}
              </div>
              {activeFillStyle.type === 'linearGradient' && (
                <label>
                  <span className="font-medium text-neutral-700">각도 {activeFillStyle.angle ?? 45}°</span>
                  <span className="mt-1 flex items-center gap-2">
                    <input type="range" min="0" max="360" disabled={disabled} value={activeFillStyle.angle ?? 45} onChange={(event) => updateGradientAngle(Number(event.target.value))} className="min-w-0 flex-1" />
                    <input type="number" min="0" max="360" step="1" disabled={disabled} value={activeFillStyle.angle ?? 45} onChange={(event) => updateGradientAngle(Number(event.target.value))} className="h-8 w-20 rounded border border-neutral-300 bg-white px-1 text-right text-neutral-900" />
                  </span>
                </label>
              )}
            </div>
          )}

          <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-neutral-800">컬러 피커</p>
              <button
                type="button"
                disabled={disabled || !eyeDropperAvailable}
                onClick={pickWithEyeDropper}
                title={eyeDropperAvailable ? '스포이드' : '현재 환경에서 스포이드를 지원하지 않습니다.'}
                className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-700 disabled:opacity-40"
              >
                스포이드
              </button>
            </div>
            <div className="grid gap-4 xl:grid-cols-[minmax(260px,1fr)_minmax(170px,0.62fr)]">
              <div className="min-w-0">
                <div
                  role="slider"
                  aria-label="전체 색상 스펙트럼 선택"
                  tabIndex={0}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    applySpectrumPointer(event);
                  }}
                  onPointerMove={(event) => {
                    if (event.buttons === 1) {
                      event.preventDefault();
                      applySpectrumPointer(event);
                    }
                  }}
                  className="relative h-56 w-full cursor-crosshair select-none overflow-hidden rounded-md border border-neutral-300"
                  style={{
                    touchAction: 'none',
                    backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(255,255,255,0.24) 18%, rgba(255,255,255,0) 32%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.38) 76%, rgba(0,0,0,0.96) 100%), linear-gradient(90deg, #ff0000 0%, #ffff00 16.666%, #00ff00 33.333%, #00ffff 50%, #0000ff 66.666%, #ff00ff 83.333%, #ff0000 100%)',
                  }}
                >
                  <span
                    className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_2px_rgba(0,0,0,0.8),inset_0_0_0_1px_rgba(0,0,0,0.55)]"
                    style={{ left: `${(selectedHsl.h / 360) * 100}%`, top: `${(1 - selectedHsl.l) * 100}%` }}
                  />
                </div>
                <label className="mt-3 block text-xs">
                  <span className="mb-1 flex justify-between font-medium text-neutral-700">
                    <span>색상</span>
                    <span>{Math.round(selectedHsv.h)}°</span>
                  </span>
                  <input type="range" min="0" max="360" step="1" disabled={disabled} value={Math.round(selectedHsv.h)} onChange={(event) => applyHsv({ h: Number(event.target.value) })} className="w-full" />
                </label>
                <div className="mt-3 flex items-center gap-3 rounded-md border border-neutral-200 bg-white p-2">
                  <span
                    className={`h-11 w-11 shrink-0 overflow-hidden rounded-md border border-neutral-300 ${(transparent || committedFillStyle.type === 'none') ? 'image-thumb-frame' : ''}`}
                    style={Boolean(transparent) || committedFillStyle.type === 'none' ? undefined : committedFillStyle.type === 'linearGradient' ? { backgroundImage: `linear-gradient(${committedFillStyle.angle ?? 45}deg, ${committedFillStyle.colors[0]}, ${committedFillStyle.colors[1]})` } : committedFillStyle.type === 'radialGradient' ? { backgroundImage: `radial-gradient(circle, ${committedFillStyle.colors[0]}, ${committedFillStyle.colors[1]})` } : { backgroundColor: committedFillStyle.color }}
                    title="이전 색상"
                  />
                  <span
                    draggable={!disabled}
                    onDragStart={handleCurrentStyleDragStart}
                    className={`h-11 w-11 shrink-0 cursor-grab overflow-hidden rounded-md border border-black/40 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)] ${(activeTransparent || activeFillStyle.type === 'none') ? 'image-thumb-frame' : ''}`}
                    style={(activeTransparent || activeFillStyle.type === 'none') ? undefined : currentPreviewStyle()}
                    title="현재 색상/스타일을 드래그해 저장"
                  >
                    {(activeTransparent || activeFillStyle.type === 'none') && <span className="block h-full w-full bg-[linear-gradient(135deg,transparent_46%,#ef4444_47%,#ef4444_53%,transparent_54%)]" />}
                  </span>
                  <div className="min-w-0 text-xs">
                    <p className="font-semibold text-neutral-900">이전 / 현재 색상</p>
                    <p className="truncate text-neutral-700">{savedStyleLabel(currentSavedStyle())}</p>
                    <p className="text-[11px] text-neutral-500">현재 chip을 드래그해서 저장할 수 있습니다.</p>
                  </div>
                </div>
              </div>

              <div className="min-w-0 space-y-3">
                <label className="block text-xs">
                  <span className="font-medium text-neutral-700">HEX</span>
                  <input ref={firstInputRef} value={hexDraft} disabled={disabled} onChange={(event) => setHexDraft(event.target.value)} onBlur={commitHex} onKeyDown={(event) => { if (event.key === 'Enter') commitHex(); }} className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900" placeholder="#ff0000" />
                </label>
                <p className="text-xs font-semibold text-neutral-800">RGB</p>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {([
                    ['r', 'R', selectedRgb.r],
                    ['g', 'G', selectedRgb.g],
                    ['b', 'B', selectedRgb.b],
                  ] as const).map(([key, text, channel]) => (
                    <label key={key} className="block">
                      <span className="font-medium text-neutral-700">{text}</span>
                      <input type="number" min="0" max="255" step="1" disabled={disabled} value={channel} onChange={(event) => applyRgb({ ...selectedRgb, [key]: clampChannel(Number(event.target.value)) })} className="mt-1 h-9 w-full rounded border border-neutral-300 bg-white px-2 text-right text-neutral-900" />
                    </label>
                  ))}
                </div>
                <div className="space-y-2 text-xs">
                  {([
                    ['r', 'R', selectedRgb.r, '#ef4444'],
                    ['g', 'G', selectedRgb.g, '#22c55e'],
                    ['b', 'B', selectedRgb.b, '#3b82f6'],
                  ] as const).map(([key, text, channel, accent]) => (
                    <label key={key} className="grid grid-cols-[22px_minmax(0,1fr)_36px] items-center gap-2">
                      <span className="font-semibold text-neutral-700">{text}</span>
                      <input type="range" min="0" max="255" step="1" disabled={disabled} value={channel} onChange={(event) => applyRgb({ ...selectedRgb, [key]: clampChannel(Number(event.target.value)) })} style={{ accentColor: accent }} />
                      <span className="text-right text-neutral-500">{channel}</span>
                    </label>
                  ))}
                </div>
                <div className="space-y-2 rounded-md border border-neutral-200 bg-white p-2 text-xs">
                  <label className="grid grid-cols-[52px_minmax(0,1fr)_42px] items-center gap-2">
                    <span className="font-medium text-neutral-700">채도</span>
                    <input type="range" min="0" max="100" step="1" disabled={disabled} value={Math.round(selectedHsv.s * 100)} onChange={(event) => applyHsv({ s: clampPercent(Number(event.target.value)) / 100 })} />
                    <span className="text-right text-neutral-500">{Math.round(selectedHsv.s * 100)}</span>
                  </label>
                  <label className="grid grid-cols-[52px_minmax(0,1fr)_42px] items-center gap-2">
                    <span className="font-medium text-neutral-700">밝기</span>
                    <input type="range" min="0" max="100" step="1" disabled={disabled} value={Math.round(selectedHsv.v * 100)} onChange={(event) => applyHsv({ v: clampPercent(Number(event.target.value)) / 100 })} />
                    <span className="text-right text-neutral-500">{Math.round(selectedHsv.v * 100)}</span>
                  </label>
                  <label className="grid grid-cols-[52px_minmax(0,1fr)_42px] items-center gap-2">
                    <span className="font-medium text-neutral-700">대비</span>
                    <input
                      type="range"
                      min="0"
                      max="200"
                      step="1"
                      disabled={disabled}
                      value={contrastValue}
                      onPointerDown={() => {
                        contrastBaseColorRef.current = selectedColor;
                      }}
                      onChange={(event) => {
                        const nextContrast = Number(event.target.value);
                        setContrastValue(nextContrast);
                        applyRgb(adjustContrast(hexToRgb(contrastBaseColorRef.current), nextContrast));
                      }}
                    />
                    <span className="text-right text-neutral-500">{contrastValue}</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-neutral-700">저장된 스타일</span>
              <div className="flex items-center gap-1">
                <button type="button" disabled={disabled || selectedSavedStyleIds.length === 0} onClick={() => { setSavedStyles((current) => selectedSavedStyleIds.reduce((next, id) => removeSavedStyle(next, id), current).filter((style) => style.type !== 'texture')); setSelectedSavedStyleIds([]); }} className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700 disabled:opacity-40">삭제</button>
                <button type="button" disabled={disabled} title="현재 색상/그라디언트를 저장합니다." onClick={saveCurrentStyle} className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-xs font-medium text-neutral-700 disabled:opacity-40">현재 색상 저장</button>
              </div>
            </div>
            <div onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={handleSavedStylesDrop} className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-2">
              <p className="mb-2 text-[11px] font-medium text-neutral-600">현재 색상을 여기로 드래그해 저장</p>
              <div className="flex flex-wrap gap-1.5">
                {savedStyles.map((style) => (
                  <SavedStyleButton key={style.id} style={style} disabled={disabled} selected={selectedSavedStyleIds.includes(style.id)} onClick={() => applySavedStyle(style)} />
                ))}
                {savedStyles.length === 0 && <span className="text-xs text-neutral-500">저장된 색상이 없습니다.</span>}
              </div>
            </div>
            {(activeFillStyle.type === 'linearGradient' || activeFillStyle.type === 'radialGradient') && <p className="mt-2 text-[11px] text-neutral-600">저장된 단색 스타일은 선택한 색상 stop에 적용됩니다. 스타일을 색상 1/2로 드래그할 수도 있습니다.</p>}
          </div>
          <div className="sticky bottom-0 -mx-3 mt-4 flex justify-end gap-2 border-t border-neutral-200 bg-white px-3 pt-3">
            <button type="button" onClick={cancelEditor} className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
              취소
            </button>
            <button type="button" disabled={disabled} onClick={confirmEditor} className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-40">
              확인
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
