import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Folder, Image as ImageIcon, Library, Redo2, RefreshCw, RotateCcw, Save, Search, Trash2, Undo2, X } from 'lucide-react';
import { EditableCardTemplatePreview } from '@sticker-v1/components/cards/EditableCardTemplatePreview';
import { PageHeader } from '@sticker-v1/components/common/PageHeader';
import { PaginationControls } from '@sticker-v1/components/common/PaginationControls';
import { RouteErrorBoundary } from '@sticker-v1/components/common/RouteErrorBoundary';
import { TemplateThumbnail, TemplateThumbnailPlaceholder } from '@sticker-v1/components/templates/TemplateThumbnail';
import { useTemplateThumbnail } from '@sticker-v1/components/templates/useTemplateThumbnail';
import { MAX_BATCH_CARD_CREATE_COUNT, batchCardCreateLimitMessage, isBatchCardCreateCountAllowed } from '@sticker-v1/config/cardCreation';
import { usePressAndHold } from '@sticker-v1/hooks/usePressAndHold';
import { cacheUsedAsset, restoreUsedImageAssets } from '@sticker-v1/services/assets/usedImageCache';
import { BOX_ART_SEARCH_SOURCES, cleanGameTitleForSearch, openExternalSearchUrl } from '@sticker-v1/services/boxArtSearch';
import { refreshAssetLibraryFromDisk } from '@sticker-v1/services/assets/refreshAssetLibrary';
import { filterAssetsByEnabledGroups } from '@sticker-v1/services/assets/assetSourceGroups';
import {
  cardImageReferenceKey,
  ensureCardImagesCached,
  missingUsedImageReferences,
  uniqueCardImageReferences,
} from '@sticker-v1/services/assets/cardImagePersistence';
import { useProjectStore } from '@sticker-v1/store/projectStore';
import { defaultFitModeForSlot, fitImageToBounds, imageFitModeLabels } from '@sticker-v1/utils/imageFit';
import { applyCenteredImageZoom, imageTransformLimits, mainImageDefaultCenteredZoomSteps, resizeToSizeFromTopLeft, type ImageTransform } from '@sticker-v1/utils/imageTransform';
import { clampImageCropPx, hasNaturalImageSize, type ImageNaturalSize } from '@sticker-v1/utils/imageCrop';
import { canvasToUiY, uiToCanvasY } from '@sticker-v1/utils/cardGeometry';
import { normalizeName } from '@sticker-v1/utils/normalizeName';
import { paginateItems } from '@sticker-v1/utils/pagination';
import { isPlayableLibraryEntry, platformHasPlayableEntry } from '@sticker-v1/utils/zaparooDisplayFilters';
import { assetReferenceFromAsset, assetReferenceCacheKey, resolveAssetReference } from '@sticker-v1/utils/assetReferences';
import {
  getTemplateLayerFrame,
  getLayerOverrideKey,
  hasTemplateLayerSavedImageTransform,
  getTemplateLayerImageTransform,
  isTemplateImageLayer,
  toSlotOverride,
} from '@sticker-v1/utils/cardTemplateTransforms';
import { templatesWithCardSnapshots } from '@sticker-v1/utils/cardTemplateSnapshots';
import type { AssetKind, CardItem, ImageFitMode, LocalAsset, SlotOverride, Template, TemplateLayer, ZaparooLibraryEntry } from '@sticker-v1/types';

// Matches the on-disk archive folder created by the app:save-card-image IPC (electron/main.mjs):
// an image folder inside the app's own folder.
const cardImageFolderLabel = '앱 폴더\\card-images';

type EditorSide = 'front' | 'back';
type EditorProgress = {
  label: string;
  message: string;
  processed: number;
  total: number;
  detail?: string;
};

const workingPageSize = MAX_BATCH_CARD_CREATE_COUNT;
const cardEditorHistoryLimit = 50;
const imagePickerPageSize = 100;
const DEFAULT_BATCH_IMAGE_CENTER_ZOOM_STEPS = mainImageDefaultCenteredZoomSteps;

function cloneCards(cards: CardItem[]) {
  return JSON.parse(JSON.stringify(cards)) as CardItem[];
}

function assetPlatform(asset: LocalAsset) {
  return asset.platform || asset.sourceLabel || 'Unsorted';
}

function assetDisplayName(asset: LocalAsset) {
  return asset.normalizedFileName || asset.name || asset.path || asset.id;
}

function cardImageMatchesAsset(
  currentAssetId: string | undefined,
  currentReference: CardItem['front']['heroImageAssetRef'],
  asset: LocalAsset,
) {
  if (currentAssetId && currentAssetId === asset.id) return true;
  if (!currentReference) return false;
  const nextReference = assetReferenceFromAsset(asset);
  const currentKey = assetReferenceCacheKey(currentReference);
  const nextKey = nextReference ? assetReferenceCacheKey(nextReference) : undefined;
  return Boolean(currentKey && nextKey && currentKey === nextKey);
}

function normalizedAssetPath(asset: LocalAsset) {
  return String(asset.originalPath ?? asset.path ?? asset.name).replace(/\\/g, '/');
}

function assetFolder(asset: LocalAsset) {
  const parts = normalizedAssetPath(asset).split('/').filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
}

function folderBreadcrumbs(path: string) {
  const parts = path.split('/').filter(Boolean);
  return parts.map((part, index) => ({ label: part, path: parts.slice(0, index + 1).join('/') }));
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [value, delayMs]);

  return debouncedValue;
}

function loadAssetSize(asset?: LocalAsset) {
  if (!asset?.objectUrl) return Promise.resolve({ width: 1, height: 1 });
  return new Promise<{ width: number; height: number }>((resolve) => {
    const image = new window.Image();
    image.onload = () => resolve({ width: image.naturalWidth || image.width || 1, height: image.naturalHeight || image.height || 1 });
    image.onerror = () => resolve({ width: 1, height: 1 });
    image.src = asset.objectUrl ?? '';
  });
}

function layerAcceptsCardAsset(layer: TemplateLayer, target: 'main' | 'logo', side: EditorSide = 'front') {
  if (target === 'main') {
    return side === 'back'
      ? layer.slotType === 'mainImage' || layer.slotType === 'heroImage' || layer.slotType === 'background' || layer.slotType === 'backgroundArt'
      : layer.slotType === 'mainImage' || layer.slotType === 'heroImage';
  }
  return side === 'back'
    ? layer.slotType === 'gameLogo' || layer.slotType === 'titleImage' || layer.slotType === 'brandLogo' || layer.slotType === 'platformLogo'
    : layer.slotType === 'gameLogo' || layer.slotType === 'titleImage';
}

function entryMatchKeys(entry: ZaparooLibraryEntry | undefined, title?: string) {
  return [
    entry?.imageMatchKey,
    entry?.normalizedTitle,
    entry?.romName,
    entry?.title,
    title,
  ]
    .map((value) => normalizeName(value ?? ''))
    .filter(Boolean);
}

function normalizedAssetCandidateName(asset: LocalAsset) {
  return normalizeName(asset.normalizedFileName ?? asset.normalizedName ?? asset.name);
}

function matchAssetForEntry(assets: LocalAsset[], entry: ZaparooLibraryEntry | undefined, title?: string) {
  const keys = entryMatchKeys(entry, title);
  if (keys.length === 0) return undefined;
  return assets.find((asset) => keys.some((key) => normalizedAssetCandidateName(asset) === key));
}

function candidateTokens(value: string) {
  return value
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function partialMatchCandidates(
  assets: LocalAsset[],
  entry: ZaparooLibraryEntry | undefined,
  title: string | undefined,
  target: 'main' | 'logo',
  limit = 8,
) {
  const keys = entryMatchKeys(entry, title);
  const tokens = Array.from(new Set(keys.flatMap(candidateTokens)));
  if (keys.length === 0 && tokens.length === 0) return [];
  const entryPlatform = normalizeName(entry?.systemId || entry?.folderName || entry?.platformGroup || '');
  const preferredKinds: AssetKind[] = target === 'main' ? ['box-front', 'fanart-box-front'] : ['clear-logo'];

  return assets
    .map((asset) => {
      const name = normalizedAssetCandidateName(asset);
      const assetPlatformName = normalizeName(asset.platform || asset.sourceLabel || '');
      let score = 0;
      const reasons: string[] = [];

      if (keys.some((key) => name === key)) score += 120;
      if (keys.some((key) => name.includes(key) || key.includes(name))) {
        score += 70;
        reasons.push('파일명 부분 일치');
      }

      const tokenHits = tokens.filter((token) => name.includes(token) || token.includes(name));
      if (tokenHits.length > 0) {
        score += tokenHits.length * 18;
        reasons.push(`토큰 ${tokenHits.slice(0, 2).join(', ')} 일치`);
      }

      if (entryPlatform && assetPlatformName && (assetPlatformName.includes(entryPlatform) || entryPlatform.includes(assetPlatformName))) {
        score += 20;
        reasons.push('플랫폼 일치');
      }

      if (preferredKinds.includes(asset.kind)) score += 15;
      const assetTypeName = asset.assetType ? normalizeName(asset.assetType) : '';
      if (assetTypeName && preferredKinds.some((kind) => assetTypeName.includes(normalizeName(kind)))) score += 8;

      return { asset, score, reason: reasons.join(' · ') || '부분 일치 후보' };
    })
    .filter(({ score, asset }) => score >= 35 && !keys.some((key) => normalizedAssetCandidateName(asset) === key))
    .sort((a, b) => b.score - a.score || assetDisplayName(a.asset).localeCompare(assetDisplayName(b.asset)))
    .slice(0, limit);
}

function TemplatePickerCard({
  template,
  selected,
  onSelect,
}: {
  template: Template;
  selected: boolean;
  onSelect: () => void;
}) {
  const thumbnail = useTemplateThumbnail(template);
  const thumbnailSize = 128;
  return (
    <button
      key={template.id}
      type="button"
      onClick={onSelect}
      className={`rounded-md border p-2 text-left transition ${
        selected ? 'border-primary bg-blue-50 ring-2 ring-primary/20' : 'border-line bg-white hover:border-blue-300'
      }`}
    >
      <div className="relative">
        <RouteErrorBoundary
          compact
          message="템플릿 썸네일을 불러오지 못했습니다."
          fallback={<TemplateThumbnailPlaceholder size={thumbnailSize} />}
          resetKey={`${template.id}:${template.thumbnailCacheKey ?? template.thumbnailStaleCacheKey ?? template.updatedAt ?? ''}`}
        >
          <TemplateThumbnail
            template={template}
            size={thumbnailSize}
            thumbnailUrl={thumbnail.thumbnailUrl}
            thumbnailCacheKey={thumbnail.thumbnailCacheKey}
          />
        </RouteErrorBoundary>
        {thumbnail.loading ? (
          <div className="absolute inset-0 grid place-items-center rounded bg-white/60 text-xs font-medium text-neutral-600">
            로딩 중
          </div>
        ) : null}
      </div>
      <span className="mt-2 block truncate text-xs font-medium">{template.name}</span>
      <span className="text-[11px] text-neutral-500">{template.canvas.orientation === 'landscape' ? '가로' : '세로'} / {template.type}</span>
      {thumbnail.error ? <span className="mt-1 block truncate text-[11px] text-amber-700">캐시 없음</span> : null}
    </button>
  );
}

function TemplatePicker({
  title,
  templates,
  selectedId,
  onSelect,
}: {
  title: string;
  templates: Template[];
  selectedId?: string;
  onSelect: (templateId: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selectedTemplate = templates.find((template) => template.id === selectedId);
  const filteredTemplates = templates
    .filter((template) => !template.deletedAt)
    .filter((template) => template.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => {
      const orientationOrder = (a.canvas.orientation === 'landscape' ? 1 : 0) - (b.canvas.orientation === 'landscape' ? 1 : 0);
      if (orientationOrder !== 0) return orientationOrder;
      return new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime() || a.name.localeCompare(b.name);
    });
  const portraitTemplates = filteredTemplates.filter((template) => template.canvas.orientation !== 'landscape');
  const landscapeTemplates = filteredTemplates.filter((template) => template.canvas.orientation === 'landscape');

  function renderTemplateButton(template: Template) {
    const selected = template.id === selectedId;
    return (
      <TemplatePickerCard
        key={template.id}
        template={template}
        selected={selected}
        onSelect={() => {
          void Promise.resolve(onSelect(template.id));
          setOpen(false);
        }}
      />
    );
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-medium">{title}</span>
        {selectedId && (
          <button type="button" onClick={() => onSelect('')} className="text-xs font-medium text-neutral-500 hover:text-primary">
            해제
          </button>
        )}
      </div>
      <button type="button" onClick={() => setOpen(true)} className="w-full rounded-md border border-line bg-white px-3 py-2 text-left text-sm hover:border-blue-300">
        <span className="block font-medium">{selectedTemplate?.name ?? '템플릿 선택'}</span>
        <span className="text-xs text-neutral-500">{selectedTemplate ? `${selectedTemplate.canvas.orientation === 'landscape' ? '가로' : '세로'} / ${selectedTemplate.type}` : '팝업에서 템플릿을 고릅니다.'}</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/60 p-5" onPointerDown={(event) => event.stopPropagation()}>
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <p className="font-semibold">{title}</p>
                <p className="text-xs text-neutral-500">세로 템플릿을 먼저 보여주고, 가로 템플릿은 아래에 표시합니다.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-line p-2">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 overflow-auto p-4">
              <label className="relative mb-4 block">
                <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-neutral-400" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="템플릿 검색" className="w-full rounded-md border border-line py-2 pl-8 pr-2 text-sm" />
              </label>
              {templates.length === 0 ? (
                <div className="rounded-md border border-dashed border-line px-3 py-6 text-center text-sm text-neutral-500">이 면에 저장된 템플릿이 없습니다.</div>
              ) : (
                <div className="space-y-5">
                  <section>
                    <h3 className="mb-2 text-sm font-semibold">세로 템플릿</h3>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{portraitTemplates.map(renderTemplateButton)}</div>
                  </section>
                  <section>
                    <h3 className="mb-2 text-sm font-semibold">가로 템플릿</h3>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {landscapeTemplates.length > 0 ? landscapeTemplates.map(renderTemplateButton) : <p className="text-sm text-neutral-500">가로 템플릿이 없습니다.</p>}
                    </div>
                  </section>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ImagePicker({
  title,
  emptyLabel,
  assets,
  selectedId,
  onSelect,
  onMatch,
  candidates = [],
  onCandidateSelect,
}: {
  title: string;
  emptyLabel: string;
  assets: LocalAsset[];
  selectedId?: string;
  onSelect: (assetId?: string) => void | Promise<void>;
  onMatch?: () => void | Promise<void>;
  candidates?: { asset: LocalAsset; score: number; reason: string }[];
  onCandidateSelect?: (asset: LocalAsset) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [previewAsset, setPreviewAsset] = useState<LocalAsset | null>(null);
  const [query, setQuery] = useState('');
  const [assetPage, setAssetPage] = useState(1);
  const [thumbnailSize, setThumbnailSize] = useState(112);
  const debouncedQuery = useDebouncedValue(query, 180);
  const selectedAsset = assets.find((asset) => asset.id === selectedId);
  const platforms = useMemo(
    () => Array.from(new Set(assets.map(assetPlatform))).sort(),
    [assets],
  );
  const filteredAssets = useMemo(
    () => assets.filter((asset) => {
      const platformName = assetPlatform(asset);
      if (platform && platformName !== platform) return false;
      if (!debouncedQuery.trim()) return true;
      return assetDisplayName(asset).toLowerCase().includes(debouncedQuery.trim().toLowerCase());
    }),
    [assets, debouncedQuery, platform],
  );
  const folderAssets = useMemo(() => {
    if (debouncedQuery.trim()) return filteredAssets;
    return filteredAssets.filter((asset) => assetFolder(asset) === folderPath);
  }, [debouncedQuery, filteredAssets, folderPath]);
  const childFolders = useMemo(() => {
    if (debouncedQuery.trim()) return [];
    const prefix = folderPath ? `${folderPath}/` : '';
    const folders = new Set<string>();
    filteredAssets.forEach((asset) => {
      const folder = assetFolder(asset);
      if (folderPath && folder !== folderPath && !folder.startsWith(prefix)) return;
      const first = (folderPath ? folder.slice(prefix.length) : folder).split('/').filter(Boolean)[0];
      if (first) folders.add(folderPath ? `${folderPath}/${first}` : first);
    });
    return Array.from(folders).sort((a, b) => a.localeCompare(b));
  }, [debouncedQuery, filteredAssets, folderPath]);
  const pagedAssets = useMemo(
    () => paginateItems(folderAssets, assetPage, imagePickerPageSize),
    [assetPage, folderAssets],
  );
  const previewAssetIndex = previewAsset ? folderAssets.findIndex((asset) => asset.id === previewAsset.id) : -1;
  const previousPreviewAsset = previewAssetIndex > 0 ? folderAssets[previewAssetIndex - 1] : undefined;
  const nextPreviewAsset =
    previewAssetIndex >= 0 && previewAssetIndex < folderAssets.length - 1 ? folderAssets[previewAssetIndex + 1] : undefined;

  useEffect(() => {
    setAssetPage(1);
    setFolderPath('');
  }, [platform, debouncedQuery]);

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
        void Promise.resolve(onSelect(activePreviewAsset.id)).then(() => {
          setPreviewAsset(null);
          setOpen(false);
        });
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const currentIndex = folderAssets.findIndex((asset) => asset.id === activePreviewAsset.id);
        const nextIndex = event.key === 'ArrowLeft' ? currentIndex - 1 : currentIndex + 1;
        if (nextIndex >= 0 && nextIndex < folderAssets.length) setPreviewAsset(folderAssets[nextIndex]);
      }
    }
    window.addEventListener('keydown', handlePreviewKeyDown);
    return () => window.removeEventListener('keydown', handlePreviewKeyDown);
  }, [folderAssets, onSelect, previewAsset]);

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{title}</span>
        <span className="flex gap-1">
          {onMatch && (
            <button type="button" onClick={() => void onMatch()} className="rounded-md border border-line px-2 py-1 text-xs font-medium">
              자동 매칭
            </button>
          )}
          <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-line px-2 py-1 text-xs font-medium">
            선택
          </button>
        </span>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`mt-2 w-full rounded-md border p-2 text-left transition ${
          selectedId ? 'border-primary bg-blue-50 ring-2 ring-primary/20' : 'border-line bg-white hover:border-blue-300'
        }`}
      >
        <span className="block truncate text-xs font-medium">{selectedAsset ? assetDisplayName(selectedAsset) : emptyLabel}</span>
        <span className="text-[11px] text-neutral-500">
          {selectedAsset ? `${assetPlatform(selectedAsset)} / ${selectedAsset.kind}` : '이미지 없음'}
        </span>
      </button>
      {candidates.length > 0 && (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2">
          <div className="mb-2 flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-amber-900">정확한 매칭 대신 추천 후보를 찾았습니다.</span>
            <span className="text-amber-700">{candidates.length}개</span>
          </div>
          <div className="grid gap-2">
            {candidates.map(({ asset, reason }) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => void Promise.resolve(onCandidateSelect?.(asset) ?? onSelect(asset.id))}
                className="flex items-center gap-2 rounded border border-amber-200 bg-white/80 p-2 text-left hover:border-amber-400"
                title={assetDisplayName(asset)}
              >
                <span className="image-thumb-frame flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded">
                  {asset.objectUrl ? <img src={asset.objectUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain" /> : <Library className="h-4 w-4 text-neutral-400" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold">{assetDisplayName(asset)}</span>
                  <span className="block truncate text-[11px] text-neutral-600">{reason}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/60 p-5" onPointerDown={(event) => event.stopPropagation()}>
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <p className="font-semibold">{title}</p>
                <p className="text-xs text-neutral-500">{platform || '먼저 platform을 선택하세요.'}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-line p-2">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid min-h-0 max-h-[calc(90vh-64px)] overflow-hidden md:grid-cols-[220px_minmax(0,1fr)]">
              <aside className="min-h-0 border-r border-line p-3">
                <button
                  type="button"
                  onClick={() => void Promise.resolve(onSelect(undefined)).then(() => {
                    setOpen(false);
                  })}
                  className="mb-2 w-full rounded-md border border-line px-3 py-2 text-left text-sm"
                >
                  {emptyLabel}
                </button>
                <div className="overflow-y-auto pr-1" style={{ maxHeight: 'min(60vh, 520px)' }}>
                  {platforms.map((candidate) => (
                    <button
                      key={candidate}
                      type="button"
                      onClick={() => setPlatform(candidate)}
                      className={`mb-1 w-full rounded-md px-3 py-2 text-left text-sm ${platform === candidate ? 'bg-primary text-white shadow-selected' : 'border border-line hover:bg-blue-50'}`}
                    >
                      {candidate}
                    </button>
                  ))}
                </div>
              </aside>
              <div className="min-h-0 overflow-auto p-4">
                {platform ? (
                  <>
                    <div className="mb-4 flex flex-wrap items-end gap-3">
                      <label className="relative block min-w-[220px] flex-1">
                        <span className="mb-1 block text-xs font-medium text-neutral-600">파일명 검색</span>
                        <Search className="pointer-events-none absolute left-2 top-8 h-4 w-4 text-neutral-400" />
                        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="파일명 검색" className="w-full rounded-md border border-line py-2 pl-8 pr-2 text-sm" />
                      </label>
                      <label className="w-56 text-xs font-medium text-neutral-600">
                        <span className="flex items-center justify-between">
                          <span>썸네일 크기</span>
                          <span>{thumbnailSize}px</span>
                        </span>
                        <input
                          type="range"
                          min="72"
                          max="180"
                          value={thumbnailSize}
                          onChange={(event) => setThumbnailSize(Number(event.target.value))}
                          className="mt-2 w-full"
                        />
                      </label>
                    </div>
                    <PaginationControls
                      currentPage={pagedAssets.currentPage}
                      totalItems={folderAssets.length}
                      pageSize={imagePickerPageSize}
                      onPageChange={setAssetPage}
                      itemLabel="개"
                      className="mb-3 rounded-md border border-line bg-neutral-50 px-3 py-2"
                    />
                    {!debouncedQuery.trim() && (
                      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-line bg-neutral-50 px-3 py-2 text-xs">
                        <button
                          type="button"
                          onClick={() => setFolderPath('')}
                          className={`rounded px-2 py-1 font-medium ${folderPath ? 'text-neutral-600 hover:bg-white' : 'bg-white text-primary shadow-sm'}`}
                        >
                          루트
                        </button>
                        {folderBreadcrumbs(folderPath).map((crumb) => (
                          <button key={crumb.path} type="button" onClick={() => setFolderPath(crumb.path)} className="rounded px-2 py-1 font-medium text-neutral-600 hover:bg-white">
                            / {crumb.label}
                          </button>
                        ))}
                        {folderPath && (
                          <button
                            type="button"
                            onClick={() => setFolderPath(folderPath.split('/').filter(Boolean).slice(0, -1).join('/'))}
                            className="ml-auto rounded border border-line bg-white px-2 py-1 font-medium"
                          >
                            상위 폴더
                          </button>
                        )}
                      </div>
                    )}
                    <div
                      className="grid max-h-[62vh] gap-3 overflow-auto pr-1"
                      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbnailSize}px, 1fr))` }}
                    >
                      {!debouncedQuery.trim() && childFolders.map((folder) => (
                        <button
                          key={`folder-${folder}`}
                          type="button"
                          onClick={() => setFolderPath(folder)}
                          className="min-w-0 rounded-md border border-line bg-white p-2 text-left text-sm hover:border-blue-300"
                          title={folder.split('/').pop()}
                        >
                          <span className="flex items-center justify-center overflow-hidden rounded bg-neutral-50 text-sm font-semibold text-neutral-500" style={{ height: `${thumbnailSize}px` }}>
                            <Folder className="h-10 w-10 text-neutral-400" />
                          </span>
                          <span className="mt-2 block truncate text-xs font-medium">{folder.split('/').pop()}</span>
                          <span className="block truncate text-[11px] text-neutral-500">폴더</span>
                        </button>
                      ))}
                      {pagedAssets.items.map((asset) => (
                        <button
                          key={asset.id}
                          type="button"
                          onClick={() => setPreviewAsset(asset)}
                          title={assetDisplayName(asset)}
                          className={`min-w-0 rounded-md border bg-white p-2 text-left text-sm ${asset.id === selectedId ? 'border-primary bg-blue-50 ring-2 ring-primary/20' : 'border-line hover:border-blue-300'}`}
                        >
                          <span
                            className="image-thumb-frame flex items-center justify-center overflow-hidden rounded"
                            style={{ height: `${thumbnailSize}px` }}
                          >
                            {asset.objectUrl ? (
                              <img src={asset.objectUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain" />
                            ) : (
                              <Library className="h-6 w-6 text-neutral-400" />
                            )}
                          </span>
                          <span className="mt-2 block truncate text-xs font-medium" title={assetDisplayName(asset)}>{assetDisplayName(asset)}</span>
                          <span className="block truncate text-[11px] text-neutral-500">{asset.kind}</span>
                        </button>
                      ))}
                      {childFolders.length === 0 && folderAssets.length === 0 && (
                        <p className="rounded-md border border-dashed border-line px-3 py-4 text-sm text-neutral-600">
                          조건에 맞는 파일이 없습니다.
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-neutral-600">platform을 선택하면 조건에 맞는 파일이 표시됩니다.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {open && previewAsset && (
        <div className="fixed inset-0 z-[5100] flex items-center justify-center bg-black/70 p-5" onPointerDown={(event) => event.stopPropagation()}>
          <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-semibold" title={assetDisplayName(previewAsset)}>{assetDisplayName(previewAsset)}</p>
                <p className="truncate text-xs text-neutral-500" title={normalizedAssetPath(previewAsset)}>
                  {assetPlatform(previewAsset)} · {previewAsset.kind} · {normalizedAssetPath(previewAsset)}
                </p>
              </div>
              <button type="button" onClick={() => setPreviewAsset(null)} className="rounded-md border border-line p-2">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <div className="image-thumb-frame flex max-h-[58vh] min-h-[280px] items-center justify-center overflow-hidden rounded-md p-3">
                {previewAsset.objectUrl ? (
                  <img src={previewAsset.objectUrl} alt="" className="max-h-full max-w-full object-contain" />
                ) : (
                  <Library className="h-10 w-10 text-neutral-400" />
                )}
              </div>
              <p className="mt-3 text-xs text-neutral-500">←/→ 이전·다음, Enter로 추가, Esc로 닫기</p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
              <div className="flex gap-2">
                <button type="button" disabled={!previousPreviewAsset} onClick={() => previousPreviewAsset && setPreviewAsset(previousPreviewAsset)} className="rounded-md border border-line px-4 py-2 text-sm font-medium disabled:opacity-40">
                  이전 이미지
                </button>
                <button type="button" disabled={!nextPreviewAsset} onClick={() => nextPreviewAsset && setPreviewAsset(nextPreviewAsset)} className="rounded-md border border-line px-4 py-2 text-sm font-medium disabled:opacity-40">
                  다음 이미지
                </button>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setPreviewAsset(null)} className="rounded-md border border-line px-4 py-2 text-sm font-medium">
                  닫기
                </button>
                <button
                  type="button"
                  onClick={() => void Promise.resolve(onSelect(previewAsset.id)).then(() => {
                    setPreviewAsset(null);
                    setOpen(false);
                  })}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  이미지 추가
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function assetsOfKinds(assets: LocalAsset[], kinds: AssetKind[]) {
  return assets.filter((asset) => kinds.includes(asset.kind));
}

export function CardEditorPage() {
  const {
    cards,
    games,
    categories,
    assetLibrary,
    setAssetLibrary,
    templates,
    mister,
    zaparooLibrary,
    createCardsFromZaparooEntries,
    updateCard,
    deleteCard,
    resetCard,
    clearWorkingCards,
    restoreWorkingCards,
    removeWorkingCard,
    saveCard,
    saveCardAsNew,
    setMiSTerMapping,
  } = useProjectStore();
  const visibleCards = useMemo(() => cards.filter((card) => !card.deleted), [cards]);
  const [selectedId, setSelectedId] = useState(visibleCards[0]?.id ?? '');
  const [selectedWorkingIds, setSelectedWorkingIds] = useState<string[]>([]);
  const [workingPage, setWorkingPage] = useState(1);
  const [activeSide, setActiveSide] = useState<EditorSide>('front');
  const [selectedImageLayerId, setSelectedImageLayerId] = useState<string | undefined>();
  const [imageAspectLocked, setImageAspectLocked] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [restoreProgress, setRestoreProgress] = useState<EditorProgress | null>(null);
  const [cacheRepairProgress, setCacheRepairProgress] = useState<EditorProgress | null>(null);
  const [undoStack, setUndoStack] = useState<CardItem[][]>([]);
  const [redoStack, setRedoStack] = useState<CardItem[][]>([]);
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [libraryPlatform, setLibraryPlatform] = useState('');
  const [libraryQuery, setLibraryQuery] = useState('');
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>([]);
  const [lastLibrarySelectionId, setLastLibrarySelectionId] = useState<string | undefined>();
  const [libraryDragSelecting, setLibraryDragSelecting] = useState(false);
  const [matchCandidates, setMatchCandidates] = useState<{
    main: { asset: LocalAsset; score: number; reason: string }[];
    logo: { asset: LocalAsset; score: number; reason: string }[];
  }>({ main: [], logo: [] });
  const [editorSessionAssetsByKey, setEditorSessionAssetsByKey] = useState<Record<string, LocalAsset>>({});
  const editorSidebarRef = useRef<HTMLElement | null>(null);
  const editorSessionAssetsRef = useRef(editorSessionAssetsByKey);
  const visibleCardsRef = useRef<CardItem[]>([]);
  const assetsByIdRef = useRef<Record<string, LocalAsset>>({});
  const diagnosticsRef = useRef({
    imageAssetLoadCount: 0,
    transformUpdateCount: 0,
    thumbnailRegenerationCount: 0,
    saveCount: 0,
  });
  const backTemplateDiagnosticsKeyRef = useRef('');
  const transformHistoryCoalescingRef = useRef(false);
  const transformHistoryCoalesceTimerRef = useRef<number | null>(null);
  const [showImageSearch, setShowImageSearch] = useState(false);
  const [titleCopied, setTitleCopied] = useState(false);
  const [isRefreshingAssets, setIsRefreshingAssets] = useState(false);
  const [imageDropActive, setImageDropActive] = useState(false);
  const selectedCard = visibleCards.find((card) => card.id === selectedId) ?? visibleCards[0];
  const baseAssetsById = useMemo(() => assetLibrary?.assetsById ?? {}, [assetLibrary?.assetsById]);
  const editorSessionAssets = useMemo(() => Object.values(editorSessionAssetsByKey), [editorSessionAssetsByKey]);
  const assetsById = useMemo(() => {
    if (editorSessionAssets.length === 0) return baseAssetsById;
    const next = { ...baseAssetsById };
    editorSessionAssets.forEach((asset) => {
      if (!next[asset.id]?.objectUrl) next[asset.id] = asset;
    });
    return next;
  }, [baseAssetsById, editorSessionAssets]);
  const assets = useMemo(() => filterAssetsByEnabledGroups(Object.values(assetsById)), [assetsById]);
  const activeProgress = restoreProgress ?? cacheRepairProgress;
  const missingUsedAssetReferences = useMemo(
    () => missingUsedImageReferences(visibleCards, assetsById),
    [assetsById, visibleCards],
  );
  const missingUsedAssetReferenceKey = missingUsedAssetReferences.map((reference) => assetReferenceCacheKey(reference)).sort().join('|');
  const cardImageRepairKey = useMemo(() => cardImageReferenceKey(visibleCards), [visibleCards]);
  const selectedGame = games.find((game) => game.id === selectedCard?.gameId);
  const selectedCategory = categories.find((category) => category.id === selectedCard?.categoryId);
  const mainImageAssets = useMemo(() => assetsOfKinds(assets, ['box-front', 'fanart-box-front']), [assets]);
  const clearLogoAssets = useMemo(() => assetsOfKinds(assets, ['clear-logo']), [assets]);
  const backAssets = useMemo(() => assets.filter((asset) => asset.kind === 'card-back'), [assets]);
  const backMainImageAssets = useMemo(() => {
    const byId = new Map<string, LocalAsset>();
    [...backAssets, ...mainImageAssets].forEach((asset) => byId.set(asset.id, asset));
    return Array.from(byId.values());
  }, [backAssets, mainImageAssets]);
  const cardPreviewTemplates = selectedCard ? templatesWithCardSnapshots(selectedCard, templates) : templates;
  const frontTemplates = templates.filter((template) => template.type === 'front' && !template.deletedAt);
  const backTemplates = templates.filter((template) => template.type === 'back' && !template.deletedAt);
  const previewFrontTemplates = cardPreviewTemplates.filter((template) => template.type === 'front' && !template.deletedAt);
  const previewBackTemplates = cardPreviewTemplates.filter((template) => template.type === 'back' && !template.deletedAt);
  const selectedFrontTemplate = previewFrontTemplates.find((template) => template.id === selectedCard?.front.templateId);
  const selectedBackTemplate = previewBackTemplates.find((template) => template.id === selectedCard?.back.templateId);
  const selectedTemplateFromSnapshot = Boolean(
    selectedCard
      && selectedCard.embeddedTemplateSnapshots?.some((template) => template.id === (activeSide === 'front' ? selectedCard.front.templateId : selectedCard.back.templateId))
      && !templates.some((template) => template.id === (activeSide === 'front' ? selectedCard.front.templateId : selectedCard.back.templateId)),
  );
  const activeTemplate = activeSide === 'front' ? selectedFrontTemplate : selectedBackTemplate;
  const selectedImageLayer = activeTemplate?.layers.find((layer) => layer.id === selectedImageLayerId);
  const selectedImageTransform =
    selectedCard && selectedImageLayer && isTemplateImageLayer(selectedImageLayer)
      ? getTemplateLayerImageTransform(selectedImageLayer, selectedCard, activeSide)
      : undefined;
  const selectedImageTarget = selectedImageLayer
    ? layerAcceptsCardAsset(selectedImageLayer, 'main', activeSide)
      ? 'main'
      : layerAcceptsCardAsset(selectedImageLayer, 'logo', activeSide)
        ? 'logo'
        : undefined
    : undefined;
  const selectedImageOverride = selectedCard && selectedImageLayer
    ? (activeSide === 'front' ? selectedCard.front.slotOverrides : selectedCard.back.slotOverrides)?.[getLayerOverrideKey(selectedImageLayer)]
    : undefined;
  const selectedImageAsset = selectedCard && selectedImageTarget
    ? resolveAssetReference(
        assetsById,
        activeSide === 'front'
          ? selectedImageTarget === 'main'
            ? selectedCard.front.heroImageAssetId
            : selectedCard.front.titleImageAssetId
          : selectedImageTarget === 'main'
            ? selectedCard.back.backgroundImageAssetId
            : selectedCard.back.brandLogoAssetId,
        activeSide === 'front'
          ? selectedImageTarget === 'main'
            ? selectedCard.front.heroImageAssetRef
            : selectedCard.front.titleImageAssetRef
          : selectedImageTarget === 'main'
            ? selectedCard.back.backgroundImageAssetRef
            : selectedCard.back.brandLogoAssetRef,
      )
    : undefined;
  const selectedImageNaturalSize: ImageNaturalSize = {
    width: selectedImageAsset?.width ?? Number(selectedImageLayer?.data?.imageNaturalWidth ?? 0),
    height: selectedImageAsset?.height ?? Number(selectedImageLayer?.data?.imageNaturalHeight ?? 0),
  };
  const selectedImageCropReady = hasNaturalImageSize(selectedImageNaturalSize);
  const selectedImageLayerFrame = selectedImageLayer ? getTemplateLayerFrame(selectedImageLayer, activeTemplate?.canvas) : undefined;
  const selectedImageLayerHeight = selectedImageLayerFrame?.height ?? activeTemplate?.canvas.height ?? selectedImageTransform?.height ?? 1;
  const selectedImageUiY = selectedImageTransform
    ? canvasToUiY(selectedImageTransform.y, selectedImageTransform.height, selectedImageLayerHeight)
    : 0;
  const selectedLibraryEntry = zaparooLibrary.entries.find((entry) => entry.id === selectedCard?.mister?.zaparooLibraryEntryId);
  const currentGameTitle = selectedGame?.title || selectedCard?.front.titleText || selectedCard?.id || '선택한 카드';
  const currentGamePlatform =
    selectedCard?.mister?.misterSystemId
    || selectedLibraryEntry?.systemId
    || selectedLibraryEntry?.platformGroup
    || selectedCard?.front.platformLabel
    || '플랫폼 미지정';
  const currentGamePath = selectedCard?.mister?.misterRelativePath || selectedLibraryEntry?.relativePath || selectedLibraryEntry?.launchValue;
  const currentGameLinked = Boolean(
    selectedCard?.mister?.resolvedMiSTerPath
    || selectedCard?.mister?.misterAbsolutePath
    || selectedCard?.mister?.misterRelativePath
    || selectedLibraryEntry?.relativePath
  );
  const imageSearchQuery = cleanGameTitleForSearch(currentGameTitle) || currentGameTitle;
  const handleCopyGameTitle = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(imageSearchQuery);
      setTitleCopied(true);
      window.setTimeout(() => setTitleCopied(false), 1500);
    } catch {
      setTitleCopied(false);
    }
  }, [imageSearchQuery]);
  const handleRefreshAssets = useCallback(async () => {
    if (isRefreshingAssets) return;
    setIsRefreshingAssets(true);
    try {
      const result = await refreshAssetLibraryFromDisk(assetLibrary);
      setAssetLibrary(result.library);
      setFeedback({ type: 'success', message: `이미지 에셋을 새로고침했습니다. 인덱스 ${result.indexed}개.` });
    } catch (error) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? `이미지 에셋 새로고침 실패: ${error.message}` : '이미지 에셋 새로고침에 실패했습니다.',
      });
    } finally {
      setIsRefreshingAssets(false);
    }
  }, [assetLibrary, isRefreshingAssets, setAssetLibrary]);
  const libraryPlatformBuckets = useMemo(() => {
    const buckets = new Map<string, ZaparooLibraryEntry[]>();
    zaparooLibrary.entries.filter(isPlayableLibraryEntry).forEach((entry) => {
      const key = `${entry.platformGroup || 'Other'} / ${entry.systemId || 'Unknown'}`;
      buckets.set(key, [...(buckets.get(key) ?? []), entry]);
    });
    return Array.from(buckets.entries())
      .filter(([, entries]) => platformHasPlayableEntry(entries))
      .map(([platform, entries]) => ({ platform, entries: entries.sort((a, b) => a.title.localeCompare(b.title)) }))
      .sort((a, b) => a.platform.localeCompare(b.platform));
  }, [zaparooLibrary.entries]);
  const libraryEntriesForPlatform = libraryPlatformBuckets.find((bucket) => bucket.platform === libraryPlatform)?.entries ?? [];
  const filteredLibraryEntries = libraryEntriesForPlatform.filter((entry) => {
    const query = libraryQuery.trim().toLowerCase();
    if (!query) return true;
    return `${entry.title} ${entry.romName} ${entry.relativePath}`.toLowerCase().includes(query);
  });
  const workingTotalPages = Math.max(1, Math.ceil(visibleCards.length / workingPageSize));
  const workingCardsPage = visibleCards.slice((workingPage - 1) * workingPageSize, workingPage * workingPageSize);

  const logEditorDiagnostics = useCallback((event: string) => {
    if (typeof window === 'undefined' || !['localhost', '127.0.0.1'].includes(window.location.hostname)) return;
    console.debug('[CardEditor diagnostics]', event, diagnosticsRef.current);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !['localhost', '127.0.0.1'].includes(window.location.hostname)) return;
    if (activeSide !== 'back' || !selectedCard || !selectedBackTemplate) return;
    const imageLayers = selectedBackTemplate.layers.filter(isTemplateImageLayer);
    const mainLayer = imageLayers.find((layer) => layerAcceptsCardAsset(layer, 'main', 'back'));
    const logoLayer = imageLayers.find((layer) => layerAcceptsCardAsset(layer, 'logo', 'back'));
    const key = JSON.stringify({
      cardId: selectedCard.id,
      templateId: selectedBackTemplate.id,
      backgroundImageAssetId: selectedCard.back.backgroundImageAssetId,
      brandLogoAssetId: selectedCard.back.brandLogoAssetId,
      slotOverrides: selectedCard.back.slotOverrides,
      layerFrames: imageLayers.map((layer) => [layer.id, getTemplateLayerFrame(layer, selectedBackTemplate.canvas)]),
    });
    if (backTemplateDiagnosticsKeyRef.current === key) return;
    backTemplateDiagnosticsKeyRef.current = key;
    console.debug('[CardEditor] back template load diagnostics', {
      selectedSide: activeSide,
      sourceTemplateId: selectedBackTemplate.id,
      sourceTemplateName: selectedBackTemplate.name,
      cardSize: selectedBackTemplate.canvas,
      cutOffsetMm: selectedBackTemplate.canvas.cutOffsetMm,
      safeMarginMm: selectedBackTemplate.canvas.safeMarginMm,
      resolvedImageSlots: {
        mainImage: {
          assetId: selectedCard.back.backgroundImageAssetId,
          assetRef: selectedCard.back.backgroundImageAssetRef,
          layerId: mainLayer?.id,
          slotType: mainLayer?.slotType,
        },
        clearLogo: {
          assetId: selectedCard.back.brandLogoAssetId,
          assetRef: selectedCard.back.brandLogoAssetRef,
          layerId: logoLayer?.id,
          slotType: logoLayer?.slotType,
        },
      },
      layers: imageLayers.map((layer) => ({
        id: layer.id,
        slotType: layer.slotType,
        savedLayerBounds: { x: layer.x, y: layer.y, width: layer.width, height: layer.height },
        savedSlotBounds: layer.slot ? { x: layer.slot.x, y: layer.slot.y, width: layer.slot.width, height: layer.slot.height } : undefined,
        resolvedLayerFrame: getTemplateLayerFrame(layer, selectedBackTemplate.canvas),
        savedImageTransform: layer.data?.imageTransform,
        cardOverride: selectedCard.back.slotOverrides?.[getLayerOverrideKey(layer)],
        resolvedImageTransform: getTemplateLayerImageTransform(layer, selectedCard, 'back'),
        fallbackBoundsUsed: !layer.width && !layer.height && !layer.slot?.width && !layer.slot?.height,
      })),
      fitOrStretchAppliedByLoad: false,
    });
  }, [activeSide, selectedBackTemplate, selectedCard]);

  useEffect(() => {
    visibleCardsRef.current = visibleCards;
  }, [visibleCards]);

  useEffect(() => {
    assetsByIdRef.current = assetsById;
  }, [assetsById]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, []);

  useEffect(() => {
    editorSessionAssetsRef.current = editorSessionAssetsByKey;
  }, [editorSessionAssetsByKey]);

  useEffect(() => {
    return () => {
      Object.values(editorSessionAssetsRef.current).forEach((asset) => {
        if (asset.objectUrl?.startsWith('blob:')) URL.revokeObjectURL(asset.objectUrl);
      });
    };
  }, []);

  useEffect(() => {
    const activeReferenceKeys = new Set(
      uniqueCardImageReferences(visibleCardsRef.current).map((reference) => assetReferenceCacheKey(reference)),
    );
    setEditorSessionAssetsByKey((current) => {
      let changed = false;
      const next: Record<string, LocalAsset> = {};
      Object.entries(current).forEach(([cacheKey, asset]) => {
        if (activeReferenceKeys.has(cacheKey)) {
          next[cacheKey] = asset;
          return;
        }
        changed = true;
        if (asset.objectUrl?.startsWith('blob:')) URL.revokeObjectURL(asset.objectUrl);
      });
      return changed ? next : current;
    });
  }, [cardImageRepairKey]);

  useEffect(() => {
    if (!selectedCard && visibleCards[0]) setSelectedId(visibleCards[0].id);
    if (workingPage > workingTotalPages) setWorkingPage(workingTotalPages);
  }, [selectedCard, visibleCards, workingPage, workingTotalPages]);

  useEffect(() => {
    const existingIds = new Set(visibleCards.map((card) => card.id));
    setSelectedWorkingIds((current) => current.filter((id) => existingIds.has(id)));
  }, [visibleCards]);

  useEffect(() => {
    if (!libraryDragSelecting) return undefined;
    function stopDragSelection() {
      setLibraryDragSelecting(false);
    }
    window.addEventListener('mouseup', stopDragSelection);
    return () => window.removeEventListener('mouseup', stopDragSelection);
  }, [libraryDragSelecting]);

  useEffect(() => {
    const referencesToRestore = missingUsedImageReferences(visibleCardsRef.current, assetsByIdRef.current);
    if (referencesToRestore.length === 0) return;
    let cancelled = false;
    setRestoreProgress({
      label: '이미지 캐시 복원',
      message: '카드편집에 필요한 저장 이미지 캐시를 확인하는 중입니다.',
      processed: 0,
      total: referencesToRestore.length,
    });
    void restoreUsedImageAssets(referencesToRestore, ({ processed, total, reference }) => {
      if (cancelled) return;
      setRestoreProgress({
        label: '이미지 캐시 복원',
        message: 'Image Management 재스캔 없이 used image cache에서 이미지를 복원하고 있습니다.',
        processed,
        total,
        detail: reference.displayName ?? reference.filename ?? reference.name ?? reference.cacheKey,
      });
    })
      .then((restoredAssets) => {
        if (cancelled) return;
        const enabledAssets = filterAssetsByEnabledGroups(restoredAssets);
        if (enabledAssets.length > 0) {
          const nextSessionAssets = { ...editorSessionAssetsRef.current };
          const objectUrlsToRevoke: string[] = [];
          let loadedCount = 0;
          enabledAssets.forEach((asset) => {
            const reference = assetReferenceFromAsset(asset);
            const cacheKey = reference ? assetReferenceCacheKey(reference) : asset.id;
            if (nextSessionAssets[cacheKey]?.objectUrl) {
              if (asset.objectUrl?.startsWith('blob:') && asset.objectUrl !== nextSessionAssets[cacheKey].objectUrl) objectUrlsToRevoke.push(asset.objectUrl);
              return;
            }
            nextSessionAssets[cacheKey] = asset;
            loadedCount += 1;
          });
          objectUrlsToRevoke.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
          if (loadedCount > 0) setEditorSessionAssetsByKey(nextSessionAssets);
          diagnosticsRef.current.imageAssetLoadCount += loadedCount;
          if (loadedCount > 0) logEditorDiagnostics(`restored ${loadedCount} editor image asset(s)`);
        }
      })
      .finally(() => {
        if (!cancelled) setRestoreProgress(null);
      });
    return () => {
      cancelled = true;
      setRestoreProgress(null);
    };
  }, [logEditorDiagnostics, missingUsedAssetReferenceKey]);

  useEffect(() => {
    const cardsToRepair = visibleCardsRef.current;
    if (cardsToRepair.length === 0) return;
    const currentAssetsById = assetsByIdRef.current;
    const currentAssetCount = Object.keys(currentAssetsById).length;
    let cancelled = false;
    void (async () => {
      setCacheRepairProgress({
        label: '카드 이미지 참조 점검',
        message: '카드편집 이미지가 persistent cache를 가리키는지 확인하는 중입니다.',
        processed: 0,
        total: cardsToRepair.length,
      });
      for (const [index, card] of cardsToRepair.entries()) {
        if (cancelled) return;
        setCacheRepairProgress({
          label: '카드 이미지 참조 점검',
          message: `로드된 이미지 인덱스 ${currentAssetCount.toLocaleString()}개 중 필요한 참조만 확인합니다.`,
          processed: index + 1,
          total: cardsToRepair.length,
          detail: card.front.titleText || card.id,
        });
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        const result = await ensureCardImagesCached(card, currentAssetsById);
        if (cancelled) return;
        if (result.changed) updateCard(card.id, result.card);
      }
      if (!cancelled) setCacheRepairProgress(null);
    })();
    return () => {
      cancelled = true;
      setCacheRepairProgress(null);
    };
  }, [assets.length, cardImageRepairKey, updateCard]);

  useEffect(() => {
    function handleHistoryShortcut(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && event.shiftKey) {
        event.preventDefault();
        redoWorkingCards();
      } else if (key === 'z') {
        event.preventDefault();
        undoWorkingCards();
      } else if (key === 'y') {
        event.preventDefault();
        redoWorkingCards();
      }
    }

    window.addEventListener('keydown', handleHistoryShortcut);
    return () => window.removeEventListener('keydown', handleHistoryShortcut);
  });

  useEffect(() => () => {
    if (transformHistoryCoalesceTimerRef.current !== null) {
      window.clearTimeout(transformHistoryCoalesceTimerRef.current);
    }
  }, []);

  function recordWorkingHistory() {
    setUndoStack((current) => [...current, cloneCards(cards)].slice(-cardEditorHistoryLimit));
    setRedoStack([]);
  }

  function recordImageTransformHistory(coalesce: boolean) {
    if (!coalesce) {
      recordWorkingHistory();
      return;
    }
    if (!transformHistoryCoalescingRef.current) {
      recordWorkingHistory();
      transformHistoryCoalescingRef.current = true;
    }
    if (transformHistoryCoalesceTimerRef.current !== null) {
      window.clearTimeout(transformHistoryCoalesceTimerRef.current);
    }
    transformHistoryCoalesceTimerRef.current = window.setTimeout(() => {
      transformHistoryCoalescingRef.current = false;
      transformHistoryCoalesceTimerRef.current = null;
    }, 300);
  }

  function undoWorkingCards() {
    const previous = undoStack[undoStack.length - 1];
    if (!previous) return;
    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => [cloneCards(cards), ...current].slice(0, cardEditorHistoryLimit));
    restoreWorkingCards(previous);
    setSelectedId(previous.find((card) => !card.deleted)?.id ?? '');
  }

  function redoWorkingCards() {
    const next = redoStack[0];
    if (!next) return;
    setRedoStack((current) => current.slice(1));
    setUndoStack((current) => [...current, cloneCards(cards)].slice(-cardEditorHistoryLimit));
    restoreWorkingCards(next);
    setSelectedId(next.find((card) => !card.deleted)?.id ?? '');
  }

  function patchSelected(patch: Partial<CardItem>) {
    if (!selectedCard) return;
    recordWorkingHistory();
    updateCard(selectedCard.id, patch);
  }

  function patchFront(patch: Partial<CardItem['front']>) {
    if (!selectedCard) return;
    patchSelected({ front: { ...selectedCard.front, ...patch } });
  }

  function patchBack(patch: Partial<CardItem['back']>) {
    if (!selectedCard) return;
    patchSelected({ back: { ...selectedCard.back, ...patch, generatedFallback: false } });
  }

  function patchImageTransform(
    layer: TemplateLayer,
    transform: ImageTransform,
    fitMode?: ImageFitMode,
    options: { coalesceHistory?: boolean } = {},
  ) {
    if (!selectedCard) return;
    recordImageTransformHistory(Boolean(options.coalesceHistory));
    diagnosticsRef.current.transformUpdateCount += 1;
    if (diagnosticsRef.current.transformUpdateCount === 1 || diagnosticsRef.current.transformUpdateCount % 25 === 0) {
      logEditorDiagnostics('image transform updated');
    }
    const override = toSlotOverride(transform, fitMode);
    if (activeSide === 'front') {
      updateCard(selectedCard.id, {
        front: {
          ...selectedCard.front,
          slotOverrides: {
            ...selectedCard.front.slotOverrides,
            [getLayerOverrideKey(layer)]: override,
          },
        },
      });
      return;
    }
    updateCard(selectedCard.id, {
      back: {
        ...selectedCard.back,
        generatedFallback: false,
        slotOverrides: {
          ...selectedCard.back.slotOverrides,
          [getLayerOverrideKey(layer)]: override,
        },
      },
    });
  }

  function alignSelectedImage(axis: 'horizontal' | 'vertical' | 'both') {
    if (!selectedImageLayer || !selectedImageTransform) return;
    const layerFrame = getTemplateLayerFrame(selectedImageLayer, activeTemplate?.canvas);
    const layerWidth = layerFrame.width ?? selectedImageTransform.width;
    const layerHeight = layerFrame.height ?? selectedImageTransform.height;
    patchImageTransform(selectedImageLayer, {
      ...selectedImageTransform,
      x: axis === 'horizontal' || axis === 'both' ? (layerWidth - selectedImageTransform.width) / 2 : selectedImageTransform.x,
      y: axis === 'vertical' || axis === 'both' ? (layerHeight - selectedImageTransform.height) / 2 : selectedImageTransform.y,
    }, selectedImageTransform.fitMode);
  }

  function scaleSelectedImageFromCenter(event: { shiftKey: boolean; altKey: boolean }, direction: 1 | -1) {
    if (!selectedImageLayer || !selectedImageTransform) return;
    const edgeDeltaPx = event.shiftKey ? 10 : event.altKey ? 0.5 : 1;
    const nextTransform = applyCenteredImageZoom(selectedImageTransform, direction, edgeDeltaPx);
    if (
      typeof window !== 'undefined'
      && ['localhost', '127.0.0.1'].includes(window.location.hostname)
      && activeSide === 'back'
      && selectedImageTarget === 'main'
    ) {
      console.debug('[CardEditor] back main centered zoom', {
        selectedSide: activeSide,
        imageId: selectedCard?.back.backgroundImageAssetId,
        imagePath: selectedCard?.back.backgroundImageAssetRef?.originalPath ?? selectedCard?.back.backgroundImageAssetRef?.path,
        fitMode: selectedImageTransform.fitMode,
        preserveAspectRatio: true,
        before: {
          scaleX: selectedImageTransform.scaleX,
          scaleY: selectedImageTransform.scaleY,
          width: selectedImageTransform.width,
          height: selectedImageTransform.height,
        },
        after: {
          scaleX: nextTransform.scaleX,
          scaleY: nextTransform.scaleY,
          width: nextTransform.width,
          height: nextTransform.height,
        },
        defaultZoomStepsApplied: false,
        userEditedTransformPreserved: true,
      });
    }
    patchImageTransform(
      selectedImageLayer,
      nextTransform,
      selectedImageTransform.fitMode,
      { coalesceHistory: true },
    );
  }

  const imageCenterShrinkHoldHandlers = usePressAndHold<HTMLButtonElement>((modifiers) => scaleSelectedImageFromCenter(modifiers, -1));
  const imageCenterEnlargeHoldHandlers = usePressAndHold<HTMLButtonElement>((modifiers) => scaleSelectedImageFromCenter(modifiers, 1));

  function imageLayerForTarget(target: 'main' | 'logo', side: EditorSide = activeSide) {
    const template = side === 'front' ? selectedFrontTemplate : selectedBackTemplate;
    return template?.layers.find((candidate) => layerAcceptsCardAsset(candidate, target, side));
  }

  function fitTransformForImageLayer(
    target: 'main' | 'logo',
    layer: TemplateLayer,
    template: Template,
    imageSize: { width?: number; height?: number },
    fitMode?: ImageFitMode,
    options: { forceDefaultMainZoom?: boolean; useDefaultMainZoom?: boolean } = {},
  ) {
    const useMainImageDefault = target === 'main' && options.useDefaultMainZoom;
    const mainImageDefaultFitMode: ImageFitMode = template.type === 'back' ? 'cover' : 'original';
    const mode = fitMode ?? (useMainImageDefault ? mainImageDefaultFitMode : defaultFitModeForSlot(layer.slotType));
    const layerDefaultTransform = layer.data?.imageTransform as Partial<ImageTransform> | undefined;
    const baseTransform = {
      ...fitImageToBounds(mode, imageSize, getTemplateLayerFrame(layer, template.canvas)),
      rotation: layerDefaultTransform?.rotation ?? 0,
    };
    const transform = target === 'main' && options.useDefaultMainZoom
      ? applyCenteredImageZoom(baseTransform, DEFAULT_BATCH_IMAGE_CENTER_ZOOM_STEPS)
      : baseTransform;
    if (
      typeof window !== 'undefined'
      && ['localhost', '127.0.0.1'].includes(window.location.hostname)
      && target === 'main'
      && options.useDefaultMainZoom
    ) {
      console.debug('[CardEditor] main image default initialized', {
        selectedSide: template.type,
        templateId: template.id,
        layerId: layer.id,
        imageSize,
        fitMode: mode,
        preserveAspectRatio: true,
        backMainDefaultFitMode: template.type === 'back' ? 'cover' : undefined,
        scaleX: transform.scaleX,
        scaleY: transform.scaleY,
        width: transform.width,
        height: transform.height,
        defaultZoomStepsApplied: DEFAULT_BATCH_IMAGE_CENTER_ZOOM_STEPS,
        savedTemplateTransformPreserved: false,
      });
    }
    return {
      mode,
      transform,
    };
  }

  async function defaultOverrideForTemplateLayer(
    target: 'main' | 'logo',
    template: Template | undefined,
    layer: TemplateLayer | undefined,
    asset: LocalAsset | undefined,
    fitMode?: ImageFitMode,
    options: { forceDefaultMainZoom?: boolean; useDefaultMainZoom?: boolean } = {},
  ) {
    if (!template || !layer) return undefined;
    if (target === 'main' && options.useDefaultMainZoom && !options.forceDefaultMainZoom && hasTemplateLayerSavedImageTransform(layer)) {
      if (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
        console.debug('[CardEditor] preserving template main image transform; skipping default zoom override', {
          templateId: template.id,
          templateType: template.type,
          layerId: layer.id,
          imageTransform: layer.data?.imageTransform,
        });
      }
      return undefined;
    }
    const imageSize = await loadAssetSize(asset);
    const fitted = fitTransformForImageLayer(target, layer, template, imageSize, fitMode, options);
    return toSlotOverride(fitted.transform, fitted.mode);
  }

  async function fitOverrideForCardLayer(
    target: 'main' | 'logo',
    asset: LocalAsset | undefined,
    fitMode?: ImageFitMode,
    options: { useDefaultMainZoom?: boolean } = {},
    side: EditorSide = activeSide,
  ) {
    const template = side === 'front' ? selectedFrontTemplate : selectedBackTemplate;
    if (!template) return undefined;
    const layer = imageLayerForTarget(target, side);
    if (!layer) return undefined;
    const override = await defaultOverrideForTemplateLayer(target, template, layer, asset, fitMode, options);
    if (!override) return undefined;
    return {
      layer,
      override,
    };
  }

  async function assignFrontAsset(target: 'main' | 'logo', assetId?: string) {
    if (!selectedCard) return;
    recordWorkingHistory();
    if (!assetId) {
      const nextSlotOverrides = { ...(selectedCard.front.slotOverrides ?? {}) };
      const layer = imageLayerForTarget(target, 'front');
      if (layer) delete nextSlotOverrides[getLayerOverrideKey(layer)];
      updateCard(selectedCard.id, {
        front: {
          ...selectedCard.front,
          ...(target === 'main'
            ? { heroImageAssetId: undefined, heroImageAssetRef: undefined }
            : { titleImageAssetId: undefined, titleImageAssetRef: undefined }),
          slotOverrides: nextSlotOverrides,
        },
      });
      if (layer?.id === selectedImageLayerId) setSelectedImageLayerId(undefined);
      return;
    }
    const previousRef = target === 'main' ? selectedCard.front.heroImageAssetRef : selectedCard.front.titleImageAssetRef;
    const asset = resolveAssetReference(assetsById, assetId, previousRef);
    const persistentReference = asset ? (await cacheUsedAsset(asset)) ?? assetReferenceFromAsset(asset) : undefined;
    const fit = asset ? await fitOverrideForCardLayer(target, asset, undefined, { useDefaultMainZoom: target === 'main' }, 'front') : undefined;
    const nextSlotOverrides = { ...(selectedCard.front.slotOverrides ?? {}) };
    if (fit) nextSlotOverrides[getLayerOverrideKey(fit.layer)] = fit.override;
    const nextFront = {
      ...selectedCard.front,
      ...(target === 'main'
        ? { heroImageAssetId: asset?.id ?? assetId, heroImageAssetRef: persistentReference }
        : { titleImageAssetId: asset?.id ?? assetId, titleImageAssetRef: persistentReference }),
      slotOverrides: nextSlotOverrides,
    };
    updateCard(selectedCard.id, { front: nextFront });
    if (fit) setSelectedImageLayerId(fit.layer.id);
  }

  async function assignBackAsset(target: 'main' | 'logo', assetId?: string) {
    if (!selectedCard) return;
    recordWorkingHistory();
    const layer = imageLayerForTarget(target, 'back');
    if (!assetId) {
      const nextSlotOverrides = { ...(selectedCard.back.slotOverrides ?? {}) };
      if (layer) delete nextSlotOverrides[getLayerOverrideKey(layer)];
      updateCard(selectedCard.id, {
        back: {
          ...selectedCard.back,
          generatedFallback: false,
          ...(target === 'main'
            ? { backgroundImageAssetId: undefined, backgroundImageAssetRef: undefined }
            : { brandLogoAssetId: undefined, brandLogoAssetRef: undefined }),
          slotOverrides: nextSlotOverrides,
        },
      });
      if (layer?.id === selectedImageLayerId) setSelectedImageLayerId(undefined);
      return;
    }
    const previousRef = target === 'main' ? selectedCard.back.backgroundImageAssetRef : selectedCard.back.brandLogoAssetRef;
    const asset = resolveAssetReference(assetsById, assetId, previousRef);
    const persistentReference = asset ? (await cacheUsedAsset(asset)) ?? assetReferenceFromAsset(asset) : undefined;
    const fit = asset ? await fitOverrideForCardLayer(target, asset, undefined, { useDefaultMainZoom: target === 'main' }, 'back') : undefined;
    const nextSlotOverrides = { ...(selectedCard.back.slotOverrides ?? {}) };
    if (fit) nextSlotOverrides[getLayerOverrideKey(fit.layer)] = fit.override;
    updateCard(selectedCard.id, {
      back: {
        ...selectedCard.back,
        generatedFallback: false,
        ...(target === 'main'
          ? { backgroundImageAssetId: asset?.id ?? assetId, backgroundImageAssetRef: persistentReference }
          : { brandLogoAssetId: asset?.id ?? assetId, brandLogoAssetRef: persistentReference }),
        slotOverrides: nextSlotOverrides,
      },
    });
    if (fit) setSelectedImageLayerId(fit.layer.id);
  }

  function buildDroppedImageAsset(file: File, side: EditorSide): LocalAsset {
    const fileName = file.name || 'dropped-image.png';
    const base = fileName.replace(/\.[^.]+$/, '') || 'image';
    const format = (fileName.split('.').pop() || 'png').toLowerCase();
    const id = `asset_drop_${normalizeName(base).replace(/[^a-z0-9]+/g, '_')}_${Date.now().toString(36)}`;
    return {
      id,
      sourceId: 'card-editor-drop',
      sourceLabel: '드롭한 이미지',
      kind: side === 'front' ? 'box-front' : 'background',
      name: fileName,
      normalizedName: normalizeName(fileName),
      path: fileName,
      originalPath: fileName,
      platform: '',
      assetType: 'Dropped',
      normalizedFileName: normalizeName(base),
      file,
      objectUrl: URL.createObjectURL(file),
      mimeType: file.type || undefined,
      format: format as LocalAsset['format'],
      importedAt: new Date().toISOString(),
    };
  }

  async function handleMainImageDrop(files: FileList | File[]) {
    if (!selectedCard) return;
    const file = Array.from(files).find(
      (candidate) => candidate.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(candidate.name),
    );
    if (!file) {
      setFeedback({ type: 'error', message: '이미지 파일만 메인 이미지로 드롭할 수 있습니다.' });
      return;
    }
    const side = activeSide;
    recordWorkingHistory();
    const asset = buildDroppedImageAsset(file, side);
    setEditorSessionAssetsByKey((current) => ({ ...current, [asset.id]: asset }));

    // Best-effort: archive the dropped file into a dedicated images folder, named after the game so it
    // is identifiable (and matchable later if that folder is added as an image source).
    let savedFolder: string | undefined;
    try {
      const api = window.helloMisterDesktop;
      if (api?.saveCardImage) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const baseName = cleanGameTitleForSearch(currentGameTitle) || file.name.replace(/\.[^.]+$/, '');
        const saved = await api.saveCardImage({ fileName: file.name, baseName, bytes });
        if (saved?.ok && saved.path) {
          asset.path = saved.path;
          asset.originalPath = saved.path;
          savedFolder = saved.folder;
        }
      }
    } catch {
      // disk archive is optional; the image is still applied to the card below.
    }

    // Assign to the active side's main slot, centered (same fit logic as the asset picker).
    const persistentReference = (await cacheUsedAsset(asset)) ?? assetReferenceFromAsset(asset);
    const fit = await fitOverrideForCardLayer('main', asset, undefined, { useDefaultMainZoom: true }, side);
    if (side === 'front') {
      const nextSlotOverrides = { ...(selectedCard.front.slotOverrides ?? {}) };
      if (fit) nextSlotOverrides[getLayerOverrideKey(fit.layer)] = fit.override;
      updateCard(selectedCard.id, {
        front: { ...selectedCard.front, heroImageAssetId: asset.id, heroImageAssetRef: persistentReference, slotOverrides: nextSlotOverrides },
      });
    } else {
      const nextSlotOverrides = { ...(selectedCard.back.slotOverrides ?? {}) };
      if (fit) nextSlotOverrides[getLayerOverrideKey(fit.layer)] = fit.override;
      updateCard(selectedCard.id, {
        back: {
          ...selectedCard.back,
          generatedFallback: false,
          backgroundImageAssetId: asset.id,
          backgroundImageAssetRef: persistentReference,
          slotOverrides: nextSlotOverrides,
        },
      });
    }
    if (fit) setSelectedImageLayerId(fit.layer.id);
    setFeedback({
      type: 'success',
      message: savedFolder
        ? `메인 이미지를 넣고 가운데 정렬했습니다. 이미지 파일 저장: ${savedFolder}`
        : '메인 이미지를 넣고 가운데 정렬했습니다.',
    });
  }

  function rememberImageOverride(asset: LocalAsset) {
    if (!selectedLibraryEntry?.imageMatchKey) return;
    const now = new Date().toISOString();
    const existing = mister.mapping.overrides.find((override) => override.imageMatchKey === selectedLibraryEntry.imageMatchKey);
    const nextOverride = {
      id: existing?.id ?? `override_${Date.now()}`,
      entryId: selectedLibraryEntry.id,
      imageMatchKey: selectedLibraryEntry.imageMatchKey,
      assetId: asset.id,
      reason: 'Card Editor candidate selection',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    setMiSTerMapping({
      ...mister.mapping,
      overrides: [nextOverride, ...mister.mapping.overrides.filter((override) => override.imageMatchKey !== selectedLibraryEntry.imageMatchKey)],
    });
  }

  async function applyCandidateAsset(target: 'main' | 'logo', asset: LocalAsset) {
    await assignFrontAsset(target, asset.id);
    if (target === 'main') rememberImageOverride(asset);
    setMatchCandidates((current) => ({ ...current, [target]: [] }));
    setFeedback({
      type: 'success',
      message: target === 'main' ? '추천 후보를 Main Image로 적용했습니다.' : '추천 후보를 Clear Logo로 적용했습니다.',
    });
  }

  async function matchFrontAsset(target: 'main' | 'logo') {
    const assetsToSearch = target === 'main' ? mainImageAssets : clearLogoAssets;
    const match = matchAssetForEntry(assetsToSearch, selectedLibraryEntry, selectedGame?.title);
    if (!match) {
      const candidates = partialMatchCandidates(assetsToSearch, selectedLibraryEntry, selectedGame?.title, target);
      setMatchCandidates((current) => ({ ...current, [target]: candidates }));
      setFeedback({
        type: candidates.length > 0 ? 'success' : 'error',
        message:
          candidates.length > 0
            ? target === 'main'
              ? '정확한 Main Image 매칭은 없지만 추천 후보를 찾았습니다.'
              : '정확한 Clear Logo 매칭은 없지만 추천 후보를 찾았습니다.'
            : target === 'main'
              ? '매칭되는 Main Image를 찾지 못했습니다.'
              : '매칭되는 Clear Logo를 찾지 못했습니다.',
      });
      return;
    }
    await assignFrontAsset(target, match.id);
    setMatchCandidates((current) => ({ ...current, [target]: [] }));
    setFeedback({ type: 'success', message: target === 'main' ? 'Main Image를 매칭했습니다.' : 'Clear Logo를 매칭했습니다.' });
  }

  async function applyFitModeToSelectedLayer(fitMode: ImageFitMode) {
    if (!selectedCard || !selectedImageLayer) return;
    const target = layerAcceptsCardAsset(selectedImageLayer, 'main', activeSide) ? 'main' : 'logo';
    const assetId = activeSide === 'front'
      ? target === 'main' ? selectedCard.front.heroImageAssetId : selectedCard.front.titleImageAssetId
      : target === 'main' ? selectedCard.back.backgroundImageAssetId : selectedCard.back.brandLogoAssetId;
    const assetRef = activeSide === 'front'
      ? target === 'main' ? selectedCard.front.heroImageAssetRef : selectedCard.front.titleImageAssetRef
      : target === 'main' ? selectedCard.back.backgroundImageAssetRef : selectedCard.back.brandLogoAssetRef;
    recordWorkingHistory();
    const fit = await fitOverrideForCardLayer(target, resolveAssetReference(assetsById, assetId, assetRef), fitMode, {}, activeSide);
    if (!fit) return;
    if (activeSide === 'front') {
      updateCard(selectedCard.id, {
        front: {
          ...selectedCard.front,
          slotOverrides: {
            ...selectedCard.front.slotOverrides,
            [getLayerOverrideKey(fit.layer)]: fit.override,
          },
        },
      });
    } else {
      updateCard(selectedCard.id, {
        back: {
          ...selectedCard.back,
          generatedFallback: false,
          slotOverrides: {
            ...selectedCard.back.slotOverrides,
            [getLayerOverrideKey(fit.layer)]: fit.override,
          },
        },
      });
    }
    setSelectedImageLayerId(fit.layer.id);
  }

  async function resetSelectedImageTransform() {
    if (!selectedImageLayer || !selectedCard) return;
    const nextOverrides = activeSide === 'front' ? { ...(selectedCard.front.slotOverrides ?? {}) } : { ...(selectedCard.back.slotOverrides ?? {}) };
    const target = layerAcceptsCardAsset(selectedImageLayer, 'main', activeSide)
      ? 'main'
      : layerAcceptsCardAsset(selectedImageLayer, 'logo', activeSide)
        ? 'logo'
        : undefined;
    if (target === 'main') {
      const asset = activeSide === 'front'
        ? resolveAssetReference(assetsById, selectedCard.front.heroImageAssetId, selectedCard.front.heroImageAssetRef)
        : resolveAssetReference(assetsById, selectedCard.back.backgroundImageAssetId, selectedCard.back.backgroundImageAssetRef);
      const override = await defaultOverrideForTemplateLayer('main', activeTemplate, selectedImageLayer, asset, undefined, { forceDefaultMainZoom: true, useDefaultMainZoom: true });
      if (override) nextOverrides[getLayerOverrideKey(selectedImageLayer)] = override;
      else delete nextOverrides[getLayerOverrideKey(selectedImageLayer)];
    } else {
      delete nextOverrides[getLayerOverrideKey(selectedImageLayer)];
    }
    if (selectedImageLayer.slotType && target !== 'main') delete nextOverrides[selectedImageLayer.slotType];
    if (activeSide === 'front') patchFront({ slotOverrides: nextOverrides });
    else patchBack({ slotOverrides: nextOverrides });
  }

  async function handleSaveCurrentCard() {
    if (!selectedCard) {
      setFeedback({ type: 'error', message: 'No card is selected to save.' });
      return;
    }
    const cacheResult = await ensureCardImagesCached(selectedCard, assetsById);
    if (cacheResult.changed) updateCard(selectedCard.id, cacheResult.card);
    recordWorkingHistory();
    diagnosticsRef.current.saveCount += 1;
    logEditorDiagnostics('card save committed');
    saveCard(selectedCard.id);
    removeWorkingCard(selectedCard.id);
    setSelectedId(visibleCards.find((card) => card.id !== selectedCard.id)?.id ?? '');
    setFeedback({
      type: cacheResult.warnings.length > 0 ? 'error' : 'success',
      message: cacheResult.warnings.length > 0 ? `Card saved, but image cache needs attention: ${cacheResult.warnings.join(' ')}` : 'Card saved to the album.',
    });
  }

  async function handleSaveAsNewCard() {
    if (!selectedCard) {
      setFeedback({ type: 'error', message: 'No card is selected to save.' });
      return;
    }
    const cacheResult = await ensureCardImagesCached(selectedCard, assetsById);
    if (cacheResult.changed) updateCard(selectedCard.id, cacheResult.card);
    recordWorkingHistory();
    diagnosticsRef.current.saveCount += 1;
    logEditorDiagnostics('card save-as-new committed');
    saveCardAsNew(selectedCard.id);
    removeWorkingCard(selectedCard.id);
    setSelectedId(visibleCards.find((card) => card.id !== selectedCard.id)?.id ?? '');
    setFeedback({
      type: cacheResult.warnings.length > 0 ? 'error' : 'success',
      message: cacheResult.warnings.length > 0 ? `Card saved as a new version, but image cache needs attention: ${cacheResult.warnings.join(' ')}` : 'Card saved as a new version.',
    });
  }

  function toggleWorkingCardSelection(cardId: string) {
    setSelectedWorkingIds((current) => (current.includes(cardId) ? current.filter((id) => id !== cardId) : [...current, cardId]));
  }

  function selectCurrentWorkingPage() {
    const pageIds = workingCardsPage.map((card) => card.id);
    setSelectedWorkingIds((current) => Array.from(new Set([...current, ...pageIds])));
  }

  function applyTemplateToSelectedWorkingCards() {
    if (selectedWorkingIds.length === 0) {
      setFeedback({ type: 'error', message: '템플릿을 일괄 적용할 카드편집 항목을 선택하세요.' });
      return;
    }
    const selectedCards = visibleCards.filter((card) => selectedWorkingIds.includes(card.id));
    const sourceCard = selectedCards[0];
    if (!sourceCard) return;
    if (!sourceCard.front.templateId && !sourceCard.back.templateId) {
      setFeedback({ type: 'error', message: '첫 번째 선택 카드에 템플릿이 없습니다. 템플릿 선택 팝업에서 템플릿을 고르면 선택 카드 전체에 적용됩니다.' });
      return;
    }
    const sourceFrontTemplate = frontTemplates.find((template) => template.id === sourceCard.front.templateId);
    const sourceBackTemplate = backTemplates.find((template) => template.id === sourceCard.back.templateId);
    selectedCards.forEach((card) => {
      updateCard(card.id, {
        front: {
          ...card.front,
          templateId: sourceCard.front.templateId,
          slotOverrides: sourceCard.front.templateId ? preserveImageOverridesForTemplateChange(card, 'front', sourceFrontTemplate) : {},
        },
        back: {
          ...card.back,
          templateId: sourceCard.back.templateId,
          slotOverrides: sourceCard.back.templateId ? preserveImageOverridesForTemplateChange(card, 'back', sourceBackTemplate) : {},
        },
        layoutMode: sourceCard.front.templateId ? 'CUSTOM' : card.layoutMode,
        customTemplateId: sourceCard.front.templateId ?? card.customTemplateId,
      });
    });
    setFeedback({ type: 'success', message: `첫 번째 선택 카드의 템플릿을 ${selectedCards.length}개 카드편집 항목에 적용했습니다.` });
  }

  async function fitOverrideForTemplateLayer(
    template: Template | undefined,
    layer: TemplateLayer | undefined,
    asset: LocalAsset | undefined,
    fitMode: ImageFitMode,
    target: 'main' | 'logo',
  ) {
    return defaultOverrideForTemplateLayer(target, template, layer, asset, fitMode, {
      forceDefaultMainZoom: target === 'main',
      useDefaultMainZoom: target === 'main',
    });
  }

  function firstMatchCandidate(assetsToSearch: LocalAsset[], entry: ZaparooLibraryEntry | undefined, title: string | undefined, target: 'main' | 'logo') {
    return matchAssetForEntry(assetsToSearch, entry, title) ?? partialMatchCandidates(assetsToSearch, entry, title, target, 1)[0]?.asset;
  }

  function cloneSlotOverride(override: SlotOverride | undefined): SlotOverride | undefined {
    return override ? { ...override } : undefined;
  }

  function templateForCardSide(card: CardItem, side: 'front' | 'back') {
    const templateId = side === 'front' ? card.front.templateId : card.back.templateId;
    const templates = side === 'front' ? frontTemplates : backTemplates;
    return templates.find((template) => template.id === templateId);
  }

  function imageLayerForTemplate(template: Template | undefined, target: 'main' | 'logo', side: 'front' | 'back') {
    return template?.layers.find((candidate) => layerAcceptsCardAsset(candidate, target, side));
  }

  function overrideByLayerOrSlot(overrides: Record<string, SlotOverride> | undefined, layer: TemplateLayer | undefined) {
    if (!overrides || !layer) return undefined;
    return overrides[getLayerOverrideKey(layer)] ?? (layer.slotType ? overrides[layer.slotType] : undefined);
  }

  function preservedOverrideForTemplateTarget(
    card: CardItem,
    side: 'front' | 'back',
    target: 'main' | 'logo',
    nextLayer: TemplateLayer | undefined,
  ) {
    const face = side === 'front' ? card.front : card.back;
    const existingOverrides = face.slotOverrides ?? {};
    const sameNextLayerOverride = overrideByLayerOrSlot(existingOverrides, nextLayer);
    if (sameNextLayerOverride) return cloneSlotOverride(sameNextLayerOverride);

    const previousTemplate = templateForCardSide(card, side);
    const previousLayer = imageLayerForTemplate(previousTemplate, target, side);
    const previousLayerOverride = overrideByLayerOrSlot(existingOverrides, previousLayer);
    if (previousLayerOverride) return cloneSlotOverride(previousLayerOverride);

    const fallbackKeys = target === 'main'
      ? ['mainImage', 'heroImage', 'background', 'backgroundArt']
      : ['gameLogo', 'titleImage', 'brandLogo', 'platformLogo', 'clearLogo'];
    for (const key of fallbackKeys) {
      const override = existingOverrides[key];
      if (override) return cloneSlotOverride(override);
    }
    return undefined;
  }

  function preserveImageOverridesForTemplateChange(card: CardItem, side: 'front' | 'back', nextTemplate: Template | undefined) {
    if (!nextTemplate) return side === 'front' ? { ...(card.front.slotOverrides ?? {}) } : { ...(card.back.slotOverrides ?? {}) };
    const nextOverrides: Record<string, SlotOverride> = {};
    for (const target of ['main', 'logo'] as const) {
      const nextLayer = imageLayerForTemplate(nextTemplate, target, side);
      const preservedOverride = preservedOverrideForTemplateTarget(card, side, target, nextLayer);
      if (nextLayer && preservedOverride) {
        nextOverrides[getLayerOverrideKey(nextLayer)] = preservedOverride;
      }
    }
    return nextOverrides;
  }

  function selectedCardsForBatch() {
    return visibleCards.filter((card) => selectedWorkingIds.includes(card.id));
  }

  async function applyTemplateIdToSelectedCards(side: 'front' | 'back', templateId: string) {
    const selectedCards = selectedCardsForBatch();
    if (selectedCards.length <= 1) return false;
    const nextTemplate = side === 'front' ? frontTemplates.find((template) => template.id === templateId) : backTemplates.find((template) => template.id === templateId);
    for (const card of selectedCards) {
      if (!card) return;
      const nextSlotOverrides = templateId ? preserveImageOverridesForTemplateChange(card, side, nextTemplate) : {};
      updateCard(card.id, {
        ...(side === 'front'
          ? {
              layoutMode: templateId ? 'CUSTOM' : 'UNASSIGNED',
              customTemplateId: templateId || undefined,
              front: {
                ...card.front,
                layoutMode: templateId ? 'CUSTOM' : 'UNASSIGNED',
                templateId: templateId || undefined,
                slotOverrides: nextSlotOverrides,
              },
            }
          : { back: { ...card.back, templateId: templateId || undefined, slotOverrides: nextSlotOverrides } }),
      });
    }
    setFeedback({ type: 'success', message: `선택한 카드편집 항목 ${selectedCards.length}개에 템플릿을 적용했습니다.` });
    return true;
  }

  async function matchImagesForSelectedWorkingCards() {
    if (selectedWorkingIds.length === 0) {
      setFeedback({ type: 'error', message: '이미지 매칭을 실행할 카드편집 항목을 선택하세요.' });
      return;
    }
    let matched = 0;
    let noMatch = 0;
    let errorCount = 0;
    for (const card of selectedCardsForBatch()) {
      const entry = zaparooLibrary.entries.find((candidate) => candidate.id === card.mister?.zaparooLibraryEntryId);
      if (!entry) {
        noMatch += 1;
        continue;
      }
      const main = firstMatchCandidate(mainImageAssets, entry, card.front.titleText, 'main');
      const logo = firstMatchCandidate(clearLogoAssets, entry, card.front.titleText, 'logo');
      if (!main && !logo) {
        noMatch += 1;
        continue;
      }
      try {
        const template = frontTemplates.find((candidate) => candidate.id === card.front.templateId);
        const nextOverrides = { ...(card.front.slotOverrides ?? {}) };
        const nextFront = { ...card.front };
        if (main) {
          const mainAlreadyAssigned = cardImageMatchesAsset(card.front.heroImageAssetId, card.front.heroImageAssetRef, main);
          const persistentReference = (await cacheUsedAsset(main)) ?? assetReferenceFromAsset(main);
          const layer = template?.layers.find((candidate) => layerAcceptsCardAsset(candidate, 'main'));
          nextFront.heroImageAssetId = main.id;
          nextFront.heroImageAssetRef = persistentReference;
          if (!mainAlreadyAssigned) {
            const overrideKey = layer ? getLayerOverrideKey(layer) : undefined;
            const beforeTransform = overrideKey ? nextOverrides[overrideKey] : undefined;
            const override = await fitOverrideForTemplateLayer(template, layer, main, 'stretch', 'main');
            if (layer && override && overrideKey) {
              nextOverrides[overrideKey] = override;
              if (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
                console.debug('[CardEditor] batch image match center zoom applied', {
                  batchMatchApplied: true,
                  centerZoomStepsApplied: DEFAULT_BATCH_IMAGE_CENTER_ZOOM_STEPS,
                  beforeTransform,
                  afterTransform: override,
                  cardId: card.id,
                  imageId: main.id,
                });
              }
            }
          }
        }
        if (logo) {
          const logoAlreadyAssigned = cardImageMatchesAsset(card.front.titleImageAssetId, card.front.titleImageAssetRef, logo);
          const persistentReference = (await cacheUsedAsset(logo)) ?? assetReferenceFromAsset(logo);
          const layer = template?.layers.find((candidate) => layerAcceptsCardAsset(candidate, 'logo'));
          nextFront.titleImageAssetId = logo.id;
          nextFront.titleImageAssetRef = persistentReference;
          if (!logoAlreadyAssigned) {
            const override = await fitOverrideForTemplateLayer(template, layer, logo, 'contain', 'logo');
            if (layer && override) nextOverrides[getLayerOverrideKey(layer)] = override;
          }
        }
        nextFront.slotOverrides = nextOverrides;
        updateCard(card.id, { front: nextFront });
        matched += 1;
      } catch {
        errorCount += 1;
      }
    }
    setFeedback({ type: matched > 0 ? 'success' : 'error', message: `일괄 이미지 매칭: 적용 ${matched}개, 후보 없음 ${noMatch}개, 오류 ${errorCount}개` });
  }

  async function saveSelectedWorkingCards() {
    if (selectedWorkingIds.length === 0) {
      setFeedback({ type: 'error', message: '저장할 카드편집 항목을 선택하세요.' });
      return;
    }
    const cardsToSave = selectedWorkingIds
      .map((id) => visibleCards.find((card) => card.id === id))
      .filter((card): card is CardItem => Boolean(card));
    for (const card of cardsToSave) {
      const cacheResult = await ensureCardImagesCached(card, assetsById);
      if (cacheResult.changed) updateCard(card.id, cacheResult.card);
      saveCard(card.id);
      removeWorkingCard(card.id);
    }
    const savedIds = new Set(cardsToSave.map((card) => card.id));
    setSelectedWorkingIds([]);
    setSelectedId(visibleCards.find((card) => !savedIds.has(card.id))?.id ?? '');
    setFeedback({ type: 'success', message: `선택한 카드편집 항목 ${cardsToSave.length}개를 저장했습니다.` });
  }

  function handleDeleteCurrentCard() {
    if (!selectedCard) {
      setFeedback({ type: 'error', message: 'No card is selected to delete.' });
      return;
    }
    recordWorkingHistory();
    deleteCard(selectedCard.id);
    setFeedback({ type: 'success', message: 'Working card deleted.' });
  }

  function handleGenerateCards() {
    if (zaparooLibrary.entries.length === 0) {
      setFeedback({ type: 'error', message: '미스터 게임 리스트 is empty. Sync or import a MiSTer Library first.' });
      return;
    }
    setLibraryPickerOpen(true);
  }

  function selectLibraryPickerEntry(entryId: string, options: { shift?: boolean; forceAdd?: boolean } = {}) {
    const visibleIds = filteredLibraryEntries.map((entry) => entry.id);
    setSelectedLibraryIds((current) => {
      const applyLimit = (next: string[]) => {
        if (next.length <= MAX_BATCH_CARD_CREATE_COUNT) return next;
        setFeedback({ type: 'error', message: batchCardCreateLimitMessage });
        return current;
      };
      if (options.shift && lastLibrarySelectionId && visibleIds.includes(lastLibrarySelectionId) && visibleIds.includes(entryId)) {
        const start = visibleIds.indexOf(lastLibrarySelectionId);
        const end = visibleIds.indexOf(entryId);
        const range = visibleIds.slice(Math.min(start, end), Math.max(start, end) + 1);
        return applyLimit(Array.from(new Set([...current, ...range])));
      }
      if (options.forceAdd) return current.includes(entryId) ? current : applyLimit([...current, entryId]);
      return current.includes(entryId) ? current.filter((id) => id !== entryId) : applyLimit([...current, entryId]);
    });
    setLastLibrarySelectionId(entryId);
  }

  function addSelectedLibraryEntriesToQueue() {
    if (selectedLibraryIds.length === 0) {
      setFeedback({ type: 'error', message: 'Select at least one 미스터 게임 리스트 game.' });
      return;
    }
    if (!isBatchCardCreateCountAllowed(selectedLibraryIds.length)) {
      setFeedback({ type: 'error', message: batchCardCreateLimitMessage });
      return;
    }
    recordWorkingHistory();
    createCardsFromZaparooEntries(selectedLibraryIds);
    setLibraryPickerOpen(false);
    setSelectedLibraryIds([]);
    setLibraryPlatform('');
    setLibraryQuery('');
    setFeedback({ type: 'success', message: `${selectedLibraryIds.length} card(s) added to the working queue.` });
  }

  function handleClearWorkingCards() {
    if (visibleCards.length > 0 && !window.confirm('카드편집 대기열을 모두 비울까요? 저장된 Card Album 카드는 삭제되지 않습니다.')) return;
    recordWorkingHistory();
    clearWorkingCards();
    setSelectedWorkingIds([]);
    setSelectedId('');
  }

  function handleRemoveSelectedWorkingCards() {
    if (selectedWorkingIds.length === 0) return;
    const ok = window.confirm(`선택한 카드편집 항목 ${selectedWorkingIds.length}개를 대기열에서 제거할까요? 저장된 Card Album 카드는 삭제되지 않습니다.`);
    if (!ok) return;
    recordWorkingHistory();
    const removed = new Set(selectedWorkingIds);
    selectedWorkingIds.forEach((cardId) => removeWorkingCard(cardId));
    setSelectedWorkingIds([]);
    setSelectedId(visibleCards.find((card) => !removed.has(card.id))?.id ?? '');
    setFeedback({ type: 'success', message: `선택한 카드편집 항목 ${removed.size}개를 대기열에서 제거했습니다.` });
  }

  function handleResetCard(cardId: string) {
    recordWorkingHistory();
    resetCard(cardId);
  }

  async function handleFrontTemplateChange(templateId: string) {
    if (!selectedCard) return;
    if (templateId && await applyTemplateIdToSelectedCards('front', templateId)) {
      setSelectedImageLayerId(undefined);
      return;
    }
    const layoutMode: CardItem['layoutMode'] = templateId ? 'CUSTOM' : 'UNASSIGNED';
    const nextTemplate = frontTemplates.find((template) => template.id === templateId);
    const nextSlotOverrides = templateId ? preserveImageOverridesForTemplateChange(selectedCard, 'front', nextTemplate) : {};
    patchSelected({
      layoutMode,
      customTemplateId: templateId || undefined,
      front: {
        ...selectedCard.front,
        layoutMode,
        templateId: templateId || undefined,
        slotOverrides: nextSlotOverrides,
      },
    });
    setSelectedImageLayerId(undefined);
  }

  async function handleBackTemplateChange(templateId: string) {
    if (!selectedCard) return;
    if (templateId && await applyTemplateIdToSelectedCards('back', templateId)) return;
    const nextTemplate = backTemplates.find((template) => template.id === templateId);
    const nextSlotOverrides = templateId ? preserveImageOverridesForTemplateChange(selectedCard, 'back', nextTemplate) : {};
    patchBack({
      templateId: templateId || undefined,
      slotOverrides: nextSlotOverrides,
    });
  }

  return (
    <div className="card-editor-page flex h-[calc(100dvh-5.5rem)] min-h-0 flex-col overflow-hidden">
      <div className="shrink-0">
        <PageHeader
        eyebrow="Card Editor"
        title="카드 편집기"
        description="현재 카드편집 대기열을 편집합니다. 템플릿은 고정하고, 카드에 적용한 Main Image와 Clear Logo만 이동하거나 크기를 조절할 수 있습니다."
        />
      </div>

      <div className="mb-3 flex shrink-0 flex-wrap gap-2">
        <button type="button" onClick={handleGenerateCards} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700">
          <RefreshCw className="h-4 w-4" />
          카드 만들기
        </button>
        <button type="button" onClick={handleClearWorkingCards} className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium">
          <Trash2 className="h-4 w-4" />
          대기열 비우기
        </button>
        <button type="button" onClick={undoWorkingCards} disabled={undoStack.length === 0} className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium disabled:opacity-40">
          <Undo2 className="h-4 w-4" />
          실행 취소
        </button>
        <button type="button" onClick={redoWorkingCards} disabled={redoStack.length === 0} className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium disabled:opacity-40">
          <Redo2 className="h-4 w-4" />
          다시 실행
        </button>
        {selectedCard && (
          <>
            <button type="button" onClick={handleSaveCurrentCard} className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium">
              <Save className="h-4 w-4" />
              카드 저장
            </button>
            <button type="button" onClick={handleSaveAsNewCard} className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium">
              <Library className="h-4 w-4" />
              새 버전으로 저장
            </button>
            <button type="button" onClick={() => handleResetCard(selectedCard.id)} className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium">
              <RotateCcw className="h-4 w-4" />
              자동 배치 초기화
            </button>
            <button type="button" onClick={handleDeleteCurrentCard} className="inline-flex items-center gap-2 rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700">
              <Trash2 className="h-4 w-4" />
              삭제
            </button>
          </>
        )}
      </div>
      {feedback && (
        <div
          className={`mb-3 shrink-0 rounded-md border px-3 py-2 text-sm ${
            feedback.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {feedback.message}
        </div>
      )}
      {activeProgress && (
        <div className="mb-3 shrink-0 rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">{activeProgress.label}</p>
              <p className="mt-1 text-blue-800">{activeProgress.message}</p>
              {activeProgress.detail ? <p className="mt-1 truncate text-xs text-blue-700">현재 항목: {activeProgress.detail}</p> : null}
            </div>
            <span className="rounded-full bg-white px-2 py-1 text-xs font-medium text-blue-700">
              {activeProgress.processed} / {activeProgress.total}
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.max(3, Math.min(100, (activeProgress.processed / Math.max(1, activeProgress.total)) * 100))}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid min-h-0 flex-1 items-stretch gap-5 overflow-hidden xl:grid-cols-[280px_minmax(0,1fr)_420px]">
        <section className="min-h-0 overflow-auto rounded-lg border border-line bg-white p-4 shadow-surface" style={{ resize: 'horizontal', minWidth: 240 }}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold">카드편집</h3>
            <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">{selectedWorkingIds.length}개 선택</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <button type="button" onClick={selectCurrentWorkingPage} className="rounded border border-line px-2 py-1.5 font-medium hover:bg-blue-50">
              현재 페이지 선택
            </button>
            <button type="button" onClick={() => setSelectedWorkingIds([])} className="rounded border border-line px-2 py-1.5 font-medium hover:bg-neutral-50">
              선택 해제
            </button>
            <button type="button" disabled={selectedWorkingIds.length === 0} onClick={applyTemplateToSelectedWorkingCards} className="rounded border border-blue-200 px-2 py-1.5 font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40">
              템플릿 일괄 적용
            </button>
            <button type="button" disabled={selectedWorkingIds.length === 0} onClick={() => void matchImagesForSelectedWorkingCards()} className="rounded border border-emerald-200 px-2 py-1.5 font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">
              이미지 일괄 매칭
            </button>
            <button type="button" disabled={selectedWorkingIds.length === 0} onClick={() => void saveSelectedWorkingCards()} className="col-span-2 rounded bg-primary px-2 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-40">
              선택 카드 일괄 저장
            </button>
            <button type="button" disabled={selectedWorkingIds.length === 0} onClick={handleRemoveSelectedWorkingCards} className="col-span-2 rounded border border-red-200 px-2 py-1.5 font-medium text-red-700 hover:bg-red-50 disabled:opacity-40">
              선택 카드 제거
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {workingCardsPage.map((card) => {
              const game = games.find((candidate) => candidate.id === card.gameId);
              return (
                <div
                  key={card.id}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                    card.id === selectedCard?.id ? 'border-primary bg-blue-50 shadow-selected' : 'border-line hover:bg-blue-50'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selectedWorkingIds.includes(card.id)}
                      onChange={() => toggleWorkingCardSelection(card.id)}
                      className="mt-1"
                    />
                    <button type="button" onClick={() => setSelectedId(card.id)} className="min-w-0 flex-1 text-left">
                      <span className="block truncate font-medium">{game?.title ?? card.front.titleText ?? card.id}</span>
                      <span className="text-xs text-neutral-500">{card.front.templateId ? '템플릿 지정됨' : '템플릿 없음'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
            {visibleCards.length === 0 && <p className="text-sm text-neutral-600">카드편집 항목이 없습니다.</p>}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 text-sm">
            <button type="button" disabled={workingPage <= 1} onClick={() => setWorkingPage((value) => Math.max(1, value - 1))} className="rounded border border-line px-2 py-1 disabled:opacity-40">이전</button>
            <span className="text-neutral-600">{workingPage} / {workingTotalPages}</span>
            <button type="button" disabled={workingPage >= workingTotalPages} onClick={() => setWorkingPage((value) => Math.min(workingTotalPages, value + 1))} className="rounded border border-line px-2 py-1 disabled:opacity-40">다음</button>
          </div>
        </section>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-white p-5 shadow-surface">
          {selectedCard ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold">{activeSide === 'front' ? '앞면 보기' : '뒷면 보기'}</h3>
                  <p className="mt-1 text-xs text-neutral-500">
                    {activeSide === 'front'
                      ? selectedImageLayer
                        ? `이미지 콘텐츠 편집 중: ${selectedImageLayer.slot?.label ?? selectedImageLayer.slotType ?? selectedImageLayer.id}`
                        : selectedFrontTemplate
                          ? `${selectedFrontTemplate.name} 템플릿 사용 중`
                          : '템플릿 없음'
                      : selectedBackTemplate
                        ? `${selectedBackTemplate.name} 템플릿 사용 중`
                        : '템플릿 없음'}
                  </p>
                </div>
                <div className="inline-flex rounded-md border border-line bg-neutral-50 p-1 text-sm">
                  {(['front', 'back'] as const).map((side) => (
                    <button
                      key={side}
                      type="button"
                      onClick={() => {
                        setActiveSide(side);
                        setSelectedImageLayerId(undefined);
                      }}
                      className={`rounded px-3 py-1.5 font-medium capitalize ${
                        activeSide === side ? 'bg-primary text-white' : 'text-neutral-600 hover:text-primary'
                      }`}
                    >
                      {side === 'front' ? '앞면' : '뒷면'}
                    </button>
                  ))}
                </div>
              </div>
              <div
                className={`relative min-h-0 w-full flex-1 overflow-hidden rounded-md ${imageDropActive ? 'ring-2 ring-primary ring-offset-2' : ''}`}
                onDragOver={(event) => {
                  if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) {
                    event.preventDefault();
                    if (!imageDropActive) setImageDropActive(true);
                  }
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setImageDropActive(false);
                }}
                onDrop={(event) => {
                  if (event.dataTransfer?.files?.length) {
                    event.preventDefault();
                    setImageDropActive(false);
                    void handleMainImageDrop(event.dataTransfer.files);
                  }
                }}
              >
                {activeSide === 'front' ? (
                  <EditableCardTemplatePreview
                    card={selectedCard}
                    category={selectedCategory}
                    assetsById={assetsById}
                    template={selectedFrontTemplate}
                    side="front"
                    selectedLayerId={selectedImageLayerId}
                    fillContainer
                    onSelectedLayerChange={setSelectedImageLayerId}
                    onImageTransformChange={patchImageTransform}
                  />
                ) : (
                  <EditableCardTemplatePreview
                    card={selectedCard}
                    category={selectedCategory}
                    assetsById={assetsById}
                    template={selectedBackTemplate}
                    side="back"
                    selectedLayerId={selectedImageLayerId}
                    fillContainer
                    onSelectedLayerChange={setSelectedImageLayerId}
                    onImageTransformChange={patchImageTransform}
                  />
                )}
                {imageDropActive ? (
                  <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-primary/10 text-sm font-semibold text-primary">
                    여기에 놓으면 {activeSide === 'front' ? '앞면' : '뒷면'} 메인 이미지로 추가됩니다
                  </div>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-neutral-600">
                <span className="inline-flex items-center gap-1"><span className="h-0.5 w-5 bg-neutral-950" /> 카드 외곽선</span>
                <span className="basis-full text-neutral-500">Card Editor에서는 실제 카드 외곽선만 표시합니다.</span>
              </div>
              {selectedTemplateFromSnapshot && (
                <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  이 카드의 원본 템플릿이 템플릿 앨범에 없습니다. 가져온 카드 안의 템플릿 스냅샷으로 표시합니다.
                </p>
              )}
              <p className="mt-3 text-xs text-neutral-500">
                이미지 콘텐츠를 드래그해서 이동합니다. 크기 조절은 기본적으로 비율을 유지하며, Shift를 누른 채 드래그하면 비율 고정이 해제됩니다.
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                이미지 파일을 이 영역에 드래그앤드롭하면 현재 면의 메인 이미지로 넣고 가운데 정렬하며, 원본 파일은 「{cardImageFolderLabel}」 폴더에 함께 저장합니다.
              </p>
            </div>
          ) : (
            <p className="text-sm text-neutral-600">미스터 게임 리스트에서 카드를 추가하거나 카드 만들기를 눌러 편집을 시작하세요.</p>
          )}
        </section>

        {selectedCard && (
          <section ref={editorSidebarRef} className="min-h-0 overflow-y-auto rounded-lg border border-line bg-white p-5 shadow-surface overscroll-contain" style={{ resize: 'horizontal', minWidth: 320 }}>
            <div className="rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-3 shadow-sm">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-white">
                  {currentGamePlatform}
                </span>
                {currentGameLinked ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">연결됨</span>
                ) : (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">경로 미확인</span>
                )}
              </div>
              <div className="flex items-start justify-between gap-2">
                <h3 className="break-words text-[17px] font-bold leading-snug text-neutral-950" title={currentGameTitle}>
                  {currentGameTitle}
                </h3>
                <div className="flex shrink-0 items-center gap-1">
                  {titleCopied ? <span className="text-[11px] font-medium text-emerald-600">복사됨</span> : null}
                  <button
                    type="button"
                    onClick={() => void handleRefreshAssets()}
                    disabled={isRefreshingAssets}
                    title="이미지 에셋 새로고침 (이미지 폴더를 다시 스캔)"
                    aria-label="이미지 에셋 새로고침"
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-blue-200 bg-white text-blue-700 transition hover:bg-blue-100 disabled:opacity-40"
                  >
                    <RefreshCw className={`h-4 w-4 ${isRefreshingAssets ? 'animate-spin' : ''}`} />
                  </button>
                  <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      void handleCopyGameTitle();
                      setShowImageSearch((open) => !open);
                    }}
                    title="게임명 복사 + 웹에서 박스아트/이미지 검색"
                    aria-label="게임명 복사 + 웹에서 박스아트/이미지 검색"
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-blue-200 bg-white text-blue-700 transition hover:bg-blue-100"
                  >
                    <ImageIcon className="h-4 w-4" />
                  </button>
                  {showImageSearch ? (
                    <>
                      <button
                        type="button"
                        aria-label="검색 메뉴 닫기"
                        className="fixed inset-0 z-40 cursor-default"
                        onClick={() => setShowImageSearch(false)}
                      />
                      <div className="absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-lg border border-line bg-white py-1 shadow-lg">
                        <p className="px-3 py-1 text-[11px] font-semibold text-neutral-500">웹에서 박스아트 검색</p>
                        {BOX_ART_SEARCH_SOURCES.map((source) => (
                          <button
                            key={source.id}
                            type="button"
                            title={source.hint}
                            onClick={() => {
                              const query = cleanGameTitleForSearch(currentGameTitle) || currentGameTitle;
                              void openExternalSearchUrl(source.build(query));
                              setShowImageSearch(false);
                            }}
                            className="block w-full px-3 py-1.5 text-left text-xs text-neutral-800 transition hover:bg-blue-50"
                          >
                            {source.label}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : null}
                  </div>
                </div>
              </div>
              {currentGamePath ? (
                <p className="mt-1 truncate text-[11px] text-blue-900" title={currentGamePath}>
                  {currentGamePath}
                </p>
              ) : null}
            </div>
            <div className="mt-4 space-y-4 text-sm">
              <TemplatePicker
                title="앞면 템플릿"
                templates={frontTemplates}
                selectedId={selectedCard.front.templateId}
                onSelect={handleFrontTemplateChange}
              />

              <TemplatePicker
                title="뒷면 템플릿"
                templates={backTemplates}
                selectedId={selectedCard.back.templateId}
                onSelect={handleBackTemplateChange}
              />

              {activeSide === 'front' && (
                <>
                  <ImagePicker
                    title="Main Image"
                    emptyLabel="Main Image 없음"
                    assets={mainImageAssets}
                    selectedId={resolveAssetReference(assetsById, selectedCard.front.heroImageAssetId, selectedCard.front.heroImageAssetRef)?.id ?? selectedCard.front.heroImageAssetId}
                    onSelect={(assetId) => {
                      setMatchCandidates((current) => ({ ...current, main: [] }));
                      return assignFrontAsset('main', assetId);
                    }}
                    onMatch={() => matchFrontAsset('main')}
                    candidates={matchCandidates.main}
                    onCandidateSelect={(asset) => applyCandidateAsset('main', asset)}
                  />

                  <ImagePicker
                    title="Clear Logo"
                    emptyLabel="Clear Logo 없음"
                    assets={clearLogoAssets}
                    selectedId={resolveAssetReference(assetsById, selectedCard.front.titleImageAssetId, selectedCard.front.titleImageAssetRef)?.id ?? selectedCard.front.titleImageAssetId}
                    onSelect={(assetId) => {
                      setMatchCandidates((current) => ({ ...current, logo: [] }));
                      return assignFrontAsset('logo', assetId);
                    }}
                    onMatch={() => matchFrontAsset('logo')}
                    candidates={matchCandidates.logo}
                    onCandidateSelect={(asset) => applyCandidateAsset('logo', asset)}
                  />
                </>
              )}

              {activeSide === 'back' && (
                <>
                  <ImagePicker
                    title="Back Main Image"
                    emptyLabel="Back Main Image 없음"
                    assets={backMainImageAssets}
                    selectedId={resolveAssetReference(assetsById, selectedCard.back.backgroundImageAssetId, selectedCard.back.backgroundImageAssetRef)?.id ?? selectedCard.back.backgroundImageAssetId}
                    onSelect={(assetId) => assignBackAsset('main', assetId)}
                  />

                  <ImagePicker
                    title="Back Clear Logo Image"
                    emptyLabel="Back Clear Logo Image 없음"
                    assets={clearLogoAssets}
                    selectedId={resolveAssetReference(assetsById, selectedCard.back.brandLogoAssetId, selectedCard.back.brandLogoAssetRef)?.id ?? selectedCard.back.brandLogoAssetId}
                    onSelect={(assetId) => assignBackAsset('logo', assetId)}
                  />
                </>
              )}

              <button
                type="button"
                onClick={() => void resetSelectedImageTransform()}
                disabled={!selectedImageLayer}
                className="w-full rounded-md border border-line px-3 py-2 text-sm font-medium disabled:opacity-40"
              >
                이미지 배치 초기화
              </button>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <button type="button" disabled={!selectedImageLayer} onClick={() => alignSelectedImage('horizontal')} className="rounded-md border border-line px-2 py-2 font-medium hover:bg-blue-50 disabled:opacity-40" title="선택 이미지를 슬롯 기준 가로 중앙에 맞춥니다.">
                  가로 중앙
                </button>
                <button type="button" disabled={!selectedImageLayer} onClick={() => alignSelectedImage('vertical')} className="rounded-md border border-line px-2 py-2 font-medium hover:bg-blue-50 disabled:opacity-40" title="선택 이미지를 슬롯 기준 세로 중앙에 맞춥니다.">
                  세로 중앙
                </button>
                <button type="button" disabled={!selectedImageLayer} onClick={() => alignSelectedImage('both')} className="rounded-md border border-line px-2 py-2 font-medium hover:bg-blue-50 disabled:opacity-40" title="선택 이미지를 슬롯 중앙에 맞춥니다.">
                  가운데
                </button>
                <button
                  type="button"
                  disabled={!selectedImageLayer}
                  {...imageCenterShrinkHoldHandlers}
                  className="rounded-md border border-line px-2 py-2 font-medium hover:bg-blue-50 disabled:opacity-40"
                  title="가운데 기준 축소: 선택 이미지의 가운데 점은 그대로 두고 사방으로 1px씩 줄입니다. Shift: 10px 단위, Alt: 0.5px 단위"
                >
                  중앙 축소
                </button>
                <button
                  type="button"
                  disabled={!selectedImageLayer}
                  {...imageCenterEnlargeHoldHandlers}
                  className="rounded-md border border-line px-2 py-2 font-medium hover:bg-blue-50 disabled:opacity-40"
                  title="가운데 기준 확대: 선택 이미지의 가운데 점은 그대로 두고 사방으로 1px씩 키웁니다. Shift: 10px 단위, Alt: 0.5px 단위"
                >
                  중앙 확대
                </button>
              </div>
              <label className="flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-xs">
                <input
                  type="checkbox"
                  checked={imageAspectLocked}
                  disabled={!selectedImageLayer}
                  onChange={(event) => setImageAspectLocked(event.target.checked)}
                />
                <span className="font-medium">비율 잠금</span>
                <span className="text-neutral-500">켜면 너비/높이를 함께 조정합니다.</span>
              </label>
              <label className="block">
                <span className="font-medium">이미지 맞춤</span>
                <select
                  value={selectedImageOverride?.fitMode ?? defaultFitModeForSlot(selectedImageLayer?.slotType)}
                  disabled={!selectedImageLayer}
                  onChange={(event) => void applyFitModeToSelectedLayer(event.target.value as ImageFitMode)}
                  className="mt-1 w-full rounded-md border border-line px-2 py-2 disabled:bg-neutral-100"
                >
                  {(Object.keys(imageFitModeLabels) as ImageFitMode[]).map((fitMode) => (
                    <option key={fitMode} value={fitMode}>{imageFitModeLabels[fitMode]}</option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label>
                  <span className="font-medium">이동 X</span>
                  <input
                    type="number"
                    value={Math.round(selectedImageTransform?.x ?? 0)}
                    disabled={!selectedImageLayer || !selectedImageTransform}
                    onChange={(event) => selectedImageLayer && selectedImageTransform && patchImageTransform(selectedImageLayer, { ...selectedImageTransform, x: Number(event.target.value) }, selectedImageTransform.fitMode)}
                    className="mt-1 w-full rounded-md border border-line px-2 py-2 disabled:bg-neutral-100"
                  />
                </label>
                <label>
                  <span className="font-medium">이동 Y</span>
                  <input
                    type="number"
                    value={Math.round(selectedImageUiY)}
                    disabled={!selectedImageLayer || !selectedImageTransform}
                    onChange={(event) => {
                      if (!selectedImageLayer || !selectedImageTransform) return;
                      patchImageTransform(
                        selectedImageLayer,
                        {
                          ...selectedImageTransform,
                          y: uiToCanvasY(Number(event.target.value), selectedImageTransform.height, selectedImageLayerHeight),
                        },
                        selectedImageTransform.fitMode,
                      );
                    }}
                    className="mt-1 w-full rounded-md border border-line px-2 py-2 disabled:bg-neutral-100"
                  />
                  <span className="mt-1 block text-[11px] text-neutral-500">값이 커지면 위로 이동합니다.</span>
                </label>
                <label>
                  <span className="font-medium">너비</span>
                  <input
                    type="number"
                    value={Math.round(selectedImageTransform?.width ?? 0)}
                    disabled={!selectedImageLayer || !selectedImageTransform}
                    onChange={(event) => {
                      if (!selectedImageLayer || !selectedImageTransform) return;
                      const width = Math.max(imageTransformLimits.minWidth, Number(event.target.value));
                      const nextHeight = imageAspectLocked
                        ? width * (selectedImageTransform.height / Math.max(selectedImageTransform.width, 1))
                        : selectedImageTransform.height;
                      patchImageTransform(
                        selectedImageLayer,
                        resizeToSizeFromTopLeft(selectedImageTransform, { width, height: nextHeight }),
                        selectedImageTransform.fitMode,
                      );
                    }}
                    className="mt-1 w-full rounded-md border border-line px-2 py-2 disabled:bg-neutral-100"
                  />
                </label>
                <label>
                  <span className="font-medium">높이</span>
                  <input
                    type="number"
                    value={Math.round(selectedImageTransform?.height ?? 0)}
                    disabled={!selectedImageLayer || !selectedImageTransform}
                    onChange={(event) => {
                      if (!selectedImageLayer || !selectedImageTransform) return;
                      const height = Math.max(imageTransformLimits.minHeight, Number(event.target.value));
                      const nextWidth = imageAspectLocked
                        ? height * (selectedImageTransform.width / Math.max(selectedImageTransform.height, 1))
                        : selectedImageTransform.width;
                      patchImageTransform(
                        selectedImageLayer,
                        resizeToSizeFromTopLeft(selectedImageTransform, { width: nextWidth, height }),
                        selectedImageTransform.fitMode,
                      );
                    }}
                    className="mt-1 w-full rounded-md border border-line px-2 py-2 disabled:bg-neutral-100"
                  />
                </label>
              </div>
              {selectedImageLayer && selectedImageTransform && (
                <details className="rounded-md border border-line p-3">
                  <summary className="cursor-pointer text-sm font-semibold">이미지 자르기(px)</summary>
                  {!selectedImageCropReady && (
                    <p className="mt-2 text-[11px] text-neutral-500">이미지 원본 크기를 확인한 뒤 px 단위 자르기를 편집할 수 있습니다.</p>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {([
                      ['cropTop', '위'],
                      ['cropRight', '오른쪽'],
                      ['cropBottom', '아래'],
                      ['cropLeft', '왼쪽'],
                    ] as const).map(([cropKey, labelText]) => (
                      <label key={cropKey}>
                        <span className="font-medium">{labelText} px</span>
                        <input
                          type="number"
                          min="0"
                          max={cropKey === 'cropTop' || cropKey === 'cropBottom' ? Math.max(0, Number(selectedImageNaturalSize.height ?? 0) - 1) : Math.max(0, Number(selectedImageNaturalSize.width ?? 0) - 1)}
                          step="1"
                          value={Math.round(Number(selectedImageTransform[cropKey] ?? 0))}
                          disabled={!selectedImageCropReady}
                          onChange={(event) =>
                            patchImageTransform(
                              selectedImageLayer,
                              {
                                ...selectedImageTransform,
                                ...clampImageCropPx({ ...selectedImageTransform, [cropKey]: Number(event.target.value) }, selectedImageNaturalSize),
                              },
                              selectedImageTransform.fitMode,
                            )
                          }
                          className="mt-1 w-full rounded-md border border-line px-2 py-2 disabled:bg-neutral-100 disabled:text-neutral-400"
                        />
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      patchImageTransform(
                        selectedImageLayer,
                        {
                          ...selectedImageTransform,
                          cropTop: 0,
                          cropRight: 0,
                          cropBottom: 0,
                          cropLeft: 0,
                        },
                        selectedImageTransform.fitMode,
                      )
                    }
                    className="mt-3 w-full rounded-md border border-line px-3 py-2 text-xs font-medium"
                  >
                    자르기 초기화
                  </button>
                </details>
              )}
            </div>
          </section>
        )}
      </div>

      {libraryPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">미스터 게임 리스트에서 카드 만들기</h2>
                <p className="text-sm text-neutral-600">
                  {libraryPlatform || `${libraryPlatformBuckets.length}개 platform`} / {selectedLibraryIds.length}개 선택됨
                </p>
                <p className={`mt-1 text-xs ${selectedLibraryIds.length >= MAX_BATCH_CARD_CREATE_COUNT ? 'text-amber-700' : 'text-neutral-500'}`}>
                  한 번에 최대 {MAX_BATCH_CARD_CREATE_COUNT}개까지 카드 작업을 만들 수 있습니다.
                </p>
              </div>
              <button type="button" onClick={() => setLibraryPickerOpen(false)} className="rounded-md border border-line px-3 py-2 text-sm font-medium">
                닫기
              </button>
            </div>
            <div className="grid min-h-0 flex-1 overflow-hidden md:grid-cols-[260px_minmax(0,1fr)]">
              <aside className="overflow-auto border-r border-line p-4">
                {libraryPlatformBuckets.map((bucket) => (
                  <button
                    key={bucket.platform}
                    type="button"
                    onClick={() => {
                      setLibraryPlatform(bucket.platform);
                      setLibraryQuery('');
                    }}
                    className={`mb-2 w-full rounded-md px-3 py-2 text-left text-sm ${libraryPlatform === bucket.platform ? 'bg-primary text-white shadow-selected' : 'border border-line hover:bg-blue-50'}`}
                  >
                    <span className="block font-medium">{bucket.platform}</span>
                    <span className="text-xs opacity-80">{bucket.entries.length}개 게임</span>
                  </button>
                ))}
              </aside>
              <section className="flex min-h-0 flex-col p-4">
                {libraryPlatform ? (
                  <>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <label className="relative min-w-[240px] flex-1">
                        <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-neutral-400" />
                        <input
                          value={libraryQuery}
                          onChange={(event) => setLibraryQuery(event.target.value)}
                          placeholder="게임 검색"
                          className="w-full rounded-md border border-line py-2 pl-8 pr-2 text-sm"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={addSelectedLibraryEntriesToQueue}
                        disabled={!isBatchCardCreateCountAllowed(selectedLibraryIds.length)}
                        className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-40"
                      >
                        선택 항목 추가 ({selectedLibraryIds.length})
                      </button>
                      <span className="text-xs text-neutral-500">클릭, Shift+클릭, 드래그로 여러 게임을 선택할 수 있습니다.</span>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto rounded-md border border-line">
                      {filteredLibraryEntries.map((entry) => {
                        const selected = selectedLibraryIds.includes(entry.id);
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              setLibraryDragSelecting(true);
                              selectLibraryPickerEntry(entry.id, { shift: event.shiftKey });
                            }}
                            onMouseEnter={() => {
                              if (libraryDragSelecting) selectLibraryPickerEntry(entry.id, { forceAdd: true });
                            }}
                            className={`grid w-full select-none grid-cols-[24px_1fr_auto] gap-3 border-b border-line px-3 py-2 text-left text-sm last:border-b-0 ${
                              selected ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : 'bg-white hover:bg-blue-50/60'
                            }`}
                          >
                            <span className={`mt-0.5 h-4 w-4 rounded border ${selected ? 'border-primary bg-primary' : 'border-line'}`} />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{entry.title}</span>
                              <span className="block truncate text-xs text-neutral-500">{entry.relativePath || entry.launchValue}</span>
                            </span>
                            <span className="text-xs text-neutral-500">{entry.hasCard ? '카드 있음' : '카드 없음'}</span>
                          </button>
                        );
                      })}
                      {filteredLibraryEntries.length === 0 && (
                        <p className="px-3 py-4 text-sm text-neutral-600">조건에 맞는 게임이 없습니다.</p>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="rounded-md border border-dashed border-line px-3 py-4 text-sm text-neutral-600">
                    카드편집 대기열에 추가할 게임을 선택하려면 platform을 먼저 선택하세요.
                  </p>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
