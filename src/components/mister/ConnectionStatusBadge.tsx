import { NavLink } from 'react-router-dom';
import { StatusBadge } from '../status/StatusBadge';
import { isUsableMacAddress, isUsableSdCid, macSuffix, sameDevice, serialSuffix } from '../../services/mister/fingerprint';
import { useActiveMisterProfile } from '../../services/mister/activeProfile';
import { useConnectedMisters } from '../../services/mister/connectedMisters';

// Persistent sidebar panel listing EVERY connected MiSTer (live SSH sessions), with the active one
// marked. Reads the same single sources of truth the launch/NFC pickers use, so the sidebar can never
// disagree with them. Labels are anchored to the MAC suffix so a DHCP-reused IP is not shown under the
// previous device's alias; the active profile's identityWarning flips its row to a warning tone.
interface ConnRow {
  key: string;
  alias?: string;
  hostname?: string;
  ipAddress: string;
  macAddress?: string;
  sdCid?: string;
  isActive: boolean;
  live: boolean;
  warning?: string;
}

export function ConnectionStatusBadge() {
  const [activeProfile] = useActiveMisterProfile();
  const connected = useConnectedMisters();

  // Match the active device by its hardware key (SD CID first, then a usable MAC); fall back to IP.
  const matchesActive = (device: { sdCid?: string; macAddress?: string; ipAddress: string }) =>
    Boolean(activeProfile)
    && (sameDevice(device, { sdCid: activeProfile?.sdCid, macAddress: activeProfile?.macAddress })
      || device.ipAddress === activeProfile?.ipAddress);

  const rows: ConnRow[] = connected.map((device) => {
    const isActive = matchesActive(device);
    return {
      key: device.deviceId,
      alias: device.alias,
      hostname: device.hostname,
      ipAddress: device.ipAddress,
      macAddress: device.macAddress,
      sdCid: device.sdCid,
      isActive,
      live: true,
      warning: isActive ? activeProfile?.identityWarning : undefined,
    };
  });

  // 부팅 시 세션이 없으면(자동 연결 안 함) 실제 연결이 아니므로 "연결 안 됨"으로 둔다.
  // 예전에는 기억된 활성 프로필을 "활성(재연결 필요)"으로 보여줬지만, 매 부팅마다 뜨는 오해를 유발해 제거.
  if (rows.length === 0) {
    return (
      <NavLink to="/mister" className="sidebar-connection off" title="MiSTer 연결 메뉴로 이동">
        <StatusBadge label="MiSTer 연결 안 됨" tone="neutral" />
        <span className="conn-label">연결하려면 클릭하세요.</span>
      </NavLink>
    );
  }

  const liveCount = rows.filter((row) => row.live).length;
  const hasWarning = rows.some((row) => row.warning);
  const headTone = hasWarning ? 'warning' : 'safe';
  const headLabel = liveCount > 1 ? `MiSTer 연결됨 · ${liveCount}대` : 'MiSTer 연결됨';
  const panelClass = `sidebar-connection${hasWarning ? ' warn' : ''}`;

  return (
    <NavLink to="/mister" className={panelClass} title="MiSTer 연결 메뉴로 이동">
      <StatusBadge label={headLabel} tone={headTone} />
      <div className="conn-rows">
        {rows.map((row) => {
          // Identify by SD CID first (unique per card); fall back to a usable MAC. The stock MiSTer MAC is
          // hidden (shared by every device) so it does not look like two MiSTers share one address.
          const idLabel = isUsableSdCid(row.sdCid)
            ? ` · SD ${serialSuffix(row.sdCid)}`
            : isUsableMacAddress(row.macAddress)
              ? ` · MAC ${macSuffix(row.macAddress)}`
              : '';
          const dotClass = row.warning ? 'warn' : row.live ? 'on' : 'idle';
          const name = (row.hostname && row.hostname !== 'MiSTer') ? row.hostname : (row.alias || 'MiSTer');
          const label = `${row.isActive ? '★ ' : ''}${name} @ ${row.ipAddress}${idLabel}${!row.live ? ' · 재연결 필요' : ''}`;
          return (
            <div key={row.key} className={`conn-row${row.isActive ? ' active' : ''}`} title={row.warning ?? label}>
              <span className={`conn-dot ${dotClass}`} aria-hidden="true" />
              <span className="conn-label">{label}</span>
            </div>
          );
        })}
      </div>
    </NavLink>
  );
}
