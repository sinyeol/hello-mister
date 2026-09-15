// Helpers for the MiSTer Arcade Database (mad_db.json) that update_all's Arcade Organizer keeps on the SD card as
// Scripts/.config/arcade-organizer/data.zip. The database is keyed by each .mra's <setname> and carries the
// platform (hardware) name, genre, year, manufacturer, region, players, buttons, rotation and alternative/bootleg
// flags. Pure functions only, so scripts/test-sticker-arcade-database.mjs can exercise them without Electron.
export const ARCADE_DATABASE_REMOTE_PATH = '/media/fat/Scripts/.config/arcade-organizer/data.zip';

// Parses the output of `find /media/fat/_Arcade -name '*.mra' -exec grep -HoE '<rbf[^>]*>[^<]*|<setname[^>]*>[^<]*' {} +`:
// one "path:<tag>value" line per match. The first <rbf> / <setname> per file wins (later matches are comments
// or alternate declarations).
export function parseArcadeCoreListing(stdout) {
  const cores = {};
  const setnames = {};
  for (const rawLine of String(stdout || '').split(/\r?\n/)) {
    const match = rawLine.trimEnd().match(/^(.+?\.mra):\s*<(rbf|setname)[^>]*>\s*([^<]*)$/i);
    if (!match) continue;
    const [, file, tag, value] = match;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const target = tag.toLowerCase() === 'rbf' ? cores : setnames;
    if (!(file in target)) target[file] = trimmed;
  }
  return { cores, setnames };
}

function firstString(value) {
  if (Array.isArray(value)) return value.find((item) => typeof item === 'string' && item.trim())?.trim();
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringList(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
  return typeof value === 'string' && value.trim() ? [value.trim()] : [];
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function toText(value) {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

// Normalizes the raw mad_db.json object into compact entries (undefined / empty fields dropped) keyed by setname.
export function normalizeArcadeDatabase(raw) {
  const entries = {};
  if (raw && typeof raw === 'object') {
    for (const [setname, value] of Object.entries(raw)) {
      if (!setname || !value || typeof value !== 'object') continue;
      const entry = {
        name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : setname,
        file: toText(value.file),
        platform: firstString(value.platform),
        platforms: stringList(value.platform),
        category: firstString(value.category),
        categories: stringList(value.category),
        manufacturer: firstString(value.manufacturer),
        year: toNumber(value.year),
        region: toText(value.region),
        players: toText(value.players),
        numButtons: toNumber(value.num_buttons),
        rotation: toNumber(value.rotation),
        resolution: toText(value.resolution),
        moveInputs: stringList(value.move_inputs),
        specialControls: stringList(value.special_controls),
        series: stringList(value.series),
        alternative: value.alternative === true,
        bootleg: value.bootleg === true,
        homebrew: value.homebrew === true,
      };
      for (const key of Object.keys(entry)) {
        if (entry[key] === undefined || (Array.isArray(entry[key]) && entry[key].length === 0)) delete entry[key];
      }
      entries[setname] = entry;
    }
  }
  return { entries, entryCount: Object.keys(entries).length };
}
