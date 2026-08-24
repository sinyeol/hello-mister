import { CardPreview } from '@sticker-v1/components/cards/CardPreview';
import type { CardItem, Category, ExportSettings, LocalAsset, SheetCardPlacement, Template } from '@sticker-v1/types';
import { templateForCardSide } from '@sticker-v1/utils/cardTemplateSnapshots';
import { getPageDimsMm } from '@sticker-v1/export/pageDimensions';
import { cornerMarkSegmentsForGeometryMm, cutLineDashArrayMm, getCutLineGeometryMm, normalizeCutLineSettings, roundedRectPathMm } from '@sticker-v1/utils/cutLines';

interface PrintSheetPreviewProps {
  title: string;
  side: 'front' | 'back';
  sheetIndex?: number;
  pageNumber?: number;
  placements: SheetCardPlacement[];
  cardsById: Record<string, CardItem>;
  categoriesById: Record<string, Category>;
  assetsById: Record<string, LocalAsset>;
  templates: Template[];
  settings: ExportSettings;
  editable?: boolean;
  selectedSheetItemIds?: string[];
  onToggleSheetItem?: (sheetItemId: string) => void;
  onMoveCard?: (fromSheetItemId: string, toSheetItemId: string) => void;
  showTitle?: boolean;
  hideLabels?: boolean;
}

function templateForCard(card: CardItem, side: 'front' | 'back', templates: Template[]) {
  return templateForCardSide(card, templates, side);
}

function isLandscapeTemplate(template?: Template) {
  return Boolean(template && (template.canvas.orientation === 'landscape' || template.canvas.width > template.canvas.height));
}

function CutLineOverlay({
  placements,
  settings,
  side,
  cardsById,
  templates,
}: {
  placements: SheetCardPlacement[];
  settings: ExportSettings;
  side: 'front' | 'back';
  cardsById: Record<string, CardItem>;
  templates: Template[];
}) {
  const cutLineSettings = normalizeCutLineSettings(settings.cutLineSettings);
  if (!cutLineSettings.enabled) return null;

  const dashArray = cutLineDashArrayMm(cutLineSettings.style).join(' ');
  const { widthMm: pageWidthMm, heightMm: pageHeightMm } = getPageDimsMm(settings);

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-30 h-full w-full"
      viewBox={`0 0 ${pageWidthMm} ${pageHeightMm}`}
      aria-hidden="true"
    >
      {placements.map((placement) => {
        const key = placement.sheetItemId ?? placement.coordinateLockKey;
        const card = cardsById[placement.cardId];
        const template = card ? templateForCard(card, side, templates) : undefined;
        const geometry = getCutLineGeometryMm(placement, cutLineSettings, template?.canvas);
        if (cutLineSettings.style === 'corner-marks') {
          return (
            <g key={`cut-${key}`}>
              {geometry.radiusMm > 0 ? (
                <path
                  d={roundedRectPathMm(geometry.rect, geometry.radiusMm)}
                  fill="none"
                  stroke={cutLineSettings.color}
                  strokeWidth={Math.max(0.05, cutLineSettings.widthMm * 0.75)}
                  strokeOpacity={0.22}
                  strokeDasharray="1 1"
                />
              ) : null}
              {cornerMarkSegmentsForGeometryMm(geometry, cutLineSettings).map((segment, index) => (
                <line
                  key={`${key}-${index}`}
                  x1={segment.x1Mm}
                  y1={segment.y1Mm}
                  x2={segment.x2Mm}
                  y2={segment.y2Mm}
                  stroke={cutLineSettings.color}
                  strokeWidth={cutLineSettings.widthMm}
                  strokeLinecap="square"
                  fill="none"
                />
              ))}
            </g>
          );
        }
        return (
          <path
            key={`cut-${key}`}
            d={roundedRectPathMm(geometry.rect, geometry.radiusMm)}
            fill="none"
            stroke={cutLineSettings.color}
            strokeWidth={cutLineSettings.widthMm}
            strokeDasharray={dashArray || undefined}
          />
        );
      })}
    </svg>
  );
}

export function PrintSheetPreview({
  title,
  side,
  sheetIndex = 0,
  pageNumber = 1,
  placements,
  cardsById,
  categoriesById,
  assetsById,
  templates,
  settings,
  editable = false,
  selectedSheetItemIds = [],
  onToggleSheetItem,
  onMoveCard,
  showTitle = true,
  hideLabels = false,
}: PrintSheetPreviewProps) {
  const { widthMm: pageWidthMm, heightMm: pageHeightMm } = getPageDimsMm(settings);
  return (
    <section className="print-sheet-page rounded-lg border border-line bg-white p-4 shadow-surface">
      {showTitle ? <h3 className="print-sheet-title mb-3 text-sm font-semibold">{title}</h3> : null}
      <div
        className="relative w-full overflow-hidden rounded border border-neutral-300 bg-white"
        style={{ aspectRatio: `${pageWidthMm} / ${pageHeightMm}` }}
        data-print-sheet-a4="true"
        data-page-width-mm={pageWidthMm}
        data-page-height-mm={pageHeightMm}
        data-sheet-side={side}
        data-sheet-index={sheetIndex}
        data-page-number={pageNumber}
      >
        <div className="absolute inset-0">
          {placements.map((placement) => {
            const card = cardsById[placement.cardId];
            if (!card) return null;
            const category = categoriesById[card.categoryId];
            const visiblePlacement = placement;
            const template = templateForCard(card, side, templates);
            const shouldRotateLandscape = isLandscapeTemplate(template) && visiblePlacement.heightMm >= visiblePlacement.widthMm;
            const widthMm = visiblePlacement.widthMm;
            const heightMm = visiblePlacement.heightMm;
            const sheetItemId = placement.sheetItemId ?? placement.coordinateLockKey;
            const selected = selectedSheetItemIds.includes(sheetItemId);
            return (
              <div
                key={sheetItemId}
                draggable={editable}
                onDragStart={(event) => {
                  if (!editable) return;
                  event.dataTransfer.setData('text/plain', sheetItemId);
                  event.dataTransfer.setData('application/x-zaparoo-sheet-card-id', card.id);
                }}
                onDragOver={(event) => {
                  if (editable) event.preventDefault();
                }}
                onDrop={(event) => {
                  if (!editable) return;
                  event.preventDefault();
                  const fromSheetItemId = event.dataTransfer.getData('text/plain');
                  if (fromSheetItemId && fromSheetItemId !== sheetItemId) onMoveCard?.(fromSheetItemId, sheetItemId);
                }}
                onClick={(event) => {
                  if (!editable) return;
                  event.stopPropagation();
                  onToggleSheetItem?.(sheetItemId);
                }}
                className={`absolute ${editable ? 'cursor-move' : ''}`}
                style={{
                  left: `${(visiblePlacement.xMm / pageWidthMm) * 100}%`,
                  top: `${(visiblePlacement.yMm / pageHeightMm) * 100}%`,
                  width: `${(widthMm / pageWidthMm) * 100}%`,
                  height: `${((heightMm + (placement.labelHeightMm ?? settings.labelHeightMm ?? 6)) / pageHeightMm) * 100}%`,
                }}
                title={`${placement.indexOnSheet + 1}: ${placement.coordinateLockKey}`}
              >
                <div
                  className={`relative overflow-hidden rounded-sm ${selected ? 'ring-2 ring-primary ring-offset-2' : ''}`}
                  style={{ height: `${(heightMm / (heightMm + (placement.labelHeightMm ?? settings.labelHeightMm ?? 6))) * 100}%` }}
                >
                  <div
                    className={shouldRotateLandscape ? 'absolute left-1/2 top-1/2' : 'absolute inset-0'}
                    style={shouldRotateLandscape
                      ? {
                          width: `${(heightMm / widthMm) * 100}%`,
                          transform: 'translate(-50%, -50%) rotate(90deg)',
                          transformOrigin: 'center center',
                        }
                      : undefined}
                  >
                    <CardPreview card={card} category={category} assetsById={assetsById} templates={templates} side={side} hideCardOutline />
                  </div>
                </div>
                {!hideLabels && (
                  <p
                    className="mt-1 overflow-hidden text-center text-[8px] leading-tight text-neutral-700"
                    style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
                  >
                    {card.front.titleText || card.id}
                  </p>
                )}
              </div>
            );
          })}
          <CutLineOverlay placements={placements} settings={settings} side={side} cardsById={cardsById} templates={templates} />
        </div>
      </div>
    </section>
  );
}
