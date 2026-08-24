export function normalizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[:\-_/.!]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
