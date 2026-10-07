import type { Rect, Size } from '../shared/types';

export function round(value: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function roundRect(r: Rect, digits = 1): Rect {
  return {
    x: round(r.x, digits),
    y: round(r.y, digits),
    width: round(r.width, digits),
    height: round(r.height, digits),
  };
}

export function toRect(r: { left: number; top: number; width: number; height: number }): Rect {
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

export function area(r: Rect): number {
  return Math.max(0, r.width) * Math.max(0, r.height);
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

export function containsPoint(r: Rect, px: number, py: number): boolean {
  return px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height;
}

/** True when two rects are within `tolerance` CSS pixels on every edge. */
export function nearlySameRect(a: Rect, b: Rect, tolerance = 3): boolean {
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}

export function rectsOverlap(a: Rect, b: Rect, minOverlap = 2): boolean {
  const i = intersect(a, b);
  return i !== null && i.width > minOverlap && i.height > minOverlap;
}

export function formatSize(r: Size): string {
  return `${round(r.width)} × ${round(r.height)} px`;
}

export interface CropInput {
  /** Element rect in CSS pixels relative to the viewport. */
  rect: Rect;
  /** Viewport size in CSS pixels (window.innerWidth / innerHeight). */
  viewport: Size;
  /** Size of the captured bitmap in device pixels. */
  image: Size;
}

export interface CropResult {
  /** Visible portion in CSS pixels. */
  cssRect: Rect;
  /** Source rectangle in captured-image pixels (integers). */
  sourceRect: Rect;
  /** Image pixels per CSS pixel. */
  scale: number;
  /** Fraction (0–1) of the element area that was visible. */
  visibleFraction: number;
  clipped: boolean;
}

/**
 * Converts an element rect into a crop rectangle within a captureVisibleTab bitmap.
 * The scale is derived from the bitmap itself, which already reflects devicePixelRatio
 * and browser zoom, so it stays correct even when window.devicePixelRatio is stale.
 */
export function computeCrop({ rect, viewport, image }: CropInput): CropResult | null {
  if (viewport.width <= 0 || viewport.height <= 0 || image.width <= 0 || image.height <= 0)
    return null;
  const visible = intersect(rect, { x: 0, y: 0, width: viewport.width, height: viewport.height });
  if (!visible) return null;
  const scaleX = image.width / viewport.width;
  const scaleY = image.height / viewport.height;
  const scale = (scaleX + scaleY) / 2;
  const sx = Math.max(0, Math.floor(visible.x * scaleX));
  const sy = Math.max(0, Math.floor(visible.y * scaleY));
  const ex = Math.min(image.width, Math.ceil((visible.x + visible.width) * scaleX));
  const ey = Math.min(image.height, Math.ceil((visible.y + visible.height) * scaleY));
  if (ex <= sx || ey <= sy) return null;
  const total = area(rect);
  const visibleFraction = total > 0 ? Math.min(1, area(visible) / total) : 0;
  return {
    cssRect: visible,
    sourceRect: { x: sx, y: sy, width: ex - sx, height: ey - sy },
    scale: round(scale, 3),
    visibleFraction: round(visibleFraction, 3),
    clipped: visibleFraction < 0.995,
  };
}

/** Fraction of a rect visible inside the viewport. */
export function visibleFraction(rect: Rect, viewport: Size): number {
  const total = area(rect);
  if (total === 0) return 0;
  const v = intersect(rect, { x: 0, y: 0, width: viewport.width, height: viewport.height });
  return v ? area(v) / total : 0;
}

/** Keeps a panel of the given size inside the viewport with a margin. */
export function clampToViewport(
  pos: { x: number; y: number },
  size: Size,
  viewport: Size,
  margin = 8,
): { x: number; y: number } {
  const maxX = Math.max(margin, viewport.width - size.width - margin);
  const maxY = Math.max(margin, viewport.height - Math.min(size.height, 48) - margin);
  return {
    x: Math.round(Math.min(Math.max(margin, pos.x), maxX)),
    y: Math.round(Math.min(Math.max(margin, pos.y), maxY)),
  };
}
