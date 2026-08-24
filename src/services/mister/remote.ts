import type {
  DiagnosticPackage,
  MisterDeviceProfile,
  MisterRemoteFingerprint,
  MisterRemoteGameFolder,
  MisterRemoteIniSnapshot,
  MisterRemotePathStatus,
  MisterRemoteScriptFile,
  ReadOnlyIntegrationTestResult,
  ReadOnlyIntegrationTestStep,
  RemoteErrorCode,
  RemoteReadResult,
  SshCredentialInput,
  SshHostKeyCheckResult,
  SshKnownHostEntry,
  SshKnownHostHistoryEntry,
  SshSessionState,
} from '../../types/mister';
import type { RemoteRomFileEntry } from '../../types/rom';

export function sanitizeCredentialInput(input: SshCredentialInput): Omit<SshCredentialInput, 'password' | 'privateKey' | 'passphrase'> & {
  hasPassword: boolean;
  hasPrivateKey: boolean;
} {
  return {
    profileId: input.profileId,
    host: input.host,
    port: input.port,
    username: input.username,
    hasPassword: Boolean(input.password),
    hasPrivateKey: Boolean(input.privateKey),
  };
}

export function formatRemotePathStatus(status: MisterRemotePathStatus) {
  if (!status.exists) return `${status.label}: 없음`;
  return `${status.label}: ${status.type === 'directory' ? '폴더 있음' : status.type === 'file' ? '파일 있음' : '있음'}`;
}

export function formatFingerprintSummary(fingerprint?: MisterRemoteFingerprint) {
  if (!fingerprint) return 'fingerprint 전입니다.';
  const mediaFat = fingerprint.pathStatuses.find((item) => item.path === '/media/fat')?.exists;
  const misterIni = fingerprint.pathStatuses.find((item) => item.path === '/media/fat/MiSTer.ini')?.exists;
  return `${fingerprint.hostname || fingerprint.host} · /media/fat ${mediaFat ? '확인' : '없음'} · MiSTer.ini ${misterIni ? '확인' : '없음'} · ${fingerprint.latencyMs}ms`;
}

export function formatHostKeyStatus(result?: SshHostKeyCheckResult) {
  if (!result) return 'SSH 호스트 키 확인 전입니다.';
  if (result.status === 'trusted') return '신뢰된 장치입니다.';
  if (result.status === 'new') return '처음 보는 SSH 호스트 키입니다.';
  if (result.status === 'mismatch') return '저장된 host key와 다릅니다. 연결을 중단합니다.';
  if (result.status === 'trusted-now') return '사용자가 이 SSH 호스트 키를 신뢰했습니다.';
  if (result.status === 'removed') return '저장된 host key 신뢰를 제거했습니다.';
  return 'SSH 호스트 키 확인 전입니다.';
}

export const remoteErrorMessages: Record<RemoteErrorCode, string> = {
  NETWORK_TIMEOUT: '해당 IP에서 응답 시간이 초과되었습니다.',
  CONNECTION_REFUSED: '포트가 닫혀 있거나 서비스가 연결을 거부했습니다.',
  HOST_KEY_UNTRUSTED: '처음 보는 SSH 호스트 키입니다. fingerprint를 확인하고 신뢰해야 합니다.',
  HOST_KEY_MISMATCH: '저장된 SSH 호스트 키와 현재 키가 다릅니다.',
  AUTH_FAILED: '인증에 실패했습니다. 사용자명 또는 비밀번호를 확인하세요.',
  SSH_NEGOTIATION_FAILED: 'SSH 연결 협상에 실패했습니다.',
  SFTP_UNAVAILABLE: 'SSH는 연결되었지만 SFTP 파일 조회를 사용할 수 없습니다.',
  REMOTE_PATH_MISSING: '필수 원격 경로를 찾지 못했습니다.',
  NOT_MISTER: 'SSH 접속은 되었지만 /media/fat 구조가 확인되지 않아 MiSTer로 확정할 수 없습니다.',
  READ_PERMISSION_DENIED: '읽기 권한이 부족합니다.',
  COMMAND_BLOCKED: '안전 정책상 차단된 명령입니다.',
  UNKNOWN_REMOTE_ERROR: '연결에 실패했습니다. 기기가 꺼져 있거나 응답하지 않을 수 있습니다.',
};

export const remoteErrorGuides: Record<RemoteErrorCode, { description: string; recommendedAction: string }> = {
  NETWORK_TIMEOUT: {
    description: '기기가 꺼져 있거나 네트워크에 없습니다(응답 없음).',
    recommendedAction: '전원, 네트워크 연결, 같은 공유기/서브넷 여부를 확인하세요.',
  },
  CONNECTION_REFUSED: {
    description: '포트가 닫혀 있거나 서비스가 실행 중이 아닙니다.',
    recommendedAction: 'MiSTer에서 SSH/SFTP가 활성화되어 있는지 확인하세요.',
  },
  HOST_KEY_UNTRUSTED: {
    description: '처음 보는 SSH 호스트 키입니다.',
    recommendedAction: '장치 IP가 맞는지 확인하고 fingerprint를 신뢰하세요.',
  },
  HOST_KEY_MISMATCH: {
    description: '저장된 SSH 호스트 키와 현재 키가 다릅니다.',
    recommendedAction: '장치가 바뀌었는지 확인하고, 필요하면 기존 신뢰를 제거한 뒤 다시 등록하세요.',
  },
  AUTH_FAILED: {
    description: '인증에 실패했습니다.',
    recommendedAction: '사용자명, 비밀번호, 키 파일을 확인하세요.',
  },
  SSH_NEGOTIATION_FAILED: {
    description: 'SSH 연결 협상에 실패했습니다.',
    recommendedAction: 'SSH 서버 상태 또는 지원 알고리즘 문제를 확인하세요.',
  },
  SFTP_UNAVAILABLE: {
    description: 'SSH는 연결되었지만 SFTP 파일 조회를 사용할 수 없습니다.',
    recommendedAction: 'SFTP 서브시스템이 활성화되어 있는지 확인하세요.',
  },
  REMOTE_PATH_MISSING: {
    description: '필수 경로가 없습니다.',
    recommendedAction: '/media/fat 경로와 MiSTer 설치 상태를 확인하세요.',
  },
  NOT_MISTER: {
    description: 'SSH 접속은 되었지만 MiSTer 구조가 확인되지 않았습니다.',
    recommendedAction: '선택한 IP가 실제 MiSTer인지 확인하세요.',
  },
  READ_PERMISSION_DENIED: {
    description: '읽기 권한이 없습니다.',
    recommendedAction: '접속 계정 권한을 확인하세요.',
  },
  COMMAND_BLOCKED: {
    description: '안전 정책상 차단된 명령입니다.',
    recommendedAction: '현재 버전은 읽기 전용 작업만 허용합니다.',
  },
  UNKNOWN_REMOTE_ERROR: {
    description: '연결에 실패했습니다. 기기가 꺼져 있거나 응답하지 않을 수 있습니다.',
    recommendedAction: '전원·네트워크를 확인하고 다시 연결하세요. 계속되면 진단 패키지로 로그를 확인하세요.',
  },
};

export function getRemoteErrorGuide(code?: string) {
  return code && code in remoteErrorGuides ? remoteErrorGuides[code as RemoteErrorCode] : undefined;
}

function createMockFingerprint(host: string): MisterRemoteFingerprint {
  return {
    ok: true,
    sessionId: `mock-${host}`,
    host,
    ipAddress: host,
    hostname: 'MiSTer',
    macAddress: '02:00:00:00:12:34',
    checkedAt: new Date().toISOString(),
    latencyMs: 4,
    pathStatuses: [
      { path: '/media/fat', label: 'media/fat', exists: true, type: 'directory' },
      { path: '/media/fat/games', label: 'games', exists: true, type: 'directory' },
      { path: '/media/fat/Scripts', label: 'Scripts', exists: true, type: 'directory' },
      { path: '/media/fat/MiSTer.ini', label: 'MiSTer.ini', exists: true, type: 'file' },
      { path: '/media/fat/downloader.ini', label: 'downloader.ini', exists: false, type: 'missing' },
      { path: '/media/fat/config', label: 'config', exists: true, type: 'directory' },
      { path: '/media/fat/linux', label: 'linux', exists: true, type: 'directory' },
    ],
    storage: { mountPath: '/media/fat', sizeKb: 32768000, usedKb: 12000000, availableKb: 20768000, usePercent: 37 },
    osInfo: 'mock MiSTer Linux',
    kernelInfo: 'mock MiSTer Linux',
    remoteTime: new Date().toString(),
    message: 'mock fingerprint: Electron SSH adapter가 없는 브라우저 환경입니다.',
    commands: [],
  };
}

function createStep(id: string, label: string, status: ReadOnlyIntegrationTestStep['status'], message: string, startedAt: string, errorCode?: RemoteErrorCode): ReadOnlyIntegrationTestStep {
  const finishedAt = new Date().toISOString();
  return {
    id,
    label,
    status,
    startedAt,
    finishedAt,
    durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    message,
    sanitizedMessage: message,
    resultSummary: message,
    errorCode,
  };
}

function pathStep(fingerprint: MisterRemoteFingerprint | undefined, path: string, label: string): ReadOnlyIntegrationTestStep {
  const startedAt = new Date().toISOString();
  const pathStatus = fingerprint?.pathStatuses.find((item) => item.path === path);
  if (!fingerprint?.ok) return createStep(path, label, '건너뜀', 'fingerprint가 실패해 경로 상태를 확정하지 않았습니다.', startedAt);
  if (!pathStatus?.exists) return createStep(path, label, '실패', `${path} 경로가 확인되지 않았습니다.`, startedAt, path === '/media/fat' ? 'NOT_MISTER' : 'REMOTE_PATH_MISSING');
  return createStep(path, label, '성공', `${path} 확인됨`, startedAt);
}

export class MisterRemoteReadService {
  async inspectHostKey(request: { host: string; port: number; profileId?: string; alias?: string }): Promise<SshHostKeyCheckResult> {
    if (window.helloMisterDesktop?.inspectSshHostKey) return window.helloMisterDesktop.inspectSshHostKey(request);
    return {
      ok: false,
      status: 'new',
      host: request.host,
      port: request.port,
      fingerprint: 'ED25519 SHA256:mock-host-key',
      keyType: 'ssh-ed25519',
      message: 'mock: 처음 보는 SSH 호스트 키입니다.',
    };
  }

  async trustHostKey(request: { host: string; port: number; fingerprint: string; keyType: string; profileId?: string; alias?: string }): Promise<SshHostKeyCheckResult> {
    if (window.helloMisterDesktop?.trustSshHostKey) return window.helloMisterDesktop.trustSshHostKey(request);
    return { ok: true, status: 'trusted-now', ...request, message: 'mock: SSH 호스트 키를 신뢰했습니다.' };
  }

  async removeKnownHost(host: string, port: number) {
    if (window.helloMisterDesktop?.removeSshKnownHost) return window.helloMisterDesktop.removeSshKnownHost(host, port);
    return { ok: true, message: 'mock: 저장된 SSH 호스트 키를 제거했습니다.', entries: [] as SshKnownHostEntry[] };
  }

  async listKnownHosts(): Promise<SshKnownHostEntry[]> {
    if (window.helloMisterDesktop?.listSshKnownHosts) return window.helloMisterDesktop.listSshKnownHosts();
    return [];
  }

  async listKnownHostHistory(): Promise<SshKnownHostHistoryEntry[]> {
    if (window.helloMisterDesktop?.listSshKnownHostHistory) return window.helloMisterDesktop.listSshKnownHostHistory();
    return [];
  }

  async fingerprint(input: SshCredentialInput): Promise<MisterRemoteFingerprint> {
    if (window.helloMisterDesktop?.fingerprintMister) return window.helloMisterDesktop.fingerprintMister(input);
    return createMockFingerprint(input.host);
  }

  async fingerprintSavedProfile(profileId: string, passwordOverride?: string): Promise<MisterRemoteFingerprint> {
    if (window.helloMisterDesktop?.fingerprintSavedMisterProfile) return window.helloMisterDesktop.fingerprintSavedMisterProfile({ profileId, passwordOverride });
    return createMockFingerprint(profileId);
  }

  async fingerprintSession(sessionId: string, fallbackHost = 'mock'): Promise<MisterRemoteFingerprint> {
    if (window.helloMisterDesktop?.fingerprintMisterSession) return window.helloMisterDesktop.fingerprintMisterSession(sessionId);
    return createMockFingerprint(fallbackHost);
  }

  async clearSession(sessionId: string) {
    if (window.helloMisterDesktop?.clearSshSession) return window.helloMisterDesktop.clearSshSession(sessionId);
    return { ok: true, message: 'mock: 세션 인증을 지웠습니다.' };
  }

  async listSessions(): Promise<SshSessionState[]> {
    if (window.helloMisterDesktop?.listSshSessions) return window.helloMisterDesktop.listSshSessions();
    return [];
  }

  async readMisterIni(sessionId: string): Promise<MisterRemoteIniSnapshot> {
    if (window.helloMisterDesktop?.readRemoteMisterIni) return window.helloMisterDesktop.readRemoteMisterIni(sessionId);
    return {
      ok: true,
      sessionId,
      path: '/media/fat/MiSTer.ini',
      content: '; mock MiSTer.ini preview\n; 브라우저 fallback에서는 원격 파일을 읽지 않습니다.\n',
      readAt: new Date().toISOString(),
      sizeBytes: 72,
      message: 'mock: MiSTer.ini 미리보기를 표시합니다.',
    };
  }

  async listGames(sessionId: string): Promise<RemoteReadResult<MisterRemoteGameFolder[]>> {
    if (window.helloMisterDesktop?.listRemoteGames) return window.helloMisterDesktop.listRemoteGames(sessionId);
    return {
      ok: true,
      sessionId,
      items: [
        { name: 'NES', path: '/media/fat/games/NES', fileCount: 12 },
        { name: 'SNES', path: '/media/fat/games/SNES', fileCount: 8 },
      ],
      readAt: new Date().toISOString(),
      message: 'mock: games 1단계 폴더 목록입니다.',
    };
  }

  async listGameFolderFiles(
    sessionId: string,
    folderPath: string,
    options?: { scanDepth?: number; recursive?: boolean; maxFiles?: number },
  ): Promise<RemoteReadResult<RemoteRomFileEntry[]>> {
    if (window.helloMisterDesktop?.listRemoteGameFolderFiles) return window.helloMisterDesktop.listRemoteGameFolderFiles(sessionId, folderPath, options);
    return {
      ok: true,
      sessionId,
      items: [],
      readAt: new Date().toISOString(),
      message: 'mock: 원격 대상 폴더 파일 목록은 비어 있습니다.',
    };
  }

  async listScripts(sessionId: string): Promise<RemoteReadResult<MisterRemoteScriptFile[]>> {
    if (window.helloMisterDesktop?.listRemoteScripts) return window.helloMisterDesktop.listRemoteScripts(sessionId);
    return {
      ok: true,
      sessionId,
      items: [
        { name: 'update_all.sh', path: '/media/fat/Scripts/update_all.sh', sizeBytes: 2048 },
        { name: 'wifi.sh', path: '/media/fat/Scripts/wifi.sh', sizeBytes: 1024 },
      ],
      readAt: new Date().toISOString(),
      message: 'mock: Scripts 목록입니다. 실행은 하지 않습니다.',
    };
  }

  async readScript(sessionId: string, path: string): Promise<RemoteReadResult<MisterRemoteScriptFile>> {
    if (window.helloMisterDesktop?.readRemoteScript) return window.helloMisterDesktop.readRemoteScript(sessionId, path);
    return {
      ok: true,
      sessionId,
      items: { name: path.split('/').pop() || 'script.sh', path, contentPreview: '# mock script preview\n' },
      readAt: new Date().toISOString(),
      message: 'mock: 스크립트 내용을 읽기 전용으로 표시합니다.',
    };
  }

  async runReadOnlyIntegrationTest(input: {
    sessionId?: string;
    profile?: MisterDeviceProfile;
    knownHost?: SshKnownHostEntry;
    taskLogSummary?: string[];
  }): Promise<ReadOnlyIntegrationTestResult> {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const steps: ReadOnlyIntegrationTestStep[] = [];
    const addGuard = (id: string, label: string, ok: boolean, message: string, errorCode?: RemoteErrorCode) => {
      const stepStartedAt = new Date().toISOString();
      steps.push(createStep(id, label, ok ? '성공' : '차단됨', message, stepStartedAt, ok ? undefined : errorCode));
    };

    addGuard('profile', '장치 프로필 선택', Boolean(input.profile), input.profile ? `${input.profile.alias || input.profile.ipAddress} 프로필 선택됨` : '저장된 MiSTer 프로필이 필요합니다.', 'UNKNOWN_REMOTE_ERROR');
    addGuard('session', 'SSH/SFTP 세션 인증 확인', Boolean(input.sessionId), input.sessionId ? 'session-only 인증이 메모리에 있습니다.' : 'session-only 인증이 필요합니다.', 'AUTH_FAILED');
    addGuard('host-key', 'host key trust 확인', Boolean(input.knownHost), input.knownHost ? '신뢰된 SSH host key입니다.' : '신뢰된 SSH host key가 필요합니다.', 'HOST_KEY_UNTRUSTED');

    if (!input.profile || !input.sessionId || !input.knownHost) {
      const finishedAt = new Date().toISOString();
      const blocked = steps.filter((step) => step.status === '차단됨');
      return {
        ok: false,
        partial: false,
        summary: {
          status: input.sessionId ? 'blocked' : 'needs-auth',
          successfulSteps: steps.filter((step) => step.status === '성공').length,
          failedSteps: 0,
          blockedSteps: blocked.length,
          durationMs: Date.now() - startedMs,
          lastErrorCode: blocked[0]?.errorCode,
          message: '원격 읽기 실행 조건을 만족하지 않아 통합 테스트를 차단했습니다.',
        },
        startedAt,
        finishedAt,
        durationMs: Date.now() - startedMs,
        steps,
        message: '원격 읽기 실행 조건을 만족하지 않아 통합 테스트를 차단했습니다.',
      };
    }

    const sessionId = input.sessionId;
    const profile = input.profile;

    const runStep = async <T>(id: string, label: string, runner: () => Promise<T>, success: (result: T) => string, errorCode?: (result: T) => RemoteErrorCode | undefined): Promise<T | undefined> => {
      const stepStartedAt = new Date().toISOString();
      try {
        const result = await runner();
        const code = errorCode?.(result);
        steps.push(createStep(id, label, code ? '실패' : '성공', success(result), stepStartedAt, code));
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        steps.push(createStep(id, label, '실패', message, stepStartedAt, 'UNKNOWN_REMOTE_ERROR'));
        return undefined;
      }
    };

    const fingerprint = await runStep(
      'fingerprint',
      'read-only fingerprint 실행',
      () => this.fingerprintSession(sessionId, profile.ipAddress),
      (result) => result.message,
      (result) => result.ok ? undefined : result.error?.code,
    );

    steps.push(pathStep(fingerprint, '/media/fat', '/media/fat 존재 확인'));
    steps.push(pathStep(fingerprint, '/media/fat/MiSTer.ini', 'MiSTer.ini 존재 확인'));
    steps.push(pathStep(fingerprint, '/media/fat/downloader.ini', 'downloader.ini 존재 확인'));
    steps.push(pathStep(fingerprint, '/media/fat/games', 'games 폴더 존재 확인'));
    steps.push(pathStep(fingerprint, '/media/fat/Scripts', 'Scripts 폴더 존재 확인'));
    steps.push(createStep('storage', '저장공간 조회', fingerprint?.storage ? '성공' : '건너뜀', fingerprint?.storage ? `${fingerprint.storage.usePercent ?? '?'}% 사용` : '저장공간 정보를 확인하지 못했습니다.', new Date().toISOString()));
    steps.push(createStep('identity', 'hostname/MAC/kernel/time 조회', fingerprint?.ok ? '성공' : '건너뜀', fingerprint?.ok ? `${fingerprint.hostname || 'hostname 미확인'} / ${fingerprint.macAddress || 'MAC 미확인'}` : 'fingerprint 실패로 건너뜀', new Date().toISOString()));

    const iniPreview = await runStep(
      'ini-preview',
      '원격 MiSTer.ini 처음 200줄 미리보기',
      () => this.readMisterIni(sessionId),
      (result) => result.ok ? `MiSTer.ini ${Math.min(result.content.split('\n').length, 200)}줄 미리보기 준비` : result.message,
      (result) => result.ok ? undefined : result.error?.code,
    );

    const gamesResult = await runStep(
      'games-list',
      'games 1단계 폴더 목록 확인',
      () => this.listGames(sessionId),
      (result) => result.ok ? `${result.items.length}개 코어 폴더 조회` : result.message,
      (result) => result.ok ? undefined : result.errorCode,
    );
    const games = gamesResult?.items || [];

    const scriptsResult = await runStep(
      'scripts-list',
      'Scripts .sh 목록 확인',
      () => this.listScripts(sessionId),
      (result) => result.ok ? `${result.items.length}개 스크립트 조회` : result.message,
      (result) => result.ok ? undefined : result.errorCode,
    );
    const scripts = scriptsResult?.items || [];

    const diagnosticPackage = createDiagnosticPackage({
      profile: input.profile,
      fingerprint,
      hostKeyTrust: {
        ok: true,
        status: 'trusted',
        host: input.knownHost.host,
        port: input.knownHost.port,
        fingerprint: input.knownHost.fingerprint,
        keyType: input.knownHost.keyType,
        knownHost: input.knownHost,
        message: '신뢰된 SSH 호스트 키입니다.',
      },
      games,
      scripts,
      taskLogSummary: input.taskLogSummary,
    });
    steps.push(createStep('diagnostic-dry-run', '진단 패키지 dry-run 생성', '성공', '로컬 JSON 구조만 만들고 원격에는 쓰지 않았습니다.', new Date().toISOString()));

    const finishedAt = new Date().toISOString();
    const failedSteps = steps.filter((step) => step.status === '실패');
    const blockedSteps = steps.filter((step) => step.status === '차단됨');
    const successfulSteps = steps.filter((step) => step.status === '성공');
    const lastErrorCode = failedSteps[0]?.errorCode || blockedSteps[0]?.errorCode;
    const status = blockedSteps.length > 0 ? 'blocked' : failedSteps.length > 0 ? 'partial' : 'success';
    const message = status === 'success' ? '읽기 전용 통합 테스트를 완료했습니다.' : `읽기 전용 통합 테스트가 ${failedSteps.length + blockedSteps.length}개 항목에서 완전 성공하지 못했습니다.`;

    return {
      ok: failedSteps.length === 0 && blockedSteps.length === 0,
      partial: failedSteps.length > 0 && successfulSteps.length > 0,
      summary: {
        status,
        successfulSteps: successfulSteps.length,
        failedSteps: failedSteps.length,
        blockedSteps: blockedSteps.length,
        durationMs: Date.now() - startedMs,
        lastErrorCode,
        message,
      },
      startedAt,
      finishedAt,
      durationMs: Date.now() - startedMs,
      steps,
      fingerprint,
      games,
      scripts,
      iniPreview,
      diagnosticPackage,
      message,
    };
  }

  async saveDiagnosticPackage(diagnostic: DiagnosticPackage) {
    if (window.helloMisterDesktop?.saveDiagnosticPackage) return window.helloMisterDesktop.saveDiagnosticPackage(stripDiagnosticSecrets(diagnostic));
    return { ok: false, message: '현재 환경에서는 진단 패키지 저장 adapter가 없습니다.' };
  }
}

export function createDiagnosticPackage(input: {
  profile?: MisterDeviceProfile;
  fingerprint?: MisterRemoteFingerprint;
  hostKeyTrust?: SshHostKeyCheckResult;
  hostKeyHistory?: SshKnownHostHistoryEntry[];
  games?: MisterRemoteGameFolder[];
  scripts?: MisterRemoteScriptFile[];
  taskLogSummary?: string[];
  errors?: string[];
}): DiagnosticPackage {
  return stripDiagnosticSecrets({
    appVersion: '2.1.0',
    createdAt: new Date().toISOString(),
    profile: input.profile
      ? {
        id: input.profile.id,
        alias: input.profile.alias,
        ipAddress: input.profile.ipAddress,
        hostname: input.profile.hostname,
        macAddress: input.profile.macAddress,
        methods: input.profile.methods,
        lastSeenAt: input.profile.lastSeenAt,
      }
      : undefined,
    fingerprint: input.fingerprint,
    hostKeyTrust: input.hostKeyTrust,
    hostKeyHistory: input.hostKeyHistory,
    remoteErrorCode: input.fingerprint?.error?.code,
    games: input.games,
    scripts: input.scripts?.map(({ contentPreview: _contentPreview, ...script }) => script),
    misterIniExists: input.fingerprint?.pathStatuses.some((item) => item.path === '/media/fat/MiSTer.ini' && item.exists),
    taskLogSummary: input.taskLogSummary,
    errors: input.errors || [],
  });
}

export function stripDiagnosticSecrets<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, innerValue) => (
    /password|privateKey|passphrase|token|secret|credential/i.test(key)
      ? '[removed]'
      : /private.*path|key.*path/i.test(key) && typeof innerValue === 'string'
        ? innerValue.split(/[\\/]/).pop()
        : innerValue
  )));
}
