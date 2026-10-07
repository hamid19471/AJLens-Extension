import type {
  FontFaceInfo,
  FontFamilyInfo,
  TypographyRole,
  TypographyStyle,
  TypographySummary,
} from '../../shared/types';
import type { AnalysisContext } from './context';
import { directText } from './context';
import { normalizeColor } from '../color';
import { cleanText, redactText } from '../sanitize';
import { px, roundPx } from '../styles';

export function primaryFamily(stack: string): string {
  const first = stack.split(',')[0] ?? '';
  return first.trim().replace(/^["']|["']$/g, '');
}

function median(values: number[]): number {
  if (!values.length) return 16;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function typographyRole(
  el: Element,
  style: { fontSize: string; fontWeight: string; textTransform: string },
  bodySize: number,
): TypographyRole {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role');
  if (/^h[1-6]$/.test(tag) || role === 'heading') return 'heading';
  if (
    ['button', 'input', 'select', 'textarea'].includes(tag) ||
    role === 'button' ||
    role === 'tab'
  )
    return 'control';
  const size = px(style.fontSize);
  const weight = parseInt(style.fontWeight, 10) || 400;
  if (size >= bodySize * 1.35 && weight >= 500) return 'heading';
  if (
    tag === 'label' ||
    tag === 'small' ||
    style.textTransform === 'uppercase' ||
    size <= bodySize * 0.82
  )
    return 'label';
  if (
    [
      'p',
      'li',
      'span',
      'div',
      'a',
      'dd',
      'dt',
      'td',
      'th',
      'blockquote',
      'figcaption',
      'em',
      'strong',
    ].includes(tag)
  )
    return 'body';
  return 'other';
}

function collectFontFaces(
  ctx: AnalysisContext,
  usedFamilies: Set<string>,
): { faces: FontFaceInfo[]; loaded: Set<string> } {
  const faces: FontFaceInfo[] = [];
  const loaded = new Set<string>();
  const seen = new Set<string>();
  const fonts = (ctx.doc as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts && typeof fonts.forEach === 'function') {
    try {
      fonts.forEach((face) => {
        const family = face.family.replace(/^["']|["']$/g, '');
        if (!usedFamilies.has(family.toLowerCase())) return;
        if (face.status === 'loaded') loaded.add(family.toLowerCase());
        const key = `${family}|${face.weight}|${face.style}`;
        if (seen.has(key)) return;
        seen.add(key);
        faces.push({ family, weight: face.weight, style: face.style, source: 'document.fonts' });
      });
    } catch {
      // FontFaceSet iteration is unsupported in some environments.
    }
  }
  for (const sheet of Array.from(ctx.doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin stylesheet — counted in responsive analysis
    }
    for (const rule of Array.from(rules)) {
      if (
        rule.constructor.name !== 'CSSFontFaceRule' &&
        !(rule.cssText ?? '').startsWith('@font-face')
      )
        continue;
      const style = (rule as CSSFontFaceRule).style;
      const family = (style.getPropertyValue('font-family') || '')
        .replace(/^["']|["']$/g, '')
        .trim();
      if (!family || !usedFamilies.has(family.toLowerCase())) continue;
      const weight = style.getPropertyValue('font-weight') || '400';
      const fstyle = style.getPropertyValue('font-style') || 'normal';
      const key = `${family}|${weight}|${fstyle}`;
      if (seen.has(key)) continue;
      seen.add(key);
      faces.push({ family, weight, style: fstyle, source: 'stylesheet' });
    }
  }
  return { faces: faces.slice(0, 24), loaded };
}

export function analyzeTypography(ctx: AnalysisContext): TypographySummary {
  const textEls: Element[] = [];
  for (const el of ctx.elements) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'svg') continue;
    if (directText(el) || ['button', 'input', 'select', 'textarea'].includes(tag)) textEls.push(el);
    if (textEls.length >= ctx.limits.maxStyleSamples) break;
  }
  const bodySize = median(
    textEls
      .filter((el) => ['p', 'li', 'span', 'div'].includes(el.tagName.toLowerCase()))
      .map((el) => px(ctx.m.style(el).fontSize)),
  );

  const groups = new Map<string, TypographyStyle>();
  const familyUsage = new Map<string, FontFamilyInfo>();
  for (const el of textEls) {
    const s = ctx.m.style(el);
    const role = typographyRole(el, s, bodySize);
    const entry: TypographyStyle = {
      role,
      tag: el.tagName.toLowerCase(),
      fontFamily: s.fontFamily,
      fontSize: roundPx(s.fontSize),
      fontWeight: s.fontWeight,
      fontStyle: s.fontStyle,
      lineHeight: roundPx(s.lineHeight),
      letterSpacing: roundPx(s.letterSpacing),
      textTransform: s.textTransform,
      textAlign: s.textAlign,
      textDecoration: s.textDecorationLine || 'none',
      color: normalizeColor(s.color),
      count: 1,
      sample: redactText(cleanText(directText(el) || el.getAttribute('placeholder') || '', 48)),
    };
    const key = [
      role,
      entry.fontFamily,
      entry.fontSize,
      entry.fontWeight,
      entry.fontStyle,
      entry.lineHeight,
      entry.letterSpacing,
      entry.textTransform,
      entry.color,
    ].join('|');
    const existing = groups.get(key);
    if (existing) existing.count++;
    else groups.set(key, entry);

    const fam = primaryFamily(s.fontFamily);
    const famKey = fam.toLowerCase();
    const f = familyUsage.get(famKey);
    if (f) f.usage++;
    else familyUsage.set(famKey, { family: fam, stack: s.fontFamily, usage: 1, loaded: false });
  }

  const { faces, loaded } = collectFontFaces(ctx, new Set(familyUsage.keys()));
  for (const [k, f] of familyUsage) f.loaded = loaded.has(k);

  const styles = [...groups.values()]
    .sort((a, b) => px(b.fontSize) - px(a.fontSize) || b.count - a.count)
    .slice(0, 24);
  const byRole = (role: TypographyRole) =>
    [...groups.values()].filter((g) => g.role === role).sort((a, b) => b.count - a.count)[0];

  const headingScale = new Map<
    string,
    { tag: string; fontSize: string; fontWeight: string; lineHeight: string }
  >();
  for (const st of styles) {
    if (st.role !== 'heading') continue;
    const tag = /^h[1-6]$/.test(st.tag) ? st.tag : `${st.tag} (heading-like)`;
    if (!headingScale.has(tag))
      headingScale.set(tag, {
        tag,
        fontSize: st.fontSize,
        fontWeight: st.fontWeight,
        lineHeight: st.lineHeight,
      });
  }

  return {
    families: [...familyUsage.values()].sort((a, b) => b.usage - a.usage).slice(0, 8),
    fontFaces: faces,
    styles,
    headingScale: [...headingScale.values()].sort((a, b) => px(b.fontSize) - px(a.fontSize)),
    body: byRole('body'),
    label: byRole('label'),
    control: byRole('control'),
  };
}
