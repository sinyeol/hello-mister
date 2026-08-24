import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Link2, Nfc, Play, Printer, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { isAdvancedMode, useAppViewMode } from '../../../services/app/viewMode';
import { useActiveMisterProfile } from '../../../services/mister/activeProfile';
import { misterDisplayName } from '../../../services/mister/misterName';
import { CardPreview } from '@sticker-v1/components/cards/CardPreview';
import { PaginationControls } from '@sticker-v1/components/common/PaginationControls';
import { PageHeader } from '@sticker-v1/components/common/PageHeader';
import { missingUsedImageReferences } from '@sticker-v1/services/assets/cardImagePersistence';
import { restoreUsedImageAssets } from '@sticker-v1/services/assets/usedImageCache';
import { buildCardBundle, parseCardBundle } from '@sticker-v1/services/cards/cardBundle';
import { createCardExportZipFilename } from '@sticker-v1/services/cards/cardExportFilenames';
import { prepareCardImportTemplatePlan, type CardImportMissingTemplateChoice, type CardImportTemplateConflictChoice } from '@sticker-v1/services/cards/cardImportTemplates';
import {
  loadCardAlbumIndexFromIndexedDb,
  loadCardThumbnailBlob,
  loadRecentCardAlbumIndexFromIndexedDb,
  loadSavedCardFullData,
  loadSavedCardsByIdsFromIndexedDb,
} from '@sticker-v1/services/cards/savedCardsPersistence';
import { regenerateSavedCardThumbnail } from '@sticker-v1/services/cards/cardThumbnailGeneration';
import { HttpMiSTerBridgeClient } from '@sticker-v1/services/mister/misterBridge';
import { buildLaunchPreview, buildLaunchPreviewFromMetadata, buildTagPayload } from '@sticker-v1/services/mister/zaparooLaunch';
import { markZaparooEntryCard, buildZaparooEntryLookup, resolveEntryForCardLink } from '@sticker-v1/services/zaparoo/zaparooLibrary';
import { useConnectedMiSTerDevices, resolveLaunchTargetsForEntry, launchTextForDeviceRef } from '@sticker-v1/services/mister/connectedDevices';
import type { LaunchTarget } from '@sticker-v1/services/mister/connectedDevices';
import { useProjectStore } from '@sticker-v1/store/projectStore';
import {
  cardAlbumIndexItemFromRecord,
  savedCardSearchTextFromIndex,
  sortAlbumIndexByUpdatedDesc,
  takeRecentAlbumIndexItems,
} from '@sticker-v1/utils/cardAlbumIndex';
import { normalizeName } from '@sticker-v1/utils/normalizeName';
import { paginateItems } from '@sticker-v1/utils/pagination';
import type {
  CardAlbumIndexItem,
  Category,
  LocalAsset,
  MiSTerLaunchPreview,
  MiSTerScanEntry,
  SavedCardRecord,
  Template,
  ZaparooLibraryEntry,
} from '@sticker-v1/types';
import type { ZaparooRunDiagnostics } from '../../../types/zaparoo';

const trashPlatformKey = '__trash__';
const allCardsKey = '__all_cards__';
const albumPageSize = 100;
const initialRecentCardCount = 20;

type CardNfcStatus = 'idle' | 'ready' | 'writing' | 'written' | 'error';
type CardNfcState = { status: CardNfcStatus; payload?: string; message?: string };
type CardLaunchDiagnostics = {
  gameTitle: string;
  platform?: string;
  activeMister?: string;
  zapScript?: string;
  diagnostics?: ZaparooRunDiagnostics;
  methodMessage?: string;
  fallbackMessage?: string;
};

interface AlbumVersionGroup {
  key: string;
  latest: CardAlbumIndexItem;
  versions: CardAlbumIndexItem[];
}

function displayCardTitle(item: Pick<CardAlbumIndexItem, 'title'>) {
  return item.title.replace(/\s*\(import\)\s*$/i, '');
}

function versionGroupKey(item: CardAlbumIndexItem) {
  return item.mister?.zaparooLibraryEntryId ?? item.title;
}

function platformKey(item: CardAlbumIndexItem) {
  if (item.platform) return item.platform;
  if (item.mister) return `${item.mister.misterPlatformGroup}/${item.mister.misterSystemId}`;
  return item.categoryId || '기타/미분류';
}

function groupVersions(items: CardAlbumIndexItem[]) {
  const groups = new Map<string, CardAlbumIndexItem[]>();
  items.forEach((item) => {
    const key = versionGroupKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });
  return Array.from(groups.entries()).map(([key, versions]) => {
    const sorted = [...versions].sort(sortAlbumIndexByUpdatedDesc);
    return { key, latest: sorted[0], versions: sorted } satisfies AlbumVersionGroup;
  });
}

function activeItemForGroup(group: AlbumVersionGroup, versionSelection: Record<string, string>) {
  return group.versions.find((item) => item.id === versionSelection[group.key]) ?? group.latest;
}

function filterGroupsByQuery(groups: AlbumVersionGroup[], query: string) {
  const normalizedQuery = normalizeName(query);
  if (!normalizedQuery) return groups;
  return groups.filter((group) =>
    group.versions.some((item) => normalizeName(savedCardSearchTextFromIndex(item)).includes(normalizedQuery)),
  );
}

function entryToMiSTerScanEntry(entry: ZaparooLibraryEntry): MiSTerScanEntry {
  return {
    id: entry.id,
    source: 'mister',
    platformGroup: entry.platformGroup,
    systemId: entry.systemId,
    folderName: entry.folderName,
    folderPath: entry.absolutePath.split('/').slice(0, -1).join('/'),
    relativePath: entry.relativePath,
    absolutePath: entry.absolutePath,
    title: entry.title,
    romName: entry.romName,
    region: entry.region,
    disc: entry.disc,
    kind: entry.kind,
    launchMode: entry.launchMode,
    launchValue: entry.launchValue,
    originalLibraryPath: entry.originalLibraryPath,
    resolvedMiSTerPath: entry.resolvedMiSTerPath,
    nfcPayload: entry.nfcPayload,
    nfcPayloadSource: entry.nfcPayloadSource,
    imageMatchKey: entry.imageMatchKey,
    hasCard: entry.hasCard,
    linkedCardId: entry.latestCardId,
    imageMatched: entry.imageMatchState === 'matched',
    launchReady: entry.launchReady,
    playable: entry.playable,
    bios: entry.bios,
    firmware: entry.firmware,
    systemFile: entry.systemFile,
    ignored: entry.ignored,
    classificationReason: entry.classificationReason,
    pathValid: entry.pathValid,
    aliasApplied: entry.aliasApplied,
    scannedAt: entry.lastSyncedAt,
  };
}

function launchPreviewForItem(item: CardAlbumIndexItem, linkedEntry?: ZaparooLibraryEntry): MiSTerLaunchPreview | undefined {
  if (linkedEntry) return buildLaunchPreview(entryToMiSTerScanEntry(linkedEntry), 'absolute-path');
  if (item.mister) return buildLaunchPreviewFromMetadata(item.mister, displayCardTitle(item), 'absolute-path');
  return undefined;
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [delayMs, value]);
  return debouncedValue;
}

function isAlbumPerformanceLoggingEnabled() {
  return typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
}

function placeholderThumbnailSvg(item: Pick<CardAlbumIndexItem, 'categoryId' | 'platform' | 'title'>) {
  const title = displayCardTitle(item).replace(/[<>&]/g, '');
  const platform = (item.platform ?? item.categoryId ?? '').replace(/[<>&]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="508" viewBox="0 0 320 508">
    <rect width="320" height="508" rx="19" fill="#f8fafc"/>
    <rect x="12" y="12" width="296" height="484" rx="18" fill="none" stroke="#cbd5e1" stroke-width="3"/>
    <text x="160" y="235" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#334155">${title.slice(0, 22)}</text>
    <text x="160" y="268" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" fill="#64748b">${platform.slice(0, 28)}</text>
  </svg>`;
}

interface AlbumThumbnailProps {
  item: CardAlbumIndexItem;
  category?: Category;
  cardSize: number;
  assetsById: Record<string, LocalAsset>;
  templates: Template[];
  generateThumbnail: (id: string) => Promise<{ blob?: Blob; status?: CardAlbumIndexItem['thumbnailStatus'] } | undefined>;
  onThumbnailLoaded: (hit: boolean) => void;
  onThumbnailStatusChange: (id: string, patch: Partial<CardAlbumIndexItem>) => void;
}

interface AlbumBackPreviewProps {
  item: CardAlbumIndexItem;
  category?: Category;
  cardSize: number;
  assetsById: Record<string, LocalAsset>;
  templates: Template[];
}

const AlbumThumbnail = memo(function AlbumThumbnail({
  item,
  category,
  cardSize,
  assetsById,
  templates,
  generateThumbnail,
  onThumbnailLoaded,
  onThumbnailStatusChange,
}: AlbumThumbnailProps) {
  const [url, setUrl] = useState<string>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [thumbnailOrientation, setThumbnailOrientation] = useState<'portrait' | 'landscape' | 'unknown'>('unknown');
  // Double-click the card to view it enlarged in a popup; click the popup (or press Esc) to close.
  // The popup renders the card at original resolution (CardPreview), loaded on demand; the thumbnail is
  // shown instantly while that loads (and as a fallback if it fails).
  const [zoomed, setZoomed] = useState(false);
  const [zoomRecord, setZoomRecord] = useState<SavedCardRecord>();
  const [zoomAssets, setZoomAssets] = useState<Record<string, LocalAsset>>(assetsById);
  const [zoomStatus, setZoomStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setZoomed(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomed]);
  useEffect(() => {
    if (!zoomed) return;
    let cancelled = false;
    let restored: LocalAsset[] = [];
    setZoomStatus('loading');
    void (async () => {
      const loaded = await loadSavedCardFullData(item.id);
      if (cancelled) return;
      if (!loaded) { setZoomStatus('error'); return; }
      const missing = missingUsedImageReferences([loaded.card], assetsById);
      restored = missing.length > 0 ? await restoreUsedImageAssets(missing) : [];
      if (cancelled) return;
      const next = { ...assetsById };
      restored.forEach((asset) => { next[asset.id] = asset; });
      setZoomAssets(next);
      setZoomRecord(loaded);
      setZoomStatus('ready');
    })().catch(() => { if (!cancelled) setZoomStatus('error'); });
    return () => {
      cancelled = true;
      restored.forEach((asset) => { if (asset.objectUrl?.startsWith('blob:')) URL.revokeObjectURL(asset.objectUrl); });
    };
  }, [zoomed, item.id, assetsById]);
  const itemId = item.id;
  const itemTitle = item.title;
  const itemPlatform = item.platform;
  const itemCategoryId = item.categoryId;
  const thumbnailCacheKey = item.thumbnailCacheKey;
  const thumbnailStatus = item.thumbnailStatus;
  const thumbnailStaleCacheKey = item.thumbnailStaleCacheKey;

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    let generatedObjectUrl: string | undefined;
    const showBlob = (blob: Blob) => {
      const nextUrl = URL.createObjectURL(blob);
      const previousUrl = objectUrl;
      objectUrl = nextUrl;
      if (!cancelled) {
        if (previousUrl && previousUrl !== nextUrl) URL.revokeObjectURL(previousUrl);
        setUrl(nextUrl);
        setStatus('ready');
      } else {
        URL.revokeObjectURL(nextUrl);
      }
    };

    void (async () => {
      const cached = await loadCardThumbnailBlob(itemId, thumbnailCacheKey);
      if (cancelled) return;
      if (cached) {
        onThumbnailLoaded(true);
        showBlob(cached);
        if (thumbnailStatus && thumbnailStatus !== 'ready') {
          window.setTimeout(() => {
            if (cancelled) return;
            void generateThumbnail(itemId).then((generated) => {
              if (!generated || cancelled) return;
              onThumbnailStatusChange(itemId, { thumbnailStatus: generated.status });
              if (!generated.blob) return;
              showBlob(generated.blob);
            });
          }, 120);
        }
        return;
      }

      const stale = thumbnailStaleCacheKey ? await loadCardThumbnailBlob(itemId, thumbnailStaleCacheKey) : undefined;
      if (cancelled) return;
      if (stale) {
        onThumbnailLoaded(true);
        showBlob(stale);
        setStatus('missing');
        window.setTimeout(() => {
          if (cancelled) return;
          void generateThumbnail(itemId).then((generated) => {
            if (!generated || cancelled) return;
            onThumbnailStatusChange(itemId, { thumbnailStatus: generated.status });
            if (!generated.blob) return;
            showBlob(generated.blob);
          });
        }, 120);
        return;
      }

      onThumbnailLoaded(false);
      setStatus('missing');
      const fallback = new Blob([placeholderThumbnailSvg({ categoryId: itemCategoryId, platform: itemPlatform, title: itemTitle })], { type: 'image/svg+xml' });
      generatedObjectUrl = URL.createObjectURL(fallback);
      setUrl(generatedObjectUrl);

      window.setTimeout(() => {
        if (cancelled) return;
        void generateThumbnail(itemId).then((generated) => {
          if (!generated || cancelled) return;
          onThumbnailStatusChange(itemId, { thumbnailStatus: generated.status });
          if (!generated.blob) return;
          if (generatedObjectUrl) URL.revokeObjectURL(generatedObjectUrl);
          showBlob(generated.blob);
        });
      }, 120);
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (generatedObjectUrl) URL.revokeObjectURL(generatedObjectUrl);
    };
  }, [
    generateThumbnail,
    itemCategoryId,
    itemId,
    itemPlatform,
    itemTitle,
    onThumbnailLoaded,
    onThumbnailStatusChange,
    thumbnailCacheKey,
    thumbnailStaleCacheKey,
    thumbnailStatus,
  ]);

  return (
    <>
    <div
      className={`flex items-center justify-center overflow-hidden rounded-md border border-line bg-neutral-50 ${url ? 'cursor-zoom-in' : ''}`}
      style={{
        width: '100%',
        height: `${Math.round(cardSize * (thumbnailOrientation === 'landscape' ? 0.72 : 1.08))}px`,
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (url) setZoomed(true);
      }}
      title="더블클릭하면 크게 보기"
    >
      {url ? (
        <img
          src={url}
          alt={`${displayCardTitle({ title: itemTitle })} thumbnail`}
          loading="lazy"
          onLoad={(event) => {
            const image = event.currentTarget;
            setThumbnailOrientation(image.naturalWidth > image.naturalHeight ? 'landscape' : 'portrait');
          }}
          className="max-h-full max-w-full object-contain object-center"
          style={{ width: 'auto', height: 'auto' }}
        />
      ) : (
        <div className="grid h-full place-items-center text-xs text-neutral-500">썸네일 불러오는 중</div>
      )}
      {status === 'missing' && (
        <div className="pointer-events-none self-end bg-white/85 px-2 py-1 text-[11px] text-neutral-600">
          썸네일 생성 대기
        </div>
      )}
      {category ? null : null}
    </div>
    {zoomed && (
      <div
        className="fixed inset-0 z-[6000] flex items-center justify-center bg-black/80 p-4"
        onClick={(event) => { event.stopPropagation(); setZoomed(false); }}
        role="dialog"
        aria-label="카드 확대 보기"
      >
        {zoomStatus === 'ready' && zoomRecord ? (
          <div style={{ width: 'min(92vw, 52vh)' }} className="shadow-2xl">
            <CardPreview card={zoomRecord.card} category={category} assetsById={zoomAssets} templates={templates} side="front" />
          </div>
        ) : url ? (
          <img
            src={url}
            alt={`${displayCardTitle({ title: itemTitle })} 확대`}
            className="max-h-[92vh] max-w-[92vw] rounded-md object-contain shadow-2xl"
          />
        ) : (
          <div className="text-sm text-white/80">불러오는 중…</div>
        )}
      </div>
    )}
    </>
  );
});

const AlbumBackPreview = memo(function AlbumBackPreview({
  item,
  category,
  cardSize,
  assetsById,
  templates,
}: AlbumBackPreviewProps) {
  const [record, setRecord] = useState<SavedCardRecord>();
  const [renderAssetsById, setRenderAssetsById] = useState<Record<string, LocalAsset>>(assetsById);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    let restoredAssets: LocalAsset[] = [];
    setStatus('loading');
    setRecord(undefined);
    setRenderAssetsById(assetsById);

    void (async () => {
      const loaded = await loadSavedCardFullData(item.id);
      if (cancelled) return;
      if (!loaded) {
        setStatus('error');
        return;
      }
      const hasBackContent = Boolean(
        loaded.card.back.templateId
        || loaded.card.back.backgroundImageAssetId
        || loaded.card.back.backgroundImageAssetRef
        || loaded.card.back.brandLogoAssetId
        || loaded.card.back.brandLogoAssetRef,
      );
      if (!hasBackContent) {
        setRecord(loaded);
        setStatus('missing');
        return;
      }
      const missingReferences = missingUsedImageReferences([loaded.card], assetsById);
      restoredAssets = missingReferences.length > 0 ? await restoreUsedImageAssets(missingReferences) : [];
      if (cancelled) return;
      const nextAssetsById = { ...assetsById };
      restoredAssets.forEach((asset) => {
        nextAssetsById[asset.id] = asset;
      });
      setRenderAssetsById(nextAssetsById);
      setRecord(loaded);
      setStatus('ready');
    })().catch((error) => {
      if (cancelled) return;
      if (isAlbumPerformanceLoggingEnabled()) console.debug('[CardAlbum] back preview failed', { cardId: item.id, error });
      setStatus('error');
    });

    return () => {
      cancelled = true;
      restoredAssets.forEach((asset) => {
        if (asset.objectUrl?.startsWith('blob:')) URL.revokeObjectURL(asset.objectUrl);
      });
    };
  }, [assetsById, item.id, item.updatedAt]);

  return (
    <div
      className="flex items-center justify-center overflow-hidden rounded-md border border-line bg-neutral-50"
      style={{ width: '100%', height: `${Math.round(cardSize * 1.08)}px` }}
    >
      {status === 'ready' && record ? (
        <div className="w-full max-w-full">
          <CardPreview
            card={record.card}
            category={category}
            assetsById={renderAssetsById}
            templates={templates}
            side="back"
          />
        </div>
      ) : (
        <div className="grid h-full w-full place-items-center px-3 text-center text-xs text-neutral-500">
          {status === 'missing' ? '뒷면 없음' : status === 'error' ? '뒷면을 불러오지 못했습니다.' : '뒷면 불러오는 중'}
        </div>
      )}
    </div>
  );
});

interface AlbumCardProps {
  group: AlbumVersionGroup;
  activeItem: CardAlbumIndexItem;
  category?: Category;
  selected: boolean;
  cardSize: number;
  assetsById: Record<string, LocalAsset>;
  templates: Template[];
  trashMode?: boolean;
  nfcState?: CardNfcState;
  generateThumbnail: (id: string) => Promise<{ blob?: Blob; status?: CardAlbumIndexItem['thumbnailStatus'] } | undefined>;
  onThumbnailLoaded: (hit: boolean) => void;
  onThumbnailStatusChange: (id: string, patch: Partial<CardAlbumIndexItem>) => void;
  onVersionChange: (groupKey: string, recordId: string) => void;
  onToggleSelected: (id: string) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRestore: (id: string) => void;
  onPermanentDelete: (id: string) => void;
  onLaunchGame: (item: CardAlbumIndexItem) => void;
  onWriteNfc: (item: CardAlbumIndexItem) => void;
  onLinkLibrary: (item: CardAlbumIndexItem) => void;
  getLinkStatus: (item: CardAlbumIndexItem) => 'linked' | 'broken' | 'none';
}

const AlbumCard = memo(function AlbumCard({
  group,
  activeItem,
  category,
  selected,
  cardSize,
  assetsById,
  templates,
  trashMode = false,
  nfcState,
  generateThumbnail,
  onThumbnailLoaded,
  onThumbnailStatusChange,
  onVersionChange,
  onToggleSelected,
  onOpen,
  onDelete,
  onRestore,
  onPermanentDelete,
  onLaunchGame,
  onWriteNfc,
  onLinkLibrary,
  getLinkStatus,
}: AlbumCardProps) {
  const linkStatus = getLinkStatus(activeItem);
  const [previewSide, setPreviewSide] = useState<'front' | 'back'>('front');
  const nfcStatus = nfcState?.status ?? 'idle';
  const nfcClass =
    nfcStatus === 'ready'
      ? 'border-amber-300 bg-amber-50 text-amber-800'
      : nfcStatus === 'writing'
        ? 'border-blue-300 bg-blue-50 text-blue-700'
        : nfcStatus === 'written'
          ? 'border-green-300 bg-green-50 text-green-700'
          : nfcStatus === 'error'
            ? 'border-red-300 bg-red-50 text-red-700'
            : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50';

  useEffect(() => {
    setPreviewSide('front');
  }, [activeItem.id]);

  return (
    <article
      className={`w-full rounded-lg border bg-white p-2.5 shadow-surface ${selected ? 'border-primary ring-2 ring-primary/20' : 'border-line'}`}
    >
      {trashMode && (
        <label className="mb-2 flex cursor-pointer items-center gap-2 rounded-md border border-line bg-neutral-50 px-2 py-1.5 text-xs font-medium text-neutral-700">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelected(activeItem.id)}
            className="h-4 w-4 rounded border-line"
          />
          영구 삭제 선택
        </label>
      )}
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onToggleSelected(activeItem.id)}
        className="block w-full text-left"
      >
        {previewSide === 'front' ? (
          <AlbumThumbnail
            item={activeItem}
            category={category}
            cardSize={cardSize}
            assetsById={assetsById}
            templates={templates}
            generateThumbnail={generateThumbnail}
            onThumbnailLoaded={onThumbnailLoaded}
            onThumbnailStatusChange={onThumbnailStatusChange}
          />
        ) : (
          <AlbumBackPreview
            item={activeItem}
            category={category}
            cardSize={cardSize}
            assetsById={assetsById}
            templates={templates}
          />
        )}
      </button>
      <div className="mt-2 grid grid-cols-2 gap-1 rounded-md bg-neutral-100 p-1 text-xs" onClick={(event) => event.stopPropagation()}>
        {(['front', 'back'] as const).map((side) => (
          <button
            key={side}
            type="button"
            aria-pressed={previewSide === side}
            onClick={() => setPreviewSide(side)}
            className={`rounded px-2 py-1.5 font-medium ${
              previewSide === side ? 'bg-white text-primary shadow-sm' : 'text-neutral-600 hover:text-primary'
            }`}
            title={side === 'front' ? '앞면 보기' : '뒷면 보기'}
          >
            {side === 'front' ? '앞면' : '뒷면'}
          </button>
        ))}
      </div>
      <div className="mt-3">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{displayCardTitle(activeItem)}</h3>
          {activeItem.importedAt || /\(import\)$/i.test(activeItem.title) ? (
            <span className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">가져옴</span>
          ) : null}
          <button
            type="button"
            onClick={() => onLinkLibrary(activeItem)}
            className={`shrink-0 rounded border p-1 ${
              linkStatus === 'linked'
                ? 'border-green-200 text-green-700 hover:bg-green-50'
                : linkStatus === 'broken'
                  ? 'border-red-200 text-red-700 hover:bg-red-50'
                  : 'border-amber-200 text-amber-700 hover:bg-amber-50'
            }`}
            title={linkStatus === 'linked'
              ? '게임 라이브러리 연결됨'
              : linkStatus === 'broken'
                ? '연결 끊김 — 게임이 라이브러리에 없습니다. 클릭해 다시 연결하세요.'
                : '게임 라이브러리와 연결'}
          >
            <Link2 className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="mt-1 truncate text-xs text-neutral-500">{activeItem.platform ?? category?.displayName ?? '미분류'}</p>
        {activeItem.deletedAt && (
          <p className="mt-1 text-xs text-red-700">삭제일: {new Date(activeItem.deletedAt).toLocaleString()}</p>
        )}
        {group.versions.length > 1 && (
          <select
            value={activeItem.id}
            onChange={(event) => onVersionChange(group.key, event.target.value)}
            className="mt-2 w-full rounded-md border border-line px-2 py-1.5 text-xs"
          >
            {group.versions.map((version, index) => (
              <option key={version.id} value={version.id}>
                버전 {group.versions.length - index} - {new Date(version.updatedAt).toLocaleString()}
              </option>
            ))}
          </select>
        )}
        {selected && <p className="mt-2 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white">선택됨</p>}
      </div>
      {trashMode ? (
        <div className="mt-3 grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={() => onRestore(activeItem.id)}
            className="inline-flex items-center justify-center gap-1 rounded border border-emerald-200 px-2 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
          >
            <RotateCcw className="h-4 w-4" />
            복원
          </button>
          <button
            type="button"
            onClick={() => onPermanentDelete(activeItem.id)}
            className="inline-flex items-center justify-center gap-1 rounded border border-red-200 px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
            영구 삭제
          </button>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-4 gap-1">
          <button
            type="button"
            onClick={() => onOpen(activeItem.id)}
            className="inline-flex items-center justify-center rounded border border-blue-200 px-2 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
            title="카드 편집기에서 열기"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onLaunchGame(activeItem)}
            className="inline-flex items-center justify-center rounded border border-indigo-200 px-2 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
            title="MiSTer에서 실행"
          >
            <Play className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onWriteNfc(activeItem)}
            className={`inline-flex items-center justify-center rounded border px-2 py-1.5 text-xs font-medium ${nfcClass}`}
            title={nfcStatus === 'writing' ? 'NFC 태그에 쓰는 중' : nfcStatus === 'written' ? 'NFC 쓰기 완료' : 'NFC 태그에 바로 쓰기'}
          >
            <Nfc className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(activeItem.id)}
            className="inline-flex items-center justify-center rounded border border-red-200 px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
            title="휴지통으로 이동"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </article>
  );
});

interface AlbumGridProps {
  groups: AlbumVersionGroup[];
  versionSelection: Record<string, string>;
  categoriesById: Record<string, Category>;
  selectedIds: string[];
  cardSize: number;
  assetsById: Record<string, LocalAsset>;
  templates: Template[];
  trashMode?: boolean;
  emptyMessage: string;
  nfcStates: Record<string, CardNfcState>;
  generateThumbnail: (id: string) => Promise<{ blob?: Blob; status?: CardAlbumIndexItem['thumbnailStatus'] } | undefined>;
  onThumbnailLoaded: (hit: boolean) => void;
  onThumbnailStatusChange: (id: string, patch: Partial<CardAlbumIndexItem>) => void;
  onVersionChange: (groupKey: string, recordId: string) => void;
  onToggleSelected: (id: string) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRestore: (id: string) => void;
  onPermanentDelete: (id: string) => void;
  onLaunchGame: (item: CardAlbumIndexItem) => void;
  onWriteNfc: (item: CardAlbumIndexItem) => void;
  onLinkLibrary: (item: CardAlbumIndexItem) => void;
  getLinkStatus: (item: CardAlbumIndexItem) => 'linked' | 'broken' | 'none';
}

function AlbumGrid({
  groups,
  versionSelection,
  categoriesById,
  selectedIds,
  cardSize,
  assetsById,
  templates,
  trashMode = false,
  emptyMessage,
  nfcStates,
  generateThumbnail,
  onThumbnailLoaded,
  onThumbnailStatusChange,
  onVersionChange,
  onToggleSelected,
  onOpen,
  onDelete,
  onRestore,
  onPermanentDelete,
  onLaunchGame,
  onWriteNfc,
  onLinkLibrary,
  getLinkStatus,
}: AlbumGridProps) {
  if (groups.length === 0) {
    return (
      <p className="mt-4 rounded-md border border-dashed border-line px-3 py-4 text-sm text-neutral-600">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="mt-4 grid justify-start gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, ${cardSize}px))` }}>
      {groups.map((group) => {
        const activeItem = activeItemForGroup(group, versionSelection);
        return (
          <AlbumCard
            key={group.key}
            group={group}
            activeItem={activeItem}
            category={activeItem.categoryId ? categoriesById[activeItem.categoryId] : undefined}
            selected={selectedIds.includes(activeItem.id)}
            cardSize={cardSize}
            assetsById={assetsById}
            templates={templates}
            trashMode={trashMode}
            nfcState={nfcStates[activeItem.id]}
            generateThumbnail={generateThumbnail}
            onThumbnailLoaded={onThumbnailLoaded}
            onThumbnailStatusChange={onThumbnailStatusChange}
            onVersionChange={onVersionChange}
            onToggleSelected={onToggleSelected}
            onOpen={onOpen}
            onDelete={onDelete}
            onRestore={onRestore}
            onPermanentDelete={onPermanentDelete}
            onLaunchGame={onLaunchGame}
            onWriteNfc={onWriteNfc}
            onLinkLibrary={onLinkLibrary}
            getLinkStatus={getLinkStatus}
          />
        );
      })}
    </div>
  );
}

export function CardAlbumPage() {
  const [activeMister] = useActiveMisterProfile();
  const { devices: connectedDevices } = useConnectedMiSTerDevices();
  const [devicePicker, setDevicePicker] = useState<{ item: CardAlbumIndexItem; mode: 'launch' | 'nfc'; candidates: LaunchTarget[] } | null>(null);
  const [linkPicker, setLinkPicker] = useState<{ item: CardAlbumIndexItem } | null>(null);
  const [linkQuery, setLinkQuery] = useState('');
  const [appMode] = useAppViewMode();
  const developerMode = isAdvancedMode(appMode);
  const {
    categories,
    assetLibrary,
    zaparooLibrary,
    mister,
    templates,
    restoreWorkingCards,
    deleteSavedCard,
    restoreSavedCard,
    permanentlyDeleteSavedCard,
    updateSavedCard,
    importSavedCards,
    setPrintQueue,
    setZaparooLibrary,
    addMiSTerTagJob,
    addTemplate,
    updateTemplate,
  } = useProjectStore();
  const navigate = useNavigate();
  const [albumIndex, setAlbumIndex] = useState<CardAlbumIndexItem[]>([]);
  const [fullAlbumReady, setFullAlbumReady] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [trashSelectedIds, setTrashSelectedIds] = useState<string[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState('');
  const [albumQuery, setAlbumQuery] = useState('');
  const [albumPage, setAlbumPage] = useState(1);
  const [versionSelection, setVersionSelection] = useState<Record<string, string>>({});
  const [cardSize, setCardSize] = useState(260);
  const [importCardTemplatesWithCards, setImportCardTemplatesWithCards] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [launchDiagnostics, setLaunchDiagnostics] = useState<CardLaunchDiagnostics | null>(null);
  const [nfcStates, setNfcStates] = useState<Record<string, CardNfcState>>({});
  const debouncedAlbumQuery = useDebouncedValue(albumQuery, 180);
  const albumMountTime = useRef(typeof performance !== 'undefined' ? performance.now() : Date.now());
  const thumbnailStats = useRef({ hits: 0, misses: 0, generated: 0, fullRecordsLoaded: 0 });
  const exportedCardZipFilenames = useRef(new Set<string>());
  const assetsById = useMemo(() => assetLibrary?.assetsById ?? {}, [assetLibrary?.assetsById]);
  const categoriesById = useMemo(() => Object.fromEntries(categories.map((category) => [category.id, category])), [categories]);

  useEffect(() => {
    let cancelled = false;
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    void (async () => {
      const recent = await loadRecentCardAlbumIndexFromIndexedDb(initialRecentCardCount);
      if (cancelled) return;
      setAlbumIndex(takeRecentAlbumIndexItems(recent, initialRecentCardCount));
      if (isAlbumPerformanceLoggingEnabled()) {
        console.debug('[CardAlbum] recent metadata loaded', {
          ms: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt),
          recentCount: recent.length,
          fullCardRecordsLoadedCount: 0,
          imageSourceCacheLoadedCount: 0,
        });
      }

      window.setTimeout(() => {
        void (async () => {
          const all = await loadCardAlbumIndexFromIndexedDb();
          if (cancelled) return;
          setAlbumIndex([...all].sort(sortAlbumIndexByUpdatedDesc));
          setFullAlbumReady(true);
          if (isAlbumPerformanceLoggingEnabled()) {
            console.debug('[CardAlbum] full album metadata loaded in background', {
              ms: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt),
              totalMetaItems: all.length,
              fullCardRecordsLoadedCount: 0,
              imageSourceCacheLoadedCount: 0,
              misterVerificationCount: 0,
            });
          }
        })();
      }, 0);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isAlbumPerformanceLoggingEnabled()) return;
    const frame = window.requestAnimationFrame(() => {
      console.debug('[CardAlbum] first visible render', {
        ms: Math.round(performance.now() - albumMountTime.current),
        renderedCardCount: Math.min(albumIndex.length, initialRecentCardCount),
        thumbnailCacheHitCount: thumbnailStats.current.hits,
        thumbnailCacheMissCount: thumbnailStats.current.misses,
        fullCardRecordsLoadedCount: thumbnailStats.current.fullRecordsLoaded,
        imageSourceCacheLoadedCount: 0,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [albumIndex.length]);

  useEffect(() => {
    setAlbumPage(1);
  }, [debouncedAlbumQuery, selectedPlatform]);

  useEffect(() => {
    if (selectedPlatform !== trashPlatformKey) setTrashSelectedIds([]);
  }, [selectedPlatform]);

  const activeIndex = useMemo(() => albumIndex.filter((item) => !item.deletedAt), [albumIndex]);
  const deletedIndex = useMemo(() => albumIndex.filter((item) => Boolean(item.deletedAt)), [albumIndex]);
  const recentGroups = useMemo(
    () => groupVersions(takeRecentAlbumIndexItems(activeIndex, initialRecentCardCount)),
    [activeIndex],
  );
  const versionGroups = useMemo(
    () => (fullAlbumReady ? groupVersions(activeIndex).sort((a, b) => sortAlbumIndexByUpdatedDesc(a.latest, b.latest)) : recentGroups),
    [activeIndex, fullAlbumReady, recentGroups],
  );
  const trashGroups = useMemo(
    () => groupVersions(deletedIndex).sort((a, b) => sortAlbumIndexByUpdatedDesc(a.latest, b.latest)),
    [deletedIndex],
  );
  const platformBuckets = useMemo(() => {
    const grouped = new Map<string, AlbumVersionGroup[]>();
    versionGroups.forEach((group) => {
      const key = platformKey(group.latest);
      grouped.set(key, [...(grouped.get(key) ?? []), group]);
    });
    return Array.from(grouped.entries())
      .map(([key, groups]) => ({ key, groups }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [versionGroups]);
  const selectedPlatformGroups = platformBuckets.find((bucket) => bucket.key === selectedPlatform)?.groups ?? [];
  const sourceDisplayGroups = selectedPlatform === trashPlatformKey
    ? trashGroups
    : selectedPlatform === allCardsKey
      ? versionGroups
    : selectedPlatform
      ? selectedPlatformGroups
      : debouncedAlbumQuery
        ? versionGroups
        : recentGroups;
  const displayGroups = useMemo(
    () => filterGroupsByQuery(sourceDisplayGroups, debouncedAlbumQuery),
    [debouncedAlbumQuery, sourceDisplayGroups],
  );
  const pagedDisplayGroups = useMemo(
    () => paginateItems(displayGroups, albumPage, albumPageSize),
    [albumPage, displayGroups],
  );
  const visibleDisplayGroups = pagedDisplayGroups.items;
  const displayedActiveItemIds = useMemo(
    () => displayGroups.map((group) => activeItemForGroup(group, versionSelection).id),
    [displayGroups, versionSelection],
  );
  const visibleTrashItemIds = selectedPlatform === trashPlatformKey ? displayedActiveItemIds : [];
  const allDisplayedSelected = displayedActiveItemIds.length > 0 && displayedActiveItemIds.every((id) => selectedIds.includes(id));
  const allVisibleTrashSelected = visibleTrashItemIds.length > 0 && visibleTrashItemIds.every((id) => trashSelectedIds.includes(id));

  const updateIndexItem = useCallback((id: string, patch: Partial<CardAlbumIndexItem>) => {
    setAlbumIndex((current) => {
      let changed = false;
      const next = current.map((item) => {
        if (item.id !== id) return item;
        const hasPatchChange = (Object.keys(patch) as (keyof CardAlbumIndexItem)[]).some((key) => !Object.is(item[key], patch[key]));
        if (!hasPatchChange) return item;
        changed = true;
        return { ...item, ...patch };
      });
      return changed ? next : current;
    });
  }, []);

  const generateThumbnail = useCallback(async (id: string) => {
    const record = await loadSavedCardFullData(id);
    thumbnailStats.current.fullRecordsLoaded += record ? 1 : 0;
    if (!record) return undefined;
    const result = await regenerateSavedCardThumbnail(record, {
      assetLibrary,
      categories,
      templates,
      dpi: 90,
    });
    if (result.status === 'ready') thumbnailStats.current.generated += 1;
    updateIndexItem(record.id, {
      thumbnailStatus: result.status,
      thumbnailError: result.error,
      thumbnailStaleCacheKey: result.status === 'ready' ? undefined : record.thumbnailStaleCacheKey,
      thumbnailUpdatedAt: result.status === 'ready' ? new Date().toISOString() : record.thumbnailUpdatedAt,
    });
    return { blob: result.blob, status: result.status };
  }, [assetLibrary, categories, templates, updateIndexItem]);

  const handleThumbnailLoaded = useCallback((hit: boolean) => {
    if (hit) thumbnailStats.current.hits += 1;
    else thumbnailStats.current.misses += 1;
  }, []);

  function removeIndexItem(id: string) {
    setAlbumIndex((current) => current.filter((item) => item.id !== id));
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]));
  }

  function toggleTrashSelected(id: string) {
    setTrashSelectedIds((current) => (current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]));
  }

  async function openInEditor(id: string) {
    const record = await loadSavedCardFullData(id);
    if (!record) {
      setFeedback({ type: 'error', message: '카드 전체 데이터를 찾지 못했습니다.' });
      return;
    }
    restoreWorkingCards([record.card]);
    navigate('/stickers/editor');
  }

  async function editSelectedCards() {
    const records = await loadSavedCardsByIdsFromIndexedDb(selectedIds);
    if (records.length === 0) {
      setFeedback({ type: 'error', message: '편집할 카드를 먼저 선택하세요.' });
      return;
    }
    restoreWorkingCards(records.map((record) => record.card));
    navigate('/stickers/editor');
  }

  // Open the searchable game picker (replaces a window.prompt that did nothing in Electron and needed an exact match).
  function linkCardToLibrary(item: CardAlbumIndexItem) {
    setLinkQuery(item.title ?? '');
    setLinkPicker({ item });
  }

  function misterMetadataForEntry(entry: ZaparooLibraryEntry) {
    const folderPath = entry.absolutePath.split('/').slice(0, -1).join('/');
    const launchPreview = buildLaunchPreview(entryToMiSTerScanEntry(entry), 'absolute-path');
    return {
      misterSource: 'mister' as const,
      zaparooLibraryEntryId: entry.id,
      misterPlatformGroup: entry.platformGroup,
      misterSystemId: entry.systemId,
      misterFolderPath: folderPath,
      misterRelativePath: entry.relativePath,
      misterAbsolutePath: entry.absolutePath,
      misterLaunchText: launchPreview.text,
      originalLibraryPath: launchPreview.originalLibraryPath,
      resolvedMiSTerPath: launchPreview.resolvedMiSTerPath,
      nfcPayload: launchPreview.nfcPayload,
      nfcPayloadSource: launchPreview.resolutionSource,
    };
  }

  async function linkCardToEntry(item: CardAlbumIndexItem, entry: ZaparooLibraryEntry) {
    const record = await loadSavedCardFullData(item.id);
    if (!record) {
      setFeedback({ type: 'error', message: '카드 전체 데이터를 찾지 못했습니다.' });
      return;
    }
    const misterMetadata = misterMetadataForEntry(entry);
    updateSavedCard(record.id, { mister: misterMetadata, card: { ...record.card, mister: misterMetadata } });
    updateIndexItem(record.id, {
      mister: misterMetadata,
      platform: `${entry.platformGroup}/${entry.systemId}`,
      cachedLinkStatus: 'linked',
      updatedAt: new Date().toISOString(),
    });
    setZaparooLibrary(markZaparooEntryCard(zaparooLibrary, entry.id, record.id));
    setFeedback({ type: 'success', message: `"${displayCardTitle(item)}" 카드를 "${entry.title}" 게임과 연결했습니다.` });
  }

  // Find a confident single library match for a card (exact path → unique system+title → unique title).
  // Versions share a title, so an ambiguous match is intentionally left for the manual picker.
  function findBestEntryForItem(item: CardAlbumIndexItem): ZaparooLibraryEntry | undefined {
    const path = (item.mister?.misterAbsolutePath ?? '').trim().toLowerCase();
    if (path) {
      const byPath = zaparooLibrary.entries.find((entry) => entry.absolutePath.toLowerCase() === path);
      if (byPath) return byPath;
    }
    const title = normalizeName(item.title);
    if (!title) return undefined;
    const system = item.mister?.misterSystemId ? normalizeName(item.mister.misterSystemId) : '';
    if (system) {
      const bySystemTitle = zaparooLibrary.entries.filter((entry) => normalizeName(entry.title) === title && normalizeName(entry.systemId) === system);
      if (bySystemTitle.length === 1) return bySystemTitle[0];
    }
    const byTitle = zaparooLibrary.entries.filter((entry) => normalizeName(entry.title) === title);
    return byTitle.length === 1 ? byTitle[0] : undefined;
  }

  // Bulk-repair cards whose stored link no longer resolves, when a confident single match exists.
  async function repairBrokenLinks() {
    const broken = albumIndex.filter((item) => !item.deletedAt && cardLinkStatus(item) === 'broken');
    if (broken.length === 0) {
      setFeedback({ type: 'success', message: '끊긴 링크가 없습니다.' });
      return;
    }
    let library = zaparooLibrary;
    let repaired = 0;
    let ambiguous = 0;
    for (const item of broken) {
      const entry = findBestEntryForItem(item);
      if (!entry) { ambiguous += 1; continue; }
      const record = await loadSavedCardFullData(item.id);
      if (!record) { ambiguous += 1; continue; }
      const misterMetadata = misterMetadataForEntry(entry);
      updateSavedCard(record.id, { mister: misterMetadata, card: { ...record.card, mister: misterMetadata } });
      updateIndexItem(record.id, {
        mister: misterMetadata,
        platform: `${entry.platformGroup}/${entry.systemId}`,
        cachedLinkStatus: 'linked',
        updatedAt: new Date().toISOString(),
      });
      library = markZaparooEntryCard(library, entry.id, record.id);
      repaired += 1;
    }
    if (repaired > 0) setZaparooLibrary(library);
    setFeedback({
      type: repaired > 0 ? 'success' : 'error',
      message: `끊긴 링크 ${broken.length}개 중 ${repaired}개 복구${ambiguous > 0 ? `, ${ambiguous}개는 후보가 모호해 카드의 링크 아이콘으로 직접 선택하세요` : ''}.`,
    });
  }

  function sendSelectedToPrint() {
    if (selectedIds.length === 0) {
      setFeedback({ type: 'error', message: '인쇄로 보낼 카드를 먼저 선택하세요.' });
      return;
    }
    setPrintQueue(selectedIds);
    navigate('/stickers/output');
  }

  async function exportSelectedCards() {
    const records = await loadSavedCardsByIdsFromIndexedDb(selectedIds);
    if (records.length === 0) {
      setFeedback({ type: 'error', message: '내보낼 카드를 먼저 선택하세요.' });
      return;
    }
    const { blob, manifest } = await buildCardBundle(records, assetsById, templates);
    const filename = createCardExportZipFilename(records, { existingFilenames: exportedCardZipFilenames.current });
    exportedCardZipFilenames.current.add(filename);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    setFeedback({
      type: manifest.warnings.length ? 'error' : 'success',
      message: manifest.warnings.length
        ? `카드 ZIP을 만들었지만 일부 이미지를 포함하지 못했습니다. ${manifest.warnings.join(' / ')}`
        : `선택 카드 ${records.length}개를 이미지 포함 ZIP으로 내보냈습니다.`,
    });
  }

  function chooseCardImportTemplateOptions(baseRecords: SavedCardRecord[], importedTemplates: Template[]) {
    if (!importCardTemplatesWithCards) return { importTemplates: false };

    const preview = prepareCardImportTemplatePlan(baseRecords, importedTemplates, templates, { importTemplates: false });
    let conflictChoice: CardImportTemplateConflictChoice = 'useExisting';
    let missingChoice: CardImportMissingTemplateChoice = 'cardsOnly';

    if (preview.conflicts.length > 0) {
      const conflictAnswer = window.prompt(
        `같은 이름의 템플릿이 이미 있습니다.\n\n${preview.conflicts.map((item) => `${item.importedTemplate.name} (${item.cardCount} cards)`).join('\n')}\n\n1 기존 템플릿 사용\n2 가져온 템플릿을 새 이름으로 추가\n3 가져온 템플릿으로 교체\n4 카드만 가져오기`,
        '1',
      );
      if (conflictAnswer === null || conflictAnswer.trim() === '4') conflictChoice = 'cardsOnly';
      else if (conflictAnswer.trim() === '2') conflictChoice = 'addRenamed';
      else if (conflictAnswer.trim() === '3') {
        const ok = window.confirm('가져온 템플릿으로 교체하면 기존 카드를 표시하는 방식이 달라질 수 있습니다. 계속할까요?');
        conflictChoice = ok ? 'replaceExisting' : 'useExisting';
      }
    }

    if (preview.missing.length > 0) {
      const missingAnswer = window.prompt(
        `이 카드가 사용하는 템플릿이 현재 템플릿 앨범에 없습니다.\n\n${preview.missing.map((item) => `${item.importedTemplate.name} (${item.cardCount} cards)`).join('\n')}\n\n1 카드만 가져오기\n2 가져온 템플릿도 추가\n3 기본 템플릿으로 연결`,
        '1',
      );
      if (missingAnswer?.trim() === '2') missingChoice = 'addImported';
      else if (missingAnswer?.trim() === '3') missingChoice = 'linkDefault';
      else missingChoice = 'cardsOnly';
    }

    return {
      importTemplates: conflictChoice !== 'cardsOnly' || missingChoice !== 'cardsOnly',
      conflictChoice,
      missingChoice,
    };
  }

  async function importCardBundle(file: File) {
    try {
      const result = await parseCardBundle(file);
      const baseRecords = result.records.map((record) => ({
        ...record,
        deletedAt: undefined,
        card: {
          ...record.card,
        },
      }));
      const templateImportOptions = chooseCardImportTemplateOptions(baseRecords, result.templates);
      const plan = prepareCardImportTemplatePlan(baseRecords, result.templates, templates, templateImportOptions);
      plan.templatesToReplace.forEach((template) => updateTemplate(template.id, template));
      plan.templatesToAdd.forEach((template) => addTemplate(template));
      const records = plan.records;
      importSavedCards(records);
      setAlbumIndex((current) => [...records.map(cardAlbumIndexItemFromRecord), ...current].sort(sortAlbumIndexByUpdatedDesc));
      setFeedback({
        type: 'success',
        message: importCardTemplatesWithCards
          ? `카드 ZIP에서 ${records.length}개 카드를 가져왔습니다. 템플릿 추가 ${plan.templatesToAdd.length}개, 교체 ${plan.templatesToReplace.length}개.`
          : `카드 ZIP에서 ${records.length}개 카드를 가져왔습니다. 템플릿은 앨범에 추가하지 않았습니다.`,
      });
      setFeedback({ type: 'success', message: `카드 ZIP에서 ${records.length}개 카드를 가져왔습니다.` });
      setFeedback({
        type: 'success',
        message: importCardTemplatesWithCards
          ? `Imported ${records.length} cards. Added ${plan.templatesToAdd.length} templates, replaced ${plan.templatesToReplace.length}.`
          : `Imported ${records.length} cards. Templates were not added to the Template Album.`,
      });
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : '카드 ZIP 가져오기에 실패했습니다.' });
    }
  }

  function deleteCard(id: string) {
    const timestamp = new Date().toISOString();
    deleteSavedCard(id);
    updateIndexItem(id, { deletedAt: timestamp, updatedAt: timestamp });
    setSelectedIds((current) => current.filter((candidate) => candidate !== id));
    setFeedback({ type: 'success', message: '카드를 삭제된 카드로 이동했습니다. 휴지통에서 복원할 수 있습니다.' });
  }

  function restoreCard(id: string) {
    restoreSavedCard(id);
    updateIndexItem(id, { deletedAt: undefined, updatedAt: new Date().toISOString() });
    setFeedback({ type: 'success', message: '카드를 복원했습니다.' });
  }

  function permanentlyDeleteCard(id: string) {
    if (!window.confirm('이 카드를 영구 삭제할까요?\n\n이 작업은 되돌릴 수 없습니다.')) return;
    permanentlyDeleteSavedCard(id);
    removeIndexItem(id);
    setTrashSelectedIds((current) => current.filter((candidate) => candidate !== id));
    setSelectedIds((current) => current.filter((candidate) => candidate !== id));
    setFeedback({ type: 'success', message: '카드를 영구 삭제했습니다.' });
  }

  function permanentlyDeleteSelectedTrashCards() {
    const ids = trashSelectedIds.filter((id) => deletedIndex.some((item) => item.id === id));
    if (ids.length === 0) return;
    if (!window.confirm(`선택한 삭제 카드 ${ids.length}개를 영구 삭제할까요?\n\n이 작업은 되돌릴 수 없습니다. 카드 메타데이터, 전체 카드 데이터, 썸네일 캐시가 제거됩니다.\n\n외부 이미지 파일, LaunchBox 이미지, MiSTer 게임 파일, 저장 시트, 다른 카드 앨범 항목은 삭제하지 않습니다.`)) return;
    ids.forEach(permanentlyDeleteSavedCard);
    setAlbumIndex((current) => current.filter((item) => !ids.includes(item.id)));
    setTrashSelectedIds([]);
    setFeedback({ type: 'success', message: `삭제 카드 ${ids.length}개를 영구 삭제했습니다.` });
  }

  function emptyTrash() {
    const ids = deletedIndex.map((item) => item.id);
    if (ids.length === 0) return;
    if (!window.confirm(`삭제된 카드 ${ids.length}개를 모두 영구 삭제할까요?\n\n이 작업은 되돌릴 수 없습니다. 카드 메타데이터, 전체 카드 데이터, 썸네일 캐시가 제거됩니다.`)) return;
    ids.forEach(permanentlyDeleteSavedCard);
    setAlbumIndex((current) => current.filter((item) => !ids.includes(item.id)));
    setTrashSelectedIds([]);
    setFeedback({ type: 'success', message: `삭제된 카드 ${ids.length}개를 모두 비웠습니다.` });
  }

  function deleteSelectedCards() {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`선택한 카드 ${selectedIds.length}개를 삭제된 카드로 이동할까요?`)) return;
    const ids = [...selectedIds];
    ids.forEach(deleteSavedCard);
    const timestamp = new Date().toISOString();
    setAlbumIndex((current) => current.map((item) => (ids.includes(item.id) ? { ...item, deletedAt: timestamp, updatedAt: timestamp } : item)));
    setSelectedIds([]);
    setFeedback({ type: 'success', message: `선택 카드 ${ids.length}개를 삭제된 카드로 이동했습니다.` });
  }

  function toggleDisplayedSelection() {
    if (displayedActiveItemIds.length === 0 || selectedPlatform === trashPlatformKey) return;
    setSelectedIds((current) => {
      if (displayedActiveItemIds.every((id) => current.includes(id))) {
        const removeSet = new Set(displayedActiveItemIds);
        return current.filter((id) => !removeSet.has(id));
      }
      return Array.from(new Set([...current, ...displayedActiveItemIds]));
    });
  }

  function toggleVisibleTrashSelection() {
    if (visibleTrashItemIds.length === 0) return;
    setTrashSelectedIds((current) => {
      if (visibleTrashItemIds.every((id) => current.includes(id))) {
        const removeSet = new Set(visibleTrashItemIds);
        return current.filter((id) => !removeSet.has(id));
      }
      return Array.from(new Set([...current, ...visibleTrashItemIds]));
    });
  }

  function handleVersionChange(groupKey: string, itemId: string) {
    setVersionSelection((current) => ({ ...current, [groupKey]: itemId }));
    setSelectedIds((current) => {
      const group = versionGroups.find((candidate) => candidate.key === groupKey);
      if (!group) return current;
      const oldIds = new Set(group.versions.map((item) => item.id));
      const withoutOldVersion = current.filter((id) => !oldIds.has(id));
      return current.some((id) => oldIds.has(id)) ? [...withoutOldVersion, itemId] : current;
    });
  }

  // Resolve a card to its current library entry. The stored entry id can be stale (e.g. a game's id flipped to
  // absolute-path based after a rescan), so resolution also falls back to absolute path / system+title.
  const entryLookup = useMemo(() => buildZaparooEntryLookup(zaparooLibrary.entries), [zaparooLibrary.entries]);
  const resolveLinkedEntry = useCallback((item: CardAlbumIndexItem) => resolveEntryForCardLink({
    linkedEntryId: item.mister?.zaparooLibraryEntryId,
    absolutePath: item.mister?.misterAbsolutePath,
    systemId: item.mister?.misterSystemId,
    title: item.title,
  }, entryLookup), [entryLookup]);
  const cardLinkStatus = useCallback((item: CardAlbumIndexItem): 'linked' | 'broken' | 'none' => {
    if (!item.mister?.zaparooLibraryEntryId && !item.mister?.misterAbsolutePath) return 'none';
    return resolveLinkedEntry(item) ? 'linked' : 'broken';
  }, [resolveLinkedEntry]);

  // Ranked candidates for the link picker: exact title > prefix > title-contains > any-field-contains.
  const linkCandidates = useMemo(() => {
    if (!linkPicker) return [];
    const query = normalizeName(linkQuery);
    const scored: Array<{ entry: ZaparooLibraryEntry; score: number }> = [];
    for (const entry of zaparooLibrary.entries) {
      const title = normalizeName(entry.title);
      let score = -1;
      if (!query) score = 0;
      else if (title === query) score = 4;
      else if (title.startsWith(query)) score = 3;
      else if (title.includes(query)) score = 2;
      else if (normalizeName(`${entry.systemId} ${entry.romName} ${entry.relativePath}`).includes(query)) score = 1;
      if (score >= 0) scored.push({ entry, score });
    }
    scored.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title));
    return scored.slice(0, 60).map((candidate) => candidate.entry);
  }, [linkPicker, linkQuery, zaparooLibrary.entries]);

  // deviceId(별칭/안정 id 포함) → 미스터 표시 이름. 라이브러리 게임이 "어느 미스터에 있는지" 보여주는 데 쓴다.
  const misterNameByDeviceId = useMemo(() => {
    const map = new Map<string, string>();
    for (const profile of zaparooLibrary.profiles) {
      const name = misterDisplayName(profile);
      map.set(profile.deviceId, name);
      if (profile.stableDeviceId) map.set(profile.stableDeviceId, name);
      for (const aliasId of profile.aliasDeviceIds ?? []) map.set(aliasId, name);
    }
    return map;
  }, [zaparooLibrary.profiles]);
  function misterNamesForEntry(entry: ZaparooLibraryEntry): string {
    const names = Array.from(new Set(entry.sourceDevices.map((id) => misterNameByDeviceId.get(id)).filter((v): v is string => Boolean(v))));
    return names.length ? names.join(', ') : '미스터 정보 없음';
  }
  const brokenLinkCount = useMemo(
    () => albumIndex.filter((item) => !item.deletedAt && cardLinkStatus(item) === 'broken').length,
    [albumIndex, cardLinkStatus],
  );

  // Pick which connected MiSTer to launch/write for this card's linked game (selected target preferred, else
  // the only candidate). Undefined when no connected device has the game → caller uses the active connection.
  function resolveAlbumTarget(linkedEntry?: ZaparooLibraryEntry) {
    if (!linkedEntry) return undefined;
    const targets = resolveLaunchTargetsForEntry(linkedEntry, connectedDevices, zaparooLibrary.profiles);
    if (targets.length === 0) return undefined;
    const chosen = targets[0];
    return {
      config: chosen.device.config,
      connectionId: chosen.device.sessionId,
      sourceRef: chosen.sourceRef,
      deviceLabel: misterDisplayName(chosen.device),
    };
  }

  // Launch/NFC from the album asks which connected MiSTer to use when there is a choice.
  function openDevicePicker(item: CardAlbumIndexItem, mode: 'launch' | 'nfc') {
    if (connectedDevices.length === 0) {
      setFeedback({ type: 'error', message: 'MiSTer 연결이 필요합니다. 먼저 MiSTer 연결 메뉴에서 연결하세요.' });
      return;
    }
    const linkedEntry = resolveLinkedEntry(item);
    const targets = linkedEntry ? resolveLaunchTargetsForEntry(linkedEntry, connectedDevices, zaparooLibrary.profiles) : [];
    // No linked entry (can't tell which device has it): offer every connected MiSTer.
    const candidates: LaunchTarget[] = targets.length > 0
      ? targets
      : connectedDevices.map((device) => ({ device, sourceRef: undefined }));
    if (candidates.length === 1) {
      if (mode === 'launch') void launchGameOnMiSTer(item, candidates[0]);
      else void writeNfc(item, candidates[0]);
      return;
    }
    setDevicePicker({ item, mode, candidates });
  }

  async function writeNfc(item: CardAlbumIndexItem, picked?: LaunchTarget) {
    const linkedEntry = resolveLinkedEntry(item);
    const target = picked
      ? { config: picked.device.config, connectionId: picked.device.sessionId, sourceRef: picked.sourceRef, deviceLabel: misterDisplayName(picked.device) }
      : resolveAlbumTarget(linkedEntry);
    const preview = launchPreviewForItem(item, linkedEntry);
    const launchText = launchTextForDeviceRef(target?.sourceRef, preview?.text ?? '');
    if (!launchText) {
      setNfcStates((current) => ({ ...current, [item.id]: { status: 'error', message: 'NFC 쓰기용 실행 경로가 없습니다.' } }));
      setFeedback({ type: 'error', message: '이 카드에는 NFC 쓰기용 실행 경로가 없습니다.' });
      return;
    }
    const payload = buildTagPayload(launchText);
    if (!payload.valid) {
      setNfcStates((current) => ({ ...current, [item.id]: { status: 'error', payload: launchText, message: payload.warnings.join(' ') } }));
      setFeedback({ type: 'error', message: payload.warnings.join(' ') });
      return;
    }
    // Gate NFC on the SAME connection id as game launch (single source of truth), so NFC never refuses
    // with "연결하세요" in a state where launch works. The physical reader requirement is reported
    // separately by the bridge when the tag is written.
    const activeConnectionId = target?.connectionId ?? (mister.connection.connectionId || activeMister?.sessionId);
    const activeConnectionConfig = target?.config ?? (mister.connection.connectionId
      ? mister.connection.config
      : activeMister
        ? {
            host: activeMister.ipAddress,
            port: activeMister.port,
            username: activeMister.username || 'root',
            protocol: 'ssh-sftp' as const,
            authMethod: 'password' as const,
          }
        : mister.connection.config);
    if (!activeConnectionId) {
      setNfcStates((current) => ({ ...current, [item.id]: { status: 'error', payload: launchText, message: 'MiSTer 연결 메뉴에서 먼저 연결하세요.' } }));
      setFeedback({ type: 'error', message: 'MiSTer 연결 메뉴에서 먼저 연결하세요.' });
      return;
    }
    setNfcStates((current) => ({ ...current, [item.id]: { status: 'writing', payload: launchText, message: 'NFC 태그에 쓰는 중입니다.' } }));
    setFeedback({ type: 'success', message: 'NFC 태그에 쓰는 중입니다. 태그를 MiSTer USB 리더 위에 올려두세요.' });
    try {
      const result = await new HttpMiSTerBridgeClient().writeTag(activeConnectionConfig, payload, activeConnectionId);
      addMiSTerTagJob({ ...result.job, entryId: linkedEntry?.id });
      const resultMessage = result.message || (result.ok ? 'NFC 쓰기 완료. 태그에 실행 데이터가 기록되었습니다.' : 'NFC 쓰기에 실패했습니다.');
      setNfcStates((current) => ({
        ...current,
        [item.id]: {
          status: result.ok ? 'written' : 'error',
          payload: launchText,
          message: result.ok ? 'NFC 쓰기 완료. 태그에 실행 데이터가 기록되었습니다.' : resultMessage,
        },
      }));
      setFeedback({
        type: result.ok ? 'success' : 'error',
        message: result.ok ? 'NFC 쓰기 완료. 태그에 실행 데이터가 기록되었습니다.' : resultMessage,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'NFC 쓰기에 실패했습니다.';
      setNfcStates((current) => ({ ...current, [item.id]: { status: 'error', payload: launchText, message } }));
      setFeedback({ type: 'error', message });
    }
  }

  async function launchGameOnMiSTer(item: CardAlbumIndexItem, picked?: LaunchTarget) {
    const linkedEntry = resolveLinkedEntry(item);
    if (!linkedEntry && !item.mister) {
      setFeedback({ type: 'error', message: '라이브러리 연결이 필요합니다.' });
      return;
    }
    const target = picked
      ? { config: picked.device.config, connectionId: picked.device.sessionId, sourceRef: picked.sourceRef, deviceLabel: misterDisplayName(picked.device) }
      : resolveAlbumTarget(linkedEntry);
    const launchText = launchTextForDeviceRef(target?.sourceRef, launchPreviewForItem(item, linkedEntry)?.text ?? '');
    if (!launchText) {
      setFeedback({ type: 'error', message: 'MiSTer에서 실행할 launch text를 만들 수 없습니다.' });
      return;
    }
    const activeConnectionId = target?.connectionId ?? (mister.connection.connectionId || activeMister?.sessionId);
    const activeConnectionConfig = target?.config ?? (mister.connection.connectionId
      ? mister.connection.config
      : activeMister
        ? {
            host: activeMister.ipAddress,
            port: activeMister.port,
            username: activeMister.username || 'root',
            protocol: 'ssh-sftp' as const,
            authMethod: 'password' as const,
          }
        : mister.connection.config);
    if (!activeConnectionId) {
      setFeedback({ type: 'error', message: 'MiSTer 연결 메뉴에서 먼저 연결하세요.' });
      return;
    }
    try {
      const result = await new HttpMiSTerBridgeClient().launchGame(activeConnectionConfig, launchText, activeConnectionId) as {
        ok: boolean;
        message: string;
        diagnostics?: ZaparooRunDiagnostics;
      };
      if (!result.ok) {
        setLaunchDiagnostics({
          gameTitle: displayCardTitle(item),
          platform: linkedEntry?.systemId || item.platform,
          activeMister: activeMister ? misterDisplayName(activeMister) : activeConnectionConfig.host,
          zapScript: launchText,
          diagnostics: result.diagnostics,
          methodMessage: result.diagnostics?.methodResult?.message,
          fallbackMessage: result.diagnostics?.fallbackResult?.message,
        });
      } else {
        setLaunchDiagnostics(null);
      }
      setFeedback({
        type: result.ok ? 'success' : 'error',
        message: result.ok ? `MiSTer 실행 요청을 보냈습니다. ${launchText}` : result.message,
      });
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'MiSTer 실행 요청에 실패했습니다.' });
    }
  }

  const sectionTitle = selectedPlatform === trashPlatformKey ? '삭제된 카드' : selectedPlatform === allCardsKey ? '전체 카드' : selectedPlatform || 'Recent Cards';
  const sectionDescription = selectedPlatform === trashPlatformKey
    ? '휴지통에 있는 카드입니다. 복원하거나 영구 삭제할 수 있습니다.'
    : selectedPlatform === allCardsKey
      ? '전체 카드 색인을 페이지 단위로 탐색합니다.'
    : selectedPlatform
      ? '선택한 platform의 저장 카드입니다.'
      : '최신 20개 카드를 먼저 표시하고, 나머지는 배경에서 불러옵니다.';

  return (
    <>
      {devicePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDevicePicker(null)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <p className="text-sm font-semibold text-neutral-900">
              {devicePicker.mode === 'launch' ? '어느 미스터에서 실행할까요?' : '어느 미스터에 NFC를 쓸까요?'}
            </p>
            <p className="mt-1 truncate text-xs text-neutral-500">{displayCardTitle(devicePicker.item)}</p>
            <div className="mt-3 space-y-2">
              {devicePicker.candidates.map((candidate) => (
                <button
                  key={candidate.device.deviceId}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-left text-sm hover:bg-neutral-50"
                  onClick={() => {
                    const { item, mode } = devicePicker;
                    setDevicePicker(null);
                    if (mode === 'launch') void launchGameOnMiSTer(item, candidate);
                    else void writeNfc(item, candidate);
                  }}
                >
                  <span className="font-medium text-neutral-900">{misterDisplayName(candidate.device)}</span>
                  <span className="text-xs text-neutral-500">{candidate.device.ipAddress}</span>
                </button>
              ))}
            </div>
            <button type="button" className="mt-3 w-full rounded-md border border-line px-3 py-2 text-sm hover:bg-neutral-50" onClick={() => setDevicePicker(null)}>
              취소
            </button>
          </div>
        </div>
      )}
      {linkPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setLinkPicker(null)}>
          <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg bg-white p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <p className="text-sm font-semibold text-neutral-900">게임 라이브러리에서 연결할 게임 선택</p>
            <p className="mt-1 truncate text-xs text-neutral-500">카드: {displayCardTitle(linkPicker.item)}</p>
            <input
              autoFocus
              value={linkQuery}
              onChange={(event) => setLinkQuery(event.target.value)}
              placeholder="제목 / 시스템 / 경로로 검색"
              className="mt-3 w-full rounded-md border border-line px-3 py-2 text-sm"
            />
            <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
              {zaparooLibrary.entries.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-neutral-500">게임 라이브러리가 비어 있습니다. 먼저 미스터 게임 리스트에서 스캔하세요.</p>
              ) : linkCandidates.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-neutral-500">검색 결과가 없습니다.</p>
              ) : (
                linkCandidates.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => {
                      const item = linkPicker.item;
                      setLinkPicker(null);
                      void linkCardToEntry(item, entry);
                    }}
                    className="flex w-full flex-col gap-0.5 rounded-md border border-line px-3 py-2 text-left hover:bg-blue-50"
                  >
                    <span className="truncate text-sm font-medium text-neutral-900">{entry.title}</span>
                    <span className="truncate text-[11px] font-medium text-blue-700">미스터: {misterNamesForEntry(entry)}</span>
                    <span className="truncate text-[11px] text-neutral-500">{entry.platformGroup} · {entry.systemId} · {entry.relativePath}</span>
                  </button>
                ))
              )}
            </div>
            <button type="button" className="mt-3 w-full shrink-0 rounded-md border border-line px-3 py-2 text-sm hover:bg-neutral-50" onClick={() => setLinkPicker(null)}>
              취소
            </button>
          </div>
        </div>
      )}
      <PageHeader
        eyebrow="저장 카드"
        title="카드 앨범"
        description="카드 앨범은 가벼운 색인과 썸네일 캐시만 먼저 불러오고, 전체 카드 데이터는 편집/출력 때만 읽습니다."
      />

      <section className="mb-5 rounded-lg border border-line bg-white p-5 shadow-surface">
        {feedback && (
          <div
            className={`mb-4 rounded-md border px-3 py-2 text-sm ${
              feedback.type === 'success'
                ? 'border-green-200 bg-green-50 text-green-800'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            {feedback.message}
          </div>
        )}
        {launchDiagnostics && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-semibold">Zaparoo 실행 진단</p>
            <p className="mt-1">
              {launchDiagnostics.gameTitle}
              {launchDiagnostics.platform ? ` · ${launchDiagnostics.platform}` : ''}
              {launchDiagnostics.activeMister ? ` · ${launchDiagnostics.activeMister}` : ''}
            </p>
            <p className="mt-1">
              원인: {launchDiagnostics.diagnostics?.code ?? 'UNKNOWN_ZAPAROO_ERROR'}
            </p>
            {launchDiagnostics.diagnostics?.config && (
              <p className="mt-1">
                config.toml: {launchDiagnostics.diagnostics.config.message}
              </p>
            )}
            <p className="mt-1">앱은 config.toml을 자동 수정하지 않습니다.</p>
            {developerMode && (
              <details className="mt-2">
                <summary className="cursor-pointer font-medium">내부 진단 상세</summary>
                <pre className="mt-2 whitespace-pre-wrap rounded border border-amber-200 bg-white p-2 text-[11px] text-amber-950">
                  {JSON.stringify({
                    zapScript: launchDiagnostics.zapScript,
                    method: launchDiagnostics.methodMessage,
                    fallback: launchDiagnostics.fallbackMessage,
                    config: launchDiagnostics.diagnostics?.config,
                  }, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">앨범 제어</h2>
            <p className="mt-1 text-sm text-neutral-600">선택한 카드 버전을 인쇄, 내보내기, 삭제 대상으로 보냅니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm">
              <span className="font-medium">카드 크기</span>
              <input type="range" min={220} max={300} value={cardSize} onChange={(event) => setCardSize(Number(event.target.value))} />
            </label>
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              disabled={selectedIds.length === 0}
              className="rounded-md border border-line px-3 py-2 text-sm font-medium disabled:opacity-40"
            >
              선택 비우기
            </button>
            {brokenLinkCount > 0 && (
              <button
                type="button"
                onClick={() => void repairBrokenLinks()}
                className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"
                title="저장된 링크가 더 이상 라이브러리에서 찾아지지 않는 카드를, 경로/제목이 정확히 일치하는 게임으로 자동 재연결합니다."
              >
                <Link2 className="h-4 w-4" />
                끊긴 링크 복구 ({brokenLinkCount})
              </button>
            )}
            <button
              type="button"
              onClick={sendSelectedToPrint}
              disabled={selectedIds.length === 0}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-40"
            >
              <Printer className="h-4 w-4" />
              인쇄로 보내기 ({selectedIds.length})
            </button>
            <button
              type="button"
              onClick={() => void editSelectedCards()}
              disabled={selectedIds.length === 0}
              className="inline-flex items-center gap-2 rounded-md border border-blue-200 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40"
            >
              선택 카드 편집
            </button>
            <button
              type="button"
              onClick={deleteSelectedCards}
              disabled={selectedIds.length === 0}
              className="inline-flex items-center gap-2 rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" />
              선택 카드 삭제
            </button>
            <button
              type="button"
              onClick={() => void exportSelectedCards()}
              disabled={selectedIds.length === 0}
              className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium disabled:opacity-40"
            >
              선택 카드 ZIP 내보내기
            </button>
            <label className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={importCardTemplatesWithCards}
                onChange={(event) => setImportCardTemplatesWithCards(event.target.checked)}
              />
              템플릿도 함께 가져오기
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium hover:bg-neutral-50">
              카드 ZIP 가져오기
              <input
                type="file"
                accept=".zip,application/zip"
                className="sr-only"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void importCardBundle(file);
                  event.currentTarget.value = '';
                }}
              />
            </label>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-neutral-400" />
            <input
              value={albumQuery}
              onChange={(event) => setAlbumQuery(event.target.value)}
              placeholder={fullAlbumReady ? '카드 검색' : '최근 카드 20개에서 먼저 검색합니다'}
              className="w-full rounded-md border border-line py-2 pl-8 pr-2 text-sm"
            />
          </label>
          <div className="rounded-md border border-line bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
            {fullAlbumReady ? `전체 카드 ${activeIndex.length}개 사용 가능` : 'Loading remaining cards...'}
          </div>
        </div>
        {!fullAlbumReady && albumQuery.trim() ? (
          <p className="mt-2 text-xs text-amber-700">전체 카드 색인이 끝나는 동안 최근 카드 20개에서 먼저 검색합니다.</p>
        ) : null}
      </section>

      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-line bg-white p-4 shadow-surface">
          <button
            type="button"
            onClick={() => setSelectedPlatform('')}
            className={`mb-3 w-full rounded-md px-3 py-2 text-left text-sm ${selectedPlatform === '' ? 'bg-primary text-white shadow-selected' : 'border border-line hover:bg-blue-50'}`}
          >
            <span className="block font-medium">Recent Cards</span>
            <span className="text-xs opacity-80">최근 20개</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedPlatform(allCardsKey)}
            disabled={!fullAlbumReady}
            className={`mb-3 w-full rounded-md px-3 py-2 text-left text-sm disabled:opacity-45 ${selectedPlatform === allCardsKey ? 'bg-primary text-white shadow-selected' : 'border border-line hover:bg-blue-50'}`}
          >
            <span className="block font-medium">전체 카드</span>
            <span className="text-xs opacity-80">{fullAlbumReady ? `${activeIndex.length}개` : '배경 로딩 중'}</span>
          </button>
          <div className="border-t border-line pt-3">
            <h2 className="mb-2 text-sm font-semibold">Platform</h2>
            <div className="max-h-[52vh] overflow-auto pr-1">
              {!fullAlbumReady && <p className="mb-2 rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-500">Loading remaining cards...</p>}
              {platformBuckets.map((bucket) => (
                <button
                  key={bucket.key}
                  type="button"
                  onClick={() => setSelectedPlatform((current) => (current === bucket.key ? '' : bucket.key))}
                  className={`mb-2 w-full rounded-md px-3 py-2 text-left text-sm ${selectedPlatform === bucket.key ? 'bg-primary text-white shadow-selected' : 'border border-line hover:bg-blue-50'}`}
                >
                  <span className="block font-medium">{bucket.key}</span>
                  <span className="text-xs opacity-80">{bucket.groups.length}개 카드</span>
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSelectedPlatform(trashPlatformKey)}
            className={`mt-4 w-full rounded-md px-3 py-2 text-left text-sm ${
              selectedPlatform === trashPlatformKey ? 'bg-red-600 text-white shadow-selected' : 'border border-red-200 text-red-700 hover:bg-red-50'
            }`}
          >
            <span className="block font-medium">삭제된 카드</span>
            <span className="text-xs opacity-80">{deletedIndex.length}개 보관 중</span>
          </button>
        </aside>

        <section className="min-h-0 rounded-lg border border-line bg-white p-5 shadow-surface">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">{sectionTitle}</h2>
                {selectedPlatform && selectedPlatform !== trashPlatformKey && (
                  <button
                    type="button"
                    onClick={toggleDisplayedSelection}
                    disabled={displayedActiveItemIds.length === 0}
                    title="현재 목록의 카드를 모두 선택합니다"
                    className="rounded-md border border-blue-200 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                  >
                    {allDisplayedSelected ? '전체 선택 해제' : selectedPlatform === allCardsKey ? '현재 목록 전체 선택' : '플랫폼 전체 선택'}
                  </button>
                )}
              </div>
              <p className="mt-1 text-sm text-neutral-600">{sectionDescription}</p>
              {selectedPlatform === trashPlatformKey && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleVisibleTrashSelection}
                    disabled={visibleTrashItemIds.length === 0}
                    className="rounded-md border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-40"
                  >
                    {allVisibleTrashSelected ? '현재 목록 선택 해제' : '현재 목록 전체 선택'}
                  </button>
                  <button
                    type="button"
                    onClick={permanentlyDeleteSelectedTrashCards}
                    disabled={trashSelectedIds.length === 0}
                    className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-40"
                  >
                    선택 영구 삭제 ({trashSelectedIds.length})
                  </button>
                  <button
                    type="button"
                    onClick={emptyTrash}
                    disabled={deletedIndex.length === 0}
                    className="rounded-md bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40"
                  >
                    휴지통 비우기
                  </button>
                  {trashSelectedIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setTrashSelectedIds([])}
                      className="rounded-md border border-line px-2 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                    >
                      선택 해제
                    </button>
                  )}
                </div>
              )}
            </div>
            <span className="text-sm font-medium text-neutral-500">{displayGroups.length}</span>
          </div>
          {fullAlbumReady && (
            <PaginationControls
              currentPage={pagedDisplayGroups.currentPage}
              totalItems={displayGroups.length}
              pageSize={albumPageSize}
              onPageChange={setAlbumPage}
              itemLabel="개 카드"
              className="mt-4 rounded-md border border-line bg-neutral-50 px-3 py-2"
            />
          )}
          <div className="mt-2 max-h-[72vh] overflow-auto pr-2">
            <AlbumGrid
              groups={visibleDisplayGroups}
              versionSelection={versionSelection}
              categoriesById={categoriesById}
              selectedIds={selectedPlatform === trashPlatformKey ? trashSelectedIds : selectedIds}
              cardSize={cardSize}
              assetsById={assetsById}
              templates={templates}
              trashMode={selectedPlatform === trashPlatformKey}
              emptyMessage={selectedPlatform === trashPlatformKey ? '삭제된 카드가 없습니다.' : '이 섹션에 저장 카드가 없습니다.'}
              nfcStates={nfcStates}
              generateThumbnail={generateThumbnail}
              onThumbnailLoaded={handleThumbnailLoaded}
              onThumbnailStatusChange={updateIndexItem}
              onVersionChange={handleVersionChange}
              onToggleSelected={selectedPlatform === trashPlatformKey ? toggleTrashSelected : toggleSelected}
              onOpen={(id) => void openInEditor(id)}
              onDelete={deleteCard}
              onRestore={restoreCard}
              onPermanentDelete={permanentlyDeleteCard}
              onLaunchGame={(item) => openDevicePicker(item, 'launch')}
              onWriteNfc={(item) => openDevicePicker(item, 'nfc')}
              onLinkLibrary={(item) => void linkCardToLibrary(item)}
              getLinkStatus={cardLinkStatus}
            />
          </div>
        </section>
      </div>
    </>
  );
}
