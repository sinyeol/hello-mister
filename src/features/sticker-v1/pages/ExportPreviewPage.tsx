import { type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Copy, Printer, Save, Trash2 } from 'lucide-react';
import { PrintSheetPreview } from '@sticker-v1/components/export/PrintSheetPreview';
import { PageHeader } from '@sticker-v1/components/common/PageHeader';
import { computeSheetGrid, createSheetPlacements } from '@sticker-v1/export/sheetLayout';
import type { CuttingFilePage } from '@sticker-v1/services/export/exportCuttingFile';
import {
  clearActiveSheetPageItems,
  createPrintPageDescriptors,
  createSheetCardItems,
  moveSheetItem,
  sheetCardIdsFromItems,
} from '@sticker-v1/services/export/sheetEditorState';
import type { ExportSummary } from '@sticker-v1/services/export/exportSummary';
import {
  hydrateSavedPrintSheets,
  loadSavedPrintSheets,
  makeSavedJobName,
  savePrintSheets,
  type SavedPrintSheet,
} from '@sticker-v1/services/export/savedSheets';
import { loadSavedCardsByIdsFromIndexedDb } from '@sticker-v1/services/cards/savedCardsPersistence';
import { cardImageReferenceKey, uniqueCardImageReferences } from '@sticker-v1/services/assets/cardImagePersistence';
import { mergeAssetsIntoLibrary, restoreUsedImageAssets } from '@sticker-v1/services/assets/usedImageCache';
import { useProjectStore } from '@sticker-v1/store/projectStore';
import { emptyAssetLibrary } from '@sticker-v1/mock/sampleAssets';
import { resolveAssetReference } from '@sticker-v1/utils/assetReferences';
import { templateForCardSide } from '@sticker-v1/utils/cardTemplateSnapshots';
import { getLayerOverrideKey, getTemplateLayerFrame, getTemplateLayerImageTransform, isTemplateImageLayer } from '@sticker-v1/utils/cardTemplateTransforms';
import { getCardBackgroundColor, getStickerBackgroundColor } from '@sticker-v1/utils/cardGeometry';
import type { RenderedSheetImage } from '@sticker-v1/services/export/sheetDomExport';
import type { AssetReference, CardItem, ExportSettings, ExportSideMode, LocalAsset, SheetCardItem, SheetCardPlacement, Template } from '@sticker-v1/types';

type PrintPreparationStatus = 'idle' | 'preparing' | 'ready' | 'warning' | 'error';

interface PrintPreparationState {
  status: PrintPreparationStatus;
  loadedImages: number;
  totalImages: number;
  missingImages: number;
  failedImages: number;
  warnings: string[];
  elapsedMs?: number;
}

interface PrintImageSource {
  url: string;
  label: string;
}

const initialPrintPreparation: PrintPreparationState = {
  status: 'idle',
  loadedImages: 0,
  totalImages: 0,
  missingImages: 0,
  failedImages: 0,
  warnings: [],
};

// Unselected / reset preview size for a sheet page (50% of the column width).
const DEFAULT_PAGE_ZOOM = 0.5;

function sidesForMode(sideMode: ExportSideMode) {
  if (sideMode === 'front') return ['front'] as const;
  if (sideMode === 'back') return ['back'] as const;
  return ['front', 'back'] as const;
}

function templateForPrintCard(card: CardItem, side: 'front' | 'back', templates: Template[]) {
  return templateForCardSide(card, templates, side);
}

function cardPrintImageReferences(card: CardItem, side: 'front' | 'back') {
  const refs: Array<{ label: string; assetId?: string; reference?: AssetReference }> = [];
  if (side === 'front') {
    refs.push(
      { label: '앞면 배경', assetId: card.front.backgroundImageAssetId, reference: card.front.backgroundImageAssetRef },
      { label: 'Main Image', assetId: card.front.heroImageAssetId, reference: card.front.heroImageAssetRef },
      { label: 'Clear Logo', assetId: card.front.titleImageAssetId, reference: card.front.titleImageAssetRef },
      { label: '앞면 로고', assetId: card.front.brandLogoAssetId, reference: card.front.brandLogoAssetRef },
    );
  } else {
    refs.push(
      { label: '뒷면 배경', assetId: card.back.backgroundImageAssetId, reference: card.back.backgroundImageAssetRef },
      { label: '뒷면 로고', assetId: card.back.brandLogoAssetId, reference: card.back.brandLogoAssetRef },
    );
  }
  return refs.filter((ref) => ref.assetId || ref.reference);
}

function collectPrintImageSources(cards: CardItem[], assetsById: Record<string, LocalAsset>, templates: Template[], sideMode: ExportSideMode) {
  const sourceMap = new Map<string, PrintImageSource>();
  const warnings: string[] = [];
  let missingImages = 0;

  cards.forEach((card) => {
    sidesForMode(sideMode).forEach((side) => {
      cardPrintImageReferences(card, side).forEach(({ label, assetId, reference }) => {
        const asset = resolveAssetReference(assetsById, assetId, reference);
        if (asset?.objectUrl) {
          sourceMap.set(asset.objectUrl, {
            url: asset.objectUrl,
            label: `${card.front.titleText || card.id} / ${label}`,
          });
          return;
        }
        missingImages += 1;
        warnings.push(`${card.front.titleText || card.id}: ${label} 이미지 참조를 찾지 못했습니다.`);
      });

      const template = templateForPrintCard(card, side, templates);
      template?.layers.forEach((layer) => {
        const imageDataUrl = typeof layer.data?.imageDataUrl === 'string' ? layer.data.imageDataUrl : undefined;
        if (!imageDataUrl) return;
        sourceMap.set(imageDataUrl, {
          url: imageDataUrl,
          label: `${card.front.titleText || card.id} / template:${layer.id}`,
        });
      });
    });
  });

  return { sources: Array.from(sourceMap.values()), warnings, missingImages };
}

function printBackgroundDiagnostics(cards: CardItem[], templates: Template[], sideMode: ExportSideMode) {
  return cards.flatMap((card) => sidesForMode(sideMode).map((side) => {
    const template = templateForPrintCard(card, side, templates);
    return {
      cardId: card.id,
      side,
      templateId: template?.id,
      cardBackgroundColor: template ? getCardBackgroundColor(template.canvas) : undefined,
      stickerBackgroundColor: template ? getStickerBackgroundColor(template.canvas) : undefined,
    };
  }));
}

function decodePrintImage(source: PrintImageSource) {
  return new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (typeof image.decode === 'function') {
        void image.decode().then(resolve).catch(() => resolve());
        return;
      }
      resolve();
    };
    image.onerror = () => reject(new Error(`${source.label} 이미지를 불러오지 못했습니다.`));
    image.src = source.url;
  });
}

async function waitForImagesInElement(element: Element) {
  const images = Array.from(element.querySelectorAll('img'));
  await Promise.all(
    images.map((image) => {
      const htmlImage = image as HTMLImageElement;
      if (htmlImage.complete && htmlImage.naturalWidth > 0) {
        if (typeof htmlImage.decode === 'function') return htmlImage.decode().catch(() => undefined);
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        htmlImage.onload = () => resolve();
        htmlImage.onerror = () => resolve();
      });
    }),
  );
}

export function ExportPreviewPage() {
  const {
    cards,
    categories,
    assetLibrary,
    templates,
    printQueueIds,
    exportSettings,
    updateExportSettings,
    setAssetLibrary,
  } = useProjectStore();
  const [exportSummary, setExportSummary] = useState<ExportSummary | undefined>();
  const [sheetItems, setSheetItems] = useState<SheetCardItem[]>([]);
  const [selectedSheetItemIds, setSelectedSheetItemIds] = useState<string[]>([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [savedSheets, setSavedSheets] = useState<SavedPrintSheet[]>(() => loadSavedPrintSheets());
  // The saved job currently loaded into the live preview (so "업데이트" only rewrites that one job).
  const [loadedJobId, setLoadedJobId] = useState<string | null>(null);
  const [renamingJobId, setRenamingJobId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [queuedRecords, setQueuedRecords] = useState<Awaited<ReturnType<typeof loadSavedCardsByIdsFromIndexedDb>>>([]);
  const [preparedAssetsById, setPreparedAssetsById] = useState<Record<string, LocalAsset> | undefined>();
  const [printPreparation, setPrintPreparation] = useState<PrintPreparationState>(initialPrintPreparation);
  // Per-sheet preview zoom: select a page → wheel zooms THAT page (CSS zoom, preview-only — never reaches the export/print mirror);
  // nothing selected → wheel scrolls the vertical list of sheets.
  const [selectedPageIndex, setSelectedPageIndex] = useState<number | null>(null);
  const [pageZooms, setPageZooms] = useState<Record<number, number>>({});
  const sheetScrollRef = useRef<HTMLDivElement>(null);
  const selectedPageRef = useRef<number | null>(null);
  const pageZoomsRef = useRef<Record<number, number>>({});
  // Scroll compensation to keep the cursor's content point fixed while wheel-zooming (zoom toward cursor).
  const pendingFocalRef = useRef<{ dLeft: number; dTop: number } | null>(null);
  // Scroll position captured when a page is selected, restored when it is deselected.
  const selectionScrollRef = useRef<{ left: number; top: number } | null>(null);
  const pendingRestoreScrollRef = useRef<{ left: number; top: number } | null>(null);
  // Middle-button (wheel click) drag-pan of the sheet scroll area.
  const middlePanRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number; pointerId: number } | null>(null);
  const printPreparationRef = useRef<PrintPreparationState>(initialPrintPreparation);
  const openPdfAfterExport = true;
  const printableCardsRef = useRef<CardItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (printQueueIds.length === 0) {
      setQueuedRecords([]);
      return () => {
        cancelled = true;
      };
    }
    void loadSavedCardsByIdsFromIndexedDb(printQueueIds).then((records) => {
      if (cancelled) return;
      setQueuedRecords(records.filter((record) => !record.deletedAt));
    });
    return () => {
      cancelled = true;
    };
  }, [printQueueIds]);

  const queuedCards: CardItem[] = useMemo(
    () =>
      queuedRecords.map((record, index) => {
        const liveWorkingCard = cards.find((card) => !card.deleted && card.id === record.card.id);
        const sourceCard = liveWorkingCard ?? record.card;
        return {
          ...sourceCard,
          id: `print_queue_${index}_${sourceCard.id}`,
          printOrder: index,
          coordinateLockKey: `print-queue:${index}:${record.id}`,
          deleted: false,
        };
      }),
    [cards, queuedRecords],
  );

  const fallbackCards = useMemo(
    () => cards.filter((card) => !card.deleted).sort((a, b) => a.printOrder - b.printOrder),
    [cards],
  );
  const sourcePrintableCards = useMemo(
    () => (queuedCards.length > 0 ? queuedCards : fallbackCards),
    [fallbackCards, queuedCards],
  );
  const sourcePrintableKey = sourcePrintableCards.map((card) => card.id).join('|');

  useEffect(() => {
    updateExportSettings({ sideMode: 'front', includeBack: false });
  }, [updateExportSettings]);

  useEffect(() => {
    setSheetItems(createSheetCardItems(sourcePrintableCards.map((card) => card.id)));
    setSelectedSheetItemIds([]);
    setSelectedPageIndex(null);
    setPageZooms({});
    setLoadedJobId(null);
  }, [sourcePrintableKey, sourcePrintableCards]);

  useEffect(() => {
    void savePrintSheets(savedSheets);
  }, [savedSheets]);

  useEffect(() => {
    let cancelled = false;
    void hydrateSavedPrintSheets().then((sheets) => {
      if (!cancelled && sheets.length > 0) setSavedSheets(sheets);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const sheetCardIds = useMemo(() => sheetCardIdsFromItems(sheetItems), [sheetItems]);
  const printableCards = useMemo(
    () => sheetItems.map((item) => sourcePrintableCards.find((card) => card.id === item.cardId)).filter((card): card is CardItem => Boolean(card)),
    [sheetItems, sourcePrintableCards],
  );
  useEffect(() => {
    printableCardsRef.current = printableCards;
  }, [printableCards]);
  const isUsingPrintQueue = queuedCards.length > 0;
  const cardsById = Object.fromEntries(printableCards.map((card) => [card.id, card]));
  const categoriesById = Object.fromEntries(categories.map((category) => [category.id, category]));
  const assetsById = assetLibrary?.assetsById ?? {};
  const sideMode: ExportSideMode = exportSettings.sideMode ?? 'front';
  const includeFront = sideMode !== 'back';
  const includeBack = sideMode !== 'front';
  const sheetPairs = createSheetPlacements(sheetItems, exportSettings);
  const sheetGrid = computeSheetGrid(exportSettings);
  const visibleSheetPairs = sheetPairs.filter((pair) => pair.frontPlacements.length > 0 || pair.backPlacements.length > 0);
  const cardsPerSheet = exportSettings.columns * exportSettings.rows;
  const printPageDescriptors = createPrintPageDescriptors(printableCards.length, cardsPerSheet, sideMode);
  const pdfPageCount = printPageDescriptors.length;
  const safeActiveSheetIndex = visibleSheetPairs.length > 0 ? Math.min(activeSheetIndex, visibleSheetPairs.length - 1) : 0;
  // Per-job thumbnail: first page placements (computed with that job's own settings) + total sheet count.
  const savedJobPreviews = useMemo(() => {
    const entries = savedSheets.map((job) => {
      const settings = job.settings ?? exportSettings;
      const items = (job.cardIds ?? []).map((cardId, index) => ({ cardId, sheetItemId: `job-preview:${job.id}:${index}:${cardId}` }));
      const pairs = createSheetPlacements(items, settings);
      const visible = pairs.filter((pair) => pair.frontPlacements.length > 0 || pair.backPlacements.length > 0);
      const side: 'front' | 'back' = job.sideMode === 'back' ? 'back' : 'front';
      const first = visible[0];
      const placements = side === 'back' ? (first?.backPlacements ?? []) : (first?.frontPlacements ?? first?.backPlacements ?? []);
      return [job.id, { placements, side, sheetCount: visible.length, settings }] as const;
    });
    return Object.fromEntries(entries);
  }, [savedSheets, exportSettings]);
  const loadedJobName = loadedJobId ? savedSheets.find((job) => job.id === loadedJobId)?.name : undefined;
  const cardReferenceKey = cardImageReferenceKey(printableCards);
  const exportDpi = exportSettings.dpi ?? 300;
  const printReadyWidthPx = Math.round((sheetGrid.pageWidthMm / 25.4) * exportDpi);

  useEffect(() => {
    if (typeof window === 'undefined' || !['localhost', '127.0.0.1'].includes(window.location.hostname)) return;
    const backDiagnostics = printableCards.map((card) => {
      const template = templateForCardSide(card, templates, 'back');
      const imageLayers = template?.layers.filter(isTemplateImageLayer) ?? [];
      return {
        cardId: card.id,
        title: card.front.titleText,
        source: isUsingPrintQueue ? 'printQueue' : 'workingCards',
        usedCurrentWorkingCard: isUsingPrintQueue && cards.some((candidate) => !candidate.deleted && card.id.endsWith(candidate.id)),
        backTemplateId: card.back.templateId,
        backTemplateName: template?.name,
        backMainImageAssetId: card.back.backgroundImageAssetId,
        backClearLogoAssetId: card.back.brandLogoAssetId,
        layers: imageLayers.map((layer) => ({
          layerId: layer.id,
          slotType: layer.slotType,
          resolvedLayerFrame: getTemplateLayerFrame(layer, template?.canvas),
          cardOverride: card.back.slotOverrides?.[getLayerOverrideKey(layer)],
          resolvedImageTransform: getTemplateLayerImageTransform(layer, card, 'back'),
          fallbackBoundsUsed: !layer.width && !layer.height && !layer.slot?.width && !layer.slot?.height,
        })),
      };
    });
    console.debug('[PrintSheet] resolved back render state', {
      isUsingPrintQueue,
      queuedRecordCount: queuedRecords.length,
      workingCardCount: cards.filter((card) => !card.deleted).length,
      sideMode,
      backDiagnostics,
      staleCachedSnapshotUsed: false,
      fitStretchOrDefaultZoomAppliedByPrint: false,
    });
  }, [cards, isUsingPrintQueue, printableCards, queuedRecords.length, sideMode, templates]);
  function applyPrintPreparation(nextState: PrintPreparationState) {
    printPreparationRef.current = nextState;
    setPrintPreparation(nextState);
  }

  useEffect(() => {
    setActiveSheetIndex((current) => Math.max(0, Math.min(current, Math.max(0, visibleSheetPairs.length - 1))));
    setSelectedPageIndex((current) => (current != null && current > visibleSheetPairs.length - 1 ? null : current));
  }, [visibleSheetPairs.length]);

  useEffect(() => {
    selectedPageRef.current = selectedPageIndex;
  }, [selectedPageIndex]);

  useEffect(() => {
    pageZoomsRef.current = pageZooms;
  }, [pageZooms]);

  // Keep the cursor's content point fixed while wheel-zooming, and restore the original scroll
  // position when a page is deselected (origin-top-left width growth would otherwise drift).
  useLayoutEffect(() => {
    const el = sheetScrollRef.current;
    if (!el) return;
    if (pendingRestoreScrollRef.current) {
      const { left, top } = pendingRestoreScrollRef.current;
      pendingRestoreScrollRef.current = null;
      pendingFocalRef.current = null;
      el.scrollLeft = left;
      el.scrollTop = top;
      return;
    }
    const focal = pendingFocalRef.current;
    if (!focal) return;
    pendingFocalRef.current = null;
    el.scrollLeft += focal.dLeft;
    el.scrollTop += focal.dTop;
  }, [pageZooms, selectedPageIndex]);

  // Non-passive wheel listener so we can preventDefault: React's onWheel is passive and cannot stop scroll.
  // A page selected → wheel zooms that page toward the cursor; nothing selected → let the container scroll natively.
  useEffect(() => {
    const el = sheetScrollRef.current;
    if (!el) return undefined;
    const onWheel = (event: WheelEvent) => {
      const target = selectedPageRef.current;
      if (target == null) return;
      event.preventDefault();
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      const oldZoom = pageZoomsRef.current[target] ?? DEFAULT_PAGE_ZOOM;
      applyPageZoomFocal(target, clampZoom(oldZoom * factor), event.clientX, event.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const references = uniqueCardImageReferences(printableCardsRef.current);
    if (references.length === 0) return () => {
      cancelled = true;
    };

    void restoreUsedImageAssets(references).then((restoredAssets) => {
      if (cancelled || restoredAssets.length === 0) return;
      const currentLibrary = useProjectStore.getState().assetLibrary ?? emptyAssetLibrary;
      setAssetLibrary(mergeAssetsIntoLibrary(currentLibrary, restoredAssets));
    });

    return () => {
      cancelled = true;
    };
  }, [cardReferenceKey, setAssetLibrary]);

  async function resolveExportAssets() {
    const references = uniqueCardImageReferences(printableCards);
    if (references.length === 0) return useProjectStore.getState().assetLibrary?.assetsById ?? assetsById;
    const restoredAssets = await restoreUsedImageAssets(references);
    if (restoredAssets.length === 0) return useProjectStore.getState().assetLibrary?.assetsById ?? assetsById;
    const mergedLibrary = mergeAssetsIntoLibrary(useProjectStore.getState().assetLibrary ?? emptyAssetLibrary, restoredAssets);
    setAssetLibrary(mergedLibrary);
    return mergedLibrary.assetsById;
  }

  async function preparePrintRenderData() {
    const startedAt = performance.now();
    applyPrintPreparation({
      ...initialPrintPreparation,
      status: 'preparing',
    });
    setPreparedAssetsById(undefined);

    const exportAssetsById = await resolveExportAssets();
    const { sources, warnings, missingImages } = collectPrintImageSources(printableCards, exportAssetsById, templates, sideMode);
    let loadedImages = 0;
    let failedImages = 0;
    const decodeWarnings = [...warnings];

    applyPrintPreparation({
      status: 'preparing',
      loadedImages: 0,
      totalImages: sources.length,
      missingImages,
      failedImages: 0,
      warnings: decodeWarnings,
    });

    for (const source of sources) {
      try {
        await decodePrintImage(source);
        loadedImages += 1;
      } catch (error) {
        failedImages += 1;
        decodeWarnings.push(error instanceof Error ? error.message : `${source.label} 이미지를 불러오지 못했습니다.`);
      }
      applyPrintPreparation({
        status: 'preparing',
        loadedImages,
        totalImages: sources.length,
        missingImages,
        failedImages,
        warnings: decodeWarnings,
      });
    }

    const elapsedMs = Math.round(performance.now() - startedAt);
    const nextState: PrintPreparationState = {
      status: missingImages > 0 || failedImages > 0 ? 'warning' : 'ready',
      loadedImages,
      totalImages: sources.length,
      missingImages,
      failedImages,
      warnings: decodeWarnings,
      elapsedMs,
    };
    setPreparedAssetsById(exportAssetsById);
    applyPrintPreparation(nextState);

    if (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      console.debug('[PrintSheet] prepared print data', {
        sheetItems: sheetItems.length,
        fullCardRecordsLoaded: 0,
        imageRefsFound: sources.length + missingImages,
        imagesDecoded: loadedImages,
        imagesFailed: failedImages,
        missingImages,
        fallbackThumbnails: 0,
        elapsedMs,
        printBlocked: false,
      });
    }

    return exportAssetsById;
  }

  function waitForPrintReadyRender() {
    return new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
    });
  }

  async function renderCurrentSheetImages() {
    console.info('[SheetExport] image preparation start', { dpi: exportDpi, cards: printableCards.length });
    await preparePrintRenderData();
    console.info('[SheetExport] image preparation complete');
    await waitForPrintReadyRender();
    const root = document.querySelector('.print-ready-output-area');
    if (!root) throw new Error('print-ready-output-area를 찾지 못했습니다.');
    const { renderPrintSheetElementsToPngBlobs } = await import('@sticker-v1/services/export/sheetDomExport');
    const images = await renderPrintSheetElementsToPngBlobs(root, exportDpi);
    console.info('[SheetExport] canvas render complete', {
      images: images.length,
      totalBlobBytes: images.reduce((total, image) => total + image.blob.size, 0),
    });
    return images;
  }

  async function exportCurrentPrintSheetToPdf(options: { openAfterExport?: boolean } = {}) {
    console.info('[SheetExport] PDF export start');
    const [{ exportSheetImagesPdf }, { saveBytes }] = await Promise.all([
      import('@sticker-v1/services/export/exportPdf'),
      import('@sticker-v1/services/export/download'),
    ]);
    if (saveBytes) {
      try {
        const sheetImages = await renderCurrentSheetImages();
        const result = await exportSheetImagesPdf(sheetImages, { exportedCardsCount: printableCards.length, dpi: exportDpi });
        console.info('[SheetExport] PDF created', { bytes: result.bytes.byteLength, pages: sheetImages.length });
        setExportSummary(result.summary);
        const filename = 'hello-mister-card-stickers.pdf';
        const saveResult = await saveBytes(result.bytes, filename, 'application/pdf');
        if (saveResult.canceled) {
          window.alert('PDF 내보내기가 취소되었습니다.');
          return;
        }
        if (!saveResult.ok) throw new Error(saveResult.error ?? 'PDF 파일 저장에 실패했습니다.');
        if (options.openAfterExport && saveResult.path && window.zaparooDesktop?.openFile) {
          const openResult = await window.zaparooDesktop.openFile(saveResult.path);
          if (!openResult.ok) window.alert(`PDF를 Windows 기본 앱으로 열지 못했습니다.\n${openResult.error ?? ''}`);
        }
        window.alert(saveResult.path ? `PDF를 저장했습니다.\n${saveResult.path}` : 'PDF를 저장했습니다.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[SheetExport] PDF export failed', error);
        window.alert(`PDF 내보내기에 실패했습니다.\n${message}`);
      }
      return;
    }
    const sheetImages = await renderCurrentSheetImages();
    const result = await exportSheetImagesPdf(sheetImages, { exportedCardsCount: printableCards.length, dpi: exportDpi });
    setExportSummary(result.summary);
    const filename = 'hello-mister-card-stickers.pdf';
    if (options.openAfterExport && window.zaparooDesktop?.saveAndOpenPdf) {
      const openResult = await window.zaparooDesktop.saveAndOpenPdf(result.bytes, filename);
      if (openResult.ok) return;
      window.alert(`PDF를 Windows 기본 앱으로 열지 못했습니다.\n${openResult.error ?? ''}`);
    }
    throw new Error('PDF save function is unavailable.');
  }

  function currentCuttingFilePages(): CuttingFilePage[] {
    return visibleSheetPairs.flatMap((pair) => {
      const pages: CuttingFilePage[] = [];
      if (includeFront) {
        pages.push({
          placements: pair.frontPlacements,
          side: 'front',
          cardsById,
          templates,
          title: `Sheet ${pair.sheetIndex + 1} front cut lines`,
        });
      }
      if (includeBack) {
        pages.push({
          placements: pair.backPlacements,
          side: 'back',
          cardsById,
          templates,
          title: `Sheet ${pair.sheetIndex + 1} back cut lines`,
        });
      }
      return pages;
    });
  }

  async function handleCuttingFileExport() {
    const { exportCuttingSvgFiles } = await import('@sticker-v1/services/export/exportCuttingFile');
    const result = await exportCuttingSvgFiles(currentCuttingFilePages(), exportSettings);
    if (result.pageCount === 0) {
      window.alert('내보낼 컷팅 라인이 있는 인쇄 시트가 없습니다.');
    }
  }

  async function handlePngZipExport() {
    console.info('[SheetExport] PNG export start');
    try {
      const sheetImages = await renderCurrentSheetImages();
      const [{ exportRenderedSheetPngZip }, { saveBytes }] = await Promise.all([
        import('@sticker-v1/services/export/sheetDomExport'),
        import('@sticker-v1/services/export/download'),
      ]);
      const result = await exportRenderedSheetPngZip(sheetImages, { exportedCardsCount: printableCards.length, dpi: exportDpi });
      console.info('[SheetExport] PNG/ZIP blob created', {
        filename: result.filename,
        mimeType: result.mimeType,
        bytes: result.bytes.byteLength,
        sheets: sheetImages.length,
      });
      setExportSummary(result.summary);
      const saveResult = await saveBytes(result.bytes, result.filename, result.mimeType);
      if (saveResult.canceled) {
        window.alert('PNG 내보내기가 취소되었습니다.');
        return;
      }
      if (!saveResult.ok) throw new Error(saveResult.error ?? 'PNG 파일 저장에 실패했습니다.');
      window.alert(saveResult.path ? `PNG 내보내기를 저장했습니다.\n${saveResult.path}` : 'PNG 내보내기를 저장했습니다.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[SheetExport] PNG export failed', error);
      window.alert(`PNG 내보내기에 실패했습니다.\n${message}`);
    }
  }

  function updateSideMode(mode: ExportSideMode) {
    updateExportSettings({ sideMode: mode, includeBack: mode === 'duplex' });
  }

  function updateDpi(dpi: 300 | 600) {
    updateExportSettings({ dpi });
  }

  function moveSheetCard(fromSheetItemId: string, toSheetItemId: string) {
    setSheetItems((current) => {
      const fromItem = current.find((item) => item.sheetItemId === fromSheetItemId);
      const toItem = current.find((item) => item.sheetItemId === toSheetItemId);
      if (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
        console.debug('[PrintSheet] move card', {
          fromSheetItemId,
          toSheetItemId,
          fromCardId: fromItem?.cardId,
          toCardId: toItem?.cardId,
        });
      }
      return moveSheetItem(current, fromSheetItemId, toSheetItemId);
    });
  }

  function toggleSheetItem(sheetItemId: string) {
    setSelectedSheetItemIds((current) => (current.includes(sheetItemId) ? current.filter((id) => id !== sheetItemId) : [...current, sheetItemId]));
  }

  function removeSelectedFromSheet() {
    if (selectedSheetItemIds.length === 0) return;
    const selected = new Set(selectedSheetItemIds);
    setSheetItems((current) => current.filter((item) => !selected.has(item.sheetItemId)));
    setSelectedSheetItemIds([]);
  }

  // Insert one copy right after each selected card; existing cards shift back in print order.
  function duplicateSelectedOnSheet() {
    if (selectedSheetItemIds.length === 0) {
      window.alert('복제할 카드를 먼저 선택하세요.');
      return;
    }
    const selected = new Set(selectedSheetItemIds);
    const stamp = Date.now();
    let seq = 0;
    setSheetItems((current) => {
      const next: SheetCardItem[] = [];
      current.forEach((item) => {
        next.push(item);
        if (selected.has(item.sheetItemId)) {
          next.push({ cardId: item.cardId, sheetItemId: `sheet-item:dup:${stamp}:${seq}:${item.cardId}` });
          seq += 1;
        }
      });
      return next;
    });
  }

  function clearActiveSheet() {
    setSheetItems((current) => {
      const next = clearActiveSheetPageItems(current, safeActiveSheetIndex, cardsPerSheet);
      const nextSheetCount = Math.max(1, Math.ceil(next.length / cardsPerSheet));
      setActiveSheetIndex((index) => Math.min(index, nextSheetCount - 1));
      return next;
    });
    setSelectedSheetItemIds([]);
  }

  async function openSystemPrintDialogFromSheetImages(sheetImages: RenderedSheetImage[]) {
    if (printPreparationRef.current.status === 'preparing') return;
    if (sheetImages.length === 0) {
      window.alert('인쇄할 A4 시트 이미지가 없습니다.');
      return;
    }
    const objectUrls = sheetImages.map((image) => URL.createObjectURL(image.blob));
    const printWindow = window.open('', 'hello-mister-sheet-print', 'width=1200,height=900');
    if (!printWindow) {
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      throw new Error('시스템 인쇄창을 열 수 없습니다. 팝업 차단 설정을 확인해 주세요.');
    }
    const pageWmm = sheetImages[0].pageWidthMm || 297;
    const pageHmm = sheetImages[0].pageHeightMm || 210;
    const pagesHtml = objectUrls.map((url, index) => (
      `<section class="sheet-print-page" data-sheet-side="${sheetImages[index].side}" data-sheet-index="${sheetImages[index].sheetIndex}"><img src="${url}" alt="Sheet ${index + 1}" /></section>`
    )).join('\n');
    printWindow.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Hello Mister sheet print</title>
  <style>
    @page { size: ${pageWmm}mm ${pageHmm}mm; margin: 0; }
    html,
    body {
      margin: 0;
      padding: 0;
      width: ${pageWmm}mm;
      min-height: ${pageHmm}mm;
      background: #ffffff;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
    .sheet-print-page {
      width: ${pageWmm}mm;
      height: ${pageHmm}mm;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background: #ffffff;
      break-after: page;
      page-break-after: always;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
    .sheet-print-page:last-child {
      break-after: auto;
      page-break-after: auto;
    }
    .sheet-print-page img {
      display: block;
      width: ${pageWmm}mm;
      height: ${pageHmm}mm;
      object-fit: fill;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
  </style>
</head>
<body>
  ${pagesHtml}
</body>
</html>`);
    printWindow.document.close();
    printWindow.focus();
    await waitForImagesInElement(printWindow.document.body);
    console.info('[SheetPrint] sheet image print window ready', {
      pages: sheetImages.length,
      totalBlobBytes: sheetImages.reduce((total, image) => total + image.blob.size, 0),
      printColorAdjustExact: true,
    });
    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      printWindow.close();
    };
    printWindow.addEventListener('afterprint', () => window.setTimeout(cleanup, 250), { once: true });
    printWindow.print();
    window.setTimeout(cleanup, 5000);
  }

  function shouldPrintWithWarnings(state: PrintPreparationState) {
    if (state.missingImages === 0 && state.failedImages === 0) return true;
    return window.confirm('누락되었거나 불러오지 못한 이미지가 있습니다. 그래도 인쇄할까요?');
  }

  async function printCurrentSheetDirect() {
    if (printPreparationRef.current.status === 'preparing') return;
    let renderedSheetImagesForPrint: RenderedSheetImage[];
    try {
      renderedSheetImagesForPrint = await renderCurrentSheetImages();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[SheetPrint] print failed', error);
      applyPrintPreparation({
        ...initialPrintPreparation,
        status: 'error',
        warnings: [message],
      });
      window.alert(`인쇄 준비에 실패했습니다.\n${message}`);
      return;
    }
    await preparePrintRenderData().catch((error) => {
      applyPrintPreparation({
        ...initialPrintPreparation,
        status: 'error',
        warnings: [error instanceof Error ? error.message : '인쇄 준비 중 오류가 발생했습니다.'],
      });
    });
    const preparedState = printPreparationRef.current;
    if (preparedState.status === 'error') return;
    if (!shouldPrintWithWarnings(preparedState)) return;
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    if (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      console.debug('[SheetPrint] print source', {
        source: 'sheet-level-rendered-image',
        pages: renderedSheetImagesForPrint.length,
        printColorAdjustExact: true,
        backgrounds: printBackgroundDiagnostics(printableCards, templates, sideMode),
        usesStaleCardData: false,
      });
    }
    await openSystemPrintDialogFromSheetImages(renderedSheetImagesForPrint);
  }

  function currentJobThumbnail(): { thumbnailSide: 'front' | 'back'; thumbnailPlacements: SheetCardPlacement[]; sheetCount: number } {
    const thumbnailSide: 'front' | 'back' = sideMode === 'back' ? 'back' : 'front';
    const firstPair = visibleSheetPairs[0];
    const placements = thumbnailSide === 'back' ? (firstPair?.backPlacements ?? []) : (firstPair?.frontPlacements ?? []);
    return { thumbnailSide, thumbnailPlacements: structuredClone(placements), sheetCount: Math.max(1, visibleSheetPairs.length) };
  }

  // Save the ENTIRE current print job (all pages, current side mode + settings) as one saved entry.
  function saveCurrentJob() {
    if (printableCards.length === 0) return;
    const created = new Date();
    const now = created.toISOString();
    const record: SavedPrintSheet = {
      id: `job_${Date.now()}`,
      name: makeSavedJobName(created),
      sideMode,
      cardIds: sheetCardIds,
      settings: structuredClone(exportSettings),
      ...currentJobThumbnail(),
      createdAt: now,
      updatedAt: now,
    };
    setSavedSheets((current) => [record, ...current]);
    setLoadedJobId(record.id);
  }

  // Overwrite ONLY the currently loaded saved job with the live cards + settings.
  function updateLoadedJob() {
    if (!loadedJobId) return;
    const now = new Date().toISOString();
    setSavedSheets((current) => current.map((job) => (job.id === loadedJobId
      ? { ...job, sideMode, cardIds: sheetCardIds, settings: structuredClone(exportSettings), ...currentJobThumbnail(), updatedAt: now }
      : job)));
  }

  function beginRenameJob(job: SavedPrintSheet) {
    setRenamingJobId(job.id);
    setRenameDraft(job.name);
  }

  function commitRenameJob() {
    const id = renamingJobId;
    const name = renameDraft.trim();
    setRenamingJobId(null);
    if (!id || !name) return;
    setSavedSheets((sheets) => sheets.map((sheet) => (sheet.id === id ? { ...sheet, name, updatedAt: new Date().toISOString() } : sheet)));
  }

  function loadSavedJob(job: SavedPrintSheet) {
    const availableIds = new Set(sourcePrintableCards.map((card) => card.id));
    const restoredItems = job.cardIds
      .map((cardId, index): SheetCardItem | null => {
        if (!availableIds.has(cardId)) return null;
        return { cardId, sheetItemId: `sheet-item:loaded:${job.id}:${index}:${cardId}` };
      })
      .filter((item): item is SheetCardItem => Boolean(item));
    const missingCount = job.cardIds.length - restoredItems.length;
    setSheetItems(restoredItems);
    setSelectedSheetItemIds([]);
    setSelectedPageIndex(null);
    setPageZooms({});
    setLoadedJobId(job.id);
    if (job.settings) updateExportSettings(structuredClone(job.settings));
    else updateSideMode(job.sideMode);
    if (missingCount > 0) {
      setExportSummary({
        exportedCardsCount: restoredItems.length,
        frontPagesCount: job.sideMode !== 'back' ? 1 : 0,
        backPagesCount: job.sideMode !== 'front' ? 1 : 0,
        dpi: job.settings?.dpi ?? exportSettings.dpi ?? 300,
        missingImageCount: missingCount,
        placeholderUsedCount: missingCount,
        warnings: [{
          kind: 'placeholder',
          message: `저장된 묶음의 카드 ${missingCount}개를 현재 카드 데이터에서 찾지 못했습니다.`,
        }],
      });
    }
  }

  function deleteSavedSheet(id: string) {
    if (!window.confirm('저장된 인쇄 묶음을 삭제할까요?')) return;
    setSavedSheets((sheets) => sheets.filter((sheet) => sheet.id !== id));
    setLoadedJobId((current) => (current === id ? null : current));
  }

  function clampZoom(value: number) {
    return Math.min(4, Math.max(0.2, value));
  }

  // Click a page → select it for wheel-zoom; click the selected page again → deselect (toggle).
  function togglePageSelection(index: number) {
    if (selectedPageIndex === index) {
      deselectPage(index);
      return;
    }
    setActiveSheetIndex(index);
    const el = sheetScrollRef.current;
    selectionScrollRef.current = el ? { left: el.scrollLeft, top: el.scrollTop } : { left: 0, top: 0 };
    setSelectedPageIndex(index);
  }

  // Deselect a page: reset its zoom to the default and restore the scroll position from selection time.
  function deselectPage(index: number) {
    pendingFocalRef.current = null;
    pendingRestoreScrollRef.current = selectionScrollRef.current ?? { left: 0, top: 0 };
    pageZoomsRef.current = { ...pageZoomsRef.current, [index]: DEFAULT_PAGE_ZOOM };
    setPageZooms((current) => ({ ...current, [index]: DEFAULT_PAGE_ZOOM }));
    setSelectedPageIndex(null);
  }

  // Set a page's zoom while keeping the given screen point (clientX/clientY) over the same content.
  function applyPageZoomFocal(target: number, newZoom: number, clientX: number, clientY: number) {
    const el = sheetScrollRef.current;
    const oldZoom = pageZoomsRef.current[target] ?? DEFAULT_PAGE_ZOOM;
    if (newZoom === oldZoom) return;
    if (el) {
      const ratio = newZoom / oldZoom;
      const zoomEl = el.querySelector<HTMLElement>(`[data-page-zoom-index="${target}"]`);
      if (zoomEl) {
        const rect = zoomEl.getBoundingClientRect();
        const ox = clientX - rect.left;
        const oy = clientY - rect.top;
        const prev = pendingFocalRef.current ?? { dLeft: 0, dTop: 0 };
        pendingFocalRef.current = { dLeft: prev.dLeft + ox * (ratio - 1), dTop: prev.dTop + oy * (ratio - 1) };
      }
    }
    pageZoomsRef.current = { ...pageZoomsRef.current, [target]: newZoom };
    setPageZooms((current) => ({ ...current, [target]: newZoom }));
  }

  function adjustSelectedPageZoom(delta: number) {
    if (selectedPageIndex == null) return;
    const rect = sheetScrollRef.current?.getBoundingClientRect();
    const cx = rect ? rect.left + rect.width / 2 : 0;
    const cy = rect ? rect.top + rect.height / 2 : 0;
    applyPageZoomFocal(selectedPageIndex, clampZoom((pageZoomsRef.current[selectedPageIndex] ?? DEFAULT_PAGE_ZOOM) + delta), cx, cy);
  }

  function resetSelectedPageZoom() {
    if (selectedPageIndex == null) return;
    pendingFocalRef.current = null;
    pageZoomsRef.current = { ...pageZoomsRef.current, [selectedPageIndex]: DEFAULT_PAGE_ZOOM };
    setPageZooms((current) => ({ ...current, [selectedPageIndex]: DEFAULT_PAGE_ZOOM }));
  }

  // Wheel-click (middle button) drag pans the scroll area, like an image viewer.
  function handleScrollPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 1) return;
    const el = sheetScrollRef.current;
    if (!el) return;
    event.preventDefault();
    el.setPointerCapture(event.pointerId);
    middlePanRef.current = { startX: event.clientX, startY: event.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop, pointerId: event.pointerId };
    el.style.cursor = 'grabbing';
  }

  function handleScrollPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const state = middlePanRef.current;
    const el = sheetScrollRef.current;
    if (!state || !el || state.pointerId !== event.pointerId) return;
    el.scrollLeft = state.scrollLeft - (event.clientX - state.startX);
    el.scrollTop = state.scrollTop - (event.clientY - state.startY);
  }

  function endScrollPan(event: ReactPointerEvent<HTMLDivElement>) {
    const state = middlePanRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const el = sheetScrollRef.current;
    try {
      el?.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    middlePanRef.current = null;
    if (el) el.style.cursor = '';
  }

  return (
    <>
      <PageHeader
        eyebrow="인쇄 출력"
        title="인쇄 / 내보내기"
        description="A4 가로 5 x 2 배치로 카드 앞면과 뒷면을 출력합니다. 시트 위에서 카드 순서를 직접 조정할 수 있습니다."
      />

      <section className="print-hidden mb-3 rounded-lg border border-line bg-white p-3 shadow-surface">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <span
            className="self-center text-sm font-semibold"
            title="A4/A3 가로 자동 배치로 카드 앞/뒤를 출력합니다. 인쇄·PDF·PNG·컷팅 파일이 모두 같은 배치 데이터를 사용합니다."
          >
            출력 설정
          </span>
          <div className="text-xs">
            <div className="font-medium text-neutral-500">출력면</div>
            <div className="mt-0.5 flex overflow-hidden rounded-md border border-line">
              {(['front', 'back', 'duplex'] as ExportSideMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => updateSideMode(mode)}
                  className={`px-2 py-1 font-medium ${sideMode === mode ? 'bg-neutral-900 text-white' : 'bg-white hover:bg-blue-50'}`}
                >
                  {mode === 'front' ? '앞면' : mode === 'back' ? '뒷면' : '양면'}
                </button>
              ))}
            </div>
          </div>
          <div className="text-xs">
            <div className="font-medium text-neutral-500">품질</div>
            <div className="mt-0.5 flex overflow-hidden rounded-md border border-line">
              {([300, 600] as const).map((dpi) => (
                <button
                  key={dpi}
                  type="button"
                  onClick={() => updateDpi(dpi)}
                  className={`px-2 py-1 font-medium ${(exportSettings.dpi ?? 300) === dpi ? 'bg-neutral-900 text-white' : 'bg-white hover:bg-blue-50'}`}
                >
                  {dpi}
                </button>
              ))}
            </div>
          </div>
          <div className="text-xs">
            <div className="font-medium text-neutral-500">용지</div>
            <select
              value={exportSettings.pageSize}
              onChange={(event) => updateExportSettings({ pageSize: event.target.value as ExportSettings['pageSize'] })}
              className="mt-0.5 rounded border border-line bg-white px-2 py-1"
            >
              <option value="A4">A4</option>
              <option value="A3">A3</option>
            </select>
          </div>
          <div className="text-xs">
            <div className="font-medium text-neutral-500">여백(mm) 상·하·좌·우</div>
            <div className="mt-0.5 flex gap-1">
              {([['상', 'marginTopMm'], ['하', 'marginBottomMm'], ['좌', 'marginLeftMm'], ['우', 'marginRightMm']] as const).map(([label, key]) => (
                <input
                  key={key}
                  type="number"
                  min={0}
                  step={0.5}
                  value={exportSettings[key] ?? ''}
                  placeholder={label}
                  title={`여백 ${label}`}
                  onChange={(event) => updateExportSettings({ [key]: event.target.value === '' ? undefined : Number(event.target.value) } as Partial<ExportSettings>)}
                  className="w-11 rounded border border-line px-1 py-1 text-center"
                />
              ))}
            </div>
          </div>
          <div className="text-xs">
            <div className="font-medium text-neutral-500">간격(mm) 가로·세로</div>
            <div className="mt-0.5 flex gap-1">
              {([['가로', 'gapXmm'], ['세로', 'gapYmm']] as const).map(([label, key]) => (
                <input
                  key={key}
                  type="number"
                  min={0}
                  step={0.1}
                  value={exportSettings[key] ?? exportSettings.gapMm}
                  title={`카드 간격 ${label}`}
                  onChange={(event) => updateExportSettings({ [key]: event.target.value === '' ? undefined : Number(event.target.value) } as Partial<ExportSettings>)}
                  className="w-11 rounded border border-line px-1 py-1 text-center"
                />
              ))}
            </div>
          </div>
          <div className="self-center text-xs text-neutral-500">
            장당 {sheetGrid.perSheet}장 ({sheetGrid.columns}×{sheetGrid.rows}) · PDF {pdfPageCount}p
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => void printCurrentSheetDirect()}
            disabled={printableCards.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-green-200 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-40"
          >
            <Printer className="h-3.5 w-3.5" />
            인쇄
          </button>
          <button
            type="button"
            onClick={() => void exportCurrentPrintSheetToPdf({ openAfterExport: openPdfAfterExport })}
            disabled={printableCards.length === 0}
            className="rounded-md border border-blue-200 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40"
          >
            PDF 내보내기
          </button>
          <button
            type="button"
            onClick={() => void handlePngZipExport()}
            disabled={printableCards.length === 0}
            className="rounded-md border border-line px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-50 disabled:opacity-40"
          >
            PNG ZIP
          </button>
          <button
            type="button"
            onClick={() => void handleCuttingFileExport()}
            disabled={printableCards.length === 0}
            className="rounded-md border border-line px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-50 disabled:opacity-40"
            title="스타일과 무관하게 항상 얇은 실선 한 겹으로 컷팅 파일을 만듭니다."
          >
            컷팅 파일
          </button>
          <span className="text-xs text-neutral-500">
            {isUsingPrintQueue ? `대기열 ${queuedCards.length}개` : '현재 카드편집 항목'} ·{' '}
            {sideMode === 'front' ? '앞면만' : sideMode === 'back' ? '뒷면만' : '앞/뒤 동일 순서'}
            {(exportSettings.dpi ?? 300) >= 600 ? ' · 600DPI 용량 큼' : ''}
          </span>
        </div>
        {printPreparation.status === 'preparing' ? (
          <p className="mt-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800">
            이미지 준비 중... {printPreparation.loadedImages} / {printPreparation.totalImages}
          </p>
        ) : null}
        {exportSummary ? (
          <div className="mt-4 rounded-md border border-line bg-white px-3 py-2 text-sm">
            <p className="font-medium">내보내기 결과</p>
            <p className="mt-1 text-neutral-700">
              카드 {exportSummary.exportedCardsCount}개, 앞면 {exportSummary.frontPagesCount}페이지,
              뒷면 {exportSummary.backPagesCount}페이지, DPI {exportSummary.dpi}, 누락 이미지 {exportSummary.missingImageCount}개,
              대체 표시 {exportSummary.placeholderUsedCount}개
            </p>
            {exportSummary.warnings.length > 0 ? (
              <ul className="mt-2 max-h-32 list-disc overflow-auto pl-5 text-xs text-amber-800">
                {exportSummary.warnings.slice(0, 8).map((warning, index) => (
                  <li key={`${warning.cardId ?? 'card'}_${index}`}>{warning.message}</li>
                ))}
                {exportSummary.warnings.length > 8 ? <li>추가 경고 {exportSummary.warnings.length - 8}개</li> : null}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-green-700">이미지 누락 경고 없이 완료되었습니다.</p>
            )}
          </div>
        ) : null}
      </section>

      <div className="flex flex-col gap-4 lg:flex-row">
        <aside className="print-hidden w-full shrink-0 space-y-3 lg:w-[320px]">
          <div className="rounded-lg border border-line bg-white p-3 shadow-surface">
            <h3
              className="text-sm font-semibold"
              title="A4 시트 위 카드끼리 드래그하면 출력 순서가 바뀝니다. 카드 클릭은 카드 선택, 시트 여백 클릭은 그 시트를 휠 확대 대상으로 선택합니다. 선택 제거는 저장 카드를 삭제하지 않습니다."
            >
              시트 편집
            </h3>
            <div className="mt-2 grid gap-1.5">
              <button type="button" onClick={saveCurrentJob} disabled={printableCards.length === 0} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-2 py-1.5 text-xs font-semibold text-primary disabled:opacity-40">
                <Save className="h-3.5 w-3.5" />
                현재 인쇄 묶음 저장
              </button>
              {loadedJobId ? (
                <button type="button" onClick={updateLoadedJob} disabled={printableCards.length === 0} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-xs font-medium hover:bg-neutral-50 disabled:opacity-40" title="현재 불러온 저장 묶음을 지금 설정/배치로 덮어씁니다.">
                  <Save className="h-3.5 w-3.5" />
                  불러온 묶음 업데이트
                </button>
              ) : null}
              <button type="button" onClick={clearActiveSheet} disabled={printableCards.length === 0} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-red-200 px-2 py-1.5 text-xs font-medium text-red-700 disabled:opacity-40">
                <Trash2 className="h-3.5 w-3.5" />
                현재 시트 비우기
              </button>
              <div className="grid grid-cols-2 gap-1.5">
                <button type="button" onClick={removeSelectedFromSheet} disabled={selectedSheetItemIds.length === 0} className="rounded-md border border-red-200 px-2 py-1.5 text-xs font-medium text-red-700 disabled:opacity-40">
                  선택 제거 ({selectedSheetItemIds.length})
                </button>
                <button type="button" onClick={duplicateSelectedOnSheet} disabled={selectedSheetItemIds.length === 0} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-xs font-medium disabled:opacity-40" title="선택한 카드마다 바로 옆에 사본 1장을 추가합니다.">
                  <Copy className="h-3.5 w-3.5" />
                  복제 ({selectedSheetItemIds.length})
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-line bg-white p-3 shadow-surface">
            <h3 className="text-sm font-semibold">저장된 인쇄 묶음 ({savedSheets.length})</h3>
            {savedSheets.length === 0 ? (
              <p className="mt-2 text-xs text-neutral-500">저장된 묶음이 없습니다. “현재 인쇄 묶음 저장”을 누르면 전체 카드 배치와 용지·여백·간격·해상도 설정이 하나로 저장됩니다.</p>
            ) : (
              <div className="mt-2 max-h-[58vh] space-y-2 overflow-y-auto pr-1">
                {savedSheets.map((job) => {
                  const preview = savedJobPreviews[job.id];
                  const isLoaded = loadedJobId === job.id;
                  const sideBadge = job.sideMode === 'duplex'
                    ? { label: '양면', cls: 'bg-violet-100 text-violet-700' }
                    : job.sideMode === 'back'
                      ? { label: '뒷면', cls: 'bg-amber-100 text-amber-700' }
                      : { label: '앞면', cls: 'bg-blue-100 text-blue-700' };
                  return (
                    <div
                      key={job.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => loadSavedJob(job)}
                      onKeyDown={(event) => { if (event.key === 'Enter') loadSavedJob(job); }}
                      className={`flex cursor-pointer gap-2 rounded border p-2 text-left hover:bg-neutral-50 ${isLoaded ? 'border-primary ring-1 ring-primary/40' : 'border-line'}`}
                    >
                      <div className="relative w-20 shrink-0 overflow-hidden rounded border border-neutral-200 bg-white">
                        <PrintSheetPreview
                          title=""
                          showTitle={false}
                          hideLabels
                          side={job.thumbnailSide ?? preview?.side ?? 'front'}
                          placements={job.thumbnailPlacements ?? preview?.placements ?? []}
                          cardsById={cardsById}
                          categoriesById={categoriesById}
                          assetsById={assetsById}
                          templates={templates}
                          settings={job.settings ?? exportSettings}
                          editable={false}
                        />
                        <span className="absolute bottom-0.5 right-0.5 rounded bg-neutral-900/80 px-1 text-[9px] font-semibold text-white">
                          {job.sheetCount ?? preview?.sheetCount ?? 1}시트
                        </span>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        {renamingJobId === job.id ? (
                          <input
                            autoFocus
                            value={renameDraft}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => setRenameDraft(event.target.value)}
                            onBlur={commitRenameJob}
                            onKeyDown={(event) => {
                              event.stopPropagation();
                              if (event.key === 'Enter') commitRenameJob();
                              if (event.key === 'Escape') setRenamingJobId(null);
                            }}
                            className="w-full rounded border border-line px-1 py-0.5 text-xs"
                          />
                        ) : (
                          <span className="min-w-0 truncate text-xs font-medium" title={job.name}>{job.name}</span>
                        )}
                        <span className="flex flex-wrap items-center gap-1 text-[10px] text-neutral-500">
                          <span className={`rounded px-1 py-0.5 font-semibold ${sideBadge.cls}`}>{sideBadge.label}</span>
                          <span>{job.settings?.pageSize ?? 'A4'} · {job.settings?.dpi ?? exportSettings.dpi ?? 300}DPI · 카드 {job.cardIds.length} · {job.sheetCount ?? preview?.sheetCount ?? 1}시트</span>
                        </span>
                        <span className="mt-0.5 flex flex-wrap gap-1">
                          <button type="button" onClick={(event) => { event.stopPropagation(); beginRenameJob(job); }} className="rounded border border-line px-1.5 py-0.5 text-[10px] hover:bg-neutral-100">이름</button>
                          <button type="button" onClick={(event) => { event.stopPropagation(); deleteSavedSheet(job.id); }} className="rounded border border-red-200 px-1.5 py-0.5 text-[10px] text-red-700 hover:bg-red-50">삭제</button>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="print-hidden mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white px-3 py-1.5 text-xs shadow-surface">
            {selectedPageIndex == null ? (
              <span className="text-neutral-500">휠 = 세로 스크롤 · 시트를 클릭하면 그 시트를 휠로 확대/축소</span>
            ) : (
              <>
                <span className="font-medium text-neutral-700">시트 {selectedPageIndex + 1} · {Math.round((pageZooms[selectedPageIndex] ?? DEFAULT_PAGE_ZOOM) * 100)}%</span>
                <button type="button" onClick={() => adjustSelectedPageZoom(-0.1)} className="rounded border border-line px-2 py-0.5 hover:bg-neutral-50">축소</button>
                <button type="button" onClick={() => adjustSelectedPageZoom(0.1)} className="rounded border border-line px-2 py-0.5 hover:bg-neutral-50">확대</button>
                <button type="button" onClick={resetSelectedPageZoom} className="rounded border border-line px-2 py-0.5 hover:bg-neutral-50">기본</button>
                <span className="text-neutral-400">휠=확대/축소 · 휠클릭 드래그=이동 · 시트 다시 클릭=해제</span>
              </>
            )}
          </div>
          <div
            ref={sheetScrollRef}
            onClick={(event) => { if (event.target === event.currentTarget && selectedPageIndex != null) deselectPage(selectedPageIndex); }}
            onMouseDown={(event) => { if (event.button === 1) event.preventDefault(); }}
            onAuxClick={(event) => { if (event.button === 1) event.preventDefault(); }}
            onPointerDown={handleScrollPointerDown}
            onPointerMove={handleScrollPointerMove}
            onPointerUp={endScrollPan}
            onPointerCancel={endScrollPan}
            className={`hm-sheet-scroll max-h-[80vh] rounded-lg border border-line bg-neutral-100 p-4 ${selectedPageIndex == null ? 'overflow-auto' : 'overflow-hidden'}`}
          >
            <div className="print-output-area space-y-5">
              {visibleSheetPairs.map((pair) => {
                const isSelectedPage = selectedPageIndex === pair.sheetIndex;
                const pageZoom = pageZooms[pair.sheetIndex] ?? DEFAULT_PAGE_ZOOM;
                return (
                  <section
                    key={pair.sheetIndex}
                    onClick={() => togglePageSelection(pair.sheetIndex)}
                    className={`space-y-2 rounded-lg p-1 ${isSelectedPage ? 'ring-2 ring-primary/50 ring-offset-2 print:ring-0' : 'cursor-pointer'}`}
                  >
                    <div className="print-hidden flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-neutral-600">
                        시트 {pair.sheetIndex + 1} / {visibleSheetPairs.length}{isSelectedPage ? ` · 확대 ${Math.round(pageZoom * 100)}%` : ''}
                      </span>
                      {isSelectedPage ? <span className="text-[10px] text-neutral-400">휠로 확대해 카드를 자세히 보세요</span> : null}
                    </div>
                    <div className="hm-page-zoom" data-page-zoom-index={pair.sheetIndex} style={{ width: `${Math.round(pageZoom * 100)}%` }}>
                      <div className={`grid gap-5 ${includeFront && includeBack ? 'xl:grid-cols-2' : ''}`}>
                        {includeFront ? (
                          <PrintSheetPreview
                            title={`시트 ${pair.sheetIndex + 1} 앞면 - ${pair.frontPageNumber}페이지`}
                            side="front"
                            sheetIndex={pair.sheetIndex}
                            pageNumber={pair.frontPageNumber}
                            placements={pair.frontPlacements}
                            cardsById={cardsById}
                            categoriesById={categoriesById}
                            assetsById={assetsById}
                            templates={templates}
                            settings={exportSettings}
                            editable
                            showTitle={false}
                            selectedSheetItemIds={selectedSheetItemIds}
                            onToggleSheetItem={toggleSheetItem}
                            onMoveCard={moveSheetCard}
                          />
                        ) : null}
                        {includeBack ? (
                          <PrintSheetPreview
                            title={`시트 ${pair.sheetIndex + 1} 뒷면 - ${pair.backPageNumber}페이지`}
                            side="back"
                            sheetIndex={pair.sheetIndex}
                            pageNumber={pair.backPageNumber}
                            placements={pair.backPlacements}
                            cardsById={cardsById}
                            categoriesById={categoriesById}
                            assetsById={assetsById}
                            templates={templates}
                            settings={exportSettings}
                            editable={!includeFront}
                            showTitle={false}
                            selectedSheetItemIds={selectedSheetItemIds}
                            onToggleSheetItem={toggleSheetItem}
                            onMoveCard={moveSheetCard}
                          />
                        ) : null}
                      </div>
                    </div>
                    <div className="print-hidden pt-1 text-center text-[11px] font-medium text-neutral-500">
                      {loadedJobName ? `${loadedJobName} · ` : ''}시트 {pair.sheetIndex + 1} / {visibleSheetPairs.length}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="pointer-events-none fixed left-[-10000px] top-0" style={{ width: `${printReadyWidthPx}px` }} aria-hidden="true">
        <div className="print-ready-output-area space-y-5">
          {visibleSheetPairs.map((pair) => (
            <section key={`print_ready_${pair.sheetIndex}`} className="space-y-2">
              <div className={`grid gap-5 ${includeFront && includeBack ? 'xl:grid-cols-2' : ''}`}>
                {includeFront ? (
                  <PrintSheetPreview
                    title={`?쒗듃 ${pair.sheetIndex + 1} ?욌㈃ - ${pair.frontPageNumber}?섏씠吏`}
                    side="front"
                    sheetIndex={pair.sheetIndex}
                    pageNumber={pair.frontPageNumber}
                    placements={pair.frontPlacements}
                    cardsById={cardsById}
                    categoriesById={categoriesById}
                    assetsById={preparedAssetsById ?? assetsById}
                    templates={templates}
                    settings={exportSettings}
                    showTitle={false}
                  />
                ) : null}
                {includeBack ? (
                  <PrintSheetPreview
                    title={`?쒗듃 ${pair.sheetIndex + 1} ?룸㈃ - ${pair.backPageNumber}?섏씠吏`}
                    side="back"
                    sheetIndex={pair.sheetIndex}
                    pageNumber={pair.backPageNumber}
                    placements={pair.backPlacements}
                    cardsById={cardsById}
                    categoriesById={categoriesById}
                    assetsById={preparedAssetsById ?? assetsById}
                    templates={templates}
                    settings={exportSettings}
                    showTitle={false}
                  />
                ) : null}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
