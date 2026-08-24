import { useEffect, useState } from 'react';
import type { MisterDeviceProfile, SshSessionState } from '../../types/mister';

// Lightweight, app-shell-safe view of the currently connected MiSTers (live SSH sessions held by the
// Electron backend this run). Distinct from the single "active profile": several MiSTers can be
// connected at once, and the sidebar / launch / NFC pickers all choose among this list. Hydrated from
// the same IPC the feature uses, but kept in src/services/mister so the shell does not import a feature.
export interface ConnectedMister {
  deviceId: string;
  sessionId: string;
  alias?: string;
  hostname?: string;
  ipAddress: string;
  port: number;
  macAddress?: string;
  sdCid?: string;
}

export async function loadConnectedMisters(): Promise<ConnectedMister[]> {
  const api = window.helloMisterDesktop;
  if (!api?.listSshSessions) return [];
  const [sessions, profiles] = await Promise.all([
    api.listSshSessions().catch(() => [] as SshSessionState[]),
    api.loadMisterProfiles?.().catch(() => [] as MisterDeviceProfile[]) ?? Promise.resolve([] as MisterDeviceProfile[]),
  ]);
  const mapped: ConnectedMister[] = sessions.map((session) => {
    const profile = profiles.find((candidate) => candidate.id === session.sessionId)
      ?? profiles.find((candidate) => candidate.ipAddress === session.host && (candidate.port ?? 22) === session.port);
    return {
      deviceId: `${session.host}:${session.port || 22}`,
      sessionId: session.sessionId,
      alias: profile?.alias,
      hostname: profile?.hostname,
      ipAddress: session.host,
      port: session.port || 22,
      macAddress: profile?.macAddress,
      sdCid: profile?.sdCid,
    };
  });
  // 풀에 남은 stale 세션(전원이 꺼진 미스터 등)을 제외하고, 실제로 응답하는 연결만 보여준다.
  // 짧은 TCP 도달성 확인으로 "연결됨" 개수가 실제와 어긋나지 않게 한다.
  if (!api.probeMisterReachable || mapped.length === 0) return mapped;
  const checked = await Promise.all(mapped.map(async (device) => {
    const probe = await api.probeMisterReachable!(device.ipAddress, device.port, 1500).catch(() => ({ open: false }));
    return probe?.open ? device : null;
  }));
  return checked.filter((device): device is ConnectedMister => device !== null);
}

export function useConnectedMisters(): ConnectedMister[] {
  const [devices, setDevices] = useState<ConnectedMister[]>([]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void loadConnectedMisters().then((next) => {
        if (!cancelled) setDevices(next);
      });
    };
    refresh();
    window.addEventListener('hello-mister-active-profile-change', refresh);
    window.addEventListener('storage', refresh);
    const interval = window.setInterval(refresh, 10000);
    return () => {
      cancelled = true;
      window.removeEventListener('hello-mister-active-profile-change', refresh);
      window.removeEventListener('storage', refresh);
      window.clearInterval(interval);
    };
  }, []);

  return devices;
}
