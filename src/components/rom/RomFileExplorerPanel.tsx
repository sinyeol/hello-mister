import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from 'react';
import { Link } from 'react-router-dom';
import { SectionCard } from '../cards/SectionCard';
import { useActiveMisterProfile } from '../../services/mister/activeProfile';
import { misterDisplayName } from '../../services/mister/misterName';
import { SafeMisterProfileStore } from '../../services/mister/profileStore';
import type { MisterDeviceProfile } from '../../types/mister';
import {
  ROM_FS_QUICK_PATHS,
  checkRomFsCapability,
  copyLocalToMister,
  copyMisterToLocal,
  copyMisterToMister,
  createLocalRomFolder,
  createRemoteRomFolder,
  deleteRemoteRom,
  formatRomFsBytes,
  formatRomFsCapability,
  formatRomFsExtension,
  formatRomFsStatus,
  listLocalRomFolder,
  listLocalRomTreeFolder,
  listLocalRomTreeRoots,
  listRemoteRomFolder,
  moveRemoteRom,
  renameRemoteRom,
  restoreRemoteRom,
  selectRomFsRange,
  shouldShowRomFsEntry,
  summarizeRomFsSelection,
  trashRemoteRom,
} from '../../services/rom/romFileManagerService';
import type { RomFsCapabilityResult, RomFsConflictPolicy, RomFsEntry, RomFsLocalTreeEntry, RomFsOperationResult } from '../../types/rom';
import { useRomTransfer, type RomTransferBatchOutcome } from '../../contexts/RomTransferContext';

const defaultRemotePath = '/media/fat';
const romTargetProfileKey = 'hello-mister-v2:rom-target-profile';
const dragDataType = 'application/x-hello-mister-rom';

interface RomDeviceStatus {
  reachable: boolean;
  connected: boolean;
}

const romFsTrashRoot = `${defaultRemotePath}/.hello-mister-trash`;

// Trash paths encode the original location: {mediaFat}/.hello-mister-trash/{stamp}/{originalRelativePath}.
// Strip the trash root and the timestamp segment to recover where a trashed item should be restored.
function originalPathFromTrash(trashPath: string): string | undefined {
  if (!trashPath.startsWith(`${romFsTrashRoot}/`)) return undefined;
  const rest = trashPath.slice(romFsTrashRoot.length + 1);
  const slash = rest.indexOf('/');
  if (slash < 0) return undefined;
  const relative = rest.slice(slash + 1);
  if (!relative) return undefined;
  return `${defaultRemotePath}/${relative}`;
}
const romExtensionOptions = ['all', 'zip', '7z', 'nes', 'sfc', 'smc', 'md', 'gen', 'smd', 'sms', 'gg', 'gb', 'gbc', 'gba', 'pce', 'cue', 'bin', 'chd', 'iso', 'vhd', 'neo', 'mra', 'rom'];

type ExplorerScope = 'local' | 'remote';

interface DragPayload {
  scope: ExplorerScope;
  ids: string[];
}

interface ContextMenuState {
  x: number;
  y: number;
  scope: ExplorerScope | 'blank';
  entry?: RomFsEntry;
}

export function RomFileExplorerPanel() {
  const [defaultActive] = useActiveMisterProfile();
  const profileStore = useMemo(() => new SafeMisterProfileStore(), []);
  const [savedProfiles, setSavedProfiles] = useState<MisterDeviceProfile[]>([]);
  const [selectedTargetProfileId, setSelectedTargetProfileId] = useState<string | undefined>(() => {
    try { return window.localStorage.getItem(romTargetProfileKey) ?? undefined; } catch { return undefined; }
  });
  const [deviceStatus, setDeviceStatus] = useState<Record<string, RomDeviceStatus>>({});
  const [remotePath, setRemotePath] = useState(defaultRemotePath);
  const [remoteEntries, setRemoteEntries] = useState<RomFsEntry[]>([]);
  const [selectedRemoteIds, setSelectedRemoteIds] = useState<string[]>([]);
  const [remoteSelectionAnchor, setRemoteSelectionAnchor] = useState<string | undefined>();
  const [localFolder, setLocalFolder] = useState<string | undefined>();
  const [localEntries, setLocalEntries] = useState<RomFsEntry[]>([]);
  const [selectedLocalIds, setSelectedLocalIds] = useState<string[]>([]);
  const [localSelectionAnchor, setLocalSelectionAnchor] = useState<string | undefined>();
  const [localTreeRoots, setLocalTreeRoots] = useState<RomFsLocalTreeEntry[]>([]);
  const [localTreeChildren, setLocalTreeChildren] = useState<Record<string, RomFsLocalTreeEntry[]>>({});
  const [expandedLocalTreePaths, setExpandedLocalTreePaths] = useState<string[]>([]);
  const [localTreeLoading, setLocalTreeLoading] = useState<Record<string, boolean>>({});
  const [selectedLocalTreePath, setSelectedLocalTreePath] = useState<string | undefined>();
  const [remoteTreeChildren, setRemoteTreeChildren] = useState<Record<string, RomFsEntry[]>>({});
  const [expandedRemoteTreePaths, setExpandedRemoteTreePaths] = useState<string[]>([]);
  const [remoteTreeLoading, setRemoteTreeLoading] = useState<Record<string, boolean>>({});
  const [selectedRemoteTreePath, setSelectedRemoteTreePath] = useState(defaultRemotePath);
  const [search, setSearch] = useState('');
  const [localExtensionFilter, setLocalExtensionFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [capabilityBusy, setCapabilityBusy] = useState(false);
  const [capability, setCapability] = useState<RomFsCapabilityResult | undefined>();
  const [message, setMessage] = useState('PC와 MiSTer 파일을 좌우에서 관리합니다.');
  const [operationLog, setOperationLog] = useState<RomFsOperationResult[]>([]);
  const [selectedRoot, setSelectedRoot] = useState(defaultRemotePath);
  const [sendTargetFolder, setSendTargetFolder] = useState(defaultRemotePath);
  const [sendConflictPolicy, setSendConflictPolicy] = useState<RomFsConflictPolicy>('skip');
  const [showSendModal, setShowSendModal] = useState(false);
  const [showMisterToMisterModal, setShowMisterToMisterModal] = useState(false);
  const [showOperations, setShowOperations] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | undefined>();
  const [dropTarget, setDropTarget] = useState<ExplorerScope | undefined>();
  const [rowDropTargetId, setRowDropTargetId] = useState<string | undefined>();
  const [hoveredPane, setHoveredPane] = useState<ExplorerScope | undefined>();
  const [localHistory, setLocalHistory] = useState<string[]>([]);
  const [remoteHistory, setRemoteHistory] = useState<string[]>([]);
  const currentDragPayloadRef = useRef<DragPayload | undefined>();
  const [clipboard, setClipboard] = useState<{ scope: ExplorerScope; ids: string[]; mode: 'copy' | 'cut' } | undefined>();
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  // App-level transfer manager: long copies run here so they survive menu navigation and stay cancellable. Quick
  // single ops (rename/trash/move/restore/new folder) keep using the inline runOperationBatch below.
  const transfer = useRomTransfer();
  const lastFinishedJobRef = useRef(0);

  // Load saved MiSTer profiles so the user can switch which MiSTer file operations target. The ROM backend
  // connects on demand by profileId, so any saved profile is a valid target (no pre-established session needed).
  useEffect(() => {
    void profileStore.loadProfiles().then(setSavedProfiles).catch(() => undefined);
  }, [profileStore, defaultActive?.profileId]);

  // Live connected/reachable status per saved profile (reuses the TCP probe + active SSH session list).
  useEffect(() => {
    const api = window.helloMisterDesktop;
    if (!api?.probeMisterReachable || savedProfiles.length === 0) {
      setDeviceStatus({});
      return;
    }
    let cancelled = false;
    const check = async () => {
      let sessions: Awaited<ReturnType<NonNullable<typeof api.listSshSessions>>> = [];
      try { sessions = (await api.listSshSessions?.()) ?? []; } catch { sessions = []; }
      const results = await Promise.all(savedProfiles.map(async (profile) => {
        const probe = await api.probeMisterReachable!(profile.ipAddress, profile.port || 22, 2500).catch(() => ({ open: false }));
        const reachable = Boolean(probe?.open);
        const hasSession = sessions.some((session) =>
          session.sessionId === profile.id
          || (session.host === profile.ipAddress && Number(session.port) === Number(profile.port || 22)));
        // "연결됨"은 세션이 있으면서 지금 실제로 응답할 때만. 전원이 꺼진 stale 풀 세션을 연결됨으로 보지 않는다.
        return [profile.id, { reachable, connected: reachable && hasSession }] as const;
      }));
      if (!cancelled) setDeviceStatus(Object.fromEntries(results));
    };
    void check();
    const interval = window.setInterval(() => void check(), 10000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [savedProfiles]);

  // The effective file-operation target: the user's explicit selection, else the active profile, else the first
  // saved one. Rebound as `activeMister` so every existing remote operation routes to the selected target.
  const targetProfile = useMemo(
    () => savedProfiles.find((profile) => profile.id === selectedTargetProfileId)
      ?? savedProfiles.find((profile) => profile.id === defaultActive?.profileId)
      ?? savedProfiles[0],
    [savedProfiles, selectedTargetProfileId, defaultActive?.profileId],
  );
  const activeMister = useMemo(() => {
    if (targetProfile) {
      return {
        profileId: targetProfile.id,
        alias: targetProfile.alias,
        hostname: targetProfile.hostname,
        ipAddress: targetProfile.ipAddress,
        port: Number(targetProfile.port || 22),
        username: targetProfile.username || 'root',
      };
    }
    if (defaultActive) {
      return {
        profileId: defaultActive.profileId,
        alias: defaultActive.alias,
        hostname: defaultActive.hostname,
        ipAddress: defaultActive.ipAddress,
        port: defaultActive.port,
        username: defaultActive.username,
      };
    }
    return undefined;
  }, [targetProfile, defaultActive]);

  const selectTargetProfile = useCallback((profileId: string) => {
    setSelectedTargetProfileId(profileId);
    try { window.localStorage.setItem(romTargetProfileKey, profileId); } catch { /* ignore */ }
    // Switching MiSTer: reset navigation so we don't show a path that may not exist on the new device.
    setRemotePath(defaultRemotePath);
    setSelectedRoot(defaultRemotePath);
    setSelectedRemoteTreePath(defaultRemotePath);
    setSelectedRemoteIds([]);
    setRemoteEntries([]);
  }, []);

  const romDeviceStatusLabel = useCallback((profile: MisterDeviceProfile) => {
    const status = deviceStatus[profile.id];
    if (status?.connected) return '● 연결됨';
    if (status?.reachable) return '○ 켜짐';
    return '· 오프라인';
  }, [deviceStatus]);

  const canReadRemote = Boolean(activeMister && (capability?.canRead ?? true));
  const canWriteRemote = Boolean(activeMister);
  const activeMisterLabel = useMemo(() => misterDisplayName(activeMister), [activeMister]);
  const isTrashView = remotePath.split('/').includes('.hello-mister-trash');
  // 실제 연결 상태(도달성+세션)로 요약한다. 대상이 선택돼 있다고 무조건 "연결됨"으로 표기하지 않는다.
  const connectionSummary = useMemo(() => {
    if (!activeMister) return 'MiSTer 연결 필요';
    const status = deviceStatus[activeMister.profileId];
    const state = status?.connected ? '연결됨' : status?.reachable ? '켜짐 · 연결 안 됨' : '오프라인';
    return `${misterDisplayName(activeMister)} · ${state}`;
  }, [activeMister, deviceStatus]);

  const filteredRemoteEntries = useMemo(
    () => filterEntries(remoteEntries, search).filter((entry) => shouldShowRomFsEntry(entry, { isTrashView })),
    [isTrashView, remoteEntries, search],
  );
  const filteredLocalEntries = useMemo(() => filterEntries(localEntries, search, localExtensionFilter), [localEntries, localExtensionFilter, search]);
  const remoteFolders = useMemo(
    () => remoteEntries.filter((entry) => entry.type === 'directory' && shouldShowRomFsEntry(entry, { isTrashView })),
    [isTrashView, remoteEntries],
  );
  const selectedRemoteEntries = useMemo(() => remoteEntries.filter((entry) => selectedRemoteIds.includes(entry.id)), [remoteEntries, selectedRemoteIds]);
  const selectedLocalEntries = useMemo(() => localEntries.filter((entry) => selectedLocalIds.includes(entry.id)), [localEntries, selectedLocalIds]);
  const selectedRemoteSummary = summarizeRomFsSelection(selectedRemoteEntries);
  const selectedLocalSummary = summarizeRomFsSelection(selectedLocalEntries);
  const selectedCount = selectedRemoteSummary.count + selectedLocalSummary.count;
  const selectedBytes = selectedRemoteSummary.totalBytes + selectedLocalSummary.totalBytes;
  const primarySelectedRemote = selectedRemoteEntries[0];
  const remoteTreeRoots = useMemo<RomFsEntry[]>(() => [{
    id: 'remote-tree:/',
    name: '/',
    path: '/',
    parentPath: '',
    location: 'mister',
    type: 'directory',
    sizeBytes: 0,
  }], []);

  const refreshCapability = useCallback(async () => {
    if (!activeMister?.profileId) {
      setCapability(undefined);
      return;
    }
    setCapabilityBusy(true);
    const result = await checkRomFsCapability({ profileId: activeMister.profileId, root: selectedRoot });
    setCapability(result);
    setCapabilityBusy(false);
    setMessage(result.message);
  }, [activeMister?.profileId, selectedRoot]);

  const refreshRemote = useCallback(async (nextPath = remotePath) => {
    if (!activeMister?.profileId) {
      setMessage('MiSTer 연결이 필요합니다. 먼저 MiSTer 연결 메뉴에서 연결하세요.');
      return;
    }
    setBusy(true);
    const result = await listRemoteRomFolder(activeMister.profileId, nextPath);
    setBusy(false);
    setMessage(result.message);
    if (result.ok) {
      setRemotePath(result.path || nextPath);
      setSelectedRemoteTreePath(result.path || nextPath);
      setRemoteEntries(result.entries);
      setSelectedRemoteIds([]);
      setRemoteSelectionAnchor(undefined);
    }
  }, [activeMister?.profileId, remotePath]);

  const loadLocalTreeRoots = useCallback(async () => {
    const result = await listLocalRomTreeRoots();
    setMessage(result.message);
    if (result.ok) {
      setLocalTreeRoots(result.roots);
      setLocalTreeChildren({});
      setExpandedLocalTreePaths([]);
    }
  }, []);

  useEffect(() => {
    if (!activeMister?.profileId) return;
    void refreshCapability();
    void refreshRemote(remotePath);
  }, [activeMister?.profileId, refreshCapability, refreshRemote, remotePath]);

  useEffect(() => {
    void loadLocalTreeRoots();
  }, [loadLocalTreeRoots]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => setContextMenu(undefined);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [contextMenu]);

  const loadLocalFolder = useCallback(async (folderPath: string, options: { recordHistory?: boolean } = {}) => {
    const result = await listLocalRomFolder(folderPath);
    setMessage(result.message);
    if (result.ok && result.folderPath) {
      if (options.recordHistory !== false && localFolder && localFolder !== result.folderPath) {
        setLocalHistory((items) => [...items.slice(-24), localFolder]);
      }
      setLocalFolder(result.folderPath);
      setSelectedLocalTreePath(result.folderPath);
      setLocalEntries(result.entries);
      setSelectedLocalIds([]);
      setLocalSelectionAnchor(undefined);
    }
  }, [localFolder]);

  // File-manager keyboard shortcuts, scoped to whichever pane the mouse is over. Kept in a ref so the single window
  // listener always reads current state without re-subscribing every render (no stale closures).
  useEffect(() => {
    keyHandlerRef.current = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const pane = hoveredPane;
      if (!pane) return;
      const ctrl = event.ctrlKey || event.metaKey;

      if (event.key === 'Backspace' || (event.altKey && event.key === 'ArrowLeft')) {
        if (pane === 'local' && localHistory.length > 0) { event.preventDefault(); goLocalPrevious(); }
        else if (pane === 'remote' && remoteHistory.length > 0) { event.preventDefault(); goRemotePrevious(); }
        return;
      }
      if (ctrl && (event.key === 'a' || event.key === 'A')) {
        if (hasActiveTextSelection()) return; // let the browser select on-screen text instead
        event.preventDefault();
        if (pane === 'local') setDragSelection('local', filteredLocalEntries.map((entry) => entry.id));
        else setDragSelection('remote', filteredRemoteEntries.map((entry) => entry.id));
        return;
      }
      if (ctrl && (event.key === 'c' || event.key === 'C' || event.key === 'x' || event.key === 'X')) {
        if (hasActiveTextSelection()) return; // let the browser copy selected text instead
        const mode: 'copy' | 'cut' = event.key === 'x' || event.key === 'X' ? 'cut' : 'copy';
        if (pane === 'local' && selectedLocalEntries.length > 0) {
          event.preventDefault();
          setClipboard({ scope: 'local', ids: selectedLocalIds, mode });
          setMessage(mode === 'cut'
            ? `PC 항목 ${selectedLocalEntries.length}개 — MiSTer 쪽에서 Ctrl+V (복사만, PC 원본 유지).`
            : `PC 항목 ${selectedLocalEntries.length}개를 복사했습니다 — MiSTer 쪽에서 Ctrl+V.`);
        } else if (pane === 'remote' && selectedRemoteEntries.length > 0) {
          event.preventDefault();
          setClipboard({ scope: 'remote', ids: selectedRemoteIds, mode });
          setMessage(`MiSTer 항목 ${selectedRemoteEntries.length}개를 ${mode === 'cut' ? '잘라냈' : '복사했'}습니다 — PC 쪽에서 Ctrl+V.`);
        }
        return;
      }
      if (ctrl && (event.key === 'v' || event.key === 'V')) {
        if (clipboard) { event.preventDefault(); void pasteClipboard(); }
        return;
      }
      if (event.key === 'Delete') {
        if (pane !== 'remote') return;
        event.preventDefault();
        if (event.shiftKey && isTrashView) void deleteSelectedRemotePermanently();
        else void trashSelectedRemote();
        return;
      }
      if (event.key === 'F2') {
        if (pane === 'remote') { event.preventDefault(); void renameSelectedRemote(); }
        return;
      }
      if (event.key === 'Enter') {
        if (isInteractiveActiveElement()) return; // let a focused button/link activate instead
        if (pane === 'local' && selectedLocalEntries.length === 1 && selectedLocalEntries[0].type === 'directory') { event.preventDefault(); openLocalEntry(selectedLocalEntries[0]); }
        else if (pane === 'remote' && selectedRemoteEntries.length === 1 && selectedRemoteEntries[0].type === 'directory') { event.preventDefault(); openRemoteEntry(selectedRemoteEntries[0]); }
      }
    };
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandlerRef.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  async function toggleLocalTreeNode(node: RomFsLocalTreeEntry) {
    if (expandedLocalTreePaths.includes(node.path)) {
      setExpandedLocalTreePaths((items) => items.filter((item) => item !== node.path));
      return;
    }
    if (!localTreeChildren[node.path]) {
      setLocalTreeLoading((items) => ({ ...items, [node.path]: true }));
      const result = await listLocalRomTreeFolder(node.path, node.depth);
      setLocalTreeLoading((items) => ({ ...items, [node.path]: false }));
      setMessage(result.message);
      if (result.ok) setLocalTreeChildren((items) => ({ ...items, [node.path]: result.children }));
    }
    setExpandedLocalTreePaths((items) => (items.includes(node.path) ? items : [...items, node.path]));
  }

  async function openLocalTreeNode(node: RomFsLocalTreeEntry) {
    await loadLocalFolder(node.path);
    if (node.hasChildren && !expandedLocalTreePaths.includes(node.path)) await toggleLocalTreeNode(node);
  }

  async function toggleRemoteTreeNode(node: RomFsEntry) {
    if (expandedRemoteTreePaths.includes(node.path)) {
      setExpandedRemoteTreePaths((items) => items.filter((item) => item !== node.path));
      return;
    }
    if (!remoteTreeChildren[node.path]) {
      if (!activeMister?.profileId) {
        setMessage('MiSTer 연결이 필요합니다. 먼저 MiSTer 연결 메뉴에서 연결하세요.');
        return;
      }
      setRemoteTreeLoading((items) => ({ ...items, [node.path]: true }));
      const result = await listRemoteRomFolder(activeMister.profileId, node.path);
      setRemoteTreeLoading((items) => ({ ...items, [node.path]: false }));
      setMessage(result.message);
      if (result.ok) {
        const children = result.entries.filter((entry) => entry.type === 'directory' && entry.name !== '.hello-mister-rw-check');
        setRemoteTreeChildren((items) => ({ ...items, [node.path]: children }));
      }
    }
    setExpandedRemoteTreePaths((items) => (items.includes(node.path) ? items : [...items, node.path]));
  }

  async function openRemoteTreeNode(node: RomFsEntry) {
    openRemoteFolder(node.path);
    if (!expandedRemoteTreePaths.includes(node.path)) await toggleRemoteTreeNode(node);
  }

  function renderLocalTreeNodes(nodes: RomFsLocalTreeEntry[]) {
    return nodes.map((node) => {
      const expanded = expandedLocalTreePaths.includes(node.path);
      const children = localTreeChildren[node.path] || [];
      return (
        <div key={node.id}>
          <button
            type="button"
            className={`rom-local-tree-row ${selectedLocalTreePath === node.path ? 'selected' : ''} ${rowDropTargetId === `tree:${node.id}` ? 'drop-target' : ''}`}
            style={{ paddingLeft: 8 + node.depth * 14 }}
            title={node.path}
            onClick={() => void openLocalTreeNode(node)}
            onDragOver={(event) => handleLocalTreeDragOver(node, event)}
            onDragLeave={() => setRowDropTargetId(undefined)}
            onDrop={(event) => handleLocalTreeDrop(node, event)}
          >
            <span
              role="button"
              tabIndex={-1}
              className={`rom-local-tree-toggle ${node.hasChildren ? '' : 'empty'}`}
              onClick={(event) => {
                event.stopPropagation();
                if (node.hasChildren) void toggleLocalTreeNode(node);
              }}
            >
              {node.hasChildren ? (expanded ? '▾' : '▸') : '•'}
            </span>
            <span className="rom-local-tree-name">{node.name}</span>
            {localTreeLoading[node.path] && <span className="rom-local-tree-loading">...</span>}
          </button>
          {expanded && children.length > 0 && renderLocalTreeNodes(children)}
        </div>
      );
    });
  }

  function renderRemoteTreeNodes(nodes: RomFsEntry[], depth = 0) {
    return nodes.map((node) => {
      const expanded = expandedRemoteTreePaths.includes(node.path);
      const children = remoteTreeChildren[node.path] || [];
      const hasChildren = node.type === 'directory';
      return (
        <div key={node.id}>
          <button
            type="button"
            className={`rom-local-tree-row ${selectedRemoteTreePath === node.path ? 'selected' : ''} ${rowDropTargetId === `remote-tree:${node.id}` ? 'drop-target' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            title={node.path}
            onClick={() => void openRemoteTreeNode(node)}
            onDragOver={(event) => handleRemoteTreeDragOver(node, event)}
            onDragLeave={() => setRowDropTargetId(undefined)}
            onDrop={(event) => handleRemoteTreeDrop(node, event)}
          >
            <span
              role="button"
              tabIndex={-1}
              className={`rom-local-tree-toggle ${hasChildren ? '' : 'empty'}`}
              onClick={(event) => {
                event.stopPropagation();
                if (hasChildren) void toggleRemoteTreeNode(node);
              }}
            >
              {hasChildren ? (expanded ? '▾' : '▸') : '•'}
            </span>
            <span className="rom-local-tree-name">{node.name}</span>
            {remoteTreeLoading[node.path] && <span className="rom-local-tree-loading">...</span>}
          </button>
          {expanded && children.length > 0 && renderRemoteTreeNodes(children, depth + 1)}
        </div>
      );
    });
  }

  async function addLocalFiles() {
    const api = window.helloMisterDesktop;
    if (!api?.selectLocalRomFiles) {
      setMessage('브라우저 fallback에서는 PC 파일 선택 dialog가 제한됩니다. Electron 앱에서 실행하세요.');
      return;
    }
    const result = await api.selectLocalRomFiles();
    if (!result?.ok) {
      setMessage(result?.message || 'PC 파일 선택이 취소되었습니다.');
      return;
    }
    const entries = result.items.map((item) => ({
      id: `local:${item.filePath}`,
      name: item.fileName,
      path: item.filePath,
      parentPath: item.parentFolder,
      location: 'local' as const,
      type: 'file' as const,
      sizeBytes: item.sizeBytes,
      modifiedAt: item.modifiedAt,
      extension: item.extension?.replace(/^\./, '').toLowerCase(),
    }));
    setLocalFolder(result.items[0]?.parentFolder);
    setSelectedLocalTreePath(result.items[0]?.parentFolder);
    setLocalEntries(entries);
    setSelectedLocalIds(entries.map((entry) => entry.id));
    setLocalSelectionAnchor(entries[0]?.id);
    setMessage(result.message || `${entries.length}개 PC ROM 파일을 선택했습니다.`);
  }

  // Mirror the active/just-finished transfer job into the in-panel operations log, so returning to this menu re-attaches
  // to a copy that started here (or ran while away).
  useEffect(() => {
    if (!transfer.job) return;
    setShowOperations(true);
    setOperationLog([...transfer.job.results].reverse().slice(0, 30));
  }, [transfer.job]);

  // When a transfer finishes (even if it finished while this panel was unmounted), refresh listings + show a summary.
  // Guarded by job id so it runs once per job.
  useEffect(() => {
    const job = transfer.job;
    if (!job || (job.status !== 'done' && job.status !== 'cancelled')) return;
    if (job.id === lastFinishedJobRef.current) return;
    lastFinishedJobRef.current = job.id;
    setMessage(
      job.status === 'cancelled'
        ? `전송을 취소했습니다 (${job.completed}/${job.total} 완료${job.failed > 0 ? `, 실패 ${job.failed}` : ''}).`
        : job.failed > 0
          ? `${job.failed}개 작업이 실패했습니다.`
          : `${job.completed}개 작업을 완료했습니다.`,
    );
    void refreshRemote(remotePath);
    if (localFolder) void loadLocalFolder(localFolder, { recordHistory: false });
  }, [transfer.job, remotePath, localFolder, refreshRemote, loadLocalFolder]);

  // Long copy/move batches run through the app-level transfer manager (global indicator + cancel + survives navigation).
  function runTransfer(operations: Array<() => Promise<RomFsOperationResult>>, title: string): Promise<RomTransferBatchOutcome> {
    if (operations.length === 0) return Promise.resolve({ results: [], cancelled: false });
    return transfer.runOperations(operations, title);
  }

  async function runOperationBatch(operations: Array<() => Promise<RomFsOperationResult>>): Promise<RomFsOperationResult[]> {
    if (operations.length === 0) return [];
    setBusy(true);
    setShowOperations(true);
    setMessage(`작업 ${operations.length}개를 진행 중입니다.`);
    const results: RomFsOperationResult[] = [];
    for (const operation of operations) {
      const result = await operation();
      results.push(result);
      setOperationLog((items) => [result, ...items].slice(0, 30));
    }
    setBusy(false);
    const failed = results.filter((result) => !result.ok || result.status === 'failed');
    setMessage(failed.length > 0 ? `${failed.length}개 작업이 실패했습니다.` : `${results.length}개 작업을 완료했습니다.`);
    if (results.some((result) => result.ok && result.status !== 'skipped')) {
      void refreshRemote(remotePath);
      if (localFolder) void loadLocalFolder(localFolder, { recordHistory: false });
    }
    return results;
  }

  // Recursively expand selected entries (files AND folders) into a flat list of per-file copy operations. Folders are
  // walked via the existing list IPC; each file reuses the existing single-file copy op (with conflict policy). This
  // mirrors how multi-file copy already loops single-path ops, so it stays consistent and reuses the tested, safe copy
  // path (temp file + size verify + conflict handling). A folder already present on the destination is MERGED into
  // (per-file conflicts then auto-rename to ' (n)') — this is the desired behaviour for ROM platform folders, not a
  // folder-level rename. A genuinely empty subtree emits an explicit folder-create op so the structure is reproduced,
  // a sub-listing that fails emits a synthetic failed op (so a partial copy is never reported as success), and a depth
  // cap breaks runaway recursion from a local directory symlink/junction loop.
  type CopyOp = () => Promise<RomFsOperationResult>;
  const MAX_COPY_DEPTH = 64;

  const syntheticFailedOp = (operationType: RomFsOperationResult['operationType'], sourcePath: string, message: string): CopyOp => () => {
    const now = new Date().toISOString();
    return Promise.resolve({ ok: false, operationType, status: 'failed' as const, startedAt: now, finishedAt: now, sourcePath, fileCount: 0, totalBytes: 0, message });
  };

  async function buildUploadOps(entries: RomFsEntry[], targetParent: string, conflictPolicy: RomFsConflictPolicy): Promise<CopyOp[]> {
    const ops: CopyOp[] = [];
    const profileId = activeMister?.profileId;
    // Returns true if the subtree produced at least one file op (so the parent does not also emit an empty-folder op).
    const walk = async (localPath: string, remoteParent: string, folderName: string, depth: number): Promise<boolean> => {
      if (depth > MAX_COPY_DEPTH) { ops.push(syntheticFailedOp('localToMisterCopy', localPath, `폴더 깊이가 너무 깊어 건너뜀(순환 링크 가능): ${localPath}`)); return true; }
      const remoteFolder = `${remoteParent}/${folderName}`;
      const listing = await listLocalRomFolder(localPath);
      if (!listing.ok) { ops.push(syntheticFailedOp('localToMisterCopy', localPath, `PC 폴더를 읽지 못해 건너뜀: ${listing.message}`)); return true; }
      let any = false;
      for (const child of listing.entries) {
        if (child.type === 'file') { ops.push(() => copyLocalToMister({ profileId, localPath: child.path, targetFolderPath: remoteFolder, conflictPolicy })); any = true; }
        else if (child.type === 'directory') { if (await walk(child.path, remoteFolder, child.name, depth + 1)) any = true; }
      }
      if (!any) ops.push(() => createRemoteRomFolder({ profileId, parentPath: remoteParent, folderName }));
      return any;
    };
    for (const entry of entries) {
      if (entry.type === 'file') ops.push(() => copyLocalToMister({ profileId, localPath: entry.path, targetFolderPath: targetParent, conflictPolicy }));
      else if (entry.type === 'directory') await walk(entry.path, targetParent, entry.name, 0);
    }
    return ops;
  }

  async function buildDownloadOps(entries: RomFsEntry[], targetLocalParent: string, conflictPolicy: RomFsConflictPolicy, isTrashSource: boolean): Promise<CopyOp[]> {
    const ops: CopyOp[] = [];
    const profileId = activeMister?.profileId;
    const sep = targetLocalParent.includes('\\') ? '\\' : '/';
    const joinLocal = (base: string, name: string) => `${base}${base.endsWith(sep) ? '' : sep}${name}`;
    const walk = async (sourcePath: string, localFolderPath: string, depth: number): Promise<boolean> => {
      if (depth > MAX_COPY_DEPTH) { ops.push(syntheticFailedOp('misterToLocalCopy', sourcePath, `폴더 깊이가 너무 깊어 건너뜀: ${sourcePath}`)); return true; }
      const listing = await listRemoteRomFolder(profileId, sourcePath);
      if (!listing.ok) { ops.push(syntheticFailedOp('misterToLocalCopy', sourcePath, `MiSTer 폴더를 읽지 못해 건너뜀: ${listing.message}`)); return true; }
      let any = false;
      for (const child of listing.entries) {
        if (!shouldShowRomFsEntry(child, { isTrashView: isTrashSource })) continue;
        if (child.type === 'file') { ops.push(() => copyMisterToLocal({ profileId, remotePath: child.path, localFolderPath, conflictPolicy })); any = true; }
        else if (child.type === 'directory') { if (await walk(child.path, joinLocal(localFolderPath, child.name), depth + 1)) any = true; }
      }
      if (!any) ops.push(() => createLocalRomFolder({ folderPath: localFolderPath }));
      return any;
    };
    for (const entry of entries) {
      if (entry.type === 'file') ops.push(() => copyMisterToLocal({ profileId, remotePath: entry.path, localFolderPath: targetLocalParent, conflictPolicy }));
      else if (entry.type === 'directory') await walk(entry.path, joinLocal(targetLocalParent, entry.name), 0);
    }
    return ops;
  }

  async function buildMisterToMisterOps(entries: RomFsEntry[], destProfileId: string, targetParent: string, conflictPolicy: RomFsConflictPolicy, isTrashSource: boolean): Promise<CopyOp[]> {
    const ops: CopyOp[] = [];
    const sourceProfileId = activeMister?.profileId;
    const walk = async (sourcePath: string, destParent: string, folderName: string, depth: number): Promise<boolean> => {
      if (depth > MAX_COPY_DEPTH) { ops.push(syntheticFailedOp('misterToMisterCopy', sourcePath, `폴더 깊이가 너무 깊어 건너뜀: ${sourcePath}`)); return true; }
      const targetFolderPath = `${destParent}/${folderName}`;
      const listing = await listRemoteRomFolder(sourceProfileId, sourcePath);
      if (!listing.ok) { ops.push(syntheticFailedOp('misterToMisterCopy', sourcePath, `MiSTer 폴더를 읽지 못해 건너뜀: ${listing.message}`)); return true; }
      let any = false;
      for (const child of listing.entries) {
        if (!shouldShowRomFsEntry(child, { isTrashView: isTrashSource })) continue;
        if (child.type === 'file') { ops.push(() => copyMisterToMister({ sourceProfileId, targetProfileId: destProfileId, sourceRemotePath: child.path, targetFolderPath, conflictPolicy })); any = true; }
        else if (child.type === 'directory') { if (await walk(child.path, targetFolderPath, child.name, depth + 1)) any = true; }
      }
      if (!any) ops.push(() => createRemoteRomFolder({ profileId: destProfileId, parentPath: destParent, folderName }));
      return any;
    };
    for (const entry of entries) {
      if (entry.type === 'file') ops.push(() => copyMisterToMister({ sourceProfileId, targetProfileId: destProfileId, sourceRemotePath: entry.path, targetFolderPath: targetParent, conflictPolicy }));
      else if (entry.type === 'directory') await walk(entry.path, targetParent, entry.name, 0);
    }
    return ops;
  }

  function preparePcToMister(targetFolder = remotePath, ids = selectedLocalIds) {
    const entries = localEntries.filter((entry) => ids.includes(entry.id));
    if (entries.length === 0) {
      setMessage('MiSTer로 보낼 PC 파일 또는 폴더를 선택하세요.');
      return;
    }
    if (!canWriteRemote) {
      setMessage('MiSTer 연결이 필요합니다. 먼저 MiSTer 연결 메뉴에서 연결하세요.');
      return;
    }
    setSendTargetFolder(targetFolder);
    setShowSendModal(true);
  }

  async function executePcToMister() {
    if (selectedLocalEntries.length === 0) return;
    if (transfer.isRunning) { setMessage('이미 파일 전송이 진행 중입니다. 완료 또는 취소 후 다시 시도하세요.'); return; }
    setShowSendModal(false);
    setBusy(true);
    setMessage('복사할 파일 목록을 만드는 중...');
    const ops = await buildUploadOps(selectedLocalEntries, sendTargetFolder, sendConflictPolicy);
    setBusy(false);
    if (ops.length === 0) { setMessage('복사할 파일이 없습니다(폴더가 비어 있을 수 있음).'); return; }
    await runTransfer(ops, 'MiSTer로 복사');
  }

  async function copyMisterToPc(entries = selectedRemoteEntries, targetFolderOverride?: string) {
    if (entries.length === 0) {
      setMessage('PC로 보낼 MiSTer 파일 또는 폴더를 선택하세요.');
      return;
    }
    if (transfer.isRunning) { setMessage('이미 파일 전송이 진행 중입니다. 완료 또는 취소 후 다시 시도하세요.'); return; }
    const targetFolder = targetFolderOverride || localFolder;
    if (!targetFolder) {
      setMessage('PC 트리에서 복사 대상 폴더를 먼저 선택하세요.');
      return;
    }
    const hasFolder = entries.some((entry) => entry.type === 'directory');
    const confirmCopy = window.confirm(`MiSTer 항목 ${entries.length}개를 PC 폴더로 복사할까요?\n\n대상: ${targetFolder}${hasFolder ? '\n폴더는 하위 파일까지 복사됩니다.' : ''}\n같은 이름 파일 기본 처리: 건너뛰기`);
    if (!confirmCopy) return;
    setBusy(true);
    setMessage('복사할 파일 목록을 만드는 중...');
    const ops = await buildDownloadOps(entries, targetFolder, 'skip', isTrashView);
    setBusy(false);
    if (ops.length === 0) { setMessage('복사할 파일이 없습니다(폴더가 비어 있을 수 있음).'); return; }
    await runTransfer(ops, 'PC로 복사');
  }

  // Ctrl+V: paste the clipboard to the OPPOSITE side's current folder (PC clip → MiSTer folder, MiSTer clip → PC
  // folder). Per-file name conflicts auto-rename to ' (n)'. A 'cut' from MiSTer trashes the source after a fully
  // successful copy; a 'cut' from PC copies only — PC sources are never auto-deleted for safety (user is told so).
  async function pasteClipboard() {
    const cb = clipboard;
    if (!cb) return;
    if (transfer.isRunning) { setMessage('이미 파일 전송이 진행 중입니다. 완료 또는 취소 후 다시 시도하세요.'); return; }
    if (cb.scope === 'local') {
      if (!canWriteRemote) { setMessage('MiSTer 쓰기 권한이 필요합니다.'); return; }
      const entries = localEntries.filter((entry) => cb.ids.includes(entry.id));
      if (entries.length === 0) { setMessage('클립보드 항목을 현재 PC 목록에서 찾을 수 없습니다.'); return; }
      setBusy(true);
      setMessage(`${remotePath}에 붙여넣는 중...`);
      const ops = await buildUploadOps(entries, remotePath, 'rename');
      setBusy(false);
      // A PC 'cut' copies only — PC originals are never auto-deleted (the user was told so at Ctrl+X time).
      await runTransfer(ops, 'MiSTer로 붙여넣기');
      setClipboard(undefined);
      return;
    }
    if (!localFolder) { setMessage('PC 폴더를 먼저 선택한 뒤 Ctrl+V로 붙여넣으세요.'); return; }
    const entries = remoteEntries.filter((entry) => cb.ids.includes(entry.id));
    if (entries.length === 0) { setMessage('클립보드 항목을 현재 MiSTer 목록에서 찾을 수 없습니다.'); return; }
    setBusy(true);
    setMessage(`${localFolder}에 붙여넣는 중...`);
    const ops = await buildDownloadOps(entries, localFolder, 'rename', isTrashView);
    setBusy(false);
    const { results, cancelled } = await runTransfer(ops, 'PC로 붙여넣기');
    if (cb.mode === 'cut') {
      // Only trash the MiSTer sources after a fully successful, non-cancelled copy — never delete originals otherwise.
      const anyFailed = results.some((result) => !result.ok || result.status === 'failed');
      if (cancelled || anyFailed) {
        setMessage('전송이 취소되었거나 일부가 실패하여 MiSTer 원본을 삭제하지 않았습니다.');
        return;
      }
      await runOperationBatch(entries.map((entry) => () => trashRemoteRom({ profileId: activeMister?.profileId, sourcePath: entry.path })));
    }
    setClipboard(undefined);
  }

  async function renameSelectedRemote() {
    if (!primarySelectedRemote || selectedRemoteEntries.length !== 1) {
      setMessage('이름을 바꿀 MiSTer 파일 또는 폴더 하나만 선택하세요.');
      return;
    }
    if (!canWriteRemote) {
      setMessage('MiSTer 연결이 필요합니다. 먼저 MiSTer 연결 메뉴에서 연결하세요.');
      return;
    }
    const nextName = window.prompt('새 이름을 입력하세요. /, \\, .. 문자는 사용할 수 없습니다.', primarySelectedRemote.name);
    if (!nextName || nextName === primarySelectedRemote.name) return;
    await runOperationBatch([() => renameRemoteRom({
      profileId: activeMister?.profileId,
      sourcePath: primarySelectedRemote.path,
      newName: nextName,
      conflictPolicy: 'skip',
    })]);
  }

  async function moveSelectedRemote() {
    if (!primarySelectedRemote || selectedRemoteEntries.length !== 1) {
      setMessage('이동할 MiSTer 파일 또는 폴더 하나만 선택하세요.');
      return;
    }
    if (!canWriteRemote) {
      setMessage('MiSTer 연결이 필요합니다. 먼저 MiSTer 연결 메뉴에서 연결하세요.');
      return;
    }
    const targetPath = window.prompt('이동할 전체 대상 경로를 입력하세요. 허용 root 안에서만 가능합니다.', `${remotePath}/${primarySelectedRemote.name}`);
    if (!targetPath || targetPath === primarySelectedRemote.path) return;
    await runOperationBatch([() => moveRemoteRom({
      profileId: activeMister?.profileId,
      sourcePath: primarySelectedRemote.path,
      targetPath,
      conflictPolicy: 'skip',
    })]);
  }

  async function trashSelectedRemote() {
    if (selectedRemoteEntries.length === 0) {
      setMessage('휴지통으로 이동할 MiSTer 파일 또는 폴더를 선택하세요.');
      return;
    }
    if (!canWriteRemote) {
      setMessage('MiSTer 연결이 필요합니다. 먼저 MiSTer 연결 메뉴에서 연결하세요.');
      return;
    }
    const confirmTrash = window.confirm(`선택한 ${selectedRemoteEntries.length}개 항목을 휴지통으로 이동할까요?\n\n영구 삭제가 아니라 /media/fat/.hello-mister-trash 아래로 이동합니다.`);
    if (!confirmTrash) return;
    await runOperationBatch(selectedRemoteEntries.map((entry) => () => trashRemoteRom({ profileId: activeMister?.profileId, sourcePath: entry.path })));
  }

  async function deleteSelectedRemotePermanently() {
    if (!isTrashView) {
      setMessage('영구 삭제는 /media/fat/.hello-mister-trash 휴지통 안에서만 사용할 수 있습니다.');
      return;
    }
    if (selectedRemoteEntries.length === 0) {
      setMessage('영구 삭제할 휴지통 항목을 선택하세요.');
      return;
    }
    if (!canWriteRemote) {
      setMessage('MiSTer 연결이 필요합니다. 먼저 MiSTer 연결 메뉴에서 연결하세요.');
      return;
    }
    const confirmDelete = window.confirm(`선택한 ${selectedRemoteEntries.length}개 휴지통 항목을 영구 삭제할까요?\n\n이 작업은 되돌릴 수 없습니다.`);
    if (!confirmDelete) return;
    await runOperationBatch(selectedRemoteEntries.map((entry) => () => deleteRemoteRom({
      profileId: activeMister?.profileId,
      sourcePath: entry.path,
      confirmed: true,
    })));
  }

  async function restoreSelectedRemote() {
    if (!isTrashView) {
      setMessage('복원은 /media/fat/.hello-mister-trash 휴지통 안에서만 사용할 수 있습니다.');
      return;
    }
    if (selectedRemoteEntries.length === 0) {
      setMessage('복원할 휴지통 항목을 선택하세요.');
      return;
    }
    if (!canWriteRemote) {
      setMessage('MiSTer 연결이 필요합니다. 먼저 MiSTer 연결 메뉴에서 연결하세요.');
      return;
    }
    const restorable = selectedRemoteEntries
      .map((entry) => ({ entry, originalPath: originalPathFromTrash(entry.path) }))
      .filter((item): item is { entry: RomFsEntry; originalPath: string } => Boolean(item.originalPath));
    if (restorable.length === 0) {
      setMessage('이 항목들의 원래 위치를 확인할 수 없어 복원할 수 없습니다.');
      return;
    }
    await runOperationBatch(restorable.map((item) => () => restoreRemoteRom({
      profileId: activeMister?.profileId,
      trashPath: item.entry.path,
      originalPath: item.originalPath,
    })));
  }

  async function createFolder() {
    if (!canWriteRemote) {
      setMessage('MiSTer 연결이 필요합니다. 먼저 MiSTer 연결 메뉴에서 연결하세요.');
      return;
    }
    const folderName = window.prompt('새 MiSTer 대상 폴더 이름을 입력하세요.');
    if (!folderName) return;
    await runOperationBatch([() => createRemoteRomFolder({ profileId: activeMister?.profileId, parentPath: remotePath, folderName })]);
  }

  function copyBetweenMisters() {
    if (selectedRemoteEntries.length === 0) {
      setMessage('MiSTer 간 복사할 원본 파일 또는 폴더를 선택하세요.');
      return;
    }
    if (!canWriteRemote) {
      setMessage('MiSTer 연결이 필요합니다. 먼저 MiSTer 연결 메뉴에서 연결하세요.');
      return;
    }
    if (savedProfiles.filter((profile) => profile.id !== activeMister?.profileId).length === 0) {
      setMessage('복사할 다른 MiSTer가 없습니다. MiSTer 연결 메뉴에서 두 번째 MiSTer를 등록하세요.');
      return;
    }
    setShowMisterToMisterModal(true);
  }

  async function runMisterToMister(destProfileId: string) {
    setShowMisterToMisterModal(false);
    if (transfer.isRunning) { setMessage('이미 파일 전송이 진행 중입니다. 완료 또는 취소 후 다시 시도하세요.'); return; }
    setBusy(true);
    setMessage('복사할 파일 목록을 만드는 중...');
    const ops = await buildMisterToMisterOps(selectedRemoteEntries, destProfileId, remotePath, 'skip', isTrashView);
    setBusy(false);
    if (ops.length === 0) { setMessage('복사할 파일이 없습니다(폴더가 비어 있을 수 있음).'); return; }
    await runTransfer(ops, 'MiSTer 간 복사');
  }

  function selectEntry(scope: ExplorerScope, entry: RomFsEntry, visibleEntries: RomFsEntry[], event?: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>) {
    const isLocal = scope === 'local';
    const selectedIds = isLocal ? selectedLocalIds : selectedRemoteIds;
    const anchorId = isLocal ? localSelectionAnchor : remoteSelectionAnchor;
    const setSelectedIds = isLocal ? setSelectedLocalIds : setSelectedRemoteIds;
    const setAnchorId = isLocal ? setLocalSelectionAnchor : setRemoteSelectionAnchor;
    const ids = visibleEntries.map((item) => item.id);

    if (event?.shiftKey) {
      setSelectedIds(selectRomFsRange(visibleEntries, anchorId, entry.id));
      setAnchorId(anchorId || entry.id);
      return;
    }

    if (event?.ctrlKey || event?.metaKey) {
      setSelectedIds(selectedIds.includes(entry.id) ? selectedIds.filter((id) => id !== entry.id) : [...selectedIds, entry.id]);
      setAnchorId(entry.id);
      return;
    }

    setSelectedIds(ids.includes(entry.id) ? [entry.id] : []);
    setAnchorId(entry.id);
  }

  function setDragSelection(scope: ExplorerScope, ids: string[]) {
    if (scope === 'local') {
      setSelectedLocalIds(ids);
      setLocalSelectionAnchor(ids[0]);
    } else {
      setSelectedRemoteIds(ids);
      setRemoteSelectionAnchor(ids[0]);
    }
  }

  function openRemoteEntry(entry: RomFsEntry) {
    selectEntry('remote', entry, filteredRemoteEntries);
    if (entry.type === 'directory') openRemoteFolder(entry.path);
  }

  function openLocalEntry(entry: RomFsEntry) {
    selectEntry('local', entry, filteredLocalEntries);
    if (entry.type === 'directory') void loadLocalFolder(entry.path);
  }

  function openRemoteFolder(nextPath: string) {
    if (remotePath && remotePath !== nextPath) setRemoteHistory((items) => [...items.slice(-24), remotePath]);
    void refreshRemote(nextPath);
  }

  function goRemoteParent() {
    if (remotePath === '/') return;
    openRemoteFolder(remotePath.replace(/\/[^/]+$/, '') || '/');
  }

  function goLocalPrevious() {
    if (localHistory.length === 0) return;
    const previous = localHistory[localHistory.length - 1];
    setLocalHistory((items) => items.slice(0, -1));
    void loadLocalFolder(previous, { recordHistory: false });
  }

  function goRemotePrevious() {
    if (remoteHistory.length === 0) return;
    const previous = remoteHistory[remoteHistory.length - 1];
    setRemoteHistory((items) => items.slice(0, -1));
    void refreshRemote(previous);
  }

  function goLocalParent() {
    const parent = localParentPath(localFolder);
    if (!parent) return;
    void loadLocalFolder(parent);
  }

  function handleContextMenu(scope: ExplorerScope, entry: RomFsEntry, event: MouseEvent) {
    event.preventDefault();
    const selectedIds = scope === 'local' ? selectedLocalIds : selectedRemoteIds;
    if (!selectedIds.includes(entry.id)) {
      selectEntry(scope, entry, scope === 'local' ? filteredLocalEntries : filteredRemoteEntries);
    }
    setContextMenu({ x: event.clientX, y: event.clientY, scope, entry });
  }

  function handleBlankContextMenu(scope: ExplorerScope, event: MouseEvent) {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, scope: 'blank' });
  }

  function beginDrag(scope: ExplorerScope, entry: RomFsEntry, event: DragEvent) {
    const ids = scope === 'local' ? selectedLocalIds : selectedRemoteIds;
    const payload: DragPayload = { scope, ids: ids.includes(entry.id) ? ids : [entry.id] };
    currentDragPayloadRef.current = payload;
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(dragDataType, JSON.stringify(payload));
    event.dataTransfer.setData('text/plain', 'hello-mister-rom-copy');
  }

  function getDragPayload(event: DragEvent): DragPayload | undefined {
    const raw = event.dataTransfer.getData(dragDataType);
    if (!raw) return hasScopedDragPayload(event) ? currentDragPayloadRef.current : undefined;
    try {
      const parsed = JSON.parse(raw) as DragPayload;
      if ((parsed.scope === 'local' || parsed.scope === 'remote') && Array.isArray(parsed.ids)) return parsed;
    } catch {
      return undefined;
    }
    return undefined;
  }

  function hasScopedDragPayload(event: DragEvent): boolean {
    return Array.from(event.dataTransfer.types).includes(dragDataType);
  }

  function clearDragPayload() {
    currentDragPayloadRef.current = undefined;
    setDropTarget(undefined);
    setRowDropTargetId(undefined);
  }

  function handlePaneDragOver(scope: ExplorerScope, event: DragEvent) {
    const payload = getDragPayload(event);
    if (!payload || payload.scope === scope) return;
    if (scope === 'remote' && !canWriteRemote) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDropTarget(scope);
  }

  function handlePaneDrop(scope: ExplorerScope, event: DragEvent) {
    const payload = getDragPayload(event);
    setDropTarget(undefined);
    if (!payload || payload.scope === scope) return;
    event.preventDefault();
    if (scope === 'remote' && payload.scope === 'local') {
      setSelectedLocalIds(payload.ids);
      setLocalSelectionAnchor(payload.ids[0]);
      preparePcToMister(remotePath, payload.ids);
      return;
    }
    if (scope === 'local' && payload.scope === 'remote') {
      setSelectedRemoteIds(payload.ids);
      setRemoteSelectionAnchor(payload.ids[0]);
      const entries = remoteEntries.filter((entry) => payload.ids.includes(entry.id));
      void copyMisterToPc(entries);
    }
  }

  function handleRemoteDirectoryDragOver(entry: RomFsEntry, event: DragEvent) {
    const payload = getDragPayload(event);
    if (!payload || payload.scope !== 'local' || entry.type !== 'directory' || !canWriteRemote) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setRowDropTargetId(entry.id);
  }

  function handleRemoteDirectoryDrop(entry: RomFsEntry, event: DragEvent) {
    const payload = getDragPayload(event);
    setRowDropTargetId(undefined);
    if (!payload || payload.scope !== 'local' || entry.type !== 'directory' || !canWriteRemote) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedLocalIds(payload.ids);
    setLocalSelectionAnchor(payload.ids[0]);
    preparePcToMister(entry.path, payload.ids);
  }

  function handleLocalDirectoryDragOver(entry: RomFsEntry, event: DragEvent) {
    const payload = getDragPayload(event);
    if (!payload || payload.scope !== 'remote' || entry.type !== 'directory') return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setRowDropTargetId(entry.id);
  }

  function handleLocalDirectoryDrop(entry: RomFsEntry, event: DragEvent) {
    const payload = getDragPayload(event);
    setRowDropTargetId(undefined);
    if (!payload || payload.scope !== 'remote' || entry.type !== 'directory') return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedRemoteIds(payload.ids);
    setRemoteSelectionAnchor(payload.ids[0]);
    const entries = remoteEntries.filter((item) => payload.ids.includes(item.id));
    void copyMisterToPc(entries, entry.path);
  }

  function handleLocalTreeDragOver(node: RomFsLocalTreeEntry, event: DragEvent) {
    const payload = getDragPayload(event);
    if (!payload || payload.scope !== 'remote') return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setRowDropTargetId(`tree:${node.id}`);
  }

  function handleLocalTreeDrop(node: RomFsLocalTreeEntry, event: DragEvent) {
    const payload = getDragPayload(event);
    setRowDropTargetId(undefined);
    if (!payload || payload.scope !== 'remote') return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedRemoteIds(payload.ids);
    setRemoteSelectionAnchor(payload.ids[0]);
    const entries = remoteEntries.filter((entry) => payload.ids.includes(entry.id));
    void copyMisterToPc(entries, node.path);
  }

  function handleRemoteTreeDragOver(node: RomFsEntry, event: DragEvent) {
    const payload = getDragPayload(event);
    if (!payload || payload.scope !== 'local' || node.type !== 'directory' || !canWriteRemote) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setRowDropTargetId(`remote-tree:${node.id}`);
  }

  function handleRemoteTreeDrop(node: RomFsEntry, event: DragEvent) {
    const payload = getDragPayload(event);
    setRowDropTargetId(undefined);
    if (!payload || payload.scope !== 'local' || node.type !== 'directory' || !canWriteRemote) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedLocalIds(payload.ids);
    setLocalSelectionAnchor(payload.ids[0]);
    preparePcToMister(node.path, payload.ids);
  }

  function clearSelection(scope: ExplorerScope) {
    if (scope === 'local') {
      setSelectedLocalIds([]);
      setLocalSelectionAnchor(undefined);
    } else {
      setSelectedRemoteIds([]);
      setRemoteSelectionAnchor(undefined);
    }
  }

  function showInfo(entry?: RomFsEntry) {
    if (!entry) return;
    window.alert(`${entry.name}\n${entry.path}\n${formatRomFsBytes(entry.sizeBytes)}`);
  }

  if (!activeMister) {
    return (
      <SectionCard title="PC / MiSTer 파일 전송 관리자" description="PC와 MiSTer 파일을 앱 안에서 관리합니다." tone="warning">
        <p>MiSTer 연결이 필요합니다. 먼저 IP 직접 입력 방식으로 MiSTer에 연결하세요.</p>
        <Link className="button primary" to="/mister">MiSTer 연결로 이동</Link>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="PC / MiSTer 파일 전송 관리자"
      description="PC와 MiSTer 폴더를 좌우로 놓고 복사합니다."
      tone={canWriteRemote ? 'safe' : 'warning'}
    >
      <div className="rom-explorer compact">
        <div className="rom-explorer-toolbar compact-toolbar">
          <button type="button" className="button primary compact" onClick={addLocalFiles} disabled={busy} title="PC에서 파일을 선택합니다.">파일 선택</button>
          <button type="button" className="button compact" onClick={() => void loadLocalTreeRoots()} disabled={busy} title="PC 드라이브 트리를 다시 읽습니다.">PC 트리</button>
          <button type="button" className="button compact" onClick={() => refreshRemote()} disabled={busy || !activeMister}>새로고침</button>
          <button type="button" className="button primary compact" onClick={() => preparePcToMister()} disabled={busy || selectedLocalEntries.length === 0 || !canWriteRemote} title="선택한 PC 파일/폴더를 MiSTer 현재 폴더로 복사합니다.">MiSTer로 복사</button>
          <button type="button" className="button primary compact" onClick={() => void copyMisterToPc()} disabled={busy || selectedRemoteEntries.length === 0 || !canReadRemote} title="선택한 MiSTer 파일/폴더를 PC 폴더로 복사합니다.">PC로 복사</button>
          {!isTrashView && <button type="button" className="button compact danger" onClick={() => void trashSelectedRemote()} disabled={busy || selectedRemoteEntries.length === 0 || !canWriteRemote} title="선택한 MiSTer 파일 또는 폴더를 휴지통으로 이동합니다.">휴지통으로 이동</button>}
          {isTrashView && <button type="button" className="button compact" onClick={() => void restoreSelectedRemote()} disabled={busy || selectedRemoteEntries.length === 0 || !canWriteRemote} title="선택한 휴지통 항목을 원래 위치로 복원합니다.">복원</button>}
          {isTrashView && <button type="button" className="button compact danger" onClick={() => void deleteSelectedRemotePermanently()} disabled={busy || selectedRemoteEntries.length === 0 || !canWriteRemote} title="휴지통 안의 선택 항목을 영구 삭제합니다.">영구 삭제</button>}
          <button type="button" className="button compact" onClick={createFolder} disabled={busy || !canWriteRemote}>새 폴더</button>
          <button type="button" className="button compact" onClick={() => setShowOperations((value) => !value)}>작업 보기 {operationLog.length > 0 ? `(${operationLog.length})` : ''}</button>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="검색" aria-label="파일 검색" />
        </div>

        <div className="rom-explorer-statusbar compact-status">
          <strong className="rom-status-primary" title={connectionSummary}>{connectionSummary}</strong>
          {savedProfiles.length > 1 ? (
            <select
              className="rom-target-select"
              value={activeMister?.profileId ?? ''}
              onChange={(event) => selectTargetProfile(event.target.value)}
              title="파일 작업 대상 MiSTer"
              aria-label="파일 작업 대상 MiSTer"
            >
              {savedProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {misterDisplayName(profile)} · {romDeviceStatusLabel(profile)}
                </option>
              ))}
            </select>
          ) : (
            <span className="rom-status-pill" title={activeMisterLabel}>{activeMisterLabel}</span>
          )}
          <span className={`rom-status-pill ${canWriteRemote ? 'ok' : 'warning'}`}>{capabilityBusy ? '권한 확인 중' : formatRomFsCapability(capability)}</span>
          {capability?.cleanupWarning && <span className="warning-text" title={capability.cleanupWarning}>정리 경고</span>}
          <button type="button" className="button small" onClick={() => refreshCapability()} disabled={capabilityBusy || !activeMister} title="현재 MiSTer 폴더 쓰기 권한을 다시 확인합니다.">권한</button>
        </div>

        <div className="rom-explorer-grid two-pane">
          <main
            className={`rom-explorer-main rom-pane ${dropTarget === 'local' ? 'drop-target' : ''}`}
            onMouseEnter={() => setHoveredPane('local')}
            onMouseLeave={() => setHoveredPane(undefined)}
            onDragOver={(event) => handlePaneDragOver('local', event)}
            onDragLeave={() => setDropTarget(undefined)}
            onDrop={(event) => handlePaneDrop('local', event)}
          >
            <div className="rom-explorer-pathbar compact-pathbar">
              <strong>PC</strong>
              <button type="button" className="button small" onClick={goLocalPrevious} disabled={localHistory.length === 0}>이전</button>
              <button type="button" className="button small" onClick={goLocalParent} disabled={!localParentPath(localFolder)}>상위</button>
              <span className="rom-path-text" title={localFolder || undefined}>{localFolder || 'PC 폴더 트리에서 선택'}</span>
              <select value={localExtensionFilter} onChange={(event) => setLocalExtensionFilter(event.target.value)} title="PC 파일 확장자 필터">
                {romExtensionOptions.map((option) => <option key={option} value={option}>{option === 'all' ? '전체' : `.${option}`}</option>)}
              </select>
            </div>
            <div className="rom-local-browser">
              <aside className="rom-local-tree" aria-label="PC 폴더 트리">
                <div className="rom-local-tree-header">
                  <strong>PC 폴더</strong>
                  <button type="button" className="button small" onClick={() => void loadLocalTreeRoots()} title="PC 드라이브 트리를 다시 읽습니다.">새로고침</button>
                </div>
                {localTreeRoots.length === 0 ? (
                  <p className="muted rom-local-tree-empty">PC 드라이브를 읽지 못했습니다.</p>
                ) : (
                  <div className="rom-local-tree-list">{renderLocalTreeNodes(localTreeRoots)}</div>
                )}
              </aside>
              <section className="rom-local-file-panel">
                <FileTable
                  scope="local"
                  entries={filteredLocalEntries}
                  selectedIds={selectedLocalIds}
                  emptyMessage="왼쪽 PC 폴더 트리에서 폴더를 선택하세요."
                  onSelect={(entry, event) => selectEntry('local', entry, filteredLocalEntries, event)}
                  onOpen={openLocalEntry}
                  onBlankClick={() => clearSelection('local')}
                  onDragSelect={(ids) => setDragSelection('local', ids)}
                  onContextMenu={(entry, event) => handleContextMenu('local', entry, event)}
                  onBlankContextMenu={(event) => handleBlankContextMenu('local', event)}
                  onDragStart={(entry, event) => beginDrag('local', entry, event)}
                  onDragEnd={clearDragPayload}
                  onRowDragOver={(entry, event) => handleLocalDirectoryDragOver(entry, event)}
                  onRowDragLeave={() => setRowDropTargetId(undefined)}
                  onRowDrop={(entry, event) => handleLocalDirectoryDrop(entry, event)}
                  dropRowId={rowDropTargetId}
                />
                <PaneStatus summary={selectedLocalSummary} path={localFolder} />
              </section>
            </div>
          </main>

          <main
            className={`rom-explorer-main rom-pane ${dropTarget === 'remote' ? 'drop-target' : ''}`}
            onMouseEnter={() => setHoveredPane('remote')}
            onMouseLeave={() => setHoveredPane(undefined)}
            onDragOver={(event) => handlePaneDragOver('remote', event)}
            onDragLeave={() => setDropTarget(undefined)}
            onDrop={(event) => handlePaneDrop('remote', event)}
          >
            <div className="rom-explorer-pathbar compact-pathbar">
              <strong>MiSTer</strong>
              <button type="button" className="button small" onClick={goRemotePrevious} disabled={remoteHistory.length === 0}>이전</button>
              <button type="button" className="button small" onClick={goRemoteParent}>상위</button>
              <button
                type="button"
                className="button small"
                onClick={() => {
                  setSelectedRoot('/media/fat');
                  setSendTargetFolder('/media/fat/.hello-mister-trash');
                  openRemoteFolder('/media/fat/.hello-mister-trash');
                }}
                title="/media/fat/.hello-mister-trash 통합 휴지통을 엽니다."
              >
                휴지통
              </button>
              <span className="rom-path-text" title={remotePath}>{remotePath}</span>
            </div>
            <div className="rom-root-strip remote-quick-strip" aria-label="MiSTer 빠른 위치">
              {ROM_FS_QUICK_PATHS.map((root) => (
                <button
                  key={root}
                  type="button"
                  className={remotePath === root || (root !== '/' && remotePath.startsWith(`${root}/`)) ? 'selected' : ''}
                  onClick={() => {
                    setSelectedRoot(root);
                    setSendTargetFolder(root);
                    openRemoteFolder(root);
                  }}
                  title="MiSTer 빠른 위치입니다."
                >
                  {root}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setSelectedRoot('/media/fat');
                  setSendTargetFolder('/media/fat/.hello-mister-trash');
                  openRemoteFolder('/media/fat/.hello-mister-trash');
                }}
                title="/media/fat/.hello-mister-trash 통합 휴지통을 엽니다."
              >
                휴지통 보기
              </button>
            </div>
            <div className="rom-local-browser rom-remote-browser">
              <aside className="rom-local-tree rom-remote-tree" aria-label="MiSTer 폴더 트리">
                <div className="rom-local-tree-header">
                  <strong>MiSTer 폴더</strong>
                  <button
                    type="button"
                    className="button small"
                    onClick={() => {
                      setRemoteTreeChildren({});
                      setExpandedRemoteTreePaths([]);
                      void refreshRemote(remotePath);
                    }}
                    title="MiSTer 폴더 트리를 다시 읽습니다."
                  >
                    새로고침
                  </button>
                </div>
                <div className="rom-local-tree-list">{renderRemoteTreeNodes(remoteTreeRoots)}</div>
              </aside>
              <section className="rom-local-file-panel">
                <FileTable
                  scope="remote"
                  entries={filteredRemoteEntries}
                  selectedIds={selectedRemoteIds}
                  emptyMessage="MiSTer 폴더가 비어 있거나 아직 읽지 않았습니다."
                  onSelect={(entry, event) => selectEntry('remote', entry, filteredRemoteEntries, event)}
                  onOpen={openRemoteEntry}
                  onBlankClick={() => clearSelection('remote')}
                  onDragSelect={(ids) => setDragSelection('remote', ids)}
                  onContextMenu={(entry, event) => handleContextMenu('remote', entry, event)}
                  onBlankContextMenu={(event) => handleBlankContextMenu('remote', event)}
                  onDragStart={(entry, event) => beginDrag('remote', entry, event)}
                  onDragEnd={clearDragPayload}
                  onRowDragOver={(entry, event) => handleRemoteDirectoryDragOver(entry, event)}
                  onRowDragLeave={() => setRowDropTargetId(undefined)}
                  onRowDrop={(entry, event) => handleRemoteDirectoryDrop(entry, event)}
                  dropRowId={rowDropTargetId}
                />
                <PaneStatus summary={selectedRemoteSummary} path={remotePath} />
              </section>
            </div>
          </main>
        </div>

        <div className="rom-explorer-statusbar compact-status">
          <span title={message}>{message}</span>
          <span>선택 {selectedCount}개</span>
          <span>{formatRomFsBytes(selectedBytes)}</span>
          <span>{busy ? '작업 중' : '대기 중'}</span>
        </div>

        <div className={`rom-operation-drawer ${showOperations ? 'open' : ''}`}>
          <div className="rom-operation-drawer-header">
            <strong>작업 대기열 / 최근 작업</strong>
            <button className="button small" type="button" onClick={() => setShowOperations(false)}>닫기</button>
          </div>
          <div className="rom-operation-log">
            {operationLog.length === 0 ? <p className="muted">아직 작업 기록이 없습니다.</p> : operationLog.map((item) => (
              <div key={`${item.startedAt}-${item.operationType}-${item.sourcePath}-${item.targetPath}`} className={`rom-operation-log-item status-${item.status}`}>
                <strong>{formatRomFsStatus(item)}</strong>
                <span>{item.sourcePath || '-'} → {item.targetPath || '-'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          canReadRemote={canReadRemote}
          canWriteRemote={canWriteRemote}
          onClose={() => setContextMenu(undefined)}
          onOpen={(entry) => (entry.location === 'mister' ? openRemoteEntry(entry) : openLocalEntry(entry))}
          onPcToMister={() => preparePcToMister()}
          onMisterToPc={() => void copyMisterToPc()}
          onMisterToMister={() => void copyBetweenMisters()}
          onMove={() => void moveSelectedRemote()}
          onRename={() => void renameSelectedRemote()}
          onTrash={() => void trashSelectedRemote()}
          onRestore={() => void restoreSelectedRemote()}
          onDeletePermanently={() => void deleteSelectedRemotePermanently()}
          onCreateFolder={() => void createFolder()}
          onRefresh={() => void refreshRemote()}
          onClearSelection={(scope) => clearSelection(scope)}
          onInfo={showInfo}
        />
      )}

      {showSendModal && selectedLocalEntries.length > 0 && (
        <div className="modal-backdrop" role="presentation">
          <div className="compare-modal" role="dialog" aria-modal="true" aria-label="MiSTer 대상 선택">
            <div className="modal-header">
              <h3>MiSTer 대상 선택</h3>
              <button className="button compact" onClick={() => setShowSendModal(false)}>닫기</button>
            </div>
            <p className="muted">{selectedLocalEntries.length}개 PC 항목(파일/폴더)을 MiSTer로 복사합니다. 폴더는 하위까지 복사됩니다.</p>
            <dl className="detail-list">
              <dt>항목</dt>
              <dd>{selectedLocalEntries.slice(0, 5).map((entry) => `${entry.type === 'directory' ? '[폴더] ' : ''}${entry.name}`).join(', ')}{selectedLocalEntries.length > 5 ? ' 외' : ''}</dd>
              <dt>대상 MiSTer</dt>
              <dd>{misterDisplayName(activeMister)}</dd>
              <dt>대상 폴더</dt>
              <dd>{sendTargetFolder}</dd>
            </dl>
            <div className="action-row">
              {ROM_FS_QUICK_PATHS.map((root) => <button key={root} className="button small" onClick={() => setSendTargetFolder(root)}>{root}</button>)}
              <button className="button small" onClick={() => setSendTargetFolder(remotePath)}>현재 MiSTer 폴더</button>
            </div>
            {remoteFolders.length > 0 && (
              <div className="rom-target-folder-list">
                {remoteFolders.slice(0, 24).map((folder) => (
                  <button key={folder.id} type="button" className="button small" onClick={() => setSendTargetFolder(folder.path)}>
                    {folder.name}
                  </button>
                ))}
              </div>
            )}
            <label className="field">
              같은 이름 파일 처리
              <select value={sendConflictPolicy} onChange={(event) => setSendConflictPolicy(event.target.value as RomFsConflictPolicy)}>
                <option value="skip">건너뛰기</option>
                <option value="rename">이름 변경</option>
                <option value="overwrite">덮어쓰기</option>
              </select>
            </label>
            <div className="danger-box">
              <span>원격 쓰기는 선택한 MiSTer 절대경로에 SFTP로만 실행합니다.</span>
              <span>기본 충돌 정책은 건너뛰기입니다.</span>
            </div>
            <div className="action-row">
              <button className="button primary" onClick={() => void executePcToMister()} disabled={!canWriteRemote}>복사 실행</button>
              <button className="button" onClick={() => setShowSendModal(false)}>취소</button>
            </div>
          </div>
        </div>
      )}

      {showMisterToMisterModal && selectedRemoteEntries.length > 0 && (
        <div className="modal-backdrop" role="presentation">
          <div className="compare-modal" role="dialog" aria-modal="true" aria-label="다른 MiSTer로 복사">
            <div className="modal-header">
              <h3>다른 MiSTer로 복사</h3>
              <button className="button compact" onClick={() => setShowMisterToMisterModal(false)}>닫기</button>
            </div>
            <p className="muted">
              {selectedRemoteEntries.length}개 항목을 {misterDisplayName(activeMister)}의 {remotePath} 위치에서
              아래 선택한 MiSTer의 같은 경로로 복사합니다.
            </p>
            <div className="rom-target-folder-list">
              {savedProfiles.filter((profile) => profile.id !== activeMister?.profileId).map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  className="button small"
                  onClick={() => void runMisterToMister(profile.id)}
                  disabled={busy}
                  title={`${profile.ipAddress} 로 복사`}
                >
                  {misterDisplayName(profile)} · {romDeviceStatusLabel(profile)}
                </button>
              ))}
            </div>
            <div className="action-row">
              <button className="button" onClick={() => setShowMisterToMisterModal(false)}>취소</button>
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function FileTable({
  scope,
  entries,
  selectedIds,
  emptyMessage,
  onSelect,
  onOpen,
  onBlankClick,
  onDragSelect,
  onContextMenu,
  onBlankContextMenu,
  onDragStart,
  onDragEnd,
  onRowDragOver,
  onRowDragLeave,
  onRowDrop,
  dropRowId,
}: {
  scope: ExplorerScope;
  entries: RomFsEntry[];
  selectedIds: string[];
  emptyMessage: string;
  onSelect: (entry: RomFsEntry, event: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>) => void;
  onOpen?: (entry: RomFsEntry) => void;
  onBlankClick: () => void;
  onDragSelect: (ids: string[]) => void;
  onContextMenu: (entry: RomFsEntry, event: MouseEvent) => void;
  onBlankContextMenu: (event: MouseEvent) => void;
  onDragStart: (entry: RomFsEntry, event: DragEvent) => void;
  onDragEnd?: () => void;
  onRowDragOver?: (entry: RomFsEntry, event: DragEvent) => void;
  onRowDragLeave?: () => void;
  onRowDrop?: (entry: RomFsEntry, event: DragEvent) => void;
  dropRowId?: string;
}) {
  const tableRef = useRef<HTMLDivElement>(null);
  const [dragBox, setDragBox] = useState<{ active: boolean; startX: number; startY: number; currentX: number; currentY: number } | undefined>();

  function beginDragSelection(event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('.rom-file-row:not(.heading)')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setDragBox({
      active: true,
      startX: event.clientX - rect.left,
      startY: event.clientY - rect.top,
      currentX: event.clientX - rect.left,
      currentY: event.clientY - rect.top,
    });
    onBlankClick();
    event.preventDefault();
  }

  function moveDragSelection(event: MouseEvent<HTMLDivElement>) {
    if (!dragBox?.active || !tableRef.current) return;
    const rect = tableRef.current.getBoundingClientRect();
    const nextBox = {
      ...dragBox,
      currentX: event.clientX - rect.left,
      currentY: event.clientY - rect.top,
    };
    setDragBox(nextBox);
    const selectionRect = toScreenRect(nextBox, rect);
    const ids: string[] = [];
    tableRef.current.querySelectorAll<HTMLElement>('.rom-file-row[data-entry-id]').forEach((row) => {
      if (rectsIntersect(row.getBoundingClientRect(), selectionRect)) ids.push(row.dataset.entryId || '');
    });
    onDragSelect(ids.filter(Boolean));
    event.preventDefault();
  }

  function endDragSelection() {
    if (dragBox?.active) setDragBox(undefined);
  }

  if (entries.length === 0) return <p className="muted rom-empty-state">{emptyMessage}</p>;
  return (
    <div
      ref={tableRef}
      className={`rom-file-table compact-density ${dragBox?.active ? 'drag-selecting' : ''}`}
      onMouseDown={beginDragSelection}
      onMouseMove={moveDragSelection}
      onMouseUp={endDragSelection}
      onMouseLeave={endDragSelection}
      onContextMenu={onBlankContextMenu}
      data-scope={scope}
    >
      <div className="rom-file-row heading">
        <span>이름</span>
        <span>확장자</span>
        <span>크기</span>
      </div>
      {entries.map((entry) => (
        <button
          type="button"
          key={entry.id}
          className={`rom-file-row ${selectedIds.includes(entry.id) ? 'selected' : ''} ${dropRowId === entry.id ? 'drop-target' : ''}`}
          title={entry.path}
          data-entry-id={entry.id}
          draggable
          onClick={(event) => onSelect(entry, event)}
          onDoubleClick={() => onOpen?.(entry)}
          onContextMenu={(event) => {
            event.stopPropagation();
            onContextMenu(entry, event);
          }}
          onDragStart={(event) => onDragStart(entry, event)}
          onDragEnd={onDragEnd}
          onDragOver={(event) => onRowDragOver?.(entry, event)}
          onDragLeave={onRowDragLeave}
          onDrop={(event) => onRowDrop?.(entry, event)}
        >
          <span className="rom-file-name" title={entry.name}>{entry.type === 'directory' ? '[폴더] ' : ''}{entry.name}</span>
          <span className="rom-file-extension">{formatRomFsExtension(entry)}</span>
          <span className="rom-file-size">{formatRomFsBytes(entry.sizeBytes)}</span>
        </button>
      ))}
      {dragBox?.active && (
        <div
          className="rom-selection-rectangle"
          style={{
            left: Math.min(dragBox.startX, dragBox.currentX),
            top: Math.min(dragBox.startY, dragBox.currentY),
            width: Math.abs(dragBox.currentX - dragBox.startX),
            height: Math.abs(dragBox.currentY - dragBox.startY),
          }}
        />
      )}
    </div>
  );
}

function ContextMenu({
  state,
  canReadRemote,
  canWriteRemote,
  onClose,
  onOpen,
  onPcToMister,
  onMisterToPc,
  onMisterToMister,
  onMove,
  onRename,
  onTrash,
  onRestore,
  onDeletePermanently,
  onCreateFolder,
  onRefresh,
  onClearSelection,
  onInfo,
}: {
  state: ContextMenuState;
  canReadRemote: boolean;
  canWriteRemote: boolean;
  onClose: () => void;
  onOpen: (entry: RomFsEntry) => void;
  onPcToMister: () => void;
  onMisterToPc: () => void;
  onMisterToMister: () => void;
  onMove: () => void;
  onRename: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onDeletePermanently: () => void;
  onCreateFolder: () => void;
  onRefresh: () => void;
  onClearSelection: (scope: ExplorerScope) => void;
  onInfo: (entry?: RomFsEntry) => void;
}) {
  const entry = state.entry;
  const isLocal = state.scope === 'local';
  const isRemote = state.scope === 'remote';
  const isBlank = state.scope === 'blank';
  const isTrashEntry = Boolean(entry?.path.split('/').includes('.hello-mister-trash'));

  function invoke(action: () => void) {
    action();
    onClose();
  }

  return (
    <div className="rom-context-menu" style={{ left: state.x, top: state.y }} onClick={(event) => event.stopPropagation()}>
      {entry?.type === 'directory' && <button type="button" onClick={() => invoke(() => onOpen(entry))}>열기</button>}
      {isLocal && <button type="button" onClick={() => invoke(onPcToMister)} disabled={!canWriteRemote}>MiSTer로 복사</button>}
      {isRemote && <button type="button" onClick={() => invoke(onMisterToPc)} disabled={!canReadRemote}>PC로 복사</button>}
      {isRemote && <button type="button" onClick={() => invoke(onMisterToMister)} disabled={!canWriteRemote}>MiSTer 간 복사</button>}
      {isRemote && <button type="button" onClick={() => invoke(onMove)} disabled={!canWriteRemote}>이동</button>}
      {isRemote && <button type="button" onClick={() => invoke(onRename)} disabled={!canWriteRemote}>이름 변경</button>}
      {isRemote && !isTrashEntry && <button type="button" className="danger" onClick={() => invoke(onTrash)} disabled={!canWriteRemote}>휴지통으로 이동</button>}
      {isRemote && isTrashEntry && <button type="button" onClick={() => invoke(onRestore)} disabled={!canWriteRemote}>복원</button>}
      {isRemote && isTrashEntry && <button type="button" className="danger" onClick={() => invoke(onDeletePermanently)} disabled={!canWriteRemote}>영구 삭제</button>}
      {(isRemote || isBlank) && <button type="button" onClick={() => invoke(onCreateFolder)} disabled={!canWriteRemote}>새 폴더</button>}
      <button type="button" onClick={() => invoke(onRefresh)}>새로고침</button>
      {entry && <button type="button" onClick={() => invoke(() => onInfo(entry))}>정보 보기</button>}
      {(isLocal || isRemote) && <button type="button" onClick={() => invoke(() => onClearSelection(isLocal ? 'local' : 'remote'))}>선택 해제</button>}
    </div>
  );
}

function PaneStatus({ summary, path }: { summary: { count: number; totalBytes: number }; path?: string }) {
  return (
    <div className="rom-pane-status">
      <span title={path}>{path || '위치 없음'}</span>
      <strong>{summary.count}개</strong>
      <span>{formatRomFsBytes(summary.totalBytes)}</span>
    </div>
  );
}

function filterEntries(entries: RomFsEntry[], search: string, extensionFilter = 'all') {
  const term = search.trim().toLowerCase();
  return entries.filter((entry) => {
    const extension = entry.extension?.toLowerCase() || entry.name.split('.').pop()?.toLowerCase();
    const matchesSearch = !term || entry.name.toLowerCase().includes(term) || entry.path.toLowerCase().includes(term);
    const matchesExtension = extensionFilter === 'all' || entry.type === 'directory' || extension === extensionFilter;
    return matchesSearch && matchesExtension;
  });
}

function toScreenRect(
  box: { startX: number; startY: number; currentX: number; currentY: number },
  tableRect: DOMRect,
): DOMRect {
  const left = tableRect.left + Math.min(box.startX, box.currentX);
  const top = tableRect.top + Math.min(box.startY, box.currentY);
  const width = Math.abs(box.currentX - box.startX);
  const height = Math.abs(box.currentY - box.startY);
  return new DOMRect(left, top, width, height);
}

function rectsIntersect(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function localParentPath(folderPath?: string): string | undefined {
  if (!folderPath) return undefined;
  const normalized = folderPath.replace(/[\\/]+$/g, '');
  if (!normalized) return undefined;
  if (/^[A-Za-z]:$/.test(normalized)) return undefined;
  const separator = normalized.includes('\\') ? '\\' : '/';
  const index = normalized.lastIndexOf(separator);
  if (index < 0) return undefined;
  if (/^[A-Za-z]:\\?/.test(normalized) && index <= 2) return `${normalized.slice(0, 2)}\\`;
  const parent = normalized.slice(0, index) || separator;
  return parent === normalized ? undefined : parent;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

// True when the user has a live text selection on the page — used so file-list shortcuts (Ctrl+A/C/X) don't hijack the
// browser's native select-all/copy of an on-screen path or status string.
function hasActiveTextSelection(): boolean {
  const selection = window.getSelection();
  return !!selection && !selection.isCollapsed && selection.toString().trim().length > 0;
}

// True when focus is on an interactive control (button/link), so Enter activates that control instead of opening a folder.
function isInteractiveActiveElement(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  const tagName = active.tagName.toLowerCase();
  return tagName === 'button' || tagName === 'a' || active.getAttribute('role') === 'button';
}
