import type { CardItem, Template } from '@sticker-v1/types';

export function templatesWithCardSnapshots(card: CardItem, templates: Template[]) {
  const snapshots = card.embeddedTemplateSnapshots ?? [];
  if (snapshots.length === 0) return templates;

  const templateIds = new Set(templates.map((template) => template.id));
  const fallbackSnapshots = snapshots.filter((template) => !templateIds.has(template.id));
  return fallbackSnapshots.length ? [...templates, ...fallbackSnapshots] : templates;
}

export function templateForCardSide(card: CardItem, templates: Template[], side: 'front' | 'back') {
  const templateId = side === 'front' ? card.front.templateId : card.back.templateId;
  return templatesWithCardSnapshots(card, templates).find((candidate) => candidate.id === templateId && candidate.type === side);
}
