import type { MisterIniDocument, MisterIniParsedLine, MisterIniSection, MisterIniSetting } from '../../types/ini';
import { helpForIniKey } from './iniHelpCatalog';

function normalizeLineEndings(content: string) {
  return String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function parseIniText(text: string) {
  return normalizeLineEndings(text)
    .split('\n')
    .map((line, index) => ({ lineNumber: index + 1, raw: line, trimmed: line.trim() }))
    .filter((line) => line.trimmed && !line.trimmed.startsWith(';') && !line.trimmed.startsWith('#'));
}

function trimCommentPrefix(line: string) {
  return line.replace(/^\s*[#;]\s?/, '').trim();
}

function splitInlineComment(rawValue: string): { value: string; inlineComment?: string; commentDelimiter?: ';' | '#' } {
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < rawValue.length; index += 1) {
    const char = rawValue[index];
    const previous = rawValue[index - 1];

    if ((char === '"' || char === "'") && previous !== '\\') {
      quote = quote === char ? undefined : quote || char;
      continue;
    }

    const next = rawValue[index + 1];
    const commentBoundary = index === 0 || /\s/.test(previous || '') || /\s/.test(next || '');
    if (!quote && (char === ';' || char === '#') && commentBoundary) {
      return {
        value: rawValue.slice(0, index).trim(),
        inlineComment: rawValue.slice(index + 1).trim() || undefined,
        commentDelimiter: char,
      };
    }
  }

  return { value: rawValue.trim() };
}

function settingCategory(key: string): MisterIniSetting['category'] {
  const lower = key.toLowerCase();
  if (/(video|vscale|vsync|hdmi|vga|gamma|scandoubler|ypbpr|direct|sync|refresh|pal)/.test(lower)) return 'video';
  if (/(audio|volume|sound)/.test(lower)) return 'audio';
  if (/(key|button|joystick|controller|pad)/.test(lower)) return 'controller';
  if (/(boot|wifi|network|hostname|osd|font|menu|timeout)/.test(lower)) return 'network-system';
  return 'other';
}

export function inferIniControlKind(_value: string, key = ''): MisterIniSetting['controlKind'] {
  const help = helpForIniKey(key);
  if (!help || help.source === 'unknown') return 'text';
  if (help.valueType === 'boolean') return 'boolean';
  if (help.valueType === 'enum' && (help.allowedValues?.length || help.options?.length)) return 'select';
  if (help.valueType === 'number') return 'number';
  if (help.valueType === 'hex' || help.valueType === 'videoMode' || help.valueType === 'text') return 'text';
  if (help?.options && help.options.length > 0) return 'select';
  return 'text';
}

export function parseIniDocument(content: string, fileName = 'MiSTer.ini'): MisterIniDocument {
  const source = normalizeLineEndings(content);
  const rawLines = source.split('\n');
  const lines: MisterIniParsedLine[] = [];
  const sections = new Map<string, MisterIniSection>();
  const parseWarnings: string[] = [];
  let currentSection = 'global';
  let pendingComments: string[] = [];

  function ensureSection(name: string, lineNumber: number) {
    const id = name.toLowerCase();
    if (!sections.has(id)) {
      sections.set(id, { id, name, lineNumber, settings: [] });
    }
    return sections.get(id)!;
  }

  ensureSection(currentSection, 1);

  rawLines.forEach((raw, index) => {
    const lineNumber = index + 1;
    const trimmed = raw.trim();
    if (!trimmed) {
      lines.push({ type: 'blank', lineNumber, raw });
      pendingComments = [];
      return;
    }
    if (/^[#;]/.test(trimmed)) {
      const comment = trimCommentPrefix(raw);
      lines.push({ type: 'comment', lineNumber, raw, comment });
      if (comment) pendingComments.push(comment);
      return;
    }
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim() || 'global';
      ensureSection(currentSection, lineNumber);
      lines.push({ type: 'section', lineNumber, raw, section: currentSection });
      pendingComments = [];
      return;
    }
    const settingMatch = raw.match(/^\s*([^=:#;]+?)\s*=\s*(.*?)\s*$/);
    if (settingMatch) {
      const key = settingMatch[1].trim();
      const parsedValue = splitInlineComment(settingMatch[2]);
      const value = parsedValue.value;
      const help = pendingComments.join('\n') || undefined;
      const catalog = helpForIniKey(key);
      const setting: MisterIniSetting = {
        id: `${currentSection}:${key}:${lineNumber}`,
        section: currentSection,
        key,
        label: catalog?.label,
        labelEn: catalog?.labelEn,
        labelKo: catalog?.labelKo,
        value,
        originalValue: value,
        inlineComment: parsedValue.inlineComment,
        rawLine: raw,
        lineNumber,
        help,
        catalogHelp: catalog?.description,
        descriptionKo: catalog?.descriptionKo,
        whenToUseKo: catalog?.whenToUseKo,
        valueGuideKo: catalog?.valueGuideKo,
        recommendedKo: catalog?.recommendedKo,
        warningKo: catalog?.warningKo,
        helpSource: catalog?.source || 'unknown',
        controlKind: inferIniControlKind(value, key),
        valueType: catalog?.valueType,
        options: catalog?.allowedValues?.map((item) => item.value) || catalog?.options,
        optionLabels: catalog?.allowedValues
          ? Object.fromEntries(catalog.allowedValues.map((item) => [item.value, item.labelKo]))
          : catalog?.optionLabels,
        allowedValues: catalog?.allowedValues,
        range: catalog?.range,
        examples: catalog?.examples,
        riskLevel: catalog?.riskLevel,
        placeholder: catalog?.placeholder,
        category: catalog?.category || settingCategory(key),
        changed: false,
      };
      ensureSection(currentSection, lineNumber).settings.push(setting);
      lines.push({
        type: 'setting',
        lineNumber,
        raw,
        section: currentSection,
        key,
        value,
        inlineComment: parsedValue.inlineComment,
        commentDelimiter: parsedValue.commentDelimiter,
        help,
      });
      pendingComments = [];
      return;
    }
    lines.push({ type: 'raw', lineNumber, raw });
    parseWarnings.push(`${lineNumber}번 줄을 GUI 항목으로 해석하지 못했습니다.`);
    pendingComments = [];
  });

  return { fileName, content: source, lines, sections: [...sections.values()], parseWarnings };
}

export function updateIniSetting(document: MisterIniDocument, settingId: string, value: string): MisterIniDocument {
  const nextSections = document.sections.map((section) => ({
    ...section,
    settings: section.settings.map((setting) => (
      setting.id === settingId
        ? { ...setting, value, changed: value !== setting.originalValue }
        : setting
    )),
  }));
  return { ...document, sections: nextSections };
}

export function changedIniSettings(document: MisterIniDocument) {
  return document.sections.flatMap((section) => section.settings).filter((setting) => setting.changed);
}

export function serializeIniDocument(document: MisterIniDocument) {
  const settingValues = new Map<string, string>();
  for (const section of document.sections) {
    for (const setting of section.settings) {
      settingValues.set(`${setting.section}:${setting.key}:${setting.lineNumber}`, setting.value);
    }
  }
  return document.lines.map((line) => {
    if (line.type !== 'setting' || !line.key) return line.raw;
    const nextValue = settingValues.get(`${line.section}:${line.key}:${line.lineNumber}`);
    if (nextValue === undefined) return line.raw;
    const leading = line.raw.match(/^\s*/)?.[0] || '';
    const commentSuffix = line.inlineComment ? ` ${line.commentDelimiter || ';'} ${line.inlineComment}` : '';
    return `${leading}${line.key}=${nextValue}${commentSuffix}`;
  }).join('\n');
}

export function formatBackupRestoreWarning(fileName: string) {
  return `${fileName} 파일을 선택한 백업 내용으로 덮어씁니다. 적용 전에 현재 파일도 다시 백업합니다.`;
}
