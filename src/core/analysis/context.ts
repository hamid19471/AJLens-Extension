import type { Measurer } from '../measure';
import { isIgnorable } from '../filters';
import { cleanText } from '../sanitize';

export interface AnalysisLimits {
  /** Maximum DOM depth below the selected root. */
  maxDepth: number;
  /** Maximum number of elements walked. */
  maxNodes: number;
  /** Maximum number of elements whose computed styles are sampled for evidence. */
  maxStyleSamples: number;
  /** Maximum stylesheet rules scanned for responsive evidence. */
  maxRules: number;
}

export const DEFAULT_LIMITS: AnalysisLimits = {
  maxDepth: 14,
  maxNodes: 1500,
  maxStyleSamples: 400,
  maxRules: 6000,
};

export interface AnalysisContext {
  root: Element;
  doc: Document;
  win: Window;
  m: Measurer;
  limits: AnalysisLimits;
  /** Visible elements in document order, including the root; capped by limits. */
  elements: Element[];
  depthOf: Map<Element, number>;
  totalDescendants: number;
  truncated: boolean;
  warnings: string[];
  assumptions: string[];
}

const LEAF_TAGS = new Set([
  'svg',
  'canvas',
  'video',
  'iframe',
  'select',
  'object',
  'embed',
  'math',
]);

export function createContext(
  root: Element,
  m: Measurer,
  limits: AnalysisLimits = DEFAULT_LIMITS,
  win: Window = root.ownerDocument.defaultView ?? window,
): AnalysisContext {
  const elements: Element[] = [];
  const depthOf = new Map<Element, number>();
  let truncated = false;
  const walk = (el: Element, depth: number) => {
    if (elements.length >= limits.maxNodes) {
      truncated = true;
      return;
    }
    elements.push(el);
    depthOf.set(el, depth);
    if (LEAF_TAGS.has(el.tagName.toLowerCase())) return;
    if (depth >= limits.maxDepth) {
      if (el.children.length > 0) truncated = true;
      return;
    }
    for (const c of Array.from(el.children)) {
      if (isIgnorable(c, m)) continue;
      walk(c, depth + 1);
    }
  };
  walk(root, 0);
  const totalDescendants = root.getElementsByTagName('*').length;
  const warnings: string[] = [];
  if (truncated) {
    warnings.push(
      `Oversized selection: ${totalDescendants} descendants. Analysis was capped at ${limits.maxNodes} elements / depth ${limits.maxDepth}; consider selecting a smaller section.`,
    );
  }
  return {
    root,
    doc: root.ownerDocument,
    win,
    m,
    limits,
    elements,
    depthOf,
    totalDescendants,
    truncated,
    warnings,
    assumptions: [],
  };
}

/** Best-effort accessible name (aria-label → labelledby → alt → title → text). */
export function accessibleName(el: Element, maxLen = 80): string {
  const aria = el.getAttribute('aria-label');
  if (aria && aria.trim()) return cleanText(aria, maxLen);
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ');
    if (text.trim()) return cleanText(text, maxLen);
  }
  const tag = el.tagName.toLowerCase();
  if (tag === 'img' || tag === 'area') {
    const alt = el.getAttribute('alt');
    if (alt !== null) return cleanText(alt, maxLen);
  }
  if (tag === 'input' || tag === 'select' || tag === 'textarea') {
    const input = el as HTMLInputElement;
    const label = input.labels?.[0]?.textContent;
    if (label && label.trim()) return cleanText(label, maxLen);
    if (input.type === 'submit' || input.type === 'button' || input.type === 'reset') {
      return cleanText(input.value || input.type, maxLen);
    }
  }
  const title = el.getAttribute('title');
  if (title && title.trim()) return cleanText(title, maxLen);
  if (tag === 'svg') {
    const t = el.querySelector('title')?.textContent;
    if (t && t.trim()) return cleanText(t, maxLen);
    return '';
  }
  const text = (el as HTMLElement).innerText ?? el.textContent ?? '';
  if (text.trim()) return cleanText(text, maxLen);
  const img = el.querySelector('img[alt]');
  if (img) return cleanText(img.getAttribute('alt') ?? '', maxLen);
  return '';
}

/** Text belonging directly to the element (not to its children). */
export function directText(el: Element): string {
  let out = '';
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3) out += n.textContent ?? '';
  }
  return out.replace(/\s+/g, ' ').trim();
}

export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
