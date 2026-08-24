import type { Template } from '@sticker-v1/types';

export interface TemplateValidationResult {
  ok: boolean;
  template?: Template;
  errors: string[];
}

export function validateTemplateDefinition(value: unknown): TemplateValidationResult {
  const errors: string[] = [];
  const candidate = value as Partial<Template>;

  if (!candidate || typeof candidate !== 'object') errors.push('Template JSON must be an object.');
  if (!candidate.id || typeof candidate.id !== 'string') errors.push('Template id is required.');
  if (!candidate.name || typeof candidate.name !== 'string') errors.push('Template name is required.');
  if (candidate.type !== 'front' && candidate.type !== 'back') errors.push('Template type must be front or back.');
  if (!candidate.canvas) errors.push('Template canvas is required.');
  if (!Array.isArray(candidate.layers)) errors.push('Template layers must be an array.');

  if (candidate.canvas) {
    if (typeof candidate.canvas.width !== 'number') errors.push('Canvas width must be a number.');
    if (typeof candidate.canvas.height !== 'number') errors.push('Canvas height must be a number.');
    if (typeof candidate.canvas.safeMargin !== 'number') errors.push('Canvas safeMargin must be a number.');
  }

  if (errors.length > 0) return { ok: false, errors };

  const template = { ...(candidate as Template) };
  delete template.thumbnailCacheKey;
  delete template.thumbnailVersion;
  delete template.thumbnailStatus;
  delete template.thumbnailStaleCacheKey;
  delete template.thumbnailError;
  delete template.thumbnailUpdatedAt;

  return {
    ok: true,
    errors: [],
    template: {
      ...template,
      source: 'UPLOADED',
      builtIn: false,
      layoutPresetId: 'CUSTOM',
      updatedAt: new Date().toISOString(),
    },
  };
}

export async function parseTemplateFile(file: File) {
  const content = await file.text();
  return validateTemplateDefinition(JSON.parse(content));
}
