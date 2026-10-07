import type { Measurer } from './measure';
import { area, containsPoint, nearlySameRect } from './geometry';
import {
  hasDirectText,
  isExtensionNode,
  isIgnorable,
  isMeaningful,
  isRegionCandidate,
  significance,
  visibleElementChildren,
} from './filters';

export interface Point {
  x: number;
  y: number;
}

/**
 * Chooses the region to highlight for the deepest element under the pointer.
 * Walks up to the first region-sized meaningful element, then collapses through
 * same-size wrappers toward the more semantic ancestor.
 */
export function pickHoverCandidate(deepest: Element | null, m: Measurer): Element | null {
  if (!deepest || isExtensionNode(deepest)) return null;
  let el: Element | null = deepest;
  let fallback: Element | null = null;
  while (el && el.tagName.toLowerCase() !== 'html') {
    const tag = el.tagName.toLowerCase();
    if (tag === 'body') break;
    if (!fallback && isMeaningful(el, m)) fallback = el;
    if (isRegionCandidate(el, m)) return collapseWrappers(el, m);
    el = el.parentElement;
  }
  if (fallback) return collapseWrappers(fallback, m);
  return null;
}

function collapseWrappers(el: Element, m: Measurer): Element {
  let current = el;
  let parent = current.parentElement;
  while (
    parent &&
    parent.tagName.toLowerCase() !== 'body' &&
    parent.tagName.toLowerCase() !== 'html'
  ) {
    if (!nearlySameRect(m.rect(parent), m.rect(current))) break;
    if (isIgnorable(parent, m)) break;
    if (significance(parent, m) >= significance(current, m)) current = parent;
    parent = parent.parentElement;
  }
  return current;
}

/** Nearest meaningful visible ancestor whose bounds differ from the current selection. */
export function selectParent(current: Element, m: Measurer): Element | null {
  const base = m.rect(current);
  let p = current.parentElement;
  while (p) {
    const tag = p.tagName.toLowerCase();
    if (tag === 'html') return null;
    if (isMeaningful(p, m) && !nearlySameRect(m.rect(p), base)) return p;
    if (tag === 'body') return null;
    p = p.parentElement;
  }
  return null;
}

/**
 * Meaningful descendants one "visual level" below `el`: wrappers with the same bounds
 * as their parent are transparently descended into.
 */
export function meaningfulChildren(el: Element, m: Measurer, maxDepth = 6): Element[] {
  const out: Element[] = [];
  const base = m.rect(el);
  const visit = (node: Element, depth: number) => {
    for (const c of visibleElementChildren(node, m)) {
      const r = m.rect(c);
      if (isMeaningful(c, m) && !nearlySameRect(r, base)) out.push(c);
      else if (depth < maxDepth && c.children.length > 0) visit(c, depth + 1);
    }
  };
  visit(el, 0);
  return out;
}

export function scoreChild(
  child: Element,
  parentArea: number,
  point: Point | null,
  m: Measurer,
): number {
  const r = m.rect(child);
  let score = 0;
  if (point && containsPoint(r, point.x, point.y)) score += 100;
  score += significance(child, m) * 3;
  score += parentArea > 0 ? (area(r) / parentArea) * 20 : 0;
  if (hasDirectText(child) || (child.textContent ?? '').trim().length > 0) score += 2;
  score += Math.min(child.getElementsByTagName('*').length, 50) / 10;
  return score;
}

/** Most meaningful visible child, preferring the one under the pointer. */
export function selectChild(
  current: Element,
  m: Measurer,
  point: Point | null = null,
): Element | null {
  const kids = meaningfulChildren(current, m);
  if (kids.length === 0) return null;
  const parentArea = area(m.rect(current));
  let best: Element | null = null;
  let bestScore = -Infinity;
  for (const k of kids) {
    const s = scoreChild(k, parentArea, point, m);
    if (s > bestScore) {
      best = k;
      bestScore = s;
    }
  }
  return best;
}

export interface StableResult {
  current: Element | null;
  /** When set, call update again after this many ms to commit a pending change. */
  retryIn?: number;
}

/**
 * Hysteresis for hover selection: a new candidate must persist briefly before replacing
 * the current one. Nested (ancestor/descendant) changes need longer, which removes
 * flicker when the pointer crosses padding between nested regions.
 */
export class StableCandidate {
  current: Element | null = null;
  private pending: Element | null = null;
  private pendingSince = 0;

  constructor(
    private readonly nestedDelay = 140,
    private readonly siblingDelay = 45,
  ) {}

  update(next: Element | null, now: number): StableResult {
    if (next === this.current) {
      this.pending = null;
      return { current: this.current };
    }
    if (!this.current) {
      this.current = next;
      this.pending = null;
      return { current: next };
    }
    const nested = next !== null && (this.current.contains(next) || next.contains(this.current));
    const delay = nested ? this.nestedDelay : this.siblingDelay;
    if (this.pending !== next) {
      this.pending = next;
      this.pendingSince = now;
      return { current: this.current, retryIn: delay };
    }
    const elapsed = now - this.pendingSince;
    if (elapsed >= delay) {
      this.current = next;
      this.pending = null;
      return { current: next };
    }
    return { current: this.current, retryIn: delay - elapsed };
  }

  /** Force a selection (keyboard navigation, lock). */
  set(el: Element | null): void {
    this.current = el;
    this.pending = null;
  }
}
