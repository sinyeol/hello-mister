import type { SavedCardRecord, Template } from '@sticker-v1/types';

export type CardImportTemplateConflictChoice =
  | 'cardsOnly'
  | 'useExisting'
  | 'addRenamed'
  | 'replaceExisting';

export type CardImportMissingTemplateChoice =
  | 'cardsOnly'
  | 'addImported'
  | 'linkDefault';

export interface PrepareCardImportOptions {
  importTemplates?: boolean;
  conflictChoice?: CardImportTemplateConflictChoice;
  missingChoice?: CardImportMissingTemplateChoice;
  timestamp?: number;
}

export interface CardImportTemplatePlan {
  records: SavedCardRecord[];
  templatesToAdd: Template[];
  templatesToReplace: Template[];
  conflicts: Array<{ importedTemplate: Template; existingTemplate: Template; cardCount: number }>;
  missing: Array<{ importedTemplate: Template; cardCount: number }>;
}

function referencedTemplateIds(records: SavedCardRecord[]) {
  const ids = new Set<string>();
  records.forEach((record) => {
    if (record.card.front.templateId) ids.add(record.card.front.templateId);
    if (record.card.back.templateId) ids.add(record.card.back.templateId);
  });
  return ids;
}

function countCardsUsingTemplate(records: SavedCardRecord[], templateId: string) {
  return records.filter((record) => record.card.front.templateId === templateId || record.card.back.templateId === templateId).length;
}

function templateKey(template: Template) {
  return `${template.type}:${template.name.trim().toLocaleLowerCase()}`;
}

function uniqueTemplateName(name: string, existingTemplates: Template[], addedTemplates: Template[]) {
  const usedNames = new Set([...existingTemplates, ...addedTemplates].map((template) => template.name.trim().toLocaleLowerCase()));
  if (!usedNames.has(name.trim().toLocaleLowerCase())) return name;

  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${name} ${suffix}`;
    if (!usedNames.has(candidate.trim().toLocaleLowerCase())) return candidate;
  }

  return `${name} ${Date.now()}`;
}

function cloneTemplateForImport(template: Template, id: string, name: string): Template {
  return {
    ...template,
    id,
    name,
    builtIn: false,
    source: 'EDITOR',
    deletedAt: undefined,
    updatedAt: new Date().toISOString(),
  };
}

function snapshotsForRecord(record: SavedCardRecord, importedTemplatesById: Map<string, Template>) {
  const snapshots: Template[] = [];
  const front = record.card.front.templateId ? importedTemplatesById.get(record.card.front.templateId) : undefined;
  const back = record.card.back.templateId ? importedTemplatesById.get(record.card.back.templateId) : undefined;
  if (front) snapshots.push(front);
  if (back && back.id !== front?.id) snapshots.push(back);
  return snapshots;
}

export function prepareCardImportTemplatePlan(
  records: SavedCardRecord[],
  importedTemplates: Template[],
  existingTemplates: Template[],
  options: PrepareCardImportOptions = {},
): CardImportTemplatePlan {
  const referencedIds = referencedTemplateIds(records);
  const importedTemplatesById = new Map(importedTemplates.filter((template) => referencedIds.has(template.id)).map((template) => [template.id, template]));
  const existingByName = new Map(existingTemplates.map((template) => [templateKey(template), template]));
  const templateIdMap = new Map<string, string>();
  const templatesToAdd: Template[] = [];
  const templatesToReplace: Template[] = [];
  const conflicts: CardImportTemplatePlan['conflicts'] = [];
  const missing: CardImportTemplatePlan['missing'] = [];
  const timestamp = options.timestamp ?? Date.now();
  const conflictChoice = options.conflictChoice ?? 'useExisting';
  const missingChoice = options.missingChoice ?? 'cardsOnly';

  importedTemplatesById.forEach((template, templateId) => {
    const existing = existingByName.get(templateKey(template));
    if (existing) {
      conflicts.push({ importedTemplate: template, existingTemplate: existing, cardCount: countCardsUsingTemplate(records, templateId) });
      if (options.importTemplates && conflictChoice === 'useExisting') {
        templateIdMap.set(templateId, existing.id);
      } else if (options.importTemplates && conflictChoice === 'addRenamed') {
        const id = `${template.id}_import_${timestamp}_${templatesToAdd.length}`;
        const name = uniqueTemplateName(template.name, existingTemplates, templatesToAdd);
        templatesToAdd.push(cloneTemplateForImport(template, id, name));
        templateIdMap.set(templateId, id);
      } else if (options.importTemplates && conflictChoice === 'replaceExisting') {
        templatesToReplace.push(cloneTemplateForImport(template, existing.id, existing.name));
        templateIdMap.set(templateId, existing.id);
      }
      return;
    }

    missing.push({ importedTemplate: template, cardCount: countCardsUsingTemplate(records, templateId) });
    if (options.importTemplates && missingChoice === 'addImported') {
      const id = `${template.id}_import_${timestamp}_${templatesToAdd.length}`;
      const name = uniqueTemplateName(template.name, existingTemplates, templatesToAdd);
      templatesToAdd.push(cloneTemplateForImport(template, id, name));
      templateIdMap.set(templateId, id);
    } else if (options.importTemplates && missingChoice === 'linkDefault') {
      const defaultTemplate = existingTemplates.find((candidate) => candidate.type === template.type && !candidate.deletedAt);
      if (defaultTemplate) templateIdMap.set(templateId, defaultTemplate.id);
    }
  });

  return {
    records: records.map((record) => {
      const snapshots = snapshotsForRecord(record, importedTemplatesById);
      const frontTemplateId = record.card.front.templateId;
      const backTemplateId = record.card.back.templateId;
      return {
        ...record,
        card: {
          ...record.card,
          embeddedTemplateSnapshots: snapshots.length > 0 ? snapshots : record.card.embeddedTemplateSnapshots,
          templateImportStatus: snapshots.length > 0 ? 'embeddedSnapshot' : record.card.templateImportStatus,
          front: {
            ...record.card.front,
            templateId: frontTemplateId ? templateIdMap.get(frontTemplateId) ?? frontTemplateId : frontTemplateId,
          },
          back: {
            ...record.card.back,
            templateId: backTemplateId ? templateIdMap.get(backTemplateId) ?? backTemplateId : backTemplateId,
          },
        },
      };
    }),
    templatesToAdd,
    templatesToReplace,
    conflicts,
    missing,
  };
}
