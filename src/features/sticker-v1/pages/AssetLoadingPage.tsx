import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, FolderOpen, Images, RefreshCw, Trash2 } from 'lucide-react';
import { PageHeader } from '@sticker-v1/components/common/PageHeader';
import { assetKinds } from '@sticker-v1/mock/assetKinds';
import { buildAssetLibraryFromSources } from '@sticker-v1/services/assets/assetIndex';
import { clearAssetLibraryCache, loadAssetLibraryCache, saveAssetLibraryCache } from '@sticker-v1/services/assets/assetIndexCache';
import {
  addDirectoryAssetSource,
  addFileListAssetSource,
  getSavedAssetSourceMetadata,
  isDirectoryPickerAbort,
  refreshAssetSource,
  removeAssetSource,
  supportsDirectoryHandlePersistence,
  updateAssetSourceRole,
  updateAssetSourceScanMode,
} from '@sticker-v1/services/assets/assetSources';
import { assetSourceRoleLabel, assetSourceRoleOptions } from '@sticker-v1/services/assets/assetFolderRoles';
import {
  assetKindToSourceGroup,
  assetSourceGroupDescriptions,
  assetSourceGroupForSource,
  assetSourceGroupLabels,
  filterAssetLibraryByEnabledGroups,
  isAssetKindEnabled,
  isAssetSourceEnabled,
  loadAssetSourceGroupSettings,
  updateAssetSourceGroupEnabled,
  type AssetSourceGroup,
} from '@sticker-v1/services/assets/assetSourceGroups';
import { mergeAssetsIntoLibrary } from '@sticker-v1/services/assets/usedImageCache';
import { useProjectStore } from '@sticker-v1/store/projectStore';
import type { AssetKind, AssetLibrary, AssetSource, AssetSourceScanMode } from '@sticker-v1/types';

const folderInputProps = { webkitdirectory: '', directory: '' } as Record<string, string>;
const groupOrder: AssetSourceGroup[] = ['front', 'logo', 'background'];
const missingSourcePathLabel = '경로 정보 없음';

interface AssetLoadStatus {
  phase: 'idle' | 'scanning' | 'indexing' | 'finished' | 'failed';
  message: string;
  currentFolder?: string;
  currentFile?: string;
  indexed?: number;
  skipped?: number;
}

function summarizeSourceFiles(source: AssetSource) {
  const total = source.files?.length ?? source.assetCount ?? 0;
  const indexed = source.assetCount ?? 0;
  return { indexed, skipped: Math.max(0, total - indexed) };
}

function firstSourceFile(source?: AssetSource) {
  return source?.files?.[0]?.name;
}

function enabledSourceCount(sources: AssetSource[]) {
  return sources.filter((source) => source.status !== 'disabled' && source.files?.length).length;
}

function sourceStatusAfterGroupChange(source: AssetSource, group: AssetSourceGroup, enabled: boolean): AssetSource {
  const sourceGroup = assetSourceGroupForSource(source);
  if (!sourceGroup && group === 'logo' && enabled && source.scanMode === 'launchbox-optimized') return { ...source, status: 'needs-refresh', files: undefined };
  if (sourceGroup !== group) return source;
  if (!enabled) return { ...source, status: 'disabled', files: undefined, assetCount: 0 };
  if (source.status === 'disabled') return { ...source, status: 'needs-refresh' };
  return source;
}

function sourceCanRefresh(source: AssetSource) {
  return source.status !== 'disabled' && source.persistence === 'directory-handle';
}

function filePathHint(file: File | undefined) {
  if (!file) return '';
  const fileWithPath = file as (File & { webkitRelativePath?: string; path?: string }) | undefined;
  const desktopPath = typeof window !== 'undefined' ? window.zaparooDesktop?.getPathForFile?.(file) : undefined;
  return desktopPath || fileWithPath?.path || fileWithPath?.webkitRelativePath || file.name || '';
}

function parentPath(path: string | undefined) {
  if (!path) return '';
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return separatorIndex > 0 ? path.slice(0, separatorIndex) : '';
}

function pathCandidatesForSource(source: AssetSource) {
  return [
    source.folderPath,
    source.path,
    source.rootPath,
    source.directoryPath,
    source.location,
    source.config?.folderPath,
    source.config?.path,
    source.config?.rootPath,
    source.config?.directoryPath,
    source.config?.location,
  ].map((candidate) => (typeof candidate === 'string' ? candidate.trim() : ''));
}

function isUsefulSourcePath(path: string, sourceLabel: string) {
  if (!path || path === sourceLabel) return false;
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.startsWith('/') || path.includes('/') || path.includes('\\');
}

function getAssetSourceFolderPath(source: AssetSource) {
  const metadataPath = pathCandidatesForSource(source).find((path) => isUsefulSourcePath(path, source.label));
  if (metadataPath) return metadataPath;
  const firstFilePath = source.files?.map(filePathHint).find(Boolean);
  const runtimePath = parentPath(firstFilePath);
  return isUsefulSourcePath(runtimePath, source.label) ? runtimePath : missingSourcePathLabel;
}

function hasAssetSourceFolderPath(source: AssetSource) {
  return getAssetSourceFolderPath(source) !== missingSourcePathLabel;
}

function formatSourceScanTime(source: AssetSource) {
  return source.lastLoadedAt ? new Date(source.lastLoadedAt).toLocaleString() : '-';
}

export function AssetLoadingPage() {
  const { assetLibrary, setAssetLibrary } = useProjectStore();
  const assetLibraryRef = useRef(assetLibrary);
  const [sources, setSources] = useState<AssetSource[]>(() => getSavedAssetSourceMetadata());
  const [groupSettings, setGroupSettings] = useState(() => loadAssetSourceGroupSettings());
  const [showEmptyGroups, setShowEmptyGroups] = useState(false);
  const [newSourceScanMode, setNewSourceScanMode] = useState<AssetSourceScanMode>('launchbox-optimized');
  const [refreshingSourceId, setRefreshingSourceId] = useState<string>();
  const [loadStatus, setLoadStatus] = useState<AssetLoadStatus>({
    phase: 'idle',
    message: '저장된 이미지 인덱스를 확인하는 중입니다.',
  });
  const indexedAssetCount = Object.keys(assetLibrary?.assetsById ?? {}).length;
  const connectedSources = enabledSourceCount(sources);
  const visibleAssetKinds = useMemo(
    () =>
      assetKinds.filter((kind) => {
        if (!isAssetKindEnabled(kind, groupSettings)) return false;
        return showEmptyGroups || (assetLibrary?.folders[kind]?.files.length ?? 0) > 0;
      }),
    [assetLibrary?.folders, groupSettings, showEmptyGroups],
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !['localhost', '127.0.0.1'].includes(window.location.hostname)) return;
    sources
      .filter((source) => !hasAssetSourceFolderPath(source))
      .forEach((source) => {
        console.info('[AssetLoadingPage] asset source has no displayable folder path', {
          id: source.id,
          label: source.label,
          keys: Object.keys(source),
          source,
        });
      });
  }, [sources]);

  useEffect(() => {
    assetLibraryRef.current = assetLibrary;
  }, [assetLibrary]);

  const rebuildLibrary = useCallback(
    (nextSources: AssetSource[]) => {
      const activeSources = nextSources.filter((source) => source.files?.length && isAssetSourceEnabled(source, groupSettings));
      const nextLibrary = buildAssetLibraryFromSources(activeSources);
      setAssetLibrary(nextLibrary);
      void saveAssetLibraryCache(nextLibrary);
      const indexed = Object.keys(nextLibrary.assetsById).length;
      const skipped = activeSources.reduce((sum, source) => sum + summarizeSourceFiles(source).skipped, 0);
      setLoadStatus({
        phase: 'finished',
        message: `활성화된 이미지 ${indexed}개 인덱싱을 완료했습니다.`,
        indexed,
        skipped,
      });
    },
    [groupSettings, setAssetLibrary],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadCachedIndex() {
      try {
        const cachedLibrary = await loadAssetLibraryCache();
        if (cancelled) return;
        if (cachedLibrary) {
          const runtimeAssets = Object.values(assetLibraryRef.current?.assetsById ?? {}).filter((asset) => asset.objectUrl);
          const merged = filterAssetLibraryByEnabledGroups(mergeAssetsIntoLibrary(cachedLibrary, runtimeAssets), groupSettings);
          setAssetLibrary(merged);
          setLoadStatus({
            phase: 'finished',
            message: `저장된 이미지 인덱스 ${Object.keys(merged.assetsById).length}개를 불러왔습니다. 비활성 그룹은 로딩에서 제외했습니다.`,
            indexed: Object.keys(merged.assetsById).length,
            skipped: 0,
          });
          return;
        }
        setLoadStatus({
          phase: 'idle',
          message: '저장된 이미지 인덱스가 없습니다. 폴더를 추가하거나 필요한 폴더만 다시 스캔하세요.',
        });
      } catch (error) {
        if (cancelled) return;
        setLoadStatus({
          phase: 'idle',
          message: error instanceof Error ? `저장된 이미지 인덱스를 불러오지 못했습니다. ${error.message}` : '저장된 이미지 인덱스를 불러오지 못했습니다.',
        });
      }
    }

    void loadCachedIndex();
    return () => {
      cancelled = true;
    };
  }, [groupSettings, setAssetLibrary]);

  async function handleDirectoryPicker() {
    setLoadStatus({ phase: 'scanning', message: '선택한 폴더를 스캔하는 중입니다.' });
    try {
      const source = await addDirectoryAssetSource({ scanMode: newSourceScanMode });
      if (!source) {
        setLoadStatus({ phase: 'idle', message: '폴더 선택이 취소되었습니다.' });
        return;
      }
      const nextSources = [...sources.filter((candidate) => candidate.id !== source.id), source];
      setSources(nextSources);
      if (source.status === 'disabled') {
        setLoadStatus({
          phase: 'finished',
          message: `${source.label}은(는) ${assetSourceRoleLabel(source.role)} 그룹이 비활성화되어 스캔을 건너뛰었습니다.`,
          indexed: indexedAssetCount,
          skipped: 0,
        });
        return;
      }
      const summary = summarizeSourceFiles(source);
      setLoadStatus({
        phase: 'indexing',
        message: `${source.label}의 이미지 파일을 인덱싱하는 중입니다.`,
        currentFolder: source.label,
        currentFile: firstSourceFile(source),
        indexed: summary.indexed,
        skipped: summary.skipped,
      });
      rebuildLibrary(nextSources);
    } catch (error) {
      if (isDirectoryPickerAbort(error)) {
        setLoadStatus({ phase: 'idle', message: '폴더 선택이 취소되었습니다.' });
        return;
      }
      setLoadStatus({
        phase: 'failed',
        message: error instanceof Error ? error.message : '폴더 인덱싱에 실패했습니다.',
      });
    }
  }

  async function handleFiles(fileList: FileList | null, label: string) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    setLoadStatus({ phase: 'scanning', message: `선택한 파일 ${files.length}개를 스캔하는 중입니다.`, currentFile: files[0]?.name });
    try {
      const source = addFileListAssetSource(files, label);
      const nextSources = [...sources.filter((candidate) => candidate.id !== source.id), source];
      setSources(nextSources);
      if (source.status === 'disabled') {
        setLoadStatus({
          phase: 'finished',
          message: `${assetSourceRoleLabel(source.role)} 그룹이 비활성화되어 선택한 파일을 로딩하지 않았습니다.`,
          indexed: indexedAssetCount,
          skipped: files.length,
        });
        return;
      }
      const summary = summarizeSourceFiles(source);
      setLoadStatus({
        phase: 'indexing',
        message: `지원되는 이미지 ${summary.indexed}개를 인덱싱하는 중입니다.`,
        currentFolder: label,
        currentFile: firstSourceFile(source),
        indexed: summary.indexed,
        skipped: summary.skipped,
      });
      rebuildLibrary(nextSources);
    } catch (error) {
      setLoadStatus({
        phase: 'failed',
        message: error instanceof Error ? error.message : '이미지 파일 인덱싱에 실패했습니다.',
      });
    }
  }

  async function handleRemoveSource(sourceId: string) {
    await removeAssetSource(sourceId);
    const nextSources = sources.filter((source) => source.id !== sourceId);
    setSources(nextSources);
    rebuildLibrary(nextSources);
  }

  function handleSourceRoleChange(sourceId: string, role: AssetKind | 'mixed') {
    updateAssetSourceRole(sourceId, role);
    const nextSources = sources.map((source) => {
      if (source.id !== sourceId) return source;
      return { ...source, role, status: isAssetKindEnabled(role, groupSettings) ? ('needs-refresh' as const) : ('disabled' as const), files: undefined };
    });
    setSources(nextSources);
    setAssetLibrary(filterAssetLibraryByEnabledGroups(assetLibraryRef.current ?? emptyAssetLibrary(), groupSettings));
    setLoadStatus({
      phase: 'finished',
      message: '폴더 역할 설정을 저장했습니다. 변경된 역할은 폴더 다시 스캔을 실행하면 반영됩니다.',
      indexed: indexedAssetCount,
      skipped: 0,
    });
  }

  function handleSourceScanModeChange(sourceId: string, scanMode: AssetSourceScanMode) {
    updateAssetSourceScanMode(sourceId, scanMode);
    const nextSources = sources.map((source) => (source.id === sourceId ? { ...source, scanMode, status: source.status === 'disabled' ? ('disabled' as const) : ('needs-refresh' as const), files: undefined } : source));
    setSources(nextSources);
    setLoadStatus({
      phase: 'finished',
      message: '스캔 모드를 저장했습니다. 폴더 다시 스캔을 실행하면 적용됩니다.',
      indexed: indexedAssetCount,
      skipped: 0,
    });
  }

  async function handleRefreshSource(sourceId: string) {
    const source = sources.find((candidate) => candidate.id === sourceId);
    if (source && !sourceCanRefresh(source)) {
      setLoadStatus({ phase: 'idle', message: source.status === 'disabled' ? '비활성화된 그룹은 스캔하지 않습니다. 먼저 그룹을 켜세요.' : '이 소스는 다시 연결이 필요합니다.' });
      return;
    }
    setRefreshingSourceId(sourceId);
    setSources((current) => current.map((candidate) => (candidate.id === sourceId ? { ...candidate, status: 'scanning' as const } : candidate)));
    setLoadStatus({ phase: 'scanning', message: `${source?.label ?? '이미지 소스'}를 다시 스캔하는 중입니다.`, currentFolder: source?.label });
    try {
      const refreshed = await refreshAssetSource(sourceId);
      if (!refreshed) return;
      const nextSources = sources.map((candidate) => (candidate.id === sourceId ? refreshed : candidate));
      setSources(nextSources);
      if (refreshed.status === 'disabled') {
        setLoadStatus({ phase: 'finished', message: `${refreshed.label}은(는) 비활성화된 그룹이라 스캔을 건너뛰었습니다.`, indexed: indexedAssetCount, skipped: 0 });
        return;
      }
      const summary = summarizeSourceFiles(refreshed);
      setLoadStatus({
        phase: 'indexing',
        message: `${refreshed.label}를 다시 인덱싱하는 중입니다.`,
        currentFolder: refreshed.label,
        currentFile: firstSourceFile(refreshed),
        indexed: summary.indexed,
        skipped: summary.skipped,
      });
      rebuildLibrary(nextSources);
    } catch (error) {
      setLoadStatus({
        phase: 'failed',
        message: error instanceof Error ? error.message : '이미지 소스 다시 스캔에 실패했습니다.',
      });
      setSources((current) =>
        current.map((candidate) =>
          candidate.id === sourceId
            ? { ...candidate, status: 'error' as const, scanError: error instanceof Error ? error.message : '이미지 소스 다시 스캔에 실패했습니다.' }
            : candidate,
        ),
      );
    } finally {
      setRefreshingSourceId(undefined);
    }
  }

  async function handleGroupToggle(group: AssetSourceGroup, enabled: boolean) {
    const nextSettings = updateAssetSourceGroupEnabled(group, enabled);
    setGroupSettings(nextSettings);
    const nextSources = sources.map((source) => sourceStatusAfterGroupChange(source, group, enabled));
    setSources(nextSources);
    const cached = await loadAssetLibraryCache();
    const nextLibrary = cached ?? filterAssetLibraryByEnabledGroups(assetLibraryRef.current ?? emptyAssetLibrary(), nextSettings);
    setAssetLibrary(nextLibrary);
    setLoadStatus({
      phase: 'finished',
      message: enabled
        ? `${assetSourceGroupLabels[group]} 그룹을 켰습니다. 캐시가 없거나 오래된 소스는 Needs Refresh로 표시됩니다.`
        : `${assetSourceGroupLabels[group]} 그룹을 껐습니다. 스캔, 캐시 로딩, 매칭에서 제외됩니다.`,
      indexed: Object.keys(nextLibrary.assetsById).length,
      skipped: 0,
    });
  }

  async function clearThumbnailIndexCache() {
    const ok = window.confirm(
      '썸네일/이미지 인덱스 캐시를 비울까요?\n\n원본 이미지 파일과 폴더 소스 설정은 삭제되지 않습니다. 이후 폴더 다시 스캔으로 썸네일과 검색 인덱스를 재생성할 수 있습니다.',
    );
    if (!ok) return;
    await clearAssetLibraryCache();
    const emptyLibrary = emptyAssetLibrary();
    assetLibraryRef.current = emptyLibrary;
    setAssetLibrary(emptyLibrary);
    setLoadStatus({ phase: 'idle', message: '이미지 인덱스 캐시를 비웠습니다. 원본 파일과 폴더 소스는 유지됩니다. 필요하면 폴더 다시 스캔을 실행하세요.' });
  }

  async function copySourcePath(path: string) {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
      await navigator.clipboard?.writeText(path);
      setLoadStatus({ phase: 'finished', message: '폴더 경로를 클립보드에 복사했습니다.', indexed: indexedAssetCount, skipped: 0 });
    } catch {
      setLoadStatus({ phase: 'failed', message: '클립보드에 폴더 경로를 복사하지 못했습니다.' });
    }
  }

  function getSourceBadge(source: AssetSource) {
    if (source.status === 'disabled') {
      return { label: '비활성', className: 'bg-neutral-100 text-neutral-600' };
    }
    if (refreshingSourceId === source.id || source.status === 'scanning') {
      return { label: '스캔 중', className: 'bg-cyan-50 text-cyan-700' };
    }
    if (source.status === 'ready' || source.status === 'connected' || source.status === 'restored') {
      return { label: '준비됨', className: 'bg-green-50 text-green-700' };
    }
    if (source.status === 'needs-refresh' || source.status === 'needs-reconnect') {
      return { label: '다시 스캔 필요', className: 'bg-amber-50 text-amber-700' };
    }
    return { label: '오류', className: 'bg-red-50 text-red-700' };
  }

  return (
    <>
      <PageHeader
        eyebrow="Image Management"
        title="이미지 관리"
        description="카드 제작에 사용할 이미지 폴더와 LaunchBox 이미지 인덱스를 관리합니다. 메뉴 진입만으로 전체 재스캔하지 않고 저장된 캐시를 먼저 보여줍니다."
      />

      <section className="mb-5 rounded-lg border border-line bg-white p-5 shadow-surface">
        <div className="mb-4 rounded-md border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
          <p className="font-semibold">스캔 모드</p>
          <p className="mt-1">
            LaunchBox Images 루트를 추가할 때는 활성화된 그룹만 확인합니다. 기본값은 Front와 Background가 켜져 있고, Logo / Clear Logo는 빠른 로딩을 위해 꺼져 있습니다.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <label className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-white px-3 py-2">
              <input type="radio" name="new-source-scan-mode" checked={newSourceScanMode === 'launchbox-optimized'} onChange={() => setNewSourceScanMode('launchbox-optimized')} />
              LaunchBox 최적화 스캔
            </label>
            <label className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-white px-3 py-2">
              <input type="radio" name="new-source-scan-mode" checked={newSourceScanMode === 'manual-folder'} onChange={() => setNewSourceScanMode('manual-folder')} />
              수동 폴더 스캔
            </label>
          </div>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-3">
          {groupOrder.map((group) => {
            const enabled = groupSettings[group];
            const groupAssetCount = Object.values(assetLibrary?.assetsById ?? {}).filter((asset) => assetKindToSourceGroup(asset.kind) === group).length;
            return (
              <div key={group} className={`rounded-lg border p-3 ${enabled ? 'border-green-200 bg-green-50' : 'border-neutral-200 bg-neutral-50'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-neutral-900">{assetSourceGroupLabels[group]}</p>
                    <p className="mt-1 text-xs text-neutral-600">{assetSourceGroupDescriptions[group]}</p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={enabled} onChange={(event) => void handleGroupToggle(group, event.target.checked)} />
                    {enabled ? 'Enabled' : 'Disabled'}
                  </label>
                </div>
                <p className={`mt-2 text-xs ${enabled ? 'text-green-700' : 'text-neutral-600'}`}>
                  {enabled ? `${groupAssetCount}개 로드됨` : 'Disabled: skipped for faster loading'}
                </p>
                {group === 'logo' && !enabled ? <p className="mt-1 text-xs font-medium text-amber-700">Logo / Clear Logo는 기본으로 꺼져 있습니다.</p> : null}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-3">
          {supportsDirectoryHandlePersistence() ? (
            <button type="button" onClick={() => void handleDirectoryPicker()} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700">
              <FolderOpen className="h-4 w-4" />
              폴더 추가
            </button>
          ) : (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700">
              <FolderOpen className="h-4 w-4" />
              폴더 추가
              <input
                type="file"
                multiple
                className="hidden"
                {...folderInputProps}
                onChange={(event) => {
                  void handleFiles(event.target.files, '선택한 폴더');
                  event.currentTarget.value = '';
                }}
              />
            </label>
          )}

          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium">
            <Images className="h-4 w-4" />
            이미지 파일 추가
            <input
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(event) => {
                void handleFiles(event.target.files, '선택한 이미지 파일');
                event.currentTarget.value = '';
              }}
            />
          </label>

          <button type="button" onClick={() => { if (sources[0]) void handleRefreshSource(sources[0].id); }} disabled={!sources[0] || !sourceCanRefresh(sources[0])} className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium disabled:opacity-40">
            <RefreshCw className="h-4 w-4" />
            폴더 다시 스캔
          </button>
        </div>
        <p className="mt-3 text-sm text-neutral-600">로드된 이미지: {indexedAssetCount}개 / 활성 소스 {connectedSources}개</p>
        <div className="mt-3 rounded-md border border-line bg-neutral-50 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium text-neutral-800">{loadStatus.message}</span>
            <span className="text-xs uppercase text-neutral-500">{loadStatus.phase}</span>
          </div>
          {(loadStatus.currentFolder || loadStatus.currentFile) && (
            <p className="mt-2 text-xs text-neutral-600">
              {loadStatus.currentFolder ? `현재 폴더: ${loadStatus.currentFolder}` : ''}
              {loadStatus.currentFile ? ` / 현재 파일: ${loadStatus.currentFile}` : ''}
            </p>
          )}
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
            <div className={`h-full rounded-full ${loadStatus.phase === 'failed' ? 'bg-red-500' : loadStatus.phase === 'idle' ? 'bg-neutral-300' : 'bg-cyan-500'}`} style={{ width: loadStatus.phase === 'idle' ? '12%' : loadStatus.phase === 'finished' ? '100%' : '62%' }} />
          </div>
          {loadStatus.indexed !== undefined ? (
            <p className="mt-2 text-xs text-neutral-600">
              {loadStatus.indexed}개 파일 인덱스 완료{loadStatus.skipped ? `, 지원하지 않거나 제외된 파일 ${loadStatus.skipped}개` : ''}.
            </p>
          ) : null}
        </div>
      </section>

      <section className="mb-5 rounded-lg border border-line bg-white p-5 shadow-surface">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">썸네일 / 인덱스 유지관리</h3>
            <p className="mt-1 text-sm text-neutral-600">폴더 스캔, 썸네일 생성, 이미지 메타데이터 변경 결과는 자동으로 캐시에 저장됩니다.</p>
            <p className="mt-1 text-sm text-neutral-600">캐시 비우기는 썸네일이 깨졌거나 폴더 이동/삭제 후 검색 결과가 오래된 경우에만 사용하는 유지관리 작업입니다. 원본 이미지와 폴더 소스 설정은 삭제하지 않습니다.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void clearThumbnailIndexCache()} className="rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50">캐시 비우기</button>
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-md bg-neutral-50 p-3 text-sm"><p className="text-xs text-neutral-500">인덱스 항목</p><p className="font-semibold">{indexedAssetCount}</p></div>
          <div className="rounded-md bg-neutral-50 p-3 text-sm"><p className="text-xs text-neutral-500">소스 수</p><p className="font-semibold">{sources.length}</p></div>
          <div className="rounded-md bg-neutral-50 p-3 text-sm"><p className="text-xs text-neutral-500">캐시 위치</p><p className="font-semibold">IndexedDB</p></div>
        </div>
      </section>

      <section className="mb-5 rounded-lg border border-line bg-white p-5 shadow-surface">
        <h3 className="text-base font-semibold">폴더 소스</h3>
        <div className="mt-3 overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-neutral-500">
                <th className="border-b border-line px-2 py-2">폴더</th>
                <th className="border-b border-line px-2 py-2">역할</th>
                <th className="border-b border-line px-2 py-2">스캔 모드</th>
                <th className="border-b border-line px-2 py-2">상태</th>
                <th className="border-b border-line px-2 py-2">이미지</th>
                <th className="border-b border-line px-2 py-2">마지막 로드</th>
                <th className="border-b border-line px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {sources.length === 0 ? (
                <tr><td className="border-b border-line px-2 py-3 text-neutral-600" colSpan={7}>아직 저장된 이미지 소스가 없습니다.</td></tr>
              ) : (
                sources.map((source) => {
                  const badge = getSourceBadge(source);
                  const sourcePath = getAssetSourceFolderPath(source);
                  const hasSourcePath = sourcePath !== missingSourcePathLabel;
                  const summary = summarizeSourceFiles(source);
                  return (
                    <tr key={source.id}>
                      <td className="border-b border-line px-2 py-2">
                        <div className="min-w-72 max-w-xl">
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-medium text-neutral-900">{source.label}</p>
                            <button
                              type="button"
                              title="전체 경로 복사"
                              disabled={!hasSourcePath}
                              onClick={() => void copySourcePath(sourcePath)}
                              className="inline-flex shrink-0 items-center gap-1 rounded border border-line px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              복사
                            </button>
                          </div>
                          <div className={`mt-2 rounded-md border px-2 py-1.5 ${hasSourcePath ? 'border-neutral-200 bg-neutral-50' : 'border-amber-200 bg-amber-50'}`}>
                            <p className="text-[11px] font-semibold text-neutral-500">경로</p>
                            <p className={`mt-0.5 whitespace-normal break-all text-xs font-medium ${hasSourcePath ? 'text-neutral-800' : 'text-amber-800'}`} title={sourcePath}>{sourcePath}</p>
                          </div>
                        </div>
                        {source.status === 'disabled' ? <p className="mt-1 text-xs text-neutral-500">비활성 그룹이라 빠른 로딩에서 제외됩니다.</p> : null}
                        {source.scanError ? <p className="mt-1 break-all text-xs text-red-600" title={source.scanError}>오류: {source.scanError}</p> : null}
                      </td>
                      <td className="border-b border-line px-2 py-2">
                        <label className="sr-only" htmlFor={`asset-source-role-${source.id}`}>이미지 폴더 역할</label>
                        <select
                          id={`asset-source-role-${source.id}`}
                          value={source.role ?? 'mixed'}
                          onChange={(event) => handleSourceRoleChange(source.id, event.target.value as AssetKind | 'mixed')}
                          title={`${assetSourceRoleLabel(source.role)} 역할로 인덱싱합니다. 자동은 Fanart - Front, Box - Front, Clear Logo, Background 폴더명만 판정합니다.`}
                          className="w-36 rounded-md border border-line bg-white px-2 py-1 text-sm"
                        >
                          {assetSourceRoleOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="border-b border-line px-2 py-2">
                        <label className="sr-only" htmlFor={`asset-source-scan-mode-${source.id}`}>이미지 소스 스캔 모드</label>
                        <select
                          id={`asset-source-scan-mode-${source.id}`}
                          value={source.scanMode ?? 'launchbox-optimized'}
                          onChange={(event) => handleSourceScanModeChange(source.id, event.target.value as AssetSourceScanMode)}
                          title="LaunchBox 루트는 최적화 스캔, 개별 폴더는 수동 폴더 스캔을 사용하세요."
                          className="w-44 rounded-md border border-line bg-white px-2 py-1 text-sm"
                        >
                          <option value="launchbox-optimized">LaunchBox 최적화</option>
                          <option value="manual-folder">수동 폴더</option>
                        </select>
                      </td>
                      <td className="border-b border-line px-2 py-2">
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${badge.className}`}>{badge.label}</span>
                        {source.scanChanged ? <p className="mt-1 text-xs text-amber-700">변경 감지됨</p> : null}
                      </td>
                      <td className="border-b border-line px-2 py-2">
                        <span className="font-medium">{source.assetCount}</span>
                        {summary.skipped > 0 ? <p className="mt-1 text-xs text-neutral-500">제외 {summary.skipped}</p> : null}
                      </td>
                      <td className="border-b border-line px-2 py-2 text-neutral-600">{formatSourceScanTime(source)}</td>
                      <td className="border-b border-line px-2 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <button type="button" disabled title="브라우저 환경에서는 실제 폴더 열기를 사용할 수 없습니다. 패키징 환경에서는 bridge를 통해 Explorer 열기를 연결할 수 있습니다." className="inline-flex items-center gap-2 rounded-md border border-line px-2 py-1 text-neutral-400">
                            <FolderOpen className="h-4 w-4" /> 열기
                          </button>
                          <button type="button" disabled={!sourceCanRefresh(source)} onClick={() => void handleRefreshSource(source.id)} className="inline-flex items-center gap-2 rounded-md border border-line px-2 py-1 disabled:opacity-40"><RefreshCw className="h-4 w-4" /> 폴더 다시 스캔</button>
                          <button type="button" onClick={() => void handleRemoveSource(source.id)} className="inline-flex items-center gap-2 rounded-md border border-red-200 px-2 py-1 text-red-700"><Trash2 className="h-4 w-4" /> 삭제</button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div className="md:col-span-2 xl:col-span-3">
          <label className="inline-flex items-center gap-2 text-sm text-neutral-600">
            <input type="checkbox" checked={showEmptyGroups} onChange={(event) => setShowEmptyGroups(event.target.checked)} />
            빈 그룹 표시
          </label>
        </div>
        {visibleAssetKinds.map((kind) => {
          const folder = assetLibrary?.folders[kind];
          const samples = folder?.files.slice(0, 3) ?? [];
          return (
            <section key={kind} className="rounded-lg border border-line bg-white p-5 shadow-surface">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold">/{kind}</h3>
                <span className="rounded-full bg-neutral-100 px-2 py-1 text-xs font-medium">{folder?.files.length ?? 0}</span>
              </div>
              <div className="mt-3 space-y-1 text-sm text-neutral-600">
                {samples.length > 0 ? samples.map((asset) => <p key={asset.id}>{asset.sourceLabel}: {asset.name}</p>) : <p>인덱싱된 파일이 없습니다.</p>}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function emptyAssetLibrary(): AssetLibrary {
  return { id: 'empty_asset_library', folders: {}, assetsById: {} };
}
