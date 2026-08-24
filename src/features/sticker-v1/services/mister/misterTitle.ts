// Derives a human-readable game title from a MiSTer file path. Shared by the scanner (misterScan) and the
// library loader (zaparooLibrary migration) so both produce identical titles and stale titles can be re-derived
// in place without a re-scan. Pure/deterministic — no user-custom titles exist, so re-deriving is always safe.
export function titleFromPath(path: string) {
  const parts = path.split('/').filter(Boolean);
  const fileName = parts[parts.length - 1] ?? path;
  const parentName = parts[parts.length - 2] ?? '';
  const baseName = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Strip a ROM-set numbering prefix like "04. " / "001. " (number + period + space) so the title is the
  // real game name, not just the number. Keep titles that legitimately start with a number (e.g. "1942",
  // "240pSuite") — those have no period immediately after the digits.
  const numbered = baseName.replace(/^\d{1,3}\.\s+/, '').trim();
  const cleaned = numbered.length >= 2 ? numbered : baseName;
  if (/^(game|default|index|rom)$/i.test(cleaned) && parentName) {
    return parentName.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return cleaned;
}
