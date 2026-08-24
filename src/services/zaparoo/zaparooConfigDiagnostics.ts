import type { ZaparooConfigArrayStatus, ZaparooConfigDiagnostics, ZaparooRunFailureCode } from '../../types/zaparoo';

export const zaparooConfigPath = '/media/fat/zaparoo/config.toml';

function stripComment(line: string) {
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === '"' || char === "'") && line[index - 1] !== '\\') {
      quote = quote === char ? undefined : quote ?? char;
    }
    if (!quote && char === '#') return line.slice(0, index);
  }
  return line;
}

function sectionBody(text: string, sectionName: string) {
  const lines = text.split(/\r?\n/);
  const body: string[] = [];
  let active = false;
  for (const line of lines) {
    const trimmed = stripComment(line).trim();
    const heading = trimmed.match(/^\[([^\]]+)\]$/);
    if (heading) {
      active = heading[1].trim() === sectionName;
      continue;
    }
    if (active) body.push(line);
  }
  return body.join('\n');
}

function parseArray(section: string, key: string): ZaparooConfigArrayStatus {
  const match = section.match(new RegExp(`${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm'));
  if (!match) {
    const malformed = new RegExp(`(^|\\n)\\s*${key}\\s*=`, 'm').test(section);
    return {
      present: malformed,
      values: [],
      count: 0,
      empty: true,
      parseError: malformed ? `${key} 배열을 해석하지 못했습니다.` : undefined,
    };
  }
  const raw = match[1]
    .split(/\r?\n|,/)
    .map((item) => stripComment(item).trim())
    .map((item) => item.replace(/^['"]|['"]$/g, '').trim())
    .filter(Boolean);
  return { present: true, values: raw, count: raw.length, empty: raw.length === 0 };
}

function configGuidance(diagnostics: Pick<ZaparooConfigDiagnostics, 'serviceFound' | 'allowRun' | 'allowedIps'>) {
  const guidance: string[] = [];
  if (!diagnostics.serviceFound) {
    guidance.push('[service] 섹션을 찾지 못했습니다. Zaparoo Web UI 또는 config.toml에서 service 설정을 확인하세요.');
  }
  if (!diagnostics.allowRun.present || diagnostics.allowRun.empty) {
    guidance.push('config.toml의 [service] allow_run이 비어 있거나 없습니다. 원격 실행이 차단될 수 있습니다.');
  } else {
    guidance.push(`allow_run 패턴 ${diagnostics.allowRun.count}개를 확인했습니다. 실행하려는 ZapScript 전체와 매칭되어야 합니다.`);
  }
  if (diagnostics.allowedIps.present && !diagnostics.allowedIps.empty) {
    guidance.push(`allowed_ips 제한 ${diagnostics.allowedIps.count}개가 있습니다. 현재 PC IP가 허용 범위인지 확인하세요.`);
  }
  guidance.push('앱은 config.toml을 자동 수정하지 않습니다. 설정 변경 후 Zaparoo Core를 재시작하거나 reload해야 할 수 있습니다.');
  return guidance;
}

export function parseZaparooConfigToml(text: string): ZaparooConfigDiagnostics {
  const service = sectionBody(text, 'service');
  const serviceFound = service.trim().length > 0;
  const allowRun = parseArray(service, 'allow_run');
  const allowedIps = parseArray(service, 'allowed_ips');
  const parseFailed = Boolean(allowRun.parseError || allowedIps.parseError);
  const guidance = configGuidance({ serviceFound, allowRun, allowedIps });
  return {
    ok: !parseFailed,
    status: parseFailed ? 'parse-failed' : 'found',
    path: zaparooConfigPath,
    serviceFound,
    allowRun,
    allowedIps,
    allowedIpsLimited: allowedIps.present && !allowedIps.empty,
    allowedIpMatch: allowedIps.present && allowedIps.empty ? 'unrestricted' : 'not-checked',
    guidance,
    checkedAt: new Date().toISOString(),
    rawPreview: text.slice(0, 4000),
    message: parseFailed
      ? 'Zaparoo config.toml을 읽었지만 일부 설정을 해석하지 못했습니다.'
      : serviceFound
        ? `Zaparoo config.toml을 읽었습니다. allow_run ${allowRun.count}개, allowed_ips ${allowedIps.count}개 항목을 확인했습니다.`
        : 'Zaparoo config.toml은 읽었지만 [service] 섹션을 찾지 못했습니다.',
  };
}

export function formatZaparooConfigDiagnostics(diagnostics: ZaparooConfigDiagnostics, developerMode = false) {
  if (diagnostics.status === 'not-checked') return 'Zaparoo config.toml 진단을 아직 실행하지 않았습니다.';
  if (diagnostics.status === 'missing') return 'Zaparoo config.toml을 찾을 수 없습니다.';
  if (diagnostics.status === 'read-failed') return 'Zaparoo config.toml을 읽지 못했습니다. 원격 파일은 수정하지 않았습니다.';
  if (diagnostics.status === 'parse-failed' && !developerMode) return 'Zaparoo config.toml을 읽었지만 해석에 실패했습니다.';
  const allowRun = diagnostics.allowRun.present
    ? diagnostics.allowRun.empty
      ? 'allow_run 비어 있음'
      : `allow_run ${diagnostics.allowRun.count}개`
    : 'allow_run 없음';
  const allowedIps = diagnostics.allowedIps.present
    ? diagnostics.allowedIps.empty
      ? 'allowed_ips 제한 없음'
      : `allowed_ips 제한 ${diagnostics.allowedIps.count}개`
    : 'allowed_ips 없음';
  const base = `${allowRun} / ${allowedIps}`;
  if (!developerMode) return base;
  const detail = [
    base,
    `상태: ${diagnostics.status}`,
    `PC IP 판정: ${diagnostics.allowedIpMatch ?? 'not-checked'}`,
    ...(diagnostics.guidance ?? []),
  ];
  if (diagnostics.allowRun.parseError) detail.push(diagnostics.allowRun.parseError);
  if (diagnostics.allowedIps.parseError) detail.push(diagnostics.allowedIps.parseError);
  return detail.join('\n');
}

export function zaparooRunFailureMessage(code: ZaparooRunFailureCode) {
  const messages: Record<ZaparooRunFailureCode, string> = {
    API_OFFLINE: 'Zaparoo API에 연결할 수 없습니다. MiSTer에서 Zaparoo Core가 실행 중인지 확인하세요.',
    API_ENDPOINT_FAILED: 'Zaparoo API endpoint /api/v0.1이 응답하지 않습니다.',
    RUN_METHOD_FAILED: 'Zaparoo Core API는 응답했지만 run 실행 요청이 실패했습니다.',
    RUN_ENDPOINT_FAILED: '/run/ fallback 호출이 실패했습니다. Zaparoo v2.11 이후 원격 /run/ 실행에는 allow_run 규칙이 필요할 수 있습니다.',
    ALLOW_RUN_MISSING: 'config.toml의 [service] allow_run이 비어 있거나 없습니다. 원격 실행이 차단될 수 있습니다.',
    ALLOW_RUN_BLOCKED: '현재 실행 경로가 allow_run 규칙과 맞지 않을 수 있습니다.',
    ALLOWED_IPS_BLOCKED: 'allowed_ips 설정 때문에 이 PC의 API 요청이 차단될 수 있습니다.',
    LAUNCH_PATH_MISSING: '실행할 ZapScript 또는 게임 경로가 없습니다.',
    MEDIA_NOT_MATCHED: 'Zaparoo media database에서 실행할 게임을 확정하지 못했습니다.',
    UNKNOWN_ZAPAROO_ERROR: 'Zaparoo 실행 실패 원인을 분류하지 못했습니다.',
  };
  return messages[code];
}
