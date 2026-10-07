import type {
  ButtonInfo,
  FormControlInfo,
  HeadingInfo,
  LinkInfo,
  LinkIntent,
  ListInfo,
  RepeatedPattern,
  StructureNode,
  StructureSummary,
} from '../../shared/types';
import type { AnalysisContext } from './context';
import { accessibleName, directText } from './context';
import {
  buildStableSelector,
  conciseSelector,
  isStableId,
  meaningfulClasses,
  structuralSignature,
} from '../selector';
import { cleanText, redactText, sanitizeUrl } from '../sanitize';
import { roundRect } from '../geometry';
import { LANDMARK_ROLES, SEMANTIC_REGION_TAGS, isIgnorable } from '../filters';

const MAX_TREE_NODES = 220;
const MAX_TEXT_ITEMS = 120;
const MAX_TEXT_CHARS = 6000;

function isSensitiveControl(el: Element): boolean {
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  const ac = (el.getAttribute('autocomplete') ?? '').toLowerCase();
  return type === 'password' || type === 'hidden' || /cc-|password|one-time-code/.test(ac);
}

export function linkIntent(href: string, origin: string): LinkIntent {
  const h = href.trim();
  if (!h) return 'other';
  if (h.startsWith('#')) return 'anchor';
  if (/^mailto:/i.test(h)) return 'mailto';
  if (/^tel:/i.test(h)) return 'tel';
  if (/^javascript:/i.test(h)) return 'javascript';
  try {
    const u = new URL(h, origin === 'null' ? undefined : origin);
    return u.origin === origin ? 'internal' : 'external';
  } catch {
    return 'other';
  }
}

/** Groups consecutive siblings with the same structural signature. */
export function groupRepeatedSiblings(
  children: Element[],
): { el: Element; count: number; signature: string }[] {
  const groups: { el: Element; count: number; signature: string }[] = [];
  for (const c of children) {
    const sig = structuralSignature(c);
    const last = groups[groups.length - 1];
    if (last && last.signature === sig) last.count++;
    else groups.push({ el: c, count: 1, signature: sig });
  }
  return groups;
}

function isRepeat(group: { count: number; signature: string }): boolean {
  const hasClass = group.signature.includes('.');
  return group.count >= 3 || (group.count >= 2 && hasClass);
}

export function detectRepeatedPatterns(ctx: AnalysisContext): RepeatedPattern[] {
  const patterns: RepeatedPattern[] = [];
  const parents = new Set<Element>();
  for (const el of ctx.elements)
    if (el.parentElement && ctx.depthOf.has(el.parentElement)) parents.add(el.parentElement);
  for (const parent of parents) {
    const kids = Array.from(parent.children).filter((c) => ctx.depthOf.has(c));
    if (kids.length < 2) continue;
    const bySig = new Map<string, Element[]>();
    for (const k of kids) {
      const sig = structuralSignature(k);
      const list = bySig.get(sig) ?? [];
      list.push(k);
      bySig.set(sig, list);
    }
    for (const [signature, items] of bySig) {
      if (!isRepeat({ count: items.length, signature })) continue;
      const tag = items[0].tagName.toLowerCase();
      if (['br', 'path', 'option'].includes(tag)) continue;
      const rects = items.map((i) => ctx.m.rect(i));
      const w = rects.reduce((a, r) => a + r.width, 0) / rects.length;
      const h = rects.reduce((a, r) => a + r.height, 0) / rects.length;
      patterns.push({
        selector: `${conciseSelector(parent)} > ${conciseSelector(items[0])}`,
        signature,
        count: items.length,
        itemSize: { width: Math.round(w * 10) / 10, height: Math.round(h * 10) / 10 },
        sampleText: items
          .slice(0, 3)
          .map((i) =>
            redactText(cleanText((i as HTMLElement).innerText ?? i.textContent ?? '', 70)),
          )
          .filter(Boolean),
      });
    }
  }
  return patterns
    .sort((a, b) => b.count * (b.itemSize?.width ?? 1) - a.count * (a.itemSize?.width ?? 1))
    .slice(0, 12);
}

function buildTree(ctx: AnalysisContext): { root: StructureNode; nodes: number } {
  let budget = MAX_TREE_NODES;
  const build = (el: Element, depth: number): StructureNode => {
    budget--;
    const tag = el.tagName.toLowerCase();
    const node: StructureNode = {
      tag,
      selector: conciseSelector(el),
      depth,
      classes: meaningfulClasses(el, 5),
      children: [],
    };
    if (el.id && isStableId(el.id)) node.id = el.id;
    const role = el.getAttribute('role');
    if (role) node.role = role;
    const label = el.getAttribute('aria-label');
    if (label) node.label = redactText(cleanText(label, 60));
    const text = directText(el);
    if (text && !isSensitiveControl(el)) node.text = redactText(cleanText(text, 80));
    const display = ctx.m.style(el).display;
    if (display && display !== 'block' && display !== 'inline') node.display = display;
    if (depth <= 3) node.bounds = roundRect(ctx.m.rect(el));
    if (tag === 'svg') return node;
    const kids = Array.from(el.children).filter(
      (c) => ctx.depthOf.has(c) && !isIgnorable(c, ctx.m),
    );
    for (const g of groupRepeatedSiblings(kids)) {
      if (budget <= 0) break;
      const child = build(g.el, depth + 1);
      if (isRepeat(g)) child.repeat = g.count;
      node.children.push(child);
    }
    return node;
  };
  const root = build(ctx.root, 0);
  return { root, nodes: MAX_TREE_NODES - budget };
}

function collectVisibleText(ctx: AnalysisContext): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let chars = 0;
  for (const el of ctx.elements) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'svg' || tag === 'textarea' || tag === 'select' || tag === 'option') continue;
    if (isSensitiveControl(el)) continue;
    let text = directText(el);
    if (!text && (tag === 'input' || tag === 'button')) {
      const type = (el.getAttribute('type') ?? '').toLowerCase();
      if (type === 'submit' || type === 'button') text = (el as HTMLInputElement).value ?? '';
    }
    const t = redactText(cleanText(text, 200));
    if (t.length < 1 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    chars += t.length;
    if (out.length >= MAX_TEXT_ITEMS || chars >= MAX_TEXT_CHARS) break;
  }
  return out;
}

export function analyzeStructure(ctx: AnalysisContext): StructureSummary {
  const tagCounts: Record<string, number> = {};
  const headings: HeadingInfo[] = [];
  const lists: ListInfo[] = [];
  const formControls: FormControlInfo[] = [];
  const links: LinkInfo[] = [];
  const buttons: ButtonInfo[] = [];
  const landmarks: string[] = [];
  let maxDepth = 0;
  const origin = ctx.doc.location?.origin ?? 'null';

  for (const el of ctx.elements) {
    const tag = el.tagName.toLowerCase();
    tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
    maxDepth = Math.max(maxDepth, ctx.depthOf.get(el) ?? 0);
    const role = el.getAttribute('role') ?? '';

    if (
      SEMANTIC_REGION_TAGS.has(tag) &&
      ['header', 'footer', 'nav', 'main', 'aside', 'section', 'article', 'form'].includes(tag)
    ) {
      landmarks.push(conciseSelector(el));
    } else if (
      role &&
      LANDMARK_ROLES.has(role) &&
      [
        'banner',
        'navigation',
        'main',
        'contentinfo',
        'complementary',
        'region',
        'search',
        'form',
      ].includes(role)
    ) {
      landmarks.push(`${conciseSelector(el)}[role=${role}]`);
    }

    const hm = /^h([1-6])$/.exec(tag);
    if (hm || role === 'heading') {
      const level = hm ? Number(hm[1]) : Number(el.getAttribute('aria-level') ?? 2);
      const text = redactText(cleanText(el.textContent ?? '', 120));
      if (text) headings.push({ level, text });
    }
    if (tag === 'ul' || tag === 'ol') {
      lists.push({
        selector: conciseSelector(el),
        ordered: tag === 'ol',
        itemCount: Array.from(el.children).filter((c) => c.tagName === 'LI').length,
      });
    }
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      const type = tag === 'input' ? (el.getAttribute('type') ?? 'text').toLowerCase() : tag;
      if (type === 'hidden') continue;
      const name = el.getAttribute('name') ?? undefined;
      const placeholder = el.getAttribute('placeholder');
      formControls.push({
        tag,
        type,
        name: name && name.length <= 40 ? name : undefined,
        label: accessibleName(el, 60) || undefined,
        placeholder: placeholder ? redactText(cleanText(placeholder, 60)) : undefined,
        required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
        autocomplete: el.getAttribute('autocomplete') ?? undefined,
      });
    }
    if (tag === 'a' && el.hasAttribute('href')) {
      const href = el.getAttribute('href') ?? '';
      const intent = linkIntent(href, origin);
      links.push({
        text: redactText(accessibleName(el, 60)),
        intent,
        href: intent === 'javascript' ? undefined : sanitizeUrl(href, ctx.doc.baseURI),
        opensNewTab: el.getAttribute('target') === '_blank',
      });
    }
    if (
      tag === 'button' ||
      role === 'button' ||
      (tag === 'input' &&
        ['submit', 'button', 'reset'].includes((el.getAttribute('type') ?? '').toLowerCase()))
    ) {
      buttons.push({
        text: redactText(accessibleName(el, 60)),
        type: el.getAttribute('type') ?? (tag === 'button' ? 'submit' : role || tag),
        label: el.getAttribute('aria-label') ?? undefined,
      });
    }
  }

  const { root } = buildTree(ctx);
  return {
    root,
    stableSelector: buildStableSelector(ctx.root),
    elementCount: ctx.totalDescendants + 1,
    analyzedElementCount: ctx.elements.length,
    maxDepth,
    truncated: ctx.truncated,
    tagCounts,
    landmarks: landmarks.slice(0, 20),
    headings: headings.slice(0, 40),
    lists: lists.slice(0, 20),
    formControls: formControls.slice(0, 40),
    links: links.slice(0, 60),
    buttons: buttons.slice(0, 40),
    repeatedPatterns: detectRepeatedPatterns(ctx),
    visibleText: collectVisibleText(ctx),
  };
}
