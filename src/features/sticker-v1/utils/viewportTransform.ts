export interface ViewportTransform {
  zoom: number;
  panX: number;
  panY: number;
}

export const defaultViewportTransform: ViewportTransform = {
  zoom: 1,
  panX: 0,
  panY: 0,
};

export function clampZoom(value: number, minZoom = 0.25, maxZoom = 6) {
  return Math.min(Math.max(value, minZoom), maxZoom);
}

export function zoomViewportAtPoint(
  viewport: ViewportTransform,
  point: { x: number; y: number },
  nextZoom: number,
): ViewportTransform {
  const zoom = clampZoom(nextZoom);
  const worldX = (point.x - viewport.panX) / viewport.zoom;
  const worldY = (point.y - viewport.panY) / viewport.zoom;
  return {
    zoom,
    panX: point.x - worldX * zoom,
    panY: point.y - worldY * zoom,
  };
}

export function panViewport(viewport: ViewportTransform, delta: { x: number; y: number }): ViewportTransform {
  return {
    ...viewport,
    panX: viewport.panX + delta.x,
    panY: viewport.panY + delta.y,
  };
}

export function clampViewportToCanvas(
  viewport: ViewportTransform,
  {
    viewportWidth,
    viewportHeight,
    canvasWidth,
    canvasHeight,
    offsetX = 0,
    offsetY = 0,
    minZoom = 0.25,
    maxZoom = 6,
    minVisiblePx = 72,
    panMarginPx = 160,
  }: {
    viewportWidth: number;
    viewportHeight: number;
    canvasWidth: number;
    canvasHeight: number;
    offsetX?: number;
    offsetY?: number;
    minZoom?: number;
    maxZoom?: number;
    minVisiblePx?: number;
    panMarginPx?: number;
  },
): ViewportTransform {
  const zoom = clampZoom(viewport.zoom, minZoom, maxZoom);
  const displayWidth = Math.max(1, canvasWidth * zoom);
  const displayHeight = Math.max(1, canvasHeight * zoom);
  const originX = offsetX * zoom;
  const originY = offsetY * zoom;
  const visibleX = Math.min(displayWidth, Math.max(minVisiblePx, Math.min(panMarginPx, viewportWidth * 0.35)));
  const visibleY = Math.min(displayHeight, Math.max(minVisiblePx, Math.min(panMarginPx, viewportHeight * 0.35)));

  const minPanX = visibleX - originX - displayWidth;
  const maxPanX = viewportWidth - visibleX - originX;
  const minPanY = visibleY - originY - displayHeight;
  const maxPanY = viewportHeight - visibleY - originY;

  return {
    zoom,
    panX: Math.min(Math.max(viewport.panX, minPanX), maxPanX),
    panY: Math.min(Math.max(viewport.panY, minPanY), maxPanY),
  };
}

export function getCenteredViewTransform({
  viewportWidth,
  viewportHeight,
  canvasWidth,
  canvasHeight,
  offsetX = 0,
  offsetY = 0,
  zoom = 1,
  minZoom = 0.25,
  maxZoom = 6,
}: {
  viewportWidth: number;
  viewportHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  offsetX?: number;
  offsetY?: number;
  zoom?: number;
  minZoom?: number;
  maxZoom?: number;
}): ViewportTransform {
  const nextZoom = clampZoom(zoom, minZoom, maxZoom);
  return {
    zoom: nextZoom,
    panX: (viewportWidth - canvasWidth * nextZoom) / 2 - offsetX * nextZoom,
    panY: (viewportHeight - canvasHeight * nextZoom) / 2 - offsetY * nextZoom,
  };
}

export function getFitViewTransform({
  viewportWidth,
  viewportHeight,
  canvasWidth,
  canvasHeight,
  offsetX = 0,
  offsetY = 0,
  padding = 40,
  minZoom = 0.25,
  maxZoom = 6,
}: {
  viewportWidth: number;
  viewportHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  offsetX?: number;
  offsetY?: number;
  padding?: number;
  minZoom?: number;
  maxZoom?: number;
}): ViewportTransform {
  const availableWidth = Math.max(1, viewportWidth - padding * 2);
  const availableHeight = Math.max(1, viewportHeight - padding * 2);
  const zoom = clampZoom(
    Math.min(availableWidth / Math.max(canvasWidth, 1), availableHeight / Math.max(canvasHeight, 1)),
    minZoom,
    maxZoom,
  );
  return {
    zoom,
    panX: (viewportWidth - canvasWidth * zoom) / 2 - offsetX * zoom,
    panY: (viewportHeight - canvasHeight * zoom) / 2 - offsetY * zoom,
  };
}
