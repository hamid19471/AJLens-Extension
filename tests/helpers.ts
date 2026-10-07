import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Measurer } from '../src/core/measure';
import type { Rect } from '../src/shared/types';

/**
 * jsdom has no layout engine, so tests describe geometry with data-rect="x,y,w,h".
 * Elements without one inherit a default 200×60 box positioned at their parent's origin.
 */
export function testMeasurer(defaultRect: Rect = { x: 0, y: 0, width: 200, height: 60 }): Measurer {
  const rect = (el: Element): Rect => {
    const attr = el.getAttribute('data-rect');
    if (attr) {
      const [x, y, width, height] = attr.split(',').map(Number);
      return { x, y, width, height };
    }
    const parent = el.parentElement;
    if (
      parent &&
      parent.tagName !== 'BODY' &&
      parent.tagName !== 'HTML' &&
      parent.hasAttribute('data-rect')
    ) {
      const p = rect(parent);
      return { x: p.x, y: p.y, width: defaultRect.width, height: defaultRect.height };
    }
    return { ...defaultRect };
  };
  return {
    rect,
    // jsdom cannot compute pseudo-element styles; report them as absent.
    style: (el, pseudo) =>
      pseudo ? document.createElement('div').style : window.getComputedStyle(el),
    viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
    reset: () => undefined,
  };
}

export function loadFixture(name: string): void {
  const html = readFileSync(resolve(__dirname, 'fixtures', name), 'utf8');
  document.open();
  document.write(html);
  document.close();
}

export function setBody(html: string): void {
  document.body.innerHTML = html;
}

export function $(selector: string): Element {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`No element for ${selector}`);
  return el;
}
