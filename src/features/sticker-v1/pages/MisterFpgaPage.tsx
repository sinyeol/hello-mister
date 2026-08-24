import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Database, Layers, Link, Nfc, Play, RefreshCw, Search, Tags } from 'lucide-react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { isAdvancedMode, useAppViewMode } from '../../../services/app/viewMode';
import { setActiveMisterProfile, useActiveMisterProfile } from '../../../services/mister/activeProfile';
import { misterDisplayName } from '../../../services/mister/misterName';
import type { ActiveMisterProfile } from '../../../types/mister';
import { ZaparooApiClient } from '../../../services/zaparoo/zaparooApiClient';
import { formatZaparooConfigDiagnostics } from '../../../services/zaparoo/zaparooConfigDiagnostics';
import { formatZaparooConfigApplyResult } from '../../../services/zaparoo/zaparooConfigApplyService';
import { getZaparooNfcWriteReadiness } from '../../../services/zaparoo/zaparooNfcReadiness';
import { compareZaparooNfcTokenText, formatZaparooNfcReadStatus, getZaparooNfcReadReadiness } from '../../../services/zaparoo/zaparooNfcTokenEvents';
import { searchZaparooMediaForTitle } from '../../../services/zaparoo/zaparooMediaService';
import { PageHeader } from '@sticker-v1/components/common/PageHeader';
import { PaginationControls } from '@sticker-v1/components/common/PaginationControls';
import { MAX_BATCH_CARD_CREATE_COUNT, batchCardCreateLimitMessage, isBatchCardCreateCountAllowed } from '@sticker-v1/config/cardCreation';
import { BridgeMiSTerConnectionAdapter, testMiSTerConnection } from '@sticker-v1/services/mister/misterConnection';
import { getMiSTerBridgeUrl, HttpMiSTerBridgeClient, setMiSTerBridgeUrl, type CustomPlatformScanDiagnostics } from '@sticker-v1/services/mister/misterBridge';
import { MiSTerBridgeTagWriteAdapter, TextExportTagWriteAdapter } from '@sticker-v1/services/mister/tagWriting';
import { useConnectedMiSTerDevices, resolveLaunchTargetsForEntry, launchTextForDeviceRef, type LaunchTarget } from '@sticker-v1/services/mister/connectedDevices';
import { buildLaunchPreview, buildLaunchPreviewFromMetadata, buildTagPayload } from '@sticker-v1/services/mister/zaparooLaunch';
import { misterPlatformCatalog, type MiSTerPlatformCatalogItem } from '@sticker-v1/data/misterPlatformCatalog';
import {
  createZaparooLibraryBackup,
  deleteZaparooLibraryBackup,
  emptyZaparooLibraryState,
  removeMiSTerProfileFromZaparooLibrary,
  restoreZaparooLibraryBackup,
  setActiveZaparooProfile,
  updateMiSTerProfileInZaparooLibrary,
  zaparooLibraryEntryIdForMiSTerEntry,
} from '@sticker-v1/services/zaparoo/zaparooLibrary';
import type { DeviceIdentityInput } from '@sticker-v1/services/zaparoo/zaparooLibrary';
import { useProjectStore } from '@sticker-v1/store/projectStore';
import type { MiSTerBridgeScanRootStatus, MiSTerCardMetadata, MiSTerConnectionConfig, MiSTerLaunchMode, MiSTerScanEntry, MiSTerScanFilterConfig, ZaparooLibraryEntry } from '@sticker-v1/types';
import type { ZaparooAllowedIpsRecommendationMode, ZaparooApiTarget, ZaparooConfigApplyResult, ZaparooConfigDiagnostics, ZaparooConfigPatchPlan, ZaparooMediaItem, ZaparooStatusResult } from '../../../types/zaparoo';
import { normalizeName } from '@sticker-v1/utils/normalizeName';
import { platformIdentityKeys } from '@sticker-v1/utils/platformNormalization';
import { isPlayableLibraryEntry, platformHasPlayableEntry } from '@sticker-v1/utils/zaparooDisplayFilters';

type Section = 'connection' | 'sync' | 'browser' | 'tag';
type SortMode = 'title' | 'platform' | 'last-synced' | 'card-created' | 'image-matched';
type ScanPhase = 'idle' | 'checking' | 'scanning' | 'merging' | 'done' | 'failed';
type TagUiStatus = 'idle' | 'ready' | 'waiting for tag' | 'writing' | 'written' | 'reading' | 'verified' | 'error' | 'waitingForTag' | 'tagDetected' | 'mismatch' | 'timeout' | 'cancelled';
type LibrarySearchScope = 'current' | 'all';
type ZaparooMediaMatchState = Record<string, { status: 'idle' | 'searching' | 'done' | 'error'; message: string; items: ZaparooMediaItem[] }>;
type PlatformDiscoveryEntry = Pick<MiSTerScanEntry, 'platformGroup' | 'systemId' | 'folderName' | 'absolutePath'> & { lastSyncedAt?: string };
type CustomPlatformRegistrationDraft = {
  platformKey: string;
  platformId: string;
  displayName: string;
  aliases: string;
  sourceRoot: string;
  coreRoot: string;
  parentSystem: string;
  extensions: string;
  scanDepth: number;
  recursive: boolean;
  cardCategory: string;
  launchTemplate: string;
  entry?: PlatformDiscoveryEntry;
};
type CustomPlatformSourceScanState = Record<string, {
  phase: 'idle' | 'scanning' | 'done' | 'failed';
  message: string;
  entries: MiSTerScanEntry[];
  rootStatuses: MiSTerBridgeScanRootStatus[];
  rawFilesScanned: number;
  skippedFiles: number;
  diagnostics?: CustomPlatformScanDiagnostics;
  scannedAt?: string;
}>;
type NfcRouteState = {
  activeMister?: {
    profileId?: string;
    alias?: string;
    ipAddress: string;
    port?: number;
    username?: string;
  };
  nfcGame?: {
    entryId?: string;
    title?: string;
    platform?: string;
    launchText?: string;
    absolutePath?: string;
  };
};

interface BridgeScanStatus {
  phase: ScanPhase;
  message: string;
  rootStatuses: MiSTerBridgeScanRootStatus[];
  platformStatuses: BridgeScanPlatformStatus[];
  scannedEntries: number;
  rawFilesScanned: number;
  skippedFiles: number;
  executableGames: number;
  nonExecutableEntries: number;
  filteredEntries: number;
  candidateEntries: number;
  mergedEntries: number;
  skippedDuplicates: number;
}

interface BridgeScanPlatformStatus {
  platformKey: string;
  platformGroup: string;
  systemId: string;
  entryCount: number;
  executableGames: number;
  nonExecutableEntries: number;
  selectedEntries: number;
  existingPathDuplicates: number;
}

// 섹션 전환(게임 가져오기/게임 목록)은 왼쪽 사이드바의 "게임 라이브러리" 드롭다운(라우트)으로 옮겼다.
// NFC 관리('tag')는 별도 메뉴(/stickers/nfc)로 분리되어 있다.
function sectionFromPath(pathname: string): Section {
  if (pathname.includes('/stickers/nfc')) return 'tag';
  if (pathname.includes('/stickers/mister/import')) return 'sync';
  return 'browser';
}

function connectionConfigForRequest(config: MiSTerConnectionConfig) {
  return {
    ...config,
    password: config.authMethod === 'password' ? config.password ?? '1' : config.password,
  };
}

function connectionStatusLabel(status: string, hasSession: boolean) {
  if (hasSession && status === 'connected') return '연결됨';
  if (status === 'testing') return '연결 중';
  if (status === 'connected') return '연결됨';
  if (status === 'failed') return '오류';
  if (status === 'unavailable') return '연결 불가';
  return '연결 안 됨';
}

function statusBadge(label: string, active: boolean, tone: 'success' | 'warning' | 'danger' | 'info' = 'success') {
  const activeClass =
    tone === 'danger'
      ? 'bg-red-50 text-red-700'
      : tone === 'warning'
        ? 'bg-amber-50 text-amber-700'
        : tone === 'info'
          ? 'bg-blue-50 text-blue-700'
          : 'bg-green-50 text-green-700';
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${active ? activeClass : 'bg-neutral-100 text-neutral-600'}`}>
      {label}
    </span>
  );
}

const tagStatusLabels: Partial<Record<TagUiStatus, string>> = {
  idle: '대기',
  ready: '준비됨',
  'waiting for tag': '태그 대기',
  writing: '쓰기 중',
  written: '쓰기 완료',
  reading: '읽기 중',
  verified: '검증됨',
  error: '오류',
};

function explainTagError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error || fallback);
  const lower = message.toLowerCase();
  if (lower.includes('failed to fetch') || lower.includes('networkerror')) {
    return '로컬 브리지가 응답하지 않습니다. 패키지 앱 또는 npm run mister:bridge로 bridge health를 먼저 확인하세요.';
  }
  if (lower.includes('connection') && lower.includes('session')) {
    return 'MiSTer 연결이 필요합니다. MiSTer 연결 메뉴에서 연결 상태를 확인하세요.';
  }
  if (lower.includes('error displaying tui') || lower.includes('term not set') || lower.includes('terminal entry not found')) {
    return 'NFC CLI가 TUI 모드로 실행되었습니다. bridge는 Core API를 우선 사용하고, CLI fallback은 -write 명령만 사용해야 합니다.';
  }
  if (lower.includes('panic: close of closed channel') || lower.includes('zaparoo-core') || lower.includes('flags.post')) {
    return 'NFC 서비스 CLI 내부 panic이 발생했습니다. 앱/브리지를 재시작한 뒤 다시 시도하세요. 반복되면 MiSTer의 NFC core 업데이트가 필요할 수 있습니다.';
  }
  if (lower.includes('zaparoo command unavailable') || lower.includes('zaparoo.sh') || lower.includes('adapter') || lower.includes('127')) {
    return 'NFC Core API 또는 CLI fallback command를 사용할 수 없습니다. MiSTer의 NFC 서비스와 /media/fat/Scripts/zaparoo.sh 경로를 확인하세요.';
  }
  if (lower.includes('no reader')) return 'NFC 리더를 찾지 못했습니다. MiSTer USB 리더 연결과 NFC reader 설정을 확인하세요.';
  if (lower.includes('no tag') || lower.includes('tag not')) return '태그가 감지되지 않았습니다. NTAG215 태그를 MiSTer USB 리더 위에 올린 뒤 다시 시도하세요.';
  return message || fallback;
}

function entryBadges(entry: ZaparooLibraryEntry) {
  return (
    <div className="flex flex-wrap gap-1">
      {statusBadge(entry.hasCard ? '카드 있음' : '카드 없음', entry.hasCard, 'info')}
      {statusBadge(entry.imageMatchState === 'matched' ? '이미지 매칭됨' : entry.imageMatchState === 'ambiguous' ? '이미지 확인 필요' : '이미지 없음', entry.imageMatchState !== 'unmatched', entry.imageMatchState === 'ambiguous' ? 'warning' : 'success')}
      {statusBadge(entry.launchReady ? '실행 준비됨' : '실행 준비 안 됨', entry.launchReady)}
      {entry.pathValid === false && statusBadge('경로 오류', true, 'danger')}
      {entry.aliasApplied && statusBadge('alias 적용됨', true, 'info')}
      {entry.sourceDevices.length > 1 && statusBadge(`${entry.sourceDevices.length}대 기기`, true, 'info')}
      {entry.available === false && entry.sourceDevices.length === 0 && statusBadge('연결된 기기에 없음', true, 'warning')}
    </div>
  );
}

function toMiSTerEntry(entry: ZaparooLibraryEntry): MiSTerScanEntry {
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
    imageMatch: {
      state: entry.imageMatchState,
      assetId: entry.imageAssetId,
      candidates: [],
      reason: '미스터 게임 리스트 entry',
    },
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

function sortEntries(entries: ZaparooLibraryEntry[], sortMode: SortMode) {
  return [...entries].sort((a, b) => {
    if (sortMode === 'platform') return `${a.platformGroup}/${a.systemId}/${a.title}`.localeCompare(`${b.platformGroup}/${b.systemId}/${b.title}`);
    if (sortMode === 'last-synced') return (b.lastSyncedAt ?? '').localeCompare(a.lastSyncedAt ?? '') || a.title.localeCompare(b.title);
    if (sortMode === 'card-created') return Number(b.hasCard) - Number(a.hasCard) || a.title.localeCompare(b.title);
    if (sortMode === 'image-matched') return Number(b.imageMatchState === 'matched') - Number(a.imageMatchState === 'matched') || a.title.localeCompare(b.title);
    return a.title.localeCompare(b.title);
  });
}

function normalizedMiSTerPathKey(path?: string) {
  return String(path ?? '').trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/g, '').toLowerCase();
}

function libraryAbsolutePathKeys(entries: ZaparooLibraryEntry[]) {
  const keys = new Set<string>();
  entries.forEach((entry) => {
    [entry.absolutePath, entry.resolvedMiSTerPath, ...entry.sourceRefs.map((ref) => ref.absolutePath)]
      .map(normalizedMiSTerPathKey)
      .filter(Boolean)
      .forEach((key) => keys.add(key));
  });
  return keys;
}

function scanEntryIsExecutable(entry: MiSTerScanEntry) {
  return entry.playable !== false && !entry.bios && !entry.firmware && !entry.systemFile && !entry.ignored;
}

function buildPlatformScanStatuses(
  entries: MiSTerScanEntry[],
  selectedPlatformKeys: Set<string>,
  existingLibraryPathKeys: Set<string>,
): BridgeScanPlatformStatus[] {
  const rows = new Map<string, BridgeScanPlatformStatus>();
  entries.forEach((entry) => {
    const platformKey = `${entry.platformGroup}/${entry.systemId}`;
    const current = rows.get(platformKey) ?? {
      platformKey,
      platformGroup: entry.platformGroup,
      systemId: entry.systemId,
      entryCount: 0,
      executableGames: 0,
      nonExecutableEntries: 0,
      selectedEntries: 0,
      existingPathDuplicates: 0,
    };
    current.entryCount += 1;
    if (scanEntryIsExecutable(entry)) current.executableGames += 1;
    else current.nonExecutableEntries += 1;
    if (selectedPlatformKeys.has(platformKey)) current.selectedEntries += 1;
    if (existingLibraryPathKeys.has(normalizedMiSTerPathKey(entry.absolutePath))) current.existingPathDuplicates += 1;
    rows.set(platformKey, current);
  });
  return Array.from(rows.values()).sort((a, b) =>
    a.platformGroup.localeCompare(b.platformGroup)
    || a.systemId.localeCompare(b.systemId)
    || a.platformKey.localeCompare(b.platformKey),
  );
}

function safePlatformSlug(value: string) {
  return normalizeName(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'custom-platform';
}

function parseCommaList(value: string) {
  return value
    .split(/[\n,]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sourceRootForDiscovery(entry?: PlatformDiscoveryEntry) {
  if (!entry?.absolutePath) return '';
  return entry.absolutePath.split('/').slice(0, -1).join('/');
}

function extensionListForEntries(entries: MiSTerScanEntry[]) {
  const extensions = new Set<string>();
  entries.forEach((entry) => {
    const match = entry.romName.match(/(\.[^.\\/]+)$/);
    if (match?.[1]) extensions.add(match[1].toLowerCase());
  });
  return Array.from(extensions).sort();
}

function normalizedExtensionList(value: string) {
  return parseCommaList(value)
    .map((extension) => (extension.startsWith('.') ? extension : `.${extension}`))
    .map((extension) => extension.toLowerCase());
}

function normalizeScanDepth(value?: number) {
  const depth = Number.isFinite(value) ? Math.floor(value as number) : 2;
  if (depth <= 1) return 1;
  if (depth >= 3) return 3;
  return 2;
}

function normalizeMiSTerPathForPrefix(value: string) {
  return value
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/g, '');
}

function relativeDepthFromSourceRoot(absolutePath: string, sourceRoot: string) {
  const root = normalizeMiSTerPathForPrefix(sourceRoot);
  const targetPath = normalizeMiSTerPathForPrefix(absolutePath);
  if (!root || targetPath === root || !targetPath.startsWith(`${root}/`)) return Number.POSITIVE_INFINITY;
  return targetPath.slice(root.length + 1).split('/').filter(Boolean).length;
}

function entryMatchesCustomPlatformSource(entry: MiSTerScanEntry, sourceRoots: string[], scanDepth = 2, recursive = false) {
  const normalizedDepth = normalizeScanDepth(scanDepth);
  return sourceRoots.some((sourceRoot) => {
    const depth = relativeDepthFromSourceRoot(entry.absolutePath, sourceRoot);
    if (!Number.isFinite(depth)) return false;
    return recursive || depth <= normalizedDepth;
  });
}

function extensionForScanEntry(entry: Pick<MiSTerScanEntry, 'romName' | 'absolutePath'>) {
  const fileName = entry.romName || entry.absolutePath.split('/').pop() || entry.absolutePath;
  return fileName.match(/(\.[^.\\/]+)$/)?.[1]?.toLowerCase() ?? '';
}

function dedupeScanEntriesByPath(entries: MiSTerScanEntry[]) {
  const byPath = new Map<string, MiSTerScanEntry>();
  entries.forEach((entry) => byPath.set(normalizeMiSTerPathForPrefix(entry.absolutePath).toLowerCase(), entry));
  return Array.from(byPath.values());
}

function customPlatformScanRangeLabel(scanDepth = 2, recursive = false) {
  if (recursive) return '전체 하위 폴더';
  const depth = normalizeScanDepth(scanDepth);
  if (depth <= 1) return '바로 아래 파일만';
  if (depth === 2) return '하위 폴더 1단계까지';
  return '하위 폴더 2단계까지';
}

function customPlatformReasonLabel(reason: string) {
  if (reason === 'extensionExcluded') return '확장자 제외';
  if (reason === 'folderExcluded') return '폴더/숨김 항목 제외';
  if (reason === 'duplicateFullPath') return '중복 경로';
  if (reason === 'unsupportedFile') return '지원하지 않는 파일';
  if (reason === 'depthLimit') return '스캔 깊이 제한';
  if (reason === 'readError') return '폴더 읽기 실패';
  return reason;
}

function topCustomPlatformReasonEntries(diagnostics?: CustomPlatformScanDiagnostics) {
  return Object.entries(diagnostics?.reasonCounts ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
}

function topCustomPlatformExtensionEntries(diagnostics?: CustomPlatformScanDiagnostics) {
  return Object.entries(diagnostics?.excludedExtensionCounts ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
}

function customPlatformKey(parentSystem: string, displayName: string) {
  const parent = parentSystem.trim() || 'Arcade';
  const name = displayName.trim() || 'Custom';
  return `${parent}/${name}`;
}

function defaultCustomPlatformDraft(): CustomPlatformRegistrationDraft {
  return {
    platformKey: 'Arcade/PGM',
    platformId: 'custom-pgm',
    displayName: 'PGM',
    aliases: 'PGM, IGS PGM, PolyGame Master',
    sourceRoot: '/media/fat/_Arcade/PGM',
    coreRoot: '/media/fat/_Arcade/cores',
    parentSystem: 'Arcade',
    extensions: '.mra',
    scanDepth: 2,
    recursive: false,
    cardCategory: 'Arcade',
    launchTemplate: '**launch:{misterPath}',
  };
}

function catalogIdentityKeys(item: MiSTerPlatformCatalogItem) {
  return platformIdentityKeys({
    platformKey: item.platformKey,
    platformGroup: item.platformGroup,
    systemId: item.systemId,
    folderName: item.coreFolderName,
    coreFolderName: item.coreFolderName,
    displayName: item.displayName,
    aliases: item.aliases,
    sourceRoots: item.sourceRoots,
  });
}

export function MisterFpgaPage() {
  const {
    mister,
    savedCards,
    savedCardIndex,
    zaparooLibrary,
    updateMiSTerConnectionConfig,
    setZaparooLibrary,
    setMiSTerConnection,
    setMiSTerEntries,
    refreshMiSTerEntriesForDevice,
    createCardsFromZaparooEntries,
    addMiSTerTagJob,
  } = useProjectStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [appMode] = useAppViewMode();
  const developerMode = isAdvancedMode(appMode);
  const [activeSection, setActiveSection] = useState<Section>('browser');
  const [activeMister] = useActiveMisterProfile();
  const { devices: connectedDevices, selectedTargetDeviceId, setSelectedTargetDeviceId, refresh: refreshConnectedDevices } = useConnectedMiSTerDevices();
  const [nfcRouteActiveMister, setNfcRouteActiveMister] = useState<NfcRouteState['activeMister']>();
  const effectiveActiveMister = activeMister ?? nfcRouteActiveMister;
  const activeMisterIp = effectiveActiveMister?.ipAddress;
  const activeMisterPort = effectiveActiveMister?.port;
  const activeMisterUsername = effectiveActiveMister?.username;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState('__with_cards__');
  const [query, setQuery] = useState('');
  // The scope selector was removed from the UI; search now spans the whole library by default.
  const [librarySearchScope] = useState<LibrarySearchScope>('all');
  const [libraryDeviceFilter, setLibraryDeviceFilter] = useState<string>('__all__');
  const [platformFilterQuery, setPlatformFilterQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('title');
  const [pageSize, setPageSize] = useState(100);
  const [page, setPage] = useState(1);
  // Library platform sidebar: search box + collapsible groups (Console/Arcade/Computer/…) to tame the long list.
  // Platform search input was removed from the UI; keep the value empty (no-op filter).
  const [platformSearch] = useState('');
  const [collapsedPlatformGroups, setCollapsedPlatformGroups] = useState<Set<string>>(new Set());
  // Group platforms by their platform group (default) or alphabetically by first letter.
  const [platformGroupMode, setPlatformGroupMode] = useState<'group' | 'alpha'>('group');
  // Width of the left platform column — draggable via the handle on its right edge. Persisted.
  const [platformPanelWidth, setPlatformPanelWidth] = useState<number>(() => {
    try {
      const value = Number(window.localStorage.getItem('hello-mister-v2:platform-panel-width'));
      return value >= 160 && value <= 560 ? value : 240;
    } catch {
      return 240;
    }
  });
  const platformResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  useEffect(() => {
    try { window.localStorage.setItem('hello-mister-v2:platform-panel-width', String(platformPanelWidth)); } catch { /* ignore storage failures */ }
  }, [platformPanelWidth]);
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const state = platformResizeRef.current;
      if (!state) return;
      setPlatformPanelWidth(Math.min(560, Math.max(160, state.startWidth + (event.clientX - state.startX))));
    };
    const onUp = () => {
      if (!platformResizeRef.current) return;
      platformResizeRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);
  const startPlatformResize = (event: { clientX: number; preventDefault: () => void }) => {
    event.preventDefault();
    platformResizeRef.current = { startX: event.clientX, startWidth: platformPanelWidth };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };
  // Favorite platforms pinned to the top of the sidebar (persisted).
  const [favoritePlatforms, setFavoritePlatforms] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(window.localStorage.getItem('hello-mister-v2:favorite-platforms') ?? '[]')); } catch { return new Set(); }
  });
  const [lastLibrarySelectionId, setLastLibrarySelectionId] = useState<string | undefined>();
  // Group same-game versions: show one representative row + an expandable version list. The chosen
  // representative (per game key) persists in localStorage; expansion is transient.
  const [representativeByGame, setRepresentativeByGame] = useState<Record<string, string>>(() => {
    try { return JSON.parse(window.localStorage.getItem('hello-mister-v2:library-representatives') ?? '{}'); } catch { return {}; }
  });
  const [expandedGameKeys, setExpandedGameKeys] = useState<Set<string>>(new Set());
  const [libraryDragSelecting, setLibraryDragSelecting] = useState(false);
  const [launchMode, setLaunchMode] = useState<MiSTerLaunchMode>('absolute-path');
  const [message, setMessage] = useState('');
  const [connectionSteps, setConnectionSteps] = useState<Array<{ label: string; state: 'pending' | 'active' | 'done' | 'failed' }>>([]);
  const showHiddenPlatforms = false;
  const [tagEntryId, setTagEntryId] = useState('');
  const [tagGamePickerOpen, setTagGamePickerOpen] = useState(false);
  const [tagSelectionMode, setTagSelectionMode] = useState<'library' | 'card'>('library');
  const [tagPickerPlatform, setTagPickerPlatform] = useState('');
  const [tagPickerQuery, setTagPickerQuery] = useState('');
  const [tagCardQuery, setTagCardQuery] = useState('');
  const [manualLaunchText, setManualLaunchText] = useState('');
  const [tagStatus, setTagStatus] = useState<TagUiStatus>('idle');
  const [readTagText, setReadTagText] = useState('');
  const [tagMessage, setTagMessage] = useState('');
  const [nfcReadBusy, setNfcReadBusy] = useState(false);
  const nfcReadRequestIdRef = useRef('');
  const [autoMergeAfterScan, setAutoMergeAfterScan] = useState(() => window.localStorage.getItem('zaparoo.mister.autoMergeAfterScan') === 'true');
  const [lastScanEntries, setLastScanEntries] = useState<MiSTerScanEntry[]>([]);
  const [selectedImportPlatformKeys, setSelectedImportPlatformKeys] = useState<string[]>([]);
  const [scanPreviewEntries, setScanPreviewEntries] = useState<MiSTerScanEntry[]>([]);
  const [bridgeScanStatus, setBridgeScanStatus] = useState<BridgeScanStatus>({
    phase: 'idle',
    message: 'MiSTer 연결 후 스캔할 준비가 되었습니다.',
    rootStatuses: [],
    platformStatuses: [],
    scannedEntries: 0,
    rawFilesScanned: 0,
    skippedFiles: 0,
    executableGames: 0,
    nonExecutableEntries: 0,
    filteredEntries: 0,
    candidateEntries: 0,
    mergedEntries: 0,
    skippedDuplicates: 0,
  });
  const [scanFilterConfig, setScanFilterConfig] = useState<{ config: MiSTerScanFilterConfig; source: string; path?: string; lastSavedAt?: string } | null>(null);
  const [scanFilterMessage, setScanFilterMessage] = useState('');
  const [discoveredPlatformSelectedKeys, setDiscoveredPlatformSelectedKeys] = useState<string[]>([]);
  const [customPlatformDraft, setCustomPlatformDraft] = useState<CustomPlatformRegistrationDraft | null>(null);
  const [customPlatformMergeKey, setCustomPlatformMergeKey] = useState('');
  const [customPlatformSourceScans, setCustomPlatformSourceScans] = useState<CustomPlatformSourceScanState>({});
  const [zaparooStatusMessage, setZaparooStatusMessage] = useState('');
  // Per-connected-device Zaparoo Core status (keyed by deviceId) for the NFC 관리 multi-device panel.
  const [nfcDeviceStatuses, setNfcDeviceStatuses] = useState<Record<string, ZaparooStatusResult>>({});
  const [nfcStatusBusy, setNfcStatusBusy] = useState(false);
  const [zaparooConfigDiagnostics, setZaparooConfigDiagnostics] = useState<ZaparooConfigDiagnostics | null>(null);
  const [zaparooApplyMode, setZaparooApplyMode] = useState<ZaparooAllowedIpsRecommendationMode>('single-ip');
  const [zaparooPatchPlan, setZaparooPatchPlan] = useState<ZaparooConfigPatchPlan | null>(null);
  const [zaparooApplyResult, setZaparooApplyResult] = useState<ZaparooConfigApplyResult | null>(null);
  const [zaparooApplyBusy, setZaparooApplyBusy] = useState(false);
  const [zaparooShowDiff, setZaparooShowDiff] = useState(false);
  const [zaparooAllowLocalBackupOnly, setZaparooAllowLocalBackupOnly] = useState(false);
  const [mediaMatches, setMediaMatches] = useState<ZaparooMediaMatchState>({});
  const [launchingEntryId, setLaunchingEntryId] = useState('');
  // Per-launch device chooser: shown when more than one connected MiSTer can run the entry.
  const [launchPicker, setLaunchPicker] = useState<{ entry: ZaparooLibraryEntry; candidates: LaunchTarget[] } | null>(null);
  // Pending per-MiSTer library delete (in-app confirm modal holds the device id).
  const [deleteProfileTarget, setDeleteProfileTarget] = useState<string | null>(null);
  // Set when a launch is blocked by Zaparoo allow_run, so the basic-mode UI can offer a one-click fix for that device.
  const [runFix, setRunFix] = useState<{ connectionId: string; config: MiSTerConnectionConfig; deviceLabel: string } | null>(null);

  const selectedEntries = zaparooLibrary.entries.filter((entry) => selectedIds.includes(entry.id));
  const tagSelectedEntry = zaparooLibrary.entries.find((entry) => entry.id === tagEntryId);
  const focusedEntry = tagSelectedEntry ?? selectedEntries[0] ?? zaparooLibrary.entries[0];
  const focusedMiSTerEntry = focusedEntry ? toMiSTerEntry(focusedEntry) : undefined;

  useEffect(() => {
    setPage(1);
  }, [query, librarySearchScope, sortMode, selectedPlatform, pageSize]);

  useEffect(() => {
    setActiveSection(sectionFromPath(location.pathname));
  }, [location.pathname]);

  useEffect(() => {
    if (!activeMisterIp || mister.connection.connectionId) return;
    if (mister.connection.config.host === activeMisterIp) return;
    updateMiSTerConnectionConfig({
      host: activeMisterIp,
      port: activeMisterPort,
      username: activeMisterUsername,
    });
  }, [activeMisterIp, activeMisterPort, activeMisterUsername, mister.connection.config.host, mister.connection.connectionId, updateMiSTerConnectionConfig]);

  useEffect(() => {
    let cancelled = false;
    void new HttpMiSTerBridgeClient().getScanFilterConfig()
      .then((result) => {
        if (cancelled) return;
        setScanFilterConfig({ config: result.config, source: result.source, path: result.path, lastSavedAt: result.lastSavedAt });
      })
      .catch((error) => {
        if (!cancelled) setScanFilterMessage(error instanceof Error ? error.message : 'MiSTer scan filter config를 불러오지 못했습니다.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!libraryDragSelecting) return undefined;
    function stopDragSelection() {
      setLibraryDragSelecting(false);
    }
    window.addEventListener('mouseup', stopDragSelection);
    return () => window.removeEventListener('mouseup', stopDragSelection);
  }, [libraryDragSelecting]);

  useEffect(() => {
    window.localStorage.setItem('zaparoo.mister.autoMergeAfterScan', autoMergeAfterScan ? 'true' : 'false');
  }, [autoMergeAfterScan]);

  // Card↔entry links are reconciled centrally now: on hydration/backup (setZaparooLibrary), on scan
  // (refreshMiSTerEntriesForDevice), and on card create/import/trash (mark/unmarkZaparooEntryCard). The old
  // effect here ran reconcile against the lazily-loaded full savedCards, which are empty at runtime, so it
  // silently wiped every entry's hasCard on each run — removed.

  const hiddenPlatformKeys = useMemo(() => new Set(zaparooLibrary.hiddenPlatformKeys ?? []), [zaparooLibrary.hiddenPlatformKeys]);
  const visibleLibraryEntries = useMemo(() => {
    const deviceScoped = libraryDeviceFilter === '__all__'
      ? zaparooLibrary.entries
      : zaparooLibrary.entries.filter((entry) => entry.sourceDevices.includes(libraryDeviceFilter));
    const entriesAfterHiddenFilter = deviceScoped.filter((entry) => showHiddenPlatforms || !hiddenPlatformKeys.has(`${entry.platformGroup}/${entry.systemId}`));
    const entriesByPlatform = new Map<string, ZaparooLibraryEntry[]>();
    entriesAfterHiddenFilter.forEach((entry) => {
      const key = `${entry.platformGroup}/${entry.systemId}`;
      entriesByPlatform.set(key, [...(entriesByPlatform.get(key) ?? []), entry]);
    });
    const playablePlatforms = new Set(
      Array.from(entriesByPlatform.entries())
        .filter(([, entries]) => platformHasPlayableEntry(entries))
        .map(([key]) => key),
    );
    return entriesAfterHiddenFilter.filter((entry) => playablePlatforms.has(`${entry.platformGroup}/${entry.systemId}`) && isPlayableLibraryEntry(entry));
  }, [hiddenPlatformKeys, libraryDeviceFilter, showHiddenPlatforms, zaparooLibrary.entries]);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = normalizeName(query);
    const searchAllLibrary = Boolean(normalizedQuery && librarySearchScope === 'all');
    return sortEntries(
      visibleLibraryEntries.filter((entry) => {
        if (!searchAllLibrary) {
          if (selectedPlatform === '__with_cards__' && !entry.hasCard) return false;
          if (selectedPlatform && selectedPlatform !== '__with_cards__' && selectedPlatform !== '__all_library__' && `${entry.platformGroup}/${entry.systemId}` !== selectedPlatform) return false;
        }
        if (!normalizedQuery) return true;
        return normalizeName(`${entry.title} ${entry.romName} ${entry.relativePath} ${entry.koTitle ?? ''} ${entry.systemId}`).includes(normalizedQuery);
      }),
      sortMode,
    );
  }, [librarySearchScope, query, selectedPlatform, sortMode, visibleLibraryEntries]);

  // Group versions of the same game (same platform + normalized title, which drops region/version markers).
  // Order follows filteredEntries (already sorted); representative = stored choice, else region-preferred.
  const gameGroups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, ZaparooLibraryEntry[]>();
    for (const entry of filteredEntries) {
      const key = `${entry.platformGroup}/${entry.systemId}|${normalizeName(entry.title)}`;
      if (!map.has(key)) { map.set(key, []); order.push(key); }
      map.get(key)!.push(entry);
    }
    const regionScore = (entry: ZaparooLibraryEntry) => {
      const text = normalizeName(`${entry.region ?? ''} ${entry.title} ${entry.relativePath}`);
      if (text.includes('world')) return 4;
      if (text.includes('usa') || text.includes(' us ') || text.endsWith(' us')) return 3;
      if (text.includes('europe') || text.includes('euro')) return 2;
      if (text.includes('japan')) return 1;
      return 0;
    };
    return order.map((key) => {
      const versions = map.get(key)!;
      const chosen = versions.find((entry) => entry.id === representativeByGame[key]);
      const representative = chosen ?? [...versions].sort((a, b) => regionScore(b) - regionScore(a))[0];
      return { key, representative, versions };
    });
  }, [filteredEntries, representativeByGame]);

  const platformBuckets = useMemo(() => {
    const buckets = new Map<string, { key: string; label: string; count: number; gameCount: number; cardCount: number; imageCount: number }>();
    // Distinct games per platform use the SAME grouping key as the list's version grouping
    // (normalizeName(title)), so "게임 N" matches the collapsed game rows and "버전 M" the entry total.
    const gameNamesByKey = new Map<string, Set<string>>();
    visibleLibraryEntries.forEach((entry) => {
      const key = `${entry.platformGroup}/${entry.systemId}`;
      const current = buckets.get(key) ?? { key, label: key, count: 0, gameCount: 0, cardCount: 0, imageCount: 0 };
      current.count += 1;
      if (entry.hasCard) current.cardCount += 1;
      if (entry.imageMatchState === 'matched') current.imageCount += 1;
      buckets.set(key, current);
      const names = gameNamesByKey.get(key) ?? new Set<string>();
      names.add(normalizeName(entry.title));
      gameNamesByKey.set(key, names);
    });
    buckets.forEach((bucket, key) => {
      bucket.gameCount = gameNamesByKey.get(key)?.size ?? bucket.count;
    });
    return Array.from(buckets.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [visibleLibraryEntries]);

  // Group the (now many) platform buckets by their platformGroup (Console/Arcade/Computer/…) and apply the
  // sidebar search, so the list stays manageable. Each section shows the systemId (label minus the group prefix).
  const platformGroupSections = useMemo(() => {
    const q = normalizeName(platformSearch);
    const sections = new Map<string, { group: string; buckets: Array<typeof platformBuckets[number] & { shortLabel: string }>; total: number; cardCount: number }>();
    for (const bucket of platformBuckets) {
      const platformGroup = bucket.key.split('/')[0] || 'Other';
      const shortLabel = bucket.key.slice(platformGroup.length + 1) || bucket.key;
      if (q && !normalizeName(bucket.label).includes(q)) continue;
      // Alphabetical mode buckets by the systemId's first letter (non-letters → "#").
      const firstChar = (shortLabel.trim()[0] ?? '#').toUpperCase();
      const group = platformGroupMode === 'alpha' ? (/[A-Z]/.test(firstChar) ? firstChar : '#') : platformGroup;
      const section = sections.get(group) ?? { group, buckets: [], total: 0, cardCount: 0 };
      section.buckets.push({ ...bucket, shortLabel });
      section.total += bucket.count;
      section.cardCount += bucket.cardCount;
      sections.set(group, section);
    }
    return Array.from(sections.values()).sort((a, b) => a.group.localeCompare(b.group));
  }, [platformBuckets, platformSearch, platformGroupMode]);

  const favoritePlatformBuckets = useMemo(() => {
    const q = normalizeName(platformSearch);
    return platformBuckets
      .filter((bucket) => favoritePlatforms.has(bucket.key) && (!q || normalizeName(bucket.label).includes(q)))
      .map((bucket) => ({ ...bucket, shortLabel: bucket.key.slice((bucket.key.split('/')[0] || '').length + 1) || bucket.key }));
  }, [platformBuckets, favoritePlatforms, platformSearch]);

  const customCatalogItems = useMemo(() => zaparooLibrary.customPlatformCatalog ?? [], [zaparooLibrary.customPlatformCatalog]);
  const selectedImportPlatformSet = useMemo(() => new Set(selectedImportPlatformKeys), [selectedImportPlatformKeys]);
  const knownCatalogIdentityKeys = useMemo(() => {
    const keys = new Set<string>();
    [...misterPlatformCatalog, ...customCatalogItems]
      .filter((item) => !item.ignored && !item.disabled && item.type !== 'classification-folder')
      .forEach((item) => catalogIdentityKeys(item).forEach((key) => keys.add(key)));
    return keys;
  }, [customCatalogItems]);
  const existingPlatformIdentityKeys = useMemo(() => {
    const keys = new Set<string>();
    zaparooLibrary.entries.forEach((entry) => {
      platformIdentityKeys({
        platformKey: `${entry.platformGroup}/${entry.systemId}`,
        platformGroup: entry.platformGroup,
        systemId: entry.systemId,
        folderName: entry.folderName,
        displayName: entry.systemId,
      }).forEach((key) => keys.add(key));
    });
    return keys;
  }, [zaparooLibrary.entries]);
  const ignoredPlatformIdentityKeys = useMemo(() => {
    const keys = new Set<string>();
    [
      ...(zaparooLibrary.ignoredUnknownPlatformKeys ?? []),
      ...(zaparooLibrary.classificationFolderPlatformKeys ?? []),
    ].forEach((platformKey) => {
      platformIdentityKeys({ platformKey }).forEach((key) => keys.add(key));
    });
    return keys;
  }, [zaparooLibrary.classificationFolderPlatformKeys, zaparooLibrary.ignoredUnknownPlatformKeys]);
  const globalImportPlatforms = useMemo(() => {
    const byKey = new Map<string, MiSTerPlatformCatalogItem>();
    [...misterPlatformCatalog, ...customCatalogItems]
      .filter((item) => !item.ignored && !item.disabled && item.type !== 'classification-folder')
      .forEach((item) => byKey.set(item.platformKey, item));
    const ignoredRawKeys = new Set(zaparooLibrary.ignoredUnknownPlatformKeys ?? []);
    zaparooLibrary.entries.forEach((entry) => {
      const key = `${entry.platformGroup}/${entry.systemId}`;
      if (!byKey.has(key) && !ignoredRawKeys.has(key)) {
        byKey.set(key, {
          platformKey: key,
          displayName: entry.systemId,
          systemId: entry.systemId,
          coreFolderName: entry.folderName || entry.systemId,
          platformGroup: entry.platformGroup,
          defaultImportEnabled: false,
          knownExtensions: [],
          sourceNote: '스캔 결과에서 발견된 사용자 platform입니다.',
          custom: true,
        });
      }
    });
    // Unknown scan-only platforms stay in "new platform discovery" until the user registers them.
    lastScanEntries.slice(0, 0).forEach((entry) => {
      const key = `${entry.platformGroup}/${entry.systemId}`;
      const identities = platformIdentityKeys({
        platformKey: key,
        platformGroup: entry.platformGroup,
        systemId: entry.systemId,
        folderName: entry.folderName,
        displayName: entry.systemId,
      });
      const ignored = ignoredRawKeys.has(key) || identities.some((identity) => ignoredPlatformIdentityKeys.has(identity));
      if (!byKey.has(key) && !ignored) {
        byKey.set(key, {
          platformKey: key,
          displayName: entry.systemId,
          systemId: entry.systemId,
          coreFolderName: entry.folderName || entry.systemId,
          platformGroup: entry.platformGroup,
          defaultImportEnabled: false,
          knownExtensions: [],
          sourceNote: '이번 MiSTer 스캔에서 발견된 플랫폼입니다.',
          custom: true,
        });
      }
    });
    const normalizedQuery = normalizeName(platformFilterQuery);
    return Array.from(byKey.values())
      .filter((item) => !normalizedQuery || normalizeName(`${item.displayName} ${item.platformKey} ${item.coreFolderName}`).includes(normalizedQuery))
      .sort((a, b) => a.platformGroup.localeCompare(b.platformGroup) || a.displayName.localeCompare(b.displayName));
  }, [customCatalogItems, ignoredPlatformIdentityKeys, lastScanEntries, platformFilterQuery, zaparooLibrary.entries, zaparooLibrary.ignoredUnknownPlatformKeys]);

  const isGlobalPlatformImportEnabled = useCallback((platformKey: string) => {
    return selectedImportPlatformSet.has(platformKey);
  }, [selectedImportPlatformSet]);

  const savedDiscoveredPlatformState = useCallback((platformKey: string): 'enabled' | 'disabled' | 'ignored' | 'pending' => {
    if ((zaparooLibrary.ignoredUnknownPlatformKeys ?? []).includes(platformKey)) return 'ignored';
    if ((zaparooLibrary.importEnabledPlatformKeys ?? []).includes(platformKey)) return 'enabled';
    if ((zaparooLibrary.importDisabledPlatformKeys ?? []).includes(platformKey)) return 'disabled';
    const customCatalogItem = customCatalogItems.find((item) => item.platformKey === platformKey);
    if (customCatalogItem) return customCatalogItem.defaultImportEnabled ? 'enabled' : 'disabled';
    return 'pending';
  }, [customCatalogItems, zaparooLibrary.ignoredUnknownPlatformKeys, zaparooLibrary.importDisabledPlatformKeys, zaparooLibrary.importEnabledPlatformKeys]);

  function scanEntryPlatformKey(entry: Pick<MiSTerScanEntry, 'platformGroup' | 'systemId'>) {
    return `${entry.platformGroup}/${entry.systemId}`;
  }

  // Stable-identity descriptor for the device being scanned (profileId preferred, host:port:user fallback).
  function scanDeviceIdentity(activeProfile: { profileId?: string; macAddress?: string; sdCid?: string } | undefined, config: MiSTerConnectionConfig): DeviceIdentityInput {
    return {
      profileId: activeProfile?.profileId,
      macAddress: activeProfile?.macAddress,
      sdCid: activeProfile?.sdCid,
      host: config.host,
      port: config.port,
      username: config.username,
    };
  }

  // Selecting a scan target makes that connected MiSTer the active device, so the scan/refresh runs through the
  // proven active-connection path (with its reconnect fallback) instead of a fragile cross-session call.
  function selectScanTargetDevice(deviceId: string) {
    setSelectedTargetDeviceId(deviceId);
    const device = connectedDevices.find((candidate) => candidate.deviceId === deviceId);
    if (!device) return;
    const activeProfile: ActiveMisterProfile = {
      profileId: device.profileId || device.sessionId,
      alias: device.alias,
      ipAddress: device.ipAddress,
      port: device.config.port,
      username: device.config.username,
      connectedAt: new Date().toISOString(),
      sessionId: device.sessionId,
      mediaFatOk: true,
      gamesOk: true,
      misterIniOk: false,
    };
    setActiveMisterProfile(activeProfile);
    void window.helloMisterDesktop?.setActiveMisterProfile?.(activeProfile);
    setMiSTerConnection({
      status: 'connected',
      connectionId: device.sessionId,
      config: device.config,
      message: `${misterDisplayName(device)}를 작업 대상 MiSTer로 선택했습니다.`,
    });
  }

  // Default the work-target device to the active MiSTer's session (else the first connected one) so the
  // scan/launch/NFC selector starts on a sensible device instead of empty.
  useEffect(() => {
    if (selectedTargetDeviceId && connectedDevices.some((device) => device.deviceId === selectedTargetDeviceId)) return;
    if (connectedDevices.length === 0) return;
    const activeMatch = connectedDevices.find((device) => device.profileId && device.profileId === effectiveActiveMister?.profileId) ?? connectedDevices[0];
    setSelectedTargetDeviceId(activeMatch.deviceId);
  }, [connectedDevices, selectedTargetDeviceId, effectiveActiveMister?.profileId, setSelectedTargetDeviceId]);

  useEffect(() => {
    const nextScanPreviewEntries = lastScanEntries.filter((entry) => selectedImportPlatformSet.has(scanEntryPlatformKey(entry)));
    const existingPathKeys = libraryAbsolutePathKeys(zaparooLibrary.entries);
    setScanPreviewEntries(nextScanPreviewEntries);
    if (lastScanEntries.length > 0) {
      setBridgeScanStatus((current) => {
        if (current.phase !== 'done') return current;
        const platformStatuses = buildPlatformScanStatuses(lastScanEntries, selectedImportPlatformSet, existingPathKeys);
        return {
          ...current,
          platformStatuses,
          filteredEntries: Math.max(0, lastScanEntries.length - nextScanPreviewEntries.length),
          candidateEntries: nextScanPreviewEntries.length,
          skippedDuplicates: nextScanPreviewEntries.filter((entry) => existingPathKeys.has(normalizedMiSTerPathKey(entry.absolutePath))).length,
        };
      });
    }
  }, [lastScanEntries, selectedImportPlatformSet, zaparooLibrary.entries]);

  const unknownScannedPlatforms = useMemo(() => {
    const found = new Map<string, PlatformDiscoveryEntry>();
    lastScanEntries.forEach((entry) => {
      const key = `${entry.platformGroup}/${entry.systemId}`;
      const identities = platformIdentityKeys({
        platformKey: key,
        platformGroup: entry.platformGroup,
        systemId: entry.systemId,
        folderName: entry.folderName,
        displayName: entry.systemId,
        sourceRoots: [sourceRootForDiscovery(entry)],
      });
      const alreadyInLibrary = identities.some((identity) => existingPlatformIdentityKeys.has(identity));
      const alreadyKnownCatalog = identities.some((identity) => knownCatalogIdentityKeys.has(identity));
      const ignored = identities.some((identity) => ignoredPlatformIdentityKeys.has(identity));
      if (!alreadyInLibrary && !alreadyKnownCatalog && !ignored && !found.has(key)) found.set(key, entry);
    });
    return Array.from(found.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [existingPlatformIdentityKeys, ignoredPlatformIdentityKeys, knownCatalogIdentityKeys, lastScanEntries]);

  const discoveredPlatformRows = useMemo(() => {
    const rows = new Map<string, {
      key: string;
      name: string;
      path: string;
      status: 'enabled' | 'disabled' | 'ignored' | 'pending';
      gameCount: number;
      lastDiscoveredAt?: string;
      entry?: PlatformDiscoveryEntry;
    }>();
    const entriesByKey = new Map<string, MiSTerScanEntry[]>();
    lastScanEntries.forEach((entry) => {
      const key = `${entry.platformGroup}/${entry.systemId}`;
      entriesByKey.set(key, [...(entriesByKey.get(key) ?? []), entry]);
    });
    unknownScannedPlatforms.forEach(([key, entry]) => {
      const entries = entriesByKey.get(key) ?? [];
      rows.set(key, {
        key,
        name: entry.systemId,
        path: entry.absolutePath.split('/').slice(0, -1).join('/'),
        status: savedDiscoveredPlatformState(key),
        gameCount: entries.length,
        lastDiscoveredAt: entry.lastSyncedAt,
        entry,
      });
    });
    return Array.from(rows.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [lastScanEntries, savedDiscoveredPlatformState, unknownScannedPlatforms]);

  const globalImportGroups = useMemo(() => {
    const groups = new Map<string, MiSTerPlatformCatalogItem[]>();
    globalImportPlatforms.forEach((item) => {
      groups.set(item.platformGroup, [...(groups.get(item.platformGroup) ?? []), item]);
    });
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [globalImportPlatforms]);

  const tagPlatformBuckets = useMemo(() => {
    const buckets = new Map<string, { key: string; label: string; count: number }>();
    visibleLibraryEntries.forEach((entry) => {
      const key = `${entry.platformGroup}/${entry.systemId}`;
      const current = buckets.get(key) ?? { key, label: key, count: 0 };
      current.count += 1;
      buckets.set(key, current);
    });
    return Array.from(buckets.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [visibleLibraryEntries]);

  const tagPickerEntries = useMemo(() => {
    if (!tagPickerPlatform) return [];
    const normalizedQuery = normalizeName(tagPickerQuery);
    return sortEntries(
      visibleLibraryEntries.filter((entry) => {
        if (`${entry.platformGroup}/${entry.systemId}` !== tagPickerPlatform) return false;
        if (!normalizedQuery) return true;
        return normalizeName(`${entry.title} ${entry.romName} ${entry.relativePath}`).includes(normalizedQuery);
      }),
      'title',
    );
  }, [tagPickerPlatform, tagPickerQuery, visibleLibraryEntries]);

  const tagCardEntries = useMemo(() => {
    const normalizedQuery = normalizeName(tagCardQuery);
    const indexSource = savedCardIndex.length > 0
      ? savedCardIndex
      : savedCards.map((record) => ({
          id: record.id,
          title: record.title,
          categoryId: record.categoryId,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          favorite: record.favorite,
          deletedAt: record.deletedAt,
          mister: record.mister,
        }));
    return indexSource
      .filter((record) => !record.deletedAt)
      .filter((record) => {
        if (!normalizedQuery) return true;
        return normalizeName(`${record.title} ${record.mister?.misterSystemId ?? ''} ${record.mister?.misterRelativePath ?? ''}`).includes(normalizedQuery);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 200);
  }, [savedCardIndex, savedCards, tagCardQuery]);

  // Paginate by GAME GROUP; pageEntries are the representatives so selection/shift-range keep working on them.
  const pageGroups = gameGroups.slice((page - 1) * pageSize, page * pageSize);
  const pageEntries = pageGroups.map((group) => group.representative);
  const libraryPlatformCount = new Set(zaparooLibrary.entries.map((entry) => `${entry.platformGroup}/${entry.systemId}`)).size;

  function setGameRepresentative(gameKey: string, entryId: string) {
    setRepresentativeByGame((current) => {
      const next = { ...current, [gameKey]: entryId };
      try { window.localStorage.setItem('hello-mister-v2:library-representatives', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  function toggleGameVersions(gameKey: string) {
    setExpandedGameKeys((current) => {
      const next = new Set(current);
      if (next.has(gameKey)) next.delete(gameKey); else next.add(gameKey);
      return next;
    });
  }

  function togglePlatformGroup(group: string) {
    setCollapsedPlatformGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group); else next.add(group);
      return next;
    });
  }

  function toggleFavoritePlatform(key: string) {
    setFavoritePlatforms((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { window.localStorage.setItem('hello-mister-v2:favorite-platforms', JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }

  const platformRow = (bucket: { key: string; shortLabel: string; count: number; gameCount: number; cardCount: number }, keyPrefix: string) => {
    const isFav = favoritePlatforms.has(bucket.key);
    const selected = selectedPlatform === bucket.key;
    return (
      <div
        key={`${keyPrefix}:${bucket.key}`}
        className={`relative rounded-md ${selected ? 'bg-primary text-white shadow-selected' : 'border border-line bg-white hover:bg-blue-50'}`}
      >
        <button
          type="button"
          onClick={() => setSelectedPlatform(bucket.key)}
          className="block w-full min-w-0 px-3 py-1.5 pr-7 text-left text-sm"
        >
          <span className="block truncate font-medium">{bucket.shortLabel}</span>
          <span className="block truncate text-xs opacity-80">게임 {bucket.gameCount}개 · 버전 {bucket.count}개{bucket.cardCount > 0 ? ` · 카드 ${bucket.cardCount}` : ''}</span>
        </button>
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); toggleFavoritePlatform(bucket.key); }}
          title={isFav ? '즐겨찾기 해제' : '즐겨찾기로 상단 고정'}
          aria-label={isFav ? '즐겨찾기 해제' : '즐겨찾기'}
          className={`absolute right-1 top-1 leading-none ${isFav ? 'text-amber-400' : selected ? 'text-white/60 hover:text-amber-200' : 'text-neutral-300 hover:text-amber-400'}`}
        >
          {isFav ? '★' : '☆'}
        </button>
      </div>
    );
  };

  function updateConnectionStep(label: string, state: 'pending' | 'active' | 'done' | 'failed') {
    setConnectionSteps((current) => {
      const existingIndex = current.findIndex((step) => step.label === label);
      if (existingIndex === -1) return [...current, { label, state }];
      return current.map((step, index) => (index === existingIndex ? { ...step, state } : step));
    });
  }

  function updateConnectionConfigForUi(patch: Partial<MiSTerConnectionConfig>) {
    const nextConfig = { ...mister.connection.config, ...patch };
    const connectionTargetChanged =
      (patch.host !== undefined && patch.host !== mister.connection.config.host)
      || (patch.port !== undefined && patch.port !== mister.connection.config.port)
      || (patch.username !== undefined && patch.username !== mister.connection.config.username);
    if (connectionTargetChanged && mister.connection.connectionId) {
      void new HttpMiSTerBridgeClient().disconnect(mister.connection.connectionId).catch(() => undefined);
      setMiSTerConnection({
        status: 'idle',
        connectionId: undefined,
        message: `연결 대상이 ${nextConfig.host}:${nextConfig.port}로 변경되어 기존 MiSTer 세션을 닫았습니다. 다시 연결하세요.`,
      });
      setConnectionSteps([]);
      setMessage(`연결 대상이 ${nextConfig.host}:${nextConfig.port}로 변경되었습니다. 연결을 다시 눌러 새 MiSTer에 접속하세요.`);
    }
    updateMiSTerConnectionConfig(patch);
  }

  async function resetScanFilterConfig() {
    try {
      const result = await new HttpMiSTerBridgeClient().resetScanFilterConfig();
      setScanFilterConfig({ config: result.config, source: result.source, path: result.path, lastSavedAt: result.lastSavedAt });
      setScanFilterMessage('MiSTer scan filter config를 기본값으로 되돌렸습니다.');
    } catch (error) {
      setScanFilterMessage(error instanceof Error ? error.message : 'MiSTer scan filter config 초기화에 실패했습니다.');
    }
  }

  function updateScanFilterConfig(patch: Partial<MiSTerScanFilterConfig['misterScan']>) {
    setScanFilterConfig((current) => {
      if (!current) return current;
      return {
        ...current,
        config: {
          ...current.config,
          misterScan: {
            ...current.config.misterScan,
            ...patch,
          },
        },
      };
    });
  }

  function parseConfigList(value: string) {
    return value
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  async function saveScanFilterConfig() {
    if (!scanFilterConfig) return;
    try {
      const result = await new HttpMiSTerBridgeClient().saveScanFilterConfig(scanFilterConfig.config);
      setScanFilterConfig({ config: result.config, source: result.source, path: result.path, lastSavedAt: result.lastSavedAt });
      setScanFilterMessage('MiSTer scan filter config를 저장했습니다.');
    } catch (error) {
      setScanFilterMessage(error instanceof Error ? error.message : 'MiSTer scan filter config 저장에 실패했습니다.');
    }
  }

  function exportScanFilterConfig() {
    if (!scanFilterConfig) return;
    const blob = new Blob([JSON.stringify(scanFilterConfig.config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'mister-scan-filters.json';
    anchor.click();
    URL.revokeObjectURL(url);
    setScanFilterMessage('MiSTer scan filter config를 내보냈습니다.');
  }

  async function importScanFilterConfig(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as MiSTerScanFilterConfig;
      const result = await new HttpMiSTerBridgeClient().saveScanFilterConfig(parsed);
      setScanFilterConfig({ config: result.config, source: result.source, path: result.path, lastSavedAt: result.lastSavedAt });
      setScanFilterMessage('MiSTer scan filter config를 가져와 저장했습니다.');
    } catch (error) {
      setScanFilterMessage(error instanceof Error ? error.message : 'MiSTer scan filter config 가져오기에 실패했습니다.');
    }
  }

  async function openScanFilterConfigFolder() {
    try {
      const result = await new HttpMiSTerBridgeClient().openScanFilterConfigFolder();
      setScanFilterMessage(result.message ?? 'MiSTer scan filter config 폴더를 열었습니다.');
    } catch {
      if (scanFilterConfig?.path && navigator.clipboard) {
        await navigator.clipboard.writeText(scanFilterConfig.path).catch(() => undefined);
        setScanFilterMessage('브라우저 fallback 모드에서는 폴더를 직접 열 수 없어 config 경로를 복사했습니다.');
        return;
      }
      setScanFilterMessage('이 실행 모드에서는 config 폴더 열기를 사용할 수 없습니다.');
    }
  }

  async function handleConnectionTest() {
    if (mister.connection.bridgeUrl) setMiSTerBridgeUrl(mister.connection.bridgeUrl);
    const targetConfig = connectionConfigForRequest(mister.connection.config);
    if (mister.connection.connectionId) {
      await new HttpMiSTerBridgeClient().disconnect(mister.connection.connectionId).catch(() => undefined);
      setMiSTerConnection({ connectionId: undefined, status: 'idle' });
    }
    const initialSteps = ['브리지 상태 확인', 'MiSTer 연결', '인증', '필수 경로 확인', 'NFC 서비스 감지', '완료'];
    setConnectionSteps(initialSteps.map((label, index) => ({ label, state: index === 0 ? 'active' : 'pending' })));
    setMiSTerConnection({ status: 'testing', bridgeEnabled: true, message: `${targetConfig.host}:${targetConfig.port}에 연결 중... (${mister.connection.bridgeUrl ?? getMiSTerBridgeUrl()})` });
    const adapter = new BridgeMiSTerConnectionAdapter();
    try {
      updateConnectionStep('브리지 상태 확인', 'done');
      updateConnectionStep('MiSTer 연결', 'active');
      const result = await testMiSTerConnection(targetConfig, adapter);
      const connected = result.status === 'connected';
      updateConnectionStep('MiSTer 연결', connected ? 'done' : 'failed');
      updateConnectionStep('인증', connected ? 'done' : 'failed');
      updateConnectionStep('필수 경로 확인', connected ? 'done' : 'failed');
      updateConnectionStep('NFC 서비스 감지', connected ? 'done' : 'failed');
      updateConnectionStep('완료', connected ? 'done' : 'failed');
      setMiSTerConnection({ ...result, lastTestedAt: new Date().toISOString() });
      setMessage(result.connectionId ? `${targetConfig.host} 연결 완료. 게임 리스트 동기화와 NFC 작업에 사용할 MiSTer 연결이 준비되었습니다.` : (result.message ?? `${targetConfig.host} 연결 완료.`));
    } catch (error) {
      const message = `${targetConfig.host} 연결 실패: ${error instanceof Error ? error.message : '연결에 실패했습니다.'}`;
      updateConnectionStep('완료', 'failed');
      setMiSTerConnection({ status: 'failed', message, lastTestedAt: new Date().toISOString() });
      setMessage(message);
    }
  }

  async function handleDisconnect() {
    const connectionId = mister.connection.connectionId;
    try {
      if (connectionId) await new HttpMiSTerBridgeClient().disconnect(connectionId);
      setMiSTerConnection({
        status: 'idle',
        connectionId: undefined,
        message: 'MiSTer 연결이 해제되었습니다. Library Sync와 NFC read/write를 사용하려면 다시 연결하세요.',
      });
      setConnectionSteps([]);
      setMessage('MiSTer 연결이 해제되었습니다.');
    } catch (error) {
      const message = error instanceof Error ? error.message : '연결 해제에 실패했습니다.';
      setMiSTerConnection({ status: 'failed', connectionId: undefined, message });
      setMessage(message);
    }
  }

  async function handleBridgeScan() {
    try {
      setSelectedImportPlatformKeys([]);
      setLastScanEntries([]);
      setScanPreviewEntries([]);
      setDiscoveredPlatformSelectedKeys([]);
      if (mister.connection.bridgeUrl) setMiSTerBridgeUrl(mister.connection.bridgeUrl);
      const hydratedActiveMister = activeMister ?? await window.helloMisterDesktop?.getActiveMisterProfile?.().catch(() => undefined);
      // Derive scan target from the EXPLICIT selection, not the (possibly stale) active-mister React state, so the
      // scanned device and the identity entries are tagged with always match (otherwise .6's games merge under .11).
      const scanTargetDevice = connectedDevices.find((device) => device.deviceId === selectedTargetDeviceId);
      const scanConnectionId = scanTargetDevice?.sessionId ?? (mister.connection.connectionId || hydratedActiveMister?.sessionId);
      const scanConfig: MiSTerConnectionConfig = scanTargetDevice?.config ?? (mister.connection.connectionId
        ? mister.connection.config
        : hydratedActiveMister
          ? connectionConfigFromActiveProfile(hydratedActiveMister)
          : activeConnectionConfig());
      const scanIdentity: DeviceIdentityInput = scanTargetDevice
        ? {
            profileId: scanTargetDevice.profileId,
            hostname: scanTargetDevice.hostname,
            macAddress: scanTargetDevice.macAddress,
            sdCid: scanTargetDevice.sdCid,
            host: scanTargetDevice.config.host,
            port: scanTargetDevice.config.port,
            username: scanTargetDevice.config.username,
          }
        : scanDeviceIdentity(hydratedActiveMister, scanConfig);
      if (!mister.connection.connectionId && hydratedActiveMister) {
        setMiSTerConnection({
          status: scanConnectionId ? 'connected' : 'testing',
          connectionId: scanConnectionId,
          config: scanConfig,
          message: '게임 리스트 동기화에 선택한 MiSTer를 사용합니다.',
        });
      }
      if (!hydratedActiveMister && !mister.connection.connectionId) {
        setBridgeScanStatus((current) => ({
          ...current,
          phase: 'failed',
          message: 'MiSTer 연결이 필요합니다. 먼저 MiSTer 연결 메뉴에서 연결하세요.',
        }));
        setMessage('MiSTer 연결이 필요합니다. 먼저 MiSTer 연결 메뉴에서 연결하세요.');
        return;
      }

      setBridgeScanStatus({
        phase: 'checking',
        message: '연결된 MiSTer 상태를 확인하는 중...',
        rootStatuses: [],
        platformStatuses: [],
        scannedEntries: 0,
        rawFilesScanned: 0,
        skippedFiles: 0,
        executableGames: 0,
        nonExecutableEntries: 0,
        filteredEntries: 0,
        candidateEntries: 0,
        mergedEntries: 0,
        skippedDuplicates: 0,
      });
      setMessage('게임 리스트 동기화: 연결된 MiSTer 상태를 확인하는 중...');

      setBridgeScanStatus((current) => ({ ...current, phase: 'scanning', message: '/media/fat/games 및 /media/fat/_Arcade 폴더를 읽는 중...' }));
      const result = await new HttpMiSTerBridgeClient().scanLibrary(scanConfig, scanConnectionId);
      if (!result.ok) {
        throw new Error(result.message || 'MiSTer의 /media/fat/games 또는 /media/fat/_Arcade 폴더를 읽지 못했습니다.');
      }
      if (result.sessionId && !mister.connection.connectionId) {
        setMiSTerConnection({
          status: 'connected',
          connectionId: result.sessionId,
          config: scanConfig,
          message: '게임 리스트 동기화가 v2 active MiSTer 연결을 사용했습니다.',
        });
      }
      setLastScanEntries(result.entries);
      const enabledEntries = autoMergeAfterScan
        ? result.entries.filter((entry) => selectedImportPlatformSet.has(scanEntryPlatformKey(entry)))
        : [];
      const filteredEntries = result.entries.length - enabledEntries.length;
      const existingIds = new Set(zaparooLibrary.entries.map((entry) => entry.id));
      const existingPathKeys = libraryAbsolutePathKeys(zaparooLibrary.entries);
      const skippedDuplicates = enabledEntries.filter((entry) =>
        existingIds.has(zaparooLibraryEntryIdForMiSTerEntry(entry))
        || existingPathKeys.has(normalizedMiSTerPathKey(entry.absolutePath)),
      ).length;
      const mergeCandidates = Math.max(0, enabledEntries.length);
      const mergedEntries = Math.max(0, enabledEntries.length - skippedDuplicates);
      const rawFilesScanned = result.summary?.rawFilesScanned ?? result.rootStatuses?.reduce((total, root) => total + (root.rawFilesScanned ?? root.fileCount), 0) ?? result.entries.length;
      const skippedFiles = result.summary?.skippedFiles ?? result.rootStatuses?.reduce((total, root) => (
        total + (root.tinyFileSkippedCount ?? 0) + (root.extensionSkippedCount ?? 0) + (root.ignoredDirectorySkippedCount ?? 0)
      ), 0) ?? 0;
      const executableGames = result.summary?.executableGames ?? result.entries.filter((entry) => entry.playable !== false && !entry.bios && !entry.firmware && !entry.systemFile && !entry.ignored).length;
      const nonExecutableEntries = result.summary?.nonExecutableEntries ?? Math.max(0, result.entries.length - executableGames);
      const platformStatuses = buildPlatformScanStatuses(result.entries, selectedImportPlatformSet, existingPathKeys);

      if (!autoMergeAfterScan || enabledEntries.length === 0) {
        setScanPreviewEntries(enabledEntries);
        setBridgeScanStatus({
          phase: 'done',
          message: `스캔 완료 · 후보 ${mergeCandidates}개`,
          rootStatuses: result.rootStatuses ?? [],
          platformStatuses,
          scannedEntries: result.entries.length,
          rawFilesScanned,
          skippedFiles,
          executableGames,
          nonExecutableEntries,
          filteredEntries,
          candidateEntries: mergeCandidates,
          mergedEntries: 0,
          skippedDuplicates,
        });
        setMessage('');
        return;
      }

      setBridgeScanStatus((current) => ({
        ...current,
        phase: 'merging',
        message: `필터를 통과한 ${mergeCandidates}개 항목을 미스터 게임 리스트에 병합하는 중...`,
        rootStatuses: result.rootStatuses ?? [],
        platformStatuses,
        scannedEntries: result.entries.length,
        rawFilesScanned,
        skippedFiles,
        executableGames,
        nonExecutableEntries,
        filteredEntries,
        candidateEntries: mergeCandidates,
      }));

      // Per-device refresh: pass the FULL scan so prune sees the device's true state; only import the
      // selected platforms (importAllowlistIds). Prune removes this device's games that disappeared.
      refreshMiSTerEntriesForDevice(result.entries, scanIdentity, {
        scanSource: 'bridge-scan',
        importAllowlistIds: enabledEntries.map((entry) => entry.id),
        config: scanConfig,
      });
      setLastScanEntries([]);
      setSelectedImportPlatformKeys([]);
      setScanPreviewEntries([]);
      setSelectedIds([]);
      setSelectedPlatform('');
      setActiveSection('browser');
      setBridgeScanStatus({
        phase: 'done',
        message: `완료. ${result.entries.length}개 스캔, 필터 제외 ${filteredEntries}개, 새 항목 ${mergedEntries}개 병합, 중복 ${skippedDuplicates}개 업데이트/건너뜀.`,
        rootStatuses: result.rootStatuses ?? [],
        platformStatuses,
        scannedEntries: result.entries.length,
        rawFilesScanned,
        skippedFiles,
        executableGames,
        nonExecutableEntries,
        filteredEntries,
        candidateEntries: mergeCandidates,
        mergedEntries,
        skippedDuplicates,
      });
      setMessage('');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'MiSTer의 /media/fat/games 또는 /media/fat/_Arcade 폴더를 읽지 못했습니다. 파일/붙여넣기 가져오기는 계속 사용할 수 있습니다.';
      setBridgeScanStatus((current) => ({ ...current, phase: 'failed', message: errorMessage }));
      setMessage(errorMessage);
    }
  }

  function mergeScanPreviewToLibrary() {
    if (scanPreviewEntries.length === 0) {
      setMessage('먼저 연결된 MiSTer 스캔을 실행하세요.');
      return;
    }
    const existingIds = new Set(zaparooLibrary.entries.map((entry) => entry.id));
    const existingPathKeys = libraryAbsolutePathKeys(zaparooLibrary.entries);
    const skippedDuplicates = scanPreviewEntries.filter((entry) =>
      existingIds.has(zaparooLibraryEntryIdForMiSTerEntry(entry))
      || existingPathKeys.has(normalizedMiSTerPathKey(entry.absolutePath)),
    ).length;
    const mergedEntries = Math.max(0, scanPreviewEntries.length - skippedDuplicates);
    setBridgeScanStatus((current) => ({ ...current, phase: 'merging', message: `${scanPreviewEntries.length}개 항목을 미스터 게임 리스트에 병합하는 중...` }));
    // Import only the previewed selection, but prune against the full scan so this device's removed games drop.
    const fullScanForPrune = lastScanEntries.length > 0 ? lastScanEntries : scanPreviewEntries;
    const previewDevice = connectedDevices.find((device) => device.deviceId === selectedTargetDeviceId);
    const previewIdentity: DeviceIdentityInput = previewDevice
      ? {
          profileId: previewDevice.profileId,
          hostname: previewDevice.hostname,
          macAddress: previewDevice.macAddress,
          sdCid: previewDevice.sdCid,
          host: previewDevice.config.host,
          port: previewDevice.config.port,
          username: previewDevice.config.username,
        }
      : scanDeviceIdentity(effectiveActiveMister, mister.connection.config);
    refreshMiSTerEntriesForDevice(fullScanForPrune, previewIdentity, {
      scanSource: 'bridge-scan',
      importAllowlistIds: scanPreviewEntries.map((entry) => entry.id),
      config: previewDevice?.config ?? mister.connection.config,
    });
    setLastScanEntries([]);
    setSelectedImportPlatformKeys([]);
    setScanPreviewEntries([]);
    setSelectedIds([]);
    setSelectedPlatform('');
    setActiveSection('browser');
    setBridgeScanStatus((current) => ({
      ...current,
      phase: 'done',
      message: `새 항목 ${mergedEntries}개 · 중복 ${skippedDuplicates}개`,
      mergedEntries,
      skippedDuplicates,
    }));
    setMessage('');
  }

  function selectProfile(profileId: string) {
    setZaparooLibrary(setActiveZaparooProfile(zaparooLibrary, profileId));
    setMessage('활성 MiSTer profile을 선택했습니다.');
  }

  // Per-MiSTer library delete (clean up an unused device). window.confirm is unreliable in Electron, so
  // confirm through an in-app modal (deleteProfileTarget) instead.
  function requestDeleteProfile(profileId: string) {
    if (zaparooLibrary.profiles.some((candidate) => candidate.deviceId === profileId)) setDeleteProfileTarget(profileId);
  }

  function confirmDeleteProfile() {
    const profileId = deleteProfileTarget;
    setDeleteProfileTarget(null);
    if (!profileId) return;
    const profile = zaparooLibrary.profiles.find((candidate) => candidate.deviceId === profileId);
    if (!profile) return;
    setZaparooLibrary(removeMiSTerProfileFromZaparooLibrary(zaparooLibrary, profileId));
    setSelectedIds([]);
    setSelectedPlatform('');
    if (libraryDeviceFilter === profileId) setLibraryDeviceFilter('__all__');
    setMessage(`${misterDisplayName(profile)} 라이브러리를 삭제했습니다. 다른 미스터에도 있는 게임과 저장된 카드는 유지됩니다.`);
  }

  function resetZaparooLibrary() {
    const confirmed = window.confirm(
      '미스터 게임 리스트를 초기화할까요?\n\n초기화 대상:\n- 병합된 미스터 게임 리스트 entries\n- 카드 생성 상태 링크\n- MiSTer Library 병합 결과/profile\n\nCard Album에 저장된 카드는 삭제하지 않습니다.',
    );
    if (!confirmed) return;
    setZaparooLibrary({
      ...emptyZaparooLibraryState,
      importDisabledPlatformKeys: zaparooLibrary.importDisabledPlatformKeys ?? [],
      importEnabledPlatformKeys: zaparooLibrary.importEnabledPlatformKeys ?? [],
      customPlatformCatalog: zaparooLibrary.customPlatformCatalog ?? [],
      ignoredUnknownPlatformKeys: zaparooLibrary.ignoredUnknownPlatformKeys ?? [],
      updatedAt: new Date().toISOString(),
    });
    setSelectedIds([]);
    setSelectedPlatform('');
    setMessage('미스터 게임 리스트를 초기화했습니다. 저장된 카드는 유지됩니다.');
  }


  function showPlatform(platformKey: string) {
    setZaparooLibrary({
      ...zaparooLibrary,
      hiddenPlatformKeys: (zaparooLibrary.hiddenPlatformKeys ?? []).filter((key) => key !== platformKey),
      updatedAt: new Date().toISOString(),
    });
    setMessage(`${platformKey} platform을 다시 표시합니다.`);
  }

  function updateProfileAlias(profileId: string, alias: string) {
    setZaparooLibrary(updateMiSTerProfileInZaparooLibrary(zaparooLibrary, profileId, { alias: alias.trim() || undefined }));
    setMessage('MiSTer profile 별칭을 저장했습니다.');
  }

  function toggleGlobalPlatformImport(platformKey: string, enabled: boolean) {
    setSelectedImportPlatformKeys((current) => {
      const selected = new Set(current);
      if (enabled) selected.add(platformKey);
      else selected.delete(platformKey);
      return Array.from(selected).sort();
    });
    setMessage(enabled ? `${platformKey} 플랫폼을 이번 가져오기 대상으로 선택했습니다.` : `${platformKey} 플랫폼을 이번 가져오기 대상에서 제외했습니다.`);
  }

  function selectAllVisibleImportPlatforms() {
    const visibleKeys = globalImportPlatforms.map((platform) => platform.platformKey);
    setSelectedImportPlatformKeys((current) => Array.from(new Set([...current, ...visibleKeys])).sort());
    setMessage('현재 보이는 플랫폼을 이번 가져오기 대상으로 선택했습니다.');
  }

  function clearSelectedImportPlatforms() {
    setSelectedImportPlatformKeys([]);
    setMessage('이번 가져오기 대상 플랫폼을 모두 해제했습니다.');
  }

  function catalogItemForDiscoveredPlatform(platformKey: string, entry?: PlatformDiscoveryEntry, enabled = true, overrides: Partial<MiSTerPlatformCatalogItem> = {}) {
    const displayName = overrides.displayName ?? entry?.systemId ?? platformKey.split('/').pop() ?? platformKey;
    const systemId = overrides.systemId ?? entry?.systemId ?? displayName;
    const coreFolderName = overrides.coreFolderName ?? (entry?.folderName || entry?.systemId || platformKey.split('/').pop() || platformKey);
    const sourceRoot = sourceRootForDiscovery(entry);
    const aliases = overrides.aliases ?? Array.from(new Set([displayName, systemId, entry?.folderName].filter(Boolean) as string[]));
    const sourceRoots = overrides.sourceRoots ?? (sourceRoot ? [sourceRoot] : []);
    const now = new Date().toISOString();
    const item: MiSTerPlatformCatalogItem = {
      platformKey,
      displayName,
      systemId,
      coreFolderName,
      platformGroup: overrides.platformGroup ?? entry?.platformGroup ?? 'Other',
      defaultImportEnabled: enabled,
      knownExtensions: overrides.knownExtensions ?? ['.zip'],
      sourceNote: '스캔 결과에서 사용자가 추가한 platform입니다.',
      custom: true,
      platformId: overrides.platformId ?? `custom-${safePlatformSlug(systemId)}`,
      aliases,
      sourceRoots,
      parentSystem: overrides.parentSystem ?? entry?.platformGroup,
      type: overrides.type ?? 'custom',
      cardCategory: overrides.cardCategory ?? entry?.platformGroup ?? 'Other',
      createdAt: overrides.createdAt ?? now,
      updatedAt: now,
    };
    return { ...item, ...overrides, defaultImportEnabled: enabled, updatedAt: now };
  }

  function setDiscoveredPlatformImportState(platformKey: string, entry: PlatformDiscoveryEntry | undefined, state: 'enabled' | 'disabled' | 'ignored' | 'pending') {
    const disabled = new Set(zaparooLibrary.importDisabledPlatformKeys ?? []);
    const enabledOverrides = new Set(zaparooLibrary.importEnabledPlatformKeys ?? []);
    const ignored = new Set(zaparooLibrary.ignoredUnknownPlatformKeys ?? []);
    const currentCatalog = (zaparooLibrary.customPlatformCatalog ?? []).filter((candidate) => candidate.platformKey !== platformKey);
    let nextCatalog = currentCatalog;

    if (state === 'enabled' || state === 'disabled') {
      const item = catalogItemForDiscoveredPlatform(platformKey, entry, state === 'enabled');
      nextCatalog = [...currentCatalog, item].sort((a, b) => a.platformKey.localeCompare(b.platformKey));
      ignored.delete(platformKey);
      if (state === 'enabled') {
        disabled.delete(platformKey);
        enabledOverrides.add(platformKey);
      } else {
        disabled.add(platformKey);
        enabledOverrides.delete(platformKey);
      }
    }

    if (state === 'ignored') {
      ignored.add(platformKey);
      disabled.add(platformKey);
      enabledOverrides.delete(platformKey);
    }

    if (state === 'pending') {
      ignored.delete(platformKey);
      disabled.add(platformKey);
      enabledOverrides.delete(platformKey);
      if (entry) nextCatalog = [...currentCatalog, catalogItemForDiscoveredPlatform(platformKey, entry, false)].sort((a, b) => a.platformKey.localeCompare(b.platformKey));
    }

    setZaparooLibrary({
      ...zaparooLibrary,
      customPlatformCatalog: nextCatalog,
      ignoredUnknownPlatformKeys: Array.from(ignored).sort(),
      importDisabledPlatformKeys: Array.from(disabled).sort(),
      importEnabledPlatformKeys: Array.from(enabledOverrides).sort(),
      updatedAt: new Date().toISOString(),
    });
    setMessage(`${platformKey} platform 상태를 ${state}로 저장했습니다.`);
  }

  function openCustomPlatformRegistration(row: { key: string; name: string; path: string; entry?: PlatformDiscoveryEntry }) {
    const entries = lastScanEntries.filter((entry) => scanEntryPlatformKey(entry) === row.key);
    const extensions = extensionListForEntries(entries);
    const rawName = row.entry?.systemId ?? row.name;
    const normalized = normalizeName(rawName).replace(/\s+/g, '');
    const aliases = normalized === 'pgm'
      ? ['PGM', 'IGS PGM', 'PolyGame Master']
      : [rawName];
    setCustomPlatformDraft({
      platformKey: row.key,
      platformId: `custom-${safePlatformSlug(rawName)}`,
      displayName: rawName,
      aliases: aliases.join(', '),
      sourceRoot: sourceRootForDiscovery(row.entry) || row.path,
      coreRoot: row.entry?.platformGroup === 'Arcade' ? '/media/fat/_Arcade/cores' : '',
      parentSystem: row.entry?.platformGroup ?? 'Other',
      extensions: (extensions.length > 0 ? extensions : ['.zip']).join(', '),
      scanDepth: 2,
      recursive: false,
      cardCategory: row.entry?.platformGroup ?? 'Other',
      launchTemplate: '**launch:{misterPath}',
      entry: row.entry,
    });
  }

  function openManualCustomPlatformRegistration() {
    setCustomPlatformDraft(defaultCustomPlatformDraft());
  }

  function mapCustomPlatformEntry(item: MiSTerPlatformCatalogItem, entry: MiSTerScanEntry) {
    const mapped = {
      ...entry,
      platformGroup: item.platformGroup,
      systemId: item.displayName,
      folderName: item.coreFolderName || item.displayName,
      resolvedMiSTerPath: entry.absolutePath,
      nfcPayload: (item.launchTemplate || '**launch:{misterPath}').replace('{misterPath}', entry.absolutePath),
      nfcPayloadSource: 'resolvedMiSTerPath' as const,
      playable: true,
      bios: false,
      firmware: false,
      systemFile: false,
      ignored: false,
      launchReady: true,
      pathValid: true,
    };
    return {
      ...mapped,
      id: zaparooLibraryEntryIdForMiSTerEntry(mapped),
    };
  }

  function customPlatformCandidateEntries(item: MiSTerPlatformCatalogItem) {
    const sourceRootPrefixes = (item.sourceRoots ?? []).map((sourceRoot) => normalizeMiSTerPathForPrefix(sourceRoot)).filter(Boolean);
    const knownExtensions = (item.knownExtensions ?? []).map((extension) => (extension.startsWith('.') ? extension : `.${extension}`).toLowerCase());
    const cachedDirectScanEntries = customPlatformSourceScans[item.platformKey]?.entries ?? [];
    return dedupeScanEntriesByPath([...lastScanEntries, ...cachedDirectScanEntries])
      .filter((entry) => entryMatchesCustomPlatformSource(entry, sourceRootPrefixes, item.scanDepth ?? 2, item.recursive ?? false))
      .filter((entry) => {
        if (knownExtensions.length === 0) return true;
        const extension = extensionForScanEntry(entry);
        return extension ? knownExtensions.includes(extension) : false;
      })
      .map((entry) => mapCustomPlatformEntry(item, entry));
  }

  function customPlatformDraftCandidateCount(draft: CustomPlatformRegistrationDraft) {
    const sourceRootPrefixes = parseCommaList(draft.sourceRoot).map((sourceRoot) => sourceRoot.replace(/\/+$/g, '')).filter(Boolean);
    const knownExtensions = normalizedExtensionList(draft.extensions);
    return lastScanEntries
      .filter((entry) => entryMatchesCustomPlatformSource(entry, sourceRootPrefixes, draft.scanDepth, draft.recursive))
      .filter((entry) => {
        if (knownExtensions.length === 0) return true;
        const extension = extensionForScanEntry(entry);
        return extension ? knownExtensions.includes(extension) : false;
      })
      .length;
  }

  async function refreshCustomPlatformSourceScan(platformKey: string) {
    const item = (zaparooLibrary.customPlatformCatalog ?? []).find((candidate) => candidate.platformKey === platformKey);
    if (!item) {
      setMessage('먼저 커스텀 플랫폼을 등록하세요.');
      return [] as MiSTerScanEntry[];
    }
    setCustomPlatformSourceScans((current) => ({
      ...current,
      [platformKey]: {
        phase: 'scanning',
        message: `${item.displayName} sourceRoot를 직접 스캔하는 중입니다.`,
        entries: current[platformKey]?.entries ?? [],
        rootStatuses: [],
        rawFilesScanned: 0,
        skippedFiles: 0,
        diagnostics: current[platformKey]?.diagnostics,
      },
    }));
    const result = await new HttpMiSTerBridgeClient().scanCustomPlatformSource(activeConnectionConfig(), item, activeConnectionId());
    const mappedEntries = result.entries.map((entry) => mapCustomPlatformEntry(item, entry));
    setCustomPlatformSourceScans((current) => ({
      ...current,
      [platformKey]: {
        phase: result.ok ? 'done' : 'failed',
        message: result.message || (mappedEntries.length > 0 ? `${item.displayName} 후보 ${mappedEntries.length}개를 찾았습니다.` : `${item.displayName} 후보가 없습니다.`),
        entries: mappedEntries,
        rootStatuses: result.rootStatuses ?? [],
        rawFilesScanned: result.summary?.rawFilesScanned ?? result.paths?.length ?? mappedEntries.length,
        skippedFiles: result.summary?.skippedFiles ?? 0,
        diagnostics: result.customPlatformDiagnostics,
        scannedAt: new Date().toISOString(),
      },
    }));
    if (mappedEntries.length > 0) {
      setLastScanEntries((current) => dedupeScanEntriesByPath([...current, ...mappedEntries]));
    }
    setBridgeScanStatus((current) => ({
      ...current,
      phase: result.ok ? 'done' : 'failed',
      message: result.message || current.message,
      rootStatuses: result.rootStatuses ?? current.rootStatuses,
      platformStatuses: buildPlatformScanStatuses(
        mappedEntries,
        new Set(mappedEntries.map((entry) => scanEntryPlatformKey(entry))),
        libraryAbsolutePathKeys(zaparooLibrary.entries),
      ),
      scannedEntries: mappedEntries.length,
      rawFilesScanned: result.summary?.rawFilesScanned ?? result.paths?.length ?? mappedEntries.length,
      skippedFiles: result.summary?.skippedFiles ?? current.skippedFiles,
      executableGames: mappedEntries.length,
      nonExecutableEntries: 0,
      candidateEntries: mappedEntries.length,
    }));
    setMessage(result.message || `${item.displayName} sourceRoot 직접 스캔 후보 ${mappedEntries.length}개`);
    return mappedEntries;
  }

  function registerCustomPlatformFromDraft() {
    if (!customPlatformDraft) return;
    const displayName = customPlatformDraft.displayName.trim();
    if (!displayName) {
      setMessage('커스텀 플랫폼 이름을 입력하세요.');
      return;
    }
    const parentSystem = customPlatformDraft.parentSystem.trim() || customPlatformDraft.entry?.platformGroup || 'Arcade';
    const platformKey = customPlatformKey(parentSystem, displayName);
    const disabled = new Set(zaparooLibrary.importDisabledPlatformKeys ?? []);
    const enabledOverrides = new Set(zaparooLibrary.importEnabledPlatformKeys ?? []);
    const ignored = new Set(zaparooLibrary.ignoredUnknownPlatformKeys ?? []);
    const classification = new Set(zaparooLibrary.classificationFolderPlatformKeys ?? []);
    const catalog = (zaparooLibrary.customPlatformCatalog ?? []).filter((candidate) => candidate.platformKey !== platformKey);
    const sourceRoots = parseCommaList(customPlatformDraft.sourceRoot);
    const knownExtensions = normalizedExtensionList(customPlatformDraft.extensions);
    if (sourceRoots.length === 0) {
      setMessage('게임 폴더 sourceRoot를 입력하세요. 예: /media/fat/_Arcade/PGM');
      return;
    }
    const item = catalogItemForDiscoveredPlatform(platformKey, customPlatformDraft.entry, false, {
      platformId: customPlatformDraft.platformId.trim() || `custom-${safePlatformSlug(displayName)}`,
      displayName,
      systemId: displayName,
      aliases: parseCommaList(customPlatformDraft.aliases),
      sourceRoots,
      coreRoot: customPlatformDraft.coreRoot.trim() || undefined,
      launchTemplate: customPlatformDraft.launchTemplate.trim() || '**launch:{misterPath}',
      scanDepth: normalizeScanDepth(customPlatformDraft.scanDepth),
      recursive: customPlatformDraft.recursive,
      parentSystem,
      platformGroup: parentSystem as MiSTerPlatformCatalogItem['platformGroup'],
      knownExtensions,
      cardCategory: customPlatformDraft.cardCategory.trim() || parentSystem,
      type: 'custom',
      sourceNote: '게임 리스트 동기화에서 사용자가 등록한 커스텀 플랫폼입니다.',
    });
    const sourceRootEntries = customPlatformCandidateEntries(item);
    ignored.delete(platformKey);
    classification.delete(platformKey);
    disabled.add(platformKey);
    enabledOverrides.delete(platformKey);
    setSelectedImportPlatformKeys((current) => current.filter((key) => key !== platformKey));
    setDiscoveredPlatformSelectedKeys((current) => current.filter((key) => key !== platformKey));
    setZaparooLibrary({
      ...zaparooLibrary,
      customPlatformCatalog: [...catalog, item].sort((a, b) => a.platformKey.localeCompare(b.platformKey)),
      ignoredUnknownPlatformKeys: Array.from(ignored).sort(),
      classificationFolderPlatformKeys: Array.from(classification).sort(),
      importDisabledPlatformKeys: Array.from(disabled).sort(),
      importEnabledPlatformKeys: Array.from(enabledOverrides).sort(),
      updatedAt: new Date().toISOString(),
    });
    setCustomPlatformMergeKey(item.platformKey);
    setBridgeScanStatus((current) => ({
      ...current,
      phase: 'done',
      message: `${displayName} 플랫폼을 등록했습니다. 후보 ${sourceRootEntries.length}개를 확인했습니다. 라이브러리에 병합 버튼을 눌러야 게임 리스트에 추가됩니다.`,
      candidateEntries: sourceRootEntries.length,
      mergedEntries: 0,
      skippedDuplicates: 0,
    }));
    setCustomPlatformDraft(null);
    setMessage(`${displayName} 플랫폼을 등록했습니다. 자동 병합은 하지 않았습니다. 라이브러리에 병합을 눌러 선택한 sourceRoot 항목만 추가하세요.`);
  }

  async function mergeCustomPlatformToLibrary(platformKey = customPlatformMergeKey) {
    const item = (zaparooLibrary.customPlatformCatalog ?? []).find((candidate) => candidate.platformKey === platformKey);
    if (!item) {
      setMessage('먼저 커스텀 플랫폼을 등록하세요.');
      return;
    }
    let sourceRootEntries: MiSTerScanEntry[] = customPlatformCandidateEntries(item);
    if (sourceRootEntries.length === 0) {
      sourceRootEntries = await refreshCustomPlatformSourceScan(item.platformKey);
    }
    if (sourceRootEntries.length === 0) {
      setMessage(`${item.displayName} 후보가 없습니다. 먼저 연결된 MiSTer 스캔을 실행하거나 sourceRoot와 확장자를 확인하세요.`);
      setBridgeScanStatus((current) => ({ ...current, phase: 'failed', message: `${item.displayName} 후보가 없습니다. sourceRoot: ${(item.sourceRoots ?? []).join(', ') || '-'}` }));
      return;
    }
    const existingLibraryPaths = new Set(zaparooLibrary.entries.map((entry) => entry.absolutePath));
    const newCustomEntries = sourceRootEntries.filter((entry) => !existingLibraryPaths.has(entry.absolutePath));
    const skippedDuplicates = sourceRootEntries.length - newCustomEntries.length;
    const existingMisterEntriesByPath = new Map(mister.library.entries.map((entry) => [entry.absolutePath, entry]));
    newCustomEntries.forEach((entry) => existingMisterEntriesByPath.set(entry.absolutePath, entry));
    if (newCustomEntries.length > 0) {
      setMiSTerEntries(Array.from(existingMisterEntriesByPath.values()), 'bridge-scan', newCustomEntries.map((entry) => entry.id));
      setSelectedPlatform(`${item.platformGroup}/${item.displayName}`);
      setActiveSection('browser');
    }
    setBridgeScanStatus((current) => ({
      ...current,
      phase: 'done',
      message: `${item.displayName} 플랫폼 후보 ${sourceRootEntries.length}개 중 ${newCustomEntries.length}개를 라이브러리에 병합했습니다. 중복 ${skippedDuplicates}개는 건너뛰었습니다.`,
      candidateEntries: sourceRootEntries.length,
      mergedEntries: newCustomEntries.length,
      skippedDuplicates,
    }));
    setMessage(`${item.displayName} 플랫폼을 라이브러리에 병합했습니다. 새 항목 ${newCustomEntries.length}개, 중복 ${skippedDuplicates}개.`);
  }

  function mergeDiscoveredPlatformsToLibrary(platformKeys: string[]) {
    const keySet = new Set(platformKeys);
    const platformEntries = lastScanEntries.filter((entry) => keySet.has(scanEntryPlatformKey(entry)));
    if (platformEntries.length === 0) {
      setMessage('추가할 새 플랫폼 게임이 없습니다. 먼저 연결된 MiSTer 스캔을 실행하세요.');
      return;
    }
    // 발견된 플랫폼을 가져오기 상태로 저장해 발견 목록에서 가져오기로 표시되게 한다.
    const disabled = new Set(zaparooLibrary.importDisabledPlatformKeys ?? []);
    const enabledOverrides = new Set(zaparooLibrary.importEnabledPlatformKeys ?? []);
    const ignored = new Set(zaparooLibrary.ignoredUnknownPlatformKeys ?? []);
    platformKeys.forEach((key) => {
      disabled.delete(key);
      ignored.delete(key);
      enabledOverrides.add(key);
    });
    setZaparooLibrary({
      ...zaparooLibrary,
      ignoredUnknownPlatformKeys: Array.from(ignored).sort(),
      importDisabledPlatformKeys: Array.from(disabled).sort(),
      importEnabledPlatformKeys: Array.from(enabledOverrides).sort(),
      updatedAt: new Date().toISOString(),
    });

    const existingLibraryPaths = new Set(zaparooLibrary.entries.map((entry) => entry.absolutePath));
    const newEntries = platformEntries.filter((entry) => !existingLibraryPaths.has(entry.absolutePath));
    const skippedDuplicates = platformEntries.length - newEntries.length;
    const existingMisterEntriesByPath = new Map(mister.library.entries.map((entry) => [entry.absolutePath, entry]));
    platformEntries.forEach((entry) => existingMisterEntriesByPath.set(entry.absolutePath, entry));
    // 새 플랫폼은 가져오기 비활성 기본값에 막히지 않도록 forceImportEntryIds로 즉시 강제 병합한다.
    setMiSTerEntries(Array.from(existingMisterEntriesByPath.values()), 'bridge-scan', platformEntries.map((entry) => entry.id));
    setDiscoveredPlatformSelectedKeys((current) => current.filter((key) => !keySet.has(key)));
    setSelectedPlatform(platformKeys.length === 1 ? platformKeys[0] : '');
    setActiveSection('browser');
    setBridgeScanStatus((current) => ({
      ...current,
      phase: 'done',
      message: `새 플랫폼 ${platformKeys.length}개에서 게임 ${newEntries.length}개를 미스터 게임 리스트에 추가했습니다. 중복 ${skippedDuplicates}개는 건너뛰었습니다.`,
      mergedEntries: newEntries.length,
      skippedDuplicates,
    }));
    setMessage(`새 플랫폼 게임 ${newEntries.length}개를 미스터 게임 리스트에 추가했습니다. 중복 ${skippedDuplicates}개.`);
  }

  function markDiscoveredPlatformAsClassificationFolder(platformKey: string) {
    const disabled = new Set(zaparooLibrary.importDisabledPlatformKeys ?? []);
    const enabledOverrides = new Set(zaparooLibrary.importEnabledPlatformKeys ?? []);
    const ignored = new Set(zaparooLibrary.ignoredUnknownPlatformKeys ?? []);
    const classification = new Set(zaparooLibrary.classificationFolderPlatformKeys ?? []);
    classification.add(platformKey);
    ignored.delete(platformKey);
    disabled.add(platformKey);
    enabledOverrides.delete(platformKey);
    setSelectedImportPlatformKeys((current) => current.filter((key) => key !== platformKey));
    setDiscoveredPlatformSelectedKeys((current) => current.filter((key) => key !== platformKey));
    setZaparooLibrary({
      ...zaparooLibrary,
      customPlatformCatalog: (zaparooLibrary.customPlatformCatalog ?? []).filter((candidate) => candidate.platformKey !== platformKey),
      ignoredUnknownPlatformKeys: Array.from(ignored).sort(),
      classificationFolderPlatformKeys: Array.from(classification).sort(),
      importDisabledPlatformKeys: Array.from(disabled).sort(),
      importEnabledPlatformKeys: Array.from(enabledOverrides).sort(),
      updatedAt: new Date().toISOString(),
    });
    setMessage(`${platformKey}는 플랫폼이 아니라 분류 폴더로 표시하도록 저장했습니다.`);
  }

  function ignoreUnknownPlatform(platformKey: string) {
    const row = discoveredPlatformRows.find((candidate) => candidate.key === platformKey);
    setDiscoveredPlatformImportState(platformKey, row?.entry, 'ignored');
  }

  function toggleDiscoveredPlatformSelected(platformKey: string) {
    setDiscoveredPlatformSelectedKeys((current) => (
      current.includes(platformKey) ? current.filter((key) => key !== platformKey) : [...current, platformKey]
    ));
  }

  function applyDiscoveredPlatformBulkState(state: 'enabled' | 'disabled' | 'ignored' | 'pending') {
    const selected = discoveredPlatformRows.filter((row) => discoveredPlatformSelectedKeys.includes(row.key));
    if (state === 'enabled') {
      if (selected[0]) openCustomPlatformRegistration(selected[0]);
      return;
    }
    if (state === 'disabled') {
      const disabled = new Set(zaparooLibrary.importDisabledPlatformKeys ?? []);
      const enabledOverrides = new Set(zaparooLibrary.importEnabledPlatformKeys ?? []);
      const ignored = new Set(zaparooLibrary.ignoredUnknownPlatformKeys ?? []);
      const classification = new Set(zaparooLibrary.classificationFolderPlatformKeys ?? []);
      selected.forEach((row) => {
        classification.add(row.key);
        ignored.delete(row.key);
        disabled.add(row.key);
        enabledOverrides.delete(row.key);
      });
      setSelectedImportPlatformKeys((current) => current.filter((key) => !classification.has(key)));
      setZaparooLibrary({
        ...zaparooLibrary,
        customPlatformCatalog: (zaparooLibrary.customPlatformCatalog ?? []).filter((candidate) => !classification.has(candidate.platformKey)),
        ignoredUnknownPlatformKeys: Array.from(ignored).sort(),
        classificationFolderPlatformKeys: Array.from(classification).sort(),
        importDisabledPlatformKeys: Array.from(disabled).sort(),
        importEnabledPlatformKeys: Array.from(enabledOverrides).sort(),
        updatedAt: new Date().toISOString(),
      });
      setDiscoveredPlatformSelectedKeys([]);
      setMessage(`선택한 ${selected.length}개 항목을 플랫폼이 아닌 분류 폴더로 저장했습니다.`);
      return;
    }
    const disabled = new Set(zaparooLibrary.importDisabledPlatformKeys ?? []);
    const enabledOverrides = new Set(zaparooLibrary.importEnabledPlatformKeys ?? []);
    const ignored = new Set(zaparooLibrary.ignoredUnknownPlatformKeys ?? []);
    const catalog = new Map((zaparooLibrary.customPlatformCatalog ?? []).map((item) => [item.platformKey, item]));
    selected.forEach((row) => {
      if (state === 'pending') {
        catalog.set(row.key, catalogItemForDiscoveredPlatform(row.key, row.entry, false));
        ignored.delete(row.key);
      }
      disabled.add(row.key);
      enabledOverrides.delete(row.key);
      if (state === 'ignored') ignored.add(row.key);
    });
    setZaparooLibrary({
      ...zaparooLibrary,
      customPlatformCatalog: Array.from(catalog.values()).sort((a, b) => a.platformKey.localeCompare(b.platformKey)),
      ignoredUnknownPlatformKeys: Array.from(ignored).sort(),
      importDisabledPlatformKeys: Array.from(disabled).sort(),
      importEnabledPlatformKeys: Array.from(enabledOverrides).sort(),
      updatedAt: new Date().toISOString(),
    });
    setDiscoveredPlatformSelectedKeys([]);
    setMessage(`발견 platform ${selected.length}개를 ${state} 상태로 저장했습니다.`);
  }

  function selectAllVisibleDiscoveredPlatforms() {
    setDiscoveredPlatformSelectedKeys(discoveredPlatformRows.map((row) => row.key));
  }

  function createLibraryBackup() {
    setZaparooLibrary(createZaparooLibraryBackup(zaparooLibrary, 'manual'));
    setMessage('미스터 게임 리스트 백업을 만들었습니다.');
  }

  function restoreLibraryBackup(backupId: string) {
    const ok = window.confirm('이 백업으로 미스터 게임 리스트를 복원할까요?\n\n현재 라이브러리는 백업 상태로 교체됩니다.');
    if (!ok) return;
    setZaparooLibrary(restoreZaparooLibraryBackup(zaparooLibrary, backupId));
    setSelectedIds([]);
    setSelectedPlatform('');
    setMessage('미스터 게임 리스트 백업을 복원했습니다.');
  }

  function deleteLibraryBackup(backupId: string) {
    const ok = window.confirm('이 백업을 삭제할까요?');
    if (!ok) return;
    setZaparooLibrary(deleteZaparooLibraryBackup(zaparooLibrary, backupId));
    setMessage('백업을 삭제했습니다.');
  }

  function toggleEntry(entryId: string) {
    selectLibraryEntry(entryId);
  }

  function selectLibraryEntry(entryId: string, options: { shift?: boolean; forceAdd?: boolean } = {}) {
    const visibleIds = pageEntries.map((entry) => entry.id);
    setSelectedIds((current) => {
      const applyLimit = (next: string[]) => {
        if (next.length <= MAX_BATCH_CARD_CREATE_COUNT) return next;
        setMessage(batchCardCreateLimitMessage);
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

  function makeCards() {
    if (selectedIds.length === 0) {
      setMessage('카드를 만들기 전에 미스터 게임 리스트 게임을 선택하세요.');
      return;
    }
    if (!isBatchCardCreateCountAllowed(selectedIds.length)) {
      setMessage(batchCardCreateLimitMessage);
      return;
    }
    createCardsFromZaparooEntries(selectedIds);
    navigate('/stickers/editor');
  }

  function currentLaunchText() {
    return manualLaunchText.trim() || launchPreview?.text || '';
  }

  const selectTagGame = useCallback((entry: ZaparooLibraryEntry) => {
    const preview = buildLaunchPreview(toMiSTerEntry(entry), launchMode);
    setTagEntryId(entry.id);
    setManualLaunchText(preview.text);
    setReadTagText('');
    setTagStatus('ready');
    setTagMessage(`게임을 선택했습니다: ${entry.title}`);
    setTagGamePickerOpen(false);
  }, [launchMode]);

  useEffect(() => {
    const state = location.state as NfcRouteState | null;
    const nfcGame = state?.nfcGame;
    if (state?.activeMister?.ipAddress) setNfcRouteActiveMister(state.activeMister);
    if (!nfcGame || !location.pathname.includes('/stickers/nfc')) return;
    const entry = nfcGame.entryId
      ? zaparooLibrary.entries.find((candidate) => candidate.id === nfcGame.entryId)
      : zaparooLibrary.entries.find((candidate) => candidate.absolutePath === nfcGame.absolutePath);
    if (entry) {
      selectTagGame(entry);
    } else if (nfcGame.launchText || nfcGame.absolutePath) {
      setTagEntryId('');
      setManualLaunchText(nfcGame.launchText || `**launch:${nfcGame.absolutePath}`);
      setTagMessage(`${nfcGame.title || '선택한 게임'} 실행 경로를 NFC 관리에 불러왔습니다.`);
      setActiveSection('tag');
    }
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate, selectTagGame, zaparooLibrary.entries]);

  function selectTagCard(record: { title: string; mister?: MiSTerCardMetadata }) {
    const linkedEntry = zaparooLibrary.entries.find((entry) => entry.id === record.mister?.zaparooLibraryEntryId);
    if (linkedEntry) {
      selectTagGame(linkedEntry);
      setTagMessage(`카드 "${record.title}"에 연결된 게임을 선택했습니다.`);
      return;
    }
    const launchText = record.mister ? buildLaunchPreviewFromMetadata(record.mister, record.title, launchMode).text : record.title;
    setTagEntryId('');
    setManualLaunchText(launchText);
    setReadTagText('');
    setTagStatus('ready');
    setTagMessage(`라이브러리 연결이 없는 카드입니다. 카드 metadata 기반 launch text를 확인하세요: ${record.title}`);
    setTagGamePickerOpen(false);
  }

  function currentPayload() {
    return buildTagPayload(currentLaunchText(), { allowRelativePath: launchMode === 'relative-path' });
  }

  function bridgeTagAdapter(target?: { config: MiSTerConnectionConfig; connectionId?: string }) {
    const config = target?.config ?? activeConnectionConfig();
    const connectionId = target?.connectionId ?? activeConnectionId();
    return mister.connection.bridgeEnabled || activeZaparooTarget()
      ? new MiSTerBridgeTagWriteAdapter(config, connectionId)
      : new TextExportTagWriteAdapter();
  }

  function activeZaparooTarget(): ZaparooApiTarget | undefined {
    const host = effectiveActiveMister?.ipAddress || mister.connection.config.host;
    if (!host) return undefined;
    return { host, port: 7497, endpoint: '/api/v0.1' };
  }

  function activeConnectionId() {
    return mister.connection.connectionId || activeMister?.sessionId;
  }

  function activeConnectionConfig() {
    if (mister.connection.connectionId) return mister.connection.config;
    if (!effectiveActiveMister) return mister.connection.config;
    return connectionConfigFromActiveProfile(effectiveActiveMister);
  }

  function connectionConfigFromActiveProfile(profile: { ipAddress: string; port?: number; username?: string }): MiSTerConnectionConfig {
    return {
      host: profile.ipAddress,
      port: profile.port || 22,
      username: profile.username || 'root',
      protocol: 'ssh-sftp',
      authMethod: 'password',
    };
  }

  // Map a library device (the "미스터 기기" view filter) to its live connection, matched by IP.
  function connectedDeviceForLibraryDeviceId(libraryDeviceId: string) {
    const profile = zaparooLibrary.profiles.find((candidate) => candidate.deviceId === libraryDeviceId);
    if (!profile) return undefined;
    return connectedDevices.find((device) => device.ipAddress === profile.host);
  }

  // Browser launch/NFC target: the MiSTer currently being viewed ("미스터 기기" filter). When viewing "전체
  // 기기" or the viewed device isn't connected, fall back to any connected device that has the game.
  function resolveTargetDeviceForEntry(entry: ZaparooLibraryEntry) {
    if (libraryDeviceFilter !== '__all__') {
      const viewDevice = connectedDeviceForLibraryDeviceId(libraryDeviceFilter);
      if (viewDevice) {
        return {
          config: viewDevice.config,
          connectionId: viewDevice.sessionId,
          sourceRef: entry.sourceRefs.find((ref) => ref.deviceId === libraryDeviceFilter),
          deviceLabel: misterDisplayName(viewDevice),
        };
      }
    }
    const targets = resolveLaunchTargetsForEntry(entry, connectedDevices, zaparooLibrary.profiles);
    if (targets.length === 0) return undefined;
    const chosen = targets[0];
    return {
      config: chosen.device.config,
      connectionId: chosen.device.sessionId,
      sourceRef: chosen.sourceRef,
      deviceLabel: misterDisplayName(chosen.device),
    };
  }

  async function refreshZaparooStatus() {
    const target = selectedZaparooTarget();
    if (!target) {
      setZaparooStatusMessage('MiSTer 연결이 필요합니다.');
      return;
    }
    setZaparooStatusMessage(`${selectedDeviceLabel()}의 Zaparoo API와 config.toml을 read-only로 진단하는 중입니다...`);
    const result = await new ZaparooApiClient().getStatus(target);
    const device = nfcSelectedDevice();
    if (device) setNfcDeviceStatuses((current) => ({ ...current, [device.deviceId]: result }));
    setZaparooStatusMessage(result.message);
    const sessionId = selectedZaparooConnectionId();
    if (sessionId) {
      setZaparooConfigDiagnostics(await new ZaparooApiClient().readConfigDiagnostics(sessionId));
    }
  }

  // The MiSTer chosen for NFC read/write (and scan/launch): the selected target device, else the first connected.
  function nfcSelectedDevice() {
    return connectedDevices.find((device) => device.deviceId === selectedTargetDeviceId) ?? connectedDevices[0];
  }

  function zaparooTargetForDevice(device: { ipAddress: string }): ZaparooApiTarget {
    return { host: device.ipAddress, port: 7497, endpoint: '/api/v0.1' };
  }

  // Zaparoo status/config actions target the device SELECTED in the NFC panel, falling back to the active connection.
  function selectedZaparooConnectionId() {
    return nfcSelectedDevice()?.sessionId ?? activeConnectionId();
  }

  function selectedZaparooTarget(): ZaparooApiTarget | undefined {
    const device = nfcSelectedDevice();
    return device ? zaparooTargetForDevice(device) : activeZaparooTarget();
  }

  function selectedDeviceLabel() {
    const device = nfcSelectedDevice();
    return device ? misterDisplayName(device) : (effectiveActiveMister ? misterDisplayName(effectiveActiveMister) : (mister.connection.config.host || 'MiSTer'));
  }

  async function refreshConnectedZaparooStatuses() {
    if (connectedDevices.length === 0) return;
    setNfcStatusBusy(true);
    try {
      const entries = await Promise.all(connectedDevices.map(async (device) => {
        const status = await new ZaparooApiClient().getStatus(zaparooTargetForDevice(device)).catch(() => null);
        return [device.deviceId, status] as const;
      }));
      setNfcDeviceStatuses((current) => {
        const next = { ...current };
        entries.forEach(([id, status]) => { if (status) next[id] = status; });
        return next;
      });
    } finally {
      setNfcStatusBusy(false);
    }
  }

  useEffect(() => {
    if (activeSection === 'tag' && connectedDevices.length > 0) void refreshConnectedZaparooStatuses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, connectedDevices]);

  async function buildZaparooConfigRecommendationPlan() {
    const sessionId = selectedZaparooConnectionId();
    if (!sessionId) {
      setZaparooStatusMessage('MiSTer 연결이 필요합니다. 먼저 MiSTer 연결 메뉴에서 연결하세요.');
      return;
    }
    setZaparooApplyBusy(true);
    setZaparooApplyResult(null);
    try {
      const plan = await new ZaparooApiClient().previewConfigApply(sessionId, zaparooApplyMode);
      setZaparooPatchPlan(plan);
      setZaparooShowDiff(true);
      setZaparooStatusMessage(plan.message);
    } catch (error) {
      setZaparooStatusMessage(error instanceof Error ? error.message : 'Zaparoo 추천 설정을 만들지 못했습니다.');
    } finally {
      setZaparooApplyBusy(false);
    }
  }

  async function applyZaparooConfigRecommendation() {
    const sessionId = selectedZaparooConnectionId();
    if (!sessionId) {
      setZaparooStatusMessage('MiSTer 연결이 필요합니다. 먼저 MiSTer 연결 메뉴에서 연결하세요.');
      return;
    }
    const confirmed = window.confirm(`${selectedDeviceLabel()}의 Zaparoo config.toml을 백업한 뒤 추천 설정을 적용합니다. 변경점과 백업 위치를 확인했습니까?`);
    if (!confirmed) return;
    setZaparooApplyBusy(true);
    try {
      const result = await new ZaparooApiClient().applyConfigRecommendation({
        sessionId,
        mode: zaparooApplyMode,
        confirmed: true,
        allowLocalBackupOnly: zaparooAllowLocalBackupOnly,
      });
      setZaparooApplyResult(result);
      setZaparooStatusMessage(formatZaparooConfigApplyResult(result));
      if (result.plan) setZaparooPatchPlan(result.plan);
      if (result.verification) setZaparooConfigDiagnostics(result.verification);
    } catch (error) {
      setZaparooStatusMessage(error instanceof Error ? error.message : 'Zaparoo config.toml 적용에 실패했습니다.');
    } finally {
      setZaparooApplyBusy(false);
    }
  }

  async function copyZaparooConfigExample() {
    const example = zaparooPatchPlan?.nextPreview ?? [
      '[service]',
      'api_port = 7497',
      'api_listen = "0.0.0.0"',
      'allowed_ips = []',
      'allow_run = [',
      "  '**launch:/media/fat/(games|_Arcade)/.*'",
      ']',
      '',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(example);
      setZaparooStatusMessage('Zaparoo 설정 예시를 클립보드에 복사했습니다.');
    } catch {
      setZaparooStatusMessage('클립보드 복사를 사용할 수 없습니다. 변경점 보기에서 내용을 확인하세요.');
    }
  }


  function launchTargetFromDevice(candidate: LaunchTarget) {
    return {
      config: candidate.device.config,
      connectionId: candidate.device.sessionId,
      sourceRef: candidate.sourceRef,
      deviceLabel: misterDisplayName(candidate.device),
    };
  }

  async function launchLibraryEntry(entry: ZaparooLibraryEntry) {
    // Viewing a specific MiSTer ("미스터 기기" filter): honor it, no prompt.
    if (libraryDeviceFilter !== '__all__') {
      const scoped = resolveTargetDeviceForEntry(entry);
      if (scoped) { void runLaunchOnTarget(entry, scoped); return; }
    }
    // Otherwise offer every connected MiSTer that has this game (fall back to all connected MiSTers).
    const withGame = resolveLaunchTargetsForEntry(entry, connectedDevices, zaparooLibrary.profiles);
    const candidates = withGame.length > 0 ? withGame : connectedDevices.map((device) => ({ device, sourceRef: undefined }));
    if (candidates.length === 0) {
      setMessage('연결된 MiSTer가 없습니다. 먼저 MiSTer 연결 메뉴에서 연결하세요.');
      return;
    }
    if (candidates.length === 1) {
      void runLaunchOnTarget(entry, launchTargetFromDevice(candidates[0]));
      return;
    }
    setLaunchPicker({ entry, candidates });
  }

  async function runLaunchOnTarget(
    entry: ZaparooLibraryEntry,
    target: NonNullable<ReturnType<typeof resolveTargetDeviceForEntry>>,
  ) {
    const fallbackText = buildLaunchPreview(toMiSTerEntry(entry), launchMode).text;
    const connectionId = target.connectionId ?? activeConnectionId();
    const config = target.config;
    const launchText = launchTextForDeviceRef(target.sourceRef, fallbackText);
    if (!connectionId) {
      setMessage('연결된 MiSTer가 없습니다. 먼저 MiSTer 연결 메뉴에서 연결하세요.');
      return;
    }
    if (!launchText) {
      setMessage('실행 경로가 없습니다. 게임 리스트와 카드를 다시 연결하세요.');
      return;
    }
    setLaunchingEntryId(entry.id);
    const deviceLabel = target.deviceLabel ?? config.host;
    try {
      const result = await new HttpMiSTerBridgeClient().launchGame(config, launchText, connectionId);
      if (result.ok) {
        setMessage(`Zaparoo 실행 요청을 보냈습니다: ${entry.title} → ${deviceLabel}`);
        setRunFix(null);
      } else {
        setMessage(result.message);
        // Surface a one-click allow_run fix when Zaparoo blocked the remote run.
        if (/allow_run|RUN_ENDPOINT|not allowed|forbidden|차단|\b403\b/i.test(result.message)) {
          setRunFix({ connectionId, config, deviceLabel });
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Zaparoo 실행 요청에 실패했습니다.');
    } finally {
      setLaunchingEntryId('');
    }
  }

  async function applyRunPermission() {
    if (!runFix) return;
    const confirmed = window.confirm(`${runFix.deviceLabel}의 Zaparoo config.toml에 게임 실행 허용(allow_run) 설정을 백업과 함께 적용합니다. 진행할까요?`);
    if (!confirmed) return;
    setZaparooApplyBusy(true);
    try {
      const result = await new ZaparooApiClient().applyConfigRecommendation({ sessionId: runFix.connectionId, mode: 'single-ip', confirmed: true });
      if (result.ok) {
        setMessage(`${runFix.deviceLabel}에 실행 허용 설정을 적용했습니다. 미스터에서 Zaparoo를 재시작(또는 재부팅)한 뒤 다시 실행하세요.`);
        setRunFix(null);
      } else {
        setMessage(formatZaparooConfigApplyResult(result));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Zaparoo 실행 허용 설정 적용에 실패했습니다.');
    } finally {
      setZaparooApplyBusy(false);
    }
  }

  function sendEntryToNfc(entry: ZaparooLibraryEntry) {
    const preview = buildLaunchPreview(toMiSTerEntry(entry), launchMode);
    navigate('/stickers/nfc', {
      state: {
        nfcGame: {
          entryId: entry.id,
          title: entry.title,
          platform: entry.systemId,
          launchText: preview.text,
          absolutePath: preview.resolvedMiSTerPath || entry.absolutePath,
        },
        activeMister: effectiveActiveMister
          ? {
              profileId: effectiveActiveMister.profileId,
              alias: effectiveActiveMister.alias,
              ipAddress: effectiveActiveMister.ipAddress,
              port: effectiveActiveMister.port,
              username: effectiveActiveMister.username,
            }
          : undefined,
      },
    });
  }

  async function searchMediaForEntry(entry: ZaparooLibraryEntry) {
    const target = activeZaparooTarget();
    if (!target) {
      setMediaMatches((current) => ({
        ...current,
        [entry.id]: { status: 'error', message: 'MiSTer 연결이 필요합니다.', items: [] },
      }));
      return;
    }
    setMediaMatches((current) => ({
      ...current,
      [entry.id]: { status: 'searching', message: 'Zaparoo media.search 실행 중...', items: [] },
    }));
    const result = await searchZaparooMediaForTitle(entry.title, target);
    setMediaMatches((current) => ({
      ...current,
      [entry.id]: {
        status: result.ok ? 'done' : 'error',
        message: result.ok ? `media 후보 ${result.items.length}개` : result.message,
        items: result.items,
      },
    }));
  }

  async function writeNfcTag() {
    const payload = currentPayload();
    if (!payload.valid) {
      setTagStatus('error');
      setTagMessage(payload.warnings.join(' '));
      return;
    }
    const writeDevice = nfcSelectedDevice();
    const writeStatus = writeDevice ? nfcDeviceStatuses[writeDevice.deviceId] : undefined;
    const readiness = getZaparooNfcWriteReadiness({
      hasActiveMister: hasActiveMisterConnection,
      zaparooApiConnected: Boolean(writeStatus?.ok),
      readerCount: writeStatus?.readers?.length ?? 0,
      payloadValid: payload.valid,
      payloadWarnings: payload.warnings,
    });
    if (!readiness.canWrite) {
      setTagStatus('error');
      setTagMessage(readiness.message);
      return;
    }
    try {
      setTagStatus('waiting for tag');
      setTagMessage(`${writeDevice ? misterDisplayName(writeDevice) : 'MiSTer'}의 NFC 리더에 NTAG215 태그를 올린 뒤 쓰기를 진행합니다.`);
      setTagStatus('writing');
      const adapter = bridgeTagAdapter(writeDevice ? { config: writeDevice.config, connectionId: writeDevice.sessionId } : undefined);
      const job = await adapter.write(payload);
      addMiSTerTagJob({ ...job, entryId: focusedEntry?.id });
      setTagStatus(job.status === 'failed' ? 'error' : 'written');
      setTagMessage(job.status === 'failed' ? job.logs.join(' ') : '쓰기 완료. 검증하려면 태그를 리더에서 떼었다가 다시 올린 뒤 태그 읽기를 누르세요.');
    } catch (error) {
      const job = await new TextExportTagWriteAdapter().write(payload);
      addMiSTerTagJob({ ...job, entryId: focusedEntry?.id, logs: [...job.logs, explainTagError(error, 'Bridge write failed.')] });
      setTagStatus('error');
      setTagMessage(explainTagError(error, 'Bridge write failed. Text/export payload was kept as fallback.'));
    }
  }

  async function readNfcTag() {
    const readDevice = nfcSelectedDevice();
    const readStatus = readDevice ? nfcDeviceStatuses[readDevice.deviceId] : undefined;
    const readiness = getZaparooNfcReadReadiness({
      hasActiveMister: hasActiveMisterConnection,
      zaparooApiConnected: Boolean(readStatus?.ok),
      readerCount: readStatus?.readers?.length ?? 0,
    });
    if (!readiness.canRead) {
      setTagStatus('error');
      setTagMessage(readiness.message);
      return;
    }
    const target = readDevice ? zaparooTargetForDevice(readDevice) : activeZaparooTarget();
    if (!target) {
      setTagStatus('error');
      setTagMessage('MiSTer 연결 메뉴에서 먼저 연결하세요.');
      return;
    }
    const requestId = `nfc-read-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    nfcReadRequestIdRef.current = requestId;
    try {
      setNfcReadBusy(true);
      setTagStatus('waitingForTag');
      setTagMessage('태그를 리더에서 뗐다가 다시 올려주세요.');
      const result = await new ZaparooApiClient().readTokenOnce({ target, timeoutMs: 20000, requestId });
      if (nfcReadRequestIdRef.current !== requestId) return;
      const text = result.text ?? '';
      setReadTagText(text);
      if (!result.ok || !text) {
        setTagStatus(result.status === 'timeout' || result.status === 'cancelled' ? result.status : 'error');
        setTagMessage(result.message || formatZaparooNfcReadStatus(result.status, result.code));
        return;
      }
      const comparison = compareZaparooNfcTokenText(text, currentPayload().valid ? currentPayload().launchText : '');
      setTagStatus(comparison.status);
      setTagMessage(comparison.message);
    } catch (error) {
      setTagStatus('error');
      setTagMessage(explainTagError(error, 'NFC tag read failed.'));
    } finally {
      if (nfcReadRequestIdRef.current === requestId) {
        setNfcReadBusy(false);
        nfcReadRequestIdRef.current = '';
      }
    }
  }

  async function cancelNfcRead() {
    const requestId = nfcReadRequestIdRef.current;
    if (!requestId) return;
    await new ZaparooApiClient().cancelTokenRead(requestId);
    nfcReadRequestIdRef.current = '';
    setNfcReadBusy(false);
    setTagStatus('cancelled');
    setTagMessage('읽기를 취소했습니다.');
  }

  const launchPreview = focusedMiSTerEntry ? buildLaunchPreview(focusedMiSTerEntry, launchMode) : undefined;
  const tagPayloadPreview = buildTagPayload(currentLaunchText(), { allowRelativePath: launchMode === 'relative-path' });
  const nfcSelected = nfcSelectedDevice();
  const nfcSelectedStatus = nfcSelected ? nfcDeviceStatuses[nfcSelected.deviceId] : undefined;
  const hasActiveBridgeSession = Boolean(mister.connection.connectionId && mister.connection.status === 'connected');
  const hasActiveMisterConnection = Boolean(effectiveActiveMister?.ipAddress || activeConnectionId());
  // NFC connection readiness uses the SAME single source of truth (active MiSTer profile) as game launch
  // and the sidebar badge, so NFC never claims "연결하세요" while launch works. Reader/API availability
  // stays a separate, honest requirement surfaced by the readiness message.
  const nfcWriteReadiness = getZaparooNfcWriteReadiness({
    hasActiveMister: hasActiveMisterConnection,
    zaparooApiConnected: Boolean(nfcSelectedStatus?.ok),
    readerCount: nfcSelectedStatus?.readers?.length ?? 0,
    payloadValid: tagPayloadPreview.valid,
    payloadWarnings: tagPayloadPreview.warnings,
  });
  const nfcReadReadiness = getZaparooNfcReadReadiness({
    hasActiveMister: hasActiveMisterConnection,
    zaparooApiConnected: Boolean(nfcSelectedStatus?.ok),
    readerCount: nfcSelectedStatus?.readers?.length ?? 0,
  });
  const zaparooConfigSummary = zaparooConfigDiagnostics ? formatZaparooConfigDiagnostics(zaparooConfigDiagnostics, developerMode) : '';
  const connectionButtonLabel = hasActiveBridgeSession ? '연결 해제' : mister.connection.status === 'testing' ? '연결 중' : '연결';
  const connectionButtonClass = hasActiveBridgeSession
    ? 'bg-red-600 text-white hover:bg-red-700'
    : mister.connection.status === 'testing'
      ? 'bg-amber-500 text-white hover:bg-amber-600'
      : 'bg-primary text-white hover:bg-blue-700';

  function changeLaunchMode(nextMode: MiSTerLaunchMode) {
    setLaunchMode(nextMode);
    if (focusedMiSTerEntry) {
      setManualLaunchText(buildLaunchPreview(focusedMiSTerEntry, nextMode).text);
      setTagStatus('ready');
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="MiSTer FPGA"
        title={activeSection === 'tag' ? 'NFC 관리' : '게임 라이브러리'}
        description={activeSection === 'tag'
          ? '연결된 MiSTer의 Zaparoo 리더기로 카드의 NFC launch payload를 태그에 쓰고 읽습니다.'
          : '연결된 MiSTer에서 게임을 가져와 중복 없는 게임 라이브러리로 모으고, 카드 제작의 기준으로 사용합니다.'}
      />

      <section className={(message || !hasActiveMisterConnection || activeSection === 'tag') ? 'mb-5 rounded-lg border border-line bg-white p-4 shadow-surface' : ''}>
        {message && <p className="rounded-md bg-neutral-50 px-3 py-2 text-sm text-neutral-700">{message}</p>}
        {!hasActiveMisterConnection && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span>먼저 MiSTer 연결 메뉴에서 연결하세요. 게임 라이브러리는 메인 MiSTer 연결 상태만 사용합니다.</span>
            <RouterLink to="/mister" className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100">
              MiSTer 연결로 이동
            </RouterLink>
          </div>
        )}
        {activeSection === 'tag' && (
        <>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-neutral-50 px-3 py-2 text-sm">
          <div>
            <p className="font-medium">Zaparoo config.toml 진단 · {selectedDeviceLabel()}</p>
            {zaparooStatusMessage && <p className="mt-1 text-xs text-neutral-600">{zaparooStatusMessage}</p>}
            {zaparooConfigDiagnostics && (
              <div className="mt-1 text-xs text-neutral-600">
                <p>config.toml: {zaparooConfigSummary.split('\n')[0]}</p>
                {developerMode && zaparooConfigSummary.includes('\n') && (
                  <pre className="mt-2 max-w-xl whitespace-pre-wrap rounded border border-line bg-white p-2 text-[11px] text-neutral-700">
                    {zaparooConfigSummary}
                  </pre>
                )}
              </div>
            )}
          </div>
          <button type="button" onClick={() => void refreshZaparooStatus()} className="rounded-md border border-line bg-white px-3 py-1.5 text-xs font-medium hover:bg-blue-50">
            Zaparoo 진단
          </button>
        </div>

        {developerMode && (
        <div className="mt-3 rounded-md border border-blue-100 bg-blue-50 p-3 text-sm text-blue-950">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold">Zaparoo 추천 설정 적용 <span className="ml-1 rounded-full bg-white px-2 py-0.5 text-xs font-medium text-blue-800">대상: {selectedDeviceLabel()}</span></p>
              <p className="mt-1 text-xs text-blue-900">아래 "연결된 미스터"에서 선택한 미스터의 config.toml을 수정합니다. [service]의 API 접근과 run 허용(allow_run) 설정만 변경합니다.</p>
              <p className="mt-1 text-xs text-blue-900">적용 전 백업을 생성하며, 원격 파일 쓰기는 Zaparoo config.toml과 해당 백업 파일로만 제한됩니다.</p>
            </div>
            <label className="text-xs font-medium text-blue-950">
              allowed_ips 추천
              <select
                value={zaparooApplyMode}
                onChange={(event) => setZaparooApplyMode(event.target.value as ZaparooAllowedIpsRecommendationMode)}
                className="ml-2 rounded-md border border-blue-200 bg-white px-2 py-1 text-xs"
              >
                <option value="single-ip">현재 PC 1개만 허용</option>
                <option value="subnet-24">현재 /24 subnet 허용</option>
                <option value="open">제한 없음 (전체 허용)</option>
              </select>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={zaparooApplyBusy || !selectedZaparooConnectionId()} onClick={() => void buildZaparooConfigRecommendationPlan()} className="rounded-md border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-900 hover:bg-blue-100 disabled:opacity-50">추천 설정 만들기
            </button>
            <button type="button" disabled={!zaparooPatchPlan} onClick={() => setZaparooShowDiff((value) => !value)} className="rounded-md border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-900 hover:bg-blue-100 disabled:opacity-50">
              변경점 보기
            </button>
            <button type="button" disabled={zaparooApplyBusy || !zaparooPatchPlan || !selectedZaparooConnectionId()} onClick={() => void applyZaparooConfigRecommendation()} className="rounded-md border border-blue-300 bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50">
              백업 후 적용
            </button>
            <button type="button" onClick={() => void refreshZaparooStatus()} className="rounded-md border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-900 hover:bg-blue-100">
              다시 진단
            </button>
            <button type="button" onClick={() => void copyZaparooConfigExample()} className="rounded-md border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-900 hover:bg-blue-100">
              설정 예시 복사
            </button>
          </div>
          {zaparooPatchPlan && (
            <div className="mt-3 rounded-md border border-blue-200 bg-white p-3 text-xs text-neutral-700">
              <p className="font-medium text-neutral-900">{zaparooPatchPlan.message}</p>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <p><span className="font-medium">원격 백업:</span> {zaparooPatchPlan.remoteBackupPath}</p>
                <p><span className="font-medium">로컬 백업:</span> {zaparooPatchPlan.localBackupRelativePath}</p>
                <p><span className="font-medium">allowed_ips:</span> {zaparooPatchPlan.recommendation.allowedIps.join(', ') || '비어 있음'}</p>
                <p><span className="font-medium">allow_run:</span> {zaparooPatchPlan.recommendation.allowRun.join(', ')}</p>
              </div>
              <label className="mt-2 flex items-center gap-2 text-xs text-amber-800">
                <input type="checkbox" checked={zaparooAllowLocalBackupOnly} onChange={(event) => setZaparooAllowLocalBackupOnly(event.target.checked)} />
                원격 백업이 실패하면 로컬 백업만으로 계속 적용
              </label>
              {zaparooShowDiff && (
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded border border-line bg-neutral-950 p-3 text-[11px] text-neutral-50">
                  {zaparooPatchPlan.diffPreview}
                </pre>
              )}
            </div>
          )}
          {zaparooApplyResult && (
            <div className="mt-3 rounded-md border border-blue-200 bg-white p-3 text-xs text-neutral-700">
              <p className={zaparooApplyResult.ok ? 'font-medium text-green-700' : 'font-medium text-red-700'}>{formatZaparooConfigApplyResult(zaparooApplyResult)}</p>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <p><span className="font-medium">로컬 백업:</span> {zaparooApplyResult.localBackupPath || '-'}</p>
                <p><span className="font-medium">원격 백업:</span> {zaparooApplyResult.remoteBackupPath || (zaparooApplyResult.remoteBackupOk ? '완료' : '없음')}</p>
                <p><span className="font-medium">reload:</span> {zaparooApplyResult.reloadAttempted ? (zaparooApplyResult.reloadOk ? '성공' : '실패 또는 미지원') : '시도 안 함'}</p>
                <p><span className="font-medium">재진단:</span> {zaparooApplyResult.verification?.message || '-'}</p>
              </div>
            </div>
          )}
          <p className="mt-3 text-xs text-blue-900">설정 변경 후 Zaparoo Core reload 또는 재시작이 필요할 수 있습니다. 앱은 config.toml을 조용히 자동 수정하지 않습니다.</p>
        </div>
        )}
        </>
        )}
      </section>

      {activeSection === 'connection' && (
        <section className="rounded-lg border border-line bg-white p-5 shadow-surface">
          <div className="mb-4 flex items-center gap-2">
            <Link className="h-5 w-5" />
            <h2 className="text-lg font-semibold">연결</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm md:col-span-2">
              <span className="font-medium">저장된 MiSTer 선택</span>
              <select
                value={zaparooLibrary.profiles.find((profile) => profile.host === mister.connection.config.host)?.deviceId ?? ''}
                onChange={(event) => {
                  const profile = zaparooLibrary.profiles.find((candidate) => candidate.deviceId === event.target.value);
                  if (!profile) return;
                  updateConnectionConfigForUi({
                    host: profile.host ?? mister.connection.config.host,
                    username: profile.username ?? mister.connection.config.username ?? 'root',
                    port: profile.port ?? mister.connection.config.port ?? 22,
                  });
                  setZaparooLibrary(setActiveZaparooProfile(zaparooLibrary, profile.deviceId));
                }}
                className="mt-1 w-full rounded-md border border-line px-2 py-2"
              >
                <option value="">새 MiSTer 직접 입력</option>
                {zaparooLibrary.profiles.map((profile) => (
                  <option key={profile.deviceId} value={profile.deviceId}>
                    {misterDisplayName(profile)} {profile.host ? `(${profile.host})` : ''}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-neutral-500">profile을 선택하면 저장된 host/IP가 자동으로 채워집니다. 새 주소도 직접 입력할 수 있습니다.</span>
            </label>
            <label className="block text-sm">
              <span className="font-medium">MiSTer 주소/IP</span>
              <input value={mister.connection.config.host} onChange={(event) => updateConnectionConfigForUi({ host: event.target.value })} className="mt-1 w-full rounded-md border border-line px-2 py-2" />
            </label>
            <label className="block text-sm">
              <span className="font-medium">포트</span>
              <input type="number" value={mister.connection.config.port} onChange={(event) => updateConnectionConfigForUi({ port: Number(event.target.value) })} className="mt-1 w-full rounded-md border border-line px-2 py-2" />
            </label>
            <label className="block text-sm">
              <span className="font-medium">사용자 이름</span>
              <input value={mister.connection.config.username} onChange={(event) => updateConnectionConfigForUi({ username: event.target.value })} className="mt-1 w-full rounded-md border border-line px-2 py-2" />
            </label>
            <label className="block text-sm">
              <span className="font-medium">비밀번호</span>
              <input
                type="password"
                value={mister.connection.config.password ?? '1'}
                onChange={(event) => updateMiSTerConnectionConfig({ password: event.target.value, authMethod: 'password' })}
                className="mt-1 w-full rounded-md border border-line px-2 py-2"
              />
              <span className="mt-1 block text-xs text-neutral-500">비밀번호 입력값은 연결에만 사용하며, 저장 시에는 안전 저장소를 사용할 수 있는 경우에만 암호화해 보관합니다.</span>
            </label>
          </div>
          <details className="mt-4 rounded-md border border-line p-3 text-sm">
            <summary className="cursor-pointer font-medium">고급 설정</summary>
            <p className="mt-2 text-xs text-neutral-500">일반 사용자는 MiSTer IP와 비밀번호만 입력하면 됩니다. 로컬 브리지는 기본값을 사용합니다.</p>
            <label className="mt-3 block">
              <span className="font-medium">인증 방식</span>
              <select value={mister.connection.config.authMethod} onChange={(event) => updateMiSTerConnectionConfig({ authMethod: event.target.value as never })} className="mt-1 w-full rounded-md border border-line px-2 py-2">
                <option value="password">비밀번호</option>
                <option value="private-key">Private key</option>
                <option value="agent">Agent / Bridge</option>
              </select>
            </label>
            <label className="mt-3 block">
              <span className="font-medium">로컬 브리지 URL</span>
              <input
                value={mister.connection.bridgeUrl ?? getMiSTerBridgeUrl()}
                onChange={(event) => setMiSTerConnection({ bridgeUrl: event.target.value })}
                className="mt-1 w-full rounded-md border border-line px-2 py-2"
              />
            </label>
            <label className="mt-3 flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(mister.connection.bridgeEnabled ?? true)}
                onChange={(event) => setMiSTerConnection({ bridgeEnabled: event.target.checked })}
              />
              <span className="font-medium">실제 SSH/SFTP에 로컬 브리지 사용</span>
            </label>
          </details>
          <button
            type="button"
            disabled={mister.connection.status === 'testing'}
            onClick={() => void (hasActiveBridgeSession ? handleDisconnect() : handleConnectionTest())}
            className={`mt-4 inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium shadow-sm disabled:opacity-60 ${connectionButtonClass}`}
          >
            <RefreshCw className="h-4 w-4" />
            {connectionButtonLabel}
          </button>
          <p className="mt-2 text-xs text-neutral-500">브리지 상태, SSH/SFTP 인증, 필수 MiSTer 경로, NFC config 감지를 확인합니다.</p>
          <div className="mt-4 grid gap-2 text-sm md:grid-cols-2">
            {connectionSteps.map((step) => (
              <div key={step.label} className="flex items-center justify-between rounded-md border border-line px-3 py-2">
                <span>{step.label}</span>
                <span className={`text-xs font-medium ${step.state === 'done' ? 'text-green-700' : step.state === 'failed' ? 'text-red-700' : step.state === 'active' ? 'text-blue-700' : 'text-neutral-500'}`}>{step.state}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-md border border-line bg-neutral-50 p-3 text-sm">
            <p><span className="font-medium">상태:</span> {connectionStatusLabel(mister.connection.status, hasActiveBridgeSession)}</p>
            <p><span className="font-medium">연결 대상:</span> {mister.connection.config.host || '-'}:{mister.connection.config.port || 22}</p>
            <p><span className="font-medium">현재 연결된 MiSTer:</span> {hasActiveBridgeSession ? `${mister.connection.config.host}:${mister.connection.config.port}` : '-'}</p>
            <p><span className="font-medium">마지막 연결:</span> {mister.connection.lastTestedAt ? new Date(mister.connection.lastTestedAt).toLocaleString() : '-'}</p>
            <p><span className="font-medium">브리지 세션:</span> {mister.connection.connectionId ? '현재 앱 세션에서 활성' : '연결 안 됨'}</p>
            <p><span className="font-medium">NFC CLI fallback:</span> {mister.connection.zaparooCommandStatus === 'found' ? mister.connection.zaparooCommand : mister.connection.zaparooCommandStatus === 'missing' ? '찾지 못함' : '확인 전'}</p>
            <p><span className="font-medium">Active profile:</span> {zaparooLibrary.profiles.find((profile) => profile.deviceId === zaparooLibrary.activeProfileId)?.deviceName ?? '없음'}</p>
            {mister.connection.message && <p className="mt-1 text-neutral-600">{mister.connection.message}</p>}
          </div>
        </section>
      )}

      {activeSection === 'sync' && (
        <section className="rounded-lg border border-line bg-white p-5 shadow-surface">
          <div className="mb-4 flex items-center gap-2">
            <Layers className="h-5 w-5" />
            <h2 className="text-lg font-semibold">게임 리스트 동기화</h2>
          </div>
          {connectedDevices.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-green-100 bg-green-50/60 px-3 py-2 text-sm">
              <span className="font-medium text-green-950">스캔 대상 미스터</span>
              <select
                value={selectedTargetDeviceId ?? ''}
                onChange={(event) => selectScanTargetDevice(event.target.value)}
                className="rounded-md border border-line bg-white px-2 py-1.5"
              >
                <option value="" disabled>대상 미스터 선택</option>
                {connectedDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {misterDisplayName(device)}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => void refreshConnectedDevices()} className="rounded border border-green-200 bg-white px-2 py-1 text-xs text-green-700 hover:bg-green-50">
                연결 새로고침
              </button>
              <span className="text-xs text-green-800">선택한 미스터를 작업 대상으로 삼아 그 게임 폴더를 스캔합니다. (연결됨 {connectedDevices.length}대)</span>
            </div>
          )}
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div>
              <p className="text-sm text-neutral-600">
                현재 연결된 MiSTer의 게임 폴더를 스캔해 미스터 게임 리스트에 병합합니다. 가져오기 목록은 기본적으로 제외 상태이며, 사용자가 선택한 항목만 게임 리스트에 추가합니다.
              </p>
              <div className="mt-4">
                <button type="button" onClick={() => void handleBridgeScan()} className="block w-full rounded-md bg-primary px-4 py-3 text-left text-sm font-medium text-white shadow-sm hover:bg-blue-700">
                  연결된 MiSTer 스캔
                  <span className="mt-1 block text-xs font-normal text-white/80">현재 연결된 MiSTer의 게임 폴더를 스캔한 뒤 전역 필터에 따라 병합합니다.</span>
                </button>
              </div>
              <div className="mt-3 rounded-md border border-line bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">추가 모드</p>
                    <p className="text-xs text-neutral-500">기본은 수동 추가입니다. 스캔 결과를 확인한 뒤 선택 항목을 라이브러리에 추가합니다.</p>
                  </div>
                  <label className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={autoMergeAfterScan}
                      onChange={(event) => setAutoMergeAfterScan(event.target.checked)}
                    />
                    자동 추가
                  </label>
                </div>
                {!autoMergeAfterScan && (
                  <button
                    type="button"
                    onClick={mergeScanPreviewToLibrary}
                    disabled={scanPreviewEntries.length === 0}
                    className="mt-3 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    선택 항목 라이브러리에 추가 ({scanPreviewEntries.length})
                  </button>
                )}
              </div>
              <details className="mt-4 rounded-md border border-line bg-white p-3 text-sm">
                <summary className="cursor-pointer font-semibold">MiSTer 스캔 필터 config</summary>
                {scanFilterConfig ? (
                  <div className="mt-3 space-y-3 text-xs text-neutral-700">
                    <div className="grid gap-2 rounded-md bg-neutral-50 p-2 sm:grid-cols-2">
                      <p><span className="font-medium">Config source:</span> {scanFilterConfig.source}</p>
                      <p><span className="font-medium">Version:</span> v{scanFilterConfig.config.version}</p>
                      <p className="sm:col-span-2"><span className="font-medium">경로:</span> {scanFilterConfig.path ?? '브라우저 IndexedDB fallback'}</p>
                      <p><span className="font-medium">마지막 저장:</span> {scanFilterConfig.lastSavedAt ? new Date(scanFilterConfig.lastSavedAt).toLocaleString() : '-'}</p>
                      <p><span className="font-medium">저장 상태:</span> {scanFilterConfig.source === 'bundledDefault' ? '기본값 사용 중' : '활성 config 사용 중'}</p>
                    </div>
                    <label className="block">
                      <span className="font-medium">최소 파일 크기 / tiny file skip bytes</span>
                      <input
                        type="number"
                        min={0}
                        value={scanFilterConfig.config.misterScan.skipFilesAtOrBelowBytes}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          updateScanFilterConfig({ skipFilesAtOrBelowBytes: value, minGameFileSizeBytes: value });
                        }}
                        className="mt-1 w-full rounded-md border border-line px-2 py-1.5"
                      />
                    </label>
                    <label className="block">
                      <span className="font-medium">포함 확장자</span>
                      <textarea
                        value={scanFilterConfig.config.misterScan.includedExtensions.join(', ')}
                        onChange={(event) => updateScanFilterConfig({ includedExtensions: parseConfigList(event.target.value) })}
                        className="mt-1 h-16 w-full rounded-md border border-line px-2 py-1.5"
                      />
                    </label>
                    <label className="block">
                      <span className="font-medium">제외 확장자</span>
                      <textarea
                        value={scanFilterConfig.config.misterScan.excludedExtensions.join(', ')}
                        onChange={(event) => updateScanFilterConfig({ excludedExtensions: parseConfigList(event.target.value) })}
                        className="mt-1 h-14 w-full rounded-md border border-line px-2 py-1.5"
                      />
                    </label>
                    <label className="block">
                      <span className="font-medium">무시 폴더</span>
                      <textarea
                        value={scanFilterConfig.config.misterScan.ignoredDirectories.join(', ')}
                        onChange={(event) => updateScanFilterConfig({ ignoredDirectories: parseConfigList(event.target.value) })}
                        className="mt-1 h-14 w-full rounded-md border border-line px-2 py-1.5"
                      />
                    </label>
                    <label className="block">
                      <span className="font-medium">새 플랫폼 발견 시</span>
                      <select
                        value={scanFilterConfig.config.misterScan.newPlatformBehavior ?? 'ask'}
                        onChange={(event) => updateScanFilterConfig({ newPlatformBehavior: event.target.value as MiSTerScanFilterConfig['misterScan']['newPlatformBehavior'] })}
                        className="mt-1 w-full rounded-md border border-line px-2 py-1.5"
                      >
                        <option value="ask">확인 후 선택 - 새 플랫폼 발견 목록에 표시</option>
                        <option value="addDisabled">제외로 추가 - 목록에 남기고 가져오지 않음</option>
                        <option value="addEnabled">가져오기로 추가 - 다음 스캔부터 포함</option>
                        <option value="ignore">숨김 - 일반 목록에 표시하지 않음</option>
                      </select>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => void saveScanFilterConfig()} className="rounded-md bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-700">
                        저장
                      </button>
                      <button type="button" onClick={() => void resetScanFilterConfig()} className="rounded-md border border-line px-2 py-1 text-xs font-semibold hover:bg-neutral-50">
                        기본값으로 초기화
                      </button>
                      <button type="button" onClick={exportScanFilterConfig} className="rounded-md border border-line px-2 py-1 text-xs font-semibold hover:bg-neutral-50">
                        Export config
                      </button>
                      <label className="cursor-pointer rounded-md border border-line px-2 py-1 text-xs font-semibold hover:bg-neutral-50">
                        Import config
                        <input
                          type="file"
                          accept="application/json,.json"
                          className="sr-only"
                          onChange={(event) => {
                            void importScanFilterConfig(event.target.files?.[0]);
                            event.currentTarget.value = '';
                          }}
                        />
                      </label>
                      <button type="button" onClick={() => void openScanFilterConfigFolder()} className="rounded-md border border-line px-2 py-1 text-xs font-semibold hover:bg-neutral-50">
                        Config 폴더 열기
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-neutral-500">{scanFilterMessage || '동기화 설정을 불러오는 중입니다.'}</p>
                )}
                {scanFilterMessage && <p className="mt-2 rounded bg-neutral-50 px-2 py-1 text-xs text-neutral-600">{scanFilterMessage}</p>}
              </details>
              <details className="mt-4 rounded-md border border-blue-100 bg-blue-50/60 p-3" open>
                <summary className="cursor-pointer text-sm font-semibold text-blue-950">MiSTer 가져오기 설정</summary>
                <p className="mt-1 text-xs text-blue-800">
                  가져올 플랫폼 필터는 실제 스캔/가져오기에 포함할 플랫폼을 최종 선택하는 필터입니다.
                </p>
                <p className="mt-1 text-xs text-blue-800">
                  새 플랫폼 발견은 MiSTer에서 처음 발견된 플랫폼을 가져올지 제외할지 정하는 목록입니다.
                </p>
                <p className="mt-2 text-xs font-semibold text-blue-950">A. 가져올 플랫폼</p>
                <p className="mt-1 rounded bg-white px-2 py-1 text-xs text-blue-800">
                  안전을 위해 기본값은 모두 제외입니다. 가져올 플랫폼만 직접 선택하세요.
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <button type="button" onClick={selectAllVisibleImportPlatforms} className="rounded border border-blue-200 bg-white px-2 py-1 text-xs text-blue-700 hover:bg-blue-50">
                    현재 목록 전체 선택
                  </button>
                  <button type="button" onClick={clearSelectedImportPlatforms} className="rounded border border-blue-200 bg-white px-2 py-1 text-xs text-blue-700 hover:bg-blue-50">
                    전체 해제
                  </button>
                </div>
                <label className="mt-3 block text-xs">
                  <span className="font-medium text-blue-950">platform 검색</span>
                  <input
                    value={platformFilterQuery}
                    onChange={(event) => setPlatformFilterQuery(event.target.value)}
                    placeholder="Arcade, NeoGeo, SNES..."
                    className="mt-1 w-full rounded-md border border-blue-100 bg-white px-2 py-1.5"
                  />
                </label>
                {globalImportGroups.length === 0 ? (
                  <p className="mt-2 text-xs text-neutral-600">검색 조건에 맞는 platform이 없습니다.</p>
                ) : (
                  <div className="mt-3 max-h-72 space-y-3 overflow-auto pr-1">
                    {globalImportGroups.map(([group, platforms]) => (
                      <div key={group}>
                        <p className="mb-1 text-xs font-semibold text-blue-950">{group}</p>
                        <div className="grid gap-1 sm:grid-cols-2">
                          {platforms.map((platform) => {
                            const enabled = isGlobalPlatformImportEnabled(platform.platformKey);
                            return (
                              <label
                                key={platform.platformKey}
                                className={`flex items-center gap-2 rounded border px-2 py-1 text-xs ${
                                  enabled ? 'border-green-100 bg-white text-neutral-800' : 'border-amber-200 bg-amber-50 text-amber-900'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={enabled}
                                  onChange={(event) => toggleGlobalPlatformImport(platform.platformKey, event.target.checked)}
                                />
                                <span className="min-w-0 flex-1 truncate">
                                  <span className="font-medium">{platform.displayName}</span>
                                  <span className="ml-1 text-neutral-500">({platform.platformKey})</span>
                                </span>
                                <span className={`rounded-full px-1.5 py-0.5 ${enabled ? 'bg-green-50 text-green-700' : 'bg-amber-100'}`}>
                                  {enabled ? '가져오기' : '제외'}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-4 rounded-md border border-green-200 bg-green-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-green-950">커스텀 플랫폼 만들기</p>
                      <p className="mt-1 text-xs text-green-800">
                        /media/fat/_Arcade/PGM 같은 MiSTer 폴더를 별도 플랫폼으로 등록합니다. 등록만으로는 병합하지 않고, 라이브러리에 병합 버튼을 눌렀을 때만 게임 리스트에 추가됩니다.
                      </p>
                    </div>
                    <button type="button" onClick={openManualCustomPlatformRegistration} className="rounded border border-green-700 bg-white px-2 py-1 text-xs font-semibold text-green-800 hover:bg-green-100">
                      커스텀 플랫폼 만들기
                    </button>
                  </div>
                  {(zaparooLibrary.customPlatformCatalog ?? []).filter((item) => item.type === 'custom').length > 0 && (
                    <div className="mt-3 space-y-1">
                      {(zaparooLibrary.customPlatformCatalog ?? []).filter((item) => item.type === 'custom').map((item) => {
                        const candidateCount = customPlatformCandidateEntries(item).length;
                        const sourceScan = customPlatformSourceScans[item.platformKey];
                        return (
                          <div key={item.platformKey} className="flex flex-wrap items-center justify-between gap-2 rounded bg-white px-2 py-2 text-xs">
                            <div className="min-w-0">
                              <p className="truncate font-medium">{item.displayName} <span className="text-neutral-500">({item.platformKey})</span></p>
                              <p className="truncate text-neutral-500">sourceRoot: {(item.sourceRoots ?? []).join(', ') || '-'}</p>
                              <p className="truncate text-neutral-500">extensions: {(item.knownExtensions ?? []).join(', ') || '-'} · scan: {customPlatformScanRangeLabel(item.scanDepth ?? 2, item.recursive ?? false)} · coreRoot: {item.coreRoot || '-'}</p>
                              {sourceScan && (
                                <div className="mt-1 space-y-1">
                                  <p className={`truncate ${sourceScan.phase === 'failed' ? 'text-red-700' : 'text-green-700'}`}>
                                    sourceRoot scan: {sourceScan.message} · 전체 파일 {sourceScan.diagnostics?.totalFiles ?? sourceScan.rawFilesScanned}개 · 최종 후보 {sourceScan.diagnostics?.finalCandidateFiles ?? sourceScan.entries.length}개
                                  </p>
                                  {sourceScan.diagnostics && (
                                    <details className="rounded border border-green-100 bg-green-50 px-2 py-1 text-[11px] text-green-950">
                                      <summary className="cursor-pointer font-semibold">스캔 상세</summary>
                                      <div className="mt-1 grid gap-1 sm:grid-cols-2">
                                        <span>스캔 범위: {customPlatformScanRangeLabel(sourceScan.diagnostics.scanDepth, sourceScan.diagnostics.recursive)}</span>
                                        <span>스캔한 폴더: {sourceScan.diagnostics.foldersScanned}개</span>
                                        <span>전체 파일: {sourceScan.diagnostics.totalFiles}개</span>
                                        <span>MRA 파일: {sourceScan.diagnostics.mraFiles}개</span>
                                        <span>확장자 필터 통과: {sourceScan.diagnostics.extensionAcceptedFiles}개</span>
                                        <span>확장자 제외: {sourceScan.diagnostics.extensionExcludedFiles}개</span>
                                        <span>폴더/숨김 제외: {sourceScan.diagnostics.folderExcludedFiles}개</span>
                                        <span>깊이 제한 폴더: {sourceScan.diagnostics.depthLimitedFolders}개</span>
                                        <span>중복 경로 제외: {sourceScan.diagnostics.duplicateFullPathFiles}개</span>
                                        <span>최종 후보: {sourceScan.diagnostics.finalCandidateFiles}개</span>
                                      </div>
                                      {topCustomPlatformReasonEntries(sourceScan.diagnostics).length > 0 && (
                                        <p className="mt-1">
                                          제외 이유: {topCustomPlatformReasonEntries(sourceScan.diagnostics).map(([reason, count]) => `${customPlatformReasonLabel(reason)} ${count}개`).join(', ')}
                                        </p>
                                      )}
                                      {topCustomPlatformExtensionEntries(sourceScan.diagnostics).length > 0 && (
                                        <p className="mt-1">
                                          제외 확장자: {topCustomPlatformExtensionEntries(sourceScan.diagnostics).map(([extension, count]) => `${extension} ${count}개`).join(', ')}
                                        </p>
                                      )}
                                      <p className="mt-1 text-green-800">현재 포함 확장자: {(item.knownExtensions ?? []).join(', ') || '전체'}. MRA 기반 아케이드는 .mra를 게임 후보로 보고, .zip 등 ROM 묶음은 기본 후보에서 제외합니다.</p>
                                    </details>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="rounded-full bg-green-100 px-2 py-0.5 font-semibold text-green-800">후보 {candidateCount}개</span>
                              <button type="button" onClick={() => void refreshCustomPlatformSourceScan(item.platformKey)} disabled={sourceScan?.phase === 'scanning'} className="rounded border border-green-300 bg-white px-2 py-1 font-semibold text-green-800 hover:bg-green-50 disabled:opacity-50">
                                sourceRoot 스캔
                              </button>
                              <button type="button" onClick={() => void mergeCustomPlatformToLibrary(item.platformKey)} className="rounded bg-green-700 px-2 py-1 font-semibold text-white hover:bg-green-800">
                                라이브러리에 병합
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                {discoveredPlatformRows.length === 0 && (
                  <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-2">
                    <p className="text-xs font-semibold text-amber-950">B. 새 플랫폼 발견</p>
                    <p className="mt-1 text-xs text-amber-800">기존 게임 리스트에 없는 플랫폼만 표시합니다.</p>
                    <p className="mt-2 rounded bg-white px-2 py-1 text-xs text-amber-900">새 플랫폼이 없습니다.</p>
                  </div>
                )}
                {discoveredPlatformRows.length > 0 && (
                  <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-2">
                    <p className="text-xs font-semibold text-amber-950">B. 새 플랫폼 발견</p>
                    <p className="mt-1 text-xs text-amber-800">기존 게임 리스트에 없는 플랫폼만 표시합니다.</p>
                    <p className="mt-1 text-xs text-amber-800">
                      바로 추가는 재스캔 없이 이번 스캔 결과를 미스터 게임 리스트에 즉시 병합합니다. 커스텀 등록은 sourceRoot/확장자를 직접 지정할 때, 제외는 목록에 남기되 게임을 가져오지 않을 때 사용합니다.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <button type="button" onClick={selectAllVisibleDiscoveredPlatforms} className="rounded border border-amber-300 bg-white px-2 py-1 text-xs text-amber-900 hover:bg-amber-100">
                        현재 목록 전체 선택
                      </button>
                      <button type="button" onClick={() => setDiscoveredPlatformSelectedKeys([])} className="rounded border border-amber-300 bg-white px-2 py-1 text-xs text-amber-900 hover:bg-amber-100">
                        선택 해제
                      </button>
                      <button type="button" onClick={() => mergeDiscoveredPlatformsToLibrary(discoveredPlatformRows.map((row) => row.key))} className="rounded bg-amber-600 px-2 py-1 text-xs font-semibold text-white hover:bg-amber-700">
                        스캔된 새 플랫폼 전부 추가
                      </button>
                      <button type="button" disabled={discoveredPlatformSelectedKeys.length === 0} onClick={() => mergeDiscoveredPlatformsToLibrary(discoveredPlatformSelectedKeys)} className="rounded bg-green-700 px-2 py-1 text-xs font-semibold text-white hover:bg-green-800 disabled:opacity-40">
                        선택 바로 추가
                      </button>
                      <button type="button" disabled={discoveredPlatformSelectedKeys.length === 0} onClick={() => openCustomPlatformRegistration(discoveredPlatformRows.find((row) => discoveredPlatformSelectedKeys.includes(row.key)) ?? discoveredPlatformRows[0])} className="rounded border border-green-200 bg-white px-2 py-1 text-xs text-green-700 hover:bg-green-50 disabled:opacity-40">
                        커스텀 등록
                      </button>
                      <button type="button" disabled={discoveredPlatformSelectedKeys.length === 0} onClick={() => applyDiscoveredPlatformBulkState('disabled')} className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40">
                        선택 제외
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-amber-900">선택됨: {discoveredPlatformSelectedKeys.length}개</p>
                    <div className="mt-2 space-y-1">
                      {discoveredPlatformRows.map((row) => (
                        <div key={row.key} className="rounded bg-white px-2 py-2 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <label className="flex min-w-0 flex-1 items-center gap-2">
                              <input
                                type="checkbox"
                                checked={discoveredPlatformSelectedKeys.includes(row.key)}
                                onChange={() => toggleDiscoveredPlatformSelected(row.key)}
                              />
                              <span className="min-w-0">
                                <span className="block truncate font-medium">{row.name} <span className="text-neutral-500">({row.key})</span></span>
                                <span className="block truncate text-neutral-500">{row.path}</span>
                              </span>
                            </label>
                            <span className={`rounded-full px-2 py-0.5 font-semibold ${
                              row.status === 'enabled'
                                ? 'bg-green-50 text-green-700'
                                : row.status === 'ignored'
                                  ? 'bg-red-50 text-red-700'
                                  : row.status === 'pending'
                                    ? 'bg-amber-100 text-amber-900'
                                    : 'bg-neutral-100 text-neutral-700'
                            }`}>
                              상태: {row.status === 'enabled' ? '가져오기' : row.status === 'disabled' ? '제외' : row.status === 'ignored' ? '숨김' : '확인 필요'}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                            <p className="text-neutral-500">
                              게임 {row.gameCount}개 · 마지막 발견 {row.lastDiscoveredAt ? new Date(row.lastDiscoveredAt).toLocaleString() : '-'}
                            </p>
                            <div className="flex flex-wrap gap-1">
                              <button
                                type="button"
                                title="이번 스캔 결과를 재스캔 없이 미스터 게임 리스트에 바로 추가"
                                onClick={() => mergeDiscoveredPlatformsToLibrary([row.key])}
                                className={`rounded border px-2 py-1 font-semibold ${
                                  row.status === 'enabled'
                                    ? 'border-green-600 bg-green-600 text-white shadow-sm'
                                    : 'border-green-600 bg-green-600 text-white hover:bg-green-700'
                                }`}
                              >
                                바로 추가 {row.status === 'enabled' ? '✓' : ''}
                              </button>
                              <button
                                type="button"
                                title="sourceRoot/확장자를 직접 지정하는 커스텀 플랫폼으로 등록"
                                onClick={() => openCustomPlatformRegistration(row)}
                                className="rounded border border-green-200 px-2 py-1 font-semibold text-green-700 hover:bg-green-50"
                              >
                                커스텀 등록
                              </button>
                              <button
                                type="button"
                                title="플랫폼이 아닌 분류 폴더로만 사용"
                                onClick={() => markDiscoveredPlatformAsClassificationFolder(row.key)}
                                className={`rounded border px-2 py-1 font-semibold ${
                                  row.status === 'disabled'
                                    ? 'border-neutral-700 bg-neutral-800 text-white shadow-sm'
                                    : 'border-neutral-300 text-neutral-700 hover:bg-neutral-50'
                                }`}
                              >
                                제외 {row.status === 'disabled' ? '✓' : ''}
                              </button>
                              {row.status === 'ignored' && (
                                <button type="button" onClick={() => setDiscoveredPlatformImportState(row.key, row.entry, 'disabled')} className="rounded border border-blue-200 px-2 py-1 text-blue-700 hover:bg-blue-50">
                                  복원
                                </button>
                              )}
                              {row.status !== 'ignored' && (
                                <button type="button" onClick={() => ignoreUnknownPlatform(row.key)} className="rounded border border-red-100 px-2 py-1 text-red-600 hover:bg-red-50">
                                  숨김
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {customPlatformDraft && (
                  <div className="mt-4 rounded-md border border-green-200 bg-white p-3 text-xs shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-green-900">사용자 정의 플랫폼 등록</p>
                        <p className="mt-1 text-green-800">
                          PGM 같은 MiSTer 폴더 기반 플랫폼을 카드 제작/실행/NFC에서 쓸 수 있는 플랫폼으로 등록합니다.
                        </p>
                      </div>
                      <button type="button" onClick={() => setCustomPlatformDraft(null)} className="rounded border border-line px-2 py-1 text-neutral-600 hover:bg-neutral-50">
                        닫기
                      </button>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <label className="block">
                        <span className="font-medium text-neutral-700">표시 이름</span>
                        <input
                          value={customPlatformDraft.displayName}
                          onChange={(event) => setCustomPlatformDraft({ ...customPlatformDraft, displayName: event.target.value })}
                          className="mt-1 w-full rounded border border-line px-2 py-1"
                        />
                      </label>
                      <label className="block">
                        <span className="font-medium text-neutral-700">플랫폼 ID</span>
                        <input
                          value={customPlatformDraft.platformId}
                          onChange={(event) => setCustomPlatformDraft({ ...customPlatformDraft, platformId: event.target.value })}
                          className="mt-1 w-full rounded border border-line px-2 py-1"
                        />
                      </label>
                      <label className="block">
                        <span className="font-medium text-neutral-700">별칭</span>
                        <input
                          value={customPlatformDraft.aliases}
                          onChange={(event) => setCustomPlatformDraft({ ...customPlatformDraft, aliases: event.target.value })}
                          placeholder="PGM, IGS PGM, PolyGame Master"
                          className="mt-1 w-full rounded border border-line px-2 py-1"
                        />
                      </label>
                      <label className="block">
                        <span className="font-medium text-neutral-700">상위 분류</span>
                        <input
                          value={customPlatformDraft.parentSystem}
                          onChange={(event) => setCustomPlatformDraft({ ...customPlatformDraft, parentSystem: event.target.value })}
                          className="mt-1 w-full rounded border border-line px-2 py-1"
                        />
                      </label>
                      <label className="block md:col-span-2">
                        <span className="font-medium text-neutral-700">MiSTer source root</span>
                        <input
                          value={customPlatformDraft.sourceRoot}
                          onChange={(event) => setCustomPlatformDraft({ ...customPlatformDraft, sourceRoot: event.target.value })}
                          className="mt-1 w-full rounded border border-line px-2 py-1 font-mono"
                        />
                      </label>
                      <label className="block md:col-span-2">
                        <span className="font-medium text-neutral-700">Core folder (optional)</span>
                        <input
                          value={customPlatformDraft.coreRoot}
                          onChange={(event) => setCustomPlatformDraft({ ...customPlatformDraft, coreRoot: event.target.value })}
                          placeholder="/media/fat/_Arcade/cores"
                          className="mt-1 w-full rounded border border-line px-2 py-1 font-mono"
                        />
                      </label>
                      <label className="block">
                        <span className="font-medium text-neutral-700">확장자</span>
                        <input
                          value={customPlatformDraft.extensions}
                          onChange={(event) => setCustomPlatformDraft({ ...customPlatformDraft, extensions: event.target.value })}
                          placeholder=".zip, .7z"
                          className="mt-1 w-full rounded border border-line px-2 py-1"
                        />
                      </label>
                      <label className="block">
                        <span className="font-medium text-neutral-700">스캔 범위</span>
                        <select
                          value={customPlatformDraft.recursive ? 'recursive' : String(customPlatformDraft.scanDepth)}
                          onChange={(event) => {
                            const value = event.target.value;
                            setCustomPlatformDraft({
                              ...customPlatformDraft,
                              scanDepth: value === 'recursive' ? 3 : normalizeScanDepth(Number(value)),
                              recursive: value === 'recursive',
                            });
                          }}
                          className="mt-1 w-full rounded border border-line px-2 py-1"
                        >
                          <option value="1">바로 아래만</option>
                          <option value="2">2단계까지</option>
                          <option value="3">3단계까지</option>
                          <option value="recursive">전체 하위 폴더</option>
                        </select>
                      </label>
                      <label className="block">
                        <span className="font-medium text-neutral-700">카드 카테고리</span>
                        <input
                          value={customPlatformDraft.cardCategory}
                          onChange={(event) => setCustomPlatformDraft({ ...customPlatformDraft, cardCategory: event.target.value })}
                          className="mt-1 w-full rounded border border-line px-2 py-1"
                        />
                      </label>
                      <label className="block md:col-span-2">
                        <span className="font-medium text-neutral-700">Launch format</span>
                        <input
                          value={customPlatformDraft.launchTemplate}
                          onChange={(event) => setCustomPlatformDraft({ ...customPlatformDraft, launchTemplate: event.target.value })}
                          placeholder="**launch:{misterPath}"
                          className="mt-1 w-full rounded border border-line px-2 py-1 font-mono"
                        />
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-neutral-600">
                        후보 {customPlatformDraftCandidateCount(customPlatformDraft)}개. 등록 후에도 자동 병합하지 않습니다. 라이브러리에 병합 버튼을 따로 눌러야 합니다.
                      </p>
                      {customPlatformDraftCandidateCount(customPlatformDraft) === 0 && (
                        <p className="basis-full text-xs text-amber-700">
                          선택한 폴더 바로 아래에는 대상 파일이 없습니다. 스캔 범위를 2단계 이상으로 변경해 보세요.
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setCustomPlatformDraft(null)} className="rounded border border-line px-3 py-1.5 text-neutral-700 hover:bg-neutral-50">
                          취소
                        </button>
                        <button type="button" onClick={registerCustomPlatformFromDraft} className="rounded bg-green-700 px-3 py-1.5 font-semibold text-white hover:bg-green-800">
                          플랫폼 등록
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </details>
              <div className="mt-4 rounded-md border border-line bg-neutral-50 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-medium">MiSTer 스캔 상태</p>
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                    bridgeScanStatus.phase === 'done'
                      ? 'bg-green-50 text-green-700'
                      : bridgeScanStatus.phase === 'failed'
                        ? 'bg-red-50 text-red-700'
                        : bridgeScanStatus.phase === 'idle'
                          ? 'bg-neutral-100 text-neutral-600'
                          : 'bg-cyan-50 text-cyan-700'
                  }`}>
                    {bridgeScanStatus.phase}
                  </span>
                </div>
                <p className="mt-2 text-neutral-700">{bridgeScanStatus.message}</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-4 xl:grid-cols-8">
                  <div className="rounded bg-white p-2"><p className="text-xs text-neutral-500">스캔한 파일</p><p className="font-semibold">{bridgeScanStatus.rawFilesScanned}</p></div>
                  <div className="rounded bg-white p-2"><p className="text-xs text-neutral-500">제외된 파일</p><p className="font-semibold">{bridgeScanStatus.skippedFiles}</p></div>
                  <div className="rounded bg-white p-2"><p className="text-xs text-neutral-500">실행 가능 게임</p><p className="font-semibold">{bridgeScanStatus.executableGames}</p></div>
                  <div className="rounded bg-white p-2"><p className="text-xs text-neutral-500">실행 불가 항목</p><p className="font-semibold">{bridgeScanStatus.nonExecutableEntries}</p></div>
                  <div className="rounded bg-white p-2"><p className="text-xs text-neutral-500">필터 제외 게임</p><p className="font-semibold">{bridgeScanStatus.filteredEntries}</p></div>
                  <div className="rounded bg-white p-2"><p className="text-xs text-neutral-500">병합 예정 게임</p><p className="font-semibold">{bridgeScanStatus.candidateEntries}</p></div>
                  <div className="rounded bg-white p-2"><p className="text-xs text-neutral-500">병합 후 게임</p><p className="font-semibold">{bridgeScanStatus.mergedEntries}</p></div>
                  <div className="rounded bg-white p-2"><p className="text-xs text-neutral-500">중복 건너뜀</p><p className="font-semibold">{bridgeScanStatus.skippedDuplicates}</p></div>
                </div>
                {bridgeScanStatus.rootStatuses.length > 0 && (
                  <div className="mt-3 overflow-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="text-left text-neutral-500">
                          <th className="border-b border-line py-1 pr-3">Root</th>
                          <th className="border-b border-line py-1 pr-3">상태</th>
                          <th className="border-b border-line py-1 pr-3">스캔한 파일</th>
                          <th className="border-b border-line py-1 pr-3">게임 항목</th>
                          <th className="border-b border-line py-1 pr-3">작은 파일 제외</th>
                          <th className="border-b border-line py-1 pr-3">확장자 제외</th>
                          <th className="border-b border-line py-1 pr-3">폴더 제외</th>
                          <th className="border-b border-line py-1">메시지</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bridgeScanStatus.rootStatuses.map((root) => (
                          <tr key={root.root}>
                            <td className="border-b border-line py-1 pr-3 font-mono">{root.root}</td>
                            <td className="border-b border-line py-1 pr-3">{root.status}</td>
                            <td className="border-b border-line py-1 pr-3">{root.rawFilesScanned ?? root.fileCount}</td>
                            <td className="border-b border-line py-1 pr-3">{root.fileCount}</td>
                            <td className="border-b border-line py-1 pr-3">{root.tinyFileSkippedCount ?? 0}</td>
                            <td className="border-b border-line py-1 pr-3">{root.extensionSkippedCount ?? 0}</td>
                            <td className="border-b border-line py-1 pr-3">{root.ignoredDirectorySkippedCount ?? 0}</td>
                            <td className="border-b border-line py-1 text-neutral-600">{root.message ?? root.resolvedRoots?.join(', ') ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {bridgeScanStatus.platformStatuses.length > 0 && (
                  <div className="mt-4 overflow-auto rounded-md border border-line bg-white p-2">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-neutral-700">플랫폼별 스캔 상태</p>
                      <p className="text-[11px] text-neutral-500">게임/아케이드 루트를 실제 플랫폼 단위로 풀어서 보여줍니다.</p>
                    </div>
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="text-left text-neutral-500">
                          <th className="border-b border-line py-1 pr-3">플랫폼</th>
                          <th className="border-b border-line py-1 pr-3">그룹</th>
                          <th className="border-b border-line py-1 pr-3">스캔 항목</th>
                          <th className="border-b border-line py-1 pr-3">실행 가능</th>
                          <th className="border-b border-line py-1 pr-3">실행 불가</th>
                          <th className="border-b border-line py-1 pr-3">가져오기 선택</th>
                          <th className="border-b border-line py-1">기존 경로 중복</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bridgeScanStatus.platformStatuses.map((platform) => (
                          <tr key={platform.platformKey}>
                            <td className="border-b border-line py-1 pr-3 font-medium">{platform.systemId}</td>
                            <td className="border-b border-line py-1 pr-3 text-neutral-600">{platform.platformGroup}</td>
                            <td className="border-b border-line py-1 pr-3">{platform.entryCount}</td>
                            <td className="border-b border-line py-1 pr-3">{platform.executableGames}</td>
                            <td className="border-b border-line py-1 pr-3">{platform.nonExecutableEntries}</td>
                            <td className="border-b border-line py-1 pr-3">{platform.selectedEntries}</td>
                            <td className="border-b border-line py-1 text-neutral-600">{platform.existingPathDuplicates}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
            <div className="rounded-md border border-line p-3 text-sm">
              <div className="mb-3 grid grid-cols-2 gap-2">
                <div className="rounded bg-neutral-50 p-2"><p className="text-xs text-neutral-500">미스터 항목</p><p className="font-semibold">{zaparooLibrary.entries.length}</p></div>
                <div className="rounded bg-neutral-50 p-2"><p className="text-xs text-neutral-500">Platforms</p><p className="font-semibold">{libraryPlatformCount}</p></div>
              </div>
              <p className="font-medium">MiSTer profile</p>
              <div className="mt-3 space-y-2">
                {zaparooLibrary.profiles.length === 0 ? (
                  <p className="text-neutral-600">아직 동기화된 기기가 없습니다.</p>
                ) : (
                  zaparooLibrary.profiles.map((profile) => (
                    <div
                      key={profile.deviceId}
                      className={`rounded border p-2 ${zaparooLibrary.activeProfileId === profile.deviceId ? 'border-cyan-500 bg-cyan-50' : 'border-line'}`}
                    >
                      <button type="button" onClick={() => selectProfile(profile.deviceId)} className="w-full text-left">
                        <p className="font-medium">{misterDisplayName(profile)}</p>
                        <p className="text-xs text-neutral-500">{profile.deviceName} · {profile.host ?? '수동 가져오기'} · {profile.scanSource}</p>
                        <p className="text-xs text-neutral-500">
                          실행 가능 게임 {profile.playableEntryCount ?? profile.entryCount}개 · 실행 불가 항목 {profile.nonPlayableEntryCount ?? 0}개 · 병합 후 게임 {profile.mergedEntryCount ?? profile.entryIds.length}개
                        </p>
                        <p className="text-xs text-neutral-500">마지막 동기화: {new Date(profile.lastSyncAt).toLocaleString()}</p>
                        {zaparooLibrary.activeProfileId === profile.deviceId && <p className="mt-1 text-xs font-medium text-cyan-700">활성 profile</p>}
                      </button>
                      <label className="mt-2 block text-xs">
                        <span className="font-medium">별칭</span>
                        <input
                          defaultValue={profile.alias ?? ''}
                          onBlur={(event) => updateProfileAlias(profile.deviceId, event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                          }}
                          className="mt-1 w-full rounded-md border border-line px-2 py-1.5"
                          placeholder="예: 거실 MiSTer"
                        />
                      </label>
                      <p className="mt-2 text-[11px] text-neutral-500">Platform 가져오기 여부는 위 전역 필터에서 관리합니다.</p>
                      {developerMode && (
                        <button
                          type="button"
                          onClick={() => requestDeleteProfile(profile.deviceId)}
                          className="mt-2 rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          이 미스터 라이브러리 삭제
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {activeSection === 'browser' && (
        <section className="rounded-lg border border-line bg-white p-5 shadow-surface">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              <h2 className="text-lg font-semibold">미스터 게임 리스트</h2>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={createLibraryBackup} className="rounded-md border border-line px-3 py-2 text-sm font-medium hover:bg-neutral-50">
                라이브러리 백업
              </button>
              <button type="button" onClick={makeCards} disabled={!isBatchCardCreateCountAllowed(selectedIds.length)} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-40">
                카드 만들기 ({selectedIds.length})
              </button>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-blue-100 bg-blue-50/50 px-3 py-2 text-sm">
            {zaparooLibrary.profiles.length > 0 && (
              <>
                <span className="font-medium text-blue-950">미스터 기기</span>
                <select
                  value={libraryDeviceFilter}
                  onChange={(event) => setLibraryDeviceFilter(event.target.value)}
                  className="rounded-md border border-line bg-white px-2 py-1.5"
                >
                  <option value="__all__">전체 기기 ({zaparooLibrary.entries.length})</option>
                  {zaparooLibrary.profiles.map((profile) => {
                    const count = zaparooLibrary.entries.filter((entry) => entry.sourceDevices.includes(profile.deviceId)).length;
                    return (
                      <option key={profile.deviceId} value={profile.deviceId}>
                        {misterDisplayName(profile)} ({count})
                      </option>
                    );
                  })}
                </select>
                <span
                  className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-blue-200 text-[10px] font-bold text-blue-800"
                  title="선택한 미스터의 게임만 표시합니다. 새로고침은 각 미스터를 따로 스캔합니다."
                >
                  ?
                </span>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-blue-800">
                  연결됨 {connectedDevices.length}대
                </span>
                <button
                  type="button"
                  onClick={() => void refreshConnectedDevices()}
                  className="rounded border border-blue-200 bg-white px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-100"
                >
                  연결 새로고침
                </button>
                {developerMode && libraryDeviceFilter !== '__all__' && (
                  <button
                    type="button"
                    onClick={() => requestDeleteProfile(libraryDeviceFilter)}
                    className="rounded border border-red-200 bg-white px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-50"
                    title="선택한 미스터의 게임 라이브러리를 삭제합니다. 다른 미스터에도 있는 게임과 저장된 카드는 유지됩니다."
                  >
                    이 미스터 라이브러리 삭제
                  </button>
                )}
              </>
            )}
            <label className="relative ml-auto block min-w-[200px] max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-neutral-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Library 검색" className="w-full rounded-md border border-line bg-white py-2 pl-8 pr-2 text-sm" />
            </label>
          </div>

          {runFix && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="font-medium">{runFix.deviceLabel}의 Zaparoo가 원격 실행을 막고 있습니다 (allow_run 미설정).</span>
              <button type="button" disabled={zaparooApplyBusy} onClick={() => void applyRunPermission()} className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
                {zaparooApplyBusy ? '적용 중...' : '실행 허용 설정 적용'}
              </button>
              <span className="text-xs">적용 후 미스터에서 Zaparoo 재시작/재부팅 → 다시 실행하세요.</span>
              <button type="button" onClick={() => setRunFix(null)} className="ml-auto text-xs text-amber-700 underline">닫기</button>
            </div>
          )}

          {query && (
            <p className="mb-3 text-xs text-neutral-500">
              검색 범위: {librarySearchScope === 'all' ? '전체 라이브러리' : selectedPlatform === '__with_cards__' ? '카드 있음 목록' : selectedPlatform === '__all_library__' ? '전체 라이브러리' : selectedPlatform || '현재 플랫폼'}.
            </p>
          )}

          <div className="grid items-start gap-4" style={{ gridTemplateColumns: `${platformPanelWidth}px minmax(0, 1fr)` }}>
            <aside className="relative flex max-h-[78vh] flex-col rounded-md border border-line bg-neutral-50 p-3 lg:sticky lg:top-2">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold">Platform <span className="font-normal text-neutral-500">({platformBuckets.length})</span></p>
                {collapsedPlatformGroups.size > 0 ? (
                  <button type="button" onClick={() => setCollapsedPlatformGroups(new Set())} className="text-[11px] text-blue-700 hover:underline">모두 펼치기</button>
                ) : (
                  <button type="button" onClick={() => setCollapsedPlatformGroups(new Set(platformGroupSections.map((section) => section.group)))} className="text-[11px] text-blue-700 hover:underline">모두 접기</button>
                )}
              </div>
              <div className="mb-2 flex gap-1 text-xs">
                <button type="button" onClick={() => setPlatformGroupMode('group')} className={`flex-1 rounded-md border px-2 py-1 ${platformGroupMode === 'group' ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-line bg-white text-neutral-600'}`}>그룹별</button>
                <button type="button" onClick={() => setPlatformGroupMode('alpha')} className={`flex-1 rounded-md border px-2 py-1 ${platformGroupMode === 'alpha' ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-line bg-white text-neutral-600'}`}>알파벳</button>
              </div>
              <div className="-mr-1 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
                <button
                  type="button"
                  onClick={() => setSelectedPlatform('__all_library__')}
                  className={`w-full shrink-0 rounded-md px-3 py-2 text-left text-sm ${selectedPlatform === '__all_library__' ? 'bg-primary text-white shadow-selected' : 'border border-line bg-white hover:bg-blue-50'}`}
                >
                  <span className="block truncate font-medium">라이브러리 전체 보기</span>
                  <span className="block text-xs opacity-80">{visibleLibraryEntries.length}개 항목</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPlatform('__with_cards__')}
                  className={`w-full shrink-0 rounded-md px-3 py-2 text-left text-sm ${selectedPlatform === '__with_cards__' ? 'bg-primary text-white shadow-selected' : 'border border-line bg-white hover:bg-blue-50'}`}
                >
                  <span className="block truncate font-medium">카드 있음</span>
                  <span className="block text-xs opacity-80">{visibleLibraryEntries.filter((entry) => entry.hasCard).length}개 게임</span>
                </button>
                {platformBuckets.length === 0 && <p className="text-sm text-neutral-600">아직 미스터 게임 리스트 항목이 없습니다.</p>}
                {favoritePlatformBuckets.length > 0 && (
                  <div className="shrink-0">
                    <div className="px-1 py-1 text-xs font-semibold text-amber-600">★ 즐겨찾기 ({favoritePlatformBuckets.length})</div>
                    <div className="flex flex-col gap-1">
                      {favoritePlatformBuckets.map((bucket) => platformRow(bucket, 'fav'))}
                    </div>
                  </div>
                )}
                {platformGroupSections.length === 0 && platformBuckets.length > 0 && <p className="text-xs text-neutral-500">검색 결과가 없습니다.</p>}
                {platformGroupSections.map((section) => {
                  const collapsed = collapsedPlatformGroups.has(section.group);
                  return (
                    <div key={section.group} className="shrink-0">
                      <button
                        type="button"
                        onClick={() => togglePlatformGroup(section.group)}
                        className="flex w-full items-center justify-between rounded-md bg-neutral-200/70 px-2 py-1 text-left text-xs font-semibold text-neutral-700 hover:bg-neutral-200"
                      >
                        <span>{collapsed ? '▸' : '▾'} {section.group} ({section.buckets.length})</span>
                        <span className="font-normal text-neutral-500">{section.total}</span>
                      </button>
                      {!collapsed && (
                        <div className="mt-1 flex flex-col gap-1">
                          {section.buckets.map((bucket) => platformRow(bucket, 'grp'))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div
                onPointerDown={startPlatformResize}
                title="드래그하여 플랫폼 목록 너비 조절"
                role="separator"
                aria-orientation="vertical"
                className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize rounded-r-md hover:bg-primary/40"
                style={{ touchAction: 'none' }}
              />
            </aside>
            <div className="min-w-0 max-h-[78vh] overflow-y-auto">
              {!selectedPlatform ? (
                <p className="rounded-md border border-dashed border-line bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-600">
                  왼쪽 platform을 선택하면 해당 platform의 게임만 표시됩니다.
                </p>
              ) : (
                <>
                  <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-white/95 p-3 backdrop-blur">
                    <div className="flex flex-wrap items-center gap-2">
                      <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} className="rounded-md border border-line px-2 py-2 text-sm">
                        <option value="title">정렬: 제목</option>
                        <option value="platform">정렬: platform/system</option>
                        <option value="last-synced">정렬: 마지막 동기화</option>
                        <option value="card-created">정렬: 카드 생성</option>
                        <option value="image-matched">정렬: 이미지 매칭</option>
                      </select>
                      <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="rounded-md border border-line px-2 py-2 text-sm">
                        <option value={20}>20개씩 보기</option>
                        <option value={50}>50개씩 보기</option>
                        <option value={100}>100개씩 보기</option>
                      </select>
                    </div>
                    <p className="text-sm text-neutral-600">{selectedPlatform === '__with_cards__' ? '카드 있음' : selectedPlatform === '__all_library__' ? '전체 라이브러리' : selectedPlatform} - {filteredEntries.length}개 게임</p>
                  </div>
                  {filteredEntries.length === 0 && selectedPlatform === '__with_cards__' && (
                    <p className="mb-3 rounded-md border border-dashed border-line bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-600">
                      아직 카드가 연결된 게임이 없습니다.
                    </p>
                  )}
                  <div className="overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase text-neutral-500">
                          <th className="border-b border-line px-2 py-2">선택</th>
                          <th className="border-b border-line px-2 py-2">제목</th>
                          <th className="border-b border-line px-2 py-2">한글명</th>
                          <th className="border-b border-line px-2 py-2">System</th>
                          <th className="border-b border-line px-2 py-2">상태</th>
                          <th className="border-b border-line px-2 py-2">작업</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageGroups.map((group) => {
                          const entry = group.representative;
                          const isExpanded = expandedGameKeys.has(group.key);
                          const versionCount = group.versions.length;
                          const selected = selectedIds.includes(entry.id);
                          return (
                          <Fragment key={group.key}>
                          <tr
                            onMouseDown={(event) => {
                              const target = event.target as HTMLElement;
                              if (target.tagName === 'INPUT' || target.closest('button,a,select')) return;
                              event.preventDefault();
                              setLibraryDragSelecting(true);
                              selectLibraryEntry(entry.id, { shift: event.shiftKey });
                            }}
                            onMouseEnter={() => {
                              if (libraryDragSelecting) selectLibraryEntry(entry.id, { forceAdd: true });
                            }}
                            className={`cursor-pointer select-none ${selected ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : 'hover:bg-blue-50/60'}`}
                          >
                            <td className="border-b border-line px-2 py-2">
                              <input
                                type="checkbox"
                                checked={selected}
                                onClick={(event) => event.stopPropagation()}
                                onChange={() => toggleEntry(entry.id)}
                              />
                            </td>
                            <td className="border-b border-line px-2 py-2 font-medium">
                              <div className="flex items-start gap-2">
                                <div className="min-w-0">
                                  {entry.title}
                                  <p className="text-xs font-normal text-neutral-500">{entry.relativePath}</p>
                                </div>
                                {versionCount > 1 && (
                                  <button
                                    type="button"
                                    title="버전 목록 펼치기 / 대표 버전 선택"
                                    onClick={(event) => { event.stopPropagation(); toggleGameVersions(group.key); }}
                                    className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 hover:bg-blue-50"
                                  >
                                    버전 {versionCount} {isExpanded ? '▴' : '▾'}
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="border-b border-line px-2 py-2 text-neutral-600">{entry.koTitle || '-'}</td>
                            <td className="border-b border-line px-2 py-2">{entry.platformGroup} / {entry.systemId}</td>
                            <td className="border-b border-line px-2 py-2">
                              {entryBadges(entry)}
                              {mediaMatches[entry.id] && (
                                <p className={`mt-1 text-xs ${mediaMatches[entry.id].status === 'error' ? 'text-red-600' : 'text-neutral-500'}`}>
                                  {mediaMatches[entry.id].message}
                                </p>
                              )}
                            </td>
                            <td className="border-b border-line px-2 py-2">
                              <div className="flex flex-wrap gap-1.5">
                                <button
                                  type="button"
                                  title="Zaparoo Core API로 실행"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void launchLibraryEntry(entry);
                                  }}
                                  disabled={launchingEntryId === entry.id}
                                  className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium hover:bg-blue-50 disabled:opacity-50"
                                >
                                  <Play className="h-3.5 w-3.5" /> 실행
                                </button>
                                <button
                                  type="button"
                                  title="NFC 관리로 보내기"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    sendEntryToNfc(entry);
                                  }}
                                  className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium hover:bg-cyan-50"
                                >
                                  <Nfc className="h-3.5 w-3.5" /> NFC
                                </button>
                                <button
                                  type="button"
                                  title="Zaparoo media database 검색"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void searchMediaForEntry(entry);
                                  }}
                                  disabled={mediaMatches[entry.id]?.status === 'searching'}
                                  className="rounded-md border border-line px-2 py-1 text-xs font-medium hover:bg-neutral-50 disabled:opacity-50"
                                >
                                  media
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isExpanded && versionCount > 1 && (
                            <tr className="bg-neutral-50/70">
                              <td className="border-b border-line"></td>
                              <td colSpan={5} className="border-b border-line px-2 py-2">
                                <div className="space-y-1">
                                  {group.versions.map((version) => (
                                    <div key={version.id} className="flex items-center justify-between gap-2 rounded border border-line bg-white px-2 py-1">
                                      <div className="min-w-0">
                                        <span className="text-xs font-medium">{version.title}</span>
                                        <span className="ml-2 text-[11px] text-neutral-500">{version.relativePath}</span>
                                      </div>
                                      <div className="flex shrink-0 items-center gap-1">
                                        {version.id === entry.id ? (
                                          <span className="rounded bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">대표</span>
                                        ) : (
                                          <button type="button" onClick={() => setGameRepresentative(group.key, version.id)} className="rounded border border-line px-2 py-0.5 text-[11px] font-medium hover:bg-blue-50">대표로</button>
                                        )}
                                        <button type="button" onClick={() => void launchLibraryEntry(version)} disabled={launchingEntryId === version.id} className="inline-flex items-center gap-1 rounded border border-line px-2 py-0.5 text-[11px] hover:bg-blue-50 disabled:opacity-50"><Play className="h-3 w-3" />실행</button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                          </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <PaginationControls
                    currentPage={page}
                    totalItems={gameGroups.length}
                    pageSize={pageSize}
                    onPageChange={setPage}
                    itemLabel="개 게임"
                    className="mt-4 rounded-md border border-line bg-neutral-50 px-3 py-2"
                  />
                </>
              )}
            </div>
          </div>
          {(zaparooLibrary.hiddenPlatformKeys?.length ?? 0) > 0 && (
            <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="font-medium text-amber-950">숨긴 플랫폼</p>
              <p className="mt-1 text-xs text-amber-800">숨긴 platform은 기본 목록과 검색 결과에서 제외됩니다. 아래에서 다시 표시할 수 있습니다.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(zaparooLibrary.hiddenPlatformKeys ?? []).map((key) => (
                  <button key={key} type="button" onClick={() => showPlatform(key)} className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100">
                    {key} 다시 표시
                  </button>
                ))}
              </div>
            </div>
          )}
          {(zaparooLibrary.backups?.length ?? 0) > 0 && (
            <div className="mt-6 rounded-md border border-line bg-neutral-50 p-3 text-sm">
              <p className="font-medium">미스터 게임 리스트 백업</p>
              <div className="mt-2 space-y-2">
                {(zaparooLibrary.backups ?? []).map((backup) => (
                  <div key={backup.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-white px-3 py-2">
                    <div>
                      <p className="font-medium">{new Date(backup.createdAt).toLocaleString()}</p>
                      <p className="text-xs text-neutral-500">항목 {backup.entryCount}개 · profile {backup.profileCount}개 · {backup.reason}</p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => restoreLibraryBackup(backup.id)} className="rounded-md border border-blue-200 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50">
                        복원
                      </button>
                      <button type="button" onClick={() => deleteLibraryBackup(backup.id)} className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50">
                        삭제
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {developerMode && (
            <div className="mt-6 rounded-md border border-red-100 bg-red-50 p-3 text-sm">
              <p className="font-medium text-red-900">라이브러리 관리</p>
              <p className="mt-1 text-xs text-red-700">초기화는 병합된 미스터 게임 리스트 항목을 비웁니다. 저장된 카드 자체는 기본적으로 유지됩니다.</p>
              <button type="button" onClick={resetZaparooLibrary} className="mt-3 rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100">
                미스터 게임 리스트 초기화
              </button>
            </div>
          )}

        </section>
      )}

      {activeSection === 'tag' && (
        <section className="rounded-lg border border-line bg-white p-5 shadow-surface">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Tags className="h-5 w-5" />
              <h2 className="text-lg font-semibold">NFC 쓰기 / 읽기</h2>
            </div>
            <button
              type="button"
              onClick={() => {
                setTagGamePickerOpen((open) => !open);
                if (!tagPickerPlatform && tagPlatformBuckets[0]) setTagPickerPlatform(tagPlatformBuckets[0].key);
              }}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              게임 선택
            </button>
          </div>

          <div className="mb-4 rounded-md border border-blue-100 bg-blue-50/60 p-3 text-sm">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-blue-950">연결된 미스터 ({connectedDevices.length}대) · 읽기/쓰기 대상 선택</p>
              <button type="button" disabled={nfcStatusBusy || connectedDevices.length === 0} onClick={() => void refreshConnectedZaparooStatuses()} className="rounded-md border border-blue-200 bg-white px-2 py-1 text-xs font-medium text-blue-900 hover:bg-blue-100 disabled:opacity-50">
                {nfcStatusBusy ? '확인 중...' : 'Zaparoo·리더 상태 새로고침'}
              </button>
            </div>
            {connectedDevices.length === 0 ? (
              <p className="text-xs text-neutral-600">연결된 미스터가 없습니다. MiSTer 연결 메뉴에서 연결하세요.</p>
            ) : (
              <div className="space-y-1">
                {connectedDevices.map((device) => {
                  const status = nfcDeviceStatuses[device.deviceId];
                  const selected = device.deviceId === (selectedTargetDeviceId || connectedDevices[0]?.deviceId);
                  return (
                    <label key={device.deviceId} className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 ${selected ? 'border-blue-400 bg-white' : 'border-line bg-white/60'}`}>
                      <input type="radio" name="nfc-target-device" checked={selected} onChange={() => setSelectedTargetDeviceId(device.deviceId)} />
                      <span className="font-medium">{misterDisplayName(device)}</span>
                      <span className="text-xs text-neutral-500">{device.ipAddress}</span>
                      <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${status?.ok ? 'bg-green-50 text-green-700' : 'bg-amber-100 text-amber-800'}`}>
                        Zaparoo {status ? (status.ok ? '연결됨' : '확인 필요') : '미확인'}
                      </span>
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">리더 {status?.readers?.length ?? 0}개</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mb-4 rounded-md border border-cyan-100 bg-cyan-50 p-3 text-sm text-cyan-950">
            <p className="font-semibold">MiSTer USB NFC 리더 사용 순서</p>
            <p className="mt-1">
              1. MiSTer FPGA USB 포트에 NFC 리더를 연결합니다. 2. 게임 또는 launch text를 선택합니다. 3. 쓰기/읽기/검증 버튼을 눌러 대기 상태로 만듭니다. 4. NTAG215 태그를 리더 위에 올립니다. 5. 읽기/검증이 timeout되면 태그를 한 번 떼었다가 버튼을 누른 뒤 다시 올립니다.
            </p>
            <p className="mt-2 text-xs">
              NFC Core API를 우선 사용합니다. CLI fallback: {mister.connection.zaparooCommandStatus === 'found' ? mister.connection.zaparooCommand : mister.connection.zaparooCommandStatus === 'missing' ? '찾지 못함' : 'MiSTer 연결 후 확인'}
            </p>
          </div>

          {tagGamePickerOpen && (
            <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50/50 p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-blue-950">NFC 대상 선택</p>
                  <p className="text-xs text-blue-800">라이브러리 게임 또는 저장된 카드에서 launch text를 만들 수 있습니다.</p>
                </div>
                <button type="button" onClick={() => setTagGamePickerOpen(false)} className="rounded-md border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-800">
                  닫기
                </button>
              </div>
              <div className="mb-3 inline-flex overflow-hidden rounded-md border border-blue-200 bg-white text-sm">
                <button type="button" onClick={() => setTagSelectionMode('library')} className={`px-3 py-2 font-medium ${tagSelectionMode === 'library' ? 'bg-primary text-white' : 'hover:bg-blue-50'}`}>
                  라이브러리에서 선택
                </button>
                <button type="button" onClick={() => setTagSelectionMode('card')} className={`px-3 py-2 font-medium ${tagSelectionMode === 'card' ? 'bg-primary text-white' : 'hover:bg-blue-50'}`}>
                  카드에서 선택
                </button>
              </div>
              {tagSelectionMode === 'card' ? (
                <div className="rounded-md border border-blue-100 bg-white p-3">
                  <label className="block text-sm">
                    <span className="font-medium">카드 전체 검색</span>
                    <input
                      value={tagCardQuery}
                      onChange={(event) => setTagCardQuery(event.target.value)}
                      placeholder="카드 제목, system, path 검색"
                      className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
                    />
                  </label>
                  <div className="mt-3 max-h-80 overflow-auto divide-y divide-line rounded-md border border-line">
                    {tagCardEntries.length === 0 ? (
                      <p className="p-4 text-sm text-neutral-500">선택할 수 있는 저장 카드가 없습니다.</p>
                    ) : (
                      tagCardEntries.map((record) => (
                        <button key={record.id} type="button" onClick={() => selectTagCard(record)} className="block w-full px-3 py-2 text-left text-sm hover:bg-blue-50">
                          <span className="font-medium text-neutral-950">{record.title}</span>
                          <span className="mt-0.5 block truncate text-xs text-neutral-500">
                            {record.mister ? `${record.mister.misterSystemId} · ${record.mister.misterRelativePath}` : '라이브러리 미연결 카드'}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : tagPlatformBuckets.length === 0 ? (
                <p className="rounded-md border border-dashed border-blue-200 bg-white p-4 text-sm text-neutral-600">선택할 수 있는 playable 게임이 없습니다. 먼저 MiSTer Library를 스캔하거나 숨김 설정을 확인하세요.</p>
              ) : (
                <div className="grid gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
                  <div className="max-h-80 overflow-auto rounded-md border border-blue-100 bg-white p-2">
                    {tagPlatformBuckets.map((bucket) => (
                      <button
                        key={bucket.key}
                        type="button"
                        onClick={() => setTagPickerPlatform(bucket.key)}
                        className={`mb-1 flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm ${tagPickerPlatform === bucket.key ? 'bg-primary text-white' : 'hover:bg-blue-50'}`}
                      >
                        <span className="truncate">{bucket.label}</span>
                        <span className="ml-2 rounded-full bg-white/80 px-2 py-0.5 text-xs text-neutral-700">{bucket.count}</span>
                      </button>
                    ))}
                  </div>
                  <div className="rounded-md border border-blue-100 bg-white p-3">
                    <label className="block text-sm">
                      <span className="font-medium">게임 검색</span>
                      <input
                        value={tagPickerQuery}
                        onChange={(event) => setTagPickerQuery(event.target.value)}
                        placeholder="제목, ROM 이름, 경로 검색"
                        className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
                      />
                    </label>
                    <div className="mt-3 max-h-80 overflow-auto divide-y divide-line rounded-md border border-line">
                      {tagPickerEntries.length === 0 ? (
                        <p className="p-4 text-sm text-neutral-500">검색 결과가 없습니다.</p>
                      ) : (
                        tagPickerEntries.map((entry) => (
                          <button key={entry.id} type="button" onClick={() => selectTagGame(entry)} className="block w-full px-3 py-2 text-left text-sm hover:bg-blue-50">
                            <span className="font-medium text-neutral-950">{entry.title}</span>
                            <span className="mt-0.5 block truncate text-xs text-neutral-500">{entry.systemId} · {entry.relativePath || entry.absolutePath}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {!focusedEntry ? (
            <p className="text-sm text-neutral-600">먼저 MiSTer Library를 동기화하고 미스터 게임 리스트에서 게임을 선택하세요.</p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-md border border-line p-3 text-sm">
                <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2">
                  <p className="text-xs font-semibold text-blue-800">선택된 게임</p>
                  <p className="font-medium text-neutral-950">{focusedEntry.title}</p>
                  <p className="mt-1 truncate text-xs text-neutral-600">{focusedEntry.absolutePath}</p>
                </div>
                <label className="mt-3 block">
                  <span className="font-medium">Launch 형식</span>
                  <select value={launchMode} onChange={(event) => changeLaunchMode(event.target.value as MiSTerLaunchMode)} className="mt-1 w-full rounded-md border border-line px-2 py-2">
                    <option value="absolute-path">MiSTer 절대 경로: **launch:/media/fat/...</option>
                    <option value="relative-path">고급: relative path mode</option>
                  </select>
                </label>
                <label className="mt-3 block">
                  <span className="font-medium">수동 launch text / path</span>
                  <textarea
                    value={manualLaunchText || launchPreview?.text || ''}
                    onChange={(event) => {
                      setManualLaunchText(event.target.value);
                      setTagStatus('idle');
                    }}
                    rows={4}
                    className="mt-1 w-full rounded-md border border-line px-2 py-2 font-mono text-xs"
                    placeholder={launchPreview?.text}
                  />
                </label>
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  직접 쓰기/읽기는 PC 리더가 아니라 MiSTer FPGA USB에 연결된 NFC 리더를 대상으로 합니다. 읽기/검증은 NFC Core API의 tokens 상태에서 다음 스캔 이벤트를 기다리므로, 태그를 뗀 상태에서 버튼을 누른 뒤 다시 올려 주세요.
                </div>
                {connectedDevices.length > 1 && (
                  <div className="mt-3 rounded-md border border-line p-3">
                    <p className="text-xs font-medium text-neutral-700">NFC 대상 미스터 (연결됨 {connectedDevices.length}대) — 리더가 있는 미스터를 고르세요</p>
                    <div className="mt-2 space-y-1.5">
                      {connectedDevices.map((device) => {
                        const status = nfcDeviceStatuses[device.deviceId];
                        const readerCount = status?.readers?.length ?? 0;
                        const selected = nfcSelected?.deviceId === device.deviceId;
                        return (
                          <button
                            key={device.deviceId}
                            type="button"
                            onClick={() => setSelectedTargetDeviceId(device.deviceId)}
                            className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm ${selected ? 'border-emerald-400 bg-emerald-50' : 'border-line hover:bg-neutral-50'}`}
                          >
                            <span className="font-medium text-neutral-900">{selected ? '● ' : ''}{misterDisplayName(device)}</span>
                            <span className="text-xs text-neutral-500">
                              {device.ipAddress} · {status ? (readerCount > 0 ? `리더 ${readerCount}개` : '리더 없음') : '상태 미확인'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    title="버튼을 누른 뒤 Zaparoo readers.write로 준비된 launch text를 NFC 태그에 기록합니다."
                    onClick={() => void writeNfcTag()}
                    disabled={!nfcWriteReadiness.canWrite}
                    className={
                      nfcWriteReadiness.canWrite
                        ? 'rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white'
                        : 'cursor-not-allowed rounded-md bg-neutral-300 px-3 py-2 text-sm font-medium text-neutral-600'
                    }
                  >
                    태그에 쓰기
                  </button>
                  <button
                    type="button"
                    title="버튼을 누른 뒤 태그를 리더에서 뗐다가 다시 올려 tokens.added 이벤트를 기다립니다."
                    onClick={() => void readNfcTag()}
                    disabled={nfcReadBusy || !nfcReadReadiness.canRead}
                    className={nfcReadBusy || !nfcReadReadiness.canRead ? 'cursor-not-allowed rounded-md border border-line bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-500' : 'rounded-md border border-line px-3 py-2 text-sm font-medium'}
                  >
                    태그 읽기
                  </button>
                  {nfcReadBusy && (
                    <button type="button" onClick={() => void cancelNfcRead()} className="rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700">
                      읽기 취소
                    </button>
                  )}
                </div>
                <div className="mt-3 grid gap-1 text-xs text-neutral-600">
                  <p><span className="font-medium">선택 게임:</span> 게임이 선택되면 NFC에 쓸 실행 텍스트를 자동으로 준비합니다.</p>
                  <p><span className="font-medium">태그에 쓰기:</span> 버튼을 누른 뒤 NTAG215 태그를 MiSTer USB 리더 위에 올립니다.</p>
                  <p><span className="font-medium">태그 읽기:</span> 버튼을 누른 뒤 태그를 리더 위에 다시 올려 새 스캔 이벤트를 만듭니다.</p>
                </div>
              </div>
              <div className="rounded-md border border-line p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">NFC 리더 상태</p>
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${tagStatus === 'error' ? 'bg-red-50 text-red-700' : tagStatus === 'verified' || tagStatus === 'written' ? 'bg-green-50 text-green-700' : 'bg-neutral-100 text-neutral-700'}`}>
                    {tagStatusLabels[tagStatus] ?? formatZaparooNfcReadStatus(tagStatus)}
                  </span>
                </div>
                <div className="mt-2 grid gap-1 rounded bg-neutral-50 p-3 text-xs">
                  <p><span className="font-semibold">MiSTer:</span> {nfcSelected ? misterDisplayName(nfcSelected) : '없음'}</p>
                  <p><span className="font-semibold">Zaparoo API:</span> {nfcSelectedStatus?.ok ? '연결됨' : '연결 안 됨'}</p>
                  <p><span className="font-semibold">NFC 리더:</span> {nfcSelectedStatus?.ok ? `${nfcSelectedStatus.readers?.length ?? 0}개 연결됨` : '확인할 수 없음'}</p>
                  <p><span className="font-semibold">쓰기:</span> {nfcWriteReadiness.canWrite ? '가능' : nfcWriteReadiness.message}</p>
                  <p><span className="font-semibold">읽기:</span> {nfcReadReadiness.canRead ? '가능' : nfcReadReadiness.message}</p>
                </div>
                {tagStatus === 'written' && (
                  <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-4 text-emerald-900 shadow-sm">
                    <p className="text-lg font-bold">NFC 쓰기 완료</p>
                    <p className="mt-1 text-sm">태그에 실행 데이터가 기록되었습니다.</p>
                    <p className="mt-2 text-xs text-emerald-800">
                      검증하려면 태그를 리더에서 떼었다가 다시 올린 뒤 태그 읽기를 누르세요.
                    </p>
                  </div>
                )}
                {tagMessage && tagStatus !== 'written' && <p className="mt-2 rounded bg-neutral-50 px-2 py-1 text-xs text-neutral-700">{tagMessage}</p>}
                {readTagText && (
                  <div className="mt-3">
                    <p className="font-medium">읽은 태그 값</p>
                    <pre className="mt-1 whitespace-pre-wrap rounded bg-neutral-50 p-3 text-xs">{readTagText}</pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {launchPicker && (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/40 p-4" onClick={() => setLaunchPicker(null)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <p className="text-sm font-semibold text-neutral-900">어느 미스터에서 실행할까요?</p>
            <p className="mt-1 truncate text-xs text-neutral-500">{launchPicker.entry.title}</p>
            <div className="mt-3 space-y-2">
              {launchPicker.candidates.map((candidate) => (
                <button
                  key={candidate.device.deviceId}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-left text-sm hover:bg-blue-50"
                  onClick={() => {
                    const { entry } = launchPicker;
                    setLaunchPicker(null);
                    void runLaunchOnTarget(entry, launchTargetFromDevice(candidate));
                  }}
                >
                  <span className="font-medium text-neutral-900">{misterDisplayName(candidate.device)}</span>
                  <span className="text-xs text-neutral-500">{candidate.device.ipAddress}</span>
                </button>
              ))}
            </div>
            <button type="button" className="mt-3 w-full rounded-md border border-line px-3 py-2 text-sm hover:bg-neutral-50" onClick={() => setLaunchPicker(null)}>취소</button>
          </div>
        </div>
      )}

      {deleteProfileTarget && (() => {
        const profile = zaparooLibrary.profiles.find((candidate) => candidate.deviceId === deleteProfileTarget);
        const onlyCount = zaparooLibrary.entries.filter((entry) => entry.sourceDevices.length === 1 && entry.sourceDevices[0] === deleteProfileTarget).length;
        return (
          <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/40 p-4" onClick={() => setDeleteProfileTarget(null)}>
            <div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
              <p className="text-sm font-semibold text-neutral-900">이 미스터 라이브러리를 삭제할까요?</p>
              <p className="mt-2 text-sm text-neutral-800">{profile ? misterDisplayName(profile) : '선택한 미스터'}</p>
              <p className="mt-2 text-xs text-neutral-500">이 미스터에만 있는 게임 {onlyCount}개가 목록에서 제거됩니다. 다른 미스터에도 있는 게임과 저장된 카드는 유지됩니다.</p>
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={confirmDeleteProfile} className="flex-1 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700">삭제</button>
                <button type="button" onClick={() => setDeleteProfileTarget(null)} className="flex-1 rounded-md border border-line px-3 py-2 text-sm hover:bg-neutral-50">취소</button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
