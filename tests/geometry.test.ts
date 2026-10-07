import { describe, expect, it } from 'vitest';
import {
  clampToViewport,
  computeCrop,
  intersect,
  nearlySameRect,
  visibleFraction,
} from '../src/core/geometry';

describe('computeCrop', () => {
  const viewport = { width: 1000, height: 800 };

  it('maps CSS pixels 1:1 at devicePixelRatio 1', () => {
    const crop = computeCrop({
      rect: { x: 100, y: 50, width: 300, height: 200 },
      viewport,
      image: { width: 1000, height: 800 },
    });
    expect(crop).not.toBeNull();
    expect(crop!.sourceRect).toEqual({ x: 100, y: 50, width: 300, height: 200 });
    expect(crop!.scale).toBe(1);
    expect(crop!.clipped).toBe(false);
  });

  it('scales by the captured bitmap size at devicePixelRatio 2', () => {
    const crop = computeCrop({
      rect: { x: 100, y: 50, width: 300, height: 200 },
      viewport,
      image: { width: 2000, height: 1600 },
    });
    expect(crop!.sourceRect).toEqual({ x: 200, y: 100, width: 600, height: 400 });
    expect(crop!.scale).toBe(2);
  });

  it('handles fractional ratios (1.5× zoom / DPR) by rounding outward', () => {
    const crop = computeCrop({
      rect: { x: 10.4, y: 10.4, width: 100.3, height: 50.3 },
      viewport,
      image: { width: 1500, height: 1200 },
    });
    expect(crop!.sourceRect.x).toBe(15);
    expect(crop!.sourceRect.y).toBe(15);
    expect(crop!.sourceRect.width).toBe(Math.ceil(110.7 * 1.5) - 15);
    expect(crop!.scale).toBe(1.5);
  });

  it('clips to the viewport and reports the visible fraction', () => {
    const crop = computeCrop({
      rect: { x: 0, y: 600, width: 1000, height: 400 },
      viewport,
      image: { width: 1000, height: 800 },
    });
    expect(crop!.cssRect).toEqual({ x: 0, y: 600, width: 1000, height: 200 });
    expect(crop!.visibleFraction).toBe(0.5);
    expect(crop!.clipped).toBe(true);
  });

  it('clips negative (scrolled-past) offsets', () => {
    const crop = computeCrop({
      rect: { x: -50, y: -100, width: 200, height: 300 },
      viewport,
      image: { width: 2000, height: 1600 },
    });
    expect(crop!.sourceRect).toEqual({ x: 0, y: 0, width: 300, height: 400 });
  });

  it('returns null when the element is fully outside the viewport', () => {
    expect(
      computeCrop({
        rect: { x: 0, y: 900, width: 100, height: 100 },
        viewport,
        image: { width: 1000, height: 800 },
      }),
    ).toBeNull();
  });

  it('returns null for invalid sizes', () => {
    expect(
      computeCrop({
        rect: { x: 0, y: 0, width: 10, height: 10 },
        viewport: { width: 0, height: 0 },
        image: { width: 1, height: 1 },
      }),
    ).toBeNull();
  });

  it('never exceeds the bitmap bounds', () => {
    const crop = computeCrop({
      rect: { x: 900, y: 700, width: 500, height: 500 },
      viewport,
      image: { width: 1250, height: 1000 },
    });
    const s = crop!.sourceRect;
    expect(s.x + s.width).toBeLessThanOrEqual(1250);
    expect(s.y + s.height).toBeLessThanOrEqual(1000);
  });
});

describe('rect helpers', () => {
  it('intersects rects', () => {
    expect(
      intersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }),
    ).toEqual({ x: 5, y: 5, width: 5, height: 5 });
    expect(
      intersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 20, width: 5, height: 5 }),
    ).toBeNull();
  });

  it('detects nearly identical rects', () => {
    expect(
      nearlySameRect(
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 1, y: 2, width: 99, height: 101 },
      ),
    ).toBe(true);
    expect(
      nearlySameRect(
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 10, y: 0, width: 90, height: 100 },
      ),
    ).toBe(false);
  });

  it('computes visible fraction', () => {
    expect(
      visibleFraction({ x: 0, y: 0, width: 100, height: 100 }, { width: 50, height: 100 }),
    ).toBe(0.5);
    expect(visibleFraction({ x: 0, y: 0, width: 0, height: 0 }, { width: 50, height: 100 })).toBe(
      0,
    );
  });

  it('clamps the panel inside the viewport', () => {
    expect(
      clampToViewport(
        { x: 5000, y: -40 },
        { width: 340, height: 600 },
        { width: 1280, height: 720 },
      ),
    ).toEqual({ x: 932, y: 8 });
    expect(
      clampToViewport(
        { x: 100, y: 100 },
        { width: 340, height: 600 },
        { width: 1280, height: 720 },
      ),
    ).toEqual({ x: 100, y: 100 });
  });
});
