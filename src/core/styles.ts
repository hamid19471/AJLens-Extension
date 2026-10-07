import type { StyleMap } from '../shared/types';
import { normalizeColor, normalizeColorsIn } from './color';

/** Reconstruction-relevant properties, grouped. Everything else is ignored. */
export const LAYOUT_PROPS = [
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
  'box-sizing',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'overflow-x',
  'overflow-y',
  'flex-direction',
  'flex-wrap',
  'justify-content',
  'align-items',
  'align-content',
  'align-self',
  'justify-self',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'order',
  'grid-template-columns',
  'grid-template-rows',
  'grid-template-areas',
  'grid-auto-flow',
  'grid-auto-columns',
  'grid-auto-rows',
  'grid-column',
  'grid-row',
  'row-gap',
  'column-gap',
  'aspect-ratio',
  'object-fit',
  'object-position',
] as const;

export const BOX_PROPS = [
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'outline-style',
  'outline-width',
  'outline-color',
] as const;

export const VISUAL_PROPS = [
  'background-color',
  'background-image',
  'background-size',
  'background-position',
  'background-repeat',
  'box-shadow',
  'opacity',
  'transform',
  'filter',
  'backdrop-filter',
  'mix-blend-mode',
  'visibility',
  'transition',
  'cursor',
] as const;

export const TEXT_PROPS = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-transform',
  'text-align',
  'text-decoration-line',
  'text-shadow',
  'white-space',
  'color',
] as const;

/** Inherited properties are dropped when equal to the parent's computed value. */
export const INHERITED = new Set<string>([
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-transform',
  'text-align',
  'white-space',
  'color',
  'visibility',
  'cursor',
  'text-shadow',
]);

/** Values considered browser defaults (or meaningless) and therefore omitted. */
const DEFAULTS: Record<string, string[]> = {
  position: ['static'],
  top: ['auto'],
  right: ['auto'],
  bottom: ['auto'],
  left: ['auto'],
  'z-index': ['auto'],
  'box-sizing': ['content-box'],
  'min-width': ['auto', '0px'],
  'min-height': ['auto', '0px'],
  'max-width': ['none'],
  'max-height': ['none'],
  'overflow-x': ['visible'],
  'overflow-y': ['visible'],
  'flex-direction': ['row'],
  'flex-wrap': ['nowrap'],
  'justify-content': ['normal', 'flex-start', 'start'],
  'align-items': ['normal', 'stretch'],
  'align-content': ['normal'],
  'align-self': ['auto'],
  'justify-self': ['auto'],
  'flex-grow': ['0'],
  'flex-shrink': ['1'],
  'flex-basis': ['auto'],
  order: ['0'],
  'grid-template-columns': ['none'],
  'grid-template-rows': ['none'],
  'grid-template-areas': ['none'],
  'grid-auto-flow': ['row'],
  'grid-auto-columns': ['auto'],
  'grid-auto-rows': ['auto'],
  'grid-column': ['auto', 'auto / auto'],
  'grid-row': ['auto', 'auto / auto'],
  'row-gap': ['normal', '0px'],
  'column-gap': ['normal', '0px'],
  'aspect-ratio': ['auto'],
  'object-fit': ['fill'],
  'object-position': ['50% 50%'],
  'background-color': ['transparent', 'rgba(0, 0, 0, 0)'],
  'background-image': ['none'],
  'background-size': ['auto', 'auto auto'],
  'background-position': ['0% 0%'],
  'background-repeat': ['repeat'],
  'box-shadow': ['none'],
  opacity: ['1'],
  transform: ['none'],
  filter: ['none'],
  'backdrop-filter': ['none'],
  'mix-blend-mode': ['normal'],
  visibility: ['visible'],
  transition: ['all 0s ease 0s', 'all', 'none 0s ease 0s', 'all 0s'],
  cursor: ['auto'],
  'font-style': ['normal'],
  'letter-spacing': ['normal'],
  'text-transform': ['none'],
  'text-align': ['start'],
  'text-decoration-line': ['none'],
  'text-shadow': ['none'],
  'white-space': ['normal'],
  'outline-style': ['none'],
};

const FLEX_ITEM_PROPS = new Set(['flex-grow', 'flex-shrink', 'flex-basis', 'align-self', 'order']);
const GRID_ITEM_PROPS = new Set(['grid-column', 'grid-row', 'justify-self', 'align-self', 'order']);
const CONTAINER_FLEX = new Set([
  'flex-direction',
  'flex-wrap',
  'justify-content',
  'align-items',
  'align-content',
]);
const CONTAINER_GRID = new Set([
  'grid-template-columns',
  'grid-template-rows',
  'grid-template-areas',
  'grid-auto-flow',
  'grid-auto-columns',
  'grid-auto-rows',
  'justify-content',
  'align-items',
  'align-content',
]);

export function isDefaultValue(prop: string, value: string): boolean {
  const v = value.trim();
  if (v === '') return true;
  return DEFAULTS[prop]?.includes(v) ?? false;
}

/** Rounds px numbers inside a value to at most 2 decimals. */
export function roundPx(value: string): string {
  return value.replace(
    /(-?\d+\.\d{3,})px/g,
    (_, n: string) => `${Math.round(parseFloat(n) * 100) / 100}px`,
  );
}

/** Collapses four side values into CSS shorthand order (t r b l). */
export function compressSides(t: string, r: string, b: string, l: string): string {
  if (t === r && r === b && b === l) return t;
  if (t === b && r === l) return `${t} ${r}`;
  if (r === l) return `${t} ${r} ${b}`;
  return `${t} ${r} ${b} ${l}`;
}

function isZero(v: string): boolean {
  return v === '0px' || v === '0' || v === '';
}

export interface NormalizeOptions {
  parent?: CSSStyleDeclaration | null;
  includeText?: boolean;
  includeTransition?: boolean;
  /** Lowercase tag name; enables replaced-element properties such as object-fit. */
  tag?: string;
}

const REPLACED = new Set(['img', 'video', 'canvas', 'iframe', 'embed', 'object']);

/**
 * Converts a computed style into a compact, reconstruction-relevant map:
 * defaults removed, inherited duplicates removed, sides compressed, colors normalized.
 */
export function normalizeStyles(style: CSSStyleDeclaration, opts: NormalizeOptions = {}): StyleMap {
  const out: StyleMap = {};
  const get = (p: string) => roundPx(style.getPropertyValue(p).trim());
  const display = get('display');
  const parentDisplay = opts.parent?.getPropertyValue('display') ?? '';
  const isFlex = display.includes('flex');
  const isGrid = display.includes('grid');
  const inFlex = parentDisplay.includes('flex');
  const inGrid = parentDisplay.includes('grid');

  for (const prop of LAYOUT_PROPS) {
    if (FLEX_ITEM_PROPS.has(prop) && !inFlex && !(GRID_ITEM_PROPS.has(prop) && inGrid)) continue;
    if (GRID_ITEM_PROPS.has(prop) && !inGrid && !(FLEX_ITEM_PROPS.has(prop) && inFlex)) continue;
    if (CONTAINER_FLEX.has(prop) && !isFlex && !(CONTAINER_GRID.has(prop) && isGrid)) continue;
    if (CONTAINER_GRID.has(prop) && !isGrid && !(CONTAINER_FLEX.has(prop) && isFlex)) continue;
    if (
      (prop === 'top' ||
        prop === 'right' ||
        prop === 'bottom' ||
        prop === 'left' ||
        prop === 'z-index') &&
      get('position') === 'static'
    ) {
      continue;
    }
    if ((prop === 'object-fit' || prop === 'object-position') && !REPLACED.has(opts.tag ?? ''))
      continue;
    const v = get(prop);
    if (!isDefaultValue(prop, v)) out[prop] = v;
  }
  if (out['row-gap'] && out['row-gap'] === out['column-gap']) {
    out.gap = out['row-gap'];
    delete out['row-gap'];
    delete out['column-gap'];
  }
  if (out['overflow-x'] && out['overflow-x'] === out['overflow-y']) {
    out.overflow = out['overflow-x'];
    delete out['overflow-x'];
    delete out['overflow-y'];
  }

  const sides = ['top', 'right', 'bottom', 'left'] as const;
  for (const box of ['margin', 'padding'] as const) {
    const vals = sides.map((s) => get(`${box}-${s}`));
    if (!vals.every(isZero)) out[box] = compressSides(vals[0], vals[1], vals[2], vals[3]);
  }
  const widths = sides.map((s) => get(`border-${s}-width`));
  const styles = sides.map((s) => get(`border-${s}-style`));
  const colors = sides.map((s) => normalizeColor(get(`border-${s}-color`)));
  const present = sides.map(
    (_, i) => !isZero(widths[i]) && styles[i] !== 'none' && styles[i] !== 'hidden',
  );
  if (
    present.every(Boolean) &&
    new Set(widths).size === 1 &&
    new Set(styles).size === 1 &&
    new Set(colors).size === 1
  ) {
    out.border = `${widths[0]} ${styles[0]} ${colors[0]}`;
  } else {
    sides.forEach((s, i) => {
      if (present[i]) out[`border-${s}`] = `${widths[i]} ${styles[i]} ${colors[i]}`;
    });
  }
  const radii = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((c) =>
    get(`border-${c}-radius`),
  );
  if (!radii.every(isZero))
    out['border-radius'] = compressSides(radii[0], radii[1], radii[2], radii[3]);
  if (get('outline-style') !== 'none' && !isZero(get('outline-width'))) {
    out.outline = `${get('outline-width')} ${get('outline-style')} ${normalizeColor(get('outline-color'))}`;
  }

  for (const prop of VISUAL_PROPS) {
    if (prop === 'transition' && !opts.includeTransition) continue;
    const v = get(prop);
    if (isDefaultValue(prop, v)) continue;
    if (INHERITED.has(prop) && opts.parent && opts.parent.getPropertyValue(prop).trim() === v)
      continue;
    if (prop === 'background-color') {
      const c = normalizeColor(v);
      if (c !== 'transparent') out[prop] = c;
      continue;
    }
    if (
      (prop === 'background-size' ||
        prop === 'background-position' ||
        prop === 'background-repeat') &&
      get('background-image') === 'none'
    ) {
      continue;
    }
    out[prop] = normalizeColorsIn(v);
  }

  if (opts.includeText !== false) {
    for (const prop of TEXT_PROPS) {
      const v = get(prop);
      if (isDefaultValue(prop, v)) continue;
      if (
        INHERITED.has(prop) &&
        opts.parent &&
        roundPx(opts.parent.getPropertyValue(prop).trim()) === v
      )
        continue;
      out[prop] = prop === 'color' || prop === 'text-shadow' ? normalizeColorsIn(v) : v;
    }
  }
  return out;
}

/** Visible ::before/::after decoration, or null when the pseudo element is not rendered. */
export function normalizePseudo(style: CSSStyleDeclaration): StyleMap | null {
  const content = style.getPropertyValue('content').trim();
  if (!content || content === 'none' || content === 'normal') return null;
  if (style.getPropertyValue('display') === 'none') return null;
  const out: StyleMap = { content: content.length > 60 ? `${content.slice(0, 60)}…` : content };
  const keys = [
    'display',
    'position',
    'top',
    'right',
    'bottom',
    'left',
    'width',
    'height',
    'background-color',
    'background-image',
    'border-top-left-radius',
    'box-shadow',
    'opacity',
    'transform',
    'color',
    'font-size',
  ];
  for (const k of keys) {
    const v = roundPx(style.getPropertyValue(k).trim());
    if (
      !v ||
      isDefaultValue(k, v) ||
      (k === 'width' && v === 'auto') ||
      (k === 'height' && v === 'auto')
    )
      continue;
    if (k === 'border-top-left-radius' && isZero(v)) continue;
    out[k === 'border-top-left-radius' ? 'border-radius' : k] = normalizeColorsIn(v);
  }
  const visual =
    (out['background-color'] && out['background-color'] !== 'transparent') ||
    out['background-image'] ||
    out['box-shadow'] ||
    (content !== '""' && content !== "''");
  return visual ? out : null;
}

export function px(value: string | undefined | null): number {
  if (!value) return 0;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}
