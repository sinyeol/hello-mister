import type {
  ZaparooAllowedIpsRecommendationMode,
  ZaparooConfigApplyResult,
  ZaparooConfigPatchChange,
  ZaparooConfigPatchPlan,
  ZaparooConfigRecommendation,
} from '../../types/zaparoo';
import { zaparooConfigPath } from './zaparooConfigDiagnostics';

export const zaparooConfigBackupDirectory = '/media/fat/zaparoo/backups';
export const zaparooRecommendedAllowRun = ['**launch:/media/fat/(games|_Arcade)/.*'];

export function zaparooConfigBackupFileName(date = new Date()) {
  const stamp = date.toISOString().replace(/[-:]/g, '').replace(/T/, '-').slice(0, 15);
  return `config.toml.${stamp}.bak`;
}

function stripComment(line: string) {
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === '"' || char === "'") && line[index - 1] !== '\\') quote = quote === char ? undefined : quote ?? char;
    if (!quote && char === '#') return line.slice(0, index);
  }
  return line;
}

function quoteTomlString(value: string) {
  return `'${String(value).replace(/'/g, "\\'")}'`;
}

function doubleQuoteTomlString(value: string) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function formatArray(values: string[]) {
  if (!values.length) return '[]';
  return `[
  ${values.map(quoteTomlString).join(',\n  ')}
]`;
}

function valueForKey(key: ZaparooConfigPatchChange['key'], recommendation: ZaparooConfigRecommendation) {
  if (key === 'api_port') return String(recommendation.apiPort);
  if (key === 'api_listen') return doubleQuoteTomlString(recommendation.apiListen);
  if (key === 'allowed_ips') return formatArray(recommendation.allowedIps);
  if (key === 'allow_run') return formatArray(recommendation.allowRun);
  return '[service]';
}

function keyLine(key: Exclude<ZaparooConfigPatchChange['key'], '[service]'>, recommendation: ZaparooConfigRecommendation) {
  return `${key} = ${valueForKey(key, recommendation)}`;
}

function firstUsableIp(localIpCandidates: string[]) {
  return localIpCandidates.find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !ip.startsWith('127.')) ?? localIpCandidates[0] ?? '';
}

function subnet24(ip: string) {
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0/24` : '';
}

export function createZaparooConfigRecommendation(
  mode: ZaparooAllowedIpsRecommendationMode = 'single-ip',
  localIpCandidates: string[] = [],
): ZaparooConfigRecommendation {
  const localIp = firstUsableIp(localIpCandidates);
  const subnet = localIp ? subnet24(localIp) : '';
  return {
    mode,
    apiPort: 7497,
    apiListen: '0.0.0.0',
    allowedIps: mode === 'subnet-24' ? (subnet ? [subnet] : []) : (localIp ? [localIp] : []),
    allowRun: [...zaparooRecommendedAllowRun],
    localIp: localIp || undefined,
    subnet: subnet || undefined,
    notes: [
      mode === 'subnet-24'
        ? '현재 PC가 있는 /24 subnet을 허용하는 편의 추천입니다.'
        : '현재 PC IP 1개만 허용하는 보수적 추천입니다.',
      '/media/fat/games와 /media/fat/_Arcade 아래 실행만 기본 허용합니다.',
      '앱은 적용 전에 변경점과 백업 위치를 보여줍니다.',
    ],
  };
}

function findServiceRange(lines: string[]) {
  let start = -1;
  let end = lines.length;
  for (let index = 0; index < lines.length; index += 1) {
    const heading = stripComment(lines[index]).trim().match(/^\[([^\]]+)\]$/);
    if (!heading) continue;
    if (heading[1].trim() === 'service') {
      start = index;
      continue;
    }
    if (start >= 0) {
      end = index;
      break;
    }
  }
  return { start, end };
}

function currentValue(lines: string[], start: number, end: number, key: string) {
  const collected: string[] = [];
  let collecting = false;
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index];
    if (!collecting && new RegExp(`^\\s*${key}\\s*=`).test(stripComment(line))) {
      collected.push(line.trim());
      collecting = line.includes('[') && !line.includes(']');
      continue;
    }
    if (collecting) {
      collected.push(line.trim());
      if (line.includes(']')) break;
    }
  }
  return collected.join('\n');
}

function upsertKey(
  lines: string[],
  range: { start: number; end: number },
  key: Exclude<ZaparooConfigPatchChange['key'], '[service]'>,
  recommendation: ZaparooConfigRecommendation,
  changes: ZaparooConfigPatchChange[],
) {
  const next = keyLine(key, recommendation);
  const before = currentValue(lines, range.start, range.end, key);
  if (before) {
    if (before === next) {
      changes.push({ key, action: 'unchanged', before, after: next });
      return range;
    }
    const keyPattern = new RegExp(`^\\s*${key}\\s*=`);
    for (let index = range.start + 1; index < range.end; index += 1) {
      if (!keyPattern.test(stripComment(lines[index]))) continue;
      let deleteEnd = index + 1;
      if (lines[index].includes('[') && !lines[index].includes(']')) {
        while (deleteEnd < range.end && !lines[deleteEnd - 1].includes(']')) deleteEnd += 1;
      }
      const replacement = next.split('\n');
      lines.splice(index, deleteEnd - index, ...replacement);
      const delta = replacement.length - (deleteEnd - index);
      changes.push({ key, action: 'update', before, after: next });
      return { start: range.start, end: range.end + delta };
    }
  }
  const insertion = next.split('\n');
  lines.splice(range.end, 0, ...insertion);
  changes.push({ key, action: 'add', after: next });
  return { start: range.start, end: range.end + insertion.length };
}

function diffPreview(changes: ZaparooConfigPatchChange[]) {
  return changes
    .filter((change) => change.action !== 'unchanged')
    .map((change) => {
      if (change.key === '[service]') return '+ [service]';
      return [
        `# ${change.key}: ${change.action}`,
        change.before ? `- ${change.before}` : undefined,
        `+ ${change.after}`,
      ].filter(Boolean).join('\n');
    })
    .join('\n\n') || '변경점이 없습니다.';
}

export function buildZaparooConfigPatchPlan(
  currentConfigText: string,
  recommendation: ZaparooConfigRecommendation,
  date = new Date(),
): ZaparooConfigPatchPlan {
  const lines = String(currentConfigText || '').split(/\r?\n/);
  const changes: ZaparooConfigPatchChange[] = [];
  let range = findServiceRange(lines);
  if (range.start < 0) {
    if (lines.length && lines.at(-1)?.trim()) lines.push('');
    range = { start: lines.length, end: lines.length + 1 };
    lines.push('[service]');
    changes.push({ key: '[service]', action: 'add', after: '[service]' });
  }
  for (const key of ['api_port', 'api_listen', 'allowed_ips', 'allow_run'] as const) {
    range = upsertKey(lines, range, key, recommendation, changes);
  }
  const backupFileName = zaparooConfigBackupFileName(date);
  const nextPreview = lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  const changed = changes.some((change) => change.action !== 'unchanged');
  return {
    ok: true,
    path: zaparooConfigPath,
    recommendation,
    changes,
    diffPreview: diffPreview(changes),
    nextPreview,
    changed,
    backupFileName,
    remoteBackupPath: `${zaparooConfigBackupDirectory}/${backupFileName}`,
    localBackupRelativePath: `backups/zaparoo/${backupFileName}`,
    safetyMessages: [
      '앱은 Zaparoo config.toml의 [service] 섹션 중 API 접근과 run 허용 설정만 수정합니다.',
      '적용 전 백업을 생성합니다.',
      '설정 변경 후 Zaparoo Core reload 또는 재시작이 필요할 수 있습니다.',
      '원격 파일 쓰기는 Zaparoo config.toml과 해당 백업 파일로만 제한됩니다.',
    ],
    message: changed ? '추천 설정 변경점을 만들었습니다.' : '이미 추천 설정과 같습니다.',
  };
}

export function isAllowedZaparooConfigWritePath(remotePath: string) {
  return remotePath === zaparooConfigPath
    || /^\/media\/fat\/zaparoo\/backups\/config\.toml\.\d{8}-\d{6}\.bak$/.test(remotePath);
}

export function validateZaparooConfigApplyBackups(options: { confirmed: boolean; localBackupOk: boolean; remoteBackupOk: boolean; allowLocalBackupOnly?: boolean }) {
  if (!options.confirmed) return { ok: false, message: '사용자 확인 전에는 적용할 수 없습니다.' };
  if (!options.localBackupOk && !options.remoteBackupOk) return { ok: false, message: '백업 없이 Zaparoo config.toml을 적용할 수 없습니다.' };
  if (!options.remoteBackupOk && !options.allowLocalBackupOnly) {
    return { ok: false, requiresLocalBackupOnlyConfirmation: true, message: '원격 백업에 실패했습니다. 로컬 백업만으로 계속할지 확인이 필요합니다.' };
  }
  return { ok: true, message: '백업 조건을 통과했습니다.' };
}

export function zaparooSettingsReloadFailureMessage() {
  return '설정 파일은 저장됐지만 Zaparoo Core reload에 실패했습니다. Zaparoo Core를 재시작하거나 MiSTer를 재부팅한 뒤 다시 진단하세요.';
}

export function formatZaparooConfigApplyResult(result: ZaparooConfigApplyResult) {
  if (result.ok && result.reloadOk) return '추천 설정을 적용했고 Zaparoo Core reload까지 완료했습니다. 다시 진단해 상태를 확인하세요.';
  if (result.ok && !result.reloadOk) return zaparooSettingsReloadFailureMessage();
  if (result.requiresLocalBackupOnlyConfirmation) return '원격 백업에 실패했습니다. 로컬 백업만으로 계속할지 확인하세요.';
  return result.message || 'Zaparoo config.toml 적용에 실패했습니다.';
}
