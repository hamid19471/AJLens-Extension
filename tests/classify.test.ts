import { describe, expect, it } from 'vitest';
import { analyzeSection } from '../src/core/analysis';
import { $, loadFixture, setBody, testMeasurer } from './helpers';

async function classify(selector: string) {
  const a = await analyzeSection($(selector), { measurer: testMeasurer() });
  return a.classification;
}

describe('local section classification', () => {
  it('classifies the landing fixture sections', async () => {
    loadFixture('landing.html');
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    expect((await classify('#primary-nav')).primary).toBe('navigation');
    expect((await classify('#hero')).primary).toBe('hero');
    expect((await classify('#features')).primary).toBe('feature grid');
    expect((await classify('#pricing')).primary).toBe('pricing');
    expect((await classify('#signup')).primary).toBe('authentication');
    expect((await classify('#footer')).primary).toBe('footer');
  });

  it('returns evidence and confidence', async () => {
    loadFixture('landing.html');
    const c = await classify('#pricing');
    expect(c.confidence).toBeGreaterThan(0.5);
    expect(c.confidence).toBeLessThanOrEqual(0.95);
    expect(c.evidence.length).toBeGreaterThan(0);
    expect(c.evidence.join(' ')).toMatch(/price/i);
  });

  it('detects FAQ, tables and testimonials', async () => {
    setBody(`
      <section id="faq"><h2>FAQ</h2>
        <details><summary>Can I cancel?</summary><p>Yes.</p></details>
        <details><summary>Is there a trial?</summary><p>Yes.</p></details>
        <details><summary>Do you offer refunds?</summary><p>Yes.</p></details>
      </section>
      <section id="data"><table><tr><th>Plan</th><th>Seats</th></tr><tr><td>Pro</td><td>10</td></tr></table></section>
      <section id="quotes" class="testimonials">
        <figure><blockquote>Great product.</blockquote><img src="/a.jpg" alt="Ann" class="avatar" width="40" height="40"></figure>
        <figure><blockquote>Love it.</blockquote><img src="/b.jpg" alt="Bo" class="avatar" width="40" height="40"></figure>
      </section>`);
    expect((await classify('#faq')).primary).toBe('FAQ');
    expect((await classify('#data')).primary).toBe('table');
    expect((await classify('#quotes')).primary).toBe('testimonials');
  });

  it('marks weak signals as unknown and inferred', async () => {
    setBody('<div id="plain"><div>Lorem</div></div>');
    const c = await classify('#plain');
    expect(c.primary).toBe('unknown');
    expect(c.inferred).toBe(true);
  });
});
