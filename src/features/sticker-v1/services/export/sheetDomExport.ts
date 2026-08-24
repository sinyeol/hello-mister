import JSZip from 'jszip';
import { createExportSummary, type ExportSummary } from '@sticker-v1/services/export/exportSummary';

export type RenderedSheetSide = 'front' | 'back';

export interface RenderedSheetImage {
  blob: Blob;
  filename: string;
  side: RenderedSheetSide;
  sheetIndex: number;
  pageNumber: number;
  pageWidthMm: number;
  pageHeightMm: number;
}

interface SheetExportSummaryOptions {
  exportedCardsCount: number;
  dpi: number;
}

const A4_LANDSCAPE = { widthMm: 297, heightMm: 210 };
const TRANSPARENT_PIXEL_DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const XLINK_HREF_NS = 'http://www.w3.org/1999/xlink';
const CSS_IMAGE_PROPERTIES = [
  'background-image',
  'border-image-source',
  'list-style-image',
  'mask-image',
  '-webkit-mask-image',
  'cursor',
];

interface ResourceReference {
  element: string;
  kind: 'attribute' | 'srcset' | 'style';
  property: string;
  url: string;
}

interface InlineResourceIssue {
  context: string;
  url: string;
  error: string;
}

interface InlineResourceContext {
  cache: Map<string, string>;
  issues: InlineResourceIssue[];
  foundCount: number;
  convertedCount: number;
}

function mmToPx(value: number, dpi: number) {
  return Math.round((value / 25.4) * dpi);
}

function waitForFonts() {
  if (typeof document === 'undefined' || !('fonts' in document)) return Promise.resolve();
  return document.fonts.ready.catch(() => undefined);
}

function formatInlineIssues(issues: InlineResourceIssue[]) {
  if (issues.length === 0) return '';
  return issues
    .slice(0, 8)
    .map((issue) => `${issue.context}: ${issue.url} (${issue.error})`)
    .join('; ');
}

function formatResourceReferences(references: ResourceReference[]) {
  if (references.length === 0) return '';
  return references
    .slice(0, 12)
    .map((reference) => `${reference.element} ${reference.kind}:${reference.property}=${reference.url}`)
    .join('; ');
}

function canvasToBlob(canvas: HTMLCanvasElement, issues: InlineResourceIssue[]) {
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`Could not create sheet PNG blob.${formatInlineIssues(issues) ? ` Resource issues: ${formatInlineIssues(issues)}` : ''}`));
      }, 'image/png');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reject(new Error(`Could not export the sheet canvas because it was not canvas-safe: ${message}.${formatInlineIssues(issues) ? ` Resource issues: ${formatInlineIssues(issues)}` : ''}`));
    }
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image blob.'));
    reader.readAsDataURL(blob);
  });
}

function filePathFromFileUrl(url: string) {
  const parsed = new URL(url);
  let pathname = decodeURIComponent(parsed.pathname);
  if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1);
  if (parsed.hostname && parsed.hostname !== 'localhost') return `//${parsed.hostname}${pathname}`;
  return pathname;
}

function normalizeResourceUrl(url: string) {
  const trimmed = url.trim().replace(/^['"]|['"]$/g, '');
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('#')) return trimmed;
  if (/^[A-Za-z]:[\\/]/.test(trimmed) || /^\\\\/.test(trimmed)) return `file:///${trimmed.replace(/\\/g, '/')}`;
  try {
    return new URL(trimmed, document.baseURI).href;
  } catch {
    return trimmed;
  }
}

async function readFileUrlAsDataUrl(url: string) {
  const readFileAsDataUrl = window.zaparooDesktop?.readFileAsDataUrl;
  if (!readFileAsDataUrl) throw new Error('Local file image bridge is not available.');
  const result = await readFileAsDataUrl(filePathFromFileUrl(url));
  if (!result.ok || !result.dataUrl) throw new Error(result.error ?? 'Local file image could not be read.');
  return result.dataUrl;
}

async function fetchImageUrlAsDataUrl(url: string) {
  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return blobToDataUrl(await response.blob());
}

async function fetchRemoteImageAsDataUrl(url: string) {
  const fetchImageAsDataUrl = window.zaparooDesktop?.fetchImageAsDataUrl;
  if (!fetchImageAsDataUrl) throw new Error('Remote image bridge is not available.');
  const result = await fetchImageAsDataUrl(url);
  if (!result.ok || !result.dataUrl) throw new Error(result.error ?? 'Remote image could not be fetched.');
  return result.dataUrl;
}

async function imageUrlToDataUrl(url: string, context: InlineResourceContext, label: string) {
  const normalized = normalizeResourceUrl(url);
  if (!normalized || normalized.startsWith('data:') || normalized.startsWith('#')) return normalized;
  const cached = context.cache.get(normalized);
  if (cached) return cached;
  context.foundCount += 1;

  try {
    const dataUrl = normalized.startsWith('file:') ? await readFileUrlAsDataUrl(normalized) : await fetchImageUrlAsDataUrl(normalized);
    context.cache.set(normalized, dataUrl);
    context.convertedCount += 1;
    return dataUrl;
  } catch (error) {
    if (/^https?:/i.test(normalized)) {
      try {
        const dataUrl = await fetchRemoteImageAsDataUrl(normalized);
        context.cache.set(normalized, dataUrl);
        context.convertedCount += 1;
        return dataUrl;
      } catch (fallbackError) {
        const primaryMessage = error instanceof Error ? error.message : String(error);
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        context.issues.push({ context: label, url: normalized, error: `${primaryMessage}; bridge fallback: ${fallbackMessage}` });
        context.cache.set(normalized, TRANSPARENT_PIXEL_DATA_URL);
        return TRANSPARENT_PIXEL_DATA_URL;
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    context.issues.push({ context: label, url: normalized, error: message });
    context.cache.set(normalized, TRANSPARENT_PIXEL_DATA_URL);
    return TRANSPARENT_PIXEL_DATA_URL;
  }
}

function copyComputedStyles(source: Element, target: Element) {
  const computed = window.getComputedStyle(source);
  const targetElement = target as HTMLElement | SVGElement;
  for (let index = 0; index < computed.length; index += 1) {
    const property = computed.item(index);
    targetElement.style.setProperty(property, computed.getPropertyValue(property), computed.getPropertyPriority(property));
  }
}

function inlineComputedStyles(source: Element, target: Element) {
  copyComputedStyles(source, target);
  const sourceChildren = Array.from(source.children);
  const targetChildren = Array.from(target.children);
  sourceChildren.forEach((sourceChild, index) => {
    const targetChild = targetChildren[index];
    if (targetChild) inlineComputedStyles(sourceChild, targetChild);
  });
}

function elementPairs(source: Element, target: Element): Array<[Element, Element]> {
  const sourceElements = [source, ...Array.from(source.querySelectorAll('*'))];
  const targetElements = [target, ...Array.from(target.querySelectorAll('*'))];
  return sourceElements.flatMap((sourceElement, index) => {
    const targetElement = targetElements[index];
    return targetElement ? ([[sourceElement, targetElement]] as Array<[Element, Element]>) : [];
  });
}

function cssUrlValues(value: string) {
  return Array.from(value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)).map((match) => ({
    token: match[0],
    url: match[2],
  }));
}

function srcsetUrlValues(value: string) {
  return value
    .split(',')
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return undefined;
      const [url, ...descriptor] = trimmed.split(/\s+/);
      return { token: trimmed, url, descriptor: descriptor.join(' ') };
    })
    .filter((entry): entry is { token: string; url: string; descriptor: string } => Boolean(entry));
}

function cssDataUrl(dataUrl: string) {
  return `url("${dataUrl.replace(/"/g, '%22')}")`;
}

function elementLabel(element: Element) {
  const id = element.id ? `#${element.id}` : '';
  const classes = typeof element.className === 'string' && element.className.trim()
    ? `.${element.className.trim().split(/\s+/).slice(0, 3).join('.')}`
    : '';
  return `${element.tagName.toLowerCase()}${id}${classes}`;
}

async function inlineCssUrlProperty(targetElement: HTMLElement | SVGElement, property: string, context: InlineResourceContext) {
  const value = targetElement.style.getPropertyValue(property);
  if (!value || !value.includes('url(')) return;

  let nextValue = value;
  const urls = cssUrlValues(value);
  for (const { token, url } of urls) {
    const dataUrl = await imageUrlToDataUrl(url, context, `${elementLabel(targetElement)} css ${property}`);
    nextValue = nextValue.replace(token, cssDataUrl(dataUrl));
  }
  targetElement.style.setProperty(property, nextValue, targetElement.style.getPropertyPriority(property));
}

async function inlineAllCssUrlProperties(targetElement: HTMLElement | SVGElement, context: InlineResourceContext) {
  const properties = new Set(CSS_IMAGE_PROPERTIES);
  for (let index = 0; index < targetElement.style.length; index += 1) {
    const property = targetElement.style.item(index);
    if (targetElement.style.getPropertyValue(property).includes('url(')) properties.add(property);
  }
  for (const property of properties) {
    await inlineCssUrlProperty(targetElement, property, context);
  }
}

async function inlineSrcsetAttribute(targetElement: Element, context: InlineResourceContext) {
  const srcset = targetElement.getAttribute('srcset');
  if (!srcset) return;
  const entries = srcsetUrlValues(srcset);
  const nextEntries: string[] = [];
  for (const entry of entries) {
    const dataUrl = await imageUrlToDataUrl(entry.url, context, `${elementLabel(targetElement)} srcset`);
    nextEntries.push(entry.descriptor ? `${dataUrl} ${entry.descriptor}` : dataUrl);
  }
  if (nextEntries.length > 0) targetElement.setAttribute('srcset', nextEntries.join(', '));
  else targetElement.removeAttribute('srcset');
}

async function inlineElementResource(sourceElement: Element, targetElement: Element, context: InlineResourceContext) {
  const tagName = sourceElement.tagName.toLowerCase();
  if (tagName === 'img') {
    const sourceImage = sourceElement as HTMLImageElement;
    const targetImage = targetElement as HTMLImageElement;
    const sourceUrl = sourceImage.currentSrc || sourceImage.src || sourceImage.getAttribute('src') || '';
    if (sourceUrl) targetImage.setAttribute('src', await imageUrlToDataUrl(sourceUrl, context, `${elementLabel(targetElement)} img[src]`));
    await inlineSrcsetAttribute(targetImage, context);
    targetImage.removeAttribute('sizes');
    targetImage.setAttribute('loading', 'eager');
    targetImage.removeAttribute('decoding');
  }

  if (tagName === 'source') {
    await inlineSrcsetAttribute(targetElement, context);
    const src = sourceElement.getAttribute('src');
    if (src) targetElement.setAttribute('src', await imageUrlToDataUrl(src, context, `${elementLabel(targetElement)} source[src]`));
  }

  if (tagName === 'image') {
    const href = sourceElement.getAttribute('href') ?? sourceElement.getAttributeNS(XLINK_HREF_NS, 'href') ?? '';
    if (href) {
      const dataUrl = await imageUrlToDataUrl(href, context, `${elementLabel(targetElement)} svg image[href]`);
      targetElement.setAttribute('href', dataUrl);
      targetElement.setAttributeNS(XLINK_HREF_NS, 'xlink:href', dataUrl);
    }
  }

  for (const attribute of ['src', 'href', 'xlink:href']) {
    const value = targetElement.getAttribute(attribute);
    if (value && isUnsafeResourceUrl(value)) {
      if (attribute === 'href' && tagName !== 'image') targetElement.removeAttribute(attribute);
      else targetElement.setAttribute(attribute, await imageUrlToDataUrl(value, context, `${elementLabel(targetElement)} ${attribute}`));
    }
  }

  const targetStyleElement = targetElement as HTMLElement | SVGElement;
  await inlineAllCssUrlProperties(targetStyleElement, context);
}

async function inlineCanvasSafeResources(source: Element, target: Element) {
  const context: InlineResourceContext = { cache: new Map(), issues: [], foundCount: 0, convertedCount: 0 };
  const pairs = elementPairs(source, target);
  for (const [sourceElement, targetElement] of pairs) {
    await inlineElementResource(sourceElement, targetElement, context);
  }
  return context;
}

function isUnsafeResourceUrl(url: string) {
  const normalized = normalizeResourceUrl(url);
  return Boolean(normalized)
    && !normalized.startsWith('data:')
    && !normalized.startsWith('#')
    && (/^(?:file|https?|blob):/i.test(normalized) || /^[A-Za-z]:[\\/]/.test(normalized) || /^\\\\/.test(normalized));
}

function unsafeCssUrls(value: string) {
  return cssUrlValues(value)
    .map(({ url }) => normalizeResourceUrl(url))
    .filter((url) => isUnsafeResourceUrl(url));
}

function collectUnsafeResourceReferences(root: Element) {
  const unsafeReferences: ResourceReference[] = [];
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    const label = elementLabel(element);
    for (const attribute of ['src', 'href', 'xlink:href']) {
      const value = element.getAttribute(attribute);
      if (value && isUnsafeResourceUrl(value)) unsafeReferences.push({ element: label, kind: 'attribute', property: attribute, url: normalizeResourceUrl(value) });
    }
    const srcset = element.getAttribute('srcset');
    if (srcset) {
      for (const entry of srcsetUrlValues(srcset)) {
        if (isUnsafeResourceUrl(entry.url)) unsafeReferences.push({ element: label, kind: 'srcset', property: 'srcset', url: normalizeResourceUrl(entry.url) });
      }
    }
    const xlinkHref = element.getAttributeNS(XLINK_HREF_NS, 'href');
    if (xlinkHref && isUnsafeResourceUrl(xlinkHref)) unsafeReferences.push({ element: label, kind: 'attribute', property: 'xlink:href', url: normalizeResourceUrl(xlinkHref) });
    const styleElement = element as HTMLElement | SVGElement;
    for (let index = 0; index < styleElement.style.length; index += 1) {
      const property = styleElement.style.item(index);
      for (const url of unsafeCssUrls(styleElement.style.getPropertyValue(property))) {
        unsafeReferences.push({ element: label, kind: 'style', property, url });
      }
    }
  }
  return unsafeReferences;
}

function assertNoUnsafeResourceReferences(root: Element, issues: InlineResourceIssue[]) {
  const unsafeReferences = collectUnsafeResourceReferences(root);
  if (unsafeReferences.length > 0) {
    console.error('[sheetDomExport] remaining unsafe URLs', unsafeReferences);
    throw new Error(`Unsafe image resources remain in the sheet export clone: ${formatResourceReferences(unsafeReferences)}.${formatInlineIssues(issues) ? ` Resource issues: ${formatInlineIssues(issues)}` : ''}`);
  }
}

async function decodeCloneImages(clone: Element) {
  const images = Array.from(clone.querySelectorAll('img'));
  await Promise.all(
    images.map((image) => {
      if (image.decode) return image.decode().catch(() => undefined);
      return Promise.resolve();
    }),
  );
}

async function loadSvgImage(svg: string) {
  const url = await blobToDataUrl(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not render sheet DOM as SVG image.'));
    image.src = url;
  });
}

function standaloneSheetHtml(serializedSheet: string, targetWidth: number, targetHeight: number, sourceWidth: number, sourceHeight: number, scale: number) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        width: ${targetWidth}px;
        height: ${targetHeight}px;
        overflow: hidden;
        background: #ffffff;
      }
      * {
        box-sizing: border-box;
      }
    </style>
  </head>
  <body>
    <div style="width:${targetWidth}px;height:${targetHeight}px;overflow:hidden;background:#fff;">
      <div style="width:${sourceWidth}px;height:${sourceHeight}px;transform:scale(${scale});transform-origin:top left;">
        ${serializedSheet}
      </div>
    </div>
  </body>
</html>`;
}

async function captureSheetHtmlWithElectron(html: string, targetWidth: number, targetHeight: number) {
  const captureHtmlAsPng = window.zaparooDesktop?.captureHtmlAsPng;
  if (!captureHtmlAsPng) throw new Error('Electron sheet capture bridge is not available.');
  const result = await captureHtmlAsPng(html, targetWidth, targetHeight);
  if (!result.ok || !result.bytes) throw new Error(result.error ?? 'Electron sheet capture failed.');
  const bytes = result.bytes instanceof Uint8Array ? result.bytes : new Uint8Array(result.bytes);
  console.info('[sheetDomExport] Electron HTML capture success', { bytes: result.size ?? bytes.byteLength });
  return new Blob([bytes], { type: 'image/png' });
}

export async function renderSheetElementToPngBlob(element: HTMLElement, dpi: number) {
  console.info('[sheetDomExport] export start', {
    dpi,
    side: element.dataset.sheetSide,
    sheetIndex: element.dataset.sheetIndex,
    pageNumber: element.dataset.pageNumber,
  });
  await waitForFonts();

  // Page size comes from the rendered sheet element (stamped by PrintSheetPreview) so A3 exports at A3 px; A4 falls back.
  const pageWidthMm = Number(element.dataset.pageWidthMm) || A4_LANDSCAPE.widthMm;
  const pageHeightMm = Number(element.dataset.pageHeightMm) || A4_LANDSCAPE.heightMm;
  const targetWidth = mmToPx(pageWidthMm, dpi);
  const targetHeight = mmToPx(pageHeightMm, dpi);
  const rect = element.getBoundingClientRect();
  const sourceWidth = Math.max(1, rect.width);
  const sourceHeight = Math.max(1, rect.height);
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const clone = element.cloneNode(true) as HTMLElement;

  inlineComputedStyles(element, clone);
  const inlineContext = await inlineCanvasSafeResources(element, clone);
  console.info('[sheetDomExport] found image resources', {
    found: inlineContext.foundCount,
    convertedToDataUrl: inlineContext.convertedCount,
    fallbackPlaceholders: inlineContext.issues.length,
  });
  if (inlineContext.issues.length > 0) {
    console.warn('[sheetDomExport] Some image resources were replaced with transparent placeholders before sheet export.', inlineContext.issues);
  }
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  clone.style.margin = '0';
  clone.style.position = 'relative';
  clone.style.left = '0';
  clone.style.top = '0';
  clone.style.width = `${sourceWidth}px`;
  clone.style.height = `${sourceHeight}px`;
  clone.style.transform = 'none';
  await decodeCloneImages(clone);
  const remainingUnsafeUrls = collectUnsafeResourceReferences(clone);
  console.info('[sheetDomExport] remaining unsafe URLs', remainingUnsafeUrls);
  assertNoUnsafeResourceReferences(clone, inlineContext.issues);

  const serialized = new XMLSerializer().serializeToString(clone);
  const captureHtml = standaloneSheetHtml(serialized, targetWidth, targetHeight, sourceWidth, sourceHeight, scale);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${targetWidth}" height="${targetHeight}" viewBox="0 0 ${targetWidth} ${targetHeight}">`,
    `<foreignObject width="${targetWidth}" height="${targetHeight}">`,
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${targetWidth}px;height:${targetHeight}px;overflow:hidden;background:#fff;">`,
    `<div style="width:${sourceWidth}px;height:${sourceHeight}px;transform:scale(${scale});transform-origin:top left;">`,
    serialized,
    '</div>',
    '</div>',
    '</foreignObject>',
    '</svg>',
  ].join('');

  console.info('[sheetDomExport] capture start', { targetWidth, targetHeight });
  const image = await loadSvgImage(svg);
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas rendering is not available.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
  try {
    const blob = await canvasToBlob(canvas, inlineContext.issues);
    console.info('[sheetDomExport] canvas toBlob success', { bytes: blob.size });
    return blob;
  } catch (error) {
    console.error('[sheetDomExport] canvas toBlob failure', {
      error,
      remainingUnsafeUrls,
      inlineIssues: inlineContext.issues,
      serializedUrlMatches: Array.from(serialized.matchAll(/\b(?:file|https?|blob):[^"'\s>)]+/gi)).map((match) => match[0]).slice(0, 20),
    });
    if (window.zaparooDesktop?.captureHtmlAsPng) {
      console.warn('[sheetDomExport] falling back to Electron HTML capture after canvas toBlob failure.');
      return captureSheetHtmlWithElectron(captureHtml, targetWidth, targetHeight);
    }
    throw error;
  }
}

function sheetFilename(side: RenderedSheetSide, sheetIndex: number, pageNumber: number) {
  return `hello-mister-sheet-${String(pageNumber || sheetIndex + 1).padStart(2, '0')}-${side}.png`;
}

export async function renderPrintSheetElementsToPngBlobs(root: ParentNode, dpi: number): Promise<RenderedSheetImage[]> {
  const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-print-sheet-a4="true"]'));
  const rendered: RenderedSheetImage[] = [];
  for (const [index, element] of elements.entries()) {
    const side: RenderedSheetSide = element.dataset.sheetSide === 'back' ? 'back' : 'front';
    const sheetIndex = Number.isFinite(Number(element.dataset.sheetIndex)) ? Number(element.dataset.sheetIndex) : index;
    const pageNumber = Number.isFinite(Number(element.dataset.pageNumber)) ? Number(element.dataset.pageNumber) : index + 1;
    rendered.push({
      blob: await renderSheetElementToPngBlob(element, dpi),
      filename: sheetFilename(side, sheetIndex, pageNumber),
      side,
      sheetIndex,
      pageNumber,
      pageWidthMm: Number(element.dataset.pageWidthMm) || A4_LANDSCAPE.widthMm,
      pageHeightMm: Number(element.dataset.pageHeightMm) || A4_LANDSCAPE.heightMm,
    });
  }
  return rendered;
}

export function summaryForRenderedSheets(images: RenderedSheetImage[], options: SheetExportSummaryOptions): ExportSummary {
  const summary = createExportSummary(
    options.exportedCardsCount,
    images.filter((image) => image.side === 'front').length,
    images.filter((image) => image.side === 'back').length,
    options.dpi,
  );
  return summary;
}

export async function exportRenderedSheetPngZip(images: RenderedSheetImage[], options: SheetExportSummaryOptions) {
  const summary = summaryForRenderedSheets(images, options);
  if (images.length === 1) {
    return {
      bytes: new Uint8Array(await images[0].blob.arrayBuffer()),
      filename: images[0].filename,
      mimeType: 'image/png',
      summary,
    };
  }

  const zip = new JSZip();
  images.forEach((image) => zip.file(image.filename, image.blob));
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return {
    bytes,
    filename: 'hello-mister-card-stickers-sheets.zip',
    mimeType: 'application/zip',
    summary,
  };
}
