import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildStableSelector,
  conciseSelector,
  isMeaningfulClass,
  isStableId,
  structuralSignature,
} from '../src/core/selector';
import { $, setBody } from './helpers';

describe('selector creation', () => {
  beforeEach(() => {
    setBody(`
      <main>
        <section class="min-w-0 css-1a2b3c sc-AxjAm"><p>One</p></section>
        <section class="min-w-0"><p>Two</p></section>
        <div id="pricing"><div class="card">A</div><div class="card">B</div></div>
        <div id=":r1:"><span class="jsx-123456">x</span></div>
      </main>`);
  });

  it('filters hashed CSS-in-JS classes', () => {
    expect(isMeaningfulClass('min-w-0')).toBe(true);
    expect(isMeaningfulClass('btnPrimary')).toBe(true);
    expect(isMeaningfulClass('css-1a2b3c')).toBe(false);
    expect(isMeaningfulClass('sc-AxjAm')).toBe(false);
    expect(isMeaningfulClass('jsx-123456')).toBe(false);
    expect(isMeaningfulClass('Card_root__x7Yz2')).toBe(false);
  });

  it('rejects generated ids', () => {
    expect(isStableId('pricing')).toBe(true);
    expect(isStableId(':r1:')).toBe(false);
    expect(isStableId('radix-12')).toBe(false);
    expect(isStableId('a1b2c3d4e5f6')).toBe(false);
  });

  it('builds concise display selectors', () => {
    expect(conciseSelector($('section'))).toBe('section.min-w-0');
    expect(conciseSelector($('#pricing'))).toBe('div#pricing');
    expect(conciseSelector($('span'))).toBe('span');
  });

  it('builds unique stable selectors', () => {
    const second = document.querySelectorAll('section')[1];
    const sel = buildStableSelector(second);
    expect(document.querySelectorAll(sel)).toHaveLength(1);
    expect(document.querySelector(sel)).toBe(second);
    expect(buildStableSelector($('#pricing'))).toBe('#pricing');
    const card = document.querySelectorAll('.card')[1];
    const cardSel = buildStableSelector(card);
    expect(cardSel).toContain(':nth-of-type(2)');
    expect(document.querySelector(cardSel)).toBe(card);
  });

  it('produces matching signatures for structurally identical siblings', () => {
    const [a, b] = Array.from(document.querySelectorAll('.card'));
    expect(structuralSignature(a)).toBe(structuralSignature(b));
    expect(structuralSignature(a)).not.toBe(structuralSignature($('section')));
  });
});
