import type { Measurer } from './measure';
import { area } from './geometry';

export const HOST_TAG = 'section-lens-root';

export const IGNORED_TAGS = new Set([
  'script',
  'style',
  'meta',
  'link',
  'head',
  'noscript',
  'template',
  'title',
  'base',
  'br',
  'wbr',
  'source',
  'track',
  'param',
  HOST_TAG,
]);

export const SEMANTIC_REGION_TAGS = new Set([
  'section',
  'article',
  'main',
  'header',
  'footer',
  'nav',
  'form',
  'dialog',
  'aside',
  'figure',
  'table',
  'ul',
  'ol',
  'dl',
  'fieldset',
  'details',
  'blockquote',
]);

export const LANDMARK_ROLES = new Set([
  'banner',
  'navigation',
  'main',
  'contentinfo',
  'complementary',
  'region',
  'form',
  'search',
  'dialog',
  'alertdialog',
  'list',
  'grid',
  'table',
  'tabpanel',
  'menu',
  'menubar',
  'listbox',
  'tablist',
  'group',
  'article',
  'feed',
]);

const REGION_CLASS_HINT =
  /(?:^|[-_ ])(?:card|hero|banner|section|container|wrapper|panel|grid|row|feature|pricing|plan|tier|testimonial|review|faq|cta|footer|header|nav|navbar|menu|sidebar|gallery|carousel|slider|modal|dialog|form|list|item|tile|block|module|widget|stats?|product|post|teaser|jumbotron|masthead)(?:$|[-_ ]|s\b)/i;

/** Small elements that are almost never the region a user wants by default. */
const INLINE_TAGS = new Set([
  'span',
  'a',
  'b',
  'i',
  'em',
  'strong',
  'small',
  'label',
  'svg',
  'path',
  'g',
  'use',
  'img',
  'abbr',
  'code',
  'sup',
  'sub',
  'mark',
  'u',
  's',
  'time',
  'kbd',
  'button',
  'input',
  'select',
  'textarea',
  'option',
]);

export function isExtensionNode(el: Element): boolean {
  return el.tagName.toLowerCase() === HOST_TAG || el.closest(HOST_TAG) !== null;
}

/** Hidden or not rendered (display:none, visibility hidden, opacity 0, zero area). */
export function isHidden(el: Element, m: Measurer): boolean {
  if (el.hasAttribute('hidden')) return true;
  const s = m.style(el);
  if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') return true;
  if (parseFloat(s.opacity || '1') === 0) return true;
  if (s.display === 'contents') return false;
  const r = m.rect(el);
  return r.width < 1 || r.height < 1;
}

/** Elements that must never become inspection candidates. */
export function isIgnorable(el: Element, m: Measurer): boolean {
  const tag = el.tagName.toLowerCase();
  if (IGNORED_TAGS.has(tag)) return true;
  if (tag === 'html') return true;
  if (isExtensionNode(el)) return true;
  if (el.namespaceURI === 'http://www.w3.org/2000/svg' && tag !== 'svg') return true;
  return isHidden(el, m);
}

export function hasVisualBox(el: Element, m: Measurer): boolean {
  const s = m.style(el);
  const bg = s.backgroundColor;
  const hasBg = !!bg && bg !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg);
  const hasImage = !!s.backgroundImage && s.backgroundImage !== 'none';
  const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some((side) => {
    const w = parseFloat(s.getPropertyValue(`border-${side.toLowerCase()}-width`) || '0');
    const st = s.getPropertyValue(`border-${side.toLowerCase()}-style`);
    return w > 0 && st !== 'none' && st !== 'hidden';
  });
  const hasShadow = !!s.boxShadow && s.boxShadow !== 'none';
  return hasBg || hasImage || hasBorder || hasShadow;
}

export function visibleElementChildren(el: Element, m: Measurer): Element[] {
  const out: Element[] = [];
  for (const c of Array.from(el.children)) {
    if (!isIgnorable(c, m)) out.push(c);
  }
  return out;
}

/**
 * Semantic/visual significance score. Higher = more likely to be a region the user wants.
 * Purely additive and deterministic so tests can assert ordering.
 */
export function significance(el: Element, m: Measurer): number {
  const tag = el.tagName.toLowerCase();
  let score = 0;
  if (SEMANTIC_REGION_TAGS.has(tag)) score += 4;
  if (/^h[1-6]$/.test(tag) || tag === 'p') score += 1;
  const role = el.getAttribute('role');
  if (role && LANDMARK_ROLES.has(role)) score += 3;
  if (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) score += 1;
  const cls = typeof el.className === 'string' ? el.className : '';
  if (REGION_CLASS_HINT.test(cls) || REGION_CLASS_HINT.test(el.id)) score += 2;
  if (hasVisualBox(el, m)) score += 2;
  const s = m.style(el);
  const display = s.display;
  const kids = visibleElementChildren(el, m).length;
  if ((display.includes('flex') || display.includes('grid')) && kids >= 2) score += 2;
  if (kids >= 3) score += 1;
  if (INLINE_TAGS.has(tag)) score -= 3;
  if (display === 'inline' || display === 'contents') score -= 2;
  return score;
}

const TEXT_BLOCK_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'label',
  'legend',
  'caption',
  'dt',
  'dd',
  'figcaption',
]);

export const MIN_CANDIDATE_WIDTH = 24;
export const MIN_CANDIDATE_HEIGHT = 16;
/** Minimum area for the default hover candidate — avoids icons and words. */
export const MIN_REGION_AREA = 96 * 64;

/** Meaningful = visible, not tiny, and either semantic, boxed, or a real layout group. */
export function isMeaningful(el: Element, m: Measurer): boolean {
  if (isIgnorable(el, m)) return false;
  const r = m.rect(el);
  if (r.width < MIN_CANDIDATE_WIDTH || r.height < MIN_CANDIDATE_HEIGHT) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'body') return true;
  if (
    [
      'img',
      'video',
      'canvas',
      'picture',
      'svg',
      'iframe',
      'button',
      'input',
      'select',
      'textarea',
    ].includes(tag)
  ) {
    return true;
  }
  if (/^h[1-6]$/.test(tag) || tag === 'p' || tag === 'li' || tag === 'a') return true;
  return significance(el, m) >= 1 || hasDirectText(el);
}

export function isRegionCandidate(el: Element, m: Measurer): boolean {
  if (!isMeaningful(el, m)) return false;
  if (area(m.rect(el)) < MIN_REGION_AREA) return false;
  const tag = el.tagName.toLowerCase();
  if (INLINE_TAGS.has(tag) && tag !== 'a') return false;
  // Text blocks are reachable with "Smaller" but never the default hover region.
  if (TEXT_BLOCK_TAGS.has(tag)) return false;
  return significance(el, m) >= 2;
}

export function hasDirectText(el: Element): boolean {
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3 && (n.textContent ?? '').trim().length > 1) return true;
  }
  return false;
}
