import type { MisterDeviceProfile, MisterDiscoveryCandidate, MisterDiscoveryOptions, MisterDiscoveryReport, NetworkInterfaceInfo } from '../../types/mister';
import { createMockFingerprint } from './fingerprint';

export interface MisterDiscoveryService {
  listNetworkInterfaces(): Promise<NetworkInterfaceInfo[]>;
  discoverCandidates(profiles: MisterDeviceProfile[], options?: MisterDiscoveryOptions): Promise<MisterDiscoveryReport>;
}

export class MockMisterDiscoveryService implements MisterDiscoveryService {
  async listNetworkInterfaces(): Promise<NetworkInterfaceInfo[]> {
    return [
      {
        id: 'mock-ethernet-192-168-0-10',
        name: 'Ethernet',
        address: '192.168.0.10',
        netmask: '255.255.255.0',
        family: 'IPv4',
        cidr: '192.168.0.0/24',
        subnetBase: '192.168.0.0',
        subnetLabel: '192.168.0.0/24',
        candidateCount: 254,
        privateRange: true,
        virtual: false,
      },
    ];
  }

  async discoverCandidates(profiles: MisterDeviceProfile[], options?: MisterDiscoveryOptions): Promise<MisterDiscoveryReport> {
    const startedAt = new Date().toISOString();
    const saved = profiles.map<MisterDiscoveryCandidate>((profile) => ({
      id: `saved-${profile.id}`,
      ipAddress: profile.ipAddress,
      hostname: profile.hostname,
      openPorts: [22, 445],
      methods: profile.methods,
      confidence: '높음',
      fingerprint: profile.fingerprint,
      source: '저장된 프로필',
      status: profile.status,
      savedProfileId: profile.id,
    }));

    const mockSubnet: MisterDiscoveryCandidate[] = [
      {
        id: 'mock-192-168-0-42',
        ipAddress: '192.168.0.42',
        hostname: 'MiSTer',
        openPorts: [22, 445],
        methods: ['ssh', 'sftp', 'smb'],
        confidence: '높음',
        fingerprint: createMockFingerprint('192.168.0.42', '42AF'),
        source: 'mock',
        status: 'MiSTer 확인됨',
        probeResults: [
          { ipAddress: '192.168.0.42', port: 22, open: true, latencyMs: 3 },
          { ipAddress: '192.168.0.42', port: 445, open: true, latencyMs: 4 },
          { ipAddress: '192.168.0.42', port: 80, open: false, latencyMs: 160, error: 'timeout' },
        ],
      },
      {
        id: 'mock-192-168-0-77',
        ipAddress: '192.168.0.77',
        hostname: 'MiSTer',
        openPorts: [22],
        methods: ['ssh', 'sftp'],
        confidence: '보통',
        fingerprint: createMockFingerprint('192.168.0.77', '77C0'),
        source: 'mock',
        status: '인증 필요',
        probeResults: [
          { ipAddress: '192.168.0.77', port: 22, open: true, latencyMs: 5 },
          { ipAddress: '192.168.0.77', port: 445, open: false, latencyMs: 180, error: 'timeout' },
        ],
      },
    ];

    const interfaces = await this.listNetworkInterfaces();
    return {
      interfaces,
      selectedInterface: interfaces.find((item) => item.id === options?.interfaceId) || interfaces[0],
      candidates: [...saved, ...mockSubnet],
      scannedHostCount: 254,
      scannedPortCount: 254 * (options?.ports.length || 3),
      startedAt,
      finishedAt: new Date().toISOString(),
      logs: ['mock fallback: Electron 읽기 전용 포트 스캔 adapter가 없을 때 사용하는 예시 결과입니다.'],
      fallback: true,
    };
  }
}

export class DesktopMisterDiscoveryService implements MisterDiscoveryService {
  private fallback = new MockMisterDiscoveryService();

  async listNetworkInterfaces(): Promise<NetworkInterfaceInfo[]> {
    if (window.helloMisterDesktop?.listNetworkInterfaces) {
      const items = await window.helloMisterDesktop.listNetworkInterfaces();
      return items.length ? items : this.fallback.listNetworkInterfaces();
    }
    return this.fallback.listNetworkInterfaces();
  }

  async discoverCandidates(profiles: MisterDeviceProfile[], options?: MisterDiscoveryOptions): Promise<MisterDiscoveryReport> {
    if (window.helloMisterDesktop?.scanMisterCandidates) {
      const report = await window.helloMisterDesktop.scanMisterCandidates(options || defaultDiscoveryOptions());
      const scanned = report.candidates; // 스캔 후보는 22/445가 열려 있어 이미 살아있는 기기다.
      const byIp = new Map(profiles.map((profile) => [profile.ipAddress, profile]));
      // 스캔 후보에 저장된 프로필 정보(별칭/식별자)를 IP로 합쳐 중복 행을 막는다.
      for (const candidate of scanned) {
        const profile = byIp.get(candidate.ipAddress);
        if (profile) {
          candidate.savedProfileId = profile.id;
          if (!candidate.hostname && profile.hostname) candidate.hostname = profile.hostname;
        }
      }
      const scannedIps = new Set(scanned.map((candidate) => candidate.ipAddress));
      // 스캔이 못 잡은 저장 프로필(다른 대역·느린 응답)은 짧은 핑으로 살아있을 때만 포함. 꺼진 기기는 제외.
      const probe = window.helloMisterDesktop.probeMisterReachable;
      let aliveSaved: MisterDiscoveryCandidate[] = [];
      if (probe) {
        const missing = profiles.filter((profile) => !scannedIps.has(profile.ipAddress));
        const results = await Promise.all(missing.map(async (profile): Promise<MisterDiscoveryCandidate | null> => {
          const reachable = await probe(profile.ipAddress, profile.port || 22, 1500).catch(() => ({ open: false }));
          if (!reachable?.open) return null;
          return {
            id: `saved-${profile.id}`,
            ipAddress: profile.ipAddress,
            hostname: profile.hostname,
            openPorts: [profile.port || 22],
            methods: profile.methods,
            confidence: '높음' as const,
            fingerprint: profile.fingerprint,
            source: '저장된 프로필' as const,
            status: '저장됨' as const,
            savedProfileId: profile.id,
          };
        }));
        aliveSaved = results.filter((candidate): candidate is MisterDiscoveryCandidate => candidate !== null);
      }
      return { ...report, candidates: [...scanned, ...aliveSaved] };
    }
    return this.fallback.discoverCandidates(profiles, options);
  }
}

export function defaultDiscoveryOptions(interfaceId?: string): MisterDiscoveryOptions {
  return {
    interfaceId,
    ports: [22, 445, 80],
    timeoutMs: 220,
    concurrency: 48,
    includeHttp: true,
  };
}

export function createDefaultSavedProfiles(): MisterDeviceProfile[] {
  return [
    {
      id: 'living-room',
      alias: '거실 MiSTer',
      hostname: 'MiSTer',
      ipAddress: '192.168.0.20',
      macAddress: '02:00:00:00:20:AA',
      methods: ['ssh', 'sftp', 'smb'],
      status: '저장됨',
      lastSeenAt: new Date().toISOString(),
      fingerprint: createMockFingerprint('192.168.0.20', '20AA'),
      defaultDevice: true,
      autoConnect: false,
    },
  ];
}
