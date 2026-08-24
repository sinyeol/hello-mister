export type EntityId = string;
export type ISODateString = string;
export type HexColor = `#${string}`;
export type Millimeters = number;
export type Pixels = number;

export type CardSide = 'front' | 'back';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

export interface PixelRect {
  xPx: Pixels;
  yPx: Pixels;
  widthPx: Pixels;
  heightPx: Pixels;
}

export interface MmRect {
  xMm: Millimeters;
  yMm: Millimeters;
  widthMm: Millimeters;
  heightMm: Millimeters;
}

export interface Transform2D {
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  opacity?: number;
}
