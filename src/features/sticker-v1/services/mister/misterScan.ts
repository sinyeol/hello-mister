import type { MiSTerPlatformGroup, MiSTerScanEntry } from '@sticker-v1/types';
import { normalizeName } from '@sticker-v1/utils/normalizeName';
import { classifyMiSTerPath, extensionFromPath, isLikelyPlayablePath } from './misterCoreRegistry';
import { titleFromPath } from './misterTitle';

export const misterScanRoots = [
  '/media/fat/games',
  '/media/fat/_Arcade',
  '/media/fat/_Console',
  '/media/fat/_Computer',
  '/media/fat/cifs',
  '/media/network',
  '/media/usb',
];

function extension(path: string) {
  return extensionFromPath(path);
}

function platformGroupFromPath(path: string): MiSTerPlatformGroup {
  if (path.includes('/_Arcade') || extension(path) === 'mra') return 'Arcade';
  if (path.includes('/_Computer')) return 'Computer';
  if (path.includes('/_Console') || path.includes('/games/')) return 'Console';
  if (path.includes('/media/network')) return 'Network';
  if (path.includes('/media/usb')) return 'USB';
  return 'Other';
}

function systemIdFromPath(path: string) {
  const parts = path.split('/').filter(Boolean);
  const gamesIndex = parts.indexOf('games');
  if (gamesIndex !== -1 && parts[gamesIndex + 1]) return parts[gamesIndex + 1];
  if (path.includes('/_Console/') || path.includes('/_Computer/')) {
    const index = parts.findIndex((part) => part === '_Console' || part === '_Computer');
    if (index !== -1 && parts[index + 1]) return parts[index + 1].replace(/^_/, '');
  }
  const menuFolder = parts.find((part) => part.startsWith('_') && !['_Arcade', '_Console', '_Computer'].includes(part));
  if (menuFolder) return menuFolder.replace(/^_/, '');
  const arcadeIndex = parts.indexOf('_Arcade');
  if (arcadeIndex !== -1) {
    const arcadeChild = parts[arcadeIndex + 1];
    if (arcadeChild && arcadeChild.includes('.')) return 'Arcade';
    return arcadeChild || 'Arcade';
  }
  return parts[Math.max(0, parts.length - 2)] ?? 'Unknown';
}

function folderNameFromPath(path: string) {
  const parts = path.split('/').filter(Boolean);
  return parts[Math.max(0, parts.length - 2)] ?? 'Root';
}

function relativePathFromAbsolute(path: string) {
  const root = misterScanRoots.find((candidate) => path.startsWith(candidate));
  return root ? path.slice(root.length).replace(/^\/+/, '') : path.replace(/^\/media\/fat\/?/, '');
}

function launchModeForPath(path: string) {
  if (path.includes('/_Arcade') || extension(path) === 'mra') return 'relative-path' as const;
  return 'launch-title' as const;
}

function parseRegionAndDisc(path: string) {
  const fileName = path.split('/').pop() ?? path;
  const region = fileName.match(/\(([^)]*(USA|Europe|Japan|World|Korea|Asia)[^)]*)\)/i)?.[1];
  const disc = fileName.match(/\((Disc\s*[^)]*|Disk\s*[^)]*)\)/i)?.[1];
  return { region, disc };
}

function normalizeInputPath(line: string) {
  const cleaned = line.trim().replace(/^"|"$/g, '');
  // Real game paths frequently contain commas — "(World, set 1)", "(US, M84 hardware)" — so do NOT blindly
  // take the first comma cell (that silently dropped every comma-named game). Only fall back to the first CSV
  // cell when the full line is not itself a usable path (i.e. it really is "path,extra-columns" pasted input).
  if (isLikelyPlayablePath(cleaned)) return cleaned;
  const firstCell = cleaned.split(',')[0]?.trim() ?? cleaned;
  return firstCell.replace(/^"|"$/g, '');
}

export function parseMiSTerPathList(content: string): MiSTerScanEntry[] {
  const now = new Date().toISOString();
  return content
    .split(/\r?\n/)
    .map((line) => normalizeInputPath(line.trim()))
    .filter((line) => line && !line.endsWith('/'))
    .filter((line) => isLikelyPlayablePath(line))
    .map((absolutePath, index) => {
      const title = titleFromPath(absolutePath);
      const relativePath = relativePathFromAbsolute(absolutePath);
      const platformGroup = platformGroupFromPath(absolutePath);
      const systemId = systemIdFromPath(absolutePath);
      const classification = classifyMiSTerPath(absolutePath, systemId);
      const launchMode = launchModeForPath(absolutePath);
      const { region, disc } = parseRegionAndDisc(absolutePath);
      return {
        id: `mister_${normalizeName(absolutePath).replace(/\s+/g, '_')}_${index}`,
        source: 'mister',
        platformGroup,
        systemId,
        folderName: folderNameFromPath(absolutePath),
        folderPath: absolutePath.split('/').slice(0, -1).join('/'),
        relativePath,
        absolutePath,
        title,
        romName: absolutePath.split('/').pop() ?? title,
        region,
        disc,
        kind: classification.kind,
        launchMode,
        launchValue: launchMode === 'launch-title' ? `@${systemId}/${title}` : relativePath,
        imageMatchKey: normalizeName(`${title} ${absolutePath.split('/').pop() ?? ''}`),
        hasCard: false,
        imageMatched: false,
        launchReady: classification.playable,
        playable: classification.playable,
        bios: classification.bios,
        firmware: classification.firmware,
        systemFile: classification.systemFile,
        ignored: classification.ignored,
        classificationReason: classification.reason,
        pathValid: true,
        scannedAt: now,
      } satisfies MiSTerScanEntry;
    });
}

export function summarizeMiSTerEntries(entries: MiSTerScanEntry[]) {
  return {
    platformGroups: Array.from(new Set(entries.map((entry) => entry.platformGroup))).sort(),
    systemIds: Array.from(new Set(entries.map((entry) => entry.systemId))).sort(),
    folderNames: Array.from(new Set(entries.map((entry) => entry.folderName))).sort(),
  };
}
