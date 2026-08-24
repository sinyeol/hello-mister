import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import {
  AlertCircle,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Copy,
  Crosshair,
  Crop,
  Eye,
  EyeOff,
  Folder,
  GripVertical,
  Image,
  LocateFixed,
  Lock,
  Redo2,
  Save,
  Search,
  Trash2,
  Undo2,
  Unlock,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@sticker-v1/components/common/PageHeader';
import { ColorSelector } from '@sticker-v1/components/common/ColorSelector';
import { TemplateShapeLayer } from '@sticker-v1/components/cards/TemplateShapeLayer';
import { useProjectStore } from '@sticker-v1/store/projectStore';
import { usePressAndHold } from '@sticker-v1/hooks/usePressAndHold';
import type { ImageFitMode, LocalAsset, ShapeLayer, Template, TemplateCornerRadii, TemplateFillStyle, TemplateLayer, TemplateOrientation, TemplateSlotType, TemplateType } from '@sticker-v1/types';
import { createId } from '@sticker-v1/utils/ids';
import { normalizeName } from '@sticker-v1/utils/normalizeName';
import {
  cardAspectRatio,
  cardPhysicalSizeForCanvas,
  cardOutlineRadiusCss,
  canvasCutOffsetPx,
  canvasInsetRectPercent,
  canvasPxToMm,
  canvasXToCenteredMm,
  canvasYToCenteredMm,
  centeredMmToCanvasX,
  centeredMmToCanvasY,
  cuttingLineInsetFromCardPx,
  cuttingLineRadiusCss,
  defaultCardBackgroundColor,
  defaultStickerBackgroundColor,
  defaultTemplateCanvas,
  fixedCardOutlineRadiusMm,
  getCardBackgroundColor,
  getCanvasPxPerMm,
  getStickerBackgroundColor,
  imageCornerRadiusCss,
  imageCornerRadiusInheritsSlot,
  normalizeImageCornerRadiiMm,
  layerCornerRadiusMm,
  layerCornerRadiusCss,
  mmToCanvasPx,
  normalizeCornerRadiiMm,
  resizeRectFromCenterPreserveAspect,
  safeMarginInsetFromCardPx,
  safeMarginRadiusCss,
} from '@sticker-v1/utils/cardGeometry';
import { defaultFitModeForSlot, fitImageToBounds, imageFitModeLabels } from '@sticker-v1/utils/imageFit';
import { isEditorInteractiveTarget } from '@sticker-v1/utils/editorHitTest';
import {
  imageTransformLimits,
  layerTransformLimits,
  resizeLayerToSizeFromTopLeft,
  resolveLayerTransform,
  type LayerTransform,
} from '@sticker-v1/utils/layerTransform';
import { clampImageCropPx, hasNaturalImageSize, imageCropInsetPercent, type ImageNaturalSize } from '@sticker-v1/utils/imageCrop';
import {
  cornerMarkSegmentsForGeometryMm,
  cutLineDashArrayMm,
  cutLineWidthOptionsMm,
  defaultCutLineSettings,
  getCutLineGeometryMm,
  normalizeCutLineSettings,
  roundedRectPathMm,
} from '@sticker-v1/utils/cutLines';
import type { CutLineStyle } from '@sticker-v1/types/export';
import {
  isTemplateShapeLayer,
  defaultShapeRadiusMm,
  minShapeSizePx,
  normalizeShapeLayer,
  isTemplateShapeFillTransparent,
  templateShapeFillStyle,
  templateShapeStrokeValue,
  templateShapeStrokeWidthMm,
  templateShapeKind,
  type TemplateShapeKind,
} from '@sticker-v1/utils/templateShapes';
import { computeSmartSnap, snapLayerPositionToGridAndCenter, snapPointToGridAndCenter, type SnapGuideLine } from '@sticker-v1/utils/snap';
import { normalizeTemplateForRender } from '@sticker-v1/utils/templateRenderNormalize';
import { clampViewportToCanvas, defaultViewportTransform, getFitViewTransform, panViewport, zoomViewportAtPoint, type ViewportTransform } from '@sticker-v1/utils/viewportTransform';
import {
  defaultLayerEffect,
  effectAmountBounds,
  getLayerEffects,
  imageLayerEffectOptions,
  layerEffectLabels,
  layerEffectStyle,
  layerEffectSummary,
  shapeLayerEffectOptions,
  type LayerEffect,
  type LayerEffectType,
} from '@sticker-v1/utils/layerEffects';

type EditorCanvas = Template['canvas'] & { orientation: TemplateOrientation };

const defaultCanvas: EditorCanvas = {
  width: defaultTemplateCanvas.width,
  height: defaultTemplateCanvas.height,
  orientation: defaultTemplateCanvas.orientation,
  cornerRadius: mmToCanvasPx(defaultTemplateCanvas.cornerRadiusMm),
  safeMargin: mmToCanvasPx(defaultTemplateCanvas.safeMarginMm),
  cornerRadiusMm: defaultTemplateCanvas.cornerRadiusMm,
  cutOffsetMm: defaultTemplateCanvas.cutOffsetMm,
  safeMarginMm: defaultTemplateCanvas.safeMarginMm,
  visualMargin: defaultTemplateCanvas.visualMargin,
  cardColor: defaultCardBackgroundColor,
  cardBackgroundColor: defaultCardBackgroundColor,
  stickerBackgroundColor: defaultStickerBackgroundColor,
};
const activeSlotTypeOptions: Array<{ value: TemplateSlotType; label: string }> = [
  { value: 'mainImage', label: '메인 이미지' },
  { value: 'gameLogo', label: '로고' },
  { value: 'background', label: '배경' },
  { value: 'platformLogo', label: '장식' },
];
const imageSlotTypes = new Set<TemplateSlotType>(activeSlotTypeOptions.map((option) => option.value));

type Interaction =
  | {
      target: 'layer' | 'image';
      type: 'move';
      pointerId: number;
      startPointer: { x: number; y: number };
      startTransform: LayerTransform;
    }
  | { target: 'layer' | 'image'; type: 'resize'; pointerId: number; handle: ResizeHandle; startTransform: LayerTransform }
  | { target: 'layer' | 'image'; type: 'rotate'; pointerId: number; centerX: number; centerY: number; startAngle: number; startRotation: number };

type ResizeHandle = 'top-left' | 'top' | 'top-right' | 'left' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right';
type RadiusCornerKey = keyof TemplateCornerRadii;
type ImageTransformMode = 'linked' | 'separate';
type LayerDetailGroupKey = 'image' | 'position' | 'align' | 'crop' | 'effects' | 'advanced' | 'radius' | 'imageRadius' | 'fill' | 'stroke';
type DragOverPosition = 'before' | 'after';

type PanInteraction = {
  pointerId: number;
  startPointer: { x: number; y: number };
  startViewport: ViewportTransform;
} | null;

interface TemplateEditorDraft {
  editingTemplateId?: string;
  templateName: string;
  templateType: TemplateType;
  canvasSettings: EditorCanvas;
  cuttingLineColor: string;
  cardColor: string;
  background: string;
  layers: TemplateLayer[];
}

interface TemplateEditorPrefs {
  showRuler: boolean;
  showGrid: boolean;
  snapToGrid: boolean;
  showSafeMarginGuide: boolean;
  showCenterGuides: boolean;
  lockAspect: boolean;
  rulerOpacity: number;
  gridOpacity: number;
  rulerGridOpen: boolean;
}

interface TemplateEditorPanelLayout {
  leftPanelWidth: number;
  rightPanelWidth: number;
}

type PanelResizeState = {
  side: 'left' | 'right';
  startX: number;
  startLeftPanelWidth: number;
  startRightPanelWidth: number;
} | null;

const draftStorageKey = 'zaparoo.templateEditor.draft.v1';
const prefsStorageKey = 'zaparoo.templateEditor.prefs.v1';
const panelLayoutStorageKey = 'zaparoo.templateEditor.layout.v1';
const historyLimit = 50;
const gridMinorStepMm = 1;
const gridMajorStepMm = 5;
const gridLabelStepMm = 10;
const localFolderInputProps = { webkitdirectory: '', directory: '' } as Record<string, string>;
const supportedLocalImagePattern = /\.(png|jpe?g|webp|gif|bmp|svg)$/i;
const defaultEditorPrefs: TemplateEditorPrefs = {
  showRuler: true,
  showGrid: true,
  snapToGrid: true,
  showSafeMarginGuide: true,
  showCenterGuides: true,
  lockAspect: false,
  rulerOpacity: 80,
  gridOpacity: 30,
  rulerGridOpen: false,
};
const defaultPanelLayout: TemplateEditorPanelLayout = {
  leftPanelWidth: 260,
  rightPanelWidth: 340,
};
const leftPanelLimits = { min: 100, max: 640 };
const rightPanelLimits = { min: 180, max: 900 };
const centerWorkspaceMinWidth = 260;
const panelResizeHandleWidth = 6;
const cutLineStyleLabels: Record<CutLineStyle, string> = {
  solid: '전체 외곽선',
  dashed: '파선 외곽선',
  dotted: '점선 외곽선',
  'corner-marks': 'ㄱ자 코너',
};
const radiusCornerLabels: Record<RadiusCornerKey, string> = {
  topLeft: '좌상',
  topRight: '우상',
  bottomRight: '우하',
  bottomLeft: '좌하',
};

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function clampPreferredPanelLayout(layout: TemplateEditorPanelLayout): TemplateEditorPanelLayout {
  return {
    leftPanelWidth: clampNumber(layout.leftPanelWidth, leftPanelLimits.min, leftPanelLimits.max),
    rightPanelWidth: clampNumber(layout.rightPanelWidth, rightPanelLimits.min, rightPanelLimits.max),
  };
}

function migrateSlotType(slotType?: TemplateSlotType): TemplateSlotType {
  switch (slotType) {
    case 'mainImage':
    case 'gameLogo':
    case 'background':
    case 'platformLogo':
      return slotType;
    case 'titleImage':
      return 'gameLogo';
    case 'brandLogo':
    case 'platformLabel':
    case 'brandText':
    case 'badge':
      return 'platformLogo';
    case 'backgroundArt':
      return 'background';
    case 'heroImage':
    case 'titleText':
    case 'categoryLabel':
    case 'footerBar':
    case 'sideStrip':
    case 'overlayFrame':
    default:
      return 'mainImage';
  }
}

function slotTypeLabel(slotType?: TemplateSlotType) {
  return activeSlotTypeOptions.find((option) => option.value === slotType)?.label ?? '메인 이미지';
}

function isImageLike(layer?: TemplateLayer) {
  return Boolean(layer?.slotType && imageSlotTypes.has(layer.slotType));
}

function hasTemplateImage(layer?: TemplateLayer) {
  return typeof layer?.data?.imageDataUrl === 'string' && layer.data.imageDataUrl.length > 0;
}

function getStoredImageTransform(layer: TemplateLayer) {
  return layer.data?.imageTransform as Partial<LayerTransform> | undefined;
}

function isNeutralImageTransform(layer: TemplateLayer, transform?: Partial<LayerTransform>) {
  if (!transform) return true;
  const frame = resolveLayerTransform(layer);
  return (
    Math.abs(Number(transform.x ?? 0)) < 0.01 &&
    Math.abs(Number(transform.y ?? 0)) < 0.01 &&
    Math.abs(Number(transform.width ?? frame.width) - frame.width) < 0.01 &&
    Math.abs(Number(transform.height ?? frame.height) - frame.height) < 0.01 &&
    Math.abs(Number(transform.rotation ?? 0)) < 0.01
  );
}

function imageTransformMode(layer: TemplateLayer): ImageTransformMode {
  const explicitMode = layer.data?.imageTransformMode;
  if (explicitMode === 'linked' || explicitMode === 'separate') return explicitMode;
  return getStoredImageTransform(layer) && !isNeutralImageTransform(layer, getStoredImageTransform(layer)) ? 'separate' : 'linked';
}

function getLayerLabel(layer: TemplateLayer) {
  return String(layer.data?.label ?? layer.slot?.label ?? slotTypeLabel(layer.slotType) ?? layer.id);
}

function layerTypeLabel(layer: TemplateLayer) {
  if (isShapeLayer(layer)) return '도형';
  if (layer.type === 'background') return '배경';
  if (layer.type === 'text') return '텍스트';
  return '슬롯';
}

function shapeFillChipStyle(layer: TemplateLayer) {
  const fillStyle = templateShapeFillStyle(layer);
  if (fillStyle.type === 'none' || isTemplateShapeFillTransparent(layer)) return undefined;
  if (fillStyle.type === 'solid') return { backgroundColor: fillStyle.color };
  if (fillStyle.type === 'linearGradient') return { backgroundImage: `linear-gradient(${fillStyle.angle ?? 45}deg, ${fillStyle.colors[0]}, ${fillStyle.colors[1]})` };
  if (fillStyle.type === 'radialGradient') return { backgroundImage: `radial-gradient(circle, ${fillStyle.colors[0]}, ${fillStyle.colors[1]})` };
  return undefined;
}

function disclosureIconClass(open: boolean) {
  return `h-4 w-4 shrink-0 transition-transform duration-150 ${open ? 'rotate-90' : ''}`;
}

function layerAccent(layer: TemplateLayer) {
  if (isShapeLayer(layer)) {
    return {
      parent: 'border-l-[#B000FF]',
      badge: 'border-[#B000FF]/45 bg-[#B000FF]/10 text-[#7A00B3]',
      icon: 'text-[#B000FF]',
    };
  }
  if (layer.type === 'text') {
    return {
      parent: 'border-l-[#00E5FF]',
      badge: 'border-[#00E5FF]/45 bg-[#00E5FF]/10 text-[#007C8A]',
      icon: 'text-[#00E5FF]',
    };
  }
  if (layer.type === 'background') {
    return {
      parent: 'border-l-[#607D8B]',
      badge: 'border-[#607D8B]/45 bg-[#607D8B]/10 text-[#455A64]',
      icon: 'text-[#607D8B]',
    };
  }
  return {
    parent: 'border-l-[#00A7FF]',
    badge: 'border-[#00A7FF]/45 bg-[#00A7FF]/10 text-[#006EA8]',
    icon: 'text-[#00A7FF]',
  };
}

const childAccentClasses = {
  image: 'border-[#00E676]/35 bg-[#00E676]/10 text-[#008C45]',
  crop: 'border-[#00E5FF]/30 bg-[#00E5FF]/10 text-[#007C8A]',
  fill: 'border-[#FFC400]/35 bg-[#FFC400]/10 text-[#8A6500]',
  stroke: 'border-[#FF3D00]/30 bg-[#FF3D00]/10 text-[#A12600]',
  effect: 'border-[#FF00A8]/30 bg-[#FF00A8]/10 text-[#9A0066]',
  transform: 'border-[#B000FF]/25 bg-white text-[#6A0099]',
};

function fullLayerTypeLabel(layer: TemplateLayer) {
  if (isShapeLayer(layer)) return '도형';
  if (layer.type === 'text') return '텍스트';
  if (layer.type === 'background') return '배경';
  return '슬롯';
}

function fillTypeLabel(layer: TemplateLayer) {
  const style = templateShapeFillStyle(layer);
  if (style.type === 'none' || isTemplateShapeFillTransparent(layer)) return '채우기 없음';
  if (style.type === 'solid') return `단색 ${style.color}`;
  if (style.type === 'linearGradient') return '선형 그라디언트';
  if (style.type === 'radialGradient') return '방사형 그라디언트';
  return '단색';
}

function strokeStatusLabel(layer: TemplateLayer) {
  const stroke = templateShapeStrokeValue(layer);
  if (stroke === 'transparent') return '선 없음';
  return `${stroke} / ${Number(layer.data?.strokeWidth ?? 2)}px`;
}

function layerHasActiveCrop(layer: TemplateLayer) {
  const transform = getImageTransform(layer);
  return [transform.cropTop, transform.cropRight, transform.cropBottom, transform.cropLeft].some((value) => Number(value ?? 0) > 0);
}

function layerImageTransformModified(layer: TemplateLayer) {
  const current = getImageTransform(layer);
  const base = getDefaultImageTransform(layer);
  return (
    Math.abs(current.x - base.x) > 0.01 ||
    Math.abs(current.y - base.y) > 0.01 ||
    Math.abs(current.width - base.width) > 0.01 ||
    Math.abs(current.height - base.height) > 0.01 ||
    Math.abs((current.rotation ?? 0) - (base.rotation ?? 0)) > 0.01
  );
}

function layerSearchText(layer: TemplateLayer) {
  const imageState = isImageLike(layer)
    ? hasTemplateImage(layer)
      ? '이미지 있음'
      : '이미지 없음'
    : '';
  return [
    getLayerLabel(layer),
    fullLayerTypeLabel(layer),
    layerTypeLabel(layer),
    slotTypeLabel(migrateSlotType(layer.slotType)),
    String(layer.data?.imageName ?? ''),
    imageState,
    layer.data?.visible === false ? '숨김' : '보임',
    layer.locked ? '잠김 잠금' : '잠금 해제',
    isShapeLayer(layer) ? fillTypeLabel(layer) : '',
    isShapeLayer(layer) ? strokeStatusLabel(layer) : '',
    isImageLike(layer) && layerHasActiveCrop(layer) ? '자르기 crop' : '',
    isImageLike(layer) && layerImageTransformModified(layer) ? '변형 transform' : '',
  ]
    .join(' ')
    .toLowerCase();
}

function getImageTransform(layer: TemplateLayer): LayerTransform {
  const stored = getStoredImageTransform(layer);
  const defaultTransform = getDefaultImageTransform(layer);
  if (imageTransformMode(layer) === 'linked') {
    if (stored) {
      return {
        x: stored.x ?? defaultTransform.x,
        y: stored.y ?? defaultTransform.y,
        width: stored.width ?? defaultTransform.width,
        height: stored.height ?? defaultTransform.height,
        rotation: stored.rotation ?? defaultTransform.rotation,
        opacity: stored.opacity ?? defaultTransform.opacity,
        cropTop: Number(stored.cropTop ?? 0),
        cropRight: Number(stored.cropRight ?? 0),
        cropBottom: Number(stored.cropBottom ?? 0),
        cropLeft: Number(stored.cropLeft ?? 0),
      };
    }
    return {
      ...defaultTransform,
    };
  }
  return {
    x: stored?.x ?? defaultTransform.x,
    y: stored?.y ?? defaultTransform.y,
    width: stored?.width ?? defaultTransform.width,
    height: stored?.height ?? defaultTransform.height,
    rotation: stored?.rotation ?? defaultTransform.rotation,
    opacity: stored?.opacity ?? defaultTransform.opacity,
    cropTop: Number(stored?.cropTop ?? 0),
    cropRight: Number(stored?.cropRight ?? 0),
    cropBottom: Number(stored?.cropBottom ?? 0),
    cropLeft: Number(stored?.cropLeft ?? 0),
  };
}

function getDefaultImageTransform(layer: TemplateLayer): LayerTransform {
  const layerTransform = resolveLayerTransform(layer);
  return {
    x: 0,
    y: 0,
    width: layerTransform.width,
    height: layerTransform.height,
    rotation: 0,
    opacity: 1,
    cropTop: 0,
    cropRight: 0,
    cropBottom: 0,
    cropLeft: 0,
  };
}

function imageNaturalSizeForLayer(layer: TemplateLayer): ImageNaturalSize {
  return {
    width: Number(layer.data?.imageNaturalWidth ?? 0),
    height: Number(layer.data?.imageNaturalHeight ?? 0),
  };
}

function imageStyleFromTransform(layerTransform: LayerTransform, imageTransform: LayerTransform, naturalSize?: ImageNaturalSize) {
  const cropInset = imageCropInsetPercent(imageTransform, naturalSize);
  return {
    left: `${(imageTransform.x / layerTransform.width) * 100}%`,
    top: `${(imageTransform.y / layerTransform.height) * 100}%`,
    width: `${(imageTransform.width / layerTransform.width) * 100}%`,
    height: `${(imageTransform.height / layerTransform.height) * 100}%`,
    opacity: imageTransform.opacity,
    transform: `rotate(${imageTransform.rotation}deg)`,
    clipPath: `inset(${cropInset.top}% ${cropInset.right}% ${cropInset.bottom}% ${cropInset.left}%)`,
  };
}

function layerRenderEffectStyle(layer: TemplateLayer, baseOpacity = 1) {
  const effects = layerEffectStyle(layer);
  const effectOpacity = typeof effects.opacity === 'number' ? effects.opacity : 1;
  return {
    filter: effects.filter,
    boxShadow: effects.boxShadow,
    opacity: baseOpacity * effectOpacity,
  };
}

function LayerChildThumbnail({ layer, canvas }: { layer: TemplateLayer; canvas: EditorCanvas }) {
  if (isImageLike(layer)) {
    const imageDataUrl = hasTemplateImage(layer) ? String(layer.data?.imageDataUrl) : '';
    return (
      <span className="image-thumb-frame flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border border-line bg-white">
        {imageDataUrl ? (
          <img src={imageDataUrl} alt="" className="h-full w-full object-contain" draggable={false} />
        ) : (
          <Image className="h-4 w-4 text-neutral-400" />
        )}
      </span>
    );
  }
  return (
    <span className="image-thumb-frame flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border border-line bg-white p-1">
      <TemplateShapeLayer layer={layer} canvas={canvas} />
    </span>
  );
}

function LayerMiniNumberInput({
  label,
  value,
  disabled,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  const formatNumericDraft = useCallback((nextValue: number) => {
    return Number.isFinite(nextValue) ? String(Number(nextValue.toFixed(step < 1 ? 2 : 0))) : '0';
  }, [step]);

  const isEditingRef = useRef(false);
  const [numericDrafts, setNumericDrafts] = useState(() => formatNumericDraft(value));

  useEffect(() => {
    if (!isEditingRef.current) setNumericDrafts(formatNumericDraft(value));
  }, [formatNumericDraft, value]);

  function clampNumericValue(nextValue: number) {
    let clamped = nextValue;
    if (min !== undefined) clamped = Math.max(min, clamped);
    if (max !== undefined) clamped = Math.min(max, clamped);
    return clamped;
  }

  function applyNumericDraftValue(key: 'value', parsed: number) {
    void key;
    onChange(clampNumericValue(parsed));
  }

  function commitNumericDraft() {
    const parsed = Number(numericDrafts);
    if (Number.isFinite(parsed)) {
      const key = 'value' as const;
      applyNumericDraftValue(key, parsed);
      setNumericDrafts(formatNumericDraft(clampNumericValue(parsed)));
    } else {
      setNumericDrafts(formatNumericDraft(value));
    }
  }

  function handleNumericDraftChange(nextDraft: string) {
    setNumericDrafts(nextDraft);
    const parsed = Number(nextDraft);
    const key = 'value' as const;
    if (nextDraft.trim() !== '' && nextDraft !== '-' && Number.isFinite(parsed)) applyNumericDraftValue(key, parsed);
  }

  return (
    <label
      className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-600"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <span>{label}</span>
      <input
        type="number"
        value={numericDrafts}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onFocus={() => {
          isEditingRef.current = true;
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => handleNumericDraftChange(event.target.value)}
        onBlur={() => {
          isEditingRef.current = false;
          commitNumericDraft();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            isEditingRef.current = false;
            setNumericDrafts(formatNumericDraft(value));
            event.currentTarget.blur();
          }
        }}
        className="h-7 w-14 rounded border border-line bg-white px-1 text-right text-[11px] caret-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-40"
      />
    </label>
  );
}

function LayerDetailGroup({
  title,
  open,
  accentClass,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  accentClass: string;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-md border ${accentClass}`} onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1 px-2 py-1 text-left text-[11px] font-semibold"
      >
        <ChevronRight className={disclosureIconClass(open)} />
        <span>{title}</span>
      </button>
      {open && <div className="border-t border-black/5 bg-white/70 px-2 py-1">{children}</div>}
    </div>
  );
}

function canvasSizeForOrientation(orientation: TemplateOrientation) {
  return orientation === 'landscape'
    ? { width: defaultTemplateCanvas.height, height: defaultTemplateCanvas.width }
    : { width: defaultTemplateCanvas.width, height: defaultTemplateCanvas.height };
}

function scaleOptional(value: number | undefined, scale: number) {
  return value === undefined ? undefined : value * scale;
}

function scaleTemplateLayerForCanvas(layer: TemplateLayer, scaleX: number, scaleY: number, nextCanvas: EditorCanvas): TemplateLayer {
  const imageTransform = layer.data?.imageTransform as Partial<LayerTransform> | undefined;
  const cornerRadiusMm = layer.cornerRadiusMm ?? layer.slot?.cornerRadiusMm;
  const nextImageTransform = imageTransform
    ? {
        ...imageTransform,
        x: scaleOptional(imageTransform.x, scaleX),
        y: scaleOptional(imageTransform.y, scaleY),
        width: scaleOptional(imageTransform.width, scaleX),
        height: scaleOptional(imageTransform.height, scaleY),
    }
    : undefined;
  if (isTemplateShapeLayer(layer)) {
    return normalizeShapeLayer(
      {
        ...layer,
        x: scaleOptional(layer.x, scaleX),
        y: scaleOptional(layer.y, scaleY),
        width: scaleOptional(layer.width, scaleX),
        height: scaleOptional(layer.height, scaleY),
        cornerRadius: cornerRadiusMm === undefined ? layer.cornerRadius : mmToCanvasPx(cornerRadiusMm, nextCanvas),
        data: nextImageTransform ? { ...layer.data, imageTransform: nextImageTransform } : layer.data,
      },
      nextCanvas,
      getLayerLabel(layer),
    );
  }
  return {
    ...layer,
    x: scaleOptional(layer.x, scaleX),
    y: scaleOptional(layer.y, scaleY),
    width: scaleOptional(layer.width, scaleX),
    height: scaleOptional(layer.height, scaleY),
    cornerRadius: cornerRadiusMm === undefined ? layer.cornerRadius : mmToCanvasPx(cornerRadiusMm, nextCanvas),
    data: nextImageTransform ? { ...layer.data, imageTransform: nextImageTransform } : layer.data,
    slot: layer.slot
      ? {
          ...layer.slot,
          x: layer.slot.x * scaleX,
          y: layer.slot.y * scaleY,
          width: layer.slot.width * scaleX,
          height: layer.slot.height * scaleY,
          cornerRadius: cornerRadiusMm === undefined ? layer.slot.cornerRadius : mmToCanvasPx(cornerRadiusMm, nextCanvas),
        }
      : layer.slot,
  };
}

function getCanvasPoint(element: HTMLDivElement, event: PointerEvent | MouseEvent, canvas: EditorCanvas) {
  const rect = element.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

function makeSlot(slotNumber: number): TemplateLayer {
  const id = createId('layer');
  const label = `슬롯 ${slotNumber}`;
  const slotType: TemplateSlotType = 'mainImage';
  return {
    id,
    type: 'slot',
    slotType,
    x: 120,
    y: 180,
    width: 360,
    height: 240,
    rotation: 0,
    opacity: 1,
    cornerRadius: mmToCanvasPx(2),
    cornerRadiusMm: 2,
    zIndex: slotNumber,
    imageFitMode: defaultFitModeForSlot(slotType),
    data: {
      label,
      visible: true,
      imageFitMode: defaultFitModeForSlot(slotType),
    },
    slot: {
      id: createId('slot'),
      slotType,
      label,
      x: 120,
      y: 180,
      width: 360,
      height: 240,
      cornerRadius: mmToCanvasPx(2),
      cornerRadiusMm: 2,
      accepts: ['image', 'logo'],
    },
  };
}

type ShapeKind = TemplateShapeKind;

const shapeKindLabels: Record<ShapeKind, string> = {
  rectangle: '사각형',
  roundedRectangle: '둥근 사각형',
  ellipse: '원 / 타원',
  line: '선',
};

function shapeKind(layer?: TemplateLayer): ShapeKind {
  return templateShapeKind(layer);
}

function isShapeLayer(layer?: TemplateLayer) {
  return isTemplateShapeLayer(layer);
}

function makeShapeLayer(shape: ShapeKind, layerNumber: number, canvas: EditorCanvas): TemplateLayer {
  const id = createId('shape');
  const label = `${shapeKindLabels[shape]} ${layerNumber}`;
  const baseRadiusMm = shape === 'roundedRectangle' ? defaultShapeRadiusMm : 0;
  return normalizeShapeLayer({
    id,
    type: 'shape',
    x: 160,
    y: 220,
    width: shape === 'line' ? 360 : 260,
    height: shape === 'line' ? 8 : 180,
    rotation: 0,
    opacity: 1,
    fill: shape === 'line' ? 'transparent' : '#ffffff',
    stroke: '#111827',
    cornerRadius: mmToCanvasPx(baseRadiusMm, canvas),
    cornerRadiusMm: baseRadiusMm,
    zIndex: layerNumber,
    data: {
      kind: 'shape',
      label,
      visible: true,
      shapeType: shape,
      shapeKind: shape,
      cornerRadiusLinked: true,
      strokeWidth: shape === 'line' ? 3 : 2,
    },
  }, canvas, label);
}

function withFrontZOrder(layers: TemplateLayer[]) {
  return layers.map((layer, index) => ({ ...layer, zIndex: layers.length - index }));
}

function loadTemplateEditorDraft() {
  try {
    const parsed = JSON.parse(localStorage.getItem(draftStorageKey) ?? 'null') as TemplateEditorDraft | null;
    if (!parsed || !Array.isArray(parsed.layers)) return undefined;
    return { ...parsed, layers: withFrontZOrder(parsed.layers) };
  } catch {
    return undefined;
  }
}

function loadTemplateEditorPrefs(): TemplateEditorPrefs {
  try {
    return {
      ...defaultEditorPrefs,
      ...(JSON.parse(localStorage.getItem(prefsStorageKey) ?? '{}') as Partial<TemplateEditorPrefs>),
    };
  } catch {
    return defaultEditorPrefs;
  }
}

function loadTemplateEditorPanelLayout(): TemplateEditorPanelLayout {
  try {
    const parsed = JSON.parse(localStorage.getItem(panelLayoutStorageKey) ?? '{}') as Partial<TemplateEditorPanelLayout>;
    return clampPreferredPanelLayout({
      leftPanelWidth: clampNumber(
        Number(parsed.leftPanelWidth ?? defaultPanelLayout.leftPanelWidth),
        leftPanelLimits.min,
        leftPanelLimits.max,
      ),
      rightPanelWidth: clampNumber(
        Number(parsed.rightPanelWidth ?? defaultPanelLayout.rightPanelWidth),
        rightPanelLimits.min,
        rightPanelLimits.max,
      ),
    });
  } catch {
    return defaultPanelLayout;
  }
}

function makeCenteredMmTicks(sizeMm: number, stepMm = gridMinorStepMm) {
  const half = sizeMm / 2;
  const start = Math.ceil(-half / stepMm) * stepMm;
  const end = Math.floor(half / stepMm) * stepMm;
  const count = Math.max(0, Math.round((end - start) / stepMm));
  return Array.from({ length: count + 1 }, (_, index) => Number((start + index * stepMm).toFixed(3)));
}

function formatCenteredMmLabel(value: number) {
  if (Math.abs(value) < 0.001) return '0';
  return `${value > 0 ? '+' : ''}${value}`;
}

function gridLineStyle(tick: number, axis: 'x' | 'y') {
  const isCenter = Math.abs(tick) < 0.001;
  const isMajor = Math.abs(tick % gridLabelStepMm) < 0.001;
  const isMedium = Math.abs(tick % gridMajorStepMm) < 0.001;
  const color = isCenter
    ? 'rgba(15, 23, 42, 0.8)'
    : isMajor
      ? 'rgba(14, 165, 233, 0.52)'
      : isMedium
        ? 'rgba(14, 165, 233, 0.34)'
        : 'rgba(14, 165, 233, 0.16)';
  return {
    [axis === 'x' ? 'borderLeft' : 'borderTop']: `${isCenter || isMajor ? 1.5 : 1}px solid ${color}`,
  };
}

function resizeTransformFromHandle(
  start: LayerTransform,
  point: { x: number; y: number },
  handle: ResizeHandle,
  limits = layerTransformLimits,
  lockAspect = false,
) {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;

  if (handle.includes('left')) left = Math.min(point.x, right - limits.minWidth);
  if (handle.includes('right')) right = Math.max(point.x, left + limits.minWidth);
  if (handle.includes('top')) top = Math.min(point.y, bottom - limits.minHeight);
  if (handle.includes('bottom')) bottom = Math.max(point.y, top + limits.minHeight);

  if (right - left > limits.maxWidth) {
    if (handle.includes('left')) left = right - limits.maxWidth;
    else right = left + limits.maxWidth;
  }
  if (bottom - top > limits.maxHeight) {
    if (handle.includes('top')) top = bottom - limits.maxHeight;
    else bottom = top + limits.maxHeight;
  }

  let width = Math.max(limits.minWidth, right - left);
  let height = Math.max(limits.minHeight, bottom - top);

  // Aspect lock (persistent toggle or temporary Shift): keep the start ratio, re-anchoring at the fixed edge/corner.
  if (lockAspect && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    const horizontal = handle.includes('left') || handle.includes('right');
    const vertical = handle.includes('top') || handle.includes('bottom');
    if (horizontal && vertical) {
      if (width / ratio >= height) height = width / ratio;
      else width = height * ratio;
    } else if (horizontal) {
      height = width / ratio;
    } else {
      width = height * ratio;
    }
    if (handle.includes('left')) left = right - width;
    else right = left + width;
    if (handle.includes('top')) top = bottom - height;
    else bottom = top + height;
  }

  return {
    ...start,
    x: left,
    y: top,
    width: Math.max(limits.minWidth, width),
    height: Math.max(limits.minHeight, height),
  };
}

function assetPlatform(asset: LocalAsset) {
  return asset.platform?.trim() || asset.sourceLabel?.trim() || 'Unsorted';
}

function assetDisplayName(asset: LocalAsset) {
  return asset.normalizedFileName || asset.name || asset.path || asset.id;
}

function normalizedAssetPath(asset: LocalAsset) {
  return String(asset.originalPath ?? asset.path ?? asset.name).replace(/\\/g, '/');
}

function assetFolder(asset: LocalAsset) {
  const path = normalizedAssetPath(asset);
  const parts = path.split('/').filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
}

function folderBreadcrumbs(path: string) {
  const parts = path.split('/').filter(Boolean);
  return parts.map((part, index) => ({
    label: part,
    path: parts.slice(0, index + 1).join('/'),
  }));
}

function slotAssetKinds(slotType?: TemplateSlotType) {
  switch (slotType) {
    case 'gameLogo':
      return ['clear-logo'] as const;
    case 'platformLogo':
      return ['platform-logo', 'clear-logo'] as const;
    case 'background':
      return ['background'] as const;
    case 'mainImage':
    default:
      return ['box-front', 'fanart-box-front'] as const;
  }
}

function assetMatchesSlot(asset: LocalAsset, slotType?: TemplateSlotType) {
  return (slotAssetKinds(slotType) as readonly string[]).includes(asset.kind);
}

function localAssetKindForSlot(slotType?: TemplateSlotType): LocalAsset['kind'] {
  return slotAssetKinds(slotType)[0] as LocalAsset['kind'];
}

function fileFormat(fileName: string): LocalAsset['format'] {
  const extension = fileName.split('.').pop()?.toLowerCase();
  if (extension === 'png' || extension === 'jpg' || extension === 'jpeg' || extension === 'webp' || extension === 'svg') return extension;
  return 'unknown';
}

function loadImageSize(dataUrl: string) {
  return new Promise<{ width: number; height: number }>((resolve) => {
    const image = new window.Image();
    image.onload = () => resolve({ width: image.naturalWidth || image.width || 1, height: image.naturalHeight || image.height || 1 });
    image.onerror = () => resolve({ width: 1, height: 1 });
    image.src = dataUrl;
  });
}

function assetToDataUrl(asset: LocalAsset) {
  if (asset.file) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(asset.file as Blob);
    });
  }
  if (asset.objectUrl?.startsWith('data:image/')) return Promise.resolve(asset.objectUrl);
  return Promise.reject(new Error('Reconnect the asset source before embedding this image in a template.'));
}

export function LayoutEditorPage() {
  const { assetLibrary, templates, addTemplate, exportSettings, updateExportSettings } = useProjectStore();
  const updateTemplate = useProjectStore((state) => state.updateTemplate);
  const initialDraftRef = useRef<TemplateEditorDraft | null | undefined>(undefined);
  if (initialDraftRef.current === undefined) initialDraftRef.current = loadTemplateEditorDraft() ?? null;
  const initialDraft = initialDraftRef.current ?? undefined;
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | undefined>(initialDraft?.editingTemplateId);
  const [templateName, setTemplateName] = useState(initialDraft?.templateName ?? 'Custom Template');
  const [templateType, setTemplateType] = useState<TemplateType>(initialDraft?.templateType ?? 'front');
  const [canvasSettings, setCanvasSettings] = useState(initialDraft?.canvasSettings ?? defaultCanvas);
  const [cuttingLineColor, setCuttingLineColor] = useState(initialDraft?.cuttingLineColor ?? normalizeCutLineSettings(exportSettings.cutLineSettings ?? defaultCutLineSettings).color);
  const [cardColor, setCardColor] = useState(
    initialDraft?.cardColor ?? getCardBackgroundColor(initialDraft?.canvasSettings ?? defaultCanvas, defaultCardBackgroundColor),
  );
  const [background, setBackground] = useState(initialDraft?.background ?? getStickerBackgroundColor(initialDraft?.canvasSettings ?? defaultCanvas, defaultStickerBackgroundColor));
  const [layers, setLayers] = useState<TemplateLayer[]>(initialDraft?.layers ?? []);
  const [selectedId, setSelectedId] = useState('');
  // Additive multi-selection set, layered on top of the single primary `selectedId` so the rest of the editor (detail
  // panel, single-element editing) keeps working unchanged. Used for multi-align/distribute. Kept in sync via effect.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<'layer' | 'image'>('layer');
  const [expandedLayerIds, setExpandedLayerIds] = useState<string[]>([]);
  const [expandedDetailGroups, setExpandedDetailGroups] = useState<Record<string, LayerDetailGroupKey[]>>({});
  const [layerSearchOpen, setLayerSearchOpen] = useState(false);
  const [layerSearch, setLayerSearch] = useState('');
  const [renamingLayerId, setRenamingLayerId] = useState('');
  const [renameDraft, setRenameDraft] = useState('');
  const [flashLayerId, setFlashLayerId] = useState('');
  const [dragOverLayerId, setDragOverLayerId] = useState('');
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const clipboardLayerRef = useRef<TemplateLayer | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapGuideLine[]>([]);
  const [viewport, setViewport] = useState(defaultViewportTransform);
  const [panInteraction, setPanInteraction] = useState<PanInteraction>(null);
  const [dragLayerId, setDragLayerId] = useState('');
  const [dragOverPosition, setDragOverPosition] = useState<DragOverPosition>('before');
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [assetPickerPlatform, setAssetPickerPlatform] = useState('');
  const [assetFolderPath, setAssetFolderPath] = useState('');
  const [previewAsset, setPreviewAsset] = useState<LocalAsset | null>(null);
  const [assetSearch, setAssetSearch] = useState('');
  const [thumbnailSize, setThumbnailSize] = useState(96);
  const [assetPickerError, setAssetPickerError] = useState('');
  const [localSlotAssets, setLocalSlotAssets] = useState<LocalAsset[]>([]);
  const [saveMessage, setSaveMessage] = useState('');
  const [undoStack, setUndoStack] = useState<TemplateEditorDraft[]>([]);
  const [redoStack, setRedoStack] = useState<TemplateEditorDraft[]>([]);
  const [editorPrefs, setEditorPrefs] = useState<TemplateEditorPrefs>(() => loadTemplateEditorPrefs());
  // Which reference rectangle the align buttons use. Default 'card' = card-box center (current behaviour, no data move).
  const [alignRef, setAlignRef] = useState<'card' | 'cutline' | 'safe'>('card');
  const [cutMarginOpen, setCutMarginOpen] = useState(false);
  const [preferredPanelLayout, setPreferredPanelLayout] = useState<TemplateEditorPanelLayout>(() => loadTemplateEditorPanelLayout());
  const [renderedPanelLayout, setRenderedPanelLayout] = useState<TemplateEditorPanelLayout>(() => loadTemplateEditorPanelLayout());
  const preferredPanelLayoutRef = useRef(preferredPanelLayout);
  const [panelResizeState, setPanelResizeState] = useState<PanelResizeState>(null);
  const [searchParams] = useSearchParams();
  const routeTemplateId = searchParams.get('templateId');
  const loadedRouteTemplateIdRef = useRef<string | undefined>();
  const skipHistoryRef = useRef(false);
  const lastDraftJsonRef = useRef('');
  const colorPreviewSnapshotRef = useRef<TemplateEditorDraft | null>(null);
  const draftPersistTimeoutRef = useRef<number | undefined>();
  const layerListRef = useRef<HTMLDivElement | null>(null);
  const layerRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const centerResizeActionRef = useRef<{ layerId: string; target: 'layer' | 'image'; direction: 1 | -1 } | null>(null);

  const centerResizeHoldHandlers = usePressAndHold<HTMLButtonElement>((modifiers) => {
    const action = centerResizeActionRef.current;
    if (!action) return;
    const layer = layers.find((candidate) => candidate.id === action.layerId);
    if (!layer) return;
    resizeLayerObjectFromCenter(layer, action.target, modifiers, action.direction);
  });

  const centerResizeButtonHandlers = useCallback((layer: TemplateLayer, target: 'layer' | 'image', direction: 1 | -1) => ({
    ...centerResizeHoldHandlers,
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      centerResizeActionRef.current = { layerId: layer.id, target, direction };
      centerResizeHoldHandlers.onPointerDown(event);
    },
    onPointerUp: () => {
      centerResizeHoldHandlers.onPointerUp();
      centerResizeActionRef.current = null;
    },
    onPointerLeave: () => {
      centerResizeHoldHandlers.onPointerLeave();
      centerResizeActionRef.current = null;
    },
    onPointerCancel: () => {
      centerResizeHoldHandlers.onPointerCancel();
      centerResizeActionRef.current = null;
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      centerResizeActionRef.current = { layerId: layer.id, target, direction };
      centerResizeHoldHandlers.onKeyDown(event);
    },
  }), [centerResizeHoldHandlers]);

  const selectedLayer = layers.find((layer) => layer.id === selectedId);
  const expandedLayerIdSet = useMemo(() => new Set(expandedLayerIds), [expandedLayerIds]);

  // Keep the multi-selection in sync with the primary selection: any plain single-select (the ~20 existing
  // setSelectedId call sites) collapses the set to that one id; additive clicks manage the set themselves.
  useEffect(() => {
    setSelectedIds((current) => {
      if (!selectedId) return current.length === 0 ? current : [];
      if (current.length > 1 && current.includes(selectedId)) return current; // preserve an active multi-selection
      if (current.length === 1 && current[0] === selectedId) return current;
      return [selectedId];
    });
  }, [selectedId]);

  // Additive (Ctrl/Shift+click) selection: toggle a layer in the set and make it primary.
  function toggleLayerInSelection(layerId: string) {
    const has = selectedIds.includes(layerId);
    const next = has ? selectedIds.filter((id) => id !== layerId) : [...selectedIds, layerId];
    setSelectedIds(next);
    setSelectedId(has ? (next[next.length - 1] ?? '') : layerId);
    setSelectedTarget('layer');
  }

  const multiSelectedLayers = useMemo(
    () => (selectedIds.length > 1 ? layers.filter((layer) => selectedIds.includes(layer.id) && !layer.locked && layer.type !== 'background') : []),
    [layers, selectedIds],
  );
  const normalizedLayerSearch = layerSearch.trim().toLowerCase();
  const renderedLayers = useMemo(
    () => layers.filter((layer) => !normalizedLayerSearch || layerSearchText(layer).includes(normalizedLayerSearch)),
    [layers, normalizedLayerSearch],
  );
  const clampPanelLayout = useCallback((nextLayout: TemplateEditorPanelLayout, activeSide?: 'left' | 'right') => {
    let { leftPanelWidth, rightPanelWidth } = clampPreferredPanelLayout(nextLayout);
    const containerWidth = layoutRef.current?.clientWidth;
    if (containerWidth) {
      const maxSideTotal = Math.max(
        leftPanelLimits.min + rightPanelLimits.min,
        containerWidth - centerWorkspaceMinWidth - panelResizeHandleWidth * 2,
      );
      if (leftPanelWidth + rightPanelWidth > maxSideTotal) {
        if (activeSide === 'left') {
          leftPanelWidth = Math.max(leftPanelLimits.min, maxSideTotal - rightPanelWidth);
          if (leftPanelWidth + rightPanelWidth > maxSideTotal) rightPanelWidth = Math.max(rightPanelLimits.min, maxSideTotal - leftPanelWidth);
        } else if (activeSide === 'right') {
          rightPanelWidth = Math.max(rightPanelLimits.min, maxSideTotal - leftPanelWidth);
          if (leftPanelWidth + rightPanelWidth > maxSideTotal) leftPanelWidth = Math.max(leftPanelLimits.min, maxSideTotal - rightPanelWidth);
        } else {
          const flexibleWidth = Math.max(0, maxSideTotal - leftPanelLimits.min - rightPanelLimits.min);
          const preferredLeftFlex = Math.max(0, leftPanelWidth - leftPanelLimits.min);
          const preferredRightFlex = Math.max(0, rightPanelWidth - rightPanelLimits.min);
          const preferredFlexTotal = preferredLeftFlex + preferredRightFlex;
          if (preferredFlexTotal > 0) {
            leftPanelWidth = leftPanelLimits.min + flexibleWidth * (preferredLeftFlex / preferredFlexTotal);
            rightPanelWidth = rightPanelLimits.min + flexibleWidth * (preferredRightFlex / preferredFlexTotal);
          } else {
            leftPanelWidth = leftPanelLimits.min;
            rightPanelWidth = rightPanelLimits.min;
          }
        }
      }
      if (leftPanelWidth + rightPanelWidth > maxSideTotal) {
        leftPanelWidth = leftPanelLimits.min;
        rightPanelWidth = Math.max(rightPanelLimits.min, maxSideTotal - leftPanelWidth);
      }
    }
    return { leftPanelWidth, rightPanelWidth };
  }, []);

  function beginPanelResize(side: 'left' | 'right', event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    setPanelResizeState({
      side,
      startX: event.clientX,
      startLeftPanelWidth: renderedPanelLayout.leftPanelWidth,
      startRightPanelWidth: renderedPanelLayout.rightPanelWidth,
    });
  }

  const getViewportMinZoom = useCallback(() => {
    const viewportElement = viewportRef.current;
    const canvasElement = canvasRef.current;
    if (!viewportElement || !canvasElement) return 0.25;
    const availableWidth = Math.max(1, viewportElement.clientWidth - 96);
    const availableHeight = Math.max(1, viewportElement.clientHeight - 96);
    const fitZoom = Math.min(
      availableWidth / Math.max(canvasElement.offsetWidth, 1),
      availableHeight / Math.max(canvasElement.offsetHeight, 1),
    );
    return Math.min(0.25, Math.max(0.08, fitZoom));
  }, []);

  const clampViewport = useCallback((nextViewport: ViewportTransform) => {
    const viewportElement = viewportRef.current;
    const canvasElement = canvasRef.current;
    if (!viewportElement || !canvasElement) return nextViewport;
    return clampViewportToCanvas(nextViewport, {
      viewportWidth: viewportElement.clientWidth,
      viewportHeight: viewportElement.clientHeight,
      canvasWidth: canvasElement.offsetWidth,
      canvasHeight: canvasElement.offsetHeight,
      offsetX: canvasElement.offsetLeft,
      offsetY: canvasElement.offsetTop,
      minZoom: getViewportMinZoom(),
      minVisiblePx: 96,
      panMarginPx: 360,
    });
  }, [getViewportMinZoom]);
  const selectedTransform = selectedLayer ? resolveLayerTransform(selectedLayer) : undefined;
  const selectedImageTransform = selectedLayer ? getImageTransform(selectedLayer) : undefined;
  const activeTransform =
    selectedTarget === 'image' && selectedImageTransform && selectedLayer && isImageLike(selectedLayer)
      ? selectedImageTransform
      : selectedTransform;
  const draft = useMemo(
    () => ({ editingTemplateId, templateName, templateType, canvasSettings, cuttingLineColor, cardColor, background, layers }),
    [background, canvasSettings, cardColor, cuttingLineColor, editingTemplateId, layers, templateName, templateType],
  );
  const beginColorPreviewSession = useCallback(() => {
    if (!colorPreviewSnapshotRef.current) colorPreviewSnapshotRef.current = draft;
  }, [draft]);
  const markColorPreviewApply = useCallback(() => {
    skipHistoryRef.current = true;
  }, []);
  const commitColorPreviewSession = useCallback(() => {
    const snapshot = colorPreviewSnapshotRef.current;
    colorPreviewSnapshotRef.current = null;
    const currentJson = JSON.stringify(draft);
    if (snapshot && JSON.stringify(snapshot) !== currentJson) {
      setUndoStack((current) => [...current, snapshot].slice(-historyLimit));
      setRedoStack([]);
    }
    skipHistoryRef.current = true;
    lastDraftJsonRef.current = currentJson;
  }, [draft]);
  const cancelColorPreviewSession = useCallback(() => {
    colorPreviewSnapshotRef.current = null;
    skipHistoryRef.current = true;
    lastDraftJsonRef.current = JSON.stringify(draft);
  }, [draft]);
  const colorSelectorLiveProps = useMemo(
    () => ({
      onLiveSessionStart: beginColorPreviewSession,
      onLiveApply: markColorPreviewApply,
      onLiveCommit: commitColorPreviewSession,
      onLiveCancel: cancelColorPreviewSession,
    }),
    [beginColorPreviewSession, cancelColorPreviewSession, commitColorPreviewSession, markColorPreviewApply],
  );
  const physicalSizeMm = useMemo(() => cardPhysicalSizeForCanvas(canvasSettings), [canvasSettings]);
  const displayAspectRatio = useMemo(() => cardAspectRatio(canvasSettings), [canvasSettings]);
  const rulerXTicks = useMemo(() => makeCenteredMmTicks(physicalSizeMm.width), [physicalSizeMm.width]);
  const rulerYTicks = useMemo(() => makeCenteredMmTicks(physicalSizeMm.height), [physicalSizeMm.height]);
  const pxPerMmDebug = useMemo(() => getCanvasPxPerMm(canvasSettings), [canvasSettings]);
  const cutLineSettings = useMemo(
    () => normalizeCutLineSettings(exportSettings.cutLineSettings ?? defaultCutLineSettings),
    [exportSettings.cutLineSettings],
  );
  const cutLinePreviewGeometry = useMemo(
    () =>
      getCutLineGeometryMm(
        {
          xMm: 0,
          yMm: 0,
          widthMm: physicalSizeMm.width,
          heightMm: physicalSizeMm.height,
        },
        cutLineSettings,
        canvasSettings,
      ),
    [canvasSettings, cutLineSettings, physicalSizeMm.height, physicalSizeMm.width],
  );
  const cutLinePreviewDashArray = useMemo(
    () => cutLineDashArrayMm(cutLineSettings.style).join(' '),
    [cutLineSettings.style],
  );
  const cutLinePreviewStrokeWidth = Math.max(0.12, cutLineSettings.widthMm);
  const cutLinePreviewCornerSegments = useMemo(
    () => cornerMarkSegmentsForGeometryMm(cutLinePreviewGeometry, cutLineSettings),
    [cutLinePreviewGeometry, cutLineSettings],
  );

  function updateCutLineSettings(patch: Partial<typeof cutLineSettings>) {
    const next = normalizeCutLineSettings({ ...cutLineSettings, ...patch });
    setCuttingLineColor(next.color);
    updateExportSettings({ cutLineSettings: next });
  }

  useEffect(() => {
    setCuttingLineColor(cutLineSettings.color);
  }, [cutLineSettings.color]);

  useEffect(() => {
    const viewportElement = viewportRef.current;
    if (!viewportElement) return undefined;
    function preventWheelPageScroll(event: globalThis.WheelEvent) {
      if (assetPickerOpen || isViewportControlTarget(event.target)) return;
      event.preventDefault();
    }
    viewportElement.addEventListener('wheel', preventWheelPageScroll, { passive: false });
    return () => viewportElement.removeEventListener('wheel', preventWheelPageScroll);
  }, [assetPickerOpen]);

  const updateLayer = useCallback((layerId: string, patch: Partial<TemplateLayer>) => {
    setLayers((current) =>
      current.map((layer) => {
        if (layer.id !== layerId) return layer;
        if (isShapeLayer(layer)) return normalizeShapeLayer({ ...layer, ...patch, data: { ...layer.data, ...patch.data } }, canvasSettings, getLayerLabel(layer));
        const nextData = patch.data ?? layer.data;
        const nextSlotType = patch.slotType ?? layer.slotType;
        const nextCornerRadius = patch.cornerRadius ?? layer.cornerRadius ?? layer.slot?.cornerRadius;
        const nextCornerRadiusMm = patch.cornerRadiusMm ?? layer.cornerRadiusMm ?? layer.slot?.cornerRadiusMm;
        return {
          ...layer,
          ...patch,
          data: nextData,
          slot: layer.slot
            ? {
                ...layer.slot,
                x: patch.x ?? layer.slot.x,
                y: patch.y ?? layer.slot.y,
                width: patch.width ?? layer.slot.width,
                height: patch.height ?? layer.slot.height,
                label: nextData?.label ? String(nextData.label) : layer.slot.label,
                slotType: nextSlotType ?? layer.slot.slotType,
                cornerRadius: nextCornerRadius,
                cornerRadiusMm: nextCornerRadiusMm,
              }
            : layer.slot,
        };
      }),
    );
  }, [canvasSettings]);

  function applyDraft(nextDraft: TemplateEditorDraft) {
    setEditingTemplateId(nextDraft.editingTemplateId);
    setTemplateName(nextDraft.templateName);
    setTemplateType(nextDraft.templateType);
    setCanvasSettings(nextDraft.canvasSettings);
    setCuttingLineColor(nextDraft.cuttingLineColor);
    setCardColor(nextDraft.cardColor ?? getCardBackgroundColor(nextDraft.canvasSettings, defaultCardBackgroundColor));
    setBackground(nextDraft.background ?? getStickerBackgroundColor(nextDraft.canvasSettings, defaultStickerBackgroundColor));
    setLayers(withFrontZOrder(nextDraft.layers));
    setSelectedId('');
    setSelectedTarget('layer');
  }

  function restoreDraft(nextDraft: TemplateEditorDraft) {
    skipHistoryRef.current = true;
    lastDraftJsonRef.current = JSON.stringify(nextDraft);
    applyDraft(nextDraft);
  }

  function undoDraft() {
    const previous = undoStack[undoStack.length - 1];
    if (!previous) return;
    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => [draft, ...current].slice(0, historyLimit));
    restoreDraft(previous);
  }

  function redoDraft() {
    const next = redoStack[0];
    if (!next) return;
    setRedoStack((current) => current.slice(1));
    setUndoStack((current) => [...current, draft].slice(-historyLimit));
    restoreDraft(next);
  }

  const matchingAssets = useMemo(
    () =>
      [...Object.values(assetLibrary?.assetsById ?? {}), ...localSlotAssets].filter((asset) =>
        assetMatchesSlot(asset, selectedLayer?.slotType),
      ),
    [assetLibrary?.assetsById, localSlotAssets, selectedLayer?.slotType],
  );

  const assetPlatforms = useMemo(() => {
    const buckets = matchingAssets.reduce<Record<string, LocalAsset[]>>((result, asset) => {
      const platform = assetPlatform(asset);
      result[platform] = [...(result[platform] ?? []), asset];
      return result;
    }, {});
    return Object.entries(buckets)
      .map(([platform, assets]) => ({
        platform,
        assets: assets.sort((a, b) => assetDisplayName(a).localeCompare(assetDisplayName(b))),
      }))
      .sort((a, b) => a.platform.localeCompare(b.platform));
  }, [matchingAssets]);

  const selectedPlatformAssets = useMemo(() => {
    const query = assetSearch.trim().toLowerCase();
    const assets = assetPlatforms.find((bucket) => bucket.platform === assetPickerPlatform)?.assets ?? [];
    if (!query) return assets;
    return assets.filter((asset) => assetDisplayName(asset).toLowerCase().includes(query));
  }, [assetPickerPlatform, assetPlatforms, assetSearch]);

  const currentAssetFolders = useMemo(() => {
    if (assetSearch.trim()) return [];
    const prefix = assetFolderPath ? `${assetFolderPath}/` : '';
    const folders = new Set<string>();
    selectedPlatformAssets.forEach((asset) => {
      const folder = assetFolder(asset);
      if (assetFolderPath && folder !== assetFolderPath && !folder.startsWith(prefix)) return;
      const remainder = assetFolderPath ? folder.slice(prefix.length) : folder;
      const first = remainder.split('/').filter(Boolean)[0];
      if (first) folders.add(assetFolderPath ? `${assetFolderPath}/${first}` : first);
    });
    return Array.from(folders).sort((a, b) => a.localeCompare(b));
  }, [assetFolderPath, assetSearch, selectedPlatformAssets]);

  const currentFolderAssets = useMemo(() => {
    if (assetSearch.trim()) return selectedPlatformAssets;
    return selectedPlatformAssets.filter((asset) => assetFolder(asset) === assetFolderPath);
  }, [assetFolderPath, assetSearch, selectedPlatformAssets]);

  useEffect(() => {
    if (draftPersistTimeoutRef.current !== undefined) window.clearTimeout(draftPersistTimeoutRef.current);
    draftPersistTimeoutRef.current = window.setTimeout(() => {
      const currentJson = JSON.stringify(draft);
      localStorage.setItem(draftStorageKey, currentJson);
      if (!lastDraftJsonRef.current) {
        lastDraftJsonRef.current = currentJson;
        return;
      }
      if (skipHistoryRef.current) {
        skipHistoryRef.current = false;
        lastDraftJsonRef.current = currentJson;
        return;
      }
      if (currentJson === lastDraftJsonRef.current) return;
      try {
        const previous = JSON.parse(lastDraftJsonRef.current) as TemplateEditorDraft;
        setUndoStack((current) => [...current, previous].slice(-historyLimit));
        setRedoStack([]);
        lastDraftJsonRef.current = currentJson;
      } catch {
        lastDraftJsonRef.current = currentJson;
      }
    }, 180);
    return () => {
      if (draftPersistTimeoutRef.current !== undefined) window.clearTimeout(draftPersistTimeoutRef.current);
    };
  }, [draft]);

  useEffect(() => {
    localStorage.setItem(prefsStorageKey, JSON.stringify(editorPrefs));
  }, [editorPrefs]);

  useEffect(() => {
    preferredPanelLayoutRef.current = preferredPanelLayout;
    localStorage.setItem(panelLayoutStorageKey, JSON.stringify(preferredPanelLayout));
    setRenderedPanelLayout(clampPanelLayout(preferredPanelLayout));
  }, [clampPanelLayout, preferredPanelLayout]);

  useEffect(() => {
    if (!panelResizeState) return undefined;
    const resizeState = panelResizeState;
    function handlePointerMove(event: globalThis.PointerEvent) {
      const deltaX = event.clientX - resizeState.startX;
      const nextPreferred = clampPreferredPanelLayout(
        resizeState.side === 'left'
          ? {
              leftPanelWidth: resizeState.startLeftPanelWidth + deltaX,
              rightPanelWidth: resizeState.startRightPanelWidth,
            }
          : {
              leftPanelWidth: resizeState.startLeftPanelWidth,
              rightPanelWidth: resizeState.startRightPanelWidth - deltaX,
            },
      );
      setPreferredPanelLayout(nextPreferred);
      setRenderedPanelLayout(clampPanelLayout(nextPreferred, resizeState.side));
    }
    function stopResize() {
      setPanelResizeState(null);
    }
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
  }, [clampPanelLayout, panelResizeState]);

  useEffect(() => {
    const layoutElement = layoutRef.current;
    setRenderedPanelLayout(clampPanelLayout(preferredPanelLayoutRef.current));
    if (!layoutElement) return undefined;
    const observer = new ResizeObserver(() => setRenderedPanelLayout(clampPanelLayout(preferredPanelLayoutRef.current)));
    observer.observe(layoutElement);
    return () => observer.disconnect();
  }, [clampPanelLayout]);

  useEffect(() => {
    function handleHistoryShortcut(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && event.shiftKey) {
        event.preventDefault();
        redoDraft();
      } else if (key === 'z') {
        event.preventDefault();
        undoDraft();
      } else if (key === 'y') {
        event.preventDefault();
        redoDraft();
      }
    }

    window.addEventListener('keydown', handleHistoryShortcut);
    return () => window.removeEventListener('keydown', handleHistoryShortcut);
  });

  // Safety net for stuck pointer capture. A layer drag/resize/rotate/pan calls setPointerCapture on the canvas/viewport;
  // if the gesture is interrupted (window blur / alt-tab, a missed pointerup, pointercancel) the capture can leak and
  // then every click's pointerdown is routed to the canvas — so inputs (rename, numeric fields) can no longer be
  // focused or typed into until another drag happens to release it. This guarantees capture is always released and the
  // interaction state cleared, regardless of how the gesture ends. (See CLAUDE.md §16 "텍스트 입력 영역이 자꾸 비활성화됨".)
  useEffect(() => {
    function releaseCaptures(pointerId?: number) {
      [canvasRef.current, viewportRef.current].forEach((element) => {
        if (!element) return;
        const ids = pointerId !== undefined ? [pointerId] : Array.from({ length: 24 }, (_, index) => index);
        ids.forEach((id) => {
          try {
            if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
          } catch {
            // ignore — capture may already be gone
          }
        });
      });
    }
    function handlePointerEnd(event: Event) {
      releaseCaptures((event as unknown as { pointerId?: number }).pointerId);
    }
    function handleWindowBlur() {
      releaseCaptures();
      setInteraction(null);
      setSnapGuides([]);
      setPanInteraction(null);
    }
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return undefined;

    function isTextInputFocused() {
      const activeElement = document.activeElement;
      if (!(activeElement instanceof HTMLElement)) return false;
      const tagName = activeElement.tagName.toLowerCase();
      return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || activeElement.isContentEditable;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (isTextInputFocused()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setSelectedId('');
        setSelectedTarget('layer');
        return;
      }
      const activeLayer = layers.find((layer) => layer.id === selectedId);
      if (!activeLayer) return;
      const deltas: Record<string, { x: number; y: number } | undefined> = {
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
      };
      const delta = deltas[event.key];
      if (!delta) return;
      event.preventDefault();
      if (selectedTarget === 'image' && isImageLike(activeLayer)) {
        const imageTransform = getImageTransform(activeLayer);
        updateLayer(activeLayer.id, {
          data: {
            ...activeLayer.data,
            imageTransform: {
              ...imageTransform,
              x: imageTransform.x + delta.x,
              y: imageTransform.y + delta.y,
            },
          },
        });
        return;
      }
      updateLayer(activeLayer.id, { x: (activeLayer.x ?? 0) + delta.x, y: (activeLayer.y ?? 0) + delta.y });
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [layers, selectedId, selectedTarget, updateLayer]);

  // Ctrl+C / Ctrl+V — copy the selected layer to an in-memory clipboard and paste it (offset, new id). Not gated on a
  // current selection so paste works any time; skips when a text input is focused or the user is copying selected text.
  useEffect(() => {
    function isTextInputFocused() {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return false;
      const tag = active.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || active.isContentEditable;
    }
    function handleClipboard(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || isTextInputFocused()) return;
      const key = event.key.toLowerCase();
      if (key === 'c') {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) return; // let text copy
        const layer = layers.find((item) => item.id === selectedId);
        if (!layer) return;
        clipboardLayerRef.current = structuredClone(layer);
        event.preventDefault();
      } else if (key === 'v') {
        if (!clipboardLayerRef.current) return;
        event.preventDefault();
        pasteClipboardLayer(clipboardLayerRef.current);
      }
    }
    window.addEventListener('keydown', handleClipboard);
    return () => window.removeEventListener('keydown', handleClipboard);
  }, [layers, selectedId]);

  function addSlot() {
    const slot = makeSlot(layers.length + 1);
    setLayers((current) => withFrontZOrder([slot, ...current]));
    setSelectedId(slot.id);
    setSelectedTarget('layer');
  }

  function addShape(shape: ShapeKind) {
    const layer = makeShapeLayer(shape, layers.length + 1, canvasSettings);
    setLayers((current) => withFrontZOrder([layer, ...current]));
    setSelectedId(layer.id);
    setSelectedTarget('layer');
  }

  function updateShape(shapeId: string, patch: Partial<ShapeLayer>) {
    setLayers((current) =>
      current.map((layer) => {
        if (layer.id !== shapeId || !isShapeLayer(layer) || layer.locked) return layer;
        return normalizeShapeLayer(
          {
            ...layer,
            ...patch,
            slot: undefined,
            slotType: undefined,
            data: { ...layer.data, ...patch.data, kind: 'shape' },
          },
          canvasSettings,
          getLayerLabel(layer),
        );
      }),
    );
  }

  function updateShapeData(shapeId: string, patch: Record<string, unknown>) {
    const layer = layers.find((candidate) => candidate.id === shapeId);
    if (!layer || !isShapeLayer(layer)) return;
    updateShape(shapeId, { data: { ...layer.data, ...patch, kind: 'shape' } });
  }

  function updateSelectedLayer(patch: Partial<TemplateLayer>) {
    if (!selectedLayer) return;
    if (isShapeLayer(selectedLayer)) {
      updateShape(selectedLayer.id, patch as Partial<ShapeLayer>);
      return;
    }
    updateLayer(selectedLayer.id, patch);
  }

  function setShapeFillColor(layer: TemplateLayer, color: string) {
    if (!isShapeLayer(layer) || layer.locked) return;
    updateLayer(layer.id, {
      fill: color,
      data: {
        ...layer.data,
        fillNone: false,
        fillStyle: { type: 'solid', color },
      },
    });
  }

  function shapeCornerRadiiMm(layer: TemplateLayer) {
    return normalizeCornerRadiiMm(layer, canvasSettings);
  }

  function shapeSupportsCornerRadius(layer: TemplateLayer) {
    const kind = shapeKind(layer);
    return kind === 'rectangle' || kind === 'roundedRectangle';
  }

  function uniformRadii(value: number): TemplateCornerRadii {
    return {
      topLeft: value,
      topRight: value,
      bottomRight: value,
      bottomLeft: value,
    };
  }

  function updateLayerRadiusValues(layer: TemplateLayer, radii: TemplateCornerRadii, linked: boolean) {
    if (layer.locked) return;
    const representativeRadius = radii.topLeft;
    updateLayer(layer.id, {
      cornerRadiusMm: representativeRadius,
      cornerRadius: mmToCanvasPx(representativeRadius, canvasSettings),
      cornerRadiiMm: radii,
      data: {
        ...layer.data,
        cornerRadiusLinked: linked,
        cornerRadiiMm: radii,
      },
    });
  }

  function setLayerRadiusLinked(layer: TemplateLayer, linked: boolean) {
    if (layer.locked) return;
    const current = normalizeCornerRadiiMm(layer, canvasSettings);
    const nextRadius = linked ? current.topLeft : layerCornerRadiusMm(layer, canvasSettings);
    updateLayerRadiusValues(layer, linked ? uniformRadii(nextRadius) : current, linked);
  }

  function updateLayerUniformRadius(layer: TemplateLayer, value: number) {
    if (layer.locked) return;
    const parsed = Number(value);
    const radiusMm = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    updateLayerRadiusValues(layer, uniformRadii(radiusMm), true);
  }

  function updateLayerCornerRadius(layer: TemplateLayer, corner: RadiusCornerKey, value: number) {
    if (layer.locked) return;
    const parsed = Number(value);
    const radiusMm = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    const linked = layer.data?.cornerRadiusLinked !== false;
    if (linked) {
      updateLayerUniformRadius(layer, radiusMm);
      return;
    }
    updateLayerRadiusValues(layer, { ...normalizeCornerRadiiMm(layer, canvasSettings), [corner]: radiusMm }, false);
  }

  function setShapeRadiusLinked(layer: TemplateLayer, linked: boolean) {
    if (!isShapeLayer(layer) || layer.locked) return;
    setLayerRadiusLinked(layer, linked);
  }

  function updateShapeUniformRadius(layer: TemplateLayer, value: number) {
    if (!isShapeLayer(layer) || layer.locked) return;
    updateLayerUniformRadius(layer, value);
  }

  function updateShapeCornerRadius(layer: TemplateLayer, corner: RadiusCornerKey, value: number) {
    if (!isShapeLayer(layer) || layer.locked) return;
    updateLayerCornerRadius(layer, corner, value);
  }

  function ownImageCornerRadiiMm(layer: TemplateLayer) {
    const imageData = layer.data ?? {};
    const fallback = Number.isFinite(Number(imageData.imageCornerRadiusMm)) ? Math.max(0, Number(imageData.imageCornerRadiusMm)) : 0;
    const stored = imageData.imageCornerRadiiMm as Partial<TemplateCornerRadii> | undefined;
    return {
      topLeft: Number.isFinite(Number(stored?.topLeft)) ? Math.max(0, Number(stored?.topLeft)) : fallback,
      topRight: Number.isFinite(Number(stored?.topRight)) ? Math.max(0, Number(stored?.topRight)) : fallback,
      bottomRight: Number.isFinite(Number(stored?.bottomRight)) ? Math.max(0, Number(stored?.bottomRight)) : fallback,
      bottomLeft: Number.isFinite(Number(stored?.bottomLeft)) ? Math.max(0, Number(stored?.bottomLeft)) : fallback,
    };
  }

  function updateImageCornerRadiusValues(layer: TemplateLayer, radii: TemplateCornerRadii, linked: boolean) {
    if (layer.locked || !isImageLike(layer)) return;
    const representativeRadius = radii.topLeft;
    updateLayer(layer.id, {
      data: {
        ...layer.data,
        imageCornerRadiusInheritSlot: false,
        imageCornerRadiusLinked: linked,
        imageCornerRadiusMm: representativeRadius,
        imageCornerRadius: mmToCanvasPx(representativeRadius, canvasSettings),
        imageCornerRadiiMm: radii,
      },
    });
  }

  function setImageCornerRadiusInheritSlot(layer: TemplateLayer, inheritFromSlot: boolean) {
    if (layer.locked || !isImageLike(layer)) return;
    const currentRenderedRadii = normalizeImageCornerRadiiMm(layer, canvasSettings);
    updateLayer(layer.id, {
      data: {
        ...layer.data,
        imageCornerRadiusInheritSlot: inheritFromSlot,
        imageCornerRadiusLinked: layer.data?.imageCornerRadiusLinked !== false,
        imageCornerRadiusMm: Number(layer.data?.imageCornerRadiusMm ?? currentRenderedRadii.topLeft),
        imageCornerRadius: mmToCanvasPx(Number(layer.data?.imageCornerRadiusMm ?? currentRenderedRadii.topLeft), canvasSettings),
        imageCornerRadiiMm: layer.data?.imageCornerRadiiMm ?? currentRenderedRadii,
      },
    });
  }

  function setImageRadiusLinked(layer: TemplateLayer, linked: boolean) {
    if (layer.locked || !isImageLike(layer)) return;
    const current = ownImageCornerRadiiMm(layer);
    const nextRadius = linked ? current.topLeft : Number(layer.data?.imageCornerRadiusMm ?? current.topLeft);
    updateImageCornerRadiusValues(layer, linked ? uniformRadii(nextRadius) : current, linked);
  }

  function updateImageUniformRadius(layer: TemplateLayer, value: number) {
    if (layer.locked || !isImageLike(layer)) return;
    const parsed = Number(value);
    const radiusMm = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    updateImageCornerRadiusValues(layer, uniformRadii(radiusMm), true);
  }

  function updateImageCornerRadius(layer: TemplateLayer, corner: RadiusCornerKey, value: number) {
    if (layer.locked || !isImageLike(layer)) return;
    const parsed = Number(value);
    const radiusMm = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    const linked = layer.data?.imageCornerRadiusLinked !== false;
    if (linked) {
      updateImageUniformRadius(layer, radiusMm);
      return;
    }
    updateImageCornerRadiusValues(layer, { ...ownImageCornerRadiiMm(layer), [corner]: radiusMm }, false);
  }

  function updateImageTransform(layerId: string, transform: LayerTransform) {
    const layer = layers.find((candidate) => candidate.id === layerId);
    if (!layer || layer.locked) return;
    updateLayer(layerId, { data: { ...layer.data, imageTransform: transform } });
  }

  function scaleLinkedImageTransform(layer: TemplateLayer, nextLayerTransform: LayerTransform) {
    const currentLayerTransform = resolveLayerTransform(layer);
    const currentImageTransform = getImageTransform(layer);
    const scaleX = currentLayerTransform.width > 0 ? nextLayerTransform.width / currentLayerTransform.width : 1;
    const scaleY = currentLayerTransform.height > 0 ? nextLayerTransform.height / currentLayerTransform.height : 1;
    return {
      ...currentImageTransform,
      x: currentImageTransform.x * scaleX,
      y: currentImageTransform.y * scaleY,
      width: currentImageTransform.width * scaleX,
      height: currentImageTransform.height * scaleY,
    };
  }

  function applyTransform(layerId: string, transform: LayerTransform) {
    const layer = layers.find((candidate) => candidate.id === layerId);
    if (layer?.locked) return;
    const currentLayerTransform = layer ? resolveLayerTransform(layer) : undefined;
    const shouldScaleLinkedImage =
      Boolean(layer && isImageLike(layer) && imageTransformMode(layer) === 'linked') &&
      Boolean(currentLayerTransform) &&
      (Math.abs((currentLayerTransform?.width ?? transform.width) - transform.width) > 0.01 ||
        Math.abs((currentLayerTransform?.height ?? transform.height) - transform.height) > 0.01);
    updateLayer(layerId, {
      x: transform.x,
      y: transform.y,
      width: transform.width,
      height: transform.height,
      rotation: transform.rotation,
      opacity: transform.opacity,
      data: shouldScaleLinkedImage && layer
        ? {
            ...layer.data,
            imageTransform: scaleLinkedImageTransform(layer, transform),
          }
        : layer?.data,
    });
  }

  function beginMove(layer: TemplateLayer, event: PointerEvent<HTMLElement>, target: 'layer' | 'image' = 'layer') {
    if (event.button !== 0) return;
    if (layer.locked) return;
    // Ctrl/Cmd/Shift+click toggles the layer in the multi-selection (for align/distribute) instead of starting a drag.
    if (target === 'layer' && (event.shiftKey || event.ctrlKey || event.metaKey)) {
      event.stopPropagation();
      event.preventDefault();
      toggleLayerInSelection(layer.id);
      return;
    }
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;
    event.stopPropagation();
    event.preventDefault();
    canvasElement.setPointerCapture(event.pointerId);
    setSelectedId(layer.id);
    setSelectedTarget(target);
    setInteraction({
      target,
      type: 'move',
      pointerId: event.pointerId,
      startPointer: getCanvasPoint(canvasElement, event, canvasSettings),
      startTransform: target === 'image' ? getImageTransform(layer) : resolveLayerTransform(layer),
    });
  }

  function beginResize(layer: TemplateLayer, event: PointerEvent<HTMLButtonElement>, target: 'layer' | 'image' = 'layer', handle: ResizeHandle = 'bottom-right') {
    if (event.button !== 0) return;
    if (layer.locked) return;
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;
    event.stopPropagation();
    event.preventDefault();
    canvasElement.setPointerCapture(event.pointerId);
    setSelectedId(layer.id);
    setSelectedTarget(target);
    setInteraction({
      target,
      type: 'resize',
      pointerId: event.pointerId,
      handle,
      startTransform: target === 'image' ? getImageTransform(layer) : resolveLayerTransform(layer),
    });
  }

  function beginRotate(layer: TemplateLayer, event: PointerEvent<HTMLButtonElement>, target: 'layer' | 'image' = 'layer') {
    if (event.button !== 0) return;
    if (layer.locked) return;
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;
    event.stopPropagation();
    event.preventDefault();
    canvasElement.setPointerCapture(event.pointerId);
    setSelectedId(layer.id);
    setSelectedTarget(target);
    const layerTransform = resolveLayerTransform(layer);
    const imageTransform = getImageTransform(layer);
    // Overlay rect in canvas space (matches the rendered selection box) → its centre is the rotation pivot.
    const rect =
      target === 'image'
        ? { x: layerTransform.x + imageTransform.x, y: layerTransform.y + imageTransform.y, width: imageTransform.width, height: imageTransform.height, rotation: imageTransform.rotation }
        : layerTransform;
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const startPoint = getCanvasPoint(canvasElement, event, canvasSettings);
    setInteraction({
      target,
      type: 'rotate',
      pointerId: event.pointerId,
      centerX,
      centerY,
      startAngle: Math.atan2(startPoint.y - centerY, startPoint.x - centerX),
      startRotation: Number(rect.rotation ?? 0),
    });
  }

  function updateInteraction(event: PointerEvent<HTMLDivElement>) {
    const canvasElement = canvasRef.current;
    if (!canvasElement || !interaction || !selectedLayer || selectedLayer.locked || interaction.pointerId !== event.pointerId) return;
    const point = getCanvasPoint(canvasElement, event, canvasSettings);

    if (interaction.type === 'move') {
      const rawX = interaction.startTransform.x + point.x - interaction.startPointer.x;
      const rawY = interaction.startTransform.y + point.y - interaction.startPointer.y;
      const snapCanvas =
        interaction.target === 'image'
          ? { ...canvasSettings, width: resolveLayerTransform(selectedLayer).width, height: resolveLayerTransform(selectedLayer).height }
          : canvasSettings;
      const snapEnabled = editorPrefs.snapToGrid && !event.altKey;
      const nextPosition = snapEnabled
        ? snapLayerPositionToGridAndCenter(
            { x: rawX, y: rawY },
            { width: interaction.startTransform.width, height: interaction.startTransform.height },
            snapCanvas,
          )
        : { x: rawX, y: rawY };
      // Smart guides: for whole-layer moves, snap to other objects' edges/centers, card edges/center and the cut line,
      // and surface the matched lines so the canvas can draw guides. Image-in-slot moves keep slot-relative snapping only.
      let resolvedPosition = nextPosition;
      if (snapEnabled && interaction.target === 'layer') {
        const xLines: number[] = [0, canvasSettings.width / 2, canvasSettings.width];
        const yLines: number[] = [0, canvasSettings.height / 2, canvasSettings.height];
        const cutInset = cuttingLineInsetFromCardPx(canvasSettings);
        xLines.push(cutInset, canvasSettings.width - cutInset);
        yLines.push(cutInset, canvasSettings.height - cutInset);
        for (const other of layers) {
          if (other.id === selectedLayer.id || other.type === 'background' || other.data?.visible === false) continue;
          const t = resolveLayerTransform(other);
          xLines.push(t.x, t.x + t.width / 2, t.x + t.width);
          yLines.push(t.y, t.y + t.height / 2, t.y + t.height);
        }
        const smart = computeSmartSnap(
          { x: nextPosition.x, y: nextPosition.y, width: interaction.startTransform.width, height: interaction.startTransform.height },
          { x: xLines, y: yLines },
          canvasSettings,
        );
        resolvedPosition = { x: smart.x, y: smart.y };
        setSnapGuides(smart.guides);
      } else if (snapGuides.length > 0) {
        setSnapGuides([]);
      }
      const nextTransform = {
        ...interaction.startTransform,
        x: resolvedPosition.x,
        y: resolvedPosition.y,
      };
      if (interaction.target === 'image') updateImageTransform(selectedLayer.id, nextTransform);
      else applyTransform(selectedLayer.id, nextTransform);
      return;
    }

    if (interaction.type === 'rotate') {
      const currentAngle = Math.atan2(point.y - interaction.centerY, point.x - interaction.centerX);
      let degrees = interaction.startRotation + ((currentAngle - interaction.startAngle) * 180) / Math.PI;
      if (event.shiftKey) degrees = Math.round(degrees / 15) * 15; // Shift → 15° snap
      degrees = ((degrees % 360) + 360) % 360;
      if (interaction.target === 'image') {
        const it = getImageTransform(selectedLayer);
        updateImageTransform(selectedLayer.id, { ...it, rotation: degrees });
      } else {
        const t = resolveLayerTransform(selectedLayer);
        applyTransform(selectedLayer.id, { ...t, rotation: degrees });
      }
      return;
    }

    const layerTransform = resolveLayerTransform(selectedLayer);
    const rawResizePoint =
      interaction.target === 'image' ? { x: point.x - layerTransform.x, y: point.y - layerTransform.y } : point;
    const resizeCanvas =
      interaction.target === 'image'
        ? { ...canvasSettings, width: layerTransform.width, height: layerTransform.height }
        : canvasSettings;
    const resizePoint = editorPrefs.snapToGrid && !event.altKey
      ? snapPointToGridAndCenter(rawResizePoint, resizeCanvas)
      : rawResizePoint;
    const nextTransform = resizeTransformFromHandle(
      interaction.startTransform,
      resizePoint,
      interaction.handle,
      interaction.target === 'image' ? imageTransformLimits : undefined,
      editorPrefs.lockAspect || event.shiftKey,
    );
    if (interaction.target === 'image') updateImageTransform(selectedLayer.id, nextTransform);
    else applyTransform(selectedLayer.id, nextTransform);
  }

  function endInteraction(event: PointerEvent<HTMLDivElement>) {
    if (interaction?.pointerId === event.pointerId) {
      setInteraction(null);
      setSnapGuides([]);
    }
  }

  function isViewportControlTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'));
  }

  function handleViewportWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (assetPickerOpen || isViewportControlTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const direction = event.deltaY > 0 ? -1 : 1;
    const factor = direction > 0 ? 1.1 : 1 / 1.1;
    setViewport((current) => clampViewport(zoomViewportAtPoint(current, point, current.zoom * factor)));
  }

  function beginViewportPan(event: PointerEvent<HTMLDivElement>) {
    if (assetPickerOpen || event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanInteraction({
      pointerId: event.pointerId,
      startPointer: { x: event.clientX, y: event.clientY },
      startViewport: viewport,
    });
  }

  function clearSelection() {
    setSelectedId('');
    setSelectedTarget('layer');
  }

  function handleViewportPointerDown(event: PointerEvent<HTMLDivElement>) {
    beginViewportPan(event);
    if (assetPickerOpen || event.button !== 0) return;
    if (!isEditorInteractiveTarget(event.target)) clearSelection();
  }

  function handleCanvasPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (assetPickerOpen || event.button !== 0) return;
    if (!isEditorInteractiveTarget(event.target)) clearSelection();
  }

  function updateViewportPan(event: PointerEvent<HTMLDivElement>) {
    if (!panInteraction || panInteraction.pointerId !== event.pointerId) return;
    event.preventDefault();
    setViewport(
      clampViewport(
        panViewport(panInteraction.startViewport, {
          x: event.clientX - panInteraction.startPointer.x,
          y: event.clientY - panInteraction.startPointer.y,
        }),
      ),
    );
  }

  function endViewportPan(event: PointerEvent<HTMLDivElement>) {
    if (panInteraction?.pointerId === event.pointerId) setPanInteraction(null);
  }

  const resetViewport = useCallback(() => {
    const viewportElement = viewportRef.current;
    const canvasElement = canvasRef.current;
    setPanInteraction(null);
    if (!viewportElement || !canvasElement) {
      setViewport(defaultViewportTransform);
      return;
    }
    setViewport(
      clampViewport(
        getFitViewTransform({
          viewportWidth: viewportElement.clientWidth,
          viewportHeight: viewportElement.clientHeight,
          canvasWidth: canvasElement.offsetWidth,
          canvasHeight: canvasElement.offsetHeight,
          offsetX: canvasElement.offsetLeft,
          offsetY: canvasElement.offsetTop,
          padding: editorPrefs.showRuler ? 48 : 40,
          minZoom: getViewportMinZoom(),
          maxZoom: 1,
        }),
      ),
    );
  }, [clampViewport, editorPrefs.showRuler, getViewportMinZoom]);

  useEffect(() => {
    const viewportElement = viewportRef.current;
    if (!viewportElement) return undefined;
    let frame = window.requestAnimationFrame(resetViewport);
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(resetViewport);
    });
    observer.observe(viewportElement);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [canvasSettings.height, canvasSettings.width, resetViewport]);

  const chooseAsset = useCallback(async (asset: LocalAsset) => {
    if (!selectedLayer) return;
    setAssetPickerError('');
    try {
      const imageDataUrl = await assetToDataUrl(asset);
      const imageSize = await loadImageSize(imageDataUrl);
      const fitMode = (selectedLayer.imageFitMode ?? selectedLayer.data?.imageFitMode ?? defaultFitModeForSlot(selectedLayer.slotType)) as ImageFitMode;
      const layerTransform = resolveLayerTransform(selectedLayer);
      updateLayer(selectedLayer.id, {
        imageFitMode: fitMode,
        data: {
          ...selectedLayer.data,
          imageDataUrl,
          imageName: asset.name,
          imageAssetId: asset.id,
          imageNaturalWidth: imageSize.width,
          imageNaturalHeight: imageSize.height,
          imageFitMode: fitMode,
          imageTransformMode: 'linked',
          imageTransform: {
            ...fitImageToBounds('stretch', imageSize, layerTransform),
            cropTop: 0,
            cropRight: 0,
            cropBottom: 0,
            cropLeft: 0,
          },
        },
      });
      setSelectedTarget('layer');
      setAssetPickerOpen(false);
      setAssetPickerPlatform('');
      setAssetFolderPath('');
      setPreviewAsset(null);
      setAssetSearch('');
    } catch (error) {
      setAssetPickerError(error instanceof Error ? error.message : 'Could not load this image.');
    }
  }, [selectedLayer, updateLayer]);

  useEffect(() => {
    if (!previewAsset) return undefined;
    const activePreviewAsset = previewAsset;
    function handlePreviewKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setPreviewAsset(null);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        void chooseAsset(activePreviewAsset);
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const currentIndex = currentFolderAssets.findIndex((asset) => asset.id === activePreviewAsset.id);
        const nextIndex = event.key === 'ArrowLeft' ? currentIndex - 1 : currentIndex + 1;
        if (nextIndex >= 0 && nextIndex < currentFolderAssets.length) setPreviewAsset(currentFolderAssets[nextIndex]);
      }
    }
    window.addEventListener('keydown', handlePreviewKeyDown);
    return () => window.removeEventListener('keydown', handlePreviewKeyDown);
  }, [chooseAsset, currentFolderAssets, previewAsset]);

  function importLocalFolderAssets(files: FileList | null) {
    const slotType = selectedLayer?.slotType;
    const imageFiles = (files ? Array.from(files) : []).filter((file) => file.type.startsWith('image/') || supportedLocalImagePattern.test(file.name));
    if (imageFiles.length === 0) {
      setAssetPickerError('선택한 폴더에 사용할 수 있는 이미지 파일이 없습니다.');
      return;
    }
    const kind = localAssetKindForSlot(slotType);
    const timestamp = Date.now();
    const assets = imageFiles.map((file, index) => {
      const fileWithPath = file as File & { webkitRelativePath?: string };
      const originalPath = fileWithPath.webkitRelativePath || file.name;
      const normalizedFileName = normalizeName(file.name.replace(/\.[^.]+$/, ''));
      return {
        id: `template_local_${timestamp}_${index}_${normalizedFileName.replace(/[^a-z0-9]+/g, '_')}`,
        sourceId: 'template-local-folder',
        sourceLabel: '사용자 폴더',
        kind,
        name: file.name,
        normalizedName: normalizeName(file.name),
        normalizedFileName,
        path: originalPath,
        originalPath,
        platform: '사용자 폴더',
        assetType: slotTypeLabel(slotType),
        file,
        objectUrl: URL.createObjectURL(file),
        mimeType: file.type || undefined,
        format: fileFormat(file.name),
        importedAt: new Date().toISOString(),
      } satisfies LocalAsset;
    });
    setLocalSlotAssets(assets);
    setAssetPickerPlatform('사용자 폴더');
    setAssetFolderPath('');
    setAssetSearch('');
    setAssetPickerError('');
  }

  function openAssetPickerForLayer(layerId: string) {
    const layer = layers.find((candidate) => candidate.id === layerId);
    if (!layer || layer.locked || !isImageLike(layer)) return;
    setSelectedId(layer.id);
    setSelectedTarget('layer');
    setAssetPickerError('');
    setAssetPickerPlatform('');
    setAssetFolderPath('');
    setPreviewAsset(null);
    setAssetSearch('');
    setAssetPickerOpen(true);
  }

  function removeLayerImage(layer: TemplateLayer) {
    if (layer.locked) return;
    const nextData = { ...(layer.data ?? {}) };
    delete nextData.imageDataUrl;
    delete nextData.imageName;
    delete nextData.imageAssetId;
    delete nextData.imageNaturalWidth;
    delete nextData.imageNaturalHeight;
    delete nextData.imageTransform;
    delete nextData.imageTransformMode;
    updateLayer(layer.id, { data: nextData });
    setSelectedTarget('layer');
  }

  function renameLayer(layer: TemplateLayer, label: string) {
    if (layer.locked) return;
    const data = { ...layer.data, label };
    if (isShapeLayer(layer)) {
      updateShapeData(layer.id, { label });
      return;
    }
    updateLayer(layer.id, {
      data,
      slot: layer.slot ? { ...layer.slot, label } : layer.slot,
    });
  }

  function setLayerSlotType(layer: TemplateLayer, slotType: TemplateSlotType) {
    if (layer.locked || isShapeLayer(layer)) return;
    const imageFitMode = defaultFitModeForSlot(slotType);
    updateLayer(layer.id, {
      slotType,
      imageFitMode,
      data: { ...layer.data, imageFitMode },
      slot: layer.slot ? { ...layer.slot, slotType } : layer.slot,
    });
    setAssetPickerPlatform('');
  }

  function setLayerImageCrop(layer: TemplateLayer, cropKey: 'cropTop' | 'cropRight' | 'cropBottom' | 'cropLeft', value: number) {
    if (layer.locked || !isImageLike(layer)) return;
    const current = getImageTransform(layer);
    const naturalSize = imageNaturalSizeForLayer(layer);
    const nextCrop = clampImageCropPx({ ...current, [cropKey]: value }, naturalSize);
    updateImageTransform(layer.id, {
      ...current,
      ...nextCrop,
    });
  }

  function setLayerImageTransformMode(layer: TemplateLayer, mode: ImageTransformMode) {
    if (layer.locked || !isImageLike(layer)) return;
    const current = getImageTransform(layer);
    if (imageTransformMode(layer) === mode) return;
    const currentImageRadii = normalizeImageCornerRadiiMm(layer, canvasSettings);
    const imageRadiusPatch =
      mode === 'separate' && imageCornerRadiusInheritsSlot(layer)
        ? {
            imageCornerRadiusInheritSlot: false,
            imageCornerRadiusLinked: layer.data?.imageCornerRadiusLinked !== false,
            imageCornerRadiusMm: currentImageRadii.topLeft,
            imageCornerRadius: mmToCanvasPx(currentImageRadii.topLeft, canvasSettings),
            imageCornerRadiiMm: currentImageRadii,
          }
        : {};
    updateLayer(layer.id, {
      data: {
        ...layer.data,
        imageTransformMode: mode,
        imageTransform: current,
        ...imageRadiusPatch,
      },
    });
    setSelectedTarget(mode === 'separate' ? 'image' : 'layer');
  }

  function resetLayerImageCrop(layer: TemplateLayer) {
    if (layer.locked || !isImageLike(layer)) return;
    const current = getImageTransform(layer);
    updateImageTransform(layer.id, {
      ...current,
      cropTop: 0,
      cropRight: 0,
      cropBottom: 0,
      cropLeft: 0,
    });
  }

  function setLayerFrameCenterMm(layer: TemplateLayer, axis: 'x' | 'y', nextValue: number) {
    if (layer.locked) return;
    const transform = resolveLayerTransform(layer);
    applyTransform(layer.id, {
      ...transform,
      x: axis === 'x' ? centeredMmToCanvasX(nextValue, canvasSettings) - transform.width / 2 : transform.x,
      y: axis === 'y' ? centeredMmToCanvasY(nextValue, canvasSettings) - transform.height / 2 : transform.y,
    });
  }

  function setLayerFrameSize(layer: TemplateLayer, key: 'width' | 'height', value: number) {
    if (layer.locked) return;
    const transform = resolveLayerTransform(layer);
    const limits = isShapeLayer(layer)
      ? { minWidth: minShapeSizePx, minHeight: minShapeSizePx, maxWidth: layerTransformLimits.maxWidth, maxHeight: layerTransformLimits.maxHeight }
      : layerTransformLimits;
    applyTransform(
      layer.id,
      resizeLayerToSizeFromTopLeft(
        transform,
        {
          width: key === 'width' ? value : transform.width,
          height: key === 'height' ? value : transform.height,
        },
        limits,
      ),
    );
  }

  function setImageTransformAbsoluteCenterMm(layer: TemplateLayer, axis: 'x' | 'y', nextValue: number) {
    if (layer.locked || !isImageLike(layer)) return;
    const transform = getImageTransform(layer);
    const frame = resolveLayerTransform(layer);
    updateImageTransform(layer.id, {
      ...transform,
      x: axis === 'x' ? centeredMmToCanvasX(nextValue, canvasSettings) - frame.x - transform.width / 2 : transform.x,
      y: axis === 'y' ? centeredMmToCanvasY(nextValue, canvasSettings) - frame.y - transform.height / 2 : transform.y,
    });
  }

  function setImageTransformSize(layer: TemplateLayer, key: 'width' | 'height', value: number) {
    if (layer.locked || !isImageLike(layer)) return;
    const transform = getImageTransform(layer);
    updateImageTransform(
      layer.id,
      resizeLayerToSizeFromTopLeft(
        transform,
        {
          width: key === 'width' ? value : transform.width,
          height: key === 'height' ? value : transform.height,
        },
        imageTransformLimits,
      ),
    );
  }

  function updateLayerEffects(layer: TemplateLayer, effects: LayerEffect[]) {
    if (layer.locked) return;
    updateLayer(layer.id, { data: { ...layer.data, effects } });
  }

  function addLayerEffect(layer: TemplateLayer, type: LayerEffectType) {
    updateLayerEffects(layer, [...getLayerEffects(layer), defaultLayerEffect(type)]);
  }

  function updateLayerEffect(layer: TemplateLayer, effectId: string, patch: Partial<LayerEffect>) {
    updateLayerEffects(
      layer,
      getLayerEffects(layer).map((effect) =>
        effect.id === effectId
          ? {
              ...effect,
              ...patch,
              settings: { ...effect.settings, ...patch.settings },
            }
          : effect,
      ),
    );
  }

  function removeLayerEffect(layer: TemplateLayer, effectId: string) {
    updateLayerEffects(layer, getLayerEffects(layer).filter((effect) => effect.id !== effectId));
  }

  function deleteLayer(layerId: string) {
    if (layers.find((layer) => layer.id === layerId)?.locked) return;
    setLayers((current) => current.filter((layer) => layer.id !== layerId));
    if (selectedId === layerId) setSelectedId('');
    setExpandedLayerIds((current) => current.filter((id) => id !== layerId));
  }

  function moveLayer(dragId: string, targetId: string, position: DragOverPosition = 'before') {
    if (!dragId || dragId === targetId) return;
    setLayers((current) => {
      const next = [...current];
      const from = next.findIndex((layer) => layer.id === dragId);
      const to = next.findIndex((layer) => layer.id === targetId);
      if (from === -1 || to === -1) return current;
      if (next[from].locked) return current;
      const [item] = next.splice(from, 1);
      const targetIndex = next.findIndex((layer) => layer.id === targetId);
      if (targetIndex === -1) return current;
      next.splice(position === 'after' ? targetIndex + 1 : targetIndex, 0, item);
      return withFrontZOrder(next);
    });
  }

  function selectLayer(layer: TemplateLayer, target: 'layer' | 'image' = 'layer') {
    setSelectedId(layer.id);
    setSelectedTarget(target === 'image' && imageTransformMode(layer) === 'separate' ? 'image' : 'layer');
  }

  function toggleLayerExpanded(layerId: string) {
    setExpandedLayerIds((current) => (current.includes(layerId) ? current.filter((id) => id !== layerId) : [...current, layerId]));
  }

  function isDetailGroupOpen(layerId: string, group: LayerDetailGroupKey) {
    return expandedDetailGroups[layerId]?.includes(group) ?? false;
  }

  function toggleDetailGroup(layerId: string, group: LayerDetailGroupKey) {
    setExpandedDetailGroups((current) => {
      const groups = current[layerId] ?? [];
      return {
        ...current,
        [layerId]: groups.includes(group) ? groups.filter((value) => value !== group) : [...groups, group],
      };
    });
  }

  function startRenameLayer(layer: TemplateLayer) {
    if (layer.locked) return;
    selectLayer(layer);
    setRenamingLayerId(layer.id);
    setRenameDraft(getLayerLabel(layer));
  }

  function fallbackLayerName(layer: TemplateLayer) {
    if (isShapeLayer(layer)) return '도형';
    if (layer.type === 'text') return '텍스트';
    if (layer.type === 'background') return '배경';
    return layer.slotType ? `${slotTypeLabel(migrateSlotType(layer.slotType))} 슬롯` : '슬롯';
  }

  function commitRenameLayer(layer: TemplateLayer) {
    if (renamingLayerId !== layer.id) return;
    renameLayer(layer, renameDraft.trim() || fallbackLayerName(layer));
    setRenamingLayerId('');
    setRenameDraft('');
  }

  function cancelRenameLayer() {
    setRenamingLayerId('');
    setRenameDraft('');
  }

  function handleRenameKeyDown(event: ReactKeyboardEvent<HTMLInputElement>, layer: TemplateLayer) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitRenameLayer(layer);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelRenameLayer();
    }
  }

  function duplicateLayer(layerToDuplicate: TemplateLayer) {
    if (layerToDuplicate.locked) return;
    const duplicate = structuredClone(layerToDuplicate);
    duplicate.id = createId(isShapeLayer(layerToDuplicate) ? 'shape' : 'slot');
    duplicate.x = Number(layerToDuplicate.x ?? 0) + 12;
    duplicate.y = Number(layerToDuplicate.y ?? 0) + 12;
    duplicate.locked = false;
    duplicate.data = {
      ...duplicate.data,
      label: `${getLayerLabel(layerToDuplicate)} 복사`,
    };
    if (duplicate.slot) {
      duplicate.slot = {
        ...duplicate.slot,
        id: createId('slot'),
        label: `${getLayerLabel(layerToDuplicate)} 복사`,
      };
    }
    setLayers((current) => {
      const next = [...current];
      const index = next.findIndex((layer) => layer.id === layerToDuplicate.id);
      next.splice(index === -1 ? 0 : index, 0, duplicate);
      return withFrontZOrder(next);
    });
    setSelectedId(duplicate.id);
    setSelectedTarget('layer');
    setExpandedLayerIds((current) => [...current.filter((id) => id !== duplicate.id), duplicate.id]);
  }

  function duplicateSelectedLayer() {
    if (!selectedLayer) return;
    duplicateLayer(selectedLayer);
  }

  function pasteClipboardLayer(source: TemplateLayer) {
    const pasted = structuredClone(source);
    pasted.id = createId(isShapeLayer(source) ? 'shape' : 'slot');
    pasted.x = Number(source.x ?? 0) + 12;
    pasted.y = Number(source.y ?? 0) + 12;
    pasted.locked = false;
    pasted.data = { ...pasted.data, label: `${getLayerLabel(source)} 복사` };
    if (pasted.slot) {
      pasted.slot = { ...pasted.slot, id: createId('slot'), label: `${getLayerLabel(source)} 복사` };
    }
    setLayers((current) => withFrontZOrder([...current, pasted]));
    setSelectedId(pasted.id);
    setSelectedTarget('layer');
    setExpandedLayerIds((current) => [...current.filter((id) => id !== pasted.id), pasted.id]);
  }

  function deleteSelectedLayer() {
    if (!selectedLayer || selectedLayer.locked) return;
    if (!window.confirm(`"${getLayerLabel(selectedLayer)}" 레이어를 삭제할까요?`)) return;
    deleteLayer(selectedLayer.id);
  }

  function deleteLayerWithConfirm(layer: TemplateLayer) {
    if (layer.locked) return;
    if (!window.confirm(`"${getLayerLabel(layer)}" 레이어를 삭제할까요?`)) return;
    deleteLayer(layer.id);
  }

  function scrollToSelectedLayer() {
    if (!selectedId) return;
    const row = layerRowRefs.current.get(selectedId);
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlashLayerId(selectedId);
    window.setTimeout(() => setFlashLayerId((current) => (current === selectedId ? '' : current)), 900);
  }

  const loadTemplate = useCallback((templateId: string) => {
    const storedTemplate = templates.find((candidate) => candidate && candidate.id === templateId);
    if (!storedTemplate) return;
    const template = normalizeTemplateForRender(storedTemplate);
    const nextCanvas = {
      ...defaultCanvas,
      ...template.canvas,
      orientation: template.canvas.orientation ?? template.orientation ?? (template.canvas.width > template.canvas.height ? 'landscape' : 'portrait'),
      cornerRadiusMm: template.canvas.cuttingLineRadiusMm ?? template.canvas.cornerRadiusMm ?? defaultTemplateCanvas.cornerRadiusMm,
      cuttingLineRadiusMm: template.canvas.cuttingLineRadiusMm ?? template.canvas.cornerRadiusMm ?? defaultTemplateCanvas.cornerRadiusMm,
      cornerRadius: mmToCanvasPx(template.canvas.cuttingLineRadiusMm ?? template.canvas.cornerRadiusMm ?? defaultTemplateCanvas.cornerRadiusMm, template.canvas),
      cutOffsetMm: template.canvas.cutOffsetMm ?? defaultCanvas.cutOffsetMm,
      safeMarginMm: template.canvas.safeMarginMm ?? canvasPxToMm(template.canvas.safeMargin ?? defaultCanvas.safeMargin, template.canvas),
      cardBackgroundColor: getCardBackgroundColor(template.canvas, defaultCardBackgroundColor),
      cardColor: getCardBackgroundColor(template.canvas, defaultCardBackgroundColor),
      stickerBackgroundColor: getStickerBackgroundColor(template.canvas, defaultStickerBackgroundColor),
    } as EditorCanvas;
    setEditingTemplateId(template.id);
    setTemplateName(template.name);
    setTemplateType(template.type);
    setCanvasSettings(nextCanvas);
    setCardColor(getCardBackgroundColor(nextCanvas, defaultCardBackgroundColor));
    setBackground(getStickerBackgroundColor(nextCanvas, defaultStickerBackgroundColor));
    setLayers(withFrontZOrder(
      template.layers
        .filter((layer) => layer.type !== 'background')
        .map((layer, index) => {
          const layerIsShape = layer.type === 'shape';
          if (layerIsShape) {
            return normalizeShapeLayer(layer, nextCanvas, String(layer.data?.label ?? `Shape ${index + 1}`));
          }
          const slotType = layerIsShape ? layer.slotType : migrateSlotType(layer.slotType);
          const label = String(layer.data?.label ?? layer.slot?.label ?? (layerIsShape ? `Shape ${index + 1}` : `Slot ${index + 1}`));
          const cornerRadiusMm = layer.cornerRadiusMm ?? layer.slot?.cornerRadiusMm ?? canvasPxToMm(layer.cornerRadius ?? layer.slot?.cornerRadius ?? 16, nextCanvas);
          const cornerRadius = mmToCanvasPx(cornerRadiusMm, nextCanvas);
          const imageFitMode = layerIsShape ? layer.imageFitMode : (layer.imageFitMode ?? layer.data?.imageFitMode ?? defaultFitModeForSlot(slotType)) as ImageFitMode;
          return {
            ...layer,
            slotType,
            cornerRadius,
            cornerRadiusMm,
            imageFitMode,
            data: { ...layer.data, label, visible: layer.data?.visible ?? true, ...(imageFitMode ? { imageFitMode } : {}) },
            slot: layer.slot
              ? {
                  ...layer.slot,
                  slotType: migrateSlotType(slotType),
                  label,
                  cornerRadius,
                  cornerRadiusMm,
                }
              : undefined,
          };
        }),
    ));
    setSelectedId('');
    setSelectedTarget('layer');
    setSaveMessage(`${template.name} 템플릿을 편집 모드로 불러왔습니다.`);
  }, [templates]);

  useEffect(() => {
    if (!routeTemplateId || loadedRouteTemplateIdRef.current === routeTemplateId) return;
    if (!templates.some((template) => template && template.id === routeTemplateId)) return;
    loadTemplate(routeTemplateId);
    loadedRouteTemplateIdRef.current = routeTemplateId;
  }, [loadTemplate, routeTemplateId, templates]);

  function buildTemplateForSave(id: string, createdAt?: string): Template {
    const savedAt = new Date().toISOString();
    const cuttingLineRadiusMm = canvasSettings.cuttingLineRadiusMm ?? canvasSettings.cornerRadiusMm ?? defaultTemplateCanvas.cornerRadiusMm;
    const fixedCanvas = {
      ...canvasSettings,
      cuttingLineRadiusMm,
      cornerRadiusMm: cuttingLineRadiusMm,
      cornerRadius: mmToCanvasPx(cuttingLineRadiusMm, canvasSettings),
      cardBackgroundColor: cardColor,
      cardColor,
      stickerBackgroundColor: background,
    };
    const orderedLayers = withFrontZOrder(layers).map((layer) => {
      if (layer.type === 'shape') {
        return normalizeShapeLayer(layer, fixedCanvas, getLayerLabel(layer));
      }
      return {
        ...layer,
        slotType: migrateSlotType(layer.slotType),
        slot: layer.slot
          ? {
              ...layer.slot,
              slotType: migrateSlotType(layer.slotType),
              cornerRadius: layer.cornerRadius ?? layer.slot.cornerRadius,
              cornerRadiusMm: layer.cornerRadiusMm ?? layer.slot.cornerRadiusMm,
            }
          : layer.slot,
      };
    });
    return {
      id,
      name: templateName,
      type: templateType,
      orientation: fixedCanvas.orientation,
      canvas: fixedCanvas,
      source: 'EDITOR',
      builtIn: false,
      layoutPresetId: 'CUSTOM',
      layers: [{ id: createId('bg'), type: 'background', fill: background, locked: true, zIndex: 0, data: { label: '스티커 배경', baseLayer: true } }, ...orderedLayers],
      slots: orderedLayers.map((layer) => layer.slot).filter(Boolean) as Template['slots'],
      createdAt: createdAt ?? savedAt,
      updatedAt: savedAt,
      previewVersion: `${savedAt}-${canvasSettings.orientation ?? 'portrait'}-${canvasSettings.width}x${canvasSettings.height}-${orderedLayers.length}`,
    };
  }

  function saveTemplate() {
    const existing = editingTemplateId ? templates.find((template) => template.id === editingTemplateId) : undefined;
    const template = {
      ...buildTemplateForSave(existing?.id ?? createId('template'), existing?.createdAt),
      thumbnailCacheKey: existing?.thumbnailCacheKey,
      thumbnailVersion: existing?.thumbnailVersion,
      thumbnailUpdatedAt: existing?.thumbnailUpdatedAt,
      thumbnailStatus: 'stale' as const,
      thumbnailStaleCacheKey: existing?.thumbnailCacheKey,
      thumbnailError: undefined,
    };
    if (existing) {
      updateTemplate(existing.id, template);
      setSaveMessage(`템플릿을 업데이트했습니다: ${template.name}`);
      return;
    }
    addTemplate(template);
    setEditingTemplateId(template.id);
    setSaveMessage(`새 템플릿을 저장했습니다: ${template.name}`);
  }

  function saveTemplateAsNew() {
    const template = {
      ...buildTemplateForSave(createId('template')),
      thumbnailStatus: 'stale' as const,
      thumbnailError: undefined,
    };
    addTemplate(template);
    setEditingTemplateId(template.id);
    setSaveMessage(`다른 이름으로 저장했습니다: ${template.name}`);
  }

  function setTemplateOrientation(orientation: TemplateOrientation) {
    if (canvasSettings.orientation === orientation) return;
    const size = canvasSizeForOrientation(orientation);
    const nextCanvas: EditorCanvas = {
      ...canvasSettings,
      ...size,
      orientation,
    };
    const cuttingLineRadiusMm = nextCanvas.cuttingLineRadiusMm ?? nextCanvas.cornerRadiusMm ?? canvasPxToMm(canvasSettings.cornerRadius, canvasSettings);
    nextCanvas.cuttingLineRadiusMm = cuttingLineRadiusMm;
    nextCanvas.cornerRadiusMm = cuttingLineRadiusMm;
    nextCanvas.cornerRadius = mmToCanvasPx(cuttingLineRadiusMm, nextCanvas);
    nextCanvas.safeMargin = mmToCanvasPx(nextCanvas.safeMarginMm ?? canvasPxToMm(canvasSettings.safeMargin, canvasSettings), nextCanvas);
    const scaleX = nextCanvas.width / canvasSettings.width;
    const scaleY = nextCanvas.height / canvasSettings.height;
    setCanvasSettings(nextCanvas);
    setLayers((current) => current.map((layer) => scaleTemplateLayerForCanvas(layer, scaleX, scaleY, nextCanvas)));
  }


  function alignLayerObject(layer: TemplateLayer, target: 'layer' | 'image', axis: 'horizontal' | 'vertical' | 'both' | 'left' | 'right' | 'top' | 'bottom') {
    if (layer.locked) return;
    if (target === 'image' && isImageLike(layer)) {
      const imageTransform = getImageTransform(layer);
      const layerTransform = resolveLayerTransform(layer);
      updateImageTransform(layer.id, {
        ...imageTransform,
        x:
          axis === 'left'
            ? 0
            : axis === 'right'
              ? layerTransform.width - imageTransform.width
              : axis === 'horizontal' || axis === 'both'
                ? (layerTransform.width - imageTransform.width) / 2
                : imageTransform.x,
        y:
          axis === 'top'
            ? 0
            : axis === 'bottom'
              ? layerTransform.height - imageTransform.height
              : axis === 'vertical' || axis === 'both'
                ? (layerTransform.height - imageTransform.height) / 2
                : imageTransform.y,
      });
      setSelectedId(layer.id);
      setSelectedTarget('image');
      return;
    }
    const transform = resolveLayerTransform(layer);
    // Reference rectangle the object aligns to. 'card' = full card box (canonical center); 'cutline'/'safe' inset
    // symmetrically so users can align/center to the cut boundary or safe area. Default 'card' keeps prior behaviour.
    const refInset =
      alignRef === 'cutline'
        ? cuttingLineInsetFromCardPx(canvasSettings)
        : alignRef === 'safe'
          ? safeMarginInsetFromCardPx(canvasSettings)
          : 0;
    const refRect = {
      x: refInset,
      y: refInset,
      width: Math.max(0, canvasSettings.width - refInset * 2),
      height: Math.max(0, canvasSettings.height - refInset * 2),
    };
    applyTransform(layer.id, {
      ...transform,
      x:
        axis === 'left'
          ? refRect.x
          : axis === 'right'
            ? refRect.x + refRect.width - transform.width
            : axis === 'horizontal' || axis === 'both'
              ? refRect.x + (refRect.width - transform.width) / 2
              : transform.x,
      y:
        axis === 'top'
          ? refRect.y
          : axis === 'bottom'
            ? refRect.y + refRect.height - transform.height
            : axis === 'vertical' || axis === 'both'
              ? refRect.y + (refRect.height - transform.height) / 2
              : transform.y,
    });
    setSelectedId(layer.id);
    setSelectedTarget('layer');
  }

  function resizeSelectedObjectFromCenter(event: { shiftKey?: boolean; altKey?: boolean }, direction: 1 | -1) {
    const edgeDeltaPx = event.shiftKey ? 10 : event.altKey ? 0.5 : 1;
    return edgeDeltaPx * direction;
  }

  function centerResizeDeltaPx(modifiers: { shiftKey?: boolean; altKey?: boolean }, direction: 1 | -1) {
    return resizeSelectedObjectFromCenter(modifiers, direction);
  }

  function resizeLayerObjectFromCenter(layer: TemplateLayer, target: 'layer' | 'image', modifiers: { shiftKey?: boolean; altKey?: boolean }, direction: 1 | -1) {
    if (layer.locked) return;
    const effectiveTarget = target === 'image' && imageTransformMode(layer) === 'separate' ? 'image' : 'layer';
    const deltaPx = centerResizeDeltaPx(modifiers, direction);
    if (effectiveTarget === 'image' && isImageLike(layer)) {
      const imageTransform = getImageTransform(layer);
      const resized = resizeRectFromCenterPreserveAspect(imageTransform, deltaPx, imageTransformLimits.minWidth, imageTransformLimits.minHeight);
      updateImageTransform(layer.id, { ...imageTransform, ...resized });
      setSelectedId(layer.id);
      setSelectedTarget('image');
      return;
    }
    const transform = resolveLayerTransform(layer);
    const limits = isShapeLayer(layer)
      ? { minWidth: minShapeSizePx, minHeight: minShapeSizePx, maxWidth: layerTransformLimits.maxWidth, maxHeight: layerTransformLimits.maxHeight }
      : layerTransformLimits;
    applyTransform(layer.id, { ...transform, ...resizeRectFromCenterPreserveAspect(transform, deltaPx, limits.minWidth, limits.minHeight) });
    setSelectedId(layer.id);
    setSelectedTarget('layer');
  }

  type MultiAlignAxis = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

  // Align every multi-selected layer to the selection's bounding box (left/center/right, top/middle/bottom).
  function alignMultiSelection(axis: MultiAlignAxis) {
    const items = multiSelectedLayers.map((layer) => ({ layer, t: resolveLayerTransform(layer) }));
    if (items.length < 2) return;
    const minX = Math.min(...items.map((i) => i.t.x));
    const minY = Math.min(...items.map((i) => i.t.y));
    const maxR = Math.max(...items.map((i) => i.t.x + i.t.width));
    const maxB = Math.max(...items.map((i) => i.t.y + i.t.height));
    const centerX = (minX + maxR) / 2;
    const centerY = (minY + maxB) / 2;
    items.forEach(({ layer, t }) => {
      const next = { ...t };
      if (axis === 'left') next.x = minX;
      else if (axis === 'right') next.x = maxR - t.width;
      else if (axis === 'hcenter') next.x = centerX - t.width / 2;
      else if (axis === 'top') next.y = minY;
      else if (axis === 'bottom') next.y = maxB - t.height;
      else if (axis === 'vcenter') next.y = centerY - t.height / 2;
      applyTransform(layer.id, next);
    });
  }

  // Evenly distribute the selected layers' centers between the two outermost on the given axis (needs 3+).
  function distributeMultiSelection(axis: 'h' | 'v') {
    const items = multiSelectedLayers.map((layer) => ({ layer, t: resolveLayerTransform(layer) }));
    if (items.length < 3) return;
    const centerOf = (t: LayerTransform) => (axis === 'h' ? t.x + t.width / 2 : t.y + t.height / 2);
    const sorted = [...items].sort((a, b) => centerOf(a.t) - centerOf(b.t));
    const first = centerOf(sorted[0].t);
    const last = centerOf(sorted[sorted.length - 1].t);
    const step = (last - first) / (sorted.length - 1);
    sorted.forEach(({ layer, t }, index) => {
      if (index === 0 || index === sorted.length - 1) return;
      const targetCenter = first + step * index;
      const next = { ...t };
      if (axis === 'h') next.x = targetCenter - t.width / 2;
      else next.y = targetCenter - t.height / 2;
      applyTransform(layer.id, next);
    });
  }

  function renderAlignmentControls(layer: TemplateLayer, target: 'layer' | 'image') {
    const effectiveTarget = target === 'image' && imageTransformMode(layer) === 'separate' ? 'image' : 'layer';
    const buttons: Array<{ key: Parameters<typeof alignLayerObject>[2]; title: string; icon: ReactNode }> = [
      { key: 'horizontal', title: '가로 중앙 정렬', icon: <AlignCenterVertical className="h-4 w-4" /> },
      { key: 'vertical', title: '세로 중앙 정렬', icon: <AlignCenterHorizontal className="h-4 w-4" /> },
      { key: 'both', title: '가운데 정렬', icon: <Crosshair className="h-4 w-4" /> },
      { key: 'left', title: '좌측 정렬', icon: <AlignStartVertical className="h-4 w-4" /> },
      { key: 'right', title: '우측 정렬', icon: <AlignEndVertical className="h-4 w-4" /> },
      { key: 'top', title: '상단 정렬', icon: <AlignStartHorizontal className="h-4 w-4" /> },
      { key: 'bottom', title: '하단 정렬', icon: <AlignEndHorizontal className="h-4 w-4" /> },
    ];
    return (
      <div className="flex flex-wrap items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
        {effectiveTarget === 'layer' && (
          <label className="mr-1 inline-flex items-center gap-1 text-xs text-neutral-600" title="정렬·가운데의 기준 영역">
            <span>기준</span>
            <select
              value={alignRef}
              onChange={(event) => setAlignRef(event.target.value as 'card' | 'cutline' | 'safe')}
              className="rounded border border-line bg-white px-1.5 py-1 text-xs"
            >
              <option value="card">카드</option>
              <option value="cutline">컷라인</option>
              <option value="safe">세이프</option>
            </select>
          </label>
        )}
        {buttons.map((button) => (
          <button
            key={button.key}
            type="button"
            disabled={layer.locked}
            title={button.title}
            aria-label={button.title}
            onClick={() => alignLayerObject(layer, effectiveTarget, button.key)}
            className="rounded border border-line bg-white p-1.5 text-neutral-700 hover:bg-blue-50 disabled:opacity-30"
          >
            {button.icon}
          </button>
        ))}
      </div>
    );
  }

  function renderLayerEffectEditor(layer: TemplateLayer) {
    const effects = getLayerEffects(layer);
    const options = isShapeLayer(layer) ? shapeLayerEffectOptions : imageLayerEffectOptions;
    return (
      <>
        <div className={`flex min-w-0 items-center gap-2 rounded-md border px-2 py-1 ${childAccentClasses.effect}`}>
          <span className="font-semibold">효과</span>
          <span className="min-w-0 flex-1 truncate" title={layerEffectSummary(layer)}>{layerEffectSummary(layer)}</span>
          <select
            disabled={layer.locked}
            defaultValue=""
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              const type = event.target.value as LayerEffectType;
              if (type) addLayerEffect(layer, type);
              event.currentTarget.value = '';
            }}
            className="h-7 w-24 rounded border border-line bg-white px-1 text-[11px]"
            title="효과 추가"
          >
            <option value="">추가</option>
            {options.map((type) => (
              <option key={type} value={type}>{layerEffectLabels[type]}</option>
            ))}
          </select>
        </div>
        {effects.map((effect) => {
          const bounds = effectAmountBounds(effect.type);
          const amountValue = Number(effect.settings.amount ?? (effect.type === 'opacity' ? 90 : 100));
          const radiusValue = Number(effect.settings.radius ?? 0);
          const usesRadius = effect.type === 'blur' || effect.type === 'dropShadow' || effect.type === 'glow' || effect.type === 'outline';
          const usesColor = effect.type === 'dropShadow' || effect.type === 'glow' || effect.type === 'outline';
          return (
            <div key={effect.id} className="flex flex-wrap items-center gap-1.5 rounded-md border border-[#00E5FF]/20 bg-white px-2 py-1 text-[11px]" onClick={(event) => event.stopPropagation()}>
              <label className="inline-flex items-center gap-1 font-semibold text-neutral-700">
                <input
                  type="checkbox"
                  checked={effect.enabled}
                  disabled={layer.locked}
                  onChange={(event) => updateLayerEffect(layer, effect.id, { enabled: event.target.checked })}
                />
                {layerEffectLabels[effect.type]}
              </label>
              {usesRadius ? (
                <LayerMiniNumberInput
                  label="반경"
                  value={radiusValue}
                  min={0}
                  max={40}
                  disabled={layer.locked}
                  onChange={(value) => updateLayerEffect(layer, effect.id, { settings: { radius: value } })}
                />
              ) : (
                <LayerMiniNumberInput
                  label={bounds.unit}
                  value={amountValue}
                  min={bounds.min}
                  max={bounds.max}
                  step={bounds.step}
                  disabled={layer.locked}
                  onChange={(value) => updateLayerEffect(layer, effect.id, { settings: { amount: value } })}
                />
              )}
              {effect.type === 'dropShadow' && (
                <>
                  <LayerMiniNumberInput label="X" value={Number(effect.settings.offsetX ?? 2)} min={-40} max={40} disabled={layer.locked} onChange={(value) => updateLayerEffect(layer, effect.id, { settings: { offsetX: value } })} />
                  <LayerMiniNumberInput label="Y" value={Number(effect.settings.offsetY ?? 3)} min={-40} max={40} disabled={layer.locked} onChange={(value) => updateLayerEffect(layer, effect.id, { settings: { offsetY: value } })} />
                  <LayerMiniNumberInput label="불투명" value={Number(effect.settings.opacity ?? 60)} min={0} max={100} disabled={layer.locked} onChange={(value) => updateLayerEffect(layer, effect.id, { settings: { opacity: value } })} />
                </>
              )}
              {effect.type === 'glow' && (
                <LayerMiniNumberInput label="강도" value={Number(effect.settings.amount ?? 80)} min={0} max={200} disabled={layer.locked} onChange={(value) => updateLayerEffect(layer, effect.id, { settings: { amount: value } })} />
              )}
              {effect.type === 'outline' && (
                <LayerMiniNumberInput label="두께" value={Number(effect.settings.thickness ?? effect.settings.radius ?? 1)} min={0} max={24} step={0.5} disabled={layer.locked} onChange={(value) => updateLayerEffect(layer, effect.id, { settings: { thickness: value, radius: value } })} />
              )}
              {effect.type === 'scanline' && (
                <>
                  <LayerMiniNumberInput label="간격" value={Number(effect.settings.spacing ?? 4)} min={1} max={24} disabled={layer.locked} onChange={(value) => updateLayerEffect(layer, effect.id, { settings: { spacing: value } })} />
                  <LayerMiniNumberInput label="두께" value={Number(effect.settings.thickness ?? 1)} min={0.25} max={8} step={0.25} disabled={layer.locked} onChange={(value) => updateLayerEffect(layer, effect.id, { settings: { thickness: value } })} />
                  <LayerMiniNumberInput label="불투명" value={Number(effect.settings.opacity ?? effect.settings.amount ?? 24)} min={0} max={100} disabled={layer.locked} onChange={(value) => updateLayerEffect(layer, effect.id, { settings: { opacity: value, amount: value } })} />
                </>
              )}
              {effect.type === 'noise' && (
                <LayerMiniNumberInput label="불투명" value={Number(effect.settings.opacity ?? effect.settings.amount ?? 18)} min={0} max={100} disabled={layer.locked} onChange={(value) => updateLayerEffect(layer, effect.id, { settings: { opacity: value, amount: value } })} />
              )}
              {effect.type === 'vignette' && (
                <LayerMiniNumberInput label="반경" value={Number(effect.settings.radius ?? 36)} min={0} max={120} disabled={layer.locked} onChange={(value) => updateLayerEffect(layer, effect.id, { settings: { radius: value } })} />
              )}
              {usesColor && (
                <ColorSelector
                  {...colorSelectorLiveProps}
                  compact
                  label="효과 색상"
                  value={String(effect.settings.color ?? '#000000')}
                  disabled={layer.locked}
                  onChange={(color) => updateLayerEffect(layer, effect.id, { settings: { color } })}
                />
              )}
              <button
                type="button"
                disabled={layer.locked}
                onClick={() => removeLayerEffect(layer, effect.id)}
                className="ml-auto rounded border border-red-200 bg-white px-1.5 py-0.5 font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
              >
                삭제
              </button>
            </div>
          );
        })}
      </>
    );
  }

  function renderImageInlineProperties(layer: TemplateLayer) {
    const mode = imageTransformMode(layer);
    const imageTransform = getImageTransform(layer);
    const layerFrame = resolveLayerTransform(layer);
    const activeTransform = mode === 'separate' ? imageTransform : layerFrame;
    const scalePercent = layerFrame.width > 0 ? (imageTransform.width / layerFrame.width) * 100 : 100;
    const resizeTarget = mode === 'separate' ? 'image' : 'layer';
    return (
      <div className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1 ${childAccentClasses.transform}`} onClick={(event) => event.stopPropagation()}>
        <span className="font-semibold">{mode === 'linked' ? '슬롯/이미지 함께 조정' : '이미지 따로 조정'}</span>
        <span className="inline-flex items-center gap-1 rounded bg-white/70 px-1.5 py-0.5">
          <span className="text-[10px] font-semibold text-neutral-500">위치</span>
          <LayerMiniNumberInput
            label="X"
            value={canvasXToCenteredMm((mode === 'separate' ? layerFrame.x : 0) + activeTransform.x + activeTransform.width / 2, canvasSettings)}
            step={0.1}
            disabled={layer.locked}
            onChange={(nextValue) => (mode === 'separate' ? setImageTransformAbsoluteCenterMm(layer, 'x', nextValue) : setLayerFrameCenterMm(layer, 'x', nextValue))}
          />
          <LayerMiniNumberInput
            label="Y"
            value={canvasYToCenteredMm((mode === 'separate' ? layerFrame.y : 0) + activeTransform.y + activeTransform.height / 2, canvasSettings)}
            step={0.1}
            disabled={layer.locked}
            onChange={(nextValue) => (mode === 'separate' ? setImageTransformAbsoluteCenterMm(layer, 'y', nextValue) : setLayerFrameCenterMm(layer, 'y', nextValue))}
          />
        </span>
        <span className="h-6 w-px bg-[#B000FF]/20" />
        <span className="inline-flex items-center gap-1 rounded bg-white/70 px-1.5 py-0.5">
          <span className="text-[10px] font-semibold text-neutral-500">크기</span>
          <LayerMiniNumberInput label="W" value={activeTransform.width} min={mode === 'separate' ? imageTransformLimits.minWidth : layerTransformLimits.minWidth} max={mode === 'separate' ? imageTransformLimits.maxWidth : layerTransformLimits.maxWidth} disabled={layer.locked} onChange={(value) => (mode === 'separate' ? setImageTransformSize(layer, 'width', value) : setLayerFrameSize(layer, 'width', value))} />
          <LayerMiniNumberInput label="H" value={activeTransform.height} min={mode === 'separate' ? imageTransformLimits.minHeight : layerTransformLimits.minHeight} max={mode === 'separate' ? imageTransformLimits.maxHeight : layerTransformLimits.maxHeight} disabled={layer.locked} onChange={(value) => (mode === 'separate' ? setImageTransformSize(layer, 'height', value) : setLayerFrameSize(layer, 'height', value))} />
        </span>
        <span className="h-6 w-px bg-[#B000FF]/20" />
        <span className="inline-flex items-center gap-1 rounded bg-white/70 px-1.5 py-0.5">
          <span className="text-[10px] font-semibold text-neutral-500">변형</span>
          <LayerMiniNumberInput label="회전" value={activeTransform.rotation ?? 0} min={-360} max={360} disabled={layer.locked} onChange={(value) => (mode === 'separate' ? updateImageTransform(layer.id, { ...imageTransform, rotation: value }) : applyTransform(layer.id, { ...layerFrame, rotation: value }))} />
          {mode === 'separate' && (
            <LayerMiniNumberInput
              label="배율"
              value={scalePercent}
              min={5}
              max={600}
              disabled={layer.locked}
              onChange={(value) => {
                const nextWidth = layerFrame.width * (value / 100);
                const aspect = imageTransform.width > 0 ? imageTransform.height / imageTransform.width : 1;
                updateImageTransform(layer.id, resizeLayerToSizeFromTopLeft(imageTransform, { width: nextWidth, height: nextWidth * aspect }, imageTransformLimits));
              }}
            />
          )}
        </span>
        <span className="h-6 w-px bg-[#B000FF]/20" />
        <span className="inline-flex items-center gap-1 rounded bg-white/70 px-1.5 py-0.5">
          <span className="text-[10px] font-semibold text-neutral-500">중앙</span>
          <button type="button" disabled={layer.locked} {...centerResizeButtonHandlers(layer, resizeTarget, -1)} className="rounded border border-line bg-white px-2 py-1 font-medium hover:bg-blue-50 disabled:opacity-30" title="가운데 기준으로 사방을 1px씩 줄입니다. Shift: 10px, Alt: 0.5px">
            중앙 축소
          </button>
          <button type="button" disabled={layer.locked} {...centerResizeButtonHandlers(layer, resizeTarget, 1)} className="rounded border border-line bg-white px-2 py-1 font-medium hover:bg-blue-50 disabled:opacity-30" title="가운데 기준으로 사방을 1px씩 키웁니다. Shift: 10px, Alt: 0.5px">
            중앙 확대
          </button>
        </span>
      </div>
    );
  }

  function renderImageCropControls(layer: TemplateLayer) {
    const transform = getImageTransform(layer);
    const naturalSize = imageNaturalSizeForLayer(layer);
    const cropMaxWidth = Math.max(0, Number(naturalSize.width ?? 0) - 1);
    const cropMaxHeight = Math.max(0, Number(naturalSize.height ?? 0) - 1);
    const currentFitMode = (layer.imageFitMode ?? layer.data?.imageFitMode ?? defaultFitModeForSlot(layer.slotType)) as ImageFitMode;
    function applyFitMode(fitMode: ImageFitMode) {
      if (layer.locked) return;
      const layerFrame = resolveLayerTransform(layer);
      const imageSize = {
        width: Number(layer.data?.imageNaturalWidth ?? layer.width ?? 1),
        height: Number(layer.data?.imageNaturalHeight ?? layer.height ?? 1),
      };
      updateLayer(layer.id, {
        imageFitMode: fitMode,
        data: {
          ...layer.data,
          imageFitMode: fitMode,
          imageTransformMode: 'separate',
          imageTransform: fitImageToBounds(fitMode, imageSize, layerFrame),
        },
      });
      setSelectedId(layer.id);
      setSelectedTarget('image');
    }
    return (
      <div className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1 ${childAccentClasses.crop}`} onClick={(event) => event.stopPropagation()}>
        <span className="font-semibold">자르기</span>
        <LayerMiniNumberInput label="상" value={transform.cropTop ?? 0} min={0} max={cropMaxHeight} disabled={layer.locked || !hasNaturalImageSize(naturalSize)} onChange={(value) => setLayerImageCrop(layer, 'cropTop', value)} />
        <LayerMiniNumberInput label="우" value={transform.cropRight ?? 0} min={0} max={cropMaxWidth} disabled={layer.locked || !hasNaturalImageSize(naturalSize)} onChange={(value) => setLayerImageCrop(layer, 'cropRight', value)} />
        <LayerMiniNumberInput label="하" value={transform.cropBottom ?? 0} min={0} max={cropMaxHeight} disabled={layer.locked || !hasNaturalImageSize(naturalSize)} onChange={(value) => setLayerImageCrop(layer, 'cropBottom', value)} />
        <LayerMiniNumberInput label="좌" value={transform.cropLeft ?? 0} min={0} max={cropMaxWidth} disabled={layer.locked || !hasNaturalImageSize(naturalSize)} onChange={(value) => setLayerImageCrop(layer, 'cropLeft', value)} />
        <button type="button" disabled={layer.locked} onClick={() => resetLayerImageCrop(layer)} className="rounded border border-line bg-white px-2 py-0.5 font-medium hover:bg-blue-50 disabled:opacity-30">
          자르기 초기화
        </button>
        <select
          value={currentFitMode}
          disabled={layer.locked}
          onChange={(event) => applyFitMode(event.target.value as ImageFitMode)}
          className="h-7 w-24 rounded border border-line bg-white px-1 text-[11px]"
          title="맞춤 방식을 바꾸면 이미지 따로 조정 모드로 전환됩니다."
        >
          {Object.entries(imageFitModeLabels).map(([value, labelText]) => (
            <option key={value} value={value}>{labelText}</option>
          ))}
        </select>
      </div>
    );
  }

  function renderShapeInlineProperties(layer: TemplateLayer) {
    const transform = resolveLayerTransform(layer);
    const activeTransform = transform;
    return (
      <div className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1 ${childAccentClasses.transform}`} onClick={(event) => event.stopPropagation()}>
        <span className="font-semibold">속성</span>
        <span className="inline-flex items-center gap-1 rounded bg-white/70 px-1.5 py-0.5">
          <span className="text-[10px] font-semibold text-neutral-500">위치</span>
          <LayerMiniNumberInput label="X" value={canvasXToCenteredMm(activeTransform.x + activeTransform.width / 2, canvasSettings)} step={0.1} disabled={layer.locked} onChange={(nextValue) => setLayerFrameCenterMm(layer, 'x', nextValue)} />
          <LayerMiniNumberInput label="Y" value={canvasYToCenteredMm(activeTransform.y + activeTransform.height / 2, canvasSettings)} step={0.1} disabled={layer.locked} onChange={(nextValue) => setLayerFrameCenterMm(layer, 'y', nextValue)} />
        </span>
        <span className="h-6 w-px bg-[#B000FF]/20" />
        <span className="inline-flex items-center gap-1 rounded bg-white/70 px-1.5 py-0.5">
          <span className="text-[10px] font-semibold text-neutral-500">크기</span>
          <LayerMiniNumberInput label="W" value={transform.width} min={minShapeSizePx} max={layerTransformLimits.maxWidth} disabled={layer.locked} onChange={(value) => setLayerFrameSize(layer, 'width', value)} />
          <LayerMiniNumberInput label="H" value={transform.height} min={minShapeSizePx} max={layerTransformLimits.maxHeight} disabled={layer.locked} onChange={(value) => setLayerFrameSize(layer, 'height', value)} />
        </span>
        <span className="h-6 w-px bg-[#B000FF]/20" />
        <span className="inline-flex items-center gap-1 rounded bg-white/70 px-1.5 py-0.5">
          <span className="text-[10px] font-semibold text-neutral-500">변형</span>
          <LayerMiniNumberInput label="회전" value={transform.rotation ?? 0} min={-360} max={360} disabled={layer.locked} onChange={(value) => applyTransform(layer.id, { ...transform, rotation: value })} />
        </span>
        <span className="h-6 w-px bg-[#B000FF]/20" />
        <span className="inline-flex items-center gap-1 rounded bg-white/70 px-1.5 py-0.5">
          <span className="text-[10px] font-semibold text-neutral-500">중앙</span>
          <button type="button" disabled={layer.locked} {...centerResizeButtonHandlers(layer, 'layer', -1)} className="rounded border border-line bg-white px-2 py-1 font-medium hover:bg-blue-50 disabled:opacity-30" title="가운데 기준으로 사방을 1px씩 줄입니다. Shift: 10px, Alt: 0.5px">
            중앙 축소
          </button>
          <button type="button" disabled={layer.locked} {...centerResizeButtonHandlers(layer, 'layer', 1)} className="rounded border border-line bg-white px-2 py-1 font-medium hover:bg-blue-50 disabled:opacity-30" title="가운데 기준으로 사방을 1px씩 키웁니다. Shift: 10px, Alt: 0.5px">
            중앙 확대
          </button>
        </span>
      </div>
    );
  }

  function renderShapeRadiusControls(layer: TemplateLayer) {
    const radii = shapeCornerRadiiMm(layer);
    const radiusLinked = layer.data?.cornerRadiusLinked !== false;
    const supportsRadius = shapeSupportsCornerRadius(layer);
    return (
      <div className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1 ${childAccentClasses.transform}`} onClick={(event) => event.stopPropagation()}>
        <span className="font-semibold">모서리</span>
        <LayerMiniNumberInput
          label="전체 R"
          value={layerCornerRadiusMm(layer, canvasSettings)}
          min={0}
          step={0.1}
          disabled={layer.locked || !supportsRadius}
          onChange={(value) => updateShapeUniformRadius(layer, value)}
        />
        {supportsRadius && (
          <button
            type="button"
            disabled={layer.locked}
            onClick={() => setShapeRadiusLinked(layer, !radiusLinked)}
            className={`h-7 rounded border px-1.5 text-[10px] font-semibold ${radiusLinked ? 'border-primary bg-blue-50 text-primary' : 'border-line bg-white text-neutral-600'} disabled:opacity-40`}
            title={radiusLinked ? '전체 R 연동 중' : '각 모서리 개별 편집 중'}
          >
            {radiusLinked ? '전체 R' : '개별 R'}
          </button>
        )}
        {supportsRadius && !radiusLinked && (
          <span className="inline-flex flex-wrap items-center gap-1">
            {(Object.keys(radiusCornerLabels) as RadiusCornerKey[]).map((corner) => (
              <LayerMiniNumberInput
                key={corner}
                label={radiusCornerLabels[corner]}
                value={radii[corner]}
                min={0}
                step={0.1}
                disabled={layer.locked}
                onChange={(value) => updateShapeCornerRadius(layer, corner, value)}
              />
            ))}
          </span>
        )}
        {!supportsRadius && <span className="text-[11px] text-neutral-500">이 도형은 모서리 R을 사용하지 않습니다.</span>}
        {supportsRadius && <span className="basis-full text-[10px] text-neutral-500">표시는 도형 크기에 맞춰 자동 보정됩니다.</span>}
      </div>
    );
  }

  function renderSlotRadiusControls(layer: TemplateLayer) {
    const radii = normalizeCornerRadiiMm(layer, canvasSettings);
    const radiusLinked = layer.data?.cornerRadiusLinked !== false;
    return (
      <div className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1 ${childAccentClasses.transform}`} onClick={(event) => event.stopPropagation()}>
        <span className="font-semibold">모서리</span>
        <LayerMiniNumberInput
          label="전체 R"
          value={layerCornerRadiusMm(layer, canvasSettings)}
          min={0}
          step={0.1}
          disabled={layer.locked}
          onChange={(value) => updateLayerUniformRadius(layer, value)}
        />
        <button
          type="button"
          disabled={layer.locked}
          onClick={() => setLayerRadiusLinked(layer, !radiusLinked)}
          className={`h-7 rounded border px-1.5 text-[10px] font-semibold ${radiusLinked ? 'border-primary bg-blue-50 text-primary' : 'border-line bg-white text-neutral-600'} disabled:opacity-40`}
          title={radiusLinked ? '전체 R 연동 중' : '각 모서리 개별 편집 중'}
        >
          {radiusLinked ? '전체 R' : '개별 R'}
        </button>
        {!radiusLinked && (
          <span className="inline-flex flex-wrap items-center gap-1">
            {(Object.keys(radiusCornerLabels) as RadiusCornerKey[]).map((corner) => (
              <LayerMiniNumberInput
                key={corner}
                label={radiusCornerLabels[corner]}
                value={radii[corner]}
                min={0}
                step={0.1}
                disabled={layer.locked}
                onChange={(value) => updateLayerCornerRadius(layer, corner, value)}
              />
            ))}
          </span>
        )}
        <span className="basis-full text-[10px] text-neutral-500">슬롯 프레임과 기본 이미지 마스크에 적용됩니다. 표시는 크기에 맞춰 자동 보정됩니다.</span>
      </div>
    );
  }

  function renderImageRadiusControls(layer: TemplateLayer, hasImage: boolean) {
    if (!hasImage) {
      return (
        <div className={`rounded-md border px-2 py-1 text-[11px] ${childAccentClasses.crop}`} onClick={(event) => event.stopPropagation()}>
          이미지를 추가하면 이미지 모서리를 설정할 수 있습니다.
        </div>
      );
    }
    const inheritsSlot = imageCornerRadiusInheritsSlot(layer);
    const radiusLinked = layer.data?.imageCornerRadiusLinked !== false;
    const radii = ownImageCornerRadiiMm(layer);
    const uniformValue = Number(layer.data?.imageCornerRadiusMm ?? radii.topLeft);
    return (
      <div className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1 ${childAccentClasses.crop}`} onClick={(event) => event.stopPropagation()}>
        <span className="font-semibold">이미지 모서리</span>
        <button
          type="button"
          disabled={layer.locked}
          onClick={() => setImageCornerRadiusInheritSlot(layer, !inheritsSlot)}
          className={`h-7 rounded border px-1.5 text-[10px] font-semibold ${inheritsSlot ? 'border-primary bg-blue-50 text-primary' : 'border-line bg-white text-neutral-600'} disabled:opacity-40`}
          title={inheritsSlot ? '슬롯 R을 이미지 마스크에 사용합니다.' : '이미지 전용 R 값을 사용합니다.'}
        >
          슬롯 R 사용
        </button>
        {inheritsSlot ? (
          <span className="text-[11px] text-neutral-500">이미지가 슬롯 모서리 값을 따릅니다.</span>
        ) : (
          <>
            <LayerMiniNumberInput
              label="전체 R"
              value={uniformValue}
              min={0}
              step={0.1}
              disabled={layer.locked}
              onChange={(value) => updateImageUniformRadius(layer, value)}
            />
            <button
              type="button"
              disabled={layer.locked}
              onClick={() => setImageRadiusLinked(layer, !radiusLinked)}
              className={`h-7 rounded border px-1.5 text-[10px] font-semibold ${radiusLinked ? 'border-primary bg-blue-50 text-primary' : 'border-line bg-white text-neutral-600'} disabled:opacity-40`}
              title={radiusLinked ? '전체 R 연동 중' : '각 모서리 개별 편집 중'}
            >
              {radiusLinked ? '전체 R' : '개별 R'}
            </button>
            {!radiusLinked && (
              <span className="inline-flex flex-wrap items-center gap-1">
                {(Object.keys(radiusCornerLabels) as RadiusCornerKey[]).map((corner) => (
                  <LayerMiniNumberInput
                    key={corner}
                    label={radiusCornerLabels[corner]}
                    value={radii[corner]}
                    min={0}
                    step={0.1}
                    disabled={layer.locked}
                    onChange={(value) => updateImageCornerRadius(layer, corner, value)}
                  />
                ))}
              </span>
            )}
          </>
        )}
        <span className="basis-full text-[10px] text-neutral-500">입력값은 그대로 저장하고, 표시는 이미지 크기에 맞춰 자동 보정됩니다.</span>
      </div>
    );
  }

  function renderImageLayerDetails(layer: TemplateLayer, hasImage: boolean) {
    const mode = imageTransformMode(layer);
    return (
      <div className="space-y-1">
        <LayerDetailGroup title="이미지" open={isDetailGroupOpen(layer.id, 'image')} accentClass={childAccentClasses.image} onToggle={() => toggleDetailGroup(layer.id, 'image')}>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <LayerChildThumbnail layer={layer} canvas={canvasSettings} />
            <span className="min-w-0 flex-1 truncate" title={hasImage ? String(layer.data?.imageName ?? '선택된 이미지') : '이미지 없음'}>
              {hasImage ? String(layer.data?.imageName ?? '선택된 이미지') : '이미지 없음'}
            </span>
            <select
              value={migrateSlotType(layer.slotType)}
              disabled={layer.locked}
              title="슬롯 타입"
              onChange={(event) => setLayerSlotType(layer, event.target.value as TemplateSlotType)}
              className="h-7 w-24 rounded border border-line bg-white px-1 text-[11px]"
            >
              {activeSlotTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button type="button" disabled={layer.locked} onClick={() => openAssetPickerForLayer(layer.id)} className="rounded border border-line bg-white px-2 py-1 font-medium hover:bg-blue-50 disabled:opacity-30">
              선택
            </button>
            <button type="button" disabled={layer.locked || !hasImage} onClick={() => removeLayerImage(layer)} className="rounded border border-line bg-white px-2 py-1 font-medium hover:bg-red-50 disabled:opacity-30">
              제거
            </button>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 rounded bg-white/70 px-2 py-1">
            <span className="text-[10px] font-semibold text-neutral-500">조정 방식</span>
            <button
              type="button"
              disabled={layer.locked}
              title="슬롯/이미지 함께 조정"
              onClick={() => setLayerImageTransformMode(layer, 'linked')}
              className={`rounded border px-2 py-1 text-[11px] font-semibold ${mode === 'linked' ? 'border-primary bg-blue-50 text-primary' : 'border-line bg-white text-neutral-600'}`}
            >
              슬롯/이미지 함께 조정
            </button>
            <button
              type="button"
              disabled={layer.locked || !hasImage}
              title="이미지 따로 조정"
              onClick={() => setLayerImageTransformMode(layer, 'separate')}
              className={`rounded border px-2 py-1 text-[11px] font-semibold ${mode === 'separate' ? 'border-primary bg-blue-50 text-primary' : 'border-line bg-white text-neutral-600'}`}
            >
              이미지 따로 조정
            </button>
          </div>
        </LayerDetailGroup>
        <LayerDetailGroup title="위치 / 크기" open={isDetailGroupOpen(layer.id, 'position')} accentClass={childAccentClasses.transform} onToggle={() => toggleDetailGroup(layer.id, 'position')}>
          {renderImageInlineProperties(layer)}
        </LayerDetailGroup>
        <LayerDetailGroup title="모서리" open={isDetailGroupOpen(layer.id, 'radius')} accentClass={childAccentClasses.transform} onToggle={() => toggleDetailGroup(layer.id, 'radius')}>
          {renderSlotRadiusControls(layer)}
        </LayerDetailGroup>
        <LayerDetailGroup title="정렬" open={isDetailGroupOpen(layer.id, 'align')} accentClass={childAccentClasses.transform} onToggle={() => toggleDetailGroup(layer.id, 'align')}>
          {renderAlignmentControls(layer, mode === 'separate' ? 'image' : 'layer')}
        </LayerDetailGroup>
        <LayerDetailGroup title="자르기" open={isDetailGroupOpen(layer.id, 'crop')} accentClass={childAccentClasses.crop} onToggle={() => toggleDetailGroup(layer.id, 'crop')}>
          {renderImageCropControls(layer)}
        </LayerDetailGroup>
        <LayerDetailGroup title="이미지 모서리" open={isDetailGroupOpen(layer.id, 'imageRadius')} accentClass={childAccentClasses.crop} onToggle={() => toggleDetailGroup(layer.id, 'imageRadius')}>
          {renderImageRadiusControls(layer, hasImage)}
        </LayerDetailGroup>
        <LayerDetailGroup title="효과" open={isDetailGroupOpen(layer.id, 'effects')} accentClass={childAccentClasses.effect} onToggle={() => toggleDetailGroup(layer.id, 'effects')}>
          {renderLayerEffectEditor(layer)}
        </LayerDetailGroup>
        <LayerDetailGroup title="고급" open={isDetailGroupOpen(layer.id, 'advanced')} accentClass="border-line bg-neutral-50 text-neutral-700" onToggle={() => toggleDetailGroup(layer.id, 'advanced')}>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" disabled={layer.locked} onClick={() => duplicateLayer(layer)} className="rounded border border-line bg-white px-2 py-1 font-medium hover:bg-blue-50 disabled:opacity-30">
              복제
            </button>
            <button type="button" disabled={layer.locked} onClick={() => deleteLayerWithConfirm(layer)} className="rounded border border-red-200 bg-white px-2 py-1 font-medium text-red-700 hover:bg-red-50 disabled:opacity-30">
              삭제
            </button>
          </div>
        </LayerDetailGroup>
      </div>
    );
  }

  function renderShapeLayerDetails(layer: TemplateLayer) {
    return (
      <div className="space-y-1">
        <LayerDetailGroup title="위치 / 크기" open={isDetailGroupOpen(layer.id, 'position')} accentClass={childAccentClasses.transform} onToggle={() => toggleDetailGroup(layer.id, 'position')}>
          {renderShapeInlineProperties(layer)}
        </LayerDetailGroup>
        <LayerDetailGroup title="모서리" open={isDetailGroupOpen(layer.id, 'radius')} accentClass={childAccentClasses.transform} onToggle={() => toggleDetailGroup(layer.id, 'radius')}>
          {renderShapeRadiusControls(layer)}
        </LayerDetailGroup>
        <LayerDetailGroup title="정렬" open={isDetailGroupOpen(layer.id, 'align')} accentClass={childAccentClasses.transform} onToggle={() => toggleDetailGroup(layer.id, 'align')}>
          {renderAlignmentControls(layer, 'layer')}
        </LayerDetailGroup>
        <LayerDetailGroup title="채우기" open={isDetailGroupOpen(layer.id, 'fill')} accentClass={childAccentClasses.fill} onToggle={() => toggleDetailGroup(layer.id, 'fill')}>
          <div className="flex min-w-0 items-center gap-2">
            <LayerChildThumbnail layer={layer} canvas={canvasSettings} />
            <span className="min-w-0 flex-1 truncate" title={fillTypeLabel(layer)}>{fillTypeLabel(layer)}</span>
            <ColorSelector
              {...colorSelectorLiveProps}
              label="채우기"
              compact
              disabled={layer.locked || shapeKind(layer) === 'line'}
              value={layer.fill ?? '#ffffff'}
              onChange={(color) => setShapeFillColor(layer, color)}
              allowTransparent
              transparentLabel="채우기 없음"
              transparent={layer.data?.fillNone === true}
              onTransparentChange={(transparent) => updateLayer(layer.id, { data: { ...layer.data, fillNone: transparent, fillStyle: transparent ? { type: 'none' } : { type: 'solid', color: layer.fill ?? '#ffffff' } } })}
              allowFillStyles
              fillStyle={layer.data?.fillStyle as TemplateFillStyle | undefined}
              onFillStyleChange={(fillStyleValue) => {
                const solidColor = fillStyleValue.type === 'solid'
                  ? fillStyleValue.color
                  : fillStyleValue.type === 'linearGradient' || fillStyleValue.type === 'radialGradient'
                    ? fillStyleValue.colors[0]
                    : layer.fill ?? '#ffffff';
                updateLayer(layer.id, {
                  fill: solidColor,
                  data: { ...layer.data, fillNone: fillStyleValue.type === 'none', fillStyle: fillStyleValue },
                });
              }}
            />
          </div>
        </LayerDetailGroup>
        <LayerDetailGroup title="선" open={isDetailGroupOpen(layer.id, 'stroke')} accentClass={childAccentClasses.stroke} onToggle={() => toggleDetailGroup(layer.id, 'stroke')}>
          <div className="flex min-w-0 items-center gap-2">
            <span
              title={`선: ${strokeStatusLabel(layer)}`}
              className={`h-7 w-7 shrink-0 rounded border border-neutral-300 ${templateShapeStrokeValue(layer) === 'transparent' ? 'image-thumb-frame' : ''}`}
              style={{ backgroundColor: templateShapeStrokeValue(layer) === 'transparent' ? undefined : templateShapeStrokeValue(layer) }}
            />
            <span className="min-w-0 flex-1 truncate" title={strokeStatusLabel(layer)}>{strokeStatusLabel(layer)}</span>
            <LayerMiniNumberInput label="두께" value={Number(layer.data?.strokeWidth ?? 2)} min={0} disabled={layer.locked} onChange={(value) => updateLayer(layer.id, { data: { ...layer.data, strokeWidth: value } })} />
            <span className="rounded bg-white px-1 text-[10px] text-neutral-500" title="출력 기준 선 두께">
              {templateShapeStrokeWidthMm(layer, canvasSettings).toFixed(2)}mm
            </span>
            <ColorSelector
              {...colorSelectorLiveProps}
              label="선"
              compact
              disabled={layer.locked}
              value={layer.stroke ?? '#111827'}
              onChange={(color) => updateLayer(layer.id, { stroke: color, data: { ...layer.data, strokeNone: false } })}
              allowTransparent
              transparentLabel="선 없음"
              transparentStyleType="noStroke"
              transparent={layer.data?.strokeNone === true}
              onTransparentChange={(transparent) => updateLayer(layer.id, { data: { ...layer.data, strokeNone: transparent } })}
            />
          </div>
        </LayerDetailGroup>
        <LayerDetailGroup title="효과" open={isDetailGroupOpen(layer.id, 'effects')} accentClass={childAccentClasses.effect} onToggle={() => toggleDetailGroup(layer.id, 'effects')}>
          {renderLayerEffectEditor(layer)}
        </LayerDetailGroup>
        <LayerDetailGroup title="고급" open={isDetailGroupOpen(layer.id, 'advanced')} accentClass="border-line bg-neutral-50 text-neutral-700" onToggle={() => toggleDetailGroup(layer.id, 'advanced')}>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" disabled={layer.locked} onClick={() => duplicateLayer(layer)} className="rounded border border-line bg-white px-2 py-1 font-medium hover:bg-blue-50 disabled:opacity-30">
              복제
            </button>
            <button type="button" disabled={layer.locked} onClick={() => deleteLayerWithConfirm(layer)} className="rounded border border-red-200 bg-white px-2 py-1 font-medium text-red-700 hover:bg-red-50 disabled:opacity-30">
              삭제
            </button>
          </div>
        </LayerDetailGroup>
      </div>
    );
  }

  const editingTemplate = editingTemplateId ? templates.find((template) => template.id === editingTemplateId) : undefined;
  const saveTemplateLabel = editingTemplate ? '템플릿 업데이트' : '새 템플릿 저장';
  const previewAssetIndex = previewAsset ? currentFolderAssets.findIndex((asset) => asset.id === previewAsset.id) : -1;
  const previousPreviewAsset = previewAssetIndex > 0 ? currentFolderAssets[previewAssetIndex - 1] : undefined;
  const nextPreviewAsset =
    previewAssetIndex >= 0 && previewAssetIndex < currentFolderAssets.length - 1 ? currentFolderAssets[previewAssetIndex + 1] : undefined;

  return (
    <div className="template-editor-page flex h-[calc(100dvh-5.5rem)] min-h-0 flex-col overflow-hidden">
      <div className="shrink-0">
        <PageHeader
        eyebrow="Template Editor"
        title="템플릿 편집기"
        description="카드 콘텐츠가 들어갈 고정 슬롯을 만들고, 컷팅 라인과 안전 여백을 확인하며 공유 가능한 앞면/뒷면 템플릿을 저장합니다."
        />
      </div>

      <section className="z-30 mb-3 shrink-0 rounded-lg border border-line bg-white/95 p-3 shadow-surface backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-neutral-950">{templateName || '이름 없는 템플릿'}</p>
            <p className="text-xs text-neutral-500">
              {templateType === 'front' ? '앞면' : '뒷면'} · {canvasSettings.orientation === 'landscape' ? '가로' : '세로'} ·{' '}
              {undoStack.length > 0 ? '저장되지 않은 변경 있음' : '초안 자동 저장됨'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={saveTemplate}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            >
              <Save className="h-4 w-4" />
              {saveTemplateLabel}
            </button>
            <button
              type="button"
              onClick={saveTemplateAsNew}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              <Save className="h-4 w-4" />
              다른 이름으로 저장
            </button>
          </div>
        </div>
        {saveMessage && (
          <p className="mt-2 rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">{saveMessage}</p>
        )}
      </section>

      <div
        ref={layoutRef}
        className="grid min-h-0 flex-1 items-stretch overflow-hidden"
        style={{
          gridTemplateColumns: `${renderedPanelLayout.leftPanelWidth}px ${panelResizeHandleWidth}px minmax(${centerWorkspaceMinWidth}px, 1fr) ${panelResizeHandleWidth}px ${renderedPanelLayout.rightPanelWidth}px`,
        }}
      >
        <section className="min-h-0 overflow-y-auto rounded-lg border border-line bg-white p-4 shadow-surface overscroll-contain">
          <label className="block text-sm">
            <span className="font-medium">템플릿 이름</span>
            <input
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              className="mt-1 w-full rounded-md border border-line px-2 py-2"
            />
          </label>
          <label className="mt-4 block text-sm">
            <span className="font-medium">템플릿 불러오기</span>
            <select
              value=""
              onChange={(event) => loadTemplate(event.target.value)}
              className="mt-1 w-full rounded-md border border-line px-2 py-2"
            >
              <option value="">선택...</option>
              {templates.filter((template) => !template.deletedAt).map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-4 block text-sm">
            <span className="font-medium">템플릿 면</span>
            <select
              value={templateType}
              onChange={(event) => setTemplateType(event.target.value as TemplateType)}
              className="mt-1 w-full rounded-md border border-line px-2 py-2"
            >
              <option value="front">앞면</option>
              <option value="back">뒷면</option>
            </select>
          </label>
          <div className="mt-4 text-sm">
            <span className="font-medium">방향</span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(['portrait', 'landscape'] as const).map((orientation) => (
                <button
                  key={orientation}
                  type="button"
                  onClick={() => setTemplateOrientation(orientation)}
                  className={`rounded-md border px-3 py-2 text-sm font-medium ${
                    canvasSettings.orientation === orientation ? 'border-primary bg-blue-50 text-primary' : 'border-line'
                  }`}
                >
                  {orientation === 'portrait' ? '세로' : '가로'}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-5 grid gap-2">
            <h3 className="text-sm font-semibold">추가</h3>
            <button
              type="button"
              onClick={addSlot}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium"
            >
              <Image className="h-4 w-4" />
              슬롯 추가
            </button>
            <div className="grid grid-cols-2 gap-2">
              {(['rectangle', 'roundedRectangle', 'ellipse', 'line'] as ShapeKind[]).map((shape) => (
                <button
                  key={shape}
                  type="button"
                  onClick={() => addShape(shape)}
                  className="rounded-md border border-line px-3 py-2 text-xs font-medium hover:bg-blue-50"
                >
                  {shapeKindLabels[shape]}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-md border border-line bg-white p-3 text-sm">
            <button
              type="button"
              className="flex w-full items-center gap-2 text-left font-semibold"
              aria-expanded={editorPrefs.rulerGridOpen}
              onClick={() => setEditorPrefs((current) => ({ ...current, rulerGridOpen: !current.rulerGridOpen }))}
            >
              <ChevronRight className={disclosureIconClass(editorPrefs.rulerGridOpen)} />
              <span>룰러 / 그리드</span>
            </button>
            {editorPrefs.rulerGridOpen && (
              <div className="mt-3 grid gap-3">
                <label className="inline-flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={editorPrefs.showRuler}
                    onChange={(event) => setEditorPrefs((current) => ({ ...current, showRuler: event.target.checked }))}
                  />
                  룰러 보기
                </label>
                <label className="inline-flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={editorPrefs.showGrid}
                    onChange={(event) => setEditorPrefs((current) => ({ ...current, showGrid: event.target.checked }))}
                  />
                  1mm 그리드 보기
                </label>
                <label className="inline-flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={editorPrefs.snapToGrid}
                    onChange={(event) => setEditorPrefs((current) => ({ ...current, snapToGrid: event.target.checked }))}
                  />
                  1mm / 중앙선 스냅
                </label>
                <label className="inline-flex items-center gap-2 text-sm font-medium" title="크기 조절 시 가로세로 비율 고정 (Shift로 일시 적용)">
                  <input
                    type="checkbox"
                    checked={editorPrefs.lockAspect}
                    onChange={(event) => setEditorPrefs((current) => ({ ...current, lockAspect: event.target.checked }))}
                  />
                  비율 고정(Shift)
                </label>
                <label className="grid gap-1">
                  <span className="font-medium">룰러 투명도 {editorPrefs.rulerOpacity}%</span>
                  <span className="flex items-center gap-2">
                    <input
                      type="range"
                      min="10"
                      max="100"
                      value={editorPrefs.rulerOpacity}
                      onChange={(event) => setEditorPrefs((current) => ({ ...current, rulerOpacity: Number(event.target.value) }))}
                      className="min-w-0 flex-1"
                    />
                    <input
                      type="number"
                      min="10"
                      max="100"
                      value={editorPrefs.rulerOpacity}
                      onChange={(event) => setEditorPrefs((current) => ({ ...current, rulerOpacity: clampNumber(Number(event.target.value), 10, 100) }))}
                      className="h-8 w-16 rounded border border-line bg-white px-1 text-right"
                    />
                  </span>
                </label>
                <label className="grid gap-1">
                  <span className="font-medium">그리드 투명도 {editorPrefs.gridOpacity}%</span>
                  <span className="flex items-center gap-2">
                    <input
                      type="range"
                      min="5"
                      max="80"
                      value={editorPrefs.gridOpacity}
                      onChange={(event) => setEditorPrefs((current) => ({ ...current, gridOpacity: Number(event.target.value) }))}
                      className="min-w-0 flex-1"
                    />
                    <input
                      type="number"
                      min="5"
                      max="80"
                      value={editorPrefs.gridOpacity}
                      onChange={(event) => setEditorPrefs((current) => ({ ...current, gridOpacity: clampNumber(Number(event.target.value), 5, 80) }))}
                      className="h-8 w-16 rounded border border-line bg-white px-1 text-right"
                    />
                  </span>
                </label>
              </div>
            )}
          </div>

          <div className="mt-4 rounded-md border border-line bg-neutral-50 p-3 text-sm">
            <button
              type="button"
              className="flex w-full items-center gap-2 text-left font-semibold"
              aria-expanded={cutMarginOpen}
              onClick={() => setCutMarginOpen((current) => !current)}
            >
              <ChevronRight className={disclosureIconClass(cutMarginOpen)} />
              <span>컷팅 / 마진</span>
            </button>
            {cutMarginOpen && (
            <div className="mt-3 grid gap-3">
              <label className="inline-flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={cutLineSettings.enabled}
                  onChange={(event) => updateCutLineSettings({ enabled: event.target.checked })}
                />
                컷팅 라인 보기
              </label>
              <label className="inline-flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={editorPrefs.showSafeMarginGuide}
                  onChange={(event) => setEditorPrefs((current) => ({ ...current, showSafeMarginGuide: event.target.checked }))}
                />
                세이프 마진 보기
              </label>
              <label className="inline-flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={editorPrefs.showCenterGuides}
                  onChange={(event) => setEditorPrefs((current) => ({ ...current, showCenterGuides: event.target.checked }))}
                />
                중심 가이드(십자선) 보기
              </label>
              <label>
                <span className="font-medium">컷팅 라인 종류</span>
                <select
                  value={cutLineSettings.style}
                  onChange={(event) => updateCutLineSettings({ style: event.target.value as CutLineStyle })}
                  className="mt-1 w-full rounded-md border border-line bg-white px-2 py-2"
                >
                  {(Object.keys(cutLineStyleLabels) as CutLineStyle[]).map((style) => (
                    <option key={style} value={style}>{cutLineStyleLabels[style]}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="font-medium">컷팅 라인 두께</span>
                <select
                  value={cutLineSettings.widthMm}
                  onChange={(event) => updateCutLineSettings({ widthMm: Number(event.target.value) })}
                  className="mt-1 w-full rounded-md border border-line bg-white px-2 py-2"
                >
                  {cutLineWidthOptionsMm.map((widthMm) => (
                    <option key={widthMm} value={widthMm}>{widthMm} mm</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="font-medium">컷팅 라인 오프셋(mm)</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={canvasSettings.cutOffsetMm ?? 0}
                  onChange={(event) =>
                    setCanvasSettings((current) => ({
                      ...current,
                      cutOffsetMm: Number(event.target.value),
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-line px-2 py-2"
                />
              </label>
              <label>
                <span className="font-medium">컷팅 라인 R · 스티커 모서리(mm)</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={canvasSettings.cuttingLineRadiusMm ?? canvasSettings.cornerRadiusMm ?? defaultTemplateCanvas.cornerRadiusMm}
                  onChange={(event) => {
                    const radiusMm = Number(event.target.value);
                    setCanvasSettings((current) => ({
                      ...current,
                      cuttingLineRadiusMm: radiusMm,
                      cornerRadiusMm: radiusMm,
                      cornerRadius: mmToCanvasPx(radiusMm, current),
                    }));
                  }}
                  className="mt-1 w-full rounded-md border border-line px-2 py-2"
                />
                <span className="mt-1 block text-[10px] text-neutral-500">
                  스티커(컷팅 라인)의 모서리 R입니다. 물리 카드 외곽 코너는 ID-1 규격상 {fixedCardOutlineRadiusMm}mm로 고정입니다.
                </span>
              </label>
              <label>
                <span className="font-medium">ㄱ자 코너 길이(mm)</span>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  value={cutLineSettings.cornerMarkLengthMm}
                  onChange={(event) => updateCutLineSettings({ cornerMarkLengthMm: Number(event.target.value) })}
                  disabled={cutLineSettings.style !== 'corner-marks'}
                  className="mt-1 w-full rounded-md border border-line px-2 py-2 disabled:bg-neutral-100 disabled:text-neutral-400"
                />
              </label>
              <label>
                <span className="font-medium">세이프 마진 값(mm)</span>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={canvasSettings.safeMarginMm ?? 0}
                  onChange={(event) =>
                    setCanvasSettings((current) => ({
                      ...current,
                      safeMarginMm: Number(event.target.value),
                      safeMargin: mmToCanvasPx(Number(event.target.value), current),
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-line px-2 py-2"
                />
              </label>
            </div>
            )}
          </div>

          <div className="mt-5 grid gap-2">
            {editingTemplate && (
              <p className="rounded-md bg-cyan-50 px-3 py-2 text-xs text-cyan-800">
                편집 중: {editingTemplate.name}
              </p>
            )}
          </div>
        </section>

        <button
          type="button"
          data-editor-ui="true"
          title="패널 크기 조절"
          aria-label="왼쪽 패널 크기 조절"
          onPointerDown={(event) => beginPanelResize('left', event)}
          className={`group flex min-h-0 cursor-col-resize items-stretch justify-center ${panelResizeState?.side === 'left' ? 'bg-primary/10' : 'hover:bg-neutral-100'}`}
        >
          <span className="my-2 w-px rounded bg-line group-hover:bg-primary/60" />
        </button>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-white p-5 shadow-surface">
          <div className="mb-3 shrink-0 flex flex-wrap gap-3 text-xs text-neutral-600">
            <span className="inline-flex items-center gap-1"><span className="h-0.5 w-5 bg-neutral-950" /> 카드 외곽선</span>
            <span className="inline-flex items-center gap-1"><span className="h-0.5 w-5" style={{ background: cuttingLineColor }} /> 컷팅 라인</span>
            <span className="inline-flex items-center gap-1"><span className="h-0.5 w-5 border-t border-dashed border-neutral-700" /> 안전 여백</span>
            <span className="basis-full text-neutral-500">카드 외곽선은 실제 카드 크기, 컷팅 라인은 cut offset(mm)만큼 카드 안쪽으로 들어간 스티커 컷 위치, 안전 여백은 컷팅 라인 기준 안쪽 여유 영역입니다.</span>
          </div>
          <div className="mb-4 flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-line bg-neutral-50 p-2 text-xs text-neutral-700">
            <div className="mr-auto flex flex-wrap items-center gap-1">
              <button type="button" data-editor-ui="true" onClick={resetViewport} className="rounded-md border border-line bg-white px-2 py-1 font-medium hover:bg-blue-50" title="카드를 중앙에 맞추고 보기 크기를 기본으로 되돌립니다.">
                보기 초기화
              </button>
              <button type="button" data-editor-ui="true" onClick={undoDraft} disabled={undoStack.length === 0} className="rounded-md border border-line bg-white p-1.5 hover:bg-blue-50 disabled:opacity-40" title="실행취소" aria-label="실행취소">
                <Undo2 className="h-4 w-4" />
              </button>
              <button type="button" data-editor-ui="true" onClick={redoDraft} disabled={redoStack.length === 0} className="rounded-md border border-line bg-white p-1.5 hover:bg-blue-50 disabled:opacity-40" title="다시실행" aria-label="다시실행">
                <Redo2 className="h-4 w-4" />
              </button>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 text-[11px] text-neutral-500">
              <p className="min-w-[220px] max-w-[420px]">
                중심 0mm 좌표계 / 1mm 스냅 / pxPerMm {pxPerMmDebug.pxPerMm.toFixed(2)} / 화면 {Math.round(viewport.zoom * 100)}%
              </p>
            </div>
          </div>
          <div
            ref={viewportRef}
            className={`relative min-h-0 flex-1 overflow-hidden overscroll-contain rounded-lg border border-line bg-neutral-100 ${panInteraction ? 'cursor-grabbing' : 'cursor-default'}`}
            onWheel={handleViewportWheel}
            onPointerDown={handleViewportPointerDown}
            onPointerMove={updateViewportPan}
            onPointerUp={endViewportPan}
            onPointerCancel={endViewportPan}
            onAuxClick={(event) => event.preventDefault()}
          >
          {!assetPickerOpen && multiSelectedLayers.length >= 2 && (
            <div
              data-editor-ui="true"
              className="absolute left-1/2 top-2 z-[1200] flex -translate-x-1/2 items-center gap-1 rounded-lg border border-line bg-white/95 px-2 py-1.5 shadow-surface"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <span className="px-1 text-xs font-semibold text-neutral-600">{multiSelectedLayers.length}개 선택</span>
              {([
                { key: 'left', title: '왼쪽 정렬', icon: <AlignStartVertical className="h-4 w-4" /> },
                { key: 'hcenter', title: '가로 가운데 정렬', icon: <AlignCenterVertical className="h-4 w-4" /> },
                { key: 'right', title: '오른쪽 정렬', icon: <AlignEndVertical className="h-4 w-4" /> },
                { key: 'top', title: '위 정렬', icon: <AlignStartHorizontal className="h-4 w-4" /> },
                { key: 'vcenter', title: '세로 가운데 정렬', icon: <AlignCenterHorizontal className="h-4 w-4" /> },
                { key: 'bottom', title: '아래 정렬', icon: <AlignEndHorizontal className="h-4 w-4" /> },
              ] as Array<{ key: MultiAlignAxis; title: string; icon: ReactNode }>).map((button) => (
                <button
                  key={button.key}
                  type="button"
                  title={button.title}
                  aria-label={button.title}
                  onClick={() => alignMultiSelection(button.key)}
                  className="rounded border border-line bg-white p-1.5 text-neutral-700 hover:bg-blue-50"
                >
                  {button.icon}
                </button>
              ))}
              <span className="mx-0.5 h-5 w-px bg-line" />
              <button
                type="button"
                title="가로 균등 분배 (3개 이상)"
                disabled={multiSelectedLayers.length < 3}
                onClick={() => distributeMultiSelection('h')}
                className="rounded border border-line bg-white px-2 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-blue-50 disabled:opacity-40"
              >
                ↔
              </button>
              <button
                type="button"
                title="세로 균등 분배 (3개 이상)"
                disabled={multiSelectedLayers.length < 3}
                onClick={() => distributeMultiSelection('v')}
                className="rounded border border-line bg-white px-2 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-blue-50 disabled:opacity-40"
              >
                ↕
              </button>
            </div>
          )}
          <div
            className="relative overflow-visible"
            style={{
              width: `min(100%, calc((72vh - ${editorPrefs.showRuler ? 44 : 0}px) * ${displayAspectRatio}))`,
              paddingLeft: editorPrefs.showRuler ? 32 : 0,
              paddingTop: editorPrefs.showRuler ? 28 : 0,
              transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
              transformOrigin: '0 0',
            }}
          >
            {!assetPickerOpen && editorPrefs.showRuler && (
              <div className="pointer-events-none absolute inset-0 z-30 text-[10px] font-semibold text-neutral-950" style={{ opacity: editorPrefs.rulerOpacity / 100 }}>
                <div className="absolute left-8 right-0 top-0 h-6 border-b border-neutral-950/40 bg-white/90">
                  {rulerXTicks.map((tick) => {
                    const left = (centeredMmToCanvasX(tick, canvasSettings) / canvasSettings.width) * 100;
                    const major = Math.abs(tick % gridLabelStepMm) < 0.001;
                    return (
                      <span key={`x-${tick}`} className="absolute top-0 flex w-0 flex-col items-center" style={{ left: `${left}%`, transform: 'translateX(-50%)' }}>
                        <span className={`block w-px bg-neutral-950 ${major ? 'h-4' : 'h-2.5'}`} />
                        {major && <span className="mt-0.5 whitespace-nowrap">{formatCenteredMmLabel(tick)}</span>}
                      </span>
                    );
                  })}
                </div>
                <div className="absolute bottom-0 left-0 top-7 w-7 border-r border-neutral-950/40 bg-white/90">
                  {rulerYTicks.map((tick) => {
                    const top = (centeredMmToCanvasY(tick, canvasSettings) / canvasSettings.height) * 100;
                    const major = Math.abs(tick % gridLabelStepMm) < 0.001;
                    return (
                      <span key={`y-${tick}`} className="absolute left-0 flex h-0 items-center" style={{ top: `${top}%`, transform: 'translateY(-50%)' }}>
                        <span className={`block bg-neutral-950 ${major ? 'w-4' : 'w-2.5'} h-px`} />
                        {major && <span className="ml-1 whitespace-nowrap">{formatCenteredMmLabel(tick)}</span>}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
            <div
              ref={canvasRef}
              className="relative w-full overflow-visible border-2 border-neutral-950 shadow-surface"
              style={{
                aspectRatio: `${canvasSettings.width} / ${canvasSettings.height}`,
                background: getCardBackgroundColor({ ...canvasSettings, cardBackgroundColor: cardColor, cardColor }, defaultCardBackgroundColor),
                borderRadius: cardOutlineRadiusCss(canvasSettings),
              }}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={updateInteraction}
              onPointerUp={endInteraction}
              onPointerCancel={endInteraction}
            >
            {!assetPickerOpen && editorPrefs.showGrid && (
              <div
                className="pointer-events-none absolute inset-0 z-[900] overflow-hidden rounded-[inherit]"
                style={{ opacity: editorPrefs.gridOpacity / 100 }}
              >
                {rulerXTicks.map((tick) => (
                  <span
                    key={`grid-x-${tick}`}
                    className="absolute bottom-0 top-0"
                    style={{
                      left: `${(centeredMmToCanvasX(tick, canvasSettings) / canvasSettings.width) * 100}%`,
                      ...gridLineStyle(tick, 'x'),
                    }}
                  />
                ))}
                {rulerYTicks.map((tick) => (
                  <span
                    key={`grid-y-${tick}`}
                    className="absolute left-0 right-0"
                    style={{
                      top: `${(centeredMmToCanvasY(tick, canvasSettings) / canvasSettings.height) * 100}%`,
                      ...gridLineStyle(tick, 'y'),
                    }}
                  />
                ))}
              </div>
            )}
            {!assetPickerOpen && cutLineSettings.enabled && (
              <svg
                className="pointer-events-none absolute inset-0 z-[910] overflow-visible"
                viewBox={`0 0 ${physicalSizeMm.width} ${physicalSizeMm.height}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {cutLineSettings.style === 'corner-marks' ? (
                  <>
                    {cutLinePreviewGeometry.radiusMm > 0 && (
                      <path
                        d={roundedRectPathMm(cutLinePreviewGeometry.rect, cutLinePreviewGeometry.radiusMm)}
                        fill="none"
                        stroke={cutLineSettings.color}
                        strokeWidth={Math.max(0.05, cutLinePreviewStrokeWidth * 0.7)}
                        opacity="0.22"
                      />
                    )}
                    {cutLinePreviewCornerSegments.map((segment, index) => (
                      <line
                        key={`corner-mark-${index}`}
                        x1={segment.x1Mm}
                        y1={segment.y1Mm}
                        x2={segment.x2Mm}
                        y2={segment.y2Mm}
                        stroke={cutLineSettings.color}
                        strokeWidth={cutLinePreviewStrokeWidth}
                        strokeLinecap="square"
                      />
                    ))}
                  </>
                ) : (
                  <path
                    d={roundedRectPathMm(cutLinePreviewGeometry.rect, cutLinePreviewGeometry.radiusMm)}
                    fill="none"
                    stroke={cutLineSettings.color}
                    strokeWidth={cutLinePreviewStrokeWidth}
                    strokeDasharray={cutLinePreviewDashArray || undefined}
                    strokeLinecap={cutLineSettings.style === 'dotted' ? 'round' : 'butt'}
                    strokeLinejoin="round"
                  />
                )}
              </svg>
            )}
            {!assetPickerOpen && editorPrefs.showCenterGuides && (
              // Canonical alignment reference: the card-box centre crosshair. The cut line is drawn separately, so an
              // off-centre (asymmetric) cut visibly diverges from this crosshair. Editor-only — never exported/printed.
              <svg
                className="pointer-events-none absolute inset-0 z-[905] overflow-visible"
                viewBox={`0 0 ${physicalSizeMm.width} ${physicalSizeMm.height}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <line
                  x1={physicalSizeMm.width / 2}
                  y1={0}
                  x2={physicalSizeMm.width / 2}
                  y2={physicalSizeMm.height}
                  stroke="#0891b2"
                  strokeWidth={0.15}
                  strokeDasharray="1 1"
                  opacity="0.6"
                />
                <line
                  x1={0}
                  y1={physicalSizeMm.height / 2}
                  x2={physicalSizeMm.width}
                  y2={physicalSizeMm.height / 2}
                  stroke="#0891b2"
                  strokeWidth={0.15}
                  strokeDasharray="1 1"
                  opacity="0.6"
                />
              </svg>
            )}
            {!assetPickerOpen && snapGuides.length > 0 && (
              // Smart-guide lines that appear only while dragging, when the moved object aligns with another object,
              // the card, or the cut line. Editor-only overlay (canvas-px space).
              <svg
                className="pointer-events-none absolute inset-0 z-[915] overflow-visible"
                viewBox={`0 0 ${canvasSettings.width} ${canvasSettings.height}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {snapGuides.map((guide, index) =>
                  guide.axis === 'x' ? (
                    <line
                      key={`snap-x-${index}`}
                      x1={guide.position}
                      y1={0}
                      x2={guide.position}
                      y2={canvasSettings.height}
                      stroke="#e11d48"
                      strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : (
                    <line
                      key={`snap-y-${index}`}
                      x1={0}
                      y1={guide.position}
                      x2={canvasSettings.width}
                      y2={guide.position}
                      stroke="#e11d48"
                      strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke"
                    />
                  ),
                )}
              </svg>
            )}
            <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: cardOutlineRadiusCss(canvasSettings) }}>
              <div
                className="pointer-events-none absolute"
                style={{
                  ...canvasInsetRectPercent(canvasCutOffsetPx(canvasSettings), canvasSettings),
                  background: getStickerBackgroundColor({ ...canvasSettings, stickerBackgroundColor: background }, defaultStickerBackgroundColor),
                  borderRadius: cuttingLineRadiusCss(canvasSettings),
                }}
              />
              {!assetPickerOpen && editorPrefs.showSafeMarginGuide && (
                <div
                  className="pointer-events-none absolute z-[910] border border-dashed border-neutral-950/80 shadow-[0_0_0_1px_rgba(255,255,255,0.85)]"
                  style={{
                    ...canvasInsetRectPercent(safeMarginInsetFromCardPx(canvasSettings), canvasSettings),
                    borderRadius: safeMarginRadiusCss(canvasSettings),
                  }}
                />
              )}
              {layers.map((layer) => {
                if (layer.data?.visible === false) return null;
                const transform = resolveLayerTransform(layer);
                const imageTransform = getImageTransform(layer);
                const mode = imageTransformMode(layer);
                const renderEffects = layerRenderEffectStyle(layer, transform.opacity);
                return (
                  <div
                    key={layer.id}
                    data-layout-layer="true"
                    data-selectable-layer="true"
                    data-editor-interactive="true"
                    className={`absolute cursor-move ${isShapeLayer(layer) ? 'overflow-visible' : 'overflow-hidden'}`}
                    style={{
                      left: `${(transform.x / canvasSettings.width) * 100}%`,
                      top: `${(transform.y / canvasSettings.height) * 100}%`,
                      width: `${(transform.width / canvasSettings.width) * 100}%`,
                      height: `${(transform.height / canvasSettings.height) * 100}%`,
                      opacity: renderEffects.opacity,
                      filter: renderEffects.filter,
                      boxShadow: renderEffects.boxShadow,
                      transform: `rotate(${transform.rotation}deg)`,
                      zIndex: layer.zIndex,
                      borderRadius: isShapeLayer(layer) ? undefined : layerCornerRadiusCss(layer, canvasSettings),
                    }}
                    onPointerDown={(event) => beginMove(layer, event)}
                  >
                    {isShapeLayer(layer) ? (
                      <TemplateShapeLayer layer={layer} canvas={canvasSettings} />
                    ) : isImageLike(layer) && hasTemplateImage(layer) ? (
                      <img
                        src={String(layer.data?.imageDataUrl)}
                        alt=""
                        draggable={false}
                        className="absolute max-h-none max-w-none"
                        style={{
                          ...imageStyleFromTransform(transform, imageTransform, imageNaturalSizeForLayer(layer)),
                          borderRadius: imageCornerRadiusCss(layer, canvasSettings, {
                            width: imageTransform.width,
                            height: imageTransform.height,
                          }),
                        }}
                        onPointerDown={(event) => beginMove(layer, event, mode === 'separate' ? 'image' : 'layer')}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-white/55 px-2 text-center text-xs font-semibold">
                        {getLayerLabel(layer)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {!assetPickerOpen && multiSelectedLayers.length >= 2 && multiSelectedLayers.map((layer) => {
              if (layer.id === selectedId) return null; // primary keeps the full handle overlay below
              const t = resolveLayerTransform(layer);
              return (
                <div
                  key={`multi-outline-${layer.id}`}
                  className="pointer-events-none absolute z-[999] rounded-[2px]"
                  style={{
                    left: `${(t.x / canvasSettings.width) * 100}%`,
                    top: `${(t.y / canvasSettings.height) * 100}%`,
                    width: `${(t.width / canvasSettings.width) * 100}%`,
                    height: `${(t.height / canvasSettings.height) * 100}%`,
                    transform: `rotate(${t.rotation}deg)`,
                    border: `${1 / viewport.zoom}px dashed rgba(243,108,33,0.9)`,
                    boxShadow: `0 0 0 ${1 / viewport.zoom}px rgba(255,255,255,0.5)`,
                  }}
                />
              );
            })}

            {!assetPickerOpen && layers.map((layer) => {
              if (layer.id !== selectedId) return null;
              const layerTransform = resolveLayerTransform(layer);
              const imageTransform = getImageTransform(layer);
              const mode = imageTransformMode(layer);
              const transform =
                selectedTarget === 'image' && isImageLike(layer) && mode === 'separate'
                  ? {
                      ...imageTransform,
                      x: layerTransform.x + imageTransform.x,
                      y: layerTransform.y + imageTransform.y,
                    }
                  : layerTransform;
              return (
                <div
                  key={`overlay-${layer.id}`}
                  data-layout-overlay="true"
                  data-editor-interactive="true"
                  className="absolute cursor-move touch-none select-none"
                  style={{
                    left: `${(transform.x / canvasSettings.width) * 100}%`,
                    top: `${(transform.y / canvasSettings.height) * 100}%`,
                    width: `${(transform.width / canvasSettings.width) * 100}%`,
                    height: `${(transform.height / canvasSettings.height) * 100}%`,
                    transform: `rotate(${transform.rotation}deg)`,
                    zIndex: 1000,
                    borderRadius: selectedTarget === 'image' ? '4px' : 0,
                  }}
                  onPointerDown={(event) => beginMove(layer, event, selectedTarget === 'image' && mode === 'separate' ? 'image' : 'layer')}
                >
                  <div
                    className="pointer-events-none absolute inset-0 rounded-[inherit]"
                    style={{
                      border: `${1 / viewport.zoom}px solid rgba(243,108,33,0.72)`,
                      boxShadow: `0 0 0 ${1 / viewport.zoom}px rgba(255,255,255,0.55)`,
                    }}
                  />
                  {[
                    { key: 'top-left', left: '0%', top: '0%', size: 8 },
                    { key: 'top-right', left: '100%', top: '0%', size: 8 },
                    { key: 'bottom-left', left: '0%', top: '100%', size: 8 },
                    { key: 'bottom-right', left: '100%', top: '100%', size: 8 },
                    { key: 'top', left: '50%', top: '0%', size: 7 },
                    { key: 'bottom', left: '50%', top: '100%', size: 7 },
                    { key: 'left', left: '0%', top: '50%', size: 7 },
                    { key: 'right', left: '100%', top: '50%', size: 7 },
                  ].map((handle) => (
                    <button
                      key={handle.key}
                      type="button"
                      data-transform-handle="true"
                      aria-label="Resize slot"
                      onPointerDown={(event) => beginResize(layer, event, selectedTarget === 'image' && mode === 'separate' ? 'image' : 'layer', handle.key as ResizeHandle)}
                      className="absolute h-6 w-6 touch-none rounded-full border-0 bg-transparent p-0"
                      style={{ left: handle.left, top: handle.top, transform: 'translate(-50%, -50%)' }}
                    >
                      <span
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-zaparoo/90 shadow-sm"
                        style={{
                          width: `${handle.size / viewport.zoom}px`,
                          height: `${handle.size / viewport.zoom}px`,
                          borderWidth: `${1 / viewport.zoom}px`,
                        }}
                      />
                    </button>
                  ))}
                  <span
                    className="pointer-events-none absolute bg-zaparoo/70"
                    style={{ left: '50%', top: '0%', width: `${1 / viewport.zoom}px`, height: `${22 / viewport.zoom}px`, transform: 'translate(-50%, -100%)' }}
                  />
                  <button
                    type="button"
                    data-transform-handle="true"
                    aria-label="회전"
                    title="드래그로 회전 (Shift: 15° 스냅)"
                    onPointerDown={(event) => beginRotate(layer, event, selectedTarget === 'image' && mode === 'separate' ? 'image' : 'layer')}
                    className="absolute h-6 w-6 touch-none rounded-full border-0 bg-transparent p-0"
                    style={{ left: '50%', top: '0%', transform: `translate(-50%, calc(-50% - ${22 / viewport.zoom}px))`, cursor: 'grab' }}
                  >
                    <span
                      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-zaparoo/90 shadow-sm"
                      style={{ width: `${9 / viewport.zoom}px`, height: `${9 / viewport.zoom}px`, borderWidth: `${1 / viewport.zoom}px` }}
                    />
                  </button>
                </div>
              );
            })}
          </div>
          </div>
          </div>
        </section>

        <button
          type="button"
          data-editor-ui="true"
          title="패널 크기 조절"
          aria-label="오른쪽 패널 크기 조절"
          onPointerDown={(event) => beginPanelResize('right', event)}
          className={`group flex min-h-0 cursor-col-resize items-stretch justify-center ${panelResizeState?.side === 'right' ? 'bg-primary/10' : 'hover:bg-neutral-100'}`}
        >
          <span className="my-2 w-px rounded bg-line group-hover:bg-primary/60" />
        </button>

        <section ref={sidebarRef} className="min-h-0 overflow-y-auto rounded-lg border border-line bg-white p-5 shadow-surface overscroll-contain">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold">레이어</h3>
            <div className="flex items-center gap-1">
              <button type="button" className="rounded border border-line bg-white p-1.5 hover:bg-blue-50" title="전체 펼치기" aria-label="전체 펼치기" onClick={() => setExpandedLayerIds(layers.map((layer) => layer.id))}>
                <ChevronsDown className="h-4 w-4" />
              </button>
              <button type="button" className="rounded border border-line bg-white p-1.5 hover:bg-blue-50" title="전체 접기" aria-label="전체 접기" onClick={() => setExpandedLayerIds([])}>
                <ChevronsUp className="h-4 w-4" />
              </button>
              <button type="button" className="rounded border border-line bg-white p-1.5 hover:bg-blue-50 disabled:opacity-40" title="선택 항목으로 이동" aria-label="선택 항목으로 이동" disabled={!selectedId} onClick={scrollToSelectedLayer}>
                <LocateFixed className="h-4 w-4" />
              </button>
              <button type="button" className={`rounded border border-line p-1.5 hover:bg-blue-50 ${layerSearchOpen ? 'bg-blue-50 text-primary' : 'bg-white'}`} title="레이어 검색" aria-label="레이어 검색" onClick={() => setLayerSearchOpen((current) => !current)}>
                <Search className="h-4 w-4" />
              </button>
              <button type="button" className="rounded border border-line bg-white p-1.5 hover:bg-blue-50 disabled:opacity-40" title="선택 레이어 복제" aria-label="선택 레이어 복제" disabled={!selectedLayer || selectedLayer.locked} onClick={duplicateSelectedLayer}>
                <Copy className="h-4 w-4" />
              </button>
              <button type="button" className="rounded border border-red-200 bg-white p-1.5 text-red-700 hover:bg-red-50 disabled:opacity-40" title="선택 레이어 삭제" aria-label="선택 레이어 삭제" disabled={!selectedLayer || selectedLayer.locked} onClick={deleteSelectedLayer}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
          {layerSearchOpen && (
            <label className="mt-2 block text-xs">
              <span className="sr-only">레이어 검색</span>
              <input
                value={layerSearch}
                onChange={(event) => setLayerSearch(event.target.value)}
                placeholder="레이어 검색"
                className="w-full rounded-md border border-line px-2 py-1.5"
              />
            </label>
          )}
          <p className="mt-1 text-[11px] text-neutral-500">레이어는 드래그해서 순서를 바꿀 수 있습니다.</p>
          <div ref={layerListRef} className="mt-3 space-y-1.5">
            {renderedLayers.map((layer) => {
              const label = getLayerLabel(layer);
              const isShape = isShapeLayer(layer);
              const imageLayer = isImageLike(layer);
              const hasImage = hasTemplateImage(layer);
              const fillStyle = isShape ? shapeFillChipStyle(layer) : undefined;
              const strokeColor = isShape ? templateShapeStrokeValue(layer) : undefined;
              const searchActive = Boolean(normalizedLayerSearch);
              const isExpanded = expandedLayerIdSet.has(layer.id) || searchActive;
              const accent = layerAccent(layer);
              const cropActive = imageLayer && layerHasActiveCrop(layer);
              const transformModified = imageLayer && layerImageTransformModified(layer);
              const layerEffects = getLayerEffects(layer);
              return (
                <div
                  key={layer.id}
                  ref={(element) => {
                    if (element) layerRowRefs.current.set(layer.id, element);
                    else layerRowRefs.current.delete(layer.id);
                  }}
                  className={`space-y-1 ${flashLayerId === layer.id ? 'rounded-md ring-2 ring-primary/30' : ''}`}
                >
                  <div
                    onDragOver={(event: DragEvent<HTMLDivElement>) => {
                      event.preventDefault();
                      const rect = event.currentTarget.getBoundingClientRect();
                      setDragOverPosition(event.clientY > rect.top + rect.height / 2 ? 'after' : 'before');
                    }}
                    onDragEnter={() => setDragOverLayerId(layer.id)}
                    onDragLeave={() => setDragOverLayerId((current) => (current === layer.id ? '' : current))}
                    onDrop={() => {
                      moveLayer(dragLayerId, layer.id, dragOverPosition);
                      setDragLayerId('');
                      setDragOverLayerId('');
                      setDragOverPosition('before');
                    }}
                    onClick={(event) => {
                      if (event.detail > 1) return;
                      if (event.ctrlKey || event.metaKey || event.shiftKey) {
                        toggleLayerInSelection(layer.id);
                        return;
                      }
                      selectLayer(layer);
                      toggleLayerExpanded(layer.id);
                    }}
                    className={`relative flex h-9 min-w-0 cursor-pointer items-center gap-1 rounded-md border border-l-4 px-1.5 text-xs font-semibold ${
                      accent.parent
                    } ${
                      layer.id === selectedId ? 'border-primary bg-blue-50 shadow-selected' : 'border-line bg-white hover:bg-neutral-50'
                    } ${layer.data?.visible === false ? 'opacity-55' : ''} ${dragOverLayerId === layer.id ? 'ring-2 ring-primary/25' : ''}`}
                  >
                    {dragOverLayerId === layer.id && (
                      <span
                        className={`pointer-events-none absolute left-0 right-0 z-10 h-3 rounded-full bg-primary/20 shadow-[0_0_0_1px_rgba(37,99,235,0.35)] ${
                          dragOverPosition === 'before' ? '-top-2' : '-bottom-2'
                        }`}
                      >
                        <span className="absolute left-0 right-0 top-1/2 h-0.5 -translate-y-1/2 bg-primary shadow-[0_0_8px_rgba(37,99,235,0.7)]" />
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleLayerExpanded(layer.id);
                      }}
                      className="rounded p-0.5 text-neutral-500 hover:bg-white"
                      title={isExpanded ? '접기' : '펼치기'}
                      aria-label={isExpanded ? '접기' : '펼치기'}
                    >
                      <ChevronRight className={disclosureIconClass(isExpanded)} />
                    </button>
                    <button
                      type="button"
                      draggable={!layer.locked}
                      onClick={(event) => event.stopPropagation()}
                      onDragStart={(event) => {
                        event.stopPropagation();
                        setDragLayerId(layer.id);
                      }}
                      onDragEnd={() => {
                        setDragLayerId('');
                        setDragOverLayerId('');
                        setDragOverPosition('before');
                      }}
                      disabled={layer.locked}
                      title="드래그해서 순서 변경"
                      className="cursor-grab rounded p-1 text-neutral-400 hover:bg-white disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <GripVertical className="h-4 w-4" />
                    </button>
                    <span className={`flex h-5 min-w-[36px] items-center justify-center rounded-full border px-1.5 text-[10px] font-semibold ${accent.badge}`} title={fullLayerTypeLabel(layer)}>
                      {fullLayerTypeLabel(layer)}
                    </span>
                    {renamingLayerId === layer.id ? (
                      <input
                        autoFocus
                        value={renameDraft}
                        disabled={layer.locked}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        onFocus={(event) => event.currentTarget.select()}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onBlur={() => commitRenameLayer(layer)}
                        onKeyDown={(event) => handleRenameKeyDown(event, layer)}
                        className="min-w-0 flex-1 rounded border border-primary bg-white px-1 py-1 font-medium text-neutral-950 caret-primary shadow-inner outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        title={label}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (event.detail > 1) return;
                          selectLayer(layer);
                          toggleLayerExpanded(layer.id);
                        }}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          setExpandedLayerIds((current) => (current.includes(layer.id) ? current : [...current, layer.id]));
                          startRenameLayer(layer);
                        }}
                        className="min-w-0 flex-1 truncate rounded px-1 py-1 text-left font-semibold hover:bg-white"
                      >
                        {label}
                      </button>
                    )}
                    {!isShape && (
                      <span className="max-w-[72px] truncate rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600" title={slotTypeLabel(migrateSlotType(layer.slotType))}>
                        {slotTypeLabel(migrateSlotType(layer.slotType))}
                      </span>
                    )}
                    {!isShape && (
                      <span
                        title={hasImage ? '이미지 있음' : '이미지 없음'}
                        className={`relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded ${hasImage ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-400'}`}
                      >
                        <Image className="h-4 w-4" />
                        <span className={`absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full ${hasImage ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                      </span>
                    )}
                    {cropActive && (
                      <span title="자르기 적용됨" className="inline-flex h-5 w-5 items-center justify-center rounded bg-emerald-50 text-emerald-700">
                        <Crop className="h-3.5 w-3.5" />
                      </span>
                    )}
                    {transformModified && (
                      <span title="이미지 위치/크기 수정됨" className="inline-flex h-5 w-5 items-center justify-center rounded bg-blue-50 text-blue-700">
                        <LocateFixed className="h-3.5 w-3.5" />
                      </span>
                    )}
                    {isShape && (
                      <span className="flex items-center gap-1">
                        <span
                          title={`채움: ${fillTypeLabel(layer)}`}
                          className={`h-4 w-4 rounded border border-neutral-300 ${fillStyle ? '' : 'image-thumb-frame'}`}
                          style={fillStyle}
                        />
                        <span
                          title={`선: ${strokeStatusLabel(layer)}`}
                          className={`h-4 w-4 rounded border border-neutral-300 ${strokeColor === 'transparent' ? 'image-thumb-frame' : ''}`}
                          style={{ backgroundColor: strokeColor === 'transparent' ? undefined : strokeColor }}
                        />
                      </span>
                    )}
                    {layerEffects.length > 0 && (
                      <span title={`효과: ${layerEffectSummary(layer)}`} className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-[#00E5FF]/30 bg-[#00E5FF]/10 px-1 text-[10px] font-semibold text-[#007C8A]">
                        FX
                      </span>
                    )}
                    <button
                      type="button"
                      title={layer.data?.visible === false ? '보이기' : '숨기기'}
                      aria-label={layer.data?.visible === false ? '보이기' : '숨기기'}
                      onClick={(event) => {
                        event.stopPropagation();
                        updateLayer(layer.id, { data: { ...layer.data, visible: layer.data?.visible === false } });
                      }}
                      className={`rounded p-1 hover:bg-white ${layer.data?.visible === false ? 'bg-neutral-100 text-neutral-700' : 'text-neutral-500'}`}
                    >
                      {layer.data?.visible === false ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      title={layer.locked ? '잠금 해제' : '잠금'}
                      aria-label={layer.locked ? '잠금 해제' : '잠금'}
                      onClick={(event) => {
                        event.stopPropagation();
                        updateLayer(layer.id, { locked: !layer.locked });
                      }}
                      className={`rounded p-1 hover:bg-white ${layer.locked ? 'bg-amber-50 text-amber-700' : 'text-neutral-500'}`}
                    >
                      {layer.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                    </button>
                  </div>
                  {isExpanded && (
                    <div className={`ml-7 border-l-2 pl-2 text-[11px] text-neutral-700 ${isShape ? 'border-purple-100' : 'border-blue-100'}`}>
                      {!isShape ? renderImageLayerDetails(layer, hasImage) : renderShapeLayerDetails(layer)}
                      {!isShape && !hasImage && (
                        <div className="mt-1 flex flex-wrap gap-1.5 rounded-md border border-amber-100 bg-amber-50/40 px-2 py-1">
                          <span className="inline-flex items-center gap-1 font-semibold text-amber-800"><AlertCircle className="h-3.5 w-3.5" /> 상태</span>
                          <span className="rounded bg-white px-1.5 py-0.5">이미지 없음</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {renderedLayers.length === 0 && (
              <div className="rounded-md border border-dashed border-line bg-neutral-50 px-3 py-4 text-center text-xs text-neutral-500">
                검색 결과가 없습니다.
              </div>
            )}
          </div>

          <div className="mt-5 rounded-md border border-line bg-neutral-50 p-3 text-sm">
            <h3 className="text-sm font-semibold">색상</h3>
            <p className="mt-1 text-[11px] text-neutral-500">색상 편집기는 이 오른쪽 패널 안에서 열립니다.</p>
            <div className="mt-3 space-y-2">
              <ColorSelector {...colorSelectorLiveProps} label="카드 배경색" value={cardColor} onChange={setCardColor} />
              <ColorSelector
                {...colorSelectorLiveProps}
                label="스티커 배경색"
                value={background}
                onChange={setBackground}
                allowTransparent
                transparentLabel="스티커 배경 투명"
                transparent={background === 'transparent'}
                onTransparentChange={(transparent) => setBackground(transparent ? 'transparent' : '#111111')}
              />
              <ColorSelector
                {...colorSelectorLiveProps}
                label="컷팅 라인 색상"
                value={cutLineSettings.color}
                onChange={(color) => updateCutLineSettings({ color })}
              />
            </div>
          </div>

          <h3 className="mt-6 text-base font-semibold">선택 항목</h3>
          {selectedLayer && activeTransform ? (
            <div className="mt-3 space-y-3 rounded-md border border-line bg-neutral-50 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs font-semibold text-neutral-700" title={getLayerLabel(selectedLayer)}>
                  {selectedTarget === 'image' && isImageLike(selectedLayer) ? '슬롯 이미지' : isShapeLayer(selectedLayer) ? '도형' : '슬롯 프레임'} · {getLayerLabel(selectedLayer)}
                </span>
                <span className="rounded bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-500">세부 값은 펼친 레이어 행에서 편집</span>
              </div>
              {isShapeLayer(selectedLayer) && (
                <div className="rounded bg-white px-2 py-1 text-[11px] text-neutral-500">
                  출력 선 두께 {templateShapeStrokeWidthMm(selectedLayer, canvasSettings).toFixed(2)}mm
                </div>
              )}
              {isShapeLayer(selectedLayer) && (
                <label className="block text-xs">
                  <span className="font-medium">도형 종류</span>
                  <select
                    disabled={selectedLayer.locked}
                    value={shapeKind(selectedLayer)}
                    onChange={(event) => {
                      const shapeType = event.target.value as ShapeKind;
                      const radiusMm =
                        shapeType === 'roundedRectangle'
                          ? Math.max(0, layerCornerRadiusMm(selectedLayer, canvasSettings) || defaultShapeRadiusMm)
                          : layerCornerRadiusMm(selectedLayer, canvasSettings);
                      updateShape(selectedLayer.id, {
                        cornerRadiusMm: radiusMm,
                        cornerRadius: mmToCanvasPx(radiusMm, canvasSettings),
                        data: { ...selectedLayer.data, shapeType, shapeKind: shapeType, kind: 'shape' },
                      });
                    }}
                    className="mt-1 w-full rounded-md border border-line bg-white px-2 py-2"
                  >
                    {(['rectangle', 'roundedRectangle', 'ellipse', 'line'] as ShapeKind[]).map((shape) => (
                      <option key={shape} value={shape}>{shapeKindLabels[shape]}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block text-xs">
                <span className="flex items-center justify-between font-medium">
                  <span>불투명도</span>
                  <span>{Math.round((activeTransform.opacity ?? 1) * 100)}%</span>
                </span>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    disabled={selectedLayer.locked}
                    value={Math.round((activeTransform.opacity ?? 1) * 100)}
                    onChange={(event) => {
                      const opacity = Number(event.target.value) / 100;
                      if (selectedTarget === 'image' && isImageLike(selectedLayer) && selectedImageTransform) {
                        updateImageTransform(selectedLayer.id, { ...selectedImageTransform, opacity });
                        return;
                      }
                      updateSelectedLayer({ opacity });
                    }}
                    className="min-w-0 flex-1"
                  />
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    disabled={selectedLayer.locked}
                    value={Math.round((activeTransform.opacity ?? 1) * 100)}
                    onChange={(event) => {
                      const opacity = clampNumber(Number(event.target.value), 0, 100) / 100;
                      if (selectedTarget === 'image' && isImageLike(selectedLayer) && selectedImageTransform) {
                        updateImageTransform(selectedLayer.id, { ...selectedImageTransform, opacity });
                        return;
                      }
                      updateSelectedLayer({ opacity });
                    }}
                    className="h-8 w-16 rounded border border-line bg-white px-1 text-right"
                  />
                </div>
              </label>
            </div>
          ) : (
            <p className="mt-3 text-sm text-neutral-600">슬롯을 선택하거나 추가하세요.</p>
          )}
        </section>
      </div>

      {assetPickerOpen && (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/60 px-4 py-6" onPointerDown={(event) => event.stopPropagation()}>
          <div className="flex max-h-[88vh] w-full max-w-5xl flex-col rounded-lg bg-white shadow-surface">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">슬롯 이미지 선택</h2>
                <p className="text-sm text-neutral-600">
                  {assetPickerPlatform
                    ? `${assetPickerPlatform} / ${slotTypeLabel(selectedLayer?.slotType)}`
                    : `${assetPlatforms.length}개 platform에 ${slotTypeLabel(selectedLayer?.slotType)} 에셋이 있습니다`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAssetPickerOpen(false)}
                className="rounded-md border border-line px-3 py-2 text-sm font-medium"
              >
                닫기
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-5">
              {assetPickerError && (
                <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {assetPickerError}
                </div>
              )}
              {!assetPickerPlatform ? (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="cursor-pointer rounded-md border border-dashed border-primary bg-blue-50 px-4 py-3 text-left hover:bg-blue-100">
                    <span className="block font-medium">로컬 폴더에서 불러오기</span>
                    <span className="text-sm text-neutral-600">
                      현재 슬롯 타입에 맞는 이미지로 가져와 템플릿에 포함합니다.
                    </span>
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      className="sr-only"
                      {...localFolderInputProps}
                      onChange={(event) => {
                        importLocalFolderAssets(event.currentTarget.files);
                        event.currentTarget.value = '';
                      }}
                    />
                  </label>
                  {assetPlatforms.map((bucket) => (
                    <button
                      key={bucket.platform}
                      type="button"
                      onClick={() => {
                        setAssetPickerPlatform(bucket.platform);
                        setAssetFolderPath('');
                      }}
                      className="rounded-md border border-line px-4 py-3 text-left hover:border-primary hover:bg-blue-50"
                    >
                      <span className="block font-medium">{bucket.platform}</span>
                      <span className="text-sm text-neutral-600">{bucket.assets.length}개 이미지</span>
                    </button>
                  ))}
                  {assetPlatforms.length === 0 && (
                    <p className="rounded-md border border-line bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
                      {matchingAssets.length === 0 ? '이 슬롯 타입에 맞는 에셋이 없습니다.' : '이미지 에셋을 먼저 불러오세요.'}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setAssetPickerPlatform('');
                        setAssetFolderPath('');
                        setAssetSearch('');
                      }}
                      className="rounded-md border border-line px-3 py-2 text-sm font-medium"
                    >
                      Platform 목록
                    </button>
                    <label className="min-w-[220px] flex-1 text-sm">
                      <span className="font-medium">파일명 검색</span>
                      <input
                        value={assetSearch}
                        onChange={(event) => setAssetSearch(event.target.value)}
                        className="mt-1 w-full rounded-md border border-line px-3 py-2"
                      />
                    </label>
                    <label className="w-56 text-sm">
                      <span className="flex items-center justify-between font-medium">
                        <span>썸네일 크기</span>
                        <span>{thumbnailSize}px</span>
                      </span>
                      <input
                        type="range"
                        min="64"
                        max="180"
                        value={thumbnailSize}
                        onChange={(event) => setThumbnailSize(Number(event.target.value))}
                        className="mt-2 w-full"
                      />
                    </label>
                  </div>
                  {!assetSearch.trim() && (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-neutral-50 px-3 py-2 text-xs">
                      <button
                        type="button"
                        onClick={() => setAssetFolderPath('')}
                        className={`rounded px-2 py-1 font-medium ${assetFolderPath ? 'text-neutral-600 hover:bg-white' : 'bg-white text-primary shadow-sm'}`}
                      >
                        루트
                      </button>
                      {folderBreadcrumbs(assetFolderPath).map((crumb) => (
                        <button
                          key={crumb.path}
                          type="button"
                          onClick={() => setAssetFolderPath(crumb.path)}
                          className="rounded px-2 py-1 font-medium text-neutral-600 hover:bg-white"
                        >
                          / {crumb.label}
                        </button>
                      ))}
                      {assetFolderPath && (
                        <button
                          type="button"
                          onClick={() => {
                            const parts = assetFolderPath.split('/').filter(Boolean);
                            setAssetFolderPath(parts.slice(0, -1).join('/'));
                          }}
                          className="ml-auto rounded border border-line bg-white px-2 py-1 font-medium"
                        >
                          상위 폴더
                        </button>
                      )}
                    </div>
                  )}
                  <div
                    className="grid gap-3"
                    style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbnailSize}px, 1fr))` }}
                  >
                    {!assetSearch.trim() && currentAssetFolders.map((folder) => (
                      <button
                        key={`folder-${folder}`}
                        type="button"
                        title={folder.split('/').pop()}
                        onClick={() => setAssetFolderPath(folder)}
                        className="min-w-0 rounded-md border border-line bg-neutral-50 p-2 text-left hover:border-primary hover:bg-blue-50"
                      >
                        <div className="flex items-center justify-center rounded bg-white text-neutral-500" style={{ height: `${thumbnailSize}px` }}>
                          <Folder className="h-10 w-10 text-neutral-400" />
                        </div>
                        <span className="mt-2 block truncate text-xs font-semibold">{folder.split('/').pop()}</span>
                        <span className="block truncate text-[11px] text-neutral-500">폴더</span>
                      </button>
                    ))}
                    {currentFolderAssets.map((asset) => (
                      <button
                        key={asset.id}
                        type="button"
                        title={assetDisplayName(asset)}
                        onClick={() => setPreviewAsset(asset)}
                        className="min-w-0 rounded-md border border-line bg-neutral-50 p-2 text-left hover:border-primary hover:bg-blue-50"
                      >
                        <div
                          className="image-thumb-frame flex items-center justify-center overflow-hidden rounded"
                          style={{ height: `${thumbnailSize}px` }}
                        >
                          {asset.objectUrl ? (
                            <img src={asset.objectUrl} alt="" className="h-full w-full object-contain" />
                          ) : (
                            <Image className="h-6 w-6 text-neutral-400" />
                          )}
                        </div>
                        <span className="mt-2 block truncate text-xs font-medium" title={assetDisplayName(asset)}>{assetDisplayName(asset)}</span>
                      </button>
                    ))}
                    {currentAssetFolders.length === 0 && currentFolderAssets.length === 0 && (
                      <p className="rounded-md border border-line bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
                        이 슬롯 타입에 맞는 에셋이 없습니다.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {assetPickerOpen && previewAsset && (
        <div className="fixed inset-0 z-[5100] flex items-center justify-center bg-black/70 px-4 py-6" onPointerDown={(event) => event.stopPropagation()}>
          <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-surface">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h3 className="truncate text-lg font-semibold" title={assetDisplayName(previewAsset)}>{assetDisplayName(previewAsset)}</h3>
                <p className="truncate text-sm text-neutral-500" title={normalizedAssetPath(previewAsset)}>
                  {previewAsset.sourceLabel ?? previewAsset.platform ?? '이미지'} · {normalizedAssetPath(previewAsset)}
                </p>
              </div>
              <button type="button" onClick={() => setPreviewAsset(null)} className="rounded-md border border-line px-3 py-2 text-sm font-medium">
                닫기
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-5">
              <div className="image-thumb-frame flex max-h-[58vh] min-h-[280px] items-center justify-center overflow-hidden rounded-md p-3">
                {previewAsset.objectUrl ? (
                  <img src={previewAsset.objectUrl} alt="" className="max-h-full max-w-full object-contain" />
                ) : (
                  <Image className="h-10 w-10 text-neutral-400" />
                )}
              </div>
              <p className="mt-3 text-xs text-neutral-500">←/→ 이전·다음, Enter로 추가, Esc로 닫기</p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-4">
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!previousPreviewAsset}
                  onClick={() => previousPreviewAsset && setPreviewAsset(previousPreviewAsset)}
                  className="rounded-md border border-line px-4 py-2 text-sm font-medium disabled:opacity-40"
                >
                  이전 이미지
                </button>
                <button
                  type="button"
                  disabled={!nextPreviewAsset}
                  onClick={() => nextPreviewAsset && setPreviewAsset(nextPreviewAsset)}
                  className="rounded-md border border-line px-4 py-2 text-sm font-medium disabled:opacity-40"
                >
                  다음 이미지
                </button>
              </div>
              <div className="flex gap-2">
              <button type="button" onClick={() => setPreviewAsset(null)} className="rounded-md border border-line px-4 py-2 text-sm font-medium">
                닫기
              </button>
              <button type="button" onClick={() => void chooseAsset(previewAsset)} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                이미지 추가
              </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
