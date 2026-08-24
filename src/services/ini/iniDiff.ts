import type { IniDiffEntry, IniEditableValue, IniRiskLevel } from '../../types/ini';

function inferRisk(key: string): IniRiskLevel {
  if (/direct_video|composite_sync|forced_scandoubler|ypbpr|video_mode/i.test(key)) return '주의';
  return '안전';
}

export function diffIniValues(current: IniEditableValue[], next: IniEditableValue[]): IniDiffEntry[] {
  const currentByKey = new Map(current.map((item) => [item.key, item]));
  const nextByKey = new Map(next.map((item) => [item.key, item]));
  const rows: IniDiffEntry[] = [];

  for (const item of next) {
    const before = currentByKey.get(item.key);
    rows.push({
      key: item.key,
      before: before?.value,
      after: item.value,
      kind: before ? (before.value === item.value ? '동일' : '변경') : '추가',
      riskLevel: inferRisk(item.key),
      description: item.description,
    });
  }

  for (const item of current) {
    if (!nextByKey.has(item.key)) {
      rows.push({
        key: item.key,
        before: item.value,
        kind: '삭제',
        riskLevel: inferRisk(item.key),
        description: `${item.label} 항목이 새 프리셋에는 없습니다.`,
      });
    }
  }

  return rows;
}

export function formatIniDiffSummary(entries: IniDiffEntry[]) {
  const count = (kind: IniDiffEntry['kind']) => entries.filter((entry) => entry.kind === kind).length;
  return `추가 ${count('추가')} · 변경 ${count('변경')} · 삭제 ${count('삭제')} · 동일 ${count('동일')}`;
}
