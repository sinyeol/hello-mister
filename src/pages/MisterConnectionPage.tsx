import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Edit3, KeyRound, RefreshCw, Save, Search, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/cards/PageHeader';
import { SectionCard } from '../components/cards/SectionCard';
import { defaultDiscoveryOptions, DesktopMisterDiscoveryService } from '../services/mister/discovery';
import { createActiveMisterProfile, clearActiveMisterProfile, getActiveMisterProfile, setActiveMisterProfile } from '../services/mister/activeProfile';
import { deviceHardwareKey, isUsableSdCid, sameDevice, serialSuffix } from '../services/mister/fingerprint';
import { loadZaparooLibraryStateFromIndexedDb } from '@sticker-v1/services/zaparoo/zaparooLibrary';
import { formatFingerprintSummary, getRemoteErrorGuide, MisterRemoteReadService } from '../services/mister/remote';
import { SafeMisterProfileStore } from '../services/mister/profileStore';
import { createProfileSummaryFromFingerprint, MisterProfileSummaryStore } from '../services/mister/profileSummary';
import { createTaskId, taskQueue } from '../services/tasks/taskQueue';
import { isAdvancedMode, useAppViewMode } from '../services/app/viewMode';
import type { MisterDeviceProfile, MisterDiscoveryCandidate, MisterDiscoveryReport, MisterProfileSummary, MisterRemoteFingerprint, SshHostKeyCheckResult, SshSessionState } from '../types/mister';

const defaultUsername = 'root';
const defaultMisterPassword = '1';

function profileIdForIp(ipAddress: string) {
  return `profile-${ipAddress.trim().replace(/[^0-9a-z.-]/gi, '-')}`;
}

// 표시 이름 = 호스트네임 우선. 기본값('MiSTer')뿐이면 기존 별칭을 fallback으로 써서 이전 이름을 잃지 않는다.
function displayName(profile: Pick<MisterDeviceProfile, 'alias' | 'ipAddress' | 'hostname'>) {
  const host = profile.hostname?.trim();
  return (host && host !== 'MiSTer' ? host : (profile.alias?.trim() || host || 'MiSTer'));
}

function hasPath(fingerprint: MisterRemoteFingerprint | undefined, path: string) {
  return fingerprint?.pathStatuses.some((item) => item.path === path && item.exists) ?? false;
}

export function MisterConnectionPage() {
  const [appMode] = useAppViewMode();
  const developerMode = isAdvancedMode(appMode);
  const [profiles, setProfiles] = useState<MisterDeviceProfile[]>([]);
  const [summaries, setSummaries] = useState<MisterProfileSummary[]>([]);
  const [editingProfileId, setEditingProfileId] = useState<string>();
  const [ipAddress, setIpAddress] = useState('');
  const [hostnameDraft, setHostnameDraft] = useState('');
  const [username, setUsername] = useState(defaultUsername);
  const [passwordDraft, setPasswordDraft] = useState(defaultMisterPassword);
  const [message, setMessage] = useState('');
  const [connectingProfileId, setConnectingProfileId] = useState<string>();
  // 새 MiSTer 추가/수정 폼(details)을 제어해 "수정"을 누르면 자동으로 펼쳐지게 한다.
  const [editorOpen, setEditorOpen] = useState(false);
  const editorRef = useRef<HTMLDetailsElement>(null);
  // 카드에는 구분에 필요한 정보만: IP · SD CID · 라이브러리 게임수. 게임수는 미스터 라이브러리에서 디바이스별로 센다.
  const [gameCounts, setGameCounts] = useState<Record<string, number>>({});
  // 같은 SD 카드(CID)가 다른 프로필/IP로 중복 저장됐을 때(카드를 옮긴 경우) 통합을 제안한다.
  const [consolidate, setConsolidate] = useState<{ twin: MisterDeviceProfile; current: MisterDeviceProfile }>();
  // Live reachability per profile (TCP probe), polled periodically so the row color reflects the CURRENT state.
  const [liveReachable, setLiveReachable] = useState<Record<string, boolean>>({});
  // Whether the backend currently holds an SSH session (cached credentials = connected at least once) for the profile.
  const [sessionActive, setSessionActive] = useState<Record<string, boolean>>({});
  const [hostKeyChecks, setHostKeyChecks] = useState<Record<string, SshHostKeyCheckResult>>({});
  const [pendingTrust, setPendingTrust] = useState<{ profile: MisterDeviceProfile; hostKey: SshHostKeyCheckResult; password?: string }>();
  const [deleteTarget, setDeleteTarget] = useState<MisterDeviceProfile>();
  const [deleteKnownHost, setDeleteKnownHost] = useState(false);
  const [discoveryReport, setDiscoveryReport] = useState<MisterDiscoveryReport>();
  const [candidates, setCandidates] = useState<MisterDiscoveryCandidate[]>([]);
  const [discoveryVisible, setDiscoveryVisible] = useState(false);

  const profileStore = useMemo(() => new SafeMisterProfileStore(), []);
  const summaryStore = useMemo(() => new MisterProfileSummaryStore(), []);
  const remoteService = useMemo(() => new MisterRemoteReadService(), []);
  const discoveryService = useMemo(() => new DesktopMisterDiscoveryService(), []);

  const refreshProfiles = useCallback(async () => {
    const [loadedProfiles, loadedSummaries] = await Promise.all([profileStore.loadProfiles(), summaryStore.loadSummaries()]);
    setProfiles(loadedProfiles);
    setSummaries(loadedSummaries);
  }, [profileStore, summaryStore]);

  useEffect(() => {
    void refreshProfiles();
  }, [refreshProfiles]);

  // 미스터 라이브러리에서 디바이스별 게임수를 센다. 디바이스는 SD CID(카드 고유번호)로 매칭한다(CID는 카드마다 유일).
  useEffect(() => {
    let cancelled = false;
    const hexKey = (value?: string) => (value || '').toLowerCase().replace(/[^0-9a-f]/g, '');
    void loadZaparooLibraryStateFromIndexedDb().then((state) => {
      if (cancelled) return;
      const counts: Record<string, number> = {};
      for (const profile of profiles) {
        const cid = hexKey(profile.sdCid);
        if (!cid) continue; // CID가 없으면(미연결) 게임수를 표시하지 않는다.
        const libProfile = state.profiles.find((candidate) => hexKey(candidate.sdCid) === cid);
        if (!libProfile) { counts[profile.id] = 0; continue; }
        counts[profile.id] = state.entries.filter((entry) => entry.sourceDevices.includes(libProfile.deviceId)).length;
      }
      setGameCounts(counts);
    }).catch(() => { /* 라이브러리 없음 */ });
    return () => { cancelled = true; };
  }, [profiles]);

  useEffect(() => {
    const api = window.helloMisterDesktop;
    if (!api?.probeMisterReachable || profiles.length === 0) {
      setLiveReachable({});
      setSessionActive({});
      return;
    }
    let cancelled = false;
    const check = async () => {
      let sessions: SshSessionState[] = [];
      try { sessions = (await api.listSshSessions?.()) ?? []; } catch { sessions = []; }
      const hasSession = (profile: MisterDeviceProfile) => sessions.some((session) =>
        session.sessionId === profile.id
        || (session.host === profile.ipAddress && Number(session.port) === Number(profile.port || 22)));
      const results = await Promise.all(profiles.map(async (profile) => {
        const probe = await api.probeMisterReachable!(profile.ipAddress, profile.port || 22, 2500).catch(() => ({ open: false }));
        return [profile.id, Boolean(probe?.open), hasSession(profile)] as const;
      }));
      if (!cancelled) {
        setLiveReachable(Object.fromEntries(results.map(([id, reachable]) => [id, reachable])));
        setSessionActive(Object.fromEntries(results.map(([id, , session]) => [id, session])));
      }
    };
    void check();
    const interval = window.setInterval(() => void check(), 10000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [profiles]);

  const profileSummary = (profile: MisterDeviceProfile) => summaries.find((summary) => summary.profileId === profile.id);

  function resetForm() {
    setEditingProfileId(undefined);
    setIpAddress('');
    setHostnameDraft('');
    setUsername(defaultUsername);
    setPasswordDraft(defaultMisterPassword);
  }

  function editProfile(profile: MisterDeviceProfile) {
    setEditingProfileId(profile.id);
    setIpAddress(profile.ipAddress);
    // 호스트네임 칸에 현재 이름을 채운다: 커스텀 호스트네임 우선, 없으면 기존 별칭을 옮겨 저장 시 마이그레이션.
    setHostnameDraft(profile.hostname && profile.hostname !== 'MiSTer' ? profile.hostname : (profile.alias || ''));
    setUsername(profile.username || defaultUsername);
    setPasswordDraft('');
    setMessage('수정할 값을 입력한 뒤 저장하세요. 비밀번호 칸을 비워 두면 기존 암호화 비밀번호를 유지합니다.');
    // 수정 폼(하단 details)을 자동으로 펼치고 화면에 보이도록 스크롤한다.
    setEditorOpen(true);
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }

  const connectProfile = useCallback(async (profile: MisterDeviceProfile, options: { trustNewHostKey?: boolean; password?: string } = {}) => {
    const profileId = profile.id;
    const port = Number(profile.port || 22);
    const passwordOverride = options.password?.trim() || undefined;
    const useStoredOrDefaultPassword = !passwordOverride && (profile.passwordSaved || profile.passwordMode === 'savedSafeStorage' || profile.passwordMode === 'defaultMisterPassword');

    setConnectingProfileId(profileId);
    const taskId = createTaskId('mister-direct-connect');
    taskQueue.enqueue({
      id: taskId,
      title: 'MiSTer 연결',
      description: `${profile.username || defaultUsername}@${profile.ipAddress}:${port}`,
      category: 'network',
      riskLevel: '안전',
      dryRun: false,
      readOnly: true,
      status: '진행 중',
      targetProfileId: profileId,
      targetAlias: profile.alias,
      targetHost: profile.ipAddress,
      logs: [{ at: new Date().toISOString(), message: '사용자가 연결 버튼을 눌러 MiSTer 연결 확인을 시작했습니다. 원격 쓰기 기능은 호출하지 않습니다.' }],
    });

    try {
      const hostKey = await remoteService.inspectHostKey({ host: profile.ipAddress, port, profileId, alias: profile.alias });
      setHostKeyChecks((current) => ({ ...current, [profileId]: hostKey }));

      if (hostKey.status === 'mismatch') {
        clearActiveMisterProfile(profileId);
        const nextSummary = createProfileSummaryFromFingerprint({
          profile,
          hostKeyTrustStatus: 'mismatch',
          errorCode: 'HOST_KEY_MISMATCH',
          errorMessage: hostKey.message,
        });
        await summaryStore.saveSummary(nextSummary);
        await refreshProfiles();
        setMessage('이 IP의 장치 신뢰 키가 바뀌어 연결을 차단했습니다. 고급 모드의 내부 진단에서 상세를 확인하세요.');
        taskQueue.updateStatus(taskId, '실패', hostKey.message, { errorCode: 'HOST_KEY_MISMATCH', sanitizedErrorMessage: hostKey.message });
        return;
      }

      if (hostKey.status === 'new' && !options.trustNewHostKey) {
        setPendingTrust({ profile, hostKey, password: passwordOverride });
        setMessage('새 MiSTer 장치 신뢰 키를 등록해야 합니다. 실제 IP가 맞는지 확인한 뒤 등록하세요.');
        taskQueue.updateStatus(taskId, '실패', '새 SSH 장치 신뢰 키 확인이 필요합니다.', { errorCode: 'HOST_KEY_UNTRUSTED', sanitizedErrorMessage: '새 SSH 장치 신뢰 키 확인이 필요합니다.' });
        return;
      }

      const trustedHostKey = hostKey.status === 'new'
        ? await remoteService.trustHostKey({ host: profile.ipAddress, port, fingerprint: hostKey.fingerprint || '', keyType: hostKey.keyType || 'unknown', profileId, alias: profile.alias })
        : hostKey;
      setHostKeyChecks((current) => ({ ...current, [profileId]: trustedHostKey }));

      const fingerprint = useStoredOrDefaultPassword
        ? await remoteService.fingerprintSavedProfile(profileId)
        : await remoteService.fingerprint({
          profileId,
          host: profile.ipAddress,
          port,
          username: profile.username || defaultUsername,
          password: passwordOverride || defaultMisterPassword,
        });

      const now = new Date().toISOString();
      const summaryText = formatFingerprintSummary(fingerprint);
      const nextProfile: MisterDeviceProfile = {
        ...profile,
        // 사용자가 직접 넣은 호스트네임(기본값 'MiSTer'가 아닌 값)은 연결해도 덮어쓰지 않는다.
        // 기본값이거나 비어 있으면 기기에서 읽은 실제 호스트네임으로 채운다.
        hostname: (profile.hostname && profile.hostname !== 'MiSTer') ? profile.hostname : (fingerprint.hostname || profile.hostname),
        macAddress: fingerprint.macAddress || profile.macAddress,
        sdCid: fingerprint.sdCid || profile.sdCid,
        status: fingerprint.ok ? 'MiSTer 확인됨' : '실패',
        lastSeenAt: fingerprint.ok ? now : profile.lastSeenAt,
        lastConnectedAt: fingerprint.ok ? now : profile.lastConnectedAt,
        lastFailedAt: fingerprint.ok ? profile.lastFailedAt : now,
        lastErrorCode: fingerprint.error?.code,
        hostKeyStatus: trustedHostKey.status,
        readOnlySummary: summaryText,
        fingerprint: {
          mediaFatExists: hasPath(fingerprint, '/media/fat'),
          gamesPathExists: hasPath(fingerprint, '/media/fat/games'),
          scriptsPathExists: hasPath(fingerprint, '/media/fat/Scripts'),
          misterIniExists: hasPath(fingerprint, '/media/fat/MiSTer.ini'),
          hostname: fingerprint.hostname,
          macAddress: fingerprint.macAddress,
          sdCid: fingerprint.sdCid,
          checkedAt: now,
        },
      };

      // IP reuse guard: identify the device by its hardware key (SD CID first, then a usable MAC). If this
      // IP's saved profile has a hardware key and the live device reports a DIFFERENT one, it is a different
      // physical MiSTer at the same (DHCP-reused) IP — do not silently keep the old alias. Cloned-SD devices
      // share the SSH host key and the stock MAC, so the SD CID is the reliable tell.
      const savedDevice = { sdCid: profile.sdCid, macAddress: profile.macAddress };
      const liveDevice = { sdCid: fingerprint.sdCid, macAddress: fingerprint.macAddress };
      const identityWarning = fingerprint.ok
        && Boolean(deviceHardwareKey(savedDevice))
        && Boolean(deviceHardwareKey(liveDevice))
        && !sameDevice(savedDevice, liveDevice)
        ? `이 IP(${profile.ipAddress})의 장치가 저장된 '${profile.hostname || profile.alias || 'MiSTer'}'와(과) 다른 미스터로 보입니다(SD 카드 식별자 불일치). IP가 재사용되었을 수 있으니 호스트네임을 확인/변경하세요.`
        : undefined;

      // SD CID로 같은 카드 매칭: 방금 읽은 카드가 "다른" 저장 프로필과 같은 SD 카드면, 같은 카드가 다른 IP/프로필로
      // 중복 저장된 것이다(카드를 다른 보드로 옮겼거나 새 IP로 다시 추가). 자동 삭제 대신 통합을 제안한다.
      const cidTwin = fingerprint.ok && isUsableSdCid(fingerprint.sdCid)
        ? profiles.find((candidate) => candidate.id !== profile.id
          && isUsableSdCid(candidate.sdCid)
          && sameDevice({ sdCid: candidate.sdCid }, { sdCid: fingerprint.sdCid }))
        : undefined;
      setConsolidate(cidTwin ? { twin: cidTwin, current: nextProfile } : undefined);

      if (fingerprint.ok) {
        setActiveMisterProfile(createActiveMisterProfile({ ...nextProfile, hostKeyStatus: trustedHostKey.status }, fingerprint, summaryText, identityWarning));
        // 다음 폴링 전에도 즉시 "연결됨"으로 보이도록 낙관적 반영(폴링이 곧 재확인).
        setSessionActive((current) => ({ ...current, [profileId]: true }));
        setLiveReachable((current) => ({ ...current, [profileId]: true }));
      } else {
        clearActiveMisterProfile(profileId);
      }

      setProfiles(await profileStore.saveProfile(nextProfile));
      await summaryStore.saveSummary(createProfileSummaryFromFingerprint({
        profile: nextProfile,
        fingerprint,
        hostKeyTrustStatus: trustedHostKey.status,
        errorCode: fingerprint.error?.code,
        errorMessage: fingerprint.error?.message,
      }));
      setSummaries(await summaryStore.loadSummaries());
      setMessage(fingerprint.ok
        ? (identityWarning ? `⚠ ${identityWarning}` : 'MiSTer 연결됨. 다른 MiSTer 기능에서도 이 연결 정보를 사용합니다.')
        : fingerprint.message);
      taskQueue.updateStatus(taskId, fingerprint.ok ? '완료' : '실패', fingerprint.error ? `${fingerprint.error.code}: ${fingerprint.error.message}` : summaryText, {
        errorCode: fingerprint.error?.code,
        sanitizedErrorMessage: fingerprint.error?.message,
      });
    } catch (error) {
      clearActiveMisterProfile(profileId);
      const text = error instanceof Error ? error.message : String(error);
      setMessage(`MiSTer 연결 실패: ${text}`);
      taskQueue.updateStatus(taskId, '실패', text);
    } finally {
      setConnectingProfileId(undefined);
    }
  }, [profileStore, refreshProfiles, remoteService, summaryStore, profiles]);

  async function saveDirectProfile() {
    const ip = ipAddress.trim();
    if (!ip) {
      setMessage('MiSTer IP를 먼저 입력하세요.');
      return;
    }

    const id = editingProfileId || profileIdForIp(ip);
    const existing = profiles.find((profile) => profile.id === id);
    const passwordToSave = passwordDraft.trim();
    const shouldSavePassword = Boolean(passwordToSave);
    const passwordStatus = shouldSavePassword ? await profileStore.saveProfilePassword(id, passwordToSave) : await profileStore.getProfilePasswordStatus(id);
    const passwordSaved = passwordStatus.saved || Boolean(existing?.passwordSaved);
    const storageStatus = passwordStatus.saved ? 'stored' : passwordStatus.storageAvailable ? (passwordSaved ? 'stored' : 'missing') : 'unavailable';

    const profile: MisterDeviceProfile = {
      ...existing,
      id,
      alias: existing?.alias,
      hostname: hostnameDraft.trim() || existing?.hostname || 'MiSTer',
      ipAddress: ip,
      methods: ['ssh', 'sftp'],
      status: existing?.status || '저장됨',
      lastSeenAt: existing?.lastSeenAt || new Date().toISOString(),
      defaultDevice: existing?.defaultDevice || existing?.isDefault || profiles.length === 0,
      isDefault: existing?.defaultDevice || existing?.isDefault || profiles.length === 0,
      port: existing?.port || 22,
      username: username.trim() || defaultUsername,
      passwordMode: passwordSaved ? 'savedSafeStorage' : 'defaultMisterPassword',
      passwordSaved,
      passwordStorageStatus: storageStatus,
      autoConnect: false,
    };
    const savedProfiles = await profileStore.saveProfile(profile);
    setProfiles(savedProfiles);
    setMessage(passwordStatus.saved
      ? 'MiSTer 프로필을 저장했습니다. 비밀번호는 Electron safeStorage로 암호화해 저장했습니다. 연결은 사용자가 버튼을 눌렀을 때만 확인합니다.'
      : `MiSTer 프로필을 저장했습니다. ${passwordStatus.message} 연결은 사용자가 버튼을 눌렀을 때만 확인합니다.`);
    setEditingProfileId(undefined);
    setPasswordDraft(defaultMisterPassword);
  }

  async function trustPendingAndConnect() {
    if (!pendingTrust) return;
    await connectProfile(pendingTrust.profile, { trustNewHostKey: true, password: pendingTrust.password });
    setPendingTrust(undefined);
  }

  // Host key changed (e.g. user regenerated /etc/ssh keys): remove the old trusted key and trust the current one.
  async function resetTrustAndReconnect(target: MisterDeviceProfile) {
    const port = Number(target.port || 22);
    const confirmed = window.confirm(
      `${displayName(target)} (${target.ipAddress})의 SSH 호스트 키가 이전에 신뢰한 값과 다릅니다.\n\n`
      + '이 기기에서 호스트 키를 새로 만든 경우라면 정상입니다. 기존 신뢰 키를 제거하고 현재 키를 새로 신뢰한 뒤 연결합니다.\n'
      + '의도치 않은 변경이면 보안 문제(잘못된 기기/중간자)일 수 있으니 취소하세요.',
    );
    if (!confirmed) return;
    await remoteService.removeKnownHost(target.ipAddress, port);
    setHostKeyChecks((current) => {
      const next = { ...current };
      delete next[target.id];
      return next;
    });
    setMessage('기존 SSH 신뢰 키를 제거했습니다. 현재 키로 다시 연결합니다.');
    await connectProfile(target, { trustNewHostKey: true });
  }

  async function deleteProfile(target: MisterDeviceProfile, removeKnownHost: boolean) {
    setProfiles(await profileStore.deleteProfile(target.id, { removeKnownHost }));
    setSummaries(await summaryStore.clearSummary(target.id));
    clearActiveMisterProfile(target.id);
    setHostKeyChecks((current) => {
      const next = { ...current };
      delete next[target.id];
      return next;
    });
    await remoteService.clearSession(target.id);
    taskQueue.enqueue({
      id: createTaskId('mister-profile-delete'),
      title: 'MiSTer 프로필 삭제',
      description: removeKnownHost ? `${displayName(target)} 프로필과 SSH 신뢰 키를 삭제했습니다.` : `${displayName(target)} 프로필을 삭제했습니다.`,
      category: 'network',
      riskLevel: '주의',
      dryRun: false,
      readOnly: true,
      status: '완료',
      logs: [{ at: new Date().toISOString(), message: '프로필, summary cache, session memory, 암호화 비밀번호 항목을 정리했습니다. 평문 비밀번호는 기록하지 않았습니다.' }],
    });
    setDeleteTarget(undefined);
    setDeleteKnownHost(false);
    setMessage(removeKnownHost ? 'MiSTer 프로필과 SSH 신뢰 키를 삭제했습니다.' : 'MiSTer 프로필을 삭제했습니다. SSH 신뢰 키는 유지했습니다.');
  }

  async function runDiscovery() {
    setDiscoveryVisible(true);
    const interfaces = await discoveryService.listNetworkInterfaces();
    const first = interfaces.find((item) => !item.skipped && !item.virtual) || interfaces.find((item) => !item.skipped);
    const report = await discoveryService.discoverCandidates(profiles, defaultDiscoveryOptions(first?.id));
    setDiscoveryReport(report);
    setCandidates(report.candidates);
    setMessage(`자동검색 후보 ${report.candidates.length}개를 찾았습니다. 필요한 경우 IP 입력 보조 용도로만 사용하세요.`);
  }

  function selectCandidate(candidate: MisterDiscoveryCandidate) {
    setIpAddress(candidate.ipAddress);
    setHostnameDraft(candidate.hostname && candidate.hostname !== 'unknown' && candidate.hostname !== 'MiSTer' ? candidate.hostname : hostnameDraft);
    setDiscoveryVisible(false);
    setMessage('자동검색 후보의 IP를 입력 폼에 채웠습니다. 저장 또는 연결을 눌러 계속하세요.');
  }

  async function consolidateToTwin() {
    if (!consolidate) return;
    const { twin, current } = consolidate;
    // 트윈(기존 프로필: 이름/기록 유지)을 현재 연결 위치로 업데이트하고, 중복인 현재 프로필은 정리한다.
    const merged: MisterDeviceProfile = {
      ...twin,
      ipAddress: current.ipAddress,
      hostname: (current.hostname && current.hostname !== 'MiSTer') ? current.hostname : twin.hostname,
      port: current.port,
      username: current.username,
      sdCid: current.sdCid || twin.sdCid,
      macAddress: current.macAddress || twin.macAddress,
      passwordMode: current.passwordMode,
      passwordSaved: current.passwordSaved,
      passwordStorageStatus: current.passwordStorageStatus,
      status: current.status,
      lastSeenAt: current.lastSeenAt,
      lastConnectedAt: current.lastConnectedAt,
    };
    await profileStore.saveProfile(merged);
    const saved = current.id !== twin.id
      ? await profileStore.deleteProfile(current.id, {})
      : await profileStore.loadProfiles();
    setProfiles(saved);
    // 활성 프로필이 방금 정리한 중복을 가리키면 통합된 프로필로 다시 가리키게 한다(연결 세션은 그대로 유효).
    const active = getActiveMisterProfile();
    if (active && active.profileId === current.id) {
      setActiveMisterProfile({ ...active, profileId: merged.id, alias: merged.alias, hostname: merged.hostname, ipAddress: merged.ipAddress });
    }
    setConsolidate(undefined);
    setMessage(`같은 SD 카드가 '${displayName(twin)}'로 이미 저장돼 있어, IP를 ${current.ipAddress}로 업데이트하고 중복 프로필을 정리했습니다.`);
  }

  const formProfile: MisterDeviceProfile | undefined = ipAddress.trim() ? {
    id: editingProfileId || profileIdForIp(ipAddress),
    ipAddress: ipAddress.trim(),
    alias: profiles.find((profile) => profile.id === editingProfileId)?.alias,
    hostname: hostnameDraft.trim() || profiles.find((profile) => profile.id === editingProfileId)?.hostname || 'MiSTer',
    methods: ['ssh', 'sftp'],
    status: '저장됨',
    port: 22,
    username: username.trim() || defaultUsername,
    passwordMode: editingProfileId && !passwordDraft.trim() ? profiles.find((profile) => profile.id === editingProfileId)?.passwordMode || 'savedSafeStorage' : 'customSessionOnly',
    passwordSaved: Boolean(editingProfileId && profiles.find((profile) => profile.id === editingProfileId)?.passwordSaved),
    autoConnect: false,
  } : undefined;

  return (
    <>
      <PageHeader eyebrow="MiSTer 연결" title="IP로 MiSTer 연결" />

      {message && <p className="muted" style={{ marginBottom: 12 }}>{message}</p>}

      {consolidate && (
        <SectionCard title="같은 SD 카드가 다른 프로필로 저장돼 있어요" tone="warning">
          <p className="muted">
            방금 연결한 카드{isUsableSdCid(consolidate.current.sdCid) ? ` (SD ${serialSuffix(consolidate.current.sdCid)})` : ''}는 이미
            {' '}<b>{displayName(consolidate.twin)}</b>(IP {consolidate.twin.ipAddress})로 저장돼 있습니다.
            같은 SD 카드를 다른 미스터/IP({consolidate.current.ipAddress})로 옮긴 경우라면 하나로 통합하세요. 라이브러리·카드 연결은 SD 카드 기준이라 그대로 유지됩니다.
          </p>
          <div className="action-row">
            <button className="button primary" onClick={() => void consolidateToTwin()}>‘{displayName(consolidate.twin)}’(으)로 통합 · IP를 {consolidate.current.ipAddress}로</button>
            <button className="button" onClick={() => setConsolidate(undefined)}>따로 유지</button>
          </div>
        </SectionCard>
      )}

      {pendingTrust && (
        <SectionCard title="새 MiSTer 장치 신뢰 키 등록" description="처음 연결하는 IP입니다. 실제 MiSTer IP가 맞는지 확인한 뒤 등록하세요." tone="warning">
          <div className="device-grid">
            <div><span className="label">장치</span><strong>{displayName(pendingTrust.profile)}</strong></div>
            <div><span className="label">Host</span><strong>{pendingTrust.hostKey.host}:{pendingTrust.hostKey.port}</strong></div>
            <div><span className="label">Key type</span><strong>{pendingTrust.hostKey.keyType || '-'}</strong></div>
            <div><span className="label">신뢰 키 지문</span><strong>{pendingTrust.hostKey.fingerprint || '-'}</strong></div>
          </div>
          <div className="action-row">
            <button className="button primary" onClick={() => void trustPendingAndConnect()}><CheckCircle2 size={16} /> 이 MiSTer 신뢰하고 연결</button>
            <button className="button" onClick={() => setPendingTrust(undefined)}>취소</button>
          </div>
        </SectionCard>
      )}

      <SectionCard title="저장된 MiSTer">
        <div className="profile-list">
          {profiles.map((profile) => {
            const summary = profileSummary(profile);
            const errorCode = summary?.lastErrorCode || profile.lastErrorCode;
            const guide = getRemoteErrorGuide(errorCode);
            const reachable = liveReachable[profile.id] ?? false;
            // "연결됨" = 백엔드에 세션(자격)이 있으면서 현재 도달 가능해야 함. 전원만 켜진 미연결 기기는 초록이 되지 않음.
            const live = reachable && (sessionActive[profile.id] ?? false);
            const hostKeyMismatch = hostKeyChecks[profile.id]?.status === 'mismatch' || errorCode === 'HOST_KEY_MISMATCH';
            return (
              <div
                className="profile-row"
                key={profile.id}
                style={connectingProfileId === profile.id
                  ? { background: '#fef9c3', borderColor: '#facc15' }
                  : live
                    ? { background: '#dcfce7', borderColor: '#4ade80' }
                    : { background: '#f3f4f6', borderColor: '#d1d5db' }}
              >
                <div>
                  <strong>{displayName(profile)}</strong>
                  <small>{profile.ipAddress} · SD {isUsableSdCid(profile.sdCid) ? serialSuffix(profile.sdCid) : '미확인'}{gameCounts[profile.id] !== undefined ? ` · 게임 ${gameCounts[profile.id]}개` : ''}</small>
                  {errorCode && <small>오류: {errorCode} {guide ? `· ${guide.description}` : ''}</small>}
                </div>
                <div className="action-row">
                  {connectingProfileId === profile.id ? (
                    <span style={{ fontWeight: 700, color: '#b45309' }}>● 연결 중...</span>
                  ) : live ? (
                    <span style={{ fontWeight: 700, color: '#15803d' }}>● 연결됨</span>
                  ) : (
                    <span style={{ fontWeight: 700, color: '#6b7280' }}>○ 연결 끊김</span>
                  )}
                  {hostKeyMismatch && (
                    <button className="button compact" onClick={() => void resetTrustAndReconnect(profile)} disabled={connectingProfileId === profile.id}><KeyRound size={14} /> 신뢰 키 재설정</button>
                  )}
                  <button className="button compact" onClick={() => void connectProfile(profile)} disabled={connectingProfileId === profile.id}><RefreshCw size={14} /> {connectingProfileId === profile.id ? '연결 중' : '연결'}</button>
                  <button className="button compact" onClick={() => editProfile(profile)}><Edit3 size={14} /> 수정</button>
                  <button className="button compact danger" onClick={() => setDeleteTarget(profile)}><Trash2 size={14} /> 삭제</button>
                </div>
              </div>
            );
          })}
          {profiles.length === 0 && <div className="empty-state">저장된 MiSTer가 없습니다. IP를 입력하고 저장하세요.</div>}
        </div>
      </SectionCard>

      {deleteTarget && (
        <SectionCard title="저장된 MiSTer 삭제" description="프로필을 삭제해도 원격 MiSTer 파일은 변경하지 않습니다." tone="warning">
          <div className="device-grid">
            <div><span className="label">삭제 대상</span><strong>{displayName(deleteTarget)}</strong></div>
            <div><span className="label">IP</span><strong>{deleteTarget.ipAddress}:{deleteTarget.port || 22}</strong></div>
            <div><span className="label">SSH 신뢰 키</span><strong>{deleteKnownHost ? '함께 삭제' : '유지'}</strong></div>
          </div>
          <label className="inline-field">
            <input type="checkbox" checked={deleteKnownHost} onChange={(event) => setDeleteKnownHost(event.target.checked)} />
            프로필과 SSH 신뢰 키도 함께 삭제
          </label>
          <p className="muted">기본값은 프로필만 삭제입니다. 저장된 암호화 비밀번호와 세션 정보는 함께 정리합니다.</p>
          <div className="action-row">
            <button className="button danger" onClick={() => void deleteProfile(deleteTarget, deleteKnownHost)}><Trash2 size={16} /> 삭제</button>
            <button className="button" onClick={() => { setDeleteTarget(undefined); setDeleteKnownHost(false); }}>취소</button>
          </div>
        </SectionCard>
      )}

      {developerMode && (
        <SectionCard title="고급 내부 진단: 연결 상세" description="host key 이력과 자동검색 상세는 기본 흐름에서 숨깁니다." tone="dry">
          <div className="mini-list">
            {Object.entries(hostKeyChecks).map(([profileId, check]) => <div key={profileId}><strong>{profileId}</strong><span>{check.status} · {check.fingerprint || '-'}</span></div>)}
            {Object.keys(hostKeyChecks).length === 0 && <div><strong>신뢰 키 상세 없음</strong><span>연결을 실행하면 기술 정보가 표시됩니다.</span></div>}
          </div>
        </SectionCard>
      )}

      <details ref={editorRef} open={editorOpen} onToggle={(event) => setEditorOpen(event.currentTarget.open)} style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, padding: '8px 0' }}>＋ 새 MiSTer 추가 / IP 직접 입력</summary>
        <SectionCard title="MiSTer IP 입력" description="비밀번호는 Electron safeStorage가 가능한 환경에서만 암호화해 저장합니다. 프로필 JSON에는 평문 비밀번호를 쓰지 않습니다." tone="safe">
          <div className="grid two">
            <label className="field"><span>MiSTer IP</span><input value={ipAddress} onChange={(event) => setIpAddress(event.target.value)} placeholder="192.168.0.123" /></label>
            <label className="field"><span>호스트네임(표시 이름)</span><input value={hostnameDraft} onChange={(event) => setHostnameDraft(event.target.value)} placeholder="예: 거실 MiSTer" /></label>
            <label className="field"><span>사용자명</span><input value={username} onChange={(event) => setUsername(event.target.value)} /></label>
            <label className="field"><span>비밀번호</span><input type="password" value={passwordDraft} onChange={(event) => setPasswordDraft(event.target.value)} placeholder={editingProfileId ? '저장된 값 유지' : defaultMisterPassword} /></label>
          </div>
          <div className="action-row">
            <button className="button primary" onClick={() => void saveDirectProfile()}><Save size={16} /> {editingProfileId ? '수정 저장' : '저장'}</button>
            <button className="button" disabled={!formProfile || connectingProfileId === formProfile?.id} onClick={() => formProfile && void connectProfile(formProfile, { password: passwordDraft.trim() || undefined })}><KeyRound size={16} /> 연결</button>
            <button className="button secondary" onClick={() => void runDiscovery()}><Search size={16} /> 자동검색</button>
            {editingProfileId && <button className="button" onClick={resetForm}>새 입력</button>}
          </div>
          {discoveryVisible && (
            <div className="mini-list">
              {discoveryReport && <div><strong>자동검색 결과</strong><span>{discoveryReport.scannedHostCount}개 IP 확인, 후보 {candidates.length}개</span></div>}
              {candidates.map((candidate) => (
                <div key={candidate.id}>
                  <strong>{candidate.hostname || '이름 확인 안 됨'}</strong>
                  <span>
                    {candidate.ipAddress} · 포트 {candidate.openPorts.join(', ') || '없음'}
                    {candidate.hostnameSource ? ` · ${candidate.hostnameSource === 'netbios' ? 'NetBIOS' : 'DNS'}` : ''}
                  </span>
                  <button className="button compact" onClick={() => selectCandidate(candidate)}>선택</button>
                </div>
              ))}
              {discoveryReport && candidates.length === 0 && <div><strong>후보 없음</strong><span>IP를 직접 입력하세요.</span></div>}
            </div>
          )}
          <div className="danger-box">ROM 실제 복사, 원격 폴더 생성/삭제/덮어쓰기, reboot, SD 플래시, 스크립트 실행은 현재 잠겨 있습니다.</div>
        </SectionCard>
      </details>
    </>
  );
}
