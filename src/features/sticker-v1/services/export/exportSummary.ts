export interface ExportWarning {
  cardId?: string;
  cardTitle?: string;
  side?: 'front' | 'back';
  kind: 'missing-image' | 'render-error' | 'placeholder' | 'unsupported-format';
  message: string;
}

export interface ExportSummary {
  exportedCardsCount: number;
  frontPagesCount: number;
  backPagesCount: number;
  dpi: number;
  missingImageCount: number;
  placeholderUsedCount: number;
  warnings: ExportWarning[];
}

export function createExportSummary(exportedCardsCount: number, frontPagesCount: number, backPagesCount: number, dpi = 300): ExportSummary {
  return {
    exportedCardsCount,
    frontPagesCount,
    backPagesCount,
    dpi,
    missingImageCount: 0,
    placeholderUsedCount: 0,
    warnings: [],
  };
}

export function addExportWarning(summary: ExportSummary | undefined, warning: ExportWarning) {
  if (!summary) return;
  summary.warnings.push(warning);
  if (warning.kind === 'missing-image') summary.missingImageCount += 1;
  if (warning.kind === 'placeholder') summary.placeholderUsedCount += 1;
}
