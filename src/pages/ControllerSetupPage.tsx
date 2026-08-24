import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Save, Square } from 'lucide-react';
import { PageHeader } from '../components/cards/PageHeader';
import { SectionCard } from '../components/cards/SectionCard';
import { StatusBadge } from '../components/status/StatusBadge';
import { CoreMapEditor } from '../components/controllers/CoreMapEditor';
import { JoystickCaptureMap } from '../components/controllers/JoystickCaptureMap';
import { useActiveMisterProfile } from '../services/mister/activeProfile';
import { SafeMisterProfileStore } from '../services/mister/profileStore';
import { misterDisplayName } from '../services/mister/misterName';
import { controllerDesktopService } from '../services/controllers/controllerDesktopService';
import {
  BUTTON_POSITIONS,
  DIRECTION_FUNCTIONS,
  assignButtonToPosition,
  buildXInputReference,
  buttonEntryKey,
  describeReferenceEntry,
  isXInputDevice,
  loadControllerReference,
  saveControllerReference,
  splitReference,
  xinputDirections,
  type XInputLever,
} from '../services/controllers/controllerReference';
import { learnProfileFromBaseMap, saveCodeProfile } from '../services/controllers/controllerCodeProfile';
import type { MisterDeviceProfile } from '../types/mister';
import type { ControllerConnectedDevice, ControllerInputEvent, ControllerReferenceEntry } from '../types/controllers';

const targetKey = 'hello-mister-v2:controller-target-profile';

const dirArrow: Record<string, string> = {
  N: '↑', S: '↓', W: '←', E: '→', NE: '↗', NW: '↖', SE: '↘', SW: '↙', center: '·',
};

function axisArrow(label: string | undefined, dir: number): string {
  if (dir === 0) return '·';
  const isY = /Y\b|Ry/.test(label || '');
  if (isY) return dir < 0 ? '↑' : '↓';
  return dir < 0 ? '←' : '→';
}

function monitorPathOf(device: ControllerConnectedDevice): { path?: string; kind: string } {
  if (device.hidrawPath) return { path: device.hidrawPath, kind: 'HID' };
  if (device.jsPath) return { path: device.jsPath, kind: 'joydev' };
  if (device.eventPath) return { path: device.eventPath, kind: 'evdev' };
  return { path: undefined, kind: '없음' };
}

type CapturePhase = 'idle' | 'directions' | 'buttons';
type CaptureMode = 'graphic' | 'text';

interface SeenButton { key: string; label: string; codeHex: string; evdevCode?: number; pressed: boolean; count: number; }
interface SeenDir { key: string; label: string; codeHex: string; dir: string; value: number; }

const DIR_IDS = new Set(['up', 'down', 'left', 'right']);
// Order armed slots advance through during graphic "연속 캡처": lever directions, then the 8 buttons, then Start/Coin.
const CAPTURE_ORDER = ['up', 'down', 'left', 'right', ...BUTTON_POSITIONS.map((p) => p.id)];

function positionLabel(id: string): string {
  const dir = DIRECTION_FUNCTIONS.find((d) => d.fn === id);
  if (dir) return dir.label;
  return BUTTON_POSITIONS.find((b) => b.id === id)?.label ?? id;
}

export function ControllerSetupPage() {
  const [defaultActive] = useActiveMisterProfile();
  const profileStore = useMemo(() => new SafeMisterProfileStore(), []);
  const [savedProfiles, setSavedProfiles] = useState<MisterDeviceProfile[]>([]);
  const [selectedTargetProfileId, setSelectedTargetProfileId] = useState<string | undefined>(() => {
    try { return window.localStorage.getItem(targetKey) ?? undefined; } catch { return undefined; }
  });

  const [devices, setDevices] = useState<ControllerConnectedDevice[]>([]);
  const [monitorDevice, setMonitorDevice] = useState<ControllerConnectedDevice>();
  const [monitorActive, setMonitorActive] = useState(false);
  const [message, setMessage] = useState('연결된 컨트롤러를 확인하고, 한 대를 골라 라이브 입력을 모니터링하세요.');
  const [buttons, setButtons] = useState<Record<string, SeenButton>>({});
  const [dirs, setDirs] = useState<Record<string, SeenDir>>({});
  const [lastButton, setLastButton] = useState<{ evdevCode: number; label: string; seq: number }>();
  const [referenceVersion, setReferenceVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const monitorIdRef = useRef<string>();

  // Reference capture (step 2): 4 lever directions + every physical button (free capture, count auto-detected).
  const [directions, setDirections] = useState<Record<string, ControllerReferenceEntry>>({});
  const [capturedButtons, setCapturedButtons] = useState<ControllerReferenceEntry[]>([]);
  const [phase, setPhase] = useState<CapturePhase>('idle');
  const [dirIndex, setDirIndex] = useState(0);
  const [refMessage, setRefMessage] = useState('');
  const phaseRef = useRef<CapturePhase>('idle');
  const dirIndexRef = useRef(0);
  const capturedButtonsRef = useRef<ControllerReferenceEntry[]>([]);
  const directionsRef = useRef<Record<string, ControllerReferenceEntry>>({});

  // Graphic capture (step 2 alt): click a shape to arm it, press the input to assign. Shares directions/capturedButtons.
  const [captureMode, setCaptureMode] = useState<CaptureMode>('graphic');
  const [armedTarget, setArmedTarget] = useState<string | null>(null);
  const armedTargetRef = useRef<string | null>(null);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const autoAdvanceRef = useRef(true);

  const targetProfile = useMemo(
    () => savedProfiles.find((p) => p.id === selectedTargetProfileId)
      ?? savedProfiles.find((p) => p.id === defaultActive?.profileId)
      ?? savedProfiles[0],
    [savedProfiles, selectedTargetProfileId, defaultActive?.profileId],
  );
  const profileId = targetProfile?.id ?? defaultActive?.profileId;

  useEffect(() => { void profileStore.loadProfiles().then(setSavedProfiles).catch(() => undefined); }, [profileStore]);

  const setPhaseBoth = useCallback((p: CapturePhase) => { phaseRef.current = p; setPhase(p); }, []);
  const setArmedBoth = useCallback((id: string | null) => { armedTargetRef.current = id; setArmedTarget(id); }, []);
  // Mirror directions into a ref, computed synchronously, so auto-advance reads accurate filled state in the same event.
  const setDirectionsBoth = useCallback(
    (updater: Record<string, ControllerReferenceEntry> | ((cur: Record<string, ControllerReferenceEntry>) => Record<string, ControllerReferenceEntry>)) => {
      const next = typeof updater === 'function' ? updater(directionsRef.current) : updater;
      directionsRef.current = next;
      setDirections(next);
    },
    [],
  );
  useEffect(() => { autoAdvanceRef.current = autoAdvance; }, [autoAdvance]);

  const isFilled = useCallback((id: string) => {
    if (DIR_IDS.has(id)) return Boolean(directionsRef.current[id]);
    return capturedButtonsRef.current.some((b) => b.pos === id);
  }, []);

  // After a graphic capture, arm the next empty slot in order (if 연속 캡처 on), else disarm.
  const advanceArmed = useCallback((current: string) => {
    if (!autoAdvanceRef.current) { setArmedBoth(null); return; }
    const start = CAPTURE_ORDER.indexOf(current);
    for (let i = 1; i <= CAPTURE_ORDER.length; i += 1) {
      const id = CAPTURE_ORDER[(start + i) % CAPTURE_ORDER.length];
      if (!isFilled(id)) { setArmedBoth(id); return; }
    }
    setArmedBoth(null);
  }, [isFilled, setArmedBoth]);

  // Route a qualifying press into the active capture phase.
  const captureFromEvent = useCallback((payload: ControllerInputEvent) => {
    // Graphic mode: a single armed slot consumes the next matching input.
    const armed = armedTargetRef.current;
    if (armed) {
      if (DIR_IDS.has(armed)) {
        const qualifies = (payload.kind === 'axis' && Number(payload.dir) !== 0) || (payload.kind === 'hat' && payload.dir !== 'center' && payload.dir !== undefined);
        if (!qualifies) return;
        const fnDef = DIRECTION_FUNCTIONS.find((d) => d.fn === armed);
        if (!fnDef) return;
        const entry: ControllerReferenceEntry = { fn: fnDef.fn, label: fnDef.label, kind: payload.kind as 'axis' | 'hat', usage: payload.code, evdevCode: payload.evdevCode, dir: payload.dir, raw: payload.codeHex };
        setDirectionsBoth((cur) => ({ ...cur, [fnDef.fn]: entry }));
        setRefMessage(`${fnDef.label} 기록됨.`);
      } else {
        if (payload.kind !== 'button' || !payload.pressed) return;
        const entry: ControllerReferenceEntry = { fn: `b${payload.code}`, label: `버튼 ${payload.code}`, kind: 'button', usage: payload.code, evdevCode: payload.evdevCode, raw: payload.codeHex, pos: armed };
        const next = assignButtonToPosition(capturedButtonsRef.current, entry, armed);
        capturedButtonsRef.current = next;
        setCapturedButtons(next);
        setRefMessage(`${positionLabel(armed)} ← 버튼 ${payload.code} 기록됨.`);
      }
      advanceArmed(armed);
      return;
    }
    if (phaseRef.current === 'directions') {
      const qualifies = (payload.kind === 'axis' && Number(payload.dir) !== 0) || (payload.kind === 'hat' && payload.dir !== 'center' && payload.dir !== undefined);
      if (!qualifies) return;
      const target = DIRECTION_FUNCTIONS[dirIndexRef.current];
      if (!target) return;
      const entry: ControllerReferenceEntry = { fn: target.fn, label: target.label, kind: payload.kind as 'axis' | 'hat', usage: payload.code, evdevCode: payload.evdevCode, dir: payload.dir, raw: payload.codeHex };
      setDirectionsBoth((cur) => ({ ...cur, [target.fn]: entry }));
      const next = dirIndexRef.current + 1;
      dirIndexRef.current = next;
      setDirIndex(next);
      if (next >= DIRECTION_FUNCTIONS.length) { setPhaseBoth('buttons'); setRefMessage('이제 컨트롤러의 모든 버튼을 하나씩 누르세요. 새 버튼이 자동으로 추가됩니다. 다 누르면 ‘버튼 캡처 완료’.'); }
      else setRefMessage(`${target.label} 기록됨 — 다음: ${DIRECTION_FUNCTIONS[next].label}`);
    } else if (phaseRef.current === 'buttons') {
      if (payload.kind !== 'button' || !payload.pressed) return;
      const entry: ControllerReferenceEntry = { fn: '', label: '', kind: 'button', usage: payload.code, evdevCode: payload.evdevCode, raw: payload.codeHex };
      const key = buttonEntryKey(entry);
      if (capturedButtonsRef.current.some((b) => buttonEntryKey(b) === key)) { setRefMessage('이미 캡처된 버튼입니다.'); return; }
      const finalEntry = { ...entry, fn: `b${payload.code}`, label: `버튼 ${payload.code}` };
      const next = [...capturedButtonsRef.current, finalEntry];
      capturedButtonsRef.current = next;
      setCapturedButtons(next);
      setRefMessage(`${finalEntry.label} 추가됨 (총 ${next.length}개).`);
    }
  }, [setPhaseBoth, setDirectionsBoth, advanceArmed]);

  // Subscribe to live input events once; filter by the active monitor id.
  useEffect(() => {
    const off = controllerDesktopService.onInputEvent((payload) => {
      if (payload.monitorId !== monitorIdRef.current) return;
      if (payload.kind === 'closed') { setMonitorActive(false); setMessage('입력 모니터가 종료되었습니다.'); return; }
      if (payload.kind === 'button') {
        const key = payload.codeHex || `btn${payload.code}`;
        setButtons((cur) => {
          const prev = cur[key];
          return { ...cur, [key]: { key, label: payload.label || key, codeHex: key, evdevCode: payload.evdevCode, pressed: Boolean(payload.pressed), count: (prev?.count || 0) + (payload.pressed ? 1 : 0) } };
        });
        if (payload.pressed && payload.evdevCode != null) {
          setLastButton((prev) => ({ evdevCode: payload.evdevCode!, label: payload.label || `0x${payload.evdevCode!.toString(16)}`, seq: (prev?.seq || 0) + 1 }));
        }
      } else if (payload.kind === 'hat' || payload.kind === 'axis') {
        const key = payload.codeHex || `${payload.kind}${payload.code}`;
        const dirText = payload.kind === 'hat'
          ? (dirArrow[String(payload.dir ?? 'center')] || String(payload.dir ?? '·'))
          : axisArrow(payload.label, Number(payload.dir ?? 0));
        setDirs((cur) => ({ ...cur, [key]: { key, label: payload.label || key, codeHex: key, dir: dirText, value: Number(payload.value ?? 0) } }));
      }
      if (phaseRef.current !== 'idle' || armedTargetRef.current) captureFromEvent(payload);
    });
    return () => { off(); };
  }, [captureFromEvent]);

  // Stop the monitor when leaving the page.
  useEffect(() => () => { if (monitorIdRef.current) void controllerDesktopService.stopInputMonitor(monitorIdRef.current); }, []);

  const loadDevices = useCallback(async () => {
    if (!profileId) { setMessage('먼저 대상 MiSTer를 선택하세요.'); return; }
    setBusy(true);
    setMessage('연결된 컨트롤러를 확인하는 중...');
    try {
      const result = await controllerDesktopService.listConnectedDevices(profileId);
      setDevices(result.ok ? result.devices : []);
      setMessage(result.message);
    } finally {
      setBusy(false);
    }
  }, [profileId]);

  async function startMonitor(device: ControllerConnectedDevice) {
    if (!profileId) return;
    const { path, kind } = monitorPathOf(device);
    if (!path) { setMessage('이 컨트롤러의 입력 장치 경로를 찾지 못했습니다.'); return; }
    if (monitorIdRef.current) await controllerDesktopService.stopInputMonitor(monitorIdRef.current);
    const monitorId = `mon-${device.vid}-${device.pid}-${Math.floor(performance.now())}`;
    monitorIdRef.current = monitorId;
    setMonitorDevice(device);
    setButtons({});
    setDirs({});
    // Load any existing reference for this controller.
    const existing = loadControllerReference(device.vid, device.pid);
    const split = splitReference(existing);
    setDirectionsBoth(split.directions);
    setCapturedButtons(split.buttons);
    capturedButtonsRef.current = split.buttons;
    setPhaseBoth('idle'); setArmedBoth(null); setDirIndex(0); dirIndexRef.current = 0;
    setRefMessage(existing ? `저장된 레퍼런스를 불러왔습니다 (버튼 ${split.buttons.length}개).` : '');
    setMonitorActive(true);
    setMessage(`${device.name} 입력을 모니터링합니다 (${kind}). 버튼과 레버를 눌러보세요.`);
    const result = await controllerDesktopService.startInputMonitor(profileId, path, monitorId);
    if (!result.ok) { setMonitorActive(false); setMessage(result.message || '입력 모니터 시작에 실패했습니다.'); }
  }

  async function stopMonitor() {
    if (monitorIdRef.current) await controllerDesktopService.stopInputMonitor(monitorIdRef.current);
    monitorIdRef.current = undefined;
    setMonitorActive(false);
    setPhaseBoth('idle');
    setArmedBoth(null);
    setMessage('입력 모니터를 멈췄습니다.');
  }

  function startDirectionCapture() {
    if (!monitorActive) { setRefMessage('먼저 입력 모니터를 시작하세요.'); return; }
    setArmedBoth(null);
    setDirectionsBoth({});
    dirIndexRef.current = 0; setDirIndex(0);
    setPhaseBoth('directions');
    setRefMessage(`레버를 ${DIRECTION_FUNCTIONS[0].label} 방향으로 미세요.`);
  }

  function startButtonCapture() {
    if (!monitorActive) return;
    setArmedBoth(null);
    setCapturedButtons([]); capturedButtonsRef.current = [];
    setPhaseBoth('buttons');
    setRefMessage('컨트롤러의 모든 버튼을 하나씩 누르세요. 새 버튼이 자동으로 추가됩니다.');
  }

  function removeButton(index: number) {
    const next = capturedButtonsRef.current.filter((_, i) => i !== index);
    capturedButtonsRef.current = next;
    setCapturedButtons(next);
  }

  // Graphic capture: click a shape to arm/disarm it.
  function armSlot(id: string) {
    if (!monitorActive) { setRefMessage('먼저 입력 모니터를 시작하세요.'); return; }
    setPhaseBoth('idle'); // graphic and text-sequential capture are mutually exclusive
    const next = armedTargetRef.current === id ? null : id;
    setArmedBoth(next);
    setRefMessage(next ? `${positionLabel(next)} 무장 — 컨트롤러에서 해당 입력을 누르세요.` : '무장 해제.');
  }

  function clearSlot(id: string) {
    if (DIR_IDS.has(id)) {
      setDirectionsBoth((cur) => { const n = { ...cur }; delete n[id]; return n; });
    } else {
      const next = capturedButtonsRef.current.filter((b) => b.pos !== id);
      capturedButtonsRef.current = next;
      setCapturedButtons(next);
    }
    if (armedTargetRef.current === id) setArmedBoth(null);
  }

  // XInput controllers can't be live-captured (no raw HID). Load the built-in standard reference, and take the REAL
  // direction codes from MiSTer's own base/menu map when present (ground truth for the user's lever); fall back to the
  // d-pad encoding otherwise.
  async function loadXInputReference() {
    if (!monitorDevice) return;
    const base = await learnProfileFromBaseMap(profileId, monitorDevice.vid, monitorDevice.pid);
    const directions = base?.directions ?? xinputDirections('dpad');
    const lever: XInputLever = (directions.right & 0xff) >> 1 >= 16 ? 'dpad' : (directions.right & 0xff00) === 0x0200 ? 'dpad' : 'stick';
    const ref = buildXInputReference(monitorDevice.vid, monitorDevice.pid, monitorDevice.name, lever);
    saveControllerReference(ref);
    saveCodeProfile(monitorDevice.vid, monitorDevice.pid, { buttonBase: base?.buttonBase ?? 0x130, directions });
    const split = splitReference(ref);
    setDirectionsBoth(split.directions);
    setCapturedButtons(split.buttons);
    capturedButtonsRef.current = split.buttons;
    setArmedBoth(null);
    setReferenceVersion((v) => v + 1);
    setRefMessage(`XInput 표준 레퍼런스를 불러왔습니다${base ? ' (방향=MiSTer 기본 맵에서 자동 감지)' : ' (방향=D-패드 기본값)'}. 3단계에서 ‘전체 자동 생성’ 다시 실행 후 테스트하세요.`);
  }

  function saveReference() {
    if (!monitorDevice) return;
    const dirEntries = DIRECTION_FUNCTIONS.map((d) => directions[d.fn]).filter(Boolean) as ControllerReferenceEntry[];
    const entries = [...dirEntries, ...capturedButtons];
    if (!entries.length) { setRefMessage('저장할 항목이 없습니다.'); return; }
    saveControllerReference({ vid: monitorDevice.vid, pid: monitorDevice.pid, name: monitorDevice.name, updatedAt: new Date().toISOString(), entries });
    setReferenceVersion((v) => v + 1); // tell the map editor to re-read the saved reference
    setRefMessage(`${monitorDevice.name} 레퍼런스 저장됨 — 방향 ${dirEntries.length}, 버튼 ${capturedButtons.length}.`);
  }

  const buttonList = Object.values(buttons);
  const dirList = Object.values(dirs);
  const dirCapturedCount = DIRECTION_FUNCTIONS.filter((d) => directions[d.fn]).length;

  return (
    <>
      <PageHeader
        eyebrow="컨트롤러 매핑"
        title="라이브 입력 + 레퍼런스 캡처"
        description="MiSTer가 evdev를 독점(grab)하므로 원시 HID(/dev/hidraw)로 컨트롤러 입력을 실시간으로 읽습니다. 레버 4방향과 모든 버튼을 캡처해 컨트롤러 레퍼런스를 만듭니다. A/B/Start/Coin 같은 역할은 3단계에서 코어별로 지정합니다."
      />

      <SectionCard title="대상 MiSTer / 연결된 컨트롤러">
        <div className="ini-target-bar ini-target-summary">
          <div className="ini-target-identity">
            <span>대상 MiSTer</span>
            {savedProfiles.length > 1 ? (
              <select className="ini-target-select" value={profileId ?? ''} onChange={(e) => { setSelectedTargetProfileId(e.target.value); try { window.localStorage.setItem(targetKey, e.target.value); } catch { /* ignore */ } setDevices([]); }}>
                {savedProfiles.map((p) => <option key={p.id} value={p.id}>{misterDisplayName(p)}</option>)}
              </select>
            ) : (
              <strong>{targetProfile ? misterDisplayName(targetProfile) : (defaultActive ? misterDisplayName(defaultActive) : '-')}</strong>
            )}
          </div>
          <div className="inline-actions">
            <button className="button compact" type="button" onClick={() => void loadDevices()} disabled={busy}><RefreshCw size={14} /> 연결된 컨트롤러 확인</button>
          </div>
        </div>
        <div className="table-list compact">
          {devices.map((device, index) => {
            const { path, kind } = monitorPathOf(device);
            const active = monitorActive && (monitorDevice?.hidrawPath ? monitorDevice.hidrawPath === device.hidrawPath : monitorDevice?.basePhys === device.basePhys);
            const dupName = devices.filter((d) => d.name === device.name).length > 1;
            const port = device.basePhys ? device.basePhys.split('-').pop() : undefined;
            return (
              <div className="table-row" key={device.hidrawPath || device.phys || `${device.vid}_${device.pid}_${index}`}>
                <span><strong>{device.name}</strong>{dupName && port ? <span className="muted"> · 포트 {port}</span> : ''}</span>
                <span>{device.vid}:{device.pid}</span>
                <span>{kind}{path ? ` · ${path}` : ''}</span>
                <span>
                  <button className="button small" type="button" disabled={!path || active} onClick={() => void startMonitor(device)}>
                    {active ? '모니터 중' : '입력 모니터'}
                  </button>
                </span>
              </div>
            );
          })}
          {devices.length === 0 && <p className="muted">연결된 컨트롤러가 없습니다. ‘연결된 컨트롤러 확인’을 누르세요.</p>}
        </div>
        <p className="muted">{message}</p>
      </SectionCard>

      {monitorActive && (
        <SectionCard title="레퍼런스 캡처 (레버 + 모든 버튼)" tone={(phase !== 'idle' || armedTarget) ? 'warning' : 'default'} collapsible defaultCollapsed={false}>
          <div className="button-row">
            <StatusBadge label={`방향 ${dirCapturedCount}/4 · 버튼 ${capturedButtons.length}개`} tone={dirCapturedCount === 4 ? 'safe' : 'neutral'} />
            <span style={{ display: 'inline-flex', gap: 4, border: '1px solid #cbd5e1', borderRadius: 8, padding: 2 }}>
              <button className="button compact" type="button" aria-pressed={captureMode === 'graphic'} style={captureMode === 'graphic' ? { background: '#dbeafe', borderColor: '#3b82f6' } : undefined} onClick={() => { setCaptureMode('graphic'); setPhaseBoth('idle'); }}>그래픽</button>
              <button className="button compact" type="button" aria-pressed={captureMode === 'text'} style={captureMode === 'text' ? { background: '#dbeafe', borderColor: '#3b82f6' } : undefined} onClick={() => { setCaptureMode('text'); setArmedBoth(null); }}>텍스트</button>
            </span>
            {captureMode === 'graphic' && (
              <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={autoAdvance} onChange={(e) => setAutoAdvance(e.target.checked)} /> 연속 캡처
              </label>
            )}
            {captureMode === 'text' && <button className="button compact" type="button" onClick={startDirectionCapture}>① 레버 방향 캡처</button>}
            {captureMode === 'text' && <button className="button compact" type="button" onClick={startButtonCapture}>② 모든 버튼 캡처</button>}
            {captureMode === 'text' && phase === 'buttons' && <button className="button compact" type="button" onClick={() => { setPhaseBoth('idle'); setRefMessage(`버튼 캡처 완료 — 총 ${capturedButtonsRef.current.length}개.`); }}>버튼 캡처 완료</button>}
            {(phase !== 'idle' || armedTarget) && <button className="button compact danger" type="button" onClick={() => { setPhaseBoth('idle'); setArmedBoth(null); setRefMessage('캡처를 중단했습니다.'); }}>중단</button>}
            <button className="button compact" type="button" onClick={saveReference} disabled={!dirCapturedCount && !capturedButtons.length}><Save size={14} /> 저장</button>
          </div>

          {monitorDevice && isXInputDevice(monitorDevice.vid, monitorDevice.name) && (
            <div className="callout warning" style={{ padding: '8px 12px', margin: '8px 0' }}>
              XInput(Xbox)은 벤더 전용(xpad)이라 <strong>라이브 캡처가 안 됩니다.</strong> 표준 레퍼런스를 불러오세요 — 방향(레버)은 <strong>MiSTer 기본 맵</strong>에서 실제 코드를 자동으로 가져옵니다.
              <div className="button-row" style={{ marginTop: 6 }}>
                <button className="button compact" type="button" onClick={() => void loadXInputReference()}>XInput 표준 레퍼런스 불러오기</button>
              </div>
            </div>
          )}

          {captureMode === 'graphic' ? (
            <>
              <p className="muted">도형을 클릭해 칸을 무장한 뒤 컨트롤러에서 해당 입력을 누르세요.{autoAdvance ? ' 누르면 다음 빈 칸으로 자동 이동합니다.' : ''} 채워진 칸은 ×로 지웁니다.</p>
              <JoystickCaptureMap directions={directions} buttons={capturedButtons} armed={armedTarget} onArm={armSlot} onClear={clearSlot} />
              {refMessage && <p className="muted">{refMessage}</p>}
            </>
          ) : (
            <>
              {phase === 'directions' && (
                <div style={{ padding: '12px 16px', margin: '8px 0', background: '#fef9c3', borderRadius: 8 }}>
                  레버를 <strong style={{ fontSize: '1.3em' }}>{DIRECTION_FUNCTIONS[dirIndex]?.label}</strong> 방향으로 미세요.
                </div>
              )}
              {phase === 'buttons' && (
                <div style={{ padding: '12px 16px', margin: '8px 0', background: '#fef9c3', borderRadius: 8 }}>
                  <strong>모든 버튼을 하나씩</strong> 누르세요. 누를 때마다 아래에 추가됩니다. 다 누르면 <strong>‘버튼 캡처 완료’</strong>.
                </div>
              )}
              {refMessage && <p className="muted">{refMessage}</p>}

              <div className="two-column">
                <div>
                  <strong>레버 방향 ({dirCapturedCount}/4)</strong>
                  <div className="table-list compact">
                    {DIRECTION_FUNCTIONS.map((d) => {
                      const e = directions[d.fn];
                      return (
                        <div className="table-row" key={d.fn}>
                          <span>{d.label}</span>
                          <span>{e ? describeReferenceEntry(e) : <span className="muted">미배정</span>}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <strong>캡처된 버튼 ({capturedButtons.length})</strong>
                  <div className="table-list compact">
                    <div className="table-row header"><span>버튼</span><span>evdev</span><span></span></div>
                    {capturedButtons.map((b, i) => (
                      <div className="table-row" key={b.fn}>
                        <span>{b.label}</span>
                        <span>{b.evdevCode != null ? `0x${b.evdevCode.toString(16)}` : `#${b.usage}`}</span>
                        <span><button className="button small" type="button" onClick={() => removeButton(i)}>삭제</button></span>
                      </div>
                    ))}
                    {capturedButtons.length === 0 && <p className="muted">‘② 모든 버튼 캡처’ 후 버튼을 누르세요.</p>}
                  </div>
                </div>
              </div>
            </>
          )}
        </SectionCard>
      )}

      {monitorDevice && (
        <SectionCard title="코어별 맵 편집 (3단계)">
          <p className="muted">레퍼런스로 코어별 `.map`을 수정합니다. 코어를 골라 각 버튼 슬롯에 레퍼런스 버튼을 배정하고 저장하면, 기존 파일은 자동 백업됩니다. 어떤 슬롯이 A/B/Start/Coin인지는 게임에 맞게 직접 지정하세요.</p>
          <CoreMapEditor profileId={profileId} device={monitorDevice} lastButton={lastButton} referenceVersion={referenceVersion} />
        </SectionCard>
      )}

      {(monitorActive || buttonList.length > 0 || dirList.length > 0) && (
        <SectionCard title="라이브 입력 (참고)" collapsible defaultCollapsed>
          <div className="button-row">
            <StatusBadge label={monitorActive ? `모니터링 중 · ${monitorDevice?.name || ''}` : '정지'} tone={monitorActive ? 'safe' : 'neutral'} />
            {monitorActive && <button className="button compact danger" type="button" onClick={() => void stopMonitor()}><Square size={14} /> 멈추기</button>}
          </div>
          <div className="two-column">
            <div>
              <strong>감지된 버튼 ({buttonList.length})</strong>
              <div className="table-list compact">
                <div className="table-row header"><span>버튼</span><span>evdev(추정)</span><span>상태</span><span>횟수</span></div>
                {buttonList.map((b) => (
                  <div className="table-row" key={b.key} style={{ background: b.pressed ? '#dcfce7' : undefined }}>
                    <span>{b.label}</span>
                    <span>{b.evdevCode != null ? `0x${b.evdevCode.toString(16)}` : '-'}</span>
                    <span>{b.pressed ? '눌림' : '뗌'}</span>
                    <span>{b.count}</span>
                  </div>
                ))}
                {buttonList.length === 0 && <p className="muted">버튼을 누르면 여기에 표시됩니다.</p>}
              </div>
            </div>
            <div>
              <strong>레버 / 방향 ({dirList.length})</strong>
              <div className="table-list compact">
                <div className="table-row header"><span>입력</span><span>방향</span><span>값</span></div>
                {dirList.map((d) => (
                  <div className="table-row" key={d.key} style={{ background: d.dir !== '·' ? '#dcfce7' : undefined }}>
                    <span>{d.label}</span>
                    <span style={{ fontSize: '1.2em' }}>{d.dir}</span>
                    <span>{d.value}</span>
                  </div>
                ))}
                {dirList.length === 0 && <p className="muted">레버/스틱을 움직이면 여기에 표시됩니다.</p>}
              </div>
            </div>
          </div>
        </SectionCard>
      )}
    </>
  );
}
