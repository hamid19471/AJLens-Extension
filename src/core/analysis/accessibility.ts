import type { AccessibilitySummary, ContrastSample, StructureSummary } from '../../shared/types';
import type { AnalysisContext } from './context';
import { accessibleName, directText } from './context';
import { contrastRatio, normalizeColor, parseColor } from '../color';
import { effectiveBackground } from './colors';
import { cleanText, redactText } from '../sanitize';
import { conciseSelector } from '../selector';
import { px } from '../styles';

const FOCUSABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex], summary, [contenteditable="true"]';

function hasBackgroundImageBehind(
  el: Element,
  getStyle: (e: Element) => CSSStyleDeclaration,
): boolean {
  let cur: Element | null = el;
  while (cur) {
    const s = getStyle(cur);
    if (s.backgroundImage && s.backgroundImage !== 'none') return true;
    const c = parseColor(s.backgroundColor);
    if (c && c.a > 0.95) return false;
    cur = cur.parentElement;
  }
  return false;
}

export function analyzeAccessibility(
  ctx: AnalysisContext,
  structure: StructureSummary,
): AccessibilitySummary {
  const issues: string[] = [];
  const ariaAttributes = new Set<string>();
  let namedControls = 0;
  let unnamedControls = 0;
  let imagesMissingAlt = 0;
  let focusableCount = 0;
  const contrast: ContrastSample[] = [];
  const contrastSeen = new Set<string>();
  const getStyle = (e: Element) => ctx.m.style(e);

  for (const el of ctx.elements) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('aria-') || attr.name === 'role')
        ariaAttributes.add(attr.name === 'role' ? `role=${attr.value}` : attr.name);
    }
    const tag = el.tagName.toLowerCase();
    if (el.matches(FOCUSABLE)) focusableCount++;
    const ti = el.getAttribute('tabindex');
    if (ti && Number(ti) > 0)
      issues.push(`${conciseSelector(el)} uses positive tabindex=${ti}; prefer DOM order.`);

    if (tag === 'img' && !el.hasAttribute('alt')) {
      imagesMissingAlt++;
    }
    const isControl =
      ['button', 'a', 'input', 'select', 'textarea'].includes(tag) ||
      el.getAttribute('role') === 'button';
    const skipControl =
      (tag === 'input' && el.getAttribute('type') === 'hidden') ||
      (tag === 'a' && !el.hasAttribute('href'));
    if (isControl && !skipControl) {
      const name = accessibleName(el);
      if (name) namedControls++;
      else {
        unnamedControls++;
        if (issues.length < 30) issues.push(`${conciseSelector(el)} has no accessible name.`);
      }
    }

    const text = directText(el);
    if (text && contrast.length < 14) {
      const s = getStyle(el);
      const key = `${s.color}|${s.fontSize}|${s.fontWeight}`;
      if (contrastSeen.has(key)) continue;
      contrastSeen.add(key);
      if (hasBackgroundImageBehind(el, getStyle)) continue;
      const fg = parseColor(s.color);
      const bgValue = effectiveBackground(el, getStyle);
      const bg = parseColor(bgValue);
      if (!fg || !bg) continue;
      const ratio = contrastRatio(fg, bg);
      const large =
        px(s.fontSize) >= 24 ||
        (px(s.fontSize) >= 18.66 && (parseInt(s.fontWeight, 10) || 400) >= 700);
      const passesAA = ratio >= (large ? 3 : 4.5);
      contrast.push({
        text: redactText(cleanText(text, 40)),
        foreground: normalizeColor(s.color),
        background: bgValue,
        ratio,
        passesAA,
      });
      if (!passesAA)
        issues.push(
          `Low contrast (${ratio}:1) for "${redactText(cleanText(text, 30))}" — keep or improve contrast in the rebuild.`,
        );
    }
  }

  if (imagesMissingAlt)
    issues.push(
      `${imagesMissingAlt} image(s) have no alt attribute; add alt text (or alt="" if decorative).`,
    );
  let last = 0;
  for (const h of structure.headings) {
    if (last && h.level > last + 1) {
      issues.push(`Heading level jumps from h${last} to h${h.level} ("${h.text.slice(0, 40)}").`);
      break;
    }
    last = h.level;
  }
  for (const c of structure.formControls) {
    if (!c.label && c.type !== 'submit' && c.type !== 'button')
      issues.push(`A ${c.type} control has no associated label.`);
  }

  return {
    landmarks: structure.landmarks,
    headingOutline: structure.headings,
    namedControls,
    unnamedControls,
    imagesMissingAlt,
    focusableCount,
    ariaAttributes: [...ariaAttributes].sort().slice(0, 40),
    contrast,
    issues: [...new Set(issues)].slice(0, 30),
  };
}
