import { beforeAll, describe, expect, it } from 'vitest';
import { createContext } from '../src/core/analysis/context';
import {
  analyzeStructure,
  detectRepeatedPatterns,
  groupRepeatedSiblings,
  linkIntent,
} from '../src/core/analysis/dom';
import {
  analyzeAssets,
  extractCssUrls,
  parseSrcset,
  quickAssetCount,
} from '../src/core/analysis/assets';
import { analyzeInteractions } from '../src/core/analysis/interactions';
import { analyzeSection } from '../src/core/analysis';
import { breakpointsFrom } from '../src/core/analysis/responsive';
import { countClusters, detectArrangement } from '../src/core/analysis/layout';
import { $, loadFixture, testMeasurer } from './helpers';

const m = testMeasurer();

describe('repeated-pattern detection', () => {
  beforeAll(() => loadFixture('landing.html'));

  it('groups consecutive identical siblings', () => {
    const groups = groupRepeatedSiblings(Array.from($('.feature-grid').children));
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(3);
  });

  it('finds repeated cards and plans', () => {
    const features = detectRepeatedPatterns(createContext($('#features'), m));
    expect(features[0]).toMatchObject({ count: 3 });
    expect(features[0].selector).toContain('article.card.feature');
    const pricing = detectRepeatedPatterns(createContext($('#pricing'), m));
    const plans = pricing.find((p) => p.selector.includes('div.plan'));
    expect(plans?.count).toBe(3);
    expect(plans?.sampleText[0]).toContain('Starter');
  });

  it('collapses repeated nodes in the structure tree', () => {
    const s = analyzeStructure(createContext($('#features'), m));
    const grid = s.root.children.find((c) => c.selector === 'div.feature-grid');
    expect(grid?.children).toHaveLength(1);
    expect(grid?.children[0].repeat).toBe(3);
  });
});

describe('structure analysis and privacy', () => {
  beforeAll(() => loadFixture('landing.html'));

  it('collects headings, links and buttons', () => {
    const s = analyzeStructure(createContext($('#pricing'), m));
    expect(s.headings.map((h) => h.text)).toEqual(['Pricing', 'Starter', 'Pro', 'Team']);
    expect(s.links).toHaveLength(3);
    expect(s.links[0].intent).toBe('internal');
    expect(s.visibleText).toContain('$29/mo');
  });

  it('never collects password or hidden input values', () => {
    const ctx = createContext($('#signup'), m);
    const s = analyzeStructure(ctx);
    const json = JSON.stringify(s);
    expect(json).not.toContain('hunter2-secret');
    expect(json).not.toContain('tok_9f8e7d6c5b4a3210fedcba');
    expect(s.formControls.map((c) => c.type)).toEqual(['email', 'password']);
    expect(s.formControls[0].label).toBe('Email');
    expect(s.formControls[0].placeholder).toBe('[email]');
  });

  it('redacts mailto links and emails in text', () => {
    const s = analyzeStructure(createContext($('#footer'), m));
    const json = JSON.stringify(s);
    expect(json).not.toContain('hello@acme.test');
    expect(s.links.find((l) => l.intent === 'mailto')?.href).toBe('mailto:[redacted]');
  });

  it('classifies link intent', () => {
    expect(linkIntent('#top', 'https://a.com')).toBe('anchor');
    expect(linkIntent('/x', 'https://a.com')).toBe('internal');
    expect(linkIntent('https://b.com', 'https://a.com')).toBe('external');
    expect(linkIntent('tel:1', 'https://a.com')).toBe('tel');
  });
});

describe('asset extraction', () => {
  beforeAll(() => loadFixture('landing.html'));

  it('extracts img, picture sources and srcset', () => {
    const assets = analyzeAssets(createContext($('#hero'), m));
    const img = assets.find((a) => a.kind === 'picture');
    expect(img).toBeDefined();
    expect(img?.alt).toBe('Dashboard screenshot');
    expect(img?.srcset?.some((s) => s.includes('hero@2x.png 2x'))).toBe(true);
    expect(img?.srcset?.some((s) => s.includes('image/avif'))).toBe(true);
  });

  it('detects inline and icon SVGs', () => {
    const assets = analyzeAssets(createContext($('#features'), m));
    expect(assets.filter((a) => a.kind === 'inline-svg' || a.kind === 'icon-svg')).toHaveLength(3);
    expect(assets[0].svgSummary?.viewBox).toBe('0 0 24 24');
    expect(assets[0].inline).toBe(true);
  });

  it('extracts CSS background images with sanitized URLs and redacted data URLs', () => {
    const banner = analyzeAssets(createContext($('.banner'), m));
    expect(banner[0].kind).toBe('background-image');
    expect(banner[0].src).toContain('cdn.example.com/img/banner.jpg');
    expect(banner[0].src).toContain('token=[redacted]');
    const pattern = analyzeAssets(createContext($('.pattern'), m));
    expect(pattern[0].inline).toBe(true);
    expect(pattern[0].dataUrl?.mime).toBe('image/png');
    expect(pattern[0].src).not.toContain('iVBORw0KGgo');
  });

  it('parses url() and srcset helpers', () => {
    expect(extractCssUrls('url("a.png"), linear-gradient(red, blue), url(b.jpg)')).toEqual([
      'a.png',
      'b.jpg',
    ]);
    expect(parseSrcset('a.png 1x, b.png 2x')).toEqual(['a.png 1x', 'b.png 2x']);
  });

  it('counts assets cheaply during hover', () => {
    expect(quickAssetCount($('#features'))).toBe(3);
    expect(quickAssetCount($('#hero'))).toBe(1);
  });
});

describe('interactions', () => {
  beforeAll(() => loadFixture('landing.html'));

  it('captures controls and ARIA state', () => {
    const items = analyzeInteractions(createContext($('#primary-nav'), m));
    const menu = items.find((i) => i.text === 'Menu');
    expect(menu?.kind).toBe('dropdown');
    expect(menu?.states['aria-expanded']).toBe('false');
    expect(items.filter((i) => i.kind === 'link').length).toBeGreaterThanOrEqual(4);
    expect(items.some((i) => i.href?.includes('utm_source'))).toBe(false);
  });
});

describe('layout helpers', () => {
  it('clusters positions and detects arrangements', () => {
    expect(countClusters([0, 2, 300, 301, 600])).toBe(3);
    const row = detectArrangement([
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 120, y: 0, width: 100, height: 100 },
      { x: 240, y: 2, width: 100, height: 100 },
    ]);
    expect(row).toEqual({ arrangement: 'row', rows: 1, columns: 3 });
    const grid = detectArrangement([
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 120, y: 0, width: 100, height: 100 },
      { x: 0, y: 120, width: 100, height: 100 },
      { x: 120, y: 120, width: 100, height: 100 },
    ]);
    expect(grid.arrangement).toBe('grid');
    expect(detectArrangement([]).arrangement).toBe('empty');
  });

  it('extracts breakpoints from media queries', () => {
    expect(
      breakpointsFrom(['(max-width: 768px)', '(min-width: 64em)', '(width >= 1200px)']),
    ).toEqual([768, 1024, 1200]);
  });
});

describe('full analysis pipeline', () => {
  beforeAll(() => loadFixture('landing.html'));

  it('produces a versioned, JSON-serializable analysis with progress stages', async () => {
    const stages: string[] = [];
    const a = await analyzeSection($('#pricing'), {
      measurer: m,
      onStage: (s) => stages.push(s),
      now: () => new Date('2026-10-07T10:00:00Z'),
    });
    expect(a.schemaVersion).toBe('1.0');
    expect(stages).toEqual([
      'measuring',
      'layout',
      'typography',
      'assets',
      'responsive',
      'capturing',
      'classifying',
      'prompt',
    ]);
    expect(a.metadata.capturedAt).toBe('2026-10-07T10:00:00.000Z');
    expect(a.selection.selector).toBe('#pricing');
    expect(a.classification.primary).toBe('pricing');
    expect(a.reference.status).toBe('skipped');
    expect(() => JSON.parse(JSON.stringify(a))).not.toThrow();
    expect(a.responsive.discovered.mediaQueries.some((q) => q.query.includes('768px'))).toBe(true);
    expect(
      a.colors.customProperties.some((p) => p.name === '--radius-card' || p.name === '--brand'),
    ).toBe(true);
  });

  it('records capture failures as warnings instead of throwing', async () => {
    const a = await analyzeSection($('#hero'), {
      measurer: m,
      capture: async () => {
        throw new Error('Screenshot permission expired.');
      },
    });
    expect(a.reference.status).toBe('failed');
    expect(a.warnings.some((w) => w.includes('Screenshot permission expired'))).toBe(true);
  });

  it('caps oversized selections and warns', async () => {
    const a = await analyzeSection(document.body, {
      measurer: m,
      limits: { maxDepth: 3, maxNodes: 20, maxStyleSamples: 20, maxRules: 100 },
    });
    expect(a.structure.truncated).toBe(true);
    expect(a.structure.analyzedElementCount).toBeLessThanOrEqual(20);
    expect(a.warnings[0]).toMatch(/Oversized selection/);
  });

  it('aborts between stages', async () => {
    const ac = new AbortController();
    const p = analyzeSection($('#hero'), {
      measurer: m,
      signal: ac.signal,
      onStage: (s) => s === 'layout' && ac.abort(),
    });
    await expect(p).rejects.toThrow(/cancelled/);
  });

  it('rejects removed elements', async () => {
    const el = document.createElement('section');
    await expect(analyzeSection(el, { measurer: m })).rejects.toThrow(/removed/);
  });
});
