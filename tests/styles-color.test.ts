import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  normalizeColor,
  normalizeColorsIn,
  parseColor,
  saturation,
} from '../src/core/color';
import {
  compressSides,
  isDefaultValue,
  normalizePseudo,
  normalizeStyles,
  roundPx,
} from '../src/core/styles';
import { setBody, $ } from './helpers';

function fakeStyle(values: Record<string, string>): CSSStyleDeclaration {
  return { getPropertyValue: (p: string) => values[p] ?? '' } as unknown as CSSStyleDeclaration;
}

function sides(
  prefix: string,
  t: string,
  r: string,
  b: string,
  l: string,
  suffix = '',
): Record<string, string> {
  return {
    [`${prefix}-top${suffix}`]: t,
    [`${prefix}-right${suffix}`]: r,
    [`${prefix}-bottom${suffix}`]: b,
    [`${prefix}-left${suffix}`]: l,
  };
}

describe('color normalization', () => {
  it('normalizes rgb/rgba/hex to lowercase hex', () => {
    expect(normalizeColor('rgb(255, 0, 0)')).toBe('#ff0000');
    expect(normalizeColor('rgba(13, 19, 18, 1)')).toBe('#0d1312');
    expect(normalizeColor('#ABC')).toBe('#aabbcc');
    expect(normalizeColor('#0d131280')).toBe('rgba(13, 19, 18, 0.5)');
  });

  it('keeps translucency and transparent', () => {
    expect(normalizeColor('rgba(0, 0, 0, 0.25)')).toBe('rgba(0, 0, 0, 0.25)');
    expect(normalizeColor('rgba(0, 0, 0, 0)')).toBe('transparent');
    expect(normalizeColor('transparent')).toBe('transparent');
  });

  it('supports space-separated syntax and percent alpha', () => {
    expect(parseColor('rgb(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
  });

  it('passes through modern color spaces untouched', () => {
    expect(normalizeColor('oklch(0.7 0.1 140)')).toBe('oklch(0.7 0.1 140)');
  });

  it('normalizes colors inside compound values', () => {
    expect(normalizeColorsIn('0px 1px 2px rgba(0, 0, 0, 0.06), 0 0 0 1px rgb(229, 231, 235)')).toBe(
      '0px 1px 2px rgba(0, 0, 0, 0.06), 0 0 0 1px #e5e7eb',
    );
  });

  it('computes WCAG contrast', () => {
    expect(contrastRatio(parseColor('#000')!, parseColor('#fff')!)).toBe(21);
    expect(contrastRatio(parseColor('#777')!, parseColor('#fff')!)).toBeCloseTo(4.48, 1);
  });

  it('detects saturation', () => {
    expect(saturation(parseColor('#9ed963')!)).toBeGreaterThan(0.5);
    expect(saturation(parseColor('#888888')!)).toBe(0);
  });
});

describe('style normalization', () => {
  it('compresses box sides', () => {
    expect(compressSides('8px', '8px', '8px', '8px')).toBe('8px');
    expect(compressSides('8px', '16px', '8px', '16px')).toBe('8px 16px');
    expect(compressSides('8px', '16px', '4px', '16px')).toBe('8px 16px 4px');
    expect(compressSides('1px', '2px', '3px', '4px')).toBe('1px 2px 3px 4px');
  });

  it('recognizes browser defaults', () => {
    expect(isDefaultValue('position', 'static')).toBe(true);
    expect(isDefaultValue('opacity', '1')).toBe(true);
    expect(isDefaultValue('position', 'sticky')).toBe(false);
  });

  it('rounds long px fractions', () => {
    expect(roundPx('320.234375px 12.5px')).toBe('320.23px 12.5px');
  });

  it('removes defaults, inherited duplicates and compresses shorthands', () => {
    // Computed styles as Chrome reports them (jsdom does not compute gap/border longhands).
    const parent = fakeStyle({ display: 'grid', color: 'rgb(31, 35, 40)', 'font-size': '16px' });
    const child = fakeStyle({
      display: 'flex',
      'flex-direction': 'column',
      'row-gap': '12px',
      'column-gap': '12px',
      ...sides('padding', '8px', '16px', '8px', '16px'),
      ...sides('margin', '0px', '0px', '0px', '0px'),
      ...sides('border', '1px', '1px', '1px', '1px', '-width'),
      ...sides('border', 'solid', 'solid', 'solid', 'solid', '-style'),
      ...sides(
        'border',
        'rgb(229, 231, 235)',
        'rgb(229, 231, 235)',
        'rgb(229, 231, 235)',
        'rgb(229, 231, 235)',
        '-color',
      ),
      'border-top-left-radius': '12px',
      'border-top-right-radius': '12px',
      'border-bottom-right-radius': '12px',
      'border-bottom-left-radius': '12px',
      color: 'rgb(31, 35, 40)',
      'font-size': '14px',
      'background-color': 'rgb(255, 255, 255)',
      'box-shadow': 'rgba(0, 0, 0, 0.06) 0px 1px 2px 0px',
      position: 'static',
      opacity: '1',
    });
    const out = normalizeStyles(child, { parent });
    expect(out.display).toBe('flex');
    expect(out['flex-direction']).toBe('column');
    expect(out.gap).toBe('12px');
    expect(out.padding).toBe('8px 16px');
    expect(out.margin).toBeUndefined();
    expect(out.border).toBe('1px solid #e5e7eb');
    expect(out['border-radius']).toBe('12px');
    expect(out['background-color']).toBe('#ffffff');
    expect(out['box-shadow']).toBe('rgba(0, 0, 0, 0.06) 0px 1px 2px 0px');
    expect(out.position).toBeUndefined();
    expect(out.opacity).toBeUndefined();
    expect(out.color).toBeUndefined(); // inherited duplicate
    expect(out['font-size']).toBe('14px');
  });

  it('reads real computed styles from the DOM', () => {
    setBody(
      '<div id="p"><div id="c" style="display:flex; padding: 4px; border-radius: 6px"></div></div>',
    );
    const out = normalizeStyles(getComputedStyle($('#c')), { parent: getComputedStyle($('#p')) });
    expect(out.display).toBe('flex');
    expect(out.padding).toBe('4px');
  });

  it('only reports flex item properties inside flex containers', () => {
    setBody(
      '<div id="p" style="display:block"><div id="c" style="flex-grow: 1; order: 2"></div></div>',
    );
    const out = normalizeStyles(getComputedStyle($('#c')), { parent: getComputedStyle($('#p')) });
    expect(out['flex-grow']).toBeUndefined();
    expect(out.order).toBeUndefined();
  });

  it('ignores pseudo elements without content', () => {
    setBody('<div id="c"></div>');
    expect(normalizePseudo(getComputedStyle($('#c'), '::before'))).toBeNull();
  });
});
