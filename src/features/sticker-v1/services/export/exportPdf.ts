import { PDFDocument } from 'pdf-lib';
import { type RenderedSheetImage, summaryForRenderedSheets } from '@sticker-v1/services/export/sheetDomExport';

const A4_LANDSCAPE = { widthMm: 297, heightMm: 210 };

const mmToPt = (value: number) => (value * 72) / 25.4;

interface SheetPdfOptions {
  exportedCardsCount: number;
  dpi: number;
}

export async function exportSheetImagesPdf(images: RenderedSheetImage[], options: SheetPdfOptions) {
  const pdf = await PDFDocument.create();
  for (const image of images) {
    const widthMm = image.pageWidthMm || A4_LANDSCAPE.widthMm;
    const heightMm = image.pageHeightMm || A4_LANDSCAPE.heightMm;
    const page = pdf.addPage([mmToPt(widthMm), mmToPt(heightMm)]);
    const sheetImage = await pdf.embedPng(await image.blob.arrayBuffer());
    page.drawImage(sheetImage, {
      x: 0,
      y: 0,
      width: mmToPt(widthMm),
      height: mmToPt(heightMm),
    });
  }
  return {
    bytes: await pdf.save(),
    summary: summaryForRenderedSheets(images, options),
  };
}
