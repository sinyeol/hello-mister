import { Suspense, lazy, useCallback, useEffect, useState, type ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RouteErrorBoundary } from '@sticker-v1/components/common/RouteErrorBoundary';
import { getSavedAssetSourceMetadata } from '@sticker-v1/services/assets/assetSources';
import {
  loadCardAlbumIndexFromIndexedDb,
  loadPrintQueueIdsFromIndexedDb,
  migrateLegacySavedCardsToSplitStores,
} from '@sticker-v1/services/cards/savedCardsPersistence';
import { loadMiSTerStateFromIndexedDb } from '@sticker-v1/services/mister/misterPersistence';
import { loadPersistedTemplatesFromIndexedDb } from '@sticker-v1/services/templates/templatePersistence';
import { loadZaparooLibraryStateFromIndexedDb } from '@sticker-v1/services/zaparoo/zaparooLibrary';
import { useProjectStore } from '@sticker-v1/store/projectStore';

const AssetLoadingPage = lazy(() => import('@sticker-v1/pages/AssetLoadingPage').then(({ AssetLoadingPage }) => ({ default: AssetLoadingPage })));
const CardAlbumPage = lazy(() => import('@sticker-v1/pages/CardAlbumPage').then(({ CardAlbumPage }) => ({ default: CardAlbumPage })));
const CardEditorPage = lazy(() => import('@sticker-v1/pages/CardEditorPage').then(({ CardEditorPage }) => ({ default: CardEditorPage })));
const ExportPreviewPage = lazy(() => import('@sticker-v1/pages/ExportPreviewPage').then(({ ExportPreviewPage }) => ({ default: ExportPreviewPage })));
const LayoutEditorPage = lazy(() => import('@sticker-v1/pages/LayoutEditorPage').then(({ LayoutEditorPage }) => ({ default: LayoutEditorPage })));
const MisterFpgaPage = lazy(() => import('@sticker-v1/pages/MisterFpgaPage').then(({ MisterFpgaPage }) => ({ default: MisterFpgaPage })));
const TemplateManagementPage = lazy(() => import('@sticker-v1/pages/TemplateManagementPage').then(({ TemplateManagementPage }) => ({ default: TemplateManagementPage })));

interface PersistenceHydratorProps {
  onProgress: (label: string) => void;
  onDone: () => void;
}

function isStartupLoggingEnabled() {
  return typeof window !== 'undefined' && (['localhost', '127.0.0.1'].includes(window.location.hostname) || window.localStorage.getItem('zaparoo.debugStartup') === '1');
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function PersistenceHydrator({ onProgress, onDone }: PersistenceHydratorProps) {
  const hydrateSavedCardIndex = useProjectStore((state) => state.hydrateSavedCardIndex);
  const hydrateTemplates = useProjectStore((state) => state.hydrateTemplates);
  const setMiSTerState = useProjectStore((state) => state.setMiSTerState);
  const setZaparooLibrary = useProjectStore((state) => state.setZaparooLibrary);

  useEffect(() => {
    let mounted = true;
    const startedAt = nowMs();
    const diagnostics = {
      appSettingsLoadMs: 0,
      cardMetaCount: 0,
      cardFullDataRecordsLoadedDuringStartup: 0,
      imageSourceCacheRecordsLoadedDuringStartup: 0,
      thumbnailRecordsLoadedDuringStartup: 0,
      registeredImageSourceCount: 0,
      templateCount: 0,
      misterProfileCount: 0,
      resetOrCleanupExecuted: false,
    };

    void (async () => {
      try {
        onProgress('카드 앨범 색인을 불러오는 중');
        const cardStartedAt = nowMs();
        const [cardMeta, printQueueIds] = await Promise.all([loadCardAlbumIndexFromIndexedDb(), loadPrintQueueIdsFromIndexedDb()]);
        diagnostics.cardMetaCount = cardMeta.length;
        diagnostics.appSettingsLoadMs += nowMs() - cardStartedAt;
        if (!mounted) return;
        hydrateSavedCardIndex(cardMeta, printQueueIds);

        onProgress('템플릿을 불러오는 중');
        const templates = await loadPersistedTemplatesFromIndexedDb();
        diagnostics.templateCount = templates.length;
        if (!mounted) return;
        hydrateTemplates(templates);

        onProgress('MiSTer profile을 불러오는 중');
        const mister = await loadMiSTerStateFromIndexedDb();
        if (!mounted) return;
        setMiSTerState(mister);

        onProgress('미스터 게임 리스트를 불러오는 중');
        const zaparooLibrary = await loadZaparooLibraryStateFromIndexedDb();
        diagnostics.misterProfileCount = zaparooLibrary.profiles.length;
        if (!mounted) return;
        setZaparooLibrary(zaparooLibrary);

        onProgress('이미지 소스 설정을 확인하는 중');
        diagnostics.registeredImageSourceCount = getSavedAssetSourceMetadata().length;

        await new Promise((resolve) => window.setTimeout(resolve, Math.max(0, 300 - (nowMs() - startedAt))));
      } catch {
        onProgress('일부 데이터를 불러오지 못했지만 앱을 계속 시작합니다.');
      } finally {
        if (mounted) {
          const firstAppRenderMs = nowMs() - startedAt;
          if (isStartupLoggingEnabled()) {
            console.debug('[Startup] persistence diagnostics', {
              ...diagnostics,
              firstAppRenderMs: Math.round(firstAppRenderMs),
              originalArtworkDecodedDuringStartup: 0,
            });
          }
          onProgress('완료');
          onDone();
          if (diagnostics.cardMetaCount === 0) {
            window.setTimeout(() => {
              void migrateLegacySavedCardsToSplitStores()
                .then(async (legacyMeta) => {
                  if (!mounted || legacyMeta.length === 0) return;
                  const printQueueIds = await loadPrintQueueIdsFromIndexedDb();
                  if (!mounted) return;
                  hydrateSavedCardIndex(legacyMeta, printQueueIds);
                  if (isStartupLoggingEnabled()) {
                    console.debug('[Startup] legacy saved card migration completed after first render', {
                      cardMetaCount: legacyMeta.length,
                    });
                  }
                })
                .catch(() => undefined);
            }, 0);
          }
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [hydrateSavedCardIndex, hydrateTemplates, onDone, onProgress, setMiSTerState, setZaparooLibrary]);

  return null;
}

function RouteLoadingFallback() {
  return (
    <div className="grid min-h-[360px] place-items-center">
      <div className="rounded-lg border border-line bg-white px-4 py-3 text-sm font-medium text-neutral-600 shadow-surface">
        화면을 불러오는 중...
      </div>
    </div>
  );
}

function enableTemplateNoThumbnailMode() {
  window.localStorage.setItem('zaparoo.templateManagement.noThumbnails', '1');
}

function lazyRoute(
  element: ReactElement,
  errorMessage = '화면을 불러오지 못했습니다.',
  options: { bypassLabel?: string; onBypass?: () => void } = {},
) {
  return (
    <RouteErrorBoundary message={errorMessage} bypassLabel={options.bypassLabel} onBypass={options.onBypass}>
      <Suspense fallback={<RouteLoadingFallback />}>{element}</Suspense>
    </RouteErrorBoundary>
  );
}

export function StickerV1ContentHost({ children }: { children: ReactElement }) {
  const [startupStep, setStartupStep] = useState('앱 시작 준비 중');
  const [startupComplete, setStartupComplete] = useState(false);
  const finishStartup = useCallback(() => setStartupComplete(true), []);
  return (
    <>
      <PersistenceHydrator onProgress={setStartupStep} onDone={finishStartup} />
      {!startupComplete && (
        <div className="fixed inset-0 z-[1000] grid place-items-center bg-white">
          <div className="w-[min(420px,90vw)] rounded-lg border border-line bg-white p-6 text-center shadow-surface">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Hello Mister</p>
            <h1 className="mt-2 text-xl font-semibold">데이터를 불러오는 중</h1>
            <p className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900">{startupStep}</p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-neutral-100">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
            </div>
            <p className="mt-3 text-xs text-neutral-500">
              시작 단계에서는 카드 메타데이터와 설정만 확인합니다. 전체 카드 디자인, 원본 이미지, 이미지 폴더 인덱스는 필요한 화면에서만 불러옵니다.
            </p>
          </div>
        </div>
      )}
      {children}
    </>
  );
}

export function StickerV1Routes() {
  return (
    <Routes>
      <Route index element={<Navigate to="/stickers/mister" replace />} />
      <Route path="categories" element={<Navigate to="/stickers" replace />} />
      <Route path="games" element={<Navigate to="/stickers/mister" replace />} />
      <Route path="project-games" element={<Navigate to="/stickers/mister" replace />} />
      <Route path="assets" element={<Navigate to="/stickers/images" replace />} />
      <Route path="images" element={lazyRoute(<AssetLoadingPage />)} />
      <Route path="mister" element={lazyRoute(<MisterFpgaPage />)} />
      <Route path="mister/import" element={lazyRoute(<MisterFpgaPage />)} />
      <Route path="nfc" element={lazyRoute(<MisterFpgaPage />)} />
      <Route path="cards" element={<Navigate to="/stickers/editor" replace />} />
      <Route path="editor" element={lazyRoute(<CardEditorPage />)} />
      <Route path="album" element={lazyRoute(<CardAlbumPage />)} />
      <Route
        path="templates"
        element={lazyRoute(<TemplateManagementPage />, '템플릿 화면을 불러오지 못했습니다.', {
          bypassLabel: '썸네일 없이 열기',
          onBypass: enableTemplateNoThumbnailMode,
        })}
      />
      <Route path="template-editor" element={lazyRoute(<LayoutEditorPage />, '템플릿 화면을 불러오지 못했습니다.')} />
      <Route path="layout-editor" element={<Navigate to="/stickers/template-editor" replace />} />
      <Route path="export" element={<Navigate to="/stickers/output" replace />} />
      <Route path="output" element={lazyRoute(<ExportPreviewPage />)} />
      <Route path="*" element={<Navigate to="/stickers" replace />} />
    </Routes>
  );
}
