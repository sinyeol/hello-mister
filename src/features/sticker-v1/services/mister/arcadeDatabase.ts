import type { ArcadeDatabaseEntry } from '../../../../types/desktop';
import type { ArcadeGameMetadata, MiSTerScanEntry } from '@sticker-v1/types/mister';

export type ArcadeDatabaseEntries = Record<string, ArcadeDatabaseEntry>;

// Majority arcade-database platform name per core (<rbf>), e.g. jtcps3 -> "Capcom CPS-3". Used to label cores the
// built-in table does not know, so a newly released core gets a readable platform name without a code change.
export function arcadeCoreDisplayNames(
  paths: string[],
  cores: Record<string, string>,
  setnames: Record<string, string>,
  database: ArcadeDatabaseEntries,
) {
  const tallies = new Map<string, Map<string, number>>();
  paths.forEach((path) => {
    const rbf = cores[path];
    const setname = setnames[path];
    if (!rbf || !setname) return;
    const platform = database[setname]?.platform;
    if (!platform) return;
    const key = rbf.trim().toLowerCase();
    const tally = tallies.get(key) ?? new Map<string, number>();
    tally.set(platform, (tally.get(platform) ?? 0) + 1);
    tallies.set(key, tally);
  });
  const names = new Map<string, string>();
  tallies.forEach((tally, rbf) => {
    const [best] = Array.from(tally.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (best) names.set(rbf, best[0]);
  });
  return names;
}

export function orientationFromRotation(rotation: number | undefined): 'horizontal' | 'vertical' | 'unknown' {
  if (rotation === undefined || !Number.isFinite(rotation)) return 'unknown';
  const normalized = ((Math.round(rotation) % 360) + 360) % 360;
  if (normalized === 90 || normalized === 270) return 'vertical';
  if (normalized === 0 || normalized === 180) return 'horizontal';
  return 'unknown';
}

export type ArcadeMetadataFields = Partial<Pick<MiSTerScanEntry, 'genre' | 'releaseYear' | 'manufacturer' | 'orientation' | 'metadataSource' | 'arcade'>>;

// Scan-entry fields learned from the arcade database for one MRA. Without a database entry only the core /
// setname identity is recorded (metadataSource stays undefined so the merge keeps any existing metadata).
export function arcadeMetadataForEntry(rbf: string | undefined, setname: string | undefined, entry: ArcadeDatabaseEntry | undefined): ArcadeMetadataFields {
  if (!rbf && !setname) return {};
  const arcade: ArcadeGameMetadata = {
    rbf,
    setname,
    platform: entry?.platform,
    category: entry?.category,
    region: entry?.region,
    players: entry?.players,
    numButtons: entry?.numButtons,
    rotation: entry?.rotation,
    resolution: entry?.resolution,
    alternative: entry?.alternative,
    bootleg: entry?.bootleg,
    homebrew: entry?.homebrew,
    series: entry?.series,
  };
  if (!entry) return { arcade };
  return {
    arcade,
    genre: entry.category,
    releaseYear: entry.year !== undefined ? String(entry.year) : undefined,
    manufacturer: entry.manufacturer,
    orientation: orientationFromRotation(entry.rotation),
    metadataSource: 'external',
  };
}
