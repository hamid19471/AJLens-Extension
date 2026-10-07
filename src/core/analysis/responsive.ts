import type { MediaQueryEvidence, ResponsiveSummary, LayoutSummary } from '../../shared/types';
import type { AnalysisContext } from './context';
import { round } from '../geometry';

export interface StylesheetScan {
  mediaQueries: MediaQueryEvidence[];
  containerQueries: number;
  inaccessible: number;
  accessible: number;
  referencedVars: Set<string>;
  fluidUnits: boolean;
}

const MAX_MATCH_ELEMENTS = 150;
const VAR_REF = /var\(\s*(--[\w-]+)/g;

function safeMatches(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

/**
 * Scans same-origin stylesheets for media/container rules and var() references that apply to
 * the selected section. Cross-origin sheets throw on cssRules access and are only counted.
 */
export function scanStylesheets(ctx: AnalysisContext): StylesheetScan {
  const sample = ctx.elements.slice(0, MAX_MATCH_ELEMENTS);
  const media = new Map<string, MediaQueryEvidence>();
  const referencedVars = new Set<string>();
  let containerQueries = 0;
  let inaccessible = 0;
  let accessible = 0;
  let budget = ctx.limits.maxRules;
  let fluidUnits = false;

  const appliesToSection = (selectorText: string): boolean => {
    // Strip pseudo-classes/elements that would never match statically.
    const sel = selectorText.replace(
      /::?(?:before|after|hover|focus|focus-visible|focus-within|active|visited|placeholder|marker|selection)\b/g,
      '',
    );
    return sample.some((el) => safeMatches(el, sel || '*'));
  };

  const walk = (rules: CSSRuleList, mediaText: string | null) => {
    for (const rule of Array.from(rules)) {
      if (budget-- <= 0) return;
      const r = rule as CSSRule & {
        selectorText?: string;
        media?: MediaList;
        cssRules?: CSSRuleList;
        style?: CSSStyleDeclaration;
        conditionText?: string;
      };
      if (r.selectorText && r.style) {
        if (!appliesToSection(r.selectorText)) continue;
        const text = r.style.cssText;
        for (const m of text.matchAll(VAR_REF)) referencedVars.add(m[1]);
        if (/clamp\(|\d(?:vw|vh|vmin|cqi|dvh|svh)\b/.test(text)) fluidUnits = true;
        if (mediaText) {
          const ev = media.get(mediaText);
          if (ev) {
            ev.ruleCount++;
            if (ev.sampleSelectors.length < 4) ev.sampleSelectors.push(r.selectorText.slice(0, 80));
          } else {
            let matches: boolean;
            try {
              matches = ctx.win.matchMedia(mediaText).matches;
            } catch {
              matches = false;
            }
            media.set(mediaText, {
              query: mediaText,
              matches,
              ruleCount: 1,
              sampleSelectors: [r.selectorText.slice(0, 80)],
            });
          }
        }
        continue;
      }
      if (r.media && r.cssRules && rule.cssText.startsWith('@media')) {
        walk(r.cssRules, r.media.mediaText);
      } else if (r.cssRules && rule.cssText.startsWith('@container')) {
        containerQueries++;
        walk(r.cssRules, mediaText);
      } else if (r.cssRules) {
        walk(r.cssRules, mediaText); // @supports, @layer, @scope
      }
    }
  };

  for (const sheet of Array.from(ctx.doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
      accessible++;
    } catch {
      inaccessible++;
      continue;
    }
    walk(rules, null);
  }
  for (const el of sample) {
    const inline = el.getAttribute('style');
    if (inline) for (const m of inline.matchAll(VAR_REF)) referencedVars.add(m[1]);
  }
  return {
    mediaQueries: [...media.values()].sort((a, b) => b.ruleCount - a.ruleCount).slice(0, 16),
    containerQueries,
    inaccessible,
    accessible,
    referencedVars,
    fluidUnits,
  };
}

export function breakpointsFrom(queries: string[]): number[] {
  const out = new Set<number>();
  for (const q of queries) {
    for (const m of q.matchAll(/(?:min|max)-width\s*:\s*([\d.]+)(px|em|rem)/g)) {
      const n = parseFloat(m[1]) * (m[2] === 'px' ? 1 : 16);
      out.add(Math.round(n));
    }
    for (const m of q.matchAll(/width\s*[<>]=?\s*([\d.]+)(px|em|rem)/g)) {
      out.add(Math.round(parseFloat(m[1]) * (m[2] === 'px' ? 1 : 16)));
    }
  }
  return [...out].sort((a, b) => a - b);
}

export function analyzeResponsive(
  ctx: AnalysisContext,
  scan: StylesheetScan,
  layout: LayoutSummary,
): ResponsiveSummary {
  const vw = ctx.win.innerWidth;
  const vh = ctx.win.innerHeight;
  const outer = ctx.m.rect(ctx.root);
  const clues: string[] = [];
  const inferred: string[] = [];

  const s = ctx.m.style(ctx.root);
  if (s.flexWrap === 'wrap')
    clues.push('Discovered: the root flex container uses flex-wrap: wrap.');
  if (
    /repeat\(\s*auto-(fit|fill)/.test(s.gridTemplateColumns) ||
    /minmax\(/.test(s.gridTemplateColumns)
  ) {
    clues.push(`Discovered: grid uses intrinsic responsive columns (${s.gridTemplateColumns}).`);
  }
  if (scan.fluidUnits)
    clues.push('Discovered: matching CSS rules use fluid units (clamp()/vw/vh).');
  if (layout.maxContentWidth)
    clues.push(`Measured: content is constrained by max-width ${layout.maxContentWidth}px.`);
  const imgs = ctx.root.querySelectorAll('img[srcset], picture source[media]');
  if (imgs.length)
    clues.push(`Discovered: ${imgs.length} responsive image source(s) (srcset / picture).`);
  if (scan.containerQueries)
    clues.push(`Discovered: ${scan.containerQueries} @container rule block(s).`);

  const all = scan.mediaQueries.map((m) => m.query);
  const bps = breakpointsFrom(all);
  const active = scan.mediaQueries.filter((m) => m.matches).map((m) => m.query);
  if (bps.length) {
    inferred.push(
      `Use the discovered breakpoints (${bps.map((b) => `${b}px`).join(', ')}) for this section, mapped to the destination project's breakpoint scale.`,
    );
  } else if (scan.inaccessible > 0) {
    inferred.push(
      `No accessible media queries target this section (${scan.inaccessible} cross-origin stylesheet(s) could not be read). Choose breakpoints with visual judgment; common values are ~640/768/1024px.`,
    );
  } else {
    inferred.push(
      'No media queries target this section; it may be fluid by default. Validate at ~375px, ~768px and ~1280px widths.',
    );
  }
  inferred.push(layout.mobileStackingHint);

  return {
    measured: {
      viewportWidth: vw,
      viewportHeight: vh,
      devicePixelRatio: ctx.win.devicePixelRatio || 1,
      orientation: vw >= vh ? 'landscape' : 'portrait',
      sectionWidthRatio: vw ? round(outer.width / vw, 3) : 0,
    },
    discovered: {
      mediaQueries: scan.mediaQueries,
      containerQueries: scan.containerQueries,
      inaccessibleStylesheets: scan.inaccessible,
      accessibleStylesheets: scan.accessible,
    },
    activeBreakpoints: active,
    clues,
    inferred,
  };
}
