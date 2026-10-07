import { beforeEach, describe, expect, it } from 'vitest';
import { isIgnorable, isMeaningful, isRegionCandidate } from '../src/core/filters';
import {
  StableCandidate,
  meaningfulChildren,
  pickHoverCandidate,
  selectChild,
  selectParent,
} from '../src/core/selection';
import { $, setBody, testMeasurer } from './helpers';

const m = testMeasurer();

describe('element filtering', () => {
  beforeEach(() => {
    setBody(`
      <script>var x = 1;</script>
      <style>.a{}</style>
      <noscript>no</noscript>
      <div id="hidden" style="display:none" data-rect="0,0,400,400">hidden</div>
      <div id="invisible" style="visibility:hidden" data-rect="0,0,400,400">invisible</div>
      <div id="transparent" style="opacity:0" data-rect="0,0,400,400">transparent</div>
      <div id="tiny" data-rect="0,0,10,10">t</div>
      <span id="icon" data-rect="0,0,16,16"></span>
      <section id="real" data-rect="0,0,600,300"><h2>Title</h2><p>Body</p></section>
      <aj-lens-root id="ext" data-rect="0,0,300,300"></aj-lens-root>`);
  });

  it('ignores scripts, styles, noscript and extension UI', () => {
    expect(isIgnorable($('script'), m)).toBe(true);
    expect(isIgnorable($('style'), m)).toBe(true);
    expect(isIgnorable($('noscript'), m)).toBe(true);
    expect(isIgnorable($('#ext'), m)).toBe(true);
  });

  it('ignores hidden elements', () => {
    expect(isIgnorable($('#hidden'), m)).toBe(true);
    expect(isIgnorable($('#invisible'), m)).toBe(true);
    expect(isIgnorable($('#transparent'), m)).toBe(true);
  });

  it('treats tiny elements as insignificant', () => {
    expect(isMeaningful($('#tiny'), m)).toBe(false);
    expect(isMeaningful($('#icon'), m)).toBe(false);
  });

  it('accepts semantic visible regions', () => {
    expect(isMeaningful($('#real'), m)).toBe(true);
    expect(isRegionCandidate($('#real'), m)).toBe(true);
  });
});

describe('hover candidate, parent and child selection', () => {
  beforeEach(() => {
    setBody(`
      <main id="main" data-rect="0,0,1200,2000">
        <div id="wrap1" data-rect="0,100,1200,600">
          <div id="wrap2" data-rect="0,100,1200,600">
            <section id="pricing" class="pricing" data-rect="0,100,1200,600" style="display:flex">
              <div id="plan-a" class="card" data-rect="40,140,340,500">
                <h3 id="plan-a-title" data-rect="60,160,300,30">Starter</h3>
                <p data-rect="60,200,300,60">Free</p>
                <a id="plan-a-cta" class="btn" href="#" data-rect="60,560,120,40"><span id="cta-label" data-rect="70,570,80,20">Go</span></a>
              </div>
              <div id="plan-b" class="card" data-rect="420,140,340,500"><h3 data-rect="440,160,300,30">Pro</h3><p data-rect="440,200,300,60">$29</p></div>
              <div id="plan-c" class="card" data-rect="800,140,340,500"><h3 data-rect="820,160,300,30">Team</h3><p data-rect="820,200,300,60">$99</p></div>
            </section>
          </div>
        </div>
      </main>`);
  });

  it('chooses a meaningful region instead of the deepest element', () => {
    expect(pickHoverCandidate($('#cta-label'), m)?.id).toBe('plan-a');
  });

  it('collapses same-size wrappers toward the semantic element', () => {
    const picked = pickHoverCandidate($('#pricing'), m);
    expect(picked?.id).toBe('pricing');
  });

  it('never selects extension UI', () => {
    const ext = document.createElement('aj-lens-root');
    document.body.append(ext);
    expect(pickHoverCandidate(ext, m)).toBeNull();
  });

  it('parent skips wrappers with identical bounds', () => {
    expect(selectParent($('#plan-a'), m)?.id).toBe('pricing');
    expect(selectParent($('#pricing'), m)?.id).toBe('main');
  });

  it('parent of the top-level region stops at body', () => {
    expect(selectParent($('#main'), m)?.tagName.toLowerCase()).not.toBe('html');
  });

  it('collects meaningful children through wrappers', () => {
    expect(meaningfulChildren($('#main'), m).map((k) => k.id)).toEqual(['pricing']);
    expect(meaningfulChildren($('#pricing'), m).map((k) => k.id)).toEqual([
      'plan-a',
      'plan-b',
      'plan-c',
    ]);
  });

  it('child selection prefers the child under the pointer', () => {
    expect(selectChild($('#pricing'), m, { x: 500, y: 300 })?.id).toBe('plan-b');
    expect(selectChild($('#pricing'), m, { x: 900, y: 300 })?.id).toBe('plan-c');
  });

  it('child selection without pointer prefers the largest semantic child', () => {
    const child = selectChild($('#plan-a'), m, null);
    expect(child?.id).toBe('plan-a-title');
  });

  it('returns null when there is no meaningful child', () => {
    expect(selectChild($('#cta-label'), m)).toBeNull();
  });
});

describe('StableCandidate hysteresis', () => {
  it('commits immediately when nothing is selected', () => {
    setBody('<div id="a"><div id="b"></div></div><div id="c"></div>');
    const s = new StableCandidate(100, 40);
    expect(s.update($('#a'), 0).current?.id).toBe('a');
  });

  it('delays nested changes longer than sibling changes', () => {
    setBody('<div id="a"><div id="b"></div></div><div id="c"></div>');
    const s = new StableCandidate(100, 40);
    s.update($('#a'), 0);
    const nested = s.update($('#b'), 10);
    expect(nested.current?.id).toBe('a');
    expect(nested.retryIn).toBe(100);
    expect(s.update($('#b'), 60).current?.id).toBe('a');
    expect(s.update($('#b'), 111).current?.id).toBe('b');
    const sib = s.update($('#c'), 200);
    expect(sib.retryIn).toBe(40);
    expect(s.update($('#c'), 241).current?.id).toBe('c');
  });

  it('cancels a pending change when the pointer returns', () => {
    setBody('<div id="a"><div id="b"></div></div>');
    const s = new StableCandidate(100, 40);
    s.update($('#a'), 0);
    s.update($('#b'), 10);
    expect(s.update($('#a'), 20).retryIn).toBeUndefined();
    expect(s.update($('#b'), 30).retryIn).toBe(100);
  });
});

describe('text blocks are not default regions', () => {
  it('hovering a wide heading selects its section', () => {
    setBody(`
      <section id="features" data-rect="0,0,1000,600">
        <h2 id="features-title" data-rect="0,0,1000,40">Everything you need</h2>
        <div class="grid" style="display:grid" data-rect="0,60,1000,500"><div class="card" data-rect="0,60,300,500">A</div><div class="card" data-rect="340,60,300,500">B</div></div>
      </section>`);
    expect(pickHoverCandidate($('#features-title'), m)?.id).toBe('features');
    expect(isMeaningful($('#features-title'), m)).toBe(true);
  });
});
