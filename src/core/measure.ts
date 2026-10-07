import type { Rect } from '../shared/types';
import { toRect } from './geometry';

/**
 * Abstraction over layout reads. The DOM implementation caches getComputedStyle and
 * getBoundingClientRect per pass so analyzers never re-read the same element twice.
 */
export interface Measurer {
  rect(el: Element): Rect;
  style(el: Element, pseudo?: '::before' | '::after'): CSSStyleDeclaration;
  viewport(): { width: number; height: number };
  /** Drop cached values (call after scroll/layout changes). */
  reset(): void;
}

export function createDomMeasurer(win: Window = window): Measurer {
  let rects = new WeakMap<Element, Rect>();
  let styles = new WeakMap<Element, CSSStyleDeclaration>();
  let pseudo = new WeakMap<Element, Map<string, CSSStyleDeclaration>>();
  return {
    rect(el) {
      let r = rects.get(el);
      if (!r) {
        r = toRect(el.getBoundingClientRect());
        rects.set(el, r);
      }
      return r;
    },
    style(el, p) {
      if (p) {
        let m = pseudo.get(el);
        if (!m) {
          m = new Map();
          pseudo.set(el, m);
        }
        let s = m.get(p);
        if (!s) {
          s = win.getComputedStyle(el, p);
          m.set(p, s);
        }
        return s;
      }
      let s = styles.get(el);
      if (!s) {
        s = win.getComputedStyle(el);
        styles.set(el, s);
      }
      return s;
    },
    viewport() {
      return { width: win.innerWidth, height: win.innerHeight };
    },
    reset() {
      rects = new WeakMap();
      styles = new WeakMap();
      pseudo = new WeakMap();
    },
  };
}
