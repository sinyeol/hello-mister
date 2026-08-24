import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Edit3, Loader2, Printer, RefreshCw, RotateCcw, Trash2, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@sticker-v1/components/common/PageHeader';
import { RouteErrorBoundary } from '@sticker-v1/components/common/RouteErrorBoundary';
import { PrintSheetPreview } from '@sticker-v1/components/export/PrintSheetPreview';
import { TemplateThumbnail, TemplateThumbnailPlaceholder } from '@sticker-v1/components/templates/TemplateThumbnail';
import { createSheetPlacements } from '@sticker-v1/export/sheetLayout';
import { buildTemplateBundle, parseTemplateBundle } from '@sticker-v1/services/templates/templateBundle';
import { deleteTemplateThumbnailBlob, loadTemplateThumbnailBlob } from '@sticker-v1/services/templates/templateThumbnailCache';
import {
  regenerateTemplateThumbnail,
  TEMPLATE_THUMBNAIL_RENDER_VERSION,
} from '@sticker-v1/services/templates/templateThumbnailGeneration';
import { parseTemplateFile } from '@sticker-v1/services/templates/templateValidation';
import { useProjectStore } from '@sticker-v1/store/projectStore';
import type { CardItem, Template } from '@sticker-v1/types';
import { normalizeTemplateForRender } from '@sticker-v1/utils/templateRenderNormalize';

// Template thumbnails flow through CardPreview; that final renderer handles TemplateShapeLayer and isTemplateShapeLayer.
const noThumbnailModeStorageKey = 'zaparoo.templateManagement.noThumbnails';

function safeFileName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'template';
}

function formatTemplateType(template: Template) {
  return template.type === 'front' ? '앞면' : '뒷면';
}

function shouldLogTemplateDiagnostics() {
  return typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
}

function loadNoThumbnailMode() {
  return typeof window !== 'undefined' && window.localStorage.getItem(noThumbnailModeStorageKey) === '1';
}

export function TemplateManagementPage() {
  const { templates, addTemplate, updateTemplateThumbnail, deleteTemplate, restoreTemplate, permanentlyDeleteTemplate, categories, assetLibrary, exportSettings } = useProjectStore();
  const sourceTemplates = useMemo(() => (Array.isArray(templates) ? templates : []), [templates]);
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const [selectedId, setSelectedId] = useState(sourceTemplates.find((template) => template && !template.deletedAt)?.id ?? '');
  const [thumbnailSize, setThumbnailSize] = useState(180);
  const [thumbnailRefreshKeys, setThumbnailRefreshKeys] = useState<Record<string, string>>({});
  const [thumbnailObjectUrls, setThumbnailObjectUrls] = useState<Record<string, { cacheKey: string; url: string }>>({});
  const [refreshingThumbnailIds, setRefreshingThumbnailIds] = useState<string[]>([]);
  const [thumbnailRefreshErrors, setThumbnailRefreshErrors] = useState<Record<string, string>>({});
  const [refreshAllProgress, setRefreshAllProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [ignoreThumbnailCache, setIgnoreThumbnailCache] = useState(false);
  const [thumbnailSafeMode, setThumbnailSafeMode] = useState(loadNoThumbnailMode);
  const [showTrash, setShowTrash] = useState(false);
  const [backPrintTemplate, setBackPrintTemplate] = useState<Template | undefined>();
  const [backPrintMode, setBackPrintMode] = useState<'pages' | 'cards'>('pages');
  const [backPrintQuantity, setBackPrintQuantity] = useState(1);
  const backPrintRef = useRef<HTMLDivElement>(null);
  const thumbnailObjectUrlsRef = useRef(thumbnailObjectUrls);
  const loadingThumbnailKeysRef = useRef(new Set<string>());
  const storedTemplates = useMemo(() => sourceTemplates.filter((template): template is Template => Boolean(template && typeof template === 'object')), [sourceTemplates]);
  const visibleTemplates = storedTemplates.filter((template) => !template.deletedAt);
  const deletedTemplates = storedTemplates.filter((template) => template.deletedAt);
  const selectedTemplate = storedTemplates.find((template) => template.id === selectedId);
  const cardsPerSheet = exportSettings.columns * exportSettings.rows;
  const backPrintCardCount = Math.max(1, backPrintMode === 'pages' ? backPrintQuantity * cardsPerSheet : backPrintQuantity);
  const backPrintPageCount = Math.ceil(backPrintCardCount / cardsPerSheet);
  const backPrintCards = useMemo(() => {
    if (!backPrintTemplate) return [];
    return Array.from({ length: backPrintCardCount }, (_, index): CardItem => ({
      id: `back_template_print_${backPrintTemplate.id}_${index}`,
      gameId: `back_template_game_${backPrintTemplate.id}`,
      categoryId: 'back-template-print',
      layoutMode: 'CUSTOM',
      printOrder: index,
      coordinateLockKey: `back-template-print:${backPrintTemplate.id}:${index}`,
      front: {
        side: 'front',
        titleText: backPrintTemplate.name,
      },
      back: {
        side: 'back',
        templateId: backPrintTemplate.id,
        categoryId: 'back-template-print',
        generatedFallback: false,
        categoryLabel: 'Back Template',
      },
    }));
  }, [backPrintCardCount, backPrintTemplate]);
  const backPrintCardsById = useMemo(() => Object.fromEntries(backPrintCards.map((card) => [card.id, card])), [backPrintCards]);
  const backPrintSheetPairs = useMemo(
    () => createSheetPlacements(backPrintCards.map((card) => card.id), exportSettings),
    [backPrintCards, exportSettings],
  );
  const categoriesById = useMemo(() => Object.fromEntries(categories.map((category) => [category.id, category])), [categories]);
  const assetsById = assetLibrary?.assetsById ?? {};
  const isRefreshingAllThumbnails = Boolean(refreshAllProgress);

  const openWithoutThumbnails = useCallback(() => {
    setThumbnailSafeMode(true);
    setIgnoreThumbnailCache(true);
    window.localStorage.setItem(noThumbnailModeStorageKey, '1');
    setMessage('썸네일 없이 템플릿 목록을 열었습니다. 템플릿 편집과 가져오기/내보내기는 계속 사용할 수 있습니다.');
  }, []);

  const showThumbnails = !thumbnailSafeMode;

  const handleThumbnailRenderError = useCallback((template: Template, error: Error) => {
    const message = error.message || '썸네일 렌더링에 실패했습니다.';
    if (shouldLogTemplateDiagnostics()) {
      console.error('[Template thumbnail] render failed', {
        templateId: template.id,
        templateName: template.name,
        layerIds: template.layers.map((layer) => `${layer.id}:${layer.type}`),
        error: message,
        stack: error.stack,
      });
    }
    setThumbnailRefreshErrors((current) => ({ ...current, [template.id]: message }));
    setThumbnailSafeMode(true);
    setIgnoreThumbnailCache(true);
    window.localStorage.setItem(noThumbnailModeStorageKey, '1');
  }, []);

  useEffect(() => {
    if (!shouldLogTemplateDiagnostics()) return;
    console.debug('[Template page] opened', {
      templateCount: storedTemplates.length,
      templateIds: storedTemplates.map((template) => template.id),
      thumbnailObjectUrlCount: Object.keys(thumbnailObjectUrls).length,
      noThumbnailMode: thumbnailSafeMode,
    });
  }, [storedTemplates, thumbnailObjectUrls, thumbnailSafeMode]);

  useEffect(() => {
    thumbnailObjectUrlsRef.current = thumbnailObjectUrls;
  }, [thumbnailObjectUrls]);

  useEffect(() => {
    return () => {
      Object.values(thumbnailObjectUrlsRef.current).forEach((entry) => URL.revokeObjectURL(entry.url));
    };
  }, []);

  const installThumbnailObjectUrl = useCallback((templateId: string, cacheKey: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const previousUrl = thumbnailObjectUrlsRef.current[templateId]?.url;
    setThumbnailObjectUrls((current) => ({ ...current, [templateId]: { cacheKey, url } }));
    thumbnailObjectUrlsRef.current = { ...thumbnailObjectUrlsRef.current, [templateId]: { cacheKey, url } };
    if (previousUrl && previousUrl !== url) {
      window.setTimeout(() => URL.revokeObjectURL(previousUrl), 0);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (ignoreThumbnailCache || !showThumbnails) return () => {
      cancelled = true;
    };
    storedTemplates.forEach((template) => {
      const cacheKey = template.thumbnailCacheKey ?? template.thumbnailStaleCacheKey;
      if (!cacheKey) return;
      if (thumbnailObjectUrls[template.id]?.cacheKey === cacheKey) return;
      const loadKey = `${template.id}:${cacheKey}`;
      if (loadingThumbnailKeysRef.current.has(loadKey)) return;
      loadingThumbnailKeysRef.current.add(loadKey);
      void loadTemplateThumbnailBlob(template.id, cacheKey)
        .then((blob) => {
          if (!blob || cancelled) return;
          installThumbnailObjectUrl(template.id, cacheKey, blob);
        })
        .catch((error) => {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : '썸네일 캐시를 불러오지 못했습니다.';
          if (shouldLogTemplateDiagnostics()) {
            console.warn('[Template thumbnail] cache load failed', {
              templateId: template.id,
              templateName: template.name,
              cacheKey,
              error: message,
              stack: error instanceof Error ? error.stack : undefined,
            });
          }
          setThumbnailRefreshErrors((current) => ({ ...current, [template.id]: message }));
        })
        .finally(() => {
          loadingThumbnailKeysRef.current.delete(loadKey);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [ignoreThumbnailCache, installThumbnailObjectUrl, showThumbnails, storedTemplates, thumbnailObjectUrls]);

  function waitForPreviewFrame() {
    return new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }

  async function refreshTemplateThumbnail(template: Template, options: { silent?: boolean } = {}) {
    if (template.deletedAt || refreshingThumbnailIds.includes(template.id)) return false;
    const latestTemplate = normalizeTemplateForRender(useProjectStore.getState().templates.find((candidate) => candidate.id === template.id) ?? template);
    const previousRefreshKey = thumbnailRefreshKeys[template.id];
    const oldCacheKey = latestTemplate.thumbnailCacheKey;
    if (shouldLogTemplateDiagnostics()) {
      console.debug('[Template thumbnail] manual refresh requested', {
        templateId: latestTemplate.id,
        templateName: latestTemplate.name,
        loadedTemplateUpdatedAt: latestTemplate.updatedAt,
        oldThumbnailCacheKey: oldCacheKey,
        rendererVersion: TEMPLATE_THUMBNAIL_RENDER_VERSION,
      });
    }
    setRefreshingThumbnailIds((current) => (current.includes(template.id) ? current : [...current, template.id]));
    setThumbnailRefreshErrors((current) => {
      const next = { ...current };
      delete next[template.id];
      return next;
    });
    updateTemplateThumbnail(template.id, {
      thumbnailStatus: 'generating',
      thumbnailError: undefined,
      thumbnailStaleCacheKey: oldCacheKey,
    });
    try {
      await waitForPreviewFrame();
      const result = await regenerateTemplateThumbnail(latestTemplate, {
        oldCacheKey,
        dpi: 150,
      });
      if (result.status !== 'ready' || !result.blob || !result.cacheKey || result.blob.size <= 0) {
        throw new Error(result.error ?? '썸네일 생성에 실패했습니다.');
      }
      const nextCacheKey = result.cacheKey;
      const nextBlob = (await loadTemplateThumbnailBlob(template.id, nextCacheKey)) ?? result.blob;

      installThumbnailObjectUrl(template.id, nextCacheKey, nextBlob);
      setThumbnailRefreshKeys((current) => ({ ...current, [template.id]: nextCacheKey }));
      updateTemplateThumbnail(template.id, {
        previewVersion: nextCacheKey,
        thumbnailCacheKey: nextCacheKey,
        thumbnailVersion: result.version,
        thumbnailUpdatedAt: result.updatedAt,
        thumbnailStatus: 'ready',
        thumbnailStaleCacheKey: undefined,
        thumbnailError: undefined,
      });
      if (oldCacheKey && oldCacheKey !== nextCacheKey) {
        void deleteTemplateThumbnailBlob(template.id, oldCacheKey).catch(() => undefined);
      }
      await waitForPreviewFrame();
      if (!options.silent) setMessage(`썸네일을 새로고침했습니다: ${latestTemplate.name}`);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '썸네일 생성에 실패했습니다.';
      setThumbnailRefreshKeys((current) => {
        if (previousRefreshKey === undefined) {
          const next = { ...current };
          delete next[template.id];
          return next;
        }
        return { ...current, [template.id]: previousRefreshKey };
      });
      updateTemplateThumbnail(template.id, {
        thumbnailStatus: oldCacheKey ? 'failed' : 'failed',
        thumbnailCacheKey: oldCacheKey,
        thumbnailStaleCacheKey: oldCacheKey,
        thumbnailError: errorMessage,
      });
      setThumbnailRefreshErrors((current) => ({ ...current, [template.id]: errorMessage }));
      if (!options.silent) setMessage(`썸네일 생성에 실패했습니다: ${latestTemplate.name}`);
      return false;
    } finally {
      setRefreshingThumbnailIds((current) => current.filter((id) => id !== template.id));
    }
  }

  async function refreshAllTemplateThumbnails() {
    if (isRefreshingAllThumbnails) return;
    const targets = visibleTemplates.filter((template) => !template.deletedAt);
    if (targets.length === 0) {
      setMessage('새로고침할 템플릿이 없습니다.');
      return;
    }
    let failed = 0;
    setRefreshAllProgress({ done: 0, total: targets.length, failed: 0 });
    setMessage(`썸네일 생성 중... 0 / ${targets.length}`);
    for (let index = 0; index < targets.length; index += 1) {
      const ok = await refreshTemplateThumbnail(targets[index], { silent: true });
      if (!ok) failed += 1;
      const done = index + 1;
      setRefreshAllProgress({ done, total: targets.length, failed });
      setMessage(`썸네일 생성 중... ${done} / ${targets.length}`);
      await waitForPreviewFrame();
    }
    setRefreshAllProgress(null);
    setMessage(failed > 0 ? `썸네일 새로고침 완료: ${targets.length - failed}개 성공, ${failed}개 실패` : `전체 썸네일을 새로고침했습니다: ${targets.length}개`);
  }

  async function handleTemplateFile(file: File) {
    try {
      if (file.name.toLowerCase().endsWith('.zip')) {
        const result = await parseTemplateBundle(file);
        addTemplate(result.template);
        setSelectedId(result.template.id);
        setShowTrash(false);
        setMessage(`이미지 포함 템플릿 bundle을 불러왔습니다: ${result.template.name}`);
        return;
      }
      const result = await parseTemplateFile(file);
      if (!result.ok || !result.template) {
        setMessage(result.errors.join(' '));
        return;
      }
      addTemplate(result.template);
      setSelectedId(result.template.id);
      setShowTrash(false);
      setMessage(`JSON 템플릿을 호환 모드로 불러왔습니다. 공유용은 ZIP bundle을 권장합니다: ${result.template.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '템플릿 가져오기에 실패했습니다.');
    }
  }

  async function handleBundleDownloadSelected() {
    if (!selectedTemplate || selectedTemplate.deletedAt) return;
    const { blob, manifest } = await buildTemplateBundle(selectedTemplate);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeFileName(selectedTemplate.name)}.template.zip`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage(
      manifest.warnings.length
        ? `템플릿 다운로드를 완료했습니다. 경고: ${manifest.warnings.join(' ')}`
        : `이미지 포함 템플릿 ZIP을 다운로드했습니다: ${selectedTemplate.name}`,
    );
  }

  function editTemplate(templateId: string) {
    setSelectedId(templateId);
    navigate(`/stickers/template-editor?templateId=${encodeURIComponent(templateId)}`);
  }

  function handleDeleteSelected() {
    if (!selectedTemplate || selectedTemplate.builtIn || selectedTemplate.deletedAt) return;
    const ok = window.confirm(`템플릿을 삭제된 템플릿으로 이동할까요?\n\n${selectedTemplate.name}`);
    if (!ok) return;
    deleteTemplate(selectedTemplate.id);
    const nextTemplate = visibleTemplates.find((template) => template.id !== selectedTemplate.id);
    setSelectedId(nextTemplate?.id ?? '');
    setMessage(`템플릿을 삭제된 템플릿으로 이동했습니다: ${selectedTemplate.name}`);
  }

  function handleRestore(template: Template) {
    restoreTemplate(template.id);
    setSelectedId(template.id);
    setShowTrash(false);
    setMessage(`템플릿을 복원했습니다: ${template.name}`);
  }

  function handlePermanentDelete(template: Template) {
    const ok = window.confirm(`템플릿을 영구 삭제할까요?\n\n${template.name}\n\n이 작업은 되돌릴 수 없습니다.`);
    if (!ok) return;
    permanentlyDeleteTemplate(template.id);
    if (selectedId === template.id) setSelectedId('');
    setMessage(`템플릿을 영구 삭제했습니다: ${template.name}`);
  }

  function openBackTemplatePrint(template: Template) {
    setSelectedId(template.id);
    setBackPrintTemplate(template);
    setBackPrintMode('pages');
    setBackPrintQuantity(1);
  }

  function printBackTemplatePages() {
    const printArea = backPrintRef.current;
    if (!printArea || !backPrintTemplate) return;
    const printWindow = window.open('', 'zaparoo-back-template-print', 'width=1200,height=900');
    if (!printWindow) {
      window.print();
      return;
    }
    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
      .map((node) => node.outerHTML)
      .join('\n');
    printWindow.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${backPrintTemplate.name} back template print</title>
  ${styles}
</head>
<body>
  <div class="print-output-area">${printArea.innerHTML}</div>
</body>
</html>`);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 300);
  }

  const displayedTemplates = showTrash ? deletedTemplates : visibleTemplates;

  return (
    <>
      <PageHeader
        eyebrow="Template"
        title="템플릿 관리"
        description="Template Editor에서 만든 앞면/뒷면 템플릿을 썸네일로 관리하고, 이미지가 포함된 ZIP bundle로 공유합니다."
      />

      <section className="mb-5 rounded-lg border border-line bg-white p-4 shadow-surface">
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700">
            <Upload className="h-4 w-4" />
            템플릿 업로드
            <input
              type="file"
              accept=".zip,application/zip,.json,application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleTemplateFile(file);
                event.currentTarget.value = '';
              }}
            />
          </label>
          <button
            type="button"
            disabled={!selectedTemplate || Boolean(selectedTemplate.deletedAt)}
            onClick={() => void handleBundleDownloadSelected()}
            className="inline-flex items-center gap-2 rounded-md border border-cyan-200 px-3 py-2 text-sm font-medium text-cyan-800 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            템플릿 다운로드
          </button>
          <button
            type="button"
            disabled={!selectedTemplate || selectedTemplate.builtIn || Boolean(selectedTemplate.deletedAt)}
            onClick={handleDeleteSelected}
            className="inline-flex items-center gap-2 rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            삭제
          </button>
          <button
            type="button"
            onClick={() => setShowTrash((value) => !value)}
            className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${showTrash ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-line text-neutral-800 hover:bg-neutral-100'}`}
          >
            <RotateCcw className="h-4 w-4" />
            삭제된 템플릿 {deletedTemplates.length}
          </button>
          <button
            type="button"
            disabled={visibleTemplates.length === 0 || isRefreshingAllThumbnails}
            onClick={() => void refreshAllTemplateThumbnails()}
            className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
            title="전체 썸네일 새로고침"
          >
            {isRefreshingAllThumbnails ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            전체 썸네일 새로고침
          </button>
          <button
            type="button"
            onClick={() => {
              if (thumbnailSafeMode) {
                setThumbnailSafeMode(false);
                setIgnoreThumbnailCache(false);
                window.localStorage.removeItem(noThumbnailModeStorageKey);
                setMessage('썸네일 표시를 다시 활성화했습니다.');
              } else {
                openWithoutThumbnails();
              }
            }}
            className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-100"
          >
            {thumbnailSafeMode ? '썸네일 다시 표시' : '썸네일 없이 열기'}
          </button>
          <label className="ml-auto flex min-w-[220px] items-center gap-2 text-xs">
            <span className="font-medium">썸네일 크기</span>
            <input
              type="range"
              min={140}
              max={260}
              value={thumbnailSize}
              onChange={(event) => setThumbnailSize(Number(event.target.value))}
              className="w-full accent-blue-600"
            />
          </label>
        </div>
        {refreshAllProgress && (
          <p className="mt-3 text-sm font-medium text-blue-700">
            썸네일 생성 중... {refreshAllProgress.done} / {refreshAllProgress.total}
            {refreshAllProgress.failed > 0 ? ` · 실패 ${refreshAllProgress.failed}` : ''}
          </p>
        )}
        {message && <p className="mt-3 text-sm text-neutral-600">{message}</p>}
      </section>

      <section className="rounded-lg border border-line bg-white p-4 shadow-surface">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">{showTrash ? '삭제된 템플릿' : '템플릿 목록'}</h3>
            <p className="text-sm text-neutral-500">
              썸네일을 클릭해 선택하고, 편집 버튼으로 Template Editor에서 바로 열 수 있습니다.
            </p>
          </div>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
            {displayedTemplates.length}개 템플릿
          </span>
        </div>

        <RouteErrorBoundary
          message="템플릿 목록을 불러오지 못했습니다."
          bypassLabel="썸네일 없이 열기"
          onBypass={openWithoutThumbnails}
          resetKey={`${showTrash}:${displayedTemplates.length}:${ignoreThumbnailCache}:${thumbnailSafeMode}`}
        >
        {displayedTemplates.length === 0 ? (
          <div className="rounded-md border border-dashed border-line px-3 py-8 text-center text-sm text-neutral-500">
            <p>{showTrash ? '삭제된 템플릿이 없습니다.' : '템플릿이 없습니다.'}</p>
            {!showTrash ? (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate('/stickers/template-editor')}
                  className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  새 템플릿 만들기
                </button>
                <label className="inline-flex cursor-pointer items-center rounded-md border border-line px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-100">
                  템플릿 가져오기
                  <input
                    type="file"
                    accept=".zip,application/zip,.json,application/json"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void handleTemplateFile(file);
                      event.currentTarget.value = '';
                    }}
                  />
                </label>
              </div>
            ) : null}
          </div>
        ) : (
          <div
            className="grid items-stretch gap-4"
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(thumbnailSize + 36, 190)}px, 1fr))` }}
          >
            {displayedTemplates.map((template) => {
              const renderTemplate = normalizeTemplateForRender(template);
              const templateId = template.id || renderTemplate.id;
              const slotCount = renderTemplate.slots?.length ?? renderTemplate.layers.filter((layer) => layer.type === 'slot').length;
              const selected = templateId === selectedTemplate?.id;
              const desiredThumbnailCacheKey = ignoreThumbnailCache || !showThumbnails ? undefined : template.thumbnailCacheKey ?? template.thumbnailStaleCacheKey;
              const cachedThumbnail = thumbnailObjectUrls[templateId];
              const thumbnailUrl = showThumbnails && cachedThumbnail && cachedThumbnail.cacheKey === desiredThumbnailCacheKey ? cachedThumbnail.url : undefined;
              const thumbnailStale = template.thumbnailStatus === 'stale' || (template.thumbnailVersion !== undefined && template.thumbnailVersion !== TEMPLATE_THUMBNAIL_RENDER_VERSION);
              const previewKey = `${templateId}:${template.previewVersion ?? template.updatedAt ?? ''}:${thumbnailRefreshKeys[templateId] ?? ''}:${desiredThumbnailCacheKey ?? ''}:${renderTemplate.layers.length}:${ignoreThumbnailCache ? 'live' : 'cache'}`;
              const thumbnailRefreshing = refreshingThumbnailIds.includes(templateId);
              const thumbnailError = thumbnailRefreshErrors[templateId] ?? template.thumbnailError;
              const thumbnailStatusLabel = thumbnailRefreshing ? '생성 중' : thumbnailError ? '실패' : thumbnailStale ? 'stale' : template.thumbnailStatus ?? 'ready';
              return (
                <div
                  key={templateId}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(templateId)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    setSelectedId(templateId);
                  }}
                  className={`flex h-full flex-col rounded-md border p-3 text-left transition ${
                    selected
                      ? 'border-blue-600 bg-blue-50 shadow-[0_0_0_3px_rgba(37,99,235,0.18)]'
                      : 'border-line bg-white hover:border-blue-300 hover:bg-blue-50/40'
                  }`}
                >
                  <div key={previewKey} className="mx-auto w-full" style={{ maxWidth: thumbnailSize + 16 }}>
                    <div className="relative">
                      <RouteErrorBoundary
                        compact
                        message="템플릿 썸네일을 불러오지 못했습니다."
                        fallback={<TemplateThumbnailPlaceholder size={thumbnailSize} />}
                        onError={(error) => handleThumbnailRenderError(renderTemplate, error)}
                        resetKey={previewKey}
                      >
                        <TemplateThumbnail
                          template={renderTemplate}
                          size={thumbnailSize}
                          thumbnailUrl={thumbnailUrl}
                          thumbnailCacheKey={desiredThumbnailCacheKey}
                          disablePreview={!showThumbnails}
                        />
                      </RouteErrorBoundary>
                      {thumbnailRefreshing && (
                        <div className="absolute inset-0 flex items-center justify-center rounded bg-white/70 text-blue-700">
                          <Loader2 className="h-6 w-6 animate-spin" />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-1 flex-col justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-2 font-semibold text-neutral-950">{renderTemplate.name}</span>
                        <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
                          {formatTemplateType(renderTemplate)}
                        </span>
                      </div>
                      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-neutral-600">
                        <div>
                          <dt className="font-semibold text-neutral-500">슬롯</dt>
                          <dd>{slotCount}</dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-neutral-500">방향</dt>
                          <dd>{renderTemplate.canvas.orientation === 'landscape' ? '가로' : '세로'}</dd>
                        </div>
                        <div className="col-span-2">
                          <dt className="font-semibold text-neutral-500">{showTrash ? '삭제일' : '업데이트'}</dt>
                          <dd className="truncate">{showTrash ? template.deletedAt ?? '-' : template.updatedAt ?? '-'}</dd>
                        </div>
                        {!showTrash && (
                          <div className="col-span-2">
                            <dt className="font-semibold text-neutral-500">썸네일</dt>
                            <dd className={`truncate ${thumbnailError ? 'text-red-600' : thumbnailStale ? 'text-amber-700' : 'text-neutral-600'}`}>
                              {thumbnailStatusLabel}
                            </dd>
                          </div>
                        )}
                      </dl>
                    </div>
                    {showTrash ? (
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => handleRestore(template)} className="rounded-md border border-blue-200 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">
                          복원
                        </button>
                        <button type="button" onClick={() => handlePermanentDelete(template)} className="rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50">
                          영구 삭제
                        </button>
                      </div>
                    ) : (
                      <div className="grid gap-2">
                        <button
                          type="button"
                          disabled={thumbnailRefreshing || isRefreshingAllThumbnails}
                          title="이 템플릿 썸네일 새로고침"
                          onClick={(event) => {
                            event.stopPropagation();
                            void refreshTemplateThumbnail(template);
                          }}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-line px-3 py-2 text-center text-sm font-medium hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {thumbnailRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                          썸네일 새로고침
                        </button>
                        {template.type === 'back' ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openBackTemplatePrint(template);
                            }}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-line px-3 py-2 text-center text-sm font-medium hover:bg-neutral-50"
                          >
                            <Printer className="h-4 w-4" />
                            Print Back
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            editTemplate(templateId);
                          }}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-center text-sm font-medium text-white hover:bg-blue-700"
                        >
                          <Edit3 className="h-4 w-4" />
                          편집
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </RouteErrorBoundary>
      </section>

      {backPrintTemplate ? (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/60 p-5">
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <p className="font-semibold">Back template direct print</p>
                <p className="text-xs text-neutral-500">{backPrintTemplate.name}</p>
              </div>
              <button type="button" onClick={() => setBackPrintTemplate(undefined)} className="rounded-md border border-line px-3 py-2 text-sm">
                닫기
              </button>
            </div>
            <div className="grid min-h-0 gap-4 overflow-auto p-4 lg:grid-cols-[280px_minmax(0,1fr)]">
              <aside className="space-y-4 rounded-md border border-line bg-neutral-50 p-3 text-sm">
                <label className="block">
                  <span className="mb-1 block font-medium">Quantity mode</span>
                  <select value={backPrintMode} onChange={(event) => setBackPrintMode(event.target.value as 'pages' | 'cards')} className="w-full rounded-md border border-line px-2 py-2">
                    <option value="pages">Pages</option>
                    <option value="cards">Cards</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block font-medium">{backPrintMode === 'pages' ? 'Pages' : 'Cards'}</span>
                  <input
                    type="number"
                    min={1}
                    value={backPrintQuantity}
                    onChange={(event) => setBackPrintQuantity(Math.max(1, Number(event.target.value) || 1))}
                    className="w-full rounded-md border border-line px-2 py-2"
                  />
                </label>
                <div className="rounded-md border border-line bg-white p-3">
                  <p className="font-medium">Preview</p>
                  <p className="mt-1 text-neutral-600">{backPrintCardCount} backs · {backPrintPageCount} A4 page(s)</p>
                  <p className="mt-1 text-xs text-neutral-500">10 backs per page, using the existing 2 x 5 sheet layout.</p>
                </div>
                <button type="button" onClick={printBackTemplatePages} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800">
                  <Printer className="h-4 w-4" />
                  Print
                </button>
              </aside>
              <div ref={backPrintRef} className="print-output-area space-y-5">
                {backPrintSheetPairs.map((pair) => (
                  <PrintSheetPreview
                    key={pair.sheetIndex}
                    title={`Back template page ${pair.sheetIndex + 1}`}
                    side="back"
                    placements={pair.backPlacements}
                    cardsById={backPrintCardsById}
                    categoriesById={categoriesById}
                    assetsById={assetsById}
                    templates={storedTemplates}
                    settings={exportSettings}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
