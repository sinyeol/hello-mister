import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Save, Wand2 } from 'lucide-react';
import { controllerDesktopService } from '../../services/controllers/controllerDesktopService';
import { buildArcadeIndex, getCachedArcadeIndex, lookupArcadeNames } from '../../services/controllers/arcadeIndex';
import { CONSOLE_CORES } from '../../data/consoleCores';
import { loadControllerReference, splitReference } from '../../services/controllers/controllerReference';
import { ACTION_ROLE_COUNT, CONSOLE_ROLES, actionButtonCount, generateConsoleCodes, generateGameCodes, loadConsoleRoleTemplate, loadRoleTemplate, saveConsoleRoleTemplate, saveRoleTemplate, type ConsoleRoleTemplate, type RoleTemplate } from '../../services/controllers/roleTemplate';
import { ANALOG_DIRECTIONS, HAT0_DIRECTIONS, REFERENCE_BUTTON_BASE, learnCodeProfile, learnProfileFromBaseMap, loadCodeProfile, saveCodeProfile, type ControllerCodeProfile } from '../../services/controllers/controllerCodeProfile';
import {
  DIRECTION_CODE,
  DIRECTION_SLOTS,
  buildSlotLabels,
  classifyCode,
  fromLogicalSlots,
  toLogicalSlots,
  type LogicalSlot,
} from '../../services/controllers/controllerMapCodec';
import type { ControllerAutoMapResult, ControllerConnectedDevice, ControllerCoreMapSummary, ControllerMapWithCodes, ControllerReferenceEntry, ControllerWriteMapsItem } from '../../types/controllers';

interface CoreMapEditorProps {
  profileId?: string;
  device: ControllerConnectedDevice;
  lastButton?: { evdevCode: number; label: string; seq: number };
  referenceVersion?: number;
}

interface CodeGroup { sig: string; codes: number[]; games: string[]; paths: string[]; }
interface CountGroup { count: number; games: string[]; mapped: number; }
interface GameRow { setname: string; display: string; names?: string[]; count?: number; mapped: boolean; }

const MAP_VERSION = 'v3';
const GAME_LIST_LIMIT = 3000;

export function CoreMapEditor({ profileId, device, lastButton, referenceVersion }: CoreMapEditorProps) {
  const [view, setView] = useState<'games' | 'auto' | 'codes' | 'console' | 'transfer'>('games');
  const [mapList, setMapList] = useState<ControllerCoreMapSummary[]>([]); // lightweight: game/path, no codes (fast)
  const [listLoaded, setListLoaded] = useState(false);
  const [allMaps, setAllMaps] = useState<ControllerMapWithCodes[]>([]); // full codes — only for the "내 맵 묶음" view (slow)
  const [codesLoaded, setCodesLoaded] = useState(false);
  const [filter, setFilter] = useState('');
  const [groupSort, setGroupSort] = useState<'size' | 'name'>('size');
  const [onlyMapped, setOnlyMapped] = useState(false);
  const [expandedCount, setExpandedCount] = useState<number | null>(null);
  const [genScope, setGenScope] = useState<'all' | 'mapped'>('all');

  const [editTitle, setEditTitle] = useState('');
  const [editTargets, setEditTargets] = useState<string[]>([]);
  const [newGame, setNewGame] = useState<string | null>(null);
  const [isGroup, setIsGroup] = useState(false);
  const [editing, setEditing] = useState(false);
  const [slots, setSlots] = useState<LogicalSlot[]>([]);
  const [slotLabels, setSlotLabels] = useState<Record<number, string>>({});
  const [armedSlot, setArmedSlot] = useState<number | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [indexCount, setIndexCount] = useState<number>(() => { const c = getCachedArcadeIndex(); return c ? Object.keys(c).length : 0; });

  const [template, setTemplate] = useState<RoleTemplate>(() => loadRoleTemplate(device.vid, device.pid));
  const [armedRole, setArmedRole] = useState<string | null>(null);
  const [codeProfile, setCodeProfile] = useState<ControllerCodeProfile | undefined>(() => loadCodeProfile(device.vid, device.pid));
  const [consoleTemplate, setConsoleTemplate] = useState<ConsoleRoleTemplate>(() => loadConsoleRoleTemplate(device.vid, device.pid));

  // "다른 패드로 복사": translate THIS controller's maps onto another connected controller via the validated autoMap.
  const [transferTargets, setTransferTargets] = useState<ControllerConnectedDevice[]>([]);
  const [transferTargetKey, setTransferTargetKey] = useState('');
  const [transferScope, setTransferScope] = useState<'console' | 'all'>('console');
  const [transferResult, setTransferResult] = useState<ControllerAutoMapResult>();
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferMsg, setTransferMsg] = useState('');

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reference = useMemo(() => loadControllerReference(device.vid, device.pid), [device.vid, device.pid, referenceVersion]);
  // Once calibrated, present each reference button at its REAL evdev code (base + usage-1) so the editor, dropdowns,
  // role template and existing on-disk maps all line up in the same (real) code space.
  const refButtons = useMemo(() => {
    const list = splitReference(reference).buttons;
    if (!codeProfile) return list;
    return list.map((b) => (b.usage != null ? { ...b, evdevCode: codeProfile.buttonBase + (b.usage - 1) } : b));
  }, [reference, codeProfile]);
  const refButtonByCode = useMemo(() => {
    const m = new Map<number, ControllerReferenceEntry>();
    for (const b of refButtons) if (b.evdevCode != null) m.set(b.evdevCode, b);
    return m;
  }, [refButtons]);
  const mapByGame = useMemo(() => new Map(mapList.map((m) => [m.game.toLowerCase(), m])), [mapList]);
  // The live monitor reports buttons at the assumed base (0x120+); once calibrated, shift to this controller's real base.
  const toRealCode = (evdev: number) => (codeProfile && evdev >= 0x100 && evdev < 0x200 ? codeProfile.buttonBase + (evdev - REFERENCE_BUTTON_BASE) : evdev);
  // The source version for transfer = the most common version among this controller's existing maps (fallback v3).
  const sourceVersion = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of mapList) counts.set(m.version, (counts.get(m.version) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || MAP_VERSION;
  }, [mapList]);
  const livePressLabel = lastButton ? (refButtonByCode.get(toRealCode(lastButton.evdevCode))?.label ?? lastButton.label ?? `0x${lastButton.evdevCode.toString(16)}`) : undefined;

  // Fast: just which games are mapped (game + path), no codes. Used by every view except "내 맵 묶음".
  const loadMapList = useCallback(async () => {
    if (!profileId) return;
    setBusy(true);
    setMessage('이 컨트롤러의 맵 목록을 불러오는 중...');
    try {
      const result = await controllerDesktopService.listMaps(profileId, device.vid, device.pid);
      setMapList(result.ok ? result.maps : []);
      setListLoaded(true);
      setMessage(result.ok ? `맵 ${result.maps.length}개.` : result.message);
    } finally {
      setBusy(false);
    }
  }, [profileId, device.vid, device.pid]);

  // Slow: read every map's codes (needed only to group by identical mapping).
  const loadAllMaps = useCallback(async () => {
    if (!profileId) return;
    setBusy(true);
    setMessage(`이 컨트롤러의 맵 ${mapList.length || ''}개 내용을 읽는 중... (개수가 많으면 시간이 걸립니다)`);
    try {
      const result = await controllerDesktopService.readAllMaps(profileId, device.vid, device.pid);
      setAllMaps(result.ok ? result.maps : []);
      setCodesLoaded(true);
      setMessage(result.ok ? `맵 ${result.maps.length}개를 읽었습니다.` : result.message);
    } finally {
      setBusy(false);
    }
  }, [profileId, device.vid, device.pid, mapList.length]);

  useEffect(() => { setMapList([]); setListLoaded(false); setAllMaps([]); setCodesLoaded(false); setEditing(false); setSlots([]); setMessage(''); setArmedSlot(null); setBusy(false); setTemplate(loadRoleTemplate(device.vid, device.pid)); setCodeProfile(loadCodeProfile(device.vid, device.pid)); setConsoleTemplate(loadConsoleRoleTemplate(device.vid, device.pid)); }, [device.vid, device.pid]);

  // Live press → assign to an armed slot (editor) or an armed template role.
  useEffect(() => {
    if (!lastButton) return;
    if (armedRole) {
      setTemplate((t) => updateRole(t, armedRole, toRealCode(lastButton.evdevCode)));
      setArmedRole(null);
      setMessage(`역할 “${roleLabel(armedRole)}” ← ${livePressLabel}`);
      return;
    }
    if (armedSlot != null) {
      const code = toRealCode(lastButton.evdevCode);
      setSlots((cur) => cur.map((s) => (s.index === armedSlot ? { ...s, primary: code, secondary: code } : s)));
      setMessage(`슬롯 “${slotLabels[armedSlot] ?? armedSlot}” ← ${livePressLabel} 배정`);
      setArmedSlot(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastButton?.seq]);

  useEffect(() => { saveRoleTemplate(device.vid, device.pid, template); }, [device.vid, device.pid, template]);
  useEffect(() => { saveConsoleRoleTemplate(device.vid, device.pid, consoleTemplate); }, [device.vid, device.pid, consoleTemplate]);

  async function buildIndex() {
    setBusy(true);
    setMessage('아케이드 정보를 인덱싱하는 중... 모든 MRA를 한 번 훑습니다(약 10~20초).');
    try {
      const r = await buildArcadeIndex(profileId);
      setIndexCount(r.count);
      setMessage(r.ok ? `게임 ${r.count}개 인덱싱 완료.` : r.message);
    } finally {
      setBusy(false);
    }
  }

  // Determine this controller's REAL .map codes (button base + direction encoding). Primary source = the kernel's evdev
  // capabilities (ground truth, readable even while MiSTer grabs evdev, and needs NO existing real map). Direction type
  // follows the user's actually-captured lever (reference kind), falling back to caps. Learning from existing maps is
  // only a fallback when caps are unavailable. Also shifts existing role-template button codes to the new base.
  async function calibrateCodes() {
    if (!profileId) return;
    setBusy(true);
    setMessage('컨트롤러의 실제 코드(evdev)를 확인하는 중...');
    try {
      let learned: ControllerCodeProfile | null = null;
      let source = '';
      // 1. BEST: MiSTer's own base/menu map (input_<vid>_<pid>_v3.map) — ground truth for this controller's lever+buttons.
      learned = await learnProfileFromBaseMap(profileId, device.vid, device.pid, sourceVersion);
      if (learned) source = '기본 맵(MiSTer 정의)';
      // 2. evdev capabilities (button base + hat/analog guess).
      const caps = learned ? null : await controllerDesktopService.readInputCaps(profileId, device.vid, device.pid);
      if (!learned && caps?.ok && caps.buttonBase) {
        const refDirs = reference ? Object.values(splitReference(reference).directions) : [];
        const refHat = refDirs.some((d) => d.kind === 'hat');
        const refAxis = refDirs.some((d) => d.kind === 'axis');
        const useHat = refHat || (!refAxis && Boolean(caps.hasHat));
        learned = { buttonBase: caps.buttonBase, directions: useHat ? { ...HAT0_DIRECTIONS } : { ...ANALOG_DIRECTIONS } };
        source = 'evdev 능력치';
      }
      // 3. Fallback: learn from existing per-game maps.
      if (!learned) {
        source = '기존 맵 학습';
        let paths = mapList.map((m) => m.path);
        if (!paths.length) {
          const r = await controllerDesktopService.listMaps(profileId, device.vid, device.pid);
          if (r.ok) { setMapList(r.maps); setListLoaded(true); paths = r.maps.map((m) => m.path); }
        }
        const codesList: number[][] = [];
        for (const path of paths.slice(0, 16)) {
          const r = await controllerDesktopService.readMap(profileId, path);
          if (r.ok && r.codes?.length) codesList.push(r.codes);
        }
        learned = learnCodeProfile(codesList);
      }
      if (!learned) { setMessage('코드 보정 실패: MiSTer 기본 맵도, evdev 정보도, 학습할 맵도 없습니다. 미스터에서 이 컨트롤러로 메뉴를 한 번 정의(Define buttons)한 뒤 다시 시도하세요.'); return; }
      const prevBase = codeProfile?.buttonBase ?? REFERENCE_BUTTON_BASE;
      saveCodeProfile(device.vid, device.pid, learned);
      setCodeProfile(learned);
      const delta = learned.buttonBase - prevBase;
      if (delta !== 0) {
        setTemplate((t) => ({
          actions: t.actions.map((c) => (c != null && c >= 0x100 && c < 0x200 ? c + delta : c)),
          start: t.start != null && t.start >= 0x100 && t.start < 0x200 ? t.start + delta : t.start,
          coin: t.coin != null && t.coin >= 0x100 && t.coin < 0x200 ? t.coin + delta : t.coin,
        }));
      }
      const dr = learned.directions.right;
      const dirKind = (dr & 0xff00) === 0x0200 ? 'HAT(0x02xx)' : ((dr & 0xff) >> 1) >= 16 ? 'D-패드(축16/17)' : '아날로그 스틱';
      setMessage(`코드 보정 완료 (${source}) — 버튼 기준 0x${learned.buttonBase.toString(16)}, 방향 ${dirKind} (0x${dr.toString(16)}). 이제 자동 생성·저장이 이 코드로 기록됩니다. 잘못 생성된 기존 맵은 ‘전체 자동 생성’으로 다시 만드세요.`);
    } finally {
      setBusy(false);
    }
  }

  const gameRows = useMemo<GameRow[]>(() => {
    const index = getCachedArcadeIndex() || {};
    const setnames = new Set<string>([...Object.keys(index), ...mapList.map((m) => m.game.toLowerCase())]);
    const rows: GameRow[] = [];
    for (const sn of setnames) {
      const meta = index[sn];
      const mapped = mapByGame.get(sn);
      rows.push({ setname: sn, display: meta?.name ?? mapped?.game ?? sn, names: meta?.names, count: meta?.count, mapped: Boolean(mapped) });
    }
    rows.sort((a, b) => (Number(b.mapped) - Number(a.mapped)) || a.display.localeCompare(b.display, undefined, { numeric: true }));
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapList, mapByGame, indexCount]);

  const filteredGames = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let rows = gameRows;
    if (onlyMapped) rows = rows.filter((r) => r.mapped);
    if (q) rows = rows.filter((r) => r.setname.includes(q) || r.display.toLowerCase().includes(q));
    return rows.slice(0, GAME_LIST_LIMIT);
  }, [gameRows, filter, onlyMapped]);

  // Console/computer cores: fixed layouts from the catalog (slug = MiSTer core name). Reuses the per-game editor —
  // setname=slug becomes the .map filename, slot labels come from the catalog via buildSlotLabels. mapByGame keys are
  // lower-cased slugs, so a core with an existing map shows ✓.
  const consoleRows = useMemo<GameRow[]>(
    () => CONSOLE_CORES.map((core) => ({
      setname: core.slug,
      display: core.label,
      names: core.slots,
      count: core.slots.length,
      mapped: mapByGame.has(core.slug.toLowerCase()),
    })),
    [mapByGame],
  );
  const consoleMappedCount = useMemo(() => consoleRows.filter((r) => r.mapped).length, [consoleRows]);
  const consoleTemplateReady = useMemo(() => CONSOLE_ROLES.some((r) => consoleTemplate[r] != null), [consoleTemplate]);

  // Coarse grouping by ACTION button count, so a handful of groups cover everything.
  const countGroups = useMemo<CountGroup[]>(() => {
    const index = getCachedArcadeIndex() || {};
    const byCount = new Map<number, CountGroup>();
    for (const [sn, meta] of Object.entries(index)) {
      const c = actionButtonCount(meta.names);
      let g = byCount.get(c);
      if (!g) { g = { count: c, games: [], mapped: 0 }; byCount.set(c, g); }
      g.games.push(sn);
      if (mapByGame.has(sn)) g.mapped += 1;
    }
    return [...byCount.values()].sort((a, b) => a.count - b.count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexCount, mapByGame]);

  const codeGroups = useMemo<CodeGroup[]>(() => {
    const bySig = new Map<string, CodeGroup>();
    for (const m of allMaps) {
      const sig = m.codes.join(',');
      let g = bySig.get(sig);
      if (!g) { g = { sig, codes: m.codes, games: [], paths: [] }; bySig.set(sig, g); }
      g.games.push(m.game); g.paths.push(m.path);
    }
    return [...bySig.values()].sort((a, b) => (groupSort === 'size' ? b.games.length - a.games.length : a.games[0].localeCompare(b.games[0], undefined, { numeric: true })));
  }, [allMaps, groupSort]);

  function seedDirections(logical: LogicalSlot[]): LogicalSlot[] {
    return logical.map((s) => {
      const dir = DIRECTION_SLOTS.find((d) => d.slot === s.index);
      if (!dir) return s;
      const code = codeProfile?.directions[dir.fn] ?? DIRECTION_CODE[dir.fn];
      return { ...s, primary: code, secondary: code };
    });
  }

  async function openGame(row: GameRow) {
    // mapByGame is keyed by lower-cased slug; console rows carry MiSTer's original casing (e.g. "SNES").
    const existing = mapByGame.get(row.setname.toLowerCase());
    setSlotLabels(buildSlotLabels(row.setname, lookupArcadeNames(row.setname)));
    setEditTitle(`${row.display}${existing ? '' : ' (새 맵)'}`);
    setEditTargets(existing ? [existing.path] : []);
    setNewGame(existing ? null : row.setname);
    setIsGroup(false); setArmedSlot(null); setEditing(true);
    if (existing && profileId) {
      setBusy(true);
      try {
        const r = await controllerDesktopService.readMap(profileId, existing.path);
        setSlots(toLogicalSlots(r.ok ? r.codes : new Array(64).fill(0)));
      } finally { setBusy(false); }
    } else {
      setSlots(seedDirections(toLogicalSlots(new Array(64).fill(0))));
    }
    setMessage(row.names ? `${row.display} — 게임별 버튼 이름 적용` : `${row.display} — 표준 슬롯`);
  }

  function openCodeGroup(group: CodeGroup) {
    setSlots(toLogicalSlots(group.codes));
    setSlotLabels(buildSlotLabels(group.games[0], lookupArcadeNames(group.games[0])));
    setEditTitle(`내 맵 묶음: ${group.games[0]} 외 ${group.games.length - 1}개`);
    setEditTargets(group.paths);
    setNewGame(null); setIsGroup(true); setArmedSlot(null); setEditing(true);
    setMessage(`${group.games.length}개 게임이 같은 매핑을 공유합니다. (이름은 대표 게임 ${group.games[0]} 기준)`);
  }

  function setSlotCode(index: number, code: number) {
    setSlots((cur) => cur.map((s) => (s.index === index ? { ...s, primary: code, secondary: code } : s)));
  }

  function fillDirectionsFromReference() {
    setSlots((cur) => seedDirections(cur));
    setMessage('방향 슬롯을 표준 X/Y 축으로 설정했습니다.');
  }

  async function save() {
    if (!profileId) return;
    const codes = fromLogicalSlots(slots);
    setBusy(true);
    try {
      if (isGroup && editTargets.length) {
        const items: ControllerWriteMapsItem[] = editTargets.map((path) => ({ path, codes }));
        const r = await controllerDesktopService.writeMaps({ profileId, vid: device.vid, pid: device.pid, version: MAP_VERSION, items });
        setMessage(r.ok ? r.message : r.message);
      } else if (editTargets.length) {
        const r = await controllerDesktopService.writeMap({ profileId, path: editTargets[0], codes });
        setMessage(r.message);
      } else if (newGame) {
        const r = await controllerDesktopService.writeMap({ profileId, game: newGame, vid: device.vid, pid: device.pid, version: MAP_VERSION, codes });
        setMessage(r.ok ? `새 맵 생성: ${r.message}` : r.message);
        if (r.ok && r.path) { setEditTargets([r.path]); setNewGame(null); }
      }
      await loadMapList();
    } finally {
      setBusy(false);
    }
  }

  // Generate maps for a set of games from the role template + each game's MRA names, then batch-upload in one session.
  async function generateForGames(games: string[]) {
    if (!profileId) return;
    const index = getCachedArcadeIndex() || {};
    const scopeGames = genScope === 'mapped' ? games.filter((sn) => mapByGame.has(sn)) : games;
    const items: ControllerWriteMapsItem[] = [];
    for (const sn of scopeGames) {
      const meta = index[sn];
      if (!meta) continue;
      items.push({ game: sn, path: mapByGame.get(sn)?.path, codes: generateGameCodes(meta.names, template, codeProfile) });
    }
    if (!items.length) { setMessage('대상 게임이 없습니다.'); return; }
    setBusy(true);
    setMessage(`${items.length}개 맵을 로컬에서 생성해 한 번에 업로드하는 중...`);
    try {
      const r = await controllerDesktopService.writeMaps({ profileId, vid: device.vid, pid: device.pid, version: MAP_VERSION, items });
      setMessage(r.ok ? `완료 — ${r.message}` : r.message);
      setCodesLoaded(false); // codes are now stale; the 내 맵 묶음 view will re-read on demand
      await loadMapList();
    } finally {
      setBusy(false);
    }
  }

  // Generate maps for every catalog console core from the console role template (name-matched). Cores whose buttons the
  // template doesn't cover (e.g. PCE/Atari naming) are skipped and reported.
  async function generateConsoleForAll() {
    if (!profileId) return;
    const items: ControllerWriteMapsItem[] = [];
    const skipped: string[] = [];
    for (const core of CONSOLE_CORES) {
      if (genScope === 'mapped' && !mapByGame.has(core.slug.toLowerCase())) continue;
      const codes = generateConsoleCodes(core.slots, consoleTemplate, codeProfile);
      const hasButton = codes.some((c, i) => i >= 8 && i % 2 === 0 && c !== 0);
      if (!hasButton) { skipped.push(core.label); continue; }
      items.push({ game: core.slug, path: mapByGame.get(core.slug.toLowerCase())?.path, codes });
    }
    if (!items.length) { setMessage('생성할 콘솔 코어가 없습니다. 먼저 콘솔 역할(A/B/X/Y…)에 버튼을 지정하세요.'); return; }
    setBusy(true);
    setMessage(`콘솔 ${items.length}개 맵을 생성해 업로드하는 중...`);
    try {
      const r = await controllerDesktopService.writeMaps({ profileId, vid: device.vid, pid: device.pid, version: MAP_VERSION, items });
      setMessage(`${r.ok ? '완료' : '오류'} — ${r.message}${skipped.length ? ` · 역할 미커버로 건너뜀: ${skipped.join(', ')}` : ''}`);
      await loadMapList();
    } finally {
      setBusy(false);
    }
  }

  async function loadTransferTargets() {
    if (!profileId) return;
    setTransferBusy(true);
    setTransferMsg('연결된 다른 패드를 확인하는 중...');
    try {
      const r = await controllerDesktopService.listConnectedDevices(profileId);
      const others = (r.ok ? r.devices : []).filter((d) => !(d.vid === device.vid && d.pid === device.pid));
      setTransferTargets(others);
      if (others.length && !others.some((d) => `${d.vid}_${d.pid}` === transferTargetKey)) setTransferTargetKey(`${others[0].vid}_${others[0].pid}`);
      setTransferMsg(r.ok ? `대상 후보 ${others.length}개.` : r.message);
    } finally {
      setTransferBusy(false);
    }
  }

  async function runTransfer(dryRun: boolean) {
    if (!profileId) return;
    const target = transferTargets.find((d) => `${d.vid}_${d.pid}` === transferTargetKey);
    if (!target) { setTransferMsg('대상 패드를 먼저 선택하세요.'); return; }
    if (!dryRun && !window.confirm(`${device.name} → ${target.name}\n이 패드의 ${transferScope === 'console' ? '콘솔' : '전체'} 맵을 대상 패드로 코드 변환 복사합니다.\n기존 대상 파일은 덮어쓰기 전에 자동 백업됩니다. 계속할까요?`)) return;
    const onlyGames = transferScope === 'console' ? CONSOLE_CORES.map((c) => c.slug) : undefined;
    setTransferBusy(true);
    setTransferResult(undefined);
    setTransferMsg(dryRun ? '변환표 학습 + 미리보기 중...' : '변환 복사를 적용하는 중... (대상이 많으면 시간이 걸립니다)');
    try {
      const r = await controllerDesktopService.autoMap({
        profileId,
        source: { vid: device.vid, pid: device.pid, version: sourceVersion },
        target: { vid: target.vid, pid: target.pid },
        onlyGames,
        dryRun,
        confirmed: !dryRun,
      });
      setTransferResult(r);
      setTransferMsg(r.message);
      if (!dryRun && r.ok) await loadMapList();
    } finally {
      setTransferBusy(false);
    }
  }

  const directionSlots = slots.filter((s) => s.index < DIRECTION_SLOTS.length);
  const buttonSlots = slots.filter((s) => s.index >= DIRECTION_SLOTS.length && (showEmpty || s.primary !== 0));
  const templateReady = template.actions.some((a) => a != null) || template.start != null || template.coin != null;
  const totalGames = useMemo(() => countGroups.reduce((n, g) => n + g.games.length, 0), [countGroups]);

  if (!reference) {
    return <p className="muted">먼저 이 컨트롤러의 레퍼런스(레버 + 버튼)를 캡처·저장하세요. 그래야 배정할 버튼이 생깁니다.</p>;
  }

  const roleSelect = (role: string, value: number | undefined) => (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', background: armedRole === role ? '#fef08a' : undefined, padding: '1px 3px', borderRadius: 4 }}>
      <select value={value ?? ''} onChange={(e) => setTemplate((t) => updateRole(t, role, e.target.value === '' ? undefined : Number(e.target.value)))}>
        <option value="">비움</option>
        {refButtons.map((b) => <option key={b.fn} value={b.evdevCode ?? 0}>{b.label}</option>)}
      </select>
      <button className="button small" type="button" onClick={() => setArmedRole(armedRole === role ? null : role)}>{armedRole === role ? '…' : '누름'}</button>
    </span>
  );

  const slotEditor = (
    <div>
      <div className="button-row">
        <strong>{editTitle}</strong>
        <button className="button small" type="button" onClick={() => { setEditing(false); setSlots([]); setArmedSlot(null); }}>← 뒤로</button>
        <button className="button small" type="button" onClick={fillDirectionsFromReference}>방향 자동 채우기</button>
        <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} /> 빈 슬롯도 보기
        </label>
        <button className="button compact" type="button" onClick={() => void save()} disabled={busy}><Save size={14} /> {isGroup ? `묶음 ${editTargets.length}개 저장` : '저장'}</button>
      </div>
      <p className="muted">슬롯의 “배정”을 누른 뒤 컨트롤러에서 원하는 버튼을 누르면 들어갑니다(모니터 켜져 있을 때). 드롭다운도 가능.</p>
      <div className="two-column">
        <div>
          <strong>방향 (슬롯 0–3)</strong>
          <div className="table-list compact">
            {directionSlots.map((s) => {
              const dir = DIRECTION_SLOTS.find((d) => d.slot === s.index);
              return <div className="table-row" key={s.index}><span>{dir?.label}</span><span>{classifyCode(s.primary).label}</span></div>;
            })}
          </div>
        </div>
        <div>
          <strong>버튼 슬롯</strong>
          <div className="table-list compact" style={{ maxHeight: 360, overflowY: 'auto' }}>
            <div className="table-row header"><span>기능</span><span>배정</span><span></span></div>
            {buttonSlots.map((s) => {
              const current = refButtonByCode.get(s.primary);
              const armed = armedSlot === s.index;
              return (
                <div className="table-row" key={s.index} style={{ background: armed ? '#fef08a' : undefined }}>
                  <span title={`슬롯 #${s.index}`}>{slotLabels[s.index] ?? `버튼 ${s.index - 3}`}</span>
                  <span>
                    <select value={s.primary} onChange={(e) => setSlotCode(s.index, Number(e.target.value))}>
                      <option value={0}>비움</option>
                      {refButtons.map((b) => <option key={b.fn} value={b.evdevCode ?? 0}>{b.label}</option>)}
                      {s.primary !== 0 && !current && <option value={s.primary}>현재값 0x{s.primary.toString(16)}</option>}
                    </select>
                  </span>
                  <span><button className="button small" type="button" onClick={() => setArmedSlot(armed ? null : s.index)}>{armed ? '누르세요…' : '배정'}</button></span>
                </div>
              );
            })}
            {buttonSlots.length === 0 && <p className="muted">{showEmpty ? '슬롯이 없습니다.' : '사용 중인 버튼 슬롯이 없습니다. ‘빈 슬롯도 보기’로 추가하세요.'}</p>}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <div className="button-row">
        <button className="button compact" type="button" onClick={() => { setView('games'); setEditing(false); if (!listLoaded) void loadMapList(); }} disabled={busy} aria-pressed={view === 'games'}><RefreshCw size={14} /> 전체 게임</button>
        <button className="button compact" type="button" onClick={() => { setView('auto'); setEditing(false); if (!listLoaded) void loadMapList(); }} disabled={busy} aria-pressed={view === 'auto'}>역할 템플릿·자동 생성</button>
        <button className="button compact" type="button" onClick={() => { setView('codes'); setEditing(false); if (!codesLoaded) void loadAllMaps(); }} disabled={busy} aria-pressed={view === 'codes'}>내 맵 묶음</button>
        <button className="button compact" type="button" onClick={() => { setView('console'); setEditing(false); if (!listLoaded) void loadMapList(); }} disabled={busy} aria-pressed={view === 'console'}>콘솔</button>
        <button className="button compact" type="button" onClick={() => { setView('transfer'); setEditing(false); if (!listLoaded) void loadMapList(); if (!transferTargets.length) void loadTransferTargets(); }} disabled={busy} aria-pressed={view === 'transfer'}>다른 패드로 복사</button>
        <button className="button compact" type="button" onClick={() => void buildIndex()} disabled={busy} title="모든 MRA에서 풀네임·버튼 이름·버튼 수를 한 번 인덱싱(캐시됨)">{indexCount ? `아케이드 인덱스 ✓ ${indexCount}` : '아케이드 인덱스 만들기'}</button>
        <button className="button compact" type="button" onClick={() => void calibrateCodes()} disabled={busy} title="이 컨트롤러의 기존 동작 맵에서 실제 버튼/방향 코드를 학습해 생성에 적용합니다(게임패드·HAT 패드 필수)">{codeProfile ? `코드 보정 ✓ 0x${codeProfile.buttonBase.toString(16)}` : '코드 보정'}</button>
        {busy && <span className="muted">처리 중…</span>}
        {livePressLabel && <span style={{ padding: '2px 8px', background: '#dcfce7', borderRadius: 6 }}>지금 누름: <strong>{livePressLabel}</strong></span>}
      </div>

      {editing && slotEditor}

      {!editing && view === 'games' && (
        <>
          <div className="button-row">
            <input placeholder="게임/코어 검색 (전체에서)" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 280 }} />
            <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={onlyMapped} onChange={(e) => setOnlyMapped(e.target.checked)} /> 내 맵만
            </label>
            <span className="muted">표시 {filteredGames.length} / 전체 {gameRows.length} · 내 맵 {mapList.length}</span>
          </div>
          <div className="table-list compact" style={{ maxHeight: 460, overflowY: 'auto' }}>
            {filteredGames.map((r) => (
              <div className="table-row" key={r.setname}>
                <span>{r.mapped ? '✓ ' : ''}<strong>{r.display}</strong></span>
                <span className="muted" style={{ fontSize: '0.85em' }}>{r.count != null ? `${r.count}버튼` : ''}{r.names ? ` · ${r.names.filter((n) => n !== '-').slice(0, 5).join(', ')}` : ' (이름 없음)'}</span>
                <span><button className="button small" type="button" onClick={() => void openGame(r)}>{r.mapped ? '편집' : '새 맵'}</button></span>
              </div>
            ))}
            {!listLoaded && <p className="muted">‘전체 게임’을 눌러 불러오세요.</p>}
            {listLoaded && filteredGames.length === 0 && <p className="muted">검색 결과가 없습니다.</p>}
          </div>
        </>
      )}

      {!editing && view === 'auto' && (
        <>
          <p className="muted">한 번만 역할을 정하면, 게임마다 버튼 이름을 읽어 <strong>올바른 슬롯에 자동 배치</strong>합니다. 액션 버튼은 게임이 쓰는 만큼만 순서대로 들어갑니다.</p>
          {!indexCount && <p className="muted">먼저 ‘아케이드 인덱스 만들기’를 누르세요.</p>}
          {codeProfile
            ? <p className="muted">코드 보정됨 — 버튼 0x{codeProfile.buttonBase.toString(16)} · 방향 {(codeProfile.directions.right & 0xff00) === 0x0200 ? 'HAT' : (codeProfile.directions.right & 0xff00) === 0x0300 ? '아날로그' : '기타'}. 생성 코드가 이 컨트롤러에 맞춰집니다.</p>
            : <p className="callout warning" style={{ padding: '8px 12px' }}>⚠ 게임패드/HAT 컨트롤러는 먼저 위의 <strong>‘코드 보정’</strong>을 누르세요. 안 하면 앱에선 채워 보여도 MiSTer에서 맵이 비어 보일 수 있습니다.</p>}
          <div className="table-list compact">
            <div className="table-row header"><span>역할</span><span>배정 버튼</span></div>
            {Array.from({ length: ACTION_ROLE_COUNT }).map((_, i) => (
              <div className="table-row" key={`a${i}`}><span>액션 {i + 1}</span><span>{roleSelect(`a${i}`, template.actions[i])}</span></div>
            ))}
            <div className="table-row"><span>Start</span><span>{roleSelect('start', template.start)}</span></div>
            <div className="table-row"><span>Coin</span><span>{roleSelect('coin', template.coin)}</span></div>
          </div>

          <div className="button-row" style={{ marginTop: 8 }}>
            <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>적용 범위:
              <select value={genScope} onChange={(e) => setGenScope(e.target.value as 'all' | 'mapped')}>
                <option value="all">전체(없으면 생성)</option>
                <option value="mapped">내 맵만(기존 수정)</option>
              </select>
            </label>
            <button className="button compact" type="button" disabled={busy || !templateReady} onClick={() => void generateForGames(countGroups.flatMap((g) => g.games))}><Wand2 size={14} /> 전체 자동 생성 ({totalGames}개)</button>
          </div>

          <strong>버튼 수별 그룹 (줄 클릭 → 게임 목록)</strong>
          <div className="table-list compact" style={{ maxHeight: 360, overflowY: 'auto' }}>
            {countGroups.map((g) => (
              <div key={g.count}>
                <div className="table-row" style={{ cursor: 'pointer' }} onClick={() => setExpandedCount(expandedCount === g.count ? null : g.count)}>
                  <span>{expandedCount === g.count ? '▾' : '▸'} <strong>{g.count}버튼</strong></span>
                  <span className="muted">{g.games.length}게임 · 내 맵 {g.mapped}</span>
                  <span><button className="button small" type="button" disabled={busy || !templateReady} onClick={(e) => { e.stopPropagation(); void generateForGames(g.games); }}>이 버튼수 생성</button></span>
                </div>
                {expandedCount === g.count && (
                  <div style={{ padding: '4px 12px', fontSize: '0.82em', color: '#64748b', maxHeight: 160, overflowY: 'auto' }}>
                    {g.games.slice(0, 500).join(', ')}{g.games.length > 500 ? ` … 외 ${g.games.length - 500}개` : ''}
                  </div>
                )}
              </div>
            ))}
            {countGroups.length === 0 && <p className="muted">인덱스를 만들면 버튼 수별 그룹이 표시됩니다.</p>}
          </div>
        </>
      )}

      {!editing && view === 'codes' && (
        <>
          <div className="button-row">
            <span className="muted">{codeGroups.length}개 묶음 · {allMaps.length}개 맵</span>
            정렬:
            <select value={groupSort} onChange={(e) => setGroupSort(e.target.value as 'size' | 'name')}>
              <option value="size">크기</option>
              <option value="name">이름</option>
            </select>
          </div>
          <div className="table-list compact" style={{ maxHeight: 460, overflowY: 'auto' }}>
            {codeGroups.map((g) => {
              const used = toLogicalSlots(g.codes).filter((s) => s.index >= DIRECTION_SLOTS.length && s.primary !== 0);
              const summary = used.map((s) => `#${s.index}=${refButtonByCode.get(s.primary)?.label ?? '0x' + s.primary.toString(16)}`).join(', ');
              return (
                <div className="table-row" key={g.sig} style={{ alignItems: 'flex-start' }}>
                  <span><strong>{g.games.length}개</strong> · {used.length}버튼<br /><span className="muted" style={{ fontSize: '0.8em' }}>{g.games.slice(0, 6).join(', ')}{g.games.length > 6 ? ` 외 ${g.games.length - 6}` : ''}</span></span>
                  <span className="muted" style={{ fontSize: '0.85em' }}>{summary || '버튼 없음'}</span>
                  <span><button className="button small" type="button" onClick={() => openCodeGroup(g)}>그룹 편집</button></span>
                </div>
              );
            })}
            {codeGroups.length === 0 && <p className="muted">{codesLoaded ? '맵이 없습니다.' : '‘내 맵 묶음’을 눌러 불러오세요(코드를 모두 읽어 시간이 걸릴 수 있음).'}</p>}
          </div>
        </>
      )}

      {!editing && view === 'transfer' && (
        <>
          <p className="muted">이 패드(<strong>{device.name}</strong> {device.vid}:{device.pid})의 맵을 <strong>다른 패드로 코드 변환 복사</strong>합니다. 먼저 <strong>대상 패드로 공통 코어 1~2개</strong>(예: MegaDrive)를 ‘콘솔’ 탭에서 <strong>소스와 같은 물리 버튼 배치로</strong> 직접 매핑해야 변환표를 학습합니다. 방향(레버)과 학습된 버튼만 채워지고 못 배운 버튼은 비워둡니다. 기존 대상 파일은 덮어쓰기 전 자동 백업됩니다.</p>
          <div className="button-row">
            <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>대상 패드:
              <select value={transferTargetKey} onChange={(e) => setTransferTargetKey(e.target.value)}>
                {transferTargets.length === 0 && <option value="">연결된 다른 패드 없음</option>}
                {transferTargets.map((d) => <option key={`${d.vid}_${d.pid}`} value={`${d.vid}_${d.pid}`}>{d.name} ({d.vid}:{d.pid})</option>)}
              </select>
            </label>
            <button className="button small" type="button" onClick={() => void loadTransferTargets()} disabled={transferBusy}>새로고침</button>
            <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>범위:
              <select value={transferScope} onChange={(e) => setTransferScope(e.target.value as 'console' | 'all')}>
                <option value="console">콘솔만</option>
                <option value="all">전체(아케이드 포함)</option>
              </select>
            </label>
            <button className="button compact" type="button" disabled={transferBusy || !transferTargetKey} onClick={() => void runTransfer(true)}>미리보기</button>
            <button className="button compact" type="button" disabled={transferBusy || !transferTargetKey} onClick={() => void runTransfer(false)}>적용</button>
            {transferBusy && <span className="muted">처리 중…</span>}
          </div>
          {transferScope === 'all' && <p className="muted">⚠ 전체 범위는 이 패드가 가진 모든 코어를 복사하므로 수백~수천 개면 오래 걸립니다.</p>}
          {transferResult && (
            <div className="table-list compact">
              <div className="table-row"><span>캘리브레이션(공통) 코어</span><span>{transferResult.sharedCores?.length ?? 0}개</span></div>
              <div className="table-row"><span>학습한 버튼코드</span><span>{transferResult.distinctSourceCodes ?? 0}종</span></div>
              <div className="table-row"><span>{transferResult.dryRun ? '생성 예정 코어' : '생성 / 덮어쓰기'}</span><span>{transferResult.dryRun ? `${transferResult.coresToGenerate ?? 0}개` : `${transferResult.created ?? 0} / ${transferResult.overwritten ?? 0} (백업 ${transferResult.backedUp ?? 0})`}</span></div>
              {!transferResult.dryRun && <div className="table-row"><span>일부만 채움 / 미커버 코드</span><span>{transferResult.partial ?? 0}개 / {transferResult.uncoveredCodeCount ?? 0}종</span></div>}
            </div>
          )}
          {transferMsg && <p className="muted">{transferMsg}</p>}
        </>
      )}

      {!editing && view === 'console' && (
        <>
          <p className="muted">콘솔은 버튼 구성이 고정돼 있어, 아래 <strong>콘솔 역할 템플릿</strong>에 물리 버튼을 한 번만 지정하고 <strong>‘콘솔 전체 자동 생성’</strong>을 누르면 모든 콘솔 코어가 이름 매칭으로 한 번에 생성됩니다. 개별 코어는 아래 목록에서 ‘편집/새 맵’으로 수동 조정도 가능합니다.</p>
          <details open style={{ margin: '6px 0' }}>
            <summary style={{ cursor: 'pointer' }}><strong>콘솔 역할 템플릿</strong> — 콘솔 버튼 → 물리 버튼 ({CONSOLE_ROLES.filter((r) => consoleTemplate[r] != null).length}/{CONSOLE_ROLES.length} 지정)</summary>
            <div className="table-list compact" style={{ maxHeight: 240, overflowY: 'auto', marginTop: 4 }}>
              <div className="table-row header"><span>콘솔 버튼</span><span>물리 버튼</span></div>
              {CONSOLE_ROLES.map((role) => (
                <div className="table-row" key={role}>
                  <span>{role}</span>
                  <span>
                    <select value={consoleTemplate[role] ?? ''} onChange={(e) => setConsoleTemplate((t) => ({ ...t, [role]: e.target.value === '' ? undefined : Number(e.target.value) }))}>
                      <option value="">비움</option>
                      {refButtons.map((b) => <option key={b.fn} value={b.evdevCode ?? 0}>{b.label}</option>)}
                    </select>
                  </span>
                </div>
              ))}
            </div>
          </details>
          <div className="button-row">
            <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>적용 범위:
              <select value={genScope} onChange={(e) => setGenScope(e.target.value as 'all' | 'mapped')}>
                <option value="all">전체(없으면 생성)</option>
                <option value="mapped">내 맵만(기존 수정)</option>
              </select>
            </label>
            <button className="button compact" type="button" disabled={busy || !consoleTemplateReady} onClick={() => void generateConsoleForAll()}><Wand2 size={14} /> 콘솔 전체 자동 생성</button>
            {!consoleTemplateReady && <span className="muted">먼저 콘솔 버튼에 물리 버튼을 지정하세요.</span>}
          </div>
          <div className="button-row">
            <span className="muted">코어 {consoleRows.length}개 · 내 맵 {consoleMappedCount}</span>
            {!listLoaded && <span className="muted">‘콘솔’을 다시 누르거나 목록을 불러오면 ✓ 표시가 갱신됩니다.</span>}
          </div>
          <div className="table-list compact" style={{ maxHeight: 460, overflowY: 'auto' }}>
            {consoleRows.map((r) => (
              <div className="table-row" key={r.setname}>
                <span>{r.mapped ? '✓ ' : ''}<strong>{r.display}</strong> <span className="muted" style={{ fontSize: '0.8em' }}>{r.setname}</span></span>
                <span className="muted" style={{ fontSize: '0.85em' }}>{r.names?.join(', ')}</span>
                <span><button className="button small" type="button" onClick={() => void openGame(r)}>{r.mapped ? '편집' : '새 맵'}</button></span>
              </div>
            ))}
          </div>
        </>
      )}

      {message && <p className="muted">{message}</p>}
    </div>
  );
}

function updateRole(t: RoleTemplate, role: string, code: number | undefined): RoleTemplate {
  if (role === 'start') return { ...t, start: code };
  if (role === 'coin') return { ...t, coin: code };
  const i = Number(role.slice(1));
  const actions = t.actions.slice();
  actions[i] = code;
  return { ...t, actions };
}

function roleLabel(role: string): string {
  if (role === 'start') return 'Start';
  if (role === 'coin') return 'Coin';
  return `액션 ${Number(role.slice(1)) + 1}`;
}
