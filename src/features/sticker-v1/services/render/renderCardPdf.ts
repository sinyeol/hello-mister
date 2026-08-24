import type { PDFDocument, PDFPage, PDFFont } from 'pdf-lib';
import { renderCardPng } from '@sticker-v1/services/export/exportPng';
import type { CardItem, Category, LocalAsset, MmRect, Template } from '@sticker-v1/types';
import { normalizeTemplateForRender } from '@sticker-v1/utils/templateRenderNormalize';

const mmToPt = (value: number) => (value * 72) / 25.4;
const a4LandscapeHeightMm = 210;

interface RenderCardPdfOptions {
  pdf: PDFDocument;
  page: PDFPage;
  card: CardItem;
  category?: Category;
  assetsById: Record<string, LocalAsset>;
  templates: Template[];
  rect: MmRect;
  side: 'front' | 'back';
  font: PDFFont;
  boldFont: PDFFont;
}

export async function renderCardPdf({
  pdf,
  page,
  card,
  category,
  assetsById,
  templates,
  rect,
  side,
}: RenderCardPdfOptions) {
  const renderTemplates = templates.map((template) => normalizeTemplateForRender(template));
  const blob = await renderCardPng(card, category, assetsById, renderTemplates, side, { showCutLine: false });
  const png = await pdf.embedPng(await blob.arrayBuffer());
  page.drawImage(png, {
    x: mmToPt(rect.xMm),
    y: mmToPt(a4LandscapeHeightMm - rect.yMm - rect.heightMm),
    width: mmToPt(rect.widthMm),
    height: mmToPt(rect.heightMm),
  });
}
