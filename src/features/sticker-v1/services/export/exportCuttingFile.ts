import JSZip from 'jszip';
import type { CardItem, ExportSettings, SheetCardPlacement, Template } from '@sticker-v1/types';
import { getCutLineGeometryMm, normalizeCutLineSettings } from '@sticker-v1/utils/cutLines';
import { templateForCardSide } from '@sticker-v1/utils/cardTemplateSnapshots';
import { downloadBytes } from '@sticker-v1/services/export/download';
import { getPageDimsMm } from '@sticker-v1/export/pageDimensions';

export type CuttingFilePage = {
  placements: SheetCardPlacement[];
  side: 'front' | 'back';
  cardsById: Record<string, CardItem>;
  templates: Template[];
  title?: string;
};

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMm(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(4)).toString() : '0';
}

function cutRectElementMm(geometry: ReturnType<typeof getCutLineGeometryMm>, dashAttribute = '') {
  const { rect, radiusMm } = geometry;
  const radiusAttributes = radiusMm > 0
    ? ` rx="${formatMm(radiusMm)}" ry="${formatMm(radiusMm)}"`
    : '';
  return `<rect x="${formatMm(rect.xMm)}" y="${formatMm(rect.yMm)}" width="${formatMm(rect.widthMm)}" height="${formatMm(rect.heightMm)}"${radiusAttributes}${dashAttribute} />`;
}

function timestampForFilename(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

// The cutting file is always a continuous thin solid outline regardless of the editor's on-screen cut style
// (corner-marks / dashed / dotted) — a cutting plotter needs one closed thin path per card. The editor's color and the
// rounded-corner geometry are kept; only style/width/enabled are forced here, so the on-screen/print cut style is unchanged.
const CUT_FILE_WIDTH_MM = 0.1;

function forcedThinSolidCutSettings(settings: ExportSettings) {
  return {
    ...normalizeCutLineSettings(settings.cutLineSettings),
    enabled: true,
    style: 'solid' as const,
    widthMm: CUT_FILE_WIDTH_MM,
  };
}

function cuttingSvgElements(page: CuttingFilePage, settings: ExportSettings) {
  const cutLineSettings = forcedThinSolidCutSettings(settings);
  if (!cutLineSettings.enabled) return '';

  // Always a continuous thin solid rect per card (no dashes, no corner-marks) — see forcedThinSolidCutSettings.
  return page.placements
    .map((placement) => {
      const card = page.cardsById[placement.cardId];
      const template = card ? templateForCardSide(card, page.templates, page.side) : undefined;
      const geometry = getCutLineGeometryMm(placement, cutLineSettings, template?.canvas);
      return cutRectElementMm(geometry);
    })
    .join('\n    ');
}

export function createCuttingSvg(page: CuttingFilePage, settings: ExportSettings, pageNumber = 1) {
  const elements = cuttingSvgElements(page, settings);
  const cutLineSettings = forcedThinSolidCutSettings(settings);
  const title = page.title ?? `Hello Mister cutting page ${pageNumber}`;
  // The sheet is landscape; the cut file is its portrait rotation (so it loads upright on a plotter). Page-size aware.
  const landscape = getPageDimsMm(settings);
  const portraitWidthMm = landscape.heightMm;
  const portraitHeightMm = landscape.widthMm;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
  width="${formatMm(portraitWidthMm)}mm"
  height="${formatMm(portraitHeightMm)}mm"
  viewBox="0 0 ${formatMm(portraitWidthMm)} ${formatMm(portraitHeightMm)}">
  <title>${escapeXml(title)}</title>
  <desc>Portrait SVG containing only vector cut lines. The cut geometry is rotated from the app's landscape sheet coordinates without changing physical placement.</desc>
  <g id="cut-lines"
    transform="translate(0 ${formatMm(landscape.widthMm)}) rotate(-90)"
    fill="none"
    stroke="${escapeXml(cutLineSettings.color)}"
    stroke-width="${formatMm(cutLineSettings.widthMm)}"
    stroke-linecap="square"
    stroke-linejoin="miter">
    ${elements}
  </g>
</svg>
`;
}

export async function exportCuttingSvgFiles(pages: CuttingFilePage[], settings: ExportSettings) {
  const exportPages = pages.filter((page) => page.placements.length > 0);
  if (exportPages.length === 0) {
    return { pageCount: 0, filename: '' };
  }

  const timestamp = timestampForFilename();
  const encoder = new TextEncoder();

  if (exportPages.length === 1) {
    const filename = `${timestamp}-cut.svg`;
    downloadBytes(encoder.encode(createCuttingSvg(exportPages[0], settings, 1)), filename, 'image/svg+xml');
    return { pageCount: 1, filename };
  }

  const zip = new JSZip();
  exportPages.forEach((page, index) => {
    zip.file(`cut-page-${String(index + 1).padStart(2, '0')}.svg`, createCuttingSvg(page, settings, index + 1));
  });
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const filename = `${timestamp}-cut-files.zip`;
  downloadBytes(bytes, filename, 'application/zip');
  return { pageCount: exportPages.length, filename };
}
