import { memo } from 'react';
import type { TemplateCanvas, TemplateCornerRadii, TemplateLayer } from '@sticker-v1/types';
import { layerCornerRadiiPx } from '@sticker-v1/utils/cardGeometry';
import {
  templateShapeFillValue,
  templateShapeFillStyle,
  templateShapeKind,
  templateShapeStrokeValue,
  templateShapeStrokeWidth,
  isTemplateShapeFillTransparent,
} from '@sticker-v1/utils/templateShapes';

interface TemplateShapeLayerProps {
  layer: TemplateLayer;
  canvas: TemplateCanvas;
}

function roundedRectPath(width: number, height: number, halfStroke: number, radii: TemplateCornerRadii) {
  const x = halfStroke;
  const y = halfStroke;
  const w = Math.max(0, width - halfStroke * 2);
  const h = Math.max(0, height - halfStroke * 2);
  const tl = Math.max(0, radii.topLeft);
  const tr = Math.max(0, radii.topRight);
  const br = Math.max(0, radii.bottomRight);
  const bl = Math.max(0, radii.bottomLeft);
  return [
    `M ${x + tl} ${y}`,
    `H ${x + w - tr}`,
    tr > 0 ? `Q ${x + w} ${y} ${x + w} ${y + tr}` : `L ${x + w} ${y}`,
    `V ${y + h - br}`,
    br > 0 ? `Q ${x + w} ${y + h} ${x + w - br} ${y + h}` : `L ${x + w} ${y + h}`,
    `H ${x + bl}`,
    bl > 0 ? `Q ${x} ${y + h} ${x} ${y + h - bl}` : `L ${x} ${y + h}`,
    `V ${y + tl}`,
    tl > 0 ? `Q ${x} ${y} ${x + tl} ${y}` : `L ${x} ${y}`,
    'Z',
  ].join(' ');
}

function fillReferenceForLayer(layer: TemplateLayer, fillId: string) {
  const style = templateShapeFillStyle(layer);
  if (style.type === 'linearGradient' || style.type === 'radialGradient') return `url(#${fillId})`;
  if (style.type === 'none') return 'none';
  return style.color;
}

function ShapeFillDefs({ layer, fillId }: { layer: TemplateLayer; fillId: string }) {
  const style = templateShapeFillStyle(layer);
  if (style.type === 'linearGradient') {
    const angle = ((style.angle ?? 45) * Math.PI) / 180;
    const x = Math.cos(angle) * 50;
    const y = Math.sin(angle) * 50;
    return (
      <defs>
        <linearGradient id={fillId} x1={`${50 - x}%`} y1={`${50 - y}%`} x2={`${50 + x}%`} y2={`${50 + y}%`}>
          <stop offset="0%" stopColor={style.colors[0]} stopOpacity={style.opacity ?? 1} />
          <stop offset="100%" stopColor={style.colors[1]} stopOpacity={style.opacity ?? 1} />
        </linearGradient>
      </defs>
    );
  }
  if (style.type === 'radialGradient') {
    return (
      <defs>
        <radialGradient id={fillId} cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor={style.colors[0]} stopOpacity={style.opacity ?? 1} />
          <stop offset="100%" stopColor={style.colors[1]} stopOpacity={style.opacity ?? 1} />
        </radialGradient>
      </defs>
    );
  }
  return null;
}

function TemplateShapeLayerComponent({ layer, canvas }: TemplateShapeLayerProps) {
  const kind = templateShapeKind(layer);
  const width = Math.max(1, Number(layer.width ?? canvas.width));
  const height = Math.max(1, Number(layer.height ?? canvas.height));
  const strokeWidth = Math.min(templateShapeStrokeWidth(layer), width, height);
  const halfStroke = strokeWidth / 2;
  const fillId = `shape-fill-${layer.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const fill = fillReferenceForLayer(layer, fillId) || templateShapeFillValue(layer);
  const stroke = templateShapeStrokeValue(layer);
  const fillTransparent = isTemplateShapeFillTransparent(layer);

  if (kind === 'line') {
    const x1 = halfStroke;
    const x2 = Math.max(halfStroke, width - halfStroke);
    return (
      <svg className="block h-full w-full overflow-visible" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <line
          x1={x1}
          y1={height / 2}
          x2={x2}
          y2={height / 2}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          pointerEvents="stroke"
        />
      </svg>
    );
  }

  if (kind === 'ellipse') {
    return (
      <svg className="block h-full w-full overflow-visible" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <ShapeFillDefs layer={layer} fillId={fillId} />
        <ellipse
          cx={width / 2}
          cy={height / 2}
          rx={Math.max(0, (width - strokeWidth) / 2)}
          ry={Math.max(0, (height - strokeWidth) / 2)}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          pointerEvents={fillTransparent ? 'stroke' : 'visiblePainted'}
        />
      </svg>
    );
  }

  const innerWidth = Math.max(0, width - strokeWidth);
  const innerHeight = Math.max(0, height - strokeWidth);
  const supportsCornerRadius = kind === 'rectangle' || kind === 'roundedRectangle';
  // Unified R reference: the corner radius is defined on the shape's OUTER box (what the user sees), so stroke
  // thickness no longer changes the visible curve — the same mm R reads the same as the cut line / card. The drawn
  // path sits on the stroke centreline (inset by halfStroke), so its radius = outer R − halfStroke.
  const zeroRadii = { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 };
  const outerRadii = supportsCornerRadius ? layerCornerRadiiPx(layer, canvas, { width, height }) : zeroRadii;
  const radii = supportsCornerRadius
    ? {
        topLeft: Math.max(0, outerRadii.topLeft - halfStroke),
        topRight: Math.max(0, outerRadii.topRight - halfStroke),
        bottomRight: Math.max(0, outerRadii.bottomRight - halfStroke),
        bottomLeft: Math.max(0, outerRadii.bottomLeft - halfStroke),
      }
    : zeroRadii;
  const radius = radii.topLeft;
  const hasPerCornerRadii =
    supportsCornerRadius &&
    (Math.abs(radii.topLeft - radii.topRight) > 0.01 ||
      Math.abs(radii.topRight - radii.bottomRight) > 0.01 ||
      Math.abs(radii.bottomRight - radii.bottomLeft) > 0.01);

  return (
    <svg className="block h-full w-full overflow-visible" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <ShapeFillDefs layer={layer} fillId={fillId} />
      {hasPerCornerRadii ? (
        <path
          d={roundedRectPath(width, height, halfStroke, radii)}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          pointerEvents={fillTransparent ? 'stroke' : 'visiblePainted'}
        />
      ) : (
        <rect
          x={halfStroke}
          y={halfStroke}
          width={innerWidth}
          height={innerHeight}
          rx={radius}
          ry={radius}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          pointerEvents={fillTransparent ? 'stroke' : 'visiblePainted'}
        />
      )}
    </svg>
  );
}

export const TemplateShapeLayer = memo(TemplateShapeLayerComponent);
