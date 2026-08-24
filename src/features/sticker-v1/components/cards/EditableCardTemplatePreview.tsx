import { useCallback, useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import type { CardItem, Category, LocalAsset, Template, TemplateLayer } from '@sticker-v1/types';
import { TemplateShapeLayer } from '@sticker-v1/components/cards/TemplateShapeLayer';
import {
  cardOutlineRadiusCss,
  canvasCutOffsetPx,
  canvasInsetRectPercent,
  cuttingLineRadiusCss,
  getCardBackgroundColor,
  getStickerBackgroundColor,
  imageCornerRadiusCss,
  layerCornerRadiusCss,
} from '@sticker-v1/utils/cardGeometry';
import {
  getTemplateLayerFrame,
  getTemplateLayerImageTransform,
  isTemplateImageLayer,
  orderedTemplateLayers,
} from '@sticker-v1/utils/cardTemplateTransforms';
import { resolveAssetReference } from '@sticker-v1/utils/assetReferences';
import { isEditorInteractiveTarget } from '@sticker-v1/utils/editorHitTest';
import { resizeFromTopLeft, type ImageTransform } from '@sticker-v1/utils/imageTransform';
import { imageCropInsetPercent, type ImageNaturalSize } from '@sticker-v1/utils/imageCrop';
import { isTemplateShapeFillTransparent, isTemplateShapeLayer } from '@sticker-v1/utils/templateShapes';
import { clampViewportToCanvas, defaultViewportTransform, getFitViewTransform, panViewport, zoomViewportAtPoint, type ViewportTransform } from '@sticker-v1/utils/viewportTransform';
import { layerEffectStyle } from '@sticker-v1/utils/layerEffects';

interface EditableCardTemplatePreviewProps {
  card: CardItem;
  category?: Category;
  assetsById: Record<string, LocalAsset>;
  template?: Template;
  side?: 'front' | 'back';
  selectedLayerId?: string;
  fillContainer?: boolean;
  workspaceMinHeight?: number;
  onSelectedLayerChange: (layerId?: string) => void;
  onImageTransformChange: (layer: TemplateLayer, transform: ImageTransform) => void;
}

type Interaction =
  | {
      type: 'move';
      pointerId: number;
      layer: TemplateLayer;
      startPointer: { x: number; y: number };
      startTransform: ImageTransform;
    }
  | { type: 'resize'; pointerId: number; layer: TemplateLayer; startTransform: ImageTransform };

type PanInteraction = {
  pointerId: number;
  startPointer: { x: number; y: number };
  startViewport: ViewportTransform;
} | null;

function layerStyle(layer: TemplateLayer, template: Template) {
  const effects = layerEffectStyle(layer);
  const effectOpacity = typeof effects.opacity === 'number' ? effects.opacity : 1;
  const frame = getTemplateLayerFrame(layer, template.canvas);
  return {
    left: `${(frame.x / template.canvas.width) * 100}%`,
    top: `${(frame.y / template.canvas.height) * 100}%`,
    width: `${(frame.width / template.canvas.width) * 100}%`,
    height: `${(frame.height / template.canvas.height) * 100}%`,
    opacity: (layer.opacity ?? 1) * effectOpacity,
    filter: effects.filter,
    boxShadow: effects.boxShadow,
    transform: `rotate(${layer.rotation ?? 0}deg)`,
    zIndex: layer.zIndex,
  };
}

function imageNaturalSizeForLayer(layer: TemplateLayer, asset?: LocalAsset): ImageNaturalSize {
  return {
    width: asset?.width ?? Number(layer.data?.imageNaturalWidth ?? 0),
    height: asset?.height ?? Number(layer.data?.imageNaturalHeight ?? 0),
  };
}

function imageStyle(layer: TemplateLayer, template: Template, transform: ImageTransform, naturalSize?: ImageNaturalSize) {
  const cropInset = imageCropInsetPercent(transform, naturalSize);
  const frame = getTemplateLayerFrame(layer, template.canvas);
  return {
    left: `${(transform.x / frame.width) * 100}%`,
    top: `${(transform.y / frame.height) * 100}%`,
    width: `${(transform.width / frame.width) * 100}%`,
    height: `${(transform.height / frame.height) * 100}%`,
    transform: `rotate(${transform.rotation ?? 0}deg)`,
    transformOrigin: 'top left',
    clipPath: `inset(${cropInset.top}% ${cropInset.right}% ${cropInset.bottom}% ${cropInset.left}%)`,
    borderRadius: imageCornerRadiusCss(layer, template.canvas, { width: transform.width, height: transform.height }),
  };
}

function slotText(layer: TemplateLayer, card: CardItem, side: 'front' | 'back') {
  if (layer.slotType === 'categoryLabel') return side === 'front' ? card.front.categoryLabel : card.back.categoryLabel;
  if (layer.slotType === 'platformLabel') return card.front.platformLabel;
  if (layer.slotType === 'brandText') return 'Hello Mister';
  if (layer.slotType === 'titleText') return card.front.titleText;
  if (layer.slotType === 'gameLogo') return card.front.titleText;
  if (layer.slotType === 'platformLogo') return card.front.platformLabel;
  if (layer.slotType === 'heroImage' || layer.slotType === 'mainImage' || layer.slotType === 'background') return '이미지 없음';
  if (layer.data?.text) return String(layer.data.text);
  return layer.slot?.label ?? layer.slotType ?? '';
}

function slotAsset(layer: TemplateLayer, card: CardItem, assetsById: Record<string, LocalAsset>, side: 'front' | 'back') {
  if (side === 'back' && (layer.slotType === 'backgroundArt' || layer.slotType === 'heroImage' || layer.slotType === 'background' || layer.slotType === 'mainImage')) {
    return resolveAssetReference(assetsById, card.back.backgroundImageAssetId, card.back.backgroundImageAssetRef);
  }
  if (side === 'back' && (layer.slotType === 'titleImage' || layer.slotType === 'gameLogo' || layer.slotType === 'brandLogo' || layer.slotType === 'platformLogo')) {
    return resolveAssetReference(assetsById, card.back.brandLogoAssetId, card.back.brandLogoAssetRef);
  }
  if (layer.slotType === 'heroImage' || layer.slotType === 'mainImage') {
    return resolveAssetReference(assetsById, card.front.heroImageAssetId, card.front.heroImageAssetRef);
  }
  if (layer.slotType === 'titleImage' || layer.slotType === 'gameLogo') {
    return resolveAssetReference(assetsById, card.front.titleImageAssetId, card.front.titleImageAssetRef);
  }
  if (layer.slotType === 'brandLogo' || layer.slotType === 'platformLogo') {
    return resolveAssetReference(assetsById, card.front.brandLogoAssetId, card.front.brandLogoAssetRef);
  }
  if (layer.slotType === 'background') {
    return resolveAssetReference(assetsById, card.front.backgroundImageAssetId, card.front.backgroundImageAssetRef);
  }
  return undefined;
}

function templateImageDataUrl(layer: TemplateLayer) {
  return typeof layer.data?.imageDataUrl === 'string' ? layer.data.imageDataUrl : undefined;
}

function getCanvasPoint(element: HTMLDivElement, event: { clientX: number; clientY: number }, template: Template) {
  const rect = element.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * template.canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * template.canvas.height,
  };
}

function blurFocusedControl() {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return;
  const tagName = activeElement.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || activeElement.isContentEditable) {
    activeElement.blur();
  }
}

function isViewportControlTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'));
}

export function EditableCardTemplatePreview({
  card,
  category,
  assetsById,
  template,
  side = 'front',
  selectedLayerId,
  fillContainer = false,
  workspaceMinHeight,
  onSelectedLayerChange,
  onImageTransformChange,
}: EditableCardTemplatePreviewProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const [viewport, setViewport] = useState(defaultViewportTransform);
  const [panInteraction, setPanInteraction] = useState<PanInteraction>(null);
  const [draftTransforms, setDraftTransforms] = useState<Record<string, ImageTransform>>({});
  const draftTransformsRef = useRef<Record<string, ImageTransform>>({});
  const palette = category?.palette ?? {
    primary: '#111111',
    secondary: '#f5f5f5',
    accent: '#f36c21',
    neutral: '#d9d9d9',
  };
  const selectedLayer = template?.layers.find((layer) => layer.id === selectedLayerId);

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
      minZoom: getViewportMinZoom(),
      minVisiblePx: 96,
      panMarginPx: 360,
    });
  }, [getViewportMinZoom]);

  const fitViewport = useCallback(() => {
    const viewportElement = viewportRef.current;
    const canvasElement = canvasRef.current;
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
          padding: 48,
          minZoom: getViewportMinZoom(),
          maxZoom: 1,
        }),
      ),
    );
  }, [clampViewport, getViewportMinZoom]);

  useEffect(() => {
    if (!template) return undefined;
    const viewportElement = viewportRef.current;
    if (!viewportElement) return undefined;
    let frame = window.requestAnimationFrame(fitViewport);
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(fitViewport);
    });
    observer.observe(viewportElement);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fitViewport, template]);


  const setLayerDraft = useCallback((layerId: string, transform?: ImageTransform) => {
    const next = { ...draftTransformsRef.current };
    if (transform) next[layerId] = transform;
    else delete next[layerId];
    draftTransformsRef.current = next;
    setDraftTransforms(next);
  }, []);

  const transformForLayer = useCallback((layer: TemplateLayer) => {
    return draftTransforms[layer.id] ?? getTemplateLayerImageTransform(layer, card, side);
  }, [card, draftTransforms, side]);

  const commitLayerDraft = useCallback((layer: TemplateLayer) => {
    const draft = draftTransformsRef.current[layer.id];
    if (!draft) return;
    setLayerDraft(layer.id, undefined);
    onImageTransformChange(layer, draft);
  }, [onImageTransformChange, setLayerDraft]);

  useEffect(() => {
    draftTransformsRef.current = {};
    setDraftTransforms({});
  }, [card.id, side, template?.id]);

  useEffect(() => {
    const viewportElement = viewportRef.current;
    if (!viewportElement) return undefined;
    function preventWheelPageScroll(event: globalThis.WheelEvent) {
      if (isViewportControlTarget(event.target)) return;
      event.preventDefault();
    }
    viewportElement.addEventListener('wheel', preventWheelPageScroll, { passive: false });
    return () => viewportElement.removeEventListener('wheel', preventWheelPageScroll);
  }, []);

  useEffect(() => {
    if (!template || !selectedLayer || !isTemplateImageLayer(selectedLayer)) return;
    const activeLayer = selectedLayer;

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
        onSelectedLayerChange(undefined);
        return;
      }
      const deltas: Record<string, { x: number; y: number } | undefined> = {
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
      };
      const delta = deltas[event.key];
      if (!delta) return;
      event.preventDefault();
      const transform = transformForLayer(activeLayer);
      onImageTransformChange(activeLayer, { ...transform, x: transform.x + delta.x, y: transform.y + delta.y });
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [card, onImageTransformChange, onSelectedLayerChange, selectedLayer, template, transformForLayer]);


  function beginMove(layer: TemplateLayer, event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const canvas = canvasRef.current;
    if (!canvas || !template) return;
    event.preventDefault();
    event.stopPropagation();
    blurFocusedControl();
    canvas.setPointerCapture(event.pointerId);
    onSelectedLayerChange(layer.id);
    setInteraction({
      type: 'move',
      pointerId: event.pointerId,
      layer,
      startPointer: getCanvasPoint(canvas, event, template),
      startTransform: transformForLayer(layer),
    });
  }

  function beginResize(layer: TemplateLayer, event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(event.pointerId);
    onSelectedLayerChange(layer.id);
    setInteraction({
      type: 'resize',
      pointerId: event.pointerId,
      layer,
      startTransform: transformForLayer(layer),
    });
  }

  function updateInteraction(event: PointerEvent<HTMLDivElement>) {
    updateInteractionFromPoint(event);
  }

  const updateInteractionFromPoint = useCallback((event: { clientX: number; clientY: number; shiftKey: boolean; pointerId?: number }) => {
    const canvas = canvasRef.current;
    if (!canvas || !interaction || (typeof event.pointerId === 'number' && interaction.pointerId !== event.pointerId) || !template) return;
    const point = getCanvasPoint(canvas, event, template);
    if (interaction.type === 'move') {
      setLayerDraft(interaction.layer.id, {
        ...interaction.startTransform,
        x: interaction.startTransform.x + point.x - interaction.startPointer.x,
        y: interaction.startTransform.y + point.y - interaction.startPointer.y,
      });
      return;
    }
    setLayerDraft(
      interaction.layer.id,
      resizeFromTopLeft(
        interaction.startTransform,
        {
          x: point.x - getTemplateLayerFrame(interaction.layer, template.canvas).x,
          y: point.y - getTemplateLayerFrame(interaction.layer, template.canvas).y,
        },
        Boolean(event.shiftKey),
      ),
    );
  }, [interaction, setLayerDraft, template]);

  function endInteraction(event: PointerEvent<HTMLDivElement>) {
    if (interaction?.pointerId === event.pointerId) {
      commitLayerDraft(interaction.layer);
      setInteraction(null);
    }
  }

  useEffect(() => {
    if (!interaction) return undefined;
    const activeInteraction = interaction;

    function handleWindowPointerMove(event: globalThis.PointerEvent) {
      updateInteractionFromPoint(event);
    }

    function handleWindowPointerUp(event: globalThis.PointerEvent) {
      if (activeInteraction.pointerId === event.pointerId) {
        commitLayerDraft(activeInteraction.layer);
        setInteraction(null);
      }
    }

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
    };
  }, [commitLayerDraft, interaction, updateInteractionFromPoint]);

  function handleViewportWheel(event: WheelEvent<HTMLDivElement>) {
    if (isViewportControlTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const direction = event.deltaY < 0 ? 1 : -1;
    const factor = direction > 0 ? 1.1 : 1 / 1.1;
    setViewport((current) => clampViewport(zoomViewportAtPoint(current, point, current.zoom * factor)));
  }

  function beginViewportPan(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 1) return;
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
    blurFocusedControl();
    onSelectedLayerChange(undefined);
  }

  function handleViewportPointerDown(event: PointerEvent<HTMLDivElement>) {
    beginViewportPan(event);
    if (event.button !== 0) return;
    if (!isEditorInteractiveTarget(event.target)) clearSelection();
  }

  function handleCanvasPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
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

  function resetViewport() {
    setPanInteraction(null);
    fitViewport();
  }

  if (!template) {
    return (
      <div className="flex aspect-[53.98/85.6] w-full items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-neutral-50 text-sm font-medium text-neutral-500">
        템플릿 없음
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      className={`relative w-full overflow-hidden overscroll-contain rounded-lg bg-neutral-100 ${fillContainer ? 'h-full min-h-0' : ''} ${panInteraction ? 'cursor-grabbing' : 'cursor-default'}`}
      style={fillContainer ? undefined : { minHeight: workspaceMinHeight }}
      onWheel={handleViewportWheel}
      onPointerDown={handleViewportPointerDown}
      onPointerMove={updateViewportPan}
      onPointerUp={endViewportPan}
      onPointerCancel={endViewportPan}
      onAuxClick={(event) => event.preventDefault()}
    >
      <button
        type="button"
        data-editor-ui="true"
        onClick={resetViewport}
        className="hidden"
        title="카드를 중앙에 맞추고 보기 크기를 기본으로 되돌립니다."
      >
        보기 초기화
      </button>
      <div data-editor-ui="true" className="absolute right-2 top-2 z-[1200] flex flex-wrap justify-end gap-1">
        <button
          type="button"
          onClick={resetViewport}
          className="rounded-md border border-line bg-white/95 px-2 py-1 text-xs font-medium text-neutral-700 shadow-sm hover:bg-blue-50"
          title="카드를 중앙에 맞추고 보기 크기를 기본으로 되돌립니다."
        >
          보기 초기화
        </button>
      </div>
      <div
        ref={canvasRef}
        className="relative w-full overflow-visible border border-neutral-700 shadow-surface"
        style={{
          aspectRatio: `${template.canvas.width} / ${template.canvas.height}`,
          background: getCardBackgroundColor(template.canvas, palette.secondary),
          borderRadius: cardOutlineRadiusCss(template.canvas),
          transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
          transformOrigin: '0 0',
        }}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={updateInteraction}
        onPointerUp={endInteraction}
        onPointerCancel={endInteraction}
      >
      <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
        <div
          className="pointer-events-none absolute"
          style={{
            ...canvasInsetRectPercent(canvasCutOffsetPx(template.canvas), template.canvas),
            background: getStickerBackgroundColor(template.canvas, palette.secondary),
            borderRadius: cuttingLineRadiusCss(template.canvas),
            zIndex: 0,
          }}
        />
        {orderedTemplateLayers(template).map((layer) => {
          if (layer.data?.visible === false) return null;
          if (layer.type === 'background') {
            return null;
          }
          if (isTemplateShapeLayer(layer)) {
            return (
              <div
                key={layer.id}
                className="absolute"
                style={{
                  ...layerStyle(layer, template),
                  pointerEvents: isTemplateShapeFillTransparent(layer) ? 'none' : 'auto',
                }}
              >
                <TemplateShapeLayer layer={layer} canvas={template.canvas} />
              </div>
            );
          }
          const imageDataUrl = templateImageDataUrl(layer);
          const asset = imageDataUrl ? undefined : slotAsset(layer, card, assetsById, side);
          const transform = transformForLayer(layer);
          const isImageLayer = isTemplateImageLayer(layer) && Boolean(asset?.objectUrl);
          return (
            <div
              key={layer.id}
              className="absolute flex items-center justify-center overflow-hidden rounded-sm px-1 text-center text-[10px] font-semibold"
              style={{
                ...layerStyle(layer, template),
                background: layer.fill ?? (asset || imageDataUrl ? 'transparent' : 'rgba(255,255,255,0.35)'),
                borderRadius: layerCornerRadiusCss(layer, template.canvas),
                color: layer.data?.color ? String(layer.data.color) : palette.neutral,
              }}
            >
            {asset?.objectUrl || imageDataUrl ? (
              <img
                data-card-image-target={asset?.objectUrl ? 'true' : undefined}
                data-selectable-layer={isImageLayer ? 'true' : undefined}
                data-editor-interactive={isImageLayer ? 'true' : undefined}
                src={asset?.objectUrl ?? imageDataUrl}
                alt=""
                draggable={false}
                className={`absolute max-w-none touch-none select-none ${asset?.objectUrl ? 'cursor-move' : ''}`}
                style={imageStyle(layer, template, transform, imageNaturalSizeForLayer(layer, asset))}
                onPointerDown={isImageLayer ? (event) => beginMove(layer, event) : undefined}
              />
            ) : layer.slotType === 'titleImage' || layer.slotType === 'gameLogo' ? (
              card.front.titleText
            ) : (
              slotText(layer, card, side)
            )}
            </div>
          );
        })}
      </div>

        {selectedLayer && isTemplateImageLayer(selectedLayer) && (
          (() => {
            const frame = getTemplateLayerFrame(selectedLayer, template.canvas);
            const transform = transformForLayer(selectedLayer);
            return (
          <div
            data-card-image-overlay="true"
            data-editor-interactive="true"
            className="absolute cursor-move touch-none select-none"
            style={{
              left: `${((frame.x + transform.x) / template.canvas.width) * 100}%`,
              top: `${((frame.y + transform.y) / template.canvas.height) * 100}%`,
              width: `${(transform.width / template.canvas.width) * 100}%`,
              height: `${(transform.height / template.canvas.height) * 100}%`,
              transform: `rotate(${transform.rotation ?? 0}deg)`,
              zIndex: 1000,
              borderRadius: '4px',
            }}
            onPointerDown={(event) => beginMove(selectedLayer, event)}
          >
            <div
              className="pointer-events-none absolute inset-0 rounded-[inherit]"
              style={{
                border: `${1 / viewport.zoom}px solid rgba(243,108,33,0.72)`,
                boxShadow: `0 0 0 ${1 / viewport.zoom}px rgba(255,255,255,0.55)`,
              }}
            />
            {[
              { key: 'top-left', left: '0%', top: '0%' },
              { key: 'top-right', left: '100%', top: '0%' },
              { key: 'bottom-left', left: '0%', top: '100%' },
              { key: 'bottom-right', left: '100%', top: '100%' },
            ].map((handle) => (
              <button
                key={handle.key}
                type="button"
                data-transform-handle="true"
                aria-label="Resize image"
                onPointerDown={(event) => beginResize(selectedLayer, event)}
                className="absolute h-6 w-6 touch-none rounded-full border-0 bg-transparent p-0"
                style={{ left: handle.left, top: handle.top, transform: 'translate(-50%, -50%)' }}
              >
                <span
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-zaparoo/90 shadow-sm"
                  style={{
                    width: `${8 / viewport.zoom}px`,
                    height: `${8 / viewport.zoom}px`,
                    borderWidth: `${1 / viewport.zoom}px`,
                  }}
                />
              </button>
            ))}
          </div>
            );
          })()
        )}
      </div>
    </div>
  );
}
