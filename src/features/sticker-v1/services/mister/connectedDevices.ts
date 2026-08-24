import { useCallback, useEffect, useState } from 'react';
import type {
  MiSTerConnectionConfig,
  MiSTerLibraryProfile,
  ZaparooLibraryEntry,
  ZaparooLibrarySourceRef,
} from '@sticker-v1/types';
import { deviceIdFromConfig } from '@sticker-v1/services/zaparoo/zaparooLibrary';
import type { MisterDeviceProfile, SshSessionState } from '../../../../types/mister';

const targetDeviceKey = 'hello-mister-v2:mister-target-device';

export interface ConnectedMiSTerDevice {
  // Stable library device id (profileId/MAC/hostname based) before profile reconciliation.
  deviceId: string;
  sessionId: string;
  config: MiSTerConnectionConfig;
  profileId?: string;
  alias?: string;
  hostname?: string;
  macAddress?: string;
  sdCid?: string;
  ipAddress: string;
  status: 'connected';
  lastUsedAt?: string;
}

function configForSession(session: SshSessionState): MiSTerConnectionConfig {
  return {
    host: session.host,
    port: session.port || 22,
    username: session.username || 'root',
    protocol: 'ssh-sftp',
    authMethod: 'password',
  };
}

// Hydrate the live multi-session list from the Electron backend. SshSessionState lacks profileId/MAC/hostname,
// so cross-reference saved profiles (sessionId equals the profileId when a saved profile was used).
export async function loadConnectedMiSTerDevices(): Promise<ConnectedMiSTerDevice[]> {
  const api = window.helloMisterDesktop;
  if (!api?.listSshSessions) return [];
  const [sessions, profiles] = await Promise.all([
    api.listSshSessions().catch(() => [] as SshSessionState[]),
    api.loadMisterProfiles?.().catch(() => [] as MisterDeviceProfile[]) ?? Promise.resolve([] as MisterDeviceProfile[]),
  ]);
  return sessions.map((session) => {
    const profile = profiles.find((candidate) => candidate.id === session.sessionId)
      ?? profiles.find((candidate) => candidate.ipAddress === session.host && (candidate.port ?? 22) === session.port);
    const config = configForSession(session);
    return {
      // Host/IP-based id, consistent with the library's host-based device ids. (profileId/MAC/hostname collide on
      // cloned SD cards, which made the two MiSTers share one id and broke the scan-target dropdown.)
      deviceId: deviceIdFromConfig(config),
      sessionId: session.sessionId,
      config,
      profileId: profile?.id,
      alias: profile?.alias,
      hostname: profile?.hostname,
      macAddress: profile?.macAddress,
      sdCid: profile?.sdCid,
      ipAddress: session.host,
      status: 'connected' as const,
      lastUsedAt: session.lastUsedAt,
    } satisfies ConnectedMiSTerDevice;
  });
}

export interface UseConnectedMiSTerDevicesResult {
  devices: ConnectedMiSTerDevice[];
  selectedTargetDeviceId?: string;
  setSelectedTargetDeviceId: (deviceId: string) => void;
  refresh: () => Promise<void>;
}

export function useConnectedMiSTerDevices(): UseConnectedMiSTerDevicesResult {
  const [devices, setDevices] = useState<ConnectedMiSTerDevice[]>([]);
  const [selectedTargetDeviceId, setSelectedTargetDeviceIdState] = useState<string | undefined>(() => {
    try {
      return window.localStorage.getItem(targetDeviceKey) ?? undefined;
    } catch {
      return undefined;
    }
  });

  const refresh = useCallback(async () => {
    setDevices(await loadConnectedMiSTerDevices());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setSelectedTargetDeviceId = useCallback((deviceId: string) => {
    setSelectedTargetDeviceIdState(deviceId);
    try {
      window.localStorage.setItem(targetDeviceKey, deviceId);
    } catch {
      // ignore storage failures
    }
  }, []);

  return { devices, selectedTargetDeviceId, setSelectedTargetDeviceId, refresh };
}

export interface LaunchTarget {
  device: ConnectedMiSTerDevice;
  sourceRef?: ZaparooLibrarySourceRef;
}

// Connected devices that actually have this logical game. Matches a connected device to the library profile by
// hardware MAC first (survives DHCP IP changes and tells apart MiSTers that share the "MiSTer" hostname), then
// falls back to IP, then checks the entry is on that device.
export function resolveLaunchTargetsForEntry(
  entry: ZaparooLibraryEntry,
  devices: ConnectedMiSTerDevice[],
  profiles: MiSTerLibraryProfile[],
): LaunchTarget[] {
  const hexKey = (value?: string) => (value ? value.trim().toLowerCase().replace(/[^0-9a-f]/g, '') : '');
  return devices
    .map((device) => {
      // Match the connected device to its library profile by SD CID first (unique per card, survives DHCP
      // IP changes), then by a usable MAC, then by IP.
      const deviceCid = hexKey(device.sdCid);
      const deviceMac = hexKey(device.macAddress);
      const profile = (deviceCid && profiles.find((candidate) => hexKey(candidate.sdCid) === deviceCid))
        ?? (deviceMac && profiles.find((candidate) => hexKey(candidate.macAddress) === deviceMac))
        ?? profiles.find((candidate) => candidate.host === device.ipAddress);
      const sourceRef = profile ? entry.sourceRefs.find((ref) => ref.deviceId === profile.deviceId) : undefined;
      const hasGame = Boolean(sourceRef) || Boolean(profile && entry.sourceDevices.includes(profile.deviceId));
      return { device, sourceRef, hasGame };
    })
    .filter((target) => target.hasGame)
    .map(({ device, sourceRef }) => ({ device, sourceRef }));
}

// Prefer this device's own resolved payload/path; fall back to the caller's buildLaunchPreview text so the
// final render path stays identical to the rest of the app.
export function launchTextForDeviceRef(sourceRef: ZaparooLibrarySourceRef | undefined, fallbackText: string): string {
  if (sourceRef?.nfcPayload) return sourceRef.nfcPayload;
  if (sourceRef?.resolvedMiSTerPath) return `**launch:${sourceRef.resolvedMiSTerPath}`;
  return fallbackText;
}
