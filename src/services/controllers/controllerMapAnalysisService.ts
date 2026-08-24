import type { ControllerConfigFile, ControllerReadFileResult } from '../../types/controllers';

export type ControllerMapPresetType = 'neogeo-4-button' | 'cps-6-button' | 'console-pad' | 'mega-drive-6-button' | 'snes' | 'arcade-common' | 'custom';

export interface ControllerMapFileNameAnalysis {
  fileName: string;
  gameKey: string;
  controllerKey: string;
  vid?: string;
  pid?: string;
  version?: string;
  extension: string;
  isRecognizedInputMap: boolean;
  confidenceLabel: string;
}

export interface ControllerMapFileGroup {
  key: string;
  label: string;
  files: ControllerConfigFile[];
  byteLengthCounts: Record<string, number>;
  sampleFileNames: string[];
}

export interface ControllerMapDiffRow {
  offset: number;
  aHex: string;
  bHex: string;
  aDec?: number;
  bDec?: number;
}

export interface ControllerMapDiffResult {
  aLength: number;
  bLength: number;
  sameLength: boolean;
  identical: boolean;
  differenceCount: number;
  shownDifferences: ControllerMapDiffRow[];
  lengthWarning?: string;
}

export interface ControllerMapPreset {
  presetId: string;
  name: string;
  type: ControllerMapPresetType;
  sourceFilePath: string;
  sourceKind?: 'single-file' | 'sha256-group';
  sourceSha256?: string;
  sourceFileName?: string;
  coveredGameKeys?: string[];
  coveredFileCount?: number;
  familyGuess?: string;
  controllerKey: string;
  gameKey: string;
  byteLength: number;
  bytesBase64: string;
  sha256: string;
  createdAt: string;
  updatedAt: string;
  notes: string;
}

export type ControllerMapPresetCandidateConfidence = 'low' | 'medium' | 'high';

export interface ControllerMapPresetCandidateHashEntry {
  file: ControllerConfigFile;
  sha256?: string;
  ok?: boolean;
  message?: string;
}

export interface ControllerMapPresetCandidate {
  candidateId: string;
  controllerKey: string;
  vid?: string;
  pid?: string;
  version?: string;
  byteLength: number;
  sha256: string;
  fileCount: number;
  representativeFile: ControllerConfigFile;
  representativePath: string;
  sampleGameKeys: string[];
  sampleFiles: string[];
  familyGuess: string;
  confidence: ControllerMapPresetCandidateConfidence;
  isRecommended: boolean;
  warnings: string[];
  files: ControllerConfigFile[];
}

export interface ControllerMapApplyPlan {
  sourcePreset: ControllerMapPreset;
  targetFile: ControllerConfigFile;
  targetAnalysis: ControllerMapFileNameAnalysis;
  targetSha256: string;
  presetSha256: string;
  byteLengthMatches: boolean;
  controllerKeyMatches: boolean;
  targetPathAllowed: boolean;
  allowed: boolean;
  backupRequired: boolean;
  diff: ControllerMapDiffResult;
  warnings: string[];
}

const presetStorageKey = 'hello-mister-controller-map-presets-v1';

export const controllerMapPresetTypeLabels: Record<ControllerMapPresetType, string> = {
  'neogeo-4-button': 'NeoGeo 4버튼',
  'cps-6-button': 'CPS 6버튼',
  'console-pad': 'Console Pad',
  'mega-drive-6-button': 'Mega Drive 6버튼',
  snes: 'SNES',
  'arcade-common': 'Arcade Common',
  custom: 'Custom',
};

export function parseControllerMapFileName(fileName: string): ControllerMapFileNameAnalysis {
  const extensionMatch = fileName.match(/(\.[^.]+)$/);
  const extension = extensionMatch?.[1] || '';
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName;
  const match = baseName.match(/^(.+)_input_([0-9a-f]{4})_([0-9a-f]{4})_(v[0-9]+)$/i);
  if (!match) {
    return {
      fileName,
      gameKey: 'unknown',
      controllerKey: 'unknown',
      extension,
      isRecognizedInputMap: false,
      confidenceLabel: '파일명 규칙 미확인',
    };
  }
  const [, gameKey, vid, pid, version] = match;
  return {
    fileName,
    gameKey,
    controllerKey: `${vid.toUpperCase()}_${pid.toUpperCase()}_${version.toLowerCase()}`,
    vid: vid.toUpperCase(),
    pid: pid.toUpperCase(),
    version: version.toLowerCase(),
    extension,
    isRecognizedInputMap: /\.map$/i.test(extension),
    confidenceLabel: '파일명 기반 추정',
  };
}

export function mapFileBytesFromReadResult(result?: ControllerReadFileResult): Uint8Array | undefined {
  if (!result?.ok) return undefined;
  if (result.bytesBase64) return decodeBase64ToBytes(result.bytesBase64);
  const decimal = result.preview?.decimalBytes;
  if (!decimal) return undefined;
  const bytes = decimal
    .split(/\s+/)
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 255);
  return bytes.length > 0 ? Uint8Array.from(bytes) : undefined;
}

export function compareControllerMapBytes(aBytes: Uint8Array, bBytes: Uint8Array, maxRows = 120): ControllerMapDiffResult {
  const maxLength = Math.max(aBytes.length, bBytes.length);
  const rows: ControllerMapDiffRow[] = [];
  let differenceCount = 0;
  for (let offset = 0; offset < maxLength; offset += 1) {
    const aDec = offset < aBytes.length ? aBytes[offset] : undefined;
    const bDec = offset < bBytes.length ? bBytes[offset] : undefined;
    if (aDec !== bDec) {
      differenceCount += 1;
      if (rows.length < maxRows) {
        rows.push({
          offset,
          aHex: byteToHex(aDec),
          bHex: byteToHex(bDec),
          aDec,
          bDec,
        });
      }
    }
  }
  return {
    aLength: aBytes.length,
    bLength: bBytes.length,
    sameLength: aBytes.length === bBytes.length,
    identical: differenceCount === 0,
    differenceCount,
    shownDifferences: rows,
    lengthWarning: aBytes.length === bBytes.length ? undefined : '파일 길이가 다릅니다. offset 비교는 가능하지만 바로 적용할 수 없습니다.',
  };
}

export function groupControllerMapFiles(files: ControllerConfigFile[]) {
  const mapFiles = files.filter((file) => /\.map$/i.test(file.fileName));
  return {
    byController: groupBy(mapFiles, (file) => parseControllerMapFileName(file.fileName).controllerKey || 'unknown'),
    byGame: groupBy(mapFiles, (file) => parseControllerMapFileName(file.fileName).gameKey || 'unknown'),
    byLength: groupBy(mapFiles, (file) => `${Number(file.sizeBytes || 0)} bytes`),
  };
}

export function summarizeFrequentDiffOffsets(diffResults: ControllerMapDiffResult[], limit = 20) {
  const counts = new Map<number, number>();
  for (const diff of diffResults) {
    for (const row of diff.shownDifferences) counts.set(row.offset, (counts.get(row.offset) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([offset, count]) => ({ offset, count }))
    .sort((a, b) => b.count - a.count || a.offset - b.offset)
    .slice(0, limit);
}

export function pickDominantControllerKey(files: ControllerConfigFile[]) {
  const counts = new Map<string, number>();
  for (const file of files.filter((item) => /\.map$/i.test(item.fileName))) {
    const key = parseControllerMapFileName(file.fileName).controllerKey || 'unknown';
    if (key === 'unknown') continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '';
}

export function buildControllerMapPresetCandidates(
  entries: ControllerMapPresetCandidateHashEntry[],
  options: { minFileCount?: number; representativeOverrides?: Record<string, string>; dominantControllerKey?: string } = {},
): ControllerMapPresetCandidate[] {
  const minFileCount = options.minFileCount ?? 5;
  const mapEntries = entries.filter((entry) => /\.map$/i.test(entry.file.fileName) && entry.sha256);
  const dominantControllerKey = options.dominantControllerKey || pickDominantControllerKey(mapEntries.map((entry) => entry.file));
  const groups = new Map<string, ControllerConfigFile[]>();

  for (const entry of mapEntries) {
    const parsed = parseControllerMapFileName(entry.file.fileName);
    const byteLength = Number(entry.file.sizeBytes || 0);
    const key = `${parsed.controllerKey || 'unknown'}|${byteLength}|${entry.sha256}`;
    groups.set(key, [...(groups.get(key) || []), entry.file]);
  }

  return [...groups.entries()]
    .map(([key, files]) => {
      const [controllerKey, byteLengthText, sha256] = key.split('|');
      const byteLength = Number(byteLengthText || 0);
      const parsed = parseControllerMapFileName(files[0]?.fileName || '');
      const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
      const overridePath = options.representativeOverrides?.[key];
      const representativeFile = sortedFiles.find((file) => file.path === overridePath) || selectRepresentativeMapFile(sortedFiles);
      const sampleGameKeys = uniqueNonEmpty(
        sortedFiles
          .map((file) => parseControllerMapFileName(file.fileName).gameKey)
          .filter((gameKey) => gameKey !== 'unknown'),
      ).slice(0, 20);
      const family = guessControllerMapFamily(sampleGameKeys);
      const warnings: string[] = [];
      if (byteLength === 2048) warnings.push('2048-byte map exception group. Exclude from default apply targets.');
      if (controllerKey === 'unknown') warnings.push('Filename rule is unknown. Verify manually before saving as preset.');
      if (files.length < minFileCount) warnings.push(`File count is below preset candidate threshold (${minFileCount}).`);
      const isRecommended = controllerKey !== 'unknown' && byteLength === 128 && files.length >= minFileCount;
      return {
        candidateId: key,
        controllerKey,
        vid: parsed.vid,
        pid: parsed.pid,
        version: parsed.version,
        byteLength,
        sha256,
        fileCount: files.length,
        representativeFile,
        representativePath: representativeFile.path,
        sampleGameKeys,
        sampleFiles: sortedFiles.slice(0, 8).map((file) => file.fileName),
        familyGuess: family.label,
        confidence: family.confidence,
        isRecommended,
        warnings,
        files: sortedFiles,
      };
    })
    .sort((a, b) => {
      const recommendedSort = Number(b.isRecommended) - Number(a.isRecommended);
      if (recommendedSort) return recommendedSort;
      const dominantSort = Number(b.controllerKey === dominantControllerKey) - Number(a.controllerKey === dominantControllerKey);
      if (dominantSort) return dominantSort;
      const lengthSort = Number(a.byteLength === 2048) - Number(b.byteLength === 2048) || Number(b.byteLength === 128) - Number(a.byteLength === 128);
      if (lengthSort) return lengthSort;
      return b.fileCount - a.fileCount || a.familyGuess.localeCompare(b.familyGuess) || a.sha256.localeCompare(b.sha256);
    });
}

export function loadControllerMapPresets(): ControllerMapPreset[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(presetStorageKey) || '[]') as ControllerMapPreset[];
    return Array.isArray(parsed) ? parsed.filter(isControllerMapPreset) : [];
  } catch {
    return [];
  }
}

export function saveControllerMapPreset(preset: ControllerMapPreset): ControllerMapPreset[] {
  const existing = loadControllerMapPresets();
  const next = [preset, ...existing.filter((item) => item.presetId !== preset.presetId)].slice(0, 200);
  if (typeof window !== 'undefined') window.localStorage.setItem(presetStorageKey, JSON.stringify(next, null, 2));
  return next;
}

export function deleteControllerMapPreset(presetId: string): ControllerMapPreset[] {
  const next = loadControllerMapPresets().filter((item) => item.presetId !== presetId);
  if (typeof window !== 'undefined') window.localStorage.setItem(presetStorageKey, JSON.stringify(next, null, 2));
  return next;
}

export async function createControllerMapPresetFromFile(
  file: ControllerConfigFile,
  readResult: ControllerReadFileResult,
  input: { name: string; type: ControllerMapPresetType; notes?: string },
): Promise<ControllerMapPreset> {
  const bytes = mapFileBytesFromReadResult(readResult);
  if (!bytes) throw new Error('프리셋으로 저장할 byte 데이터를 읽지 못했습니다.');
  const parsed = parseControllerMapFileName(file.fileName);
  const now = new Date().toISOString();
  return {
    presetId: `preset-${slug(input.name)}-${parsed.controllerKey}-${now.replace(/[^0-9]/g, '').slice(0, 14)}`,
    name: input.name.trim() || `${parsed.gameKey} - ${parsed.controllerKey}`,
    type: input.type,
    sourceFilePath: file.path,
    controllerKey: parsed.controllerKey,
    gameKey: parsed.gameKey,
    byteLength: bytes.length,
    bytesBase64: encodeBytesBase64(bytes),
    sha256: readResult.sha256 || await sha256Hex(bytes),
    createdAt: now,
    updatedAt: now,
    notes: input.notes || '',
  };
}

export async function createControllerMapPresetFromCandidate(
  candidate: ControllerMapPresetCandidate,
  representativeFile: ControllerConfigFile,
  readResult: ControllerReadFileResult,
  input: { name: string; type: ControllerMapPresetType; notes?: string },
): Promise<ControllerMapPreset> {
  const bytes = mapFileBytesFromReadResult(readResult);
  if (!bytes) throw new Error('Could not read representative .map bytes for preset candidate.');
  const sha256 = readResult.sha256 || await sha256Hex(bytes);
  if (sha256 !== candidate.sha256) {
    throw new Error('Representative .map hash changed. Refresh candidates before saving this preset.');
  }
  const parsed = parseControllerMapFileName(representativeFile.fileName);
  const now = new Date().toISOString();
  return {
    presetId: `preset-${slug(input.name)}-${candidate.controllerKey}-${now.replace(/[^0-9]/g, '').slice(0, 14)}`,
    name: input.name.trim() || `${candidate.familyGuess} - ${candidate.controllerKey}`,
    type: input.type,
    sourceKind: 'sha256-group',
    sourceSha256: candidate.sha256,
    sourceFileName: representativeFile.fileName,
    coveredGameKeys: candidate.sampleGameKeys,
    coveredFileCount: candidate.fileCount,
    familyGuess: candidate.familyGuess,
    sourceFilePath: representativeFile.path,
    controllerKey: candidate.controllerKey,
    gameKey: parsed.gameKey,
    byteLength: bytes.length,
    bytesBase64: encodeBytesBase64(bytes),
    sha256,
    createdAt: now,
    updatedAt: now,
    notes: input.notes || `SHA group preset candidate. Covers ${candidate.fileCount} files. ${candidate.warnings.join(' ')}`.trim(),
  };
}

export async function createControllerMapApplyPlan(
  preset: ControllerMapPreset,
  targetFile: ControllerConfigFile,
  targetReadResult: ControllerReadFileResult,
): Promise<ControllerMapApplyPlan> {
  const targetBytes = mapFileBytesFromReadResult(targetReadResult);
  if (!targetBytes) throw new Error('대상 .map 파일 byte 데이터를 읽지 못했습니다.');
  const presetBytes = decodeBase64ToBytes(preset.bytesBase64);
  const targetAnalysis = parseControllerMapFileName(targetFile.fileName);
  const diff = compareControllerMapBytes(targetBytes, presetBytes);
  const byteLengthMatches = targetBytes.length === presetBytes.length;
  const controllerKeyMatches = preset.controllerKey !== 'unknown' && preset.controllerKey === targetAnalysis.controllerKey;
  const targetPathAllowed = isControllerMapApplyTargetPath(targetFile.path);
  const warnings: string[] = [];
  if (!targetPathAllowed) warnings.push('Default apply target must be under /media/fat/config/inputs/*.map. This target is blocked.');
  if (!byteLengthMatches) warnings.push('프리셋과 대상 .map 파일의 byte 길이가 달라 적용할 수 없습니다.');
  if (!controllerKeyMatches) warnings.push('프리셋과 대상 파일의 조이스틱 키가 다릅니다. 다른 조이스틱용 map일 수 있습니다.');
  if (diff.identical) warnings.push('프리셋과 대상 파일이 이미 동일합니다.');
  return {
    sourcePreset: preset,
    targetFile,
    targetAnalysis,
    targetSha256: targetReadResult.sha256 || await sha256Hex(targetBytes),
    presetSha256: preset.sha256,
    byteLengthMatches,
    controllerKeyMatches,
    targetPathAllowed,
    allowed: byteLengthMatches && controllerKeyMatches && targetPathAllowed,
    backupRequired: true,
    diff,
    warnings,
  };
}

export function isControllerMapApplyTargetPath(remotePath: string) {
  return /^\/media\/fat\/config\/inputs\/[^/\\]+\.map$/i.test(remotePath);
}

function groupBy(files: ControllerConfigFile[], keyFactory: (file: ControllerConfigFile) => string): ControllerMapFileGroup[] {
  const groups = new Map<string, ControllerConfigFile[]>();
  for (const file of files) {
    const key = keyFactory(file);
    groups.set(key, [...(groups.get(key) || []), file]);
  }
  return [...groups.entries()]
    .map(([key, groupedFiles]) => ({
      key,
      label: key === 'unknown' ? 'unknown (파일명 규칙 미확인)' : key,
      files: groupedFiles,
      byteLengthCounts: groupedFiles.reduce<Record<string, number>>((counts, file) => {
        const length = `${Number(file.sizeBytes || 0)} bytes`;
        counts[length] = (counts[length] || 0) + 1;
        return counts;
      }, {}),
      sampleFileNames: groupedFiles.slice(0, 5).map((file) => file.fileName),
    }))
    .sort((a, b) => b.files.length - a.files.length || a.key.localeCompare(b.key));
}

function selectRepresentativeMapFile(files: ControllerConfigFile[]) {
  return [...files].sort((a, b) => {
    const aParsed = parseControllerMapFileName(a.fileName);
    const bParsed = parseControllerMapFileName(b.fileName);
    const recognizedSort = Number(bParsed.isRecognizedInputMap) - Number(aParsed.isRecognizedInputMap);
    if (recognizedSort) return recognizedSort;
    return a.fileName.length - b.fileName.length || a.fileName.localeCompare(b.fileName);
  })[0]!;
}

function uniqueNonEmpty(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function guessControllerMapFamily(gameKeys: string[]): { label: string; confidence: ControllerMapPresetCandidateConfidence } {
  const text = gameKeys.join(' ').toLowerCase();
  if (/(neogeo|kof|samsho|mslug|fatalfury|garou|lastblad)/.test(text)) return { label: 'NeoGeo / SNK generic', confidence: 'medium' };
  if (/(sf2|dstlk|vamp|msh|mvsc|xmcota|hsf2|sfa|spf2t|vhunt|vsav)/.test(text)) return { label: 'Capcom CPS fighting 6-button', confidence: 'medium' };
  if (/(1941|1942|1943|1944|19xx|cawing|area88|armwar|3wonders)/.test(text)) return { label: 'Capcom CPS shooter/puzzle/action', confidence: 'medium' };
  if (/(ddonpach|donpach|esprade|batrider|bbakraid|dfeveron|raiden|toaplan)/.test(text)) return { label: 'Cave/Raizing/Toaplan shooter', confidence: 'medium' };
  if (/(pgm|ddp2|kov|olds|orlegend|martmast)/.test(text)) return { label: 'PGM candidate', confidence: 'low' };
  if (/(bakubaku|colmns97|cotton2|diehard|dnmtdeka|stv|saturn)/.test(text)) return { label: 'Sega ST-V / Saturn arcade', confidence: 'low' };
  return { label: 'Unknown / mixed arcade', confidence: 'low' };
}

function byteToHex(value?: number) {
  return typeof value === 'number' ? value.toString(16).toUpperCase().padStart(2, '0') : '--';
}

function encodeBytesBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function decodeBase64ToBytes(base64: string) {
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function sha256Hex(bytes: Uint8Array) {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return `sha256-unavailable-${bytes.length}-${[...bytes].reduce((sum, byte) => (sum + byte) % 65536, 0)}`;
}

function isControllerMapPreset(value: ControllerMapPreset) {
  return Boolean(value?.presetId && value.name && value.bytesBase64 && value.sha256);
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9가-힣_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'controller-map';
}
