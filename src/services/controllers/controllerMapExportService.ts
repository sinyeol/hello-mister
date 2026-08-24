import JSZip from 'jszip';
import type { ActiveMisterProfile } from '../../types/mister';
import type { ControllerConfigFile, ControllerReadFileResult } from '../../types/controllers';
import { mapFileBytesFromReadResult, parseControllerMapFileName } from './controllerMapAnalysisService';

export type ControllerMapPlatformConfidence = 'none' | 'low' | 'medium' | 'high';
export type ControllerMapAnalysisExportMode = 'summary' | 'hash' | 'full';

export interface ControllerMapAnalysisExportFile {
  fileName: string;
  path: string;
  kind: 'joystick-map';
  gameKey: string;
  controllerKey: string;
  vid: string | null;
  pid: string | null;
  version: string | null;
  byteLength: number;
  sha256: string | null;
  hex: string | null;
  bytesBase64: string | null;
  decimalBytes: number[] | null;
  matchedLibraryGameId: string | null;
  matchedGameTitle: string | null;
  matchedPlatform: string | null;
  platformGuess: string | null;
  platformConfidence: ControllerMapPlatformConfidence;
  parseWarnings: string[];
}

export interface ControllerMapAnalysisExportGroup {
  key: string;
  fileCount: number;
  byteLengthCounts?: Record<string, number>;
  gameKeys?: string[];
  controllerKeys?: string[];
  pathsSample?: string[];
  sampleFiles?: string[];
  vid?: string | null;
  pid?: string | null;
  version?: string | null;
  sha256?: string;
  byteLength?: number;
  matchedPlatform?: string | null;
  platformGuess?: string | null;
  platformConfidence?: ControllerMapPlatformConfidence;
  possiblePresetCandidate?: boolean;
}

export interface ControllerMapAnalysisExport {
  schemaVersion: 1;
  exportedAt: string;
  app: {
    name: string;
    version: string;
  };
  mister: {
    profileId: string | null;
    alias: string | null;
    host: string | null;
    port: number | null;
  };
  summary: {
    mapFileCount: number;
    mode: ControllerMapAnalysisExportMode;
    includesFullBytes: boolean;
    controllerGroupCount: number;
    gameKeyCount: number;
    sha256GroupCount: number;
    byteLengthGroups: number;
    platformGroupCount: number;
  };
  files: ControllerMapAnalysisExportFile[];
  groups: {
    byControllerKey: ControllerMapAnalysisExportGroup[];
    byGameKey: ControllerMapAnalysisExportGroup[];
    bySha256: ControllerMapAnalysisExportGroup[];
    byByteLength: ControllerMapAnalysisExportGroup[];
    byPlatform: ControllerMapAnalysisExportGroup[];
  };
  notes: string[];
}

export interface ControllerMapAnalysisExportInput {
  app?: {
    name?: string;
    version?: string;
  };
  activeProfile?: ActiveMisterProfile;
  files: ControllerConfigFile[];
  readResults: Map<string, ControllerReadFileResult>;
  mode?: ControllerMapAnalysisExportMode;
}

export function buildControllerMapAnalysisExport(input: ControllerMapAnalysisExportInput): ControllerMapAnalysisExport {
  const exportedAt = new Date().toISOString();
  const mode = input.mode || 'hash';
  const files = input.files
    .filter((file) => /\.map$/i.test(file.fileName))
    .map((file) => buildExportFile(file, input.readResults.get(file.path), mode))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  const groups = {
    byControllerKey: groupByControllerKey(files),
    byGameKey: groupByGameKey(files),
    bySha256: groupBySha256(files),
    byByteLength: groupByByteLength(files),
    byPlatform: groupByPlatform(files),
  };
  return {
    schemaVersion: 1,
    exportedAt,
    app: {
      name: input.app?.name || 'Hello Mister',
      version: input.app?.version || '2.1.0',
    },
    mister: {
      profileId: input.activeProfile?.profileId || null,
      alias: input.activeProfile?.alias || null,
      host: input.activeProfile?.ipAddress || null,
      port: input.activeProfile?.port || null,
    },
    summary: {
      mapFileCount: files.length,
      mode,
      includesFullBytes: mode === 'full',
      controllerGroupCount: groups.byControllerKey.length,
      gameKeyCount: groups.byGameKey.length,
      sha256GroupCount: groups.bySha256.length,
      byteLengthGroups: groups.byByteLength.length,
      platformGroupCount: groups.byPlatform.length,
    },
    files,
    groups,
    notes: [
      mode === 'full'
        ? 'This full export includes selected raw .map bytes for advanced review.'
        : 'This lightweight export intentionally excludes raw .map bytes, hex, base64, and decimal byte arrays.',
      'This export does not infer button meanings such as A/B/X/Y from byte offsets.',
      'matchedPlatform is reserved for explicit library matches; platformGuess is a filename/platform heuristic and may be wrong.',
      'Secrets such as passwords, private keys, passphrases, and tokens are intentionally not included.',
    ],
  };
}

export function buildControllerMapAnalysisSummaryExport(data: ControllerMapAnalysisExport) {
  return {
    ...data,
    files: data.files.map((file) => ({
      ...file,
      hex: file.hex ? `[redacted from summary export: ${file.byteLength} bytes]` : null,
      bytesBase64: file.bytesBase64 ? `[redacted from summary export: ${file.byteLength} bytes]` : null,
      decimalBytes: file.decimalBytes ? [] : null,
    })),
  };
}

export function buildControllerMapAnalysisCsvFiles(data: ControllerMapAnalysisExport): Record<string, string> {
  return {
    'controller-map-files.csv': toCsv([
      ['fileName', 'path', 'gameKey', 'controllerKey', 'vid', 'pid', 'version', 'byteLength', 'sha256', 'matchedGameTitle', 'matchedPlatform', 'platformGuess', 'platformConfidence', 'parseWarnings'],
      ...data.files.map((file) => [
        file.fileName,
        file.path,
        file.gameKey,
        file.controllerKey,
        file.vid || '',
        file.pid || '',
        file.version || '',
        String(file.byteLength),
        file.sha256 || '',
        file.matchedGameTitle || '',
        file.matchedPlatform || '',
        file.platformGuess || '',
        file.platformConfidence,
        file.parseWarnings.join('; '),
      ]),
    ]),
    'controller-map-groups-controller.csv': toCsv([
      ['controllerKey', 'vid', 'pid', 'version', 'fileCount', 'byteLengthSummary', 'sampleGameKeys', 'sampleFiles'],
      ...data.groups.byControllerKey.map((group) => [
        group.key,
        group.vid || '',
        group.pid || '',
        group.version || '',
        String(group.fileCount),
        formatByteLengthCounts(group.byteLengthCounts),
        (group.gameKeys || []).join('; '),
        (group.sampleFiles || []).join('; '),
      ]),
    ]),
    'controller-map-groups-game.csv': toCsv([
      ['gameKey', 'fileCount', 'controllerKeys', 'matchedPlatform', 'platformGuess', 'platformConfidence', 'sampleFiles'],
      ...data.groups.byGameKey.map((group) => [
        group.key,
        String(group.fileCount),
        (group.controllerKeys || []).join('; '),
        group.matchedPlatform || '',
        group.platformGuess || '',
        group.platformConfidence || 'none',
        (group.sampleFiles || []).join('; '),
      ]),
    ]),
    'controller-map-groups-sha256.csv': toCsv([
      ['sha256', 'byteLength', 'fileCount', 'controllerKeys', 'gameKeys', 'possiblePresetCandidate', 'sampleFiles'],
      ...data.groups.bySha256.map((group) => [
        group.sha256 || group.key,
        String(group.byteLength || 0),
        String(group.fileCount),
        (group.controllerKeys || []).join('; '),
        (group.gameKeys || []).join('; '),
        group.possiblePresetCandidate ? 'true' : 'false',
        (group.sampleFiles || []).join('; '),
      ]),
    ]),
    'controller-map-groups-platform.csv': toCsv([
      ['platform', 'fileCount', 'gameKeyCount', 'controllerKeys', 'confidence', 'sampleGameKeys'],
      ...data.groups.byPlatform.map((group) => [
        group.key,
        String(group.fileCount),
        String((group.gameKeys || []).length),
        (group.controllerKeys || []).join('; '),
        group.platformConfidence || 'none',
        (group.gameKeys || []).slice(0, 24).join('; '),
      ]),
    ]),
  };
}

export function buildControllerMapAnalysisReadme(data: ControllerMapAnalysisExport) {
  return [
    'Hello Mister controller map analysis export',
    '',
    `Exported at: ${data.exportedAt}`,
    `MiSTer: ${data.mister.alias || 'MiSTer'} @ ${data.mister.host || 'unknown'}`,
    `Map files: ${data.summary.mapFileCount}`,
    '',
    `Export mode: ${data.summary.mode}`,
    `Full bytes included: ${data.summary.includesFullBytes ? 'yes' : 'no'}`,
    '',
    'Upload this ZIP to ChatGPT when you want help grouping controller .map files by game, platform, controller VID/PID, SHA-256, or byte length.',
    '',
    'Important safety notes:',
    '- Default exports are lightweight and do not include raw map bytes, hex, base64, or decimal byte arrays.',
    '- Full byte exports are advanced and should be limited to selected groups/files when possible.',
    '- Byte values, when included, are raw map data, not button names.',
    '- The app does not infer A/B/X/Y or controller layout meanings from offsets.',
    '- platformGuess is only a conservative filename/platform heuristic.',
    '- matchedPlatform is separate from platformGuess and is blank unless an explicit library match is available.',
    '- Passwords, private keys, passphrases, tokens, and local Windows user paths are not included.',
    '',
    'Files in this ZIP:',
    '- controller-map-analysis.json: structured export with files and groups.',
    '- controller-map-files.csv: one row per .map file.',
    '- controller-map-groups-controller.csv: grouped by inferred controller key.',
    '- controller-map-groups-game.csv: grouped by inferred game key.',
    '- controller-map-groups-sha256.csv: grouped by SHA-256.',
    '- controller-map-groups-platform.csv: grouped by matched/guessed platform.',
    '- README.txt: this guide.',
  ].join('\n');
}

export async function buildControllerMapAnalysisZip(data: ControllerMapAnalysisExport) {
  const zip = new JSZip();
  zip.file('controller-map-analysis.json', JSON.stringify(data, null, 2));
  const csvFiles = buildControllerMapAnalysisCsvFiles(data);
  for (const [fileName, content] of Object.entries(csvFiles)) zip.file(fileName, content);
  zip.file('README.txt', buildControllerMapAnalysisReadme(data));
  return zip.generateAsync({ type: 'uint8array' });
}

export function encodeTextForExport(text: string) {
  return new TextEncoder().encode(text);
}

function buildExportFile(file: ControllerConfigFile, readResult: ControllerReadFileResult | undefined, mode: ControllerMapAnalysisExportMode): ControllerMapAnalysisExportFile {
  const parsed = parseControllerMapFileName(file.fileName);
  const bytes = mode === 'full' ? mapFileBytesFromReadResult(readResult) : undefined;
  const byteLength = bytes?.length || readResult?.preview?.byteCount || Number(file.sizeBytes || 0);
  const platform = guessPlatform(parsed.gameKey);
  const parseWarnings: string[] = [];
  if (!parsed.isRecognizedInputMap) parseWarnings.push('Filename does not match game_input_VID_PID_vN.map pattern.');
  if (mode !== 'summary' && !readResult?.ok) parseWarnings.push(readResult?.message || 'Read result is unavailable.');
  if (mode === 'full' && !bytes) parseWarnings.push('Raw bytes were unavailable; byte fields may be incomplete.');
  if (mode === 'summary') parseWarnings.push('Summary mode uses inventory metadata only; SHA-256 and raw bytes are not included.');

  return {
    fileName: sanitizeFilename(file.fileName),
    path: sanitizeRemotePath(file.path),
    kind: 'joystick-map',
    gameKey: parsed.gameKey,
    controllerKey: parsed.controllerKey,
    vid: parsed.vid || null,
    pid: parsed.pid || null,
    version: parsed.version || null,
    byteLength,
    sha256: readResult?.sha256 || null,
    hex: bytes && bytes.length <= 2048 ? bytesToHex(bytes) : null,
    bytesBase64: mode === 'full' ? (readResult?.bytesBase64 || (bytes ? bytesToBase64(bytes) : null)) : null,
    decimalBytes: bytes && bytes.length <= 2048 ? [...bytes] : null,
    matchedLibraryGameId: null,
    matchedGameTitle: null,
    matchedPlatform: null,
    platformGuess: platform.platformGuess,
    platformConfidence: platform.platformConfidence,
    parseWarnings,
  };
}

function groupByControllerKey(files: ControllerMapAnalysisExportFile[]): ControllerMapAnalysisExportGroup[] {
  return groupFiles(files, (file) => file.controllerKey).map((group) => {
    const first = group.files[0];
    return {
      key: group.key,
      fileCount: group.files.length,
      vid: first?.vid || null,
      pid: first?.pid || null,
      version: first?.version || null,
      byteLengthCounts: countBy(group.files, (file) => `${file.byteLength}`),
      gameKeys: unique(group.files.map((file) => file.gameKey)).slice(0, 48),
      pathsSample: group.files.slice(0, 10).map((file) => file.path),
      sampleFiles: group.files.slice(0, 10).map((file) => file.fileName),
    };
  });
}

function groupByGameKey(files: ControllerMapAnalysisExportFile[]): ControllerMapAnalysisExportGroup[] {
  return groupFiles(files, (file) => file.gameKey).map((group) => {
    const firstPlatform = pickBestPlatformGuess(group.files);
    return {
      key: group.key,
      fileCount: group.files.length,
      byteLengthCounts: countBy(group.files, (file) => `${file.byteLength}`),
      controllerKeys: unique(group.files.map((file) => file.controllerKey)).slice(0, 48),
      matchedPlatform: firstPlatform.matchedPlatform,
      platformGuess: firstPlatform.platformGuess,
      platformConfidence: firstPlatform.platformConfidence,
      pathsSample: group.files.slice(0, 10).map((file) => file.path),
      sampleFiles: group.files.slice(0, 10).map((file) => file.fileName),
    };
  });
}

function groupBySha256(files: ControllerMapAnalysisExportFile[]): ControllerMapAnalysisExportGroup[] {
  return groupFiles(files.filter((file) => Boolean(file.sha256)), (file) => file.sha256 || '').map((group) => ({
    key: group.key,
    sha256: group.key,
    fileCount: group.files.length,
    byteLength: group.files[0]?.byteLength || 0,
    byteLengthCounts: countBy(group.files, (file) => `${file.byteLength}`),
    controllerKeys: unique(group.files.map((file) => file.controllerKey)).slice(0, 48),
    gameKeys: unique(group.files.map((file) => file.gameKey)).slice(0, 48),
    possiblePresetCandidate: group.files.length > 1,
    pathsSample: group.files.slice(0, 10).map((file) => file.path),
    sampleFiles: group.files.slice(0, 10).map((file) => file.fileName),
  }));
}

function groupByByteLength(files: ControllerMapAnalysisExportFile[]): ControllerMapAnalysisExportGroup[] {
  return groupFiles(files, (file) => `${file.byteLength}`).map((group) => ({
    key: group.key,
    byteLength: Number(group.key),
    fileCount: group.files.length,
    controllerKeys: unique(group.files.map((file) => file.controllerKey)).slice(0, 48),
    gameKeys: unique(group.files.map((file) => file.gameKey)).slice(0, 48),
    pathsSample: group.files.slice(0, 10).map((file) => file.path),
    sampleFiles: group.files.slice(0, 10).map((file) => file.fileName),
  }));
}

function groupByPlatform(files: ControllerMapAnalysisExportFile[]): ControllerMapAnalysisExportGroup[] {
  return groupFiles(files, (file) => file.matchedPlatform || file.platformGuess || 'unknown').map((group) => {
    const firstPlatform = pickBestPlatformGuess(group.files);
    return {
      key: group.key,
      fileCount: group.files.length,
      controllerKeys: unique(group.files.map((file) => file.controllerKey)).slice(0, 48),
      gameKeys: unique(group.files.map((file) => file.gameKey)).slice(0, 96),
      platformGuess: firstPlatform.platformGuess,
      matchedPlatform: firstPlatform.matchedPlatform,
      platformConfidence: firstPlatform.platformConfidence,
      sampleFiles: group.files.slice(0, 10).map((file) => file.fileName),
    };
  });
}

function groupFiles(files: ControllerMapAnalysisExportFile[], keyFactory: (file: ControllerMapAnalysisExportFile) => string) {
  const groups = new Map<string, ControllerMapAnalysisExportFile[]>();
  for (const file of files) {
    const key = keyFactory(file) || 'unknown';
    groups.set(key, [...(groups.get(key) || []), file]);
  }
  return [...groups.entries()]
    .map(([key, groupedFiles]) => ({ key, files: groupedFiles }))
    .sort((a, b) => b.files.length - a.files.length || a.key.localeCompare(b.key));
}

function countBy(files: ControllerMapAnalysisExportFile[], keyFactory: (file: ControllerMapAnalysisExportFile) => string) {
  return files.reduce<Record<string, number>>((counts, file) => {
    const key = keyFactory(file) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function pickBestPlatformGuess(files: ControllerMapAnalysisExportFile[]) {
  const matched = files.find((file) => file.matchedPlatform);
  if (matched) {
    return {
      matchedPlatform: matched.matchedPlatform,
      platformGuess: matched.platformGuess,
      platformConfidence: 'high' as ControllerMapPlatformConfidence,
    };
  }
  const order: ControllerMapPlatformConfidence[] = ['high', 'medium', 'low', 'none'];
  return [...files].sort((a, b) => order.indexOf(a.platformConfidence) - order.indexOf(b.platformConfidence))[0] || {
    matchedPlatform: null,
    platformGuess: null,
    platformConfidence: 'none' as ControllerMapPlatformConfidence,
  };
}

function guessPlatform(gameKey: string): { platformGuess: string | null; platformConfidence: ControllerMapPlatformConfidence } {
  const key = normalizeKey(gameKey);
  if (!key || key === 'unknown') return { platformGuess: null, platformConfidence: 'none' };
  if (/^(neogeo|neo geo|neo-geo|ng)/i.test(gameKey) || key.includes('neogeo')) return { platformGuess: 'NeoGeo', platformConfidence: 'high' };
  if (key.includes('saturnstv') || key.includes('stv')) return { platformGuess: 'Arcade / Sega ST-V', platformConfidence: 'low' };
  if (/^cps[123]?$/.test(key) || key.includes('cps1') || key.includes('cps2') || key.includes('cps3')) return { platformGuess: 'Arcade / CPS', platformConfidence: 'low' };
  if (key.includes('pgm')) return { platformGuess: 'PGM', platformConfidence: 'low' };
  return { platformGuess: null, platformConfidence: 'none' };
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/[\s_.\-/()[\]]+/g, '');
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function sanitizeFilename(value: string) {
  return value.replace(/[\0\r\n]/g, '').slice(0, 240);
}

function sanitizeRemotePath(value: string) {
  if (/^[A-Za-z]:[\\/]/.test(value) || /[\\/]Users[\\/]/i.test(value)) return '[local-path-redacted]';
  return value.replace(/[\0\r\n]/g, '').slice(0, 1024);
}

function toCsv(rows: Array<Array<string | number | boolean | null | undefined>>) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

function csvCell(value: string | number | boolean | null | undefined) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatByteLengthCounts(counts?: Record<string, number>) {
  return counts ? Object.entries(counts).map(([length, count]) => `${length}:${count}`).join('; ') : '';
}
