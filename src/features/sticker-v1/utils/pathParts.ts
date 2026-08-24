export function splitPathParts(value: string | null | undefined): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function safeString(value: string | null | undefined, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

export function safeFileName(value: string | null | undefined, fallback = 'unknown'): string {
  const parts = splitPathParts(value);
  return safeString(parts.at(-1), fallback);
}

export function safeExtension(value: string | null | undefined): string {
  const name = safeFileName(value, '');
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex === name.length - 1) return 'unknown';
  return name.slice(dotIndex + 1).toLowerCase();
}

export function removeFileExtension(value: string | null | undefined): string {
  const name = safeFileName(value, 'unknown');
  const dotIndex = name.lastIndexOf('.');
  return dotIndex > 0 ? name.slice(0, dotIndex) : name;
}
