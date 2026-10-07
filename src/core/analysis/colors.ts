import type { ColorSummary, DesignToken, ValueUsage } from '../../shared/types';
import type { AnalysisContext } from './context';
import { directText } from './context';
import { luminance, normalizeColor, normalizeColorsIn, parseColor, saturation } from '../color';
import { conciseSelector } from '../selector';
import { px, roundPx } from '../styles';
import { area } from '../geometry';

class Tally {
  private map = new Map<string, ValueUsage & { weight: number }>();
  add(value: string, usage: string, weight = 1): void {
    if (!value) return;
    const e = this.map.get(value);
    if (e) {
      e.count++;
      e.weight += weight;
      if (e.usage.length < 3 && !e.usage.includes(usage)) e.usage.push(usage);
    } else {
      this.map.set(value, { value, count: 1, usage: [usage], weight });
    }
  }
  list(max = 12, byWeight = false): ValueUsage[] {
    return [...this.map.values()]
      .sort((a, b) => (byWeight ? b.weight - a.weight : b.count - a.count))
      .slice(0, max)
      .map(({ value, count, usage }) => ({ value, count, usage }));
  }
}

/** First non-transparent background color found walking up from `el`. */
export function effectiveBackground(
  el: Element,
  getStyle: (e: Element) => CSSStyleDeclaration,
): string {
  let cur: Element | null = el;
  while (cur) {
    const c = parseColor(getStyle(cur).backgroundColor);
    if (c && c.a > 0.05) return normalizeColor(getStyle(cur).backgroundColor);
    cur = cur.parentElement;
  }
  return '#ffffff';
}

const TOKEN_HINT =
  /(color|colour|bg|background|surface|text|fg|foreground|border|accent|primary|secondary|brand|muted|radius|rounded|space|spacing|gap|font|shadow|elevation|size|leading|tracking|ring|card|popover|destructive)/i;

/** Custom properties visible on the selected element, prioritizing token-like names and referenced vars. */
export function collectCustomProperties(
  style: CSSStyleDeclaration,
  referenced: Set<string>,
  max = 60,
): { name: string; value: string }[] {
  const out: { name: string; value: string; score: number }[] = [];
  const len = style.length ?? 0;
  for (let i = 0; i < len && i < 3000; i++) {
    const name = style.item(i);
    if (!name.startsWith('--')) continue;
    const value = style.getPropertyValue(name).trim();
    if (!value || value.length > 120 || /url\(\s*['"]?data:/i.test(value)) continue;
    let score = 0;
    if (referenced.has(name)) score += 10;
    if (TOKEN_HINT.test(name)) score += 3;
    if (/^(--tw-|--wp--preset--gradient|--fa-)/.test(name)) score -= 4;
    out.push({ name, value: normalizeColorsIn(value), score });
  }
  for (const name of referenced) {
    if (out.some((o) => o.name === name)) continue;
    const value = style.getPropertyValue(name).trim();
    if (value && value.length <= 120)
      out.push({ name, value: normalizeColorsIn(value), score: 10 });
  }
  return out
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, max)
    .map(({ name, value }) => ({ name, value }));
}

export function analyzeColors(
  ctx: AnalysisContext,
  referencedVars: Set<string> = new Set(),
): ColorSummary {
  const backgrounds = new Tally();
  const foregrounds = new Tally();
  const borders = new Tally();
  const accents = new Tally();
  const gradients = new Tally();
  const shadows = new Tally();
  const radii = new Tally();
  const spacing = new Tally();
  const controlHeights = new Tally();

  const rootBg = effectiveBackground(ctx.root, (e) => ctx.m.style(e));
  backgrounds.add(rootBg, `${conciseSelector(ctx.root)} (effective)`, area(ctx.m.rect(ctx.root)));

  const sample = ctx.elements.slice(0, ctx.limits.maxStyleSamples);
  for (const el of sample) {
    const s = ctx.m.style(el);
    const sel = conciseSelector(el);
    const tag = el.tagName.toLowerCase();
    const r = ctx.m.rect(el);
    const bg = parseColor(s.backgroundColor);
    if (bg && bg.a > 0.05 && el !== ctx.root) {
      const v = normalizeColor(s.backgroundColor);
      backgrounds.add(v, sel, area(r));
      if (saturation(bg) > 0.35 && luminance(bg) > 0.03 && luminance(bg) < 0.9)
        accents.add(v, `${sel} background`, area(r));
    }
    if (directText(el) || ['button', 'input', 'a'].includes(tag)) {
      const fg = parseColor(s.color);
      const v = normalizeColor(s.color);
      foregrounds.add(v, sel, directText(el).length || 1);
      if (fg && saturation(fg) > 0.4 && luminance(fg) > 0.03 && luminance(fg) < 0.85)
        accents.add(v, `${sel} text`);
    }
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const w = px(s.getPropertyValue(`border-${side}-width`));
      const st = s.getPropertyValue(`border-${side}-style`);
      if (w > 0 && st && st !== 'none' && st !== 'hidden') {
        borders.add(
          normalizeColor(s.getPropertyValue(`border-${side}-color`)),
          `${sel} (${w}px ${st})`,
        );
        break;
      }
    }
    const bgi = s.backgroundImage;
    if (bgi && bgi.includes('gradient'))
      gradients.add(normalizeColorsIn(roundPx(bgi)).slice(0, 240), sel);
    if (s.boxShadow && s.boxShadow !== 'none' && /\d/.test(s.boxShadow))
      shadows.add(normalizeColorsIn(roundPx(s.boxShadow)), sel);
    if (s.textShadow && s.textShadow !== 'none' && /\dpx/.test(s.textShadow))
      shadows.add(`text-shadow: ${normalizeColorsIn(roundPx(s.textShadow))}`, sel);
    const radius = roundPx(s.borderTopLeftRadius);
    if (radius && px(radius) > 0) radii.add(radius, sel);
    for (const prop of [
      'padding-top',
      'padding-right',
      'padding-bottom',
      'padding-left',
      'row-gap',
      'column-gap',
      'margin-top',
      'margin-bottom',
    ]) {
      const v = s.getPropertyValue(prop);
      const n = px(v);
      if (n > 0 && n < 400 && v.endsWith('px'))
        spacing.add(`${Math.round(n * 10) / 10}px`, `${sel} ${prop}`);
    }
    if (['button', 'input', 'select'].includes(tag) || el.getAttribute('role') === 'button') {
      controlHeights.add(`${Math.round(r.height * 10) / 10}px`, sel);
    }
  }

  const bgList = backgrounds.list(10, true);
  const fgList = foregrounds.list(10, true);
  const accentList = accents.list(6, true);
  const borderList = borders.list(8);
  const radiusList = radii.list(8).sort((a, b) => px(a.value) - px(b.value));
  const spacingList = spacing.list(14).sort((a, b) => px(a.value) - px(b.value));
  const shadowList = shadows.list(6);

  const tokens: DesignToken[] = [];
  const tok = (name: string, value: string | undefined, source: string) => {
    if (value) tokens.push({ name, value, provenance: 'inferred', source });
  };
  tok('--color-background', bgList[0]?.value, 'largest painted background area');
  tok(
    '--color-surface',
    bgList.find((b) => b.value !== bgList[0]?.value)?.value,
    'second most prominent background',
  );
  tok('--color-text', fgList[0]?.value, 'most common text color (weighted by text length)');
  tok('--color-text-muted', fgList[1]?.value, 'second most common text color');
  tok('--color-accent', accentList[0]?.value, 'most prominent saturated color');
  tok('--color-border', borderList[0]?.value, 'most common border color');
  radiusList
    .slice(0, 3)
    .forEach((r, i) =>
      tok(`--radius-${['sm', 'md', 'lg'][i]}`, r.value, `observed border-radius (${r.count}×)`),
    );
  [...spacing.list(6)]
    .sort((a, b) => px(a.value) - px(b.value))
    .forEach((sp, i) => tok(`--space-${i + 1}`, sp.value, `frequent spacing value (${sp.count}×)`));
  shadowList
    .filter((sh) => !sh.value.startsWith('text-shadow'))
    .slice(0, 2)
    .forEach((sh, i) => tok(`--shadow-${i + 1}`, sh.value, 'observed box-shadow'));
  const ch = controlHeights.list(1)[0];
  tok('--control-height', ch?.value, 'most common control height');

  return {
    backgrounds: bgList,
    foregrounds: fgList,
    borders: borderList,
    accents: accentList,
    gradients: gradients.list(6),
    shadows: shadowList,
    radii: radiusList,
    spacing: spacingList,
    controlHeights: controlHeights.list(6),
    customProperties: collectCustomProperties(ctx.m.style(ctx.root), referencedVars),
    suggestedTokens: tokens,
  };
}
