import type {
  ElementRole,
  ElementStyleEvidence,
  LayoutRegion,
  LayoutSummary,
  Rect,
} from '../../shared/types';
import type { AnalysisContext } from './context';
import { directText } from './context';
import { conciseSelector } from '../selector';
import { meaningfulChildren } from '../selection';
import { normalizePseudo, normalizeStyles, px } from '../styles';
import { rectsOverlap, round, roundRect } from '../geometry';

const MAX_REGIONS = 24;
const MAX_EVIDENCE = 28;

/** Clusters 1-D positions within a tolerance and returns the cluster count. */
export function countClusters(values: number[], tolerance = 6): number {
  const sorted = [...values].sort((a, b) => a - b);
  let clusters = 0;
  let last = -Infinity;
  for (const v of sorted) {
    if (v - last > tolerance) clusters++;
    last = v;
  }
  return clusters;
}

export function detectArrangement(rects: Rect[]): {
  arrangement: LayoutSummary['arrangement'];
  rows: number;
  columns: number;
} {
  if (rects.length === 0) return { arrangement: 'empty', rows: 0, columns: 0 };
  if (rects.length === 1) return { arrangement: 'single', rows: 1, columns: 1 };
  let overlaps = 0;
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rectsOverlap(rects[i], rects[j], 8)) overlaps++;
    }
  }
  const rows = countClusters(rects.map((r) => r.y));
  const columns = countClusters(rects.map((r) => r.x));
  if (overlaps > 0 && overlaps >= rects.length / 2)
    return { arrangement: 'overlap', rows, columns };
  if (rows === 1) return { arrangement: 'row', rows, columns };
  if (columns === 1) return { arrangement: 'column', rows, columns };
  return { arrangement: 'grid', rows, columns };
}

function roleOf(el: Element, isRoot: boolean): ElementRole {
  if (isRoot) return 'root';
  const tag = el.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (['button', 'input', 'select', 'textarea', 'a'].includes(tag)) return 'control';
  if (['img', 'svg', 'video', 'canvas', 'picture'].includes(tag)) return 'media';
  if (directText(el)) return 'text';
  return 'container';
}

/** Picks representative elements for computed-style evidence (root, regions, first of each kind). */
function pickEvidenceElements(ctx: AnalysisContext, regions: Element[]): Element[] {
  const picked: Element[] = [ctx.root];
  const seenSelectors = new Set<string>([conciseSelector(ctx.root)]);
  const add = (el: Element) => {
    if (picked.length >= MAX_EVIDENCE) return;
    const sel = conciseSelector(el, 3);
    if (seenSelectors.has(sel)) return;
    seenSelectors.add(sel);
    picked.push(el);
  };
  regions.forEach(add);
  for (const el of ctx.elements) {
    const tag = el.tagName.toLowerCase();
    if (
      /^h[1-6]$/.test(tag) ||
      ['p', 'button', 'a', 'input', 'img', 'svg', 'li', 'label', 'select', 'textarea'].includes(tag)
    )
      add(el);
    if (picked.length >= MAX_EVIDENCE) break;
  }
  return picked;
}

export function styleEvidenceFor(
  ctx: AnalysisContext,
  el: Element,
  isRoot = false,
): ElementStyleEvidence {
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement ? ctx.m.style(el.parentElement) : null;
  const ev: ElementStyleEvidence = {
    selector: conciseSelector(el, 3),
    tag,
    role: roleOf(el, isRoot),
    bounds: roundRect(ctx.m.rect(el)),
    styles: normalizeStyles(ctx.m.style(el), {
      parent: isRoot ? null : parent,
      includeTransition: true,
      tag,
    }),
  };
  try {
    const before = normalizePseudo(ctx.m.style(el, '::before'));
    const after = normalizePseudo(ctx.m.style(el, '::after'));
    if (before) ev.before = before;
    if (after) ev.after = after;
  } catch {
    // Pseudo-element styles are unavailable in some environments.
  }
  return ev;
}

export function analyzeLayout(ctx: AnalysisContext): LayoutSummary {
  const { root, m } = ctx;
  const s = m.style(root);
  const outer = m.rect(root);
  const padding = {
    top: px(s.paddingTop),
    right: px(s.paddingRight),
    bottom: px(s.paddingBottom),
    left: px(s.paddingLeft),
  };
  const border = {
    top: px(s.borderTopWidth),
    right: px(s.borderRightWidth),
    bottom: px(s.borderBottomWidth),
    left: px(s.borderLeftWidth),
  };
  const contentBox: Rect = {
    x: outer.x + padding.left + border.left,
    y: outer.y + padding.top + border.top,
    width: Math.max(0, outer.width - padding.left - padding.right - border.left - border.right),
    height: Math.max(0, outer.height - padding.top - padding.bottom - border.top - border.bottom),
  };

  const regionEls = meaningfulChildren(root, m).slice(0, MAX_REGIONS);
  const regions: LayoutRegion[] = regionEls.map((el) => ({
    selector: conciseSelector(el),
    tag: el.tagName.toLowerCase(),
    bounds: roundRect(m.rect(el)),
    display: m.style(el).display,
  }));
  const { arrangement, rows, columns } = detectArrangement(regionEls.map((el) => m.rect(el)));

  // Centered container: a direct region (or the root) with equal side gaps inside its parent.
  let centeredContainer = false;
  let maxContentWidth: number | undefined;
  const candidates = [root, ...regionEls.slice(0, 4)];
  for (const el of candidates) {
    const parent = el === root ? root.parentElement : root;
    if (!parent) continue;
    const pr = m.rect(parent);
    const r = m.rect(el);
    const leftGap = r.x - pr.x;
    const rightGap = pr.x + pr.width - (r.x + r.width);
    const es = m.style(el);
    if (leftGap > 8 && Math.abs(leftGap - rightGap) <= 2) centeredContainer = true;
    const mw = es.maxWidth;
    if (mw && mw !== 'none' && mw.endsWith('px'))
      maxContentWidth = Math.max(maxContentWidth ?? 0, px(mw));
  }

  let absoluteElements = 0;
  let overlappingLayers = 0;
  const stickyOrFixed: string[] = [];
  for (const el of ctx.elements) {
    if (el === root) continue;
    const pos = m.style(el).position;
    if (pos === 'absolute') {
      absoluteElements++;
      const parent = el.parentElement;
      if (
        parent &&
        Array.from(parent.children).some(
          (sib) => sib !== el && ctx.depthOf.has(sib) && rectsOverlap(m.rect(sib), m.rect(el)),
        )
      ) {
        overlappingLayers++;
      }
    } else if (pos === 'sticky' || pos === 'fixed') {
      stickyOrFixed.push(`${conciseSelector(el)} (${pos})`);
    }
  }
  if (s.position === 'sticky' || s.position === 'fixed')
    stickyOrFixed.unshift(`${conciseSelector(root)} (${s.position}, selected root)`);

  const gap = s.rowGap === s.columnGap ? s.rowGap : `${s.rowGap} ${s.columnGap}`;
  const isFlex = s.display.includes('flex');
  const isGrid = s.display.includes('grid');

  const description: string[] = [];
  description.push(
    `Measured: the section is ${round(outer.width)} × ${round(outer.height)} px with padding ${padding.top}/${padding.right}/${padding.bottom}/${padding.left} px (top/right/bottom/left) and display:${s.display}.`,
  );
  if (isFlex)
    description.push(
      `Measured: flex container, direction ${s.flexDirection}, wrap ${s.flexWrap}, justify ${s.justifyContent}, align ${s.alignItems}, gap ${gap}.`,
    );
  if (isGrid)
    description.push(
      `Measured: grid container with columns "${s.gridTemplateColumns}" and rows "${s.gridTemplateRows}", gap ${gap}.`,
    );
  if (regions.length) {
    const label =
      arrangement === 'row'
        ? `${columns} items side by side in one row`
        : arrangement === 'column'
          ? `${rows} items stacked vertically`
          : arrangement === 'grid'
            ? `${regions.length} items in roughly ${rows} rows × ${columns} columns`
            : arrangement === 'overlap'
              ? `${regions.length} overlapping layers`
              : 'a single main child';
    description.push(`Measured: the first visual level contains ${label}.`);
  }
  if (centeredContainer)
    description.push(
      `Measured: content is horizontally centered${maxContentWidth ? ` with max-width ${maxContentWidth}px` : ''}.`,
    );
  if (absoluteElements)
    description.push(
      `Measured: ${absoluteElements} absolutely positioned element(s)${overlappingLayers ? `, ${overlappingLayers} overlapping siblings (layered decoration or badges)` : ''}.`,
    );

  let mobileStackingHint =
    'Inferred: keep the single-column flow on narrow screens; scale spacing down proportionally.';
  if (arrangement === 'row' && columns >= 2) {
    mobileStackingHint = `Inferred: the ${columns}-item row likely wraps or stacks vertically on narrow viewports (verify against discovered media queries; breakpoint not measured).`;
  } else if (arrangement === 'grid') {
    mobileStackingHint = `Inferred: the ${columns}-column grid likely reduces to 2 columns on tablets and 1 column on phones (breakpoints not measured).`;
  } else if (arrangement === 'overlap') {
    mobileStackingHint =
      'Inferred: layered elements may need repositioning on small screens; keep decorative layers behind content.';
  }

  return {
    outer: roundRect(outer),
    contentBox: roundRect(contentBox),
    padding,
    display: s.display,
    position: s.position,
    flexDirection: isFlex ? s.flexDirection : undefined,
    flexWrap: isFlex ? s.flexWrap : undefined,
    gridTemplateColumns: isGrid ? s.gridTemplateColumns : undefined,
    gridTemplateRows: isGrid ? s.gridTemplateRows : undefined,
    gap: isFlex || isGrid ? gap : undefined,
    alignItems: isFlex || isGrid ? s.alignItems : undefined,
    justifyContent: isFlex || isGrid ? s.justifyContent : undefined,
    arrangement,
    columns,
    rows,
    centeredContainer,
    maxContentWidth,
    absoluteElements,
    overlappingLayers,
    stickyOrFixed: stickyOrFixed.slice(0, 10),
    regions,
    description,
    mobileStackingHint,
    styleEvidence: pickEvidenceElements(ctx, regionEls).map((el) =>
      styleEvidenceFor(ctx, el, el === root),
    ),
  };
}
