import { beforeAll, describe, expect, it } from 'vitest';
import type { SectionAnalysis } from '../src/shared/types';
import { analyzeSection } from '../src/core/analysis';
import {
  COMPACT_MAX,
  DETAILED_MAX,
  PROMPT_HEADINGS,
  PROMPT_INTRO,
  generatePrompt,
  renderTree,
} from '../src/core/prompt/generate';
import {
  buildJsonExport,
  buildMarkdownExport,
  exportFolder,
  textDataUrl,
  toBase64,
} from '../src/core/prompt/export';
import { DEFAULT_INCLUDE } from '../src/shared/preferences';
import { $, loadFixture, testMeasurer } from './helpers';

let analysis: SectionAnalysis;
let bodyAnalysis: SectionAnalysis;

beforeAll(async () => {
  loadFixture('landing.html');
  analysis = await analyzeSection($('#pricing'), {
    measurer: testMeasurer(),
    now: () => new Date('2026-10-07T10:00:00Z'),
    capture: async () => ({
      fileName: 'reference.png',
      status: 'captured',
      scale: 2,
      pixelSize: { width: 2400, height: 1200 },
    }),
  });
  bodyAnalysis = await analyzeSection(document.body, { measurer: testMeasurer() });
});

const opts = (detail: 'detailed' | 'compact', extra = {}) => ({
  detail,
  buildTarget: 'existing' as const,
  customInstructions: '',
  include: { ...DEFAULT_INCLUDE },
  ...extra,
});

describe('prompt generation', () => {
  it('starts with the required introduction', () => {
    const p = generatePrompt(analysis, opts('detailed'));
    expect(p.startsWith(PROMPT_INTRO)).toBe(true);
    expect(p).toContain('Implement it; do not only describe it.');
  });

  it('contains every required heading in order', () => {
    for (const mode of ['detailed', 'compact'] as const) {
      const p = generatePrompt(analysis, opts(mode));
      let last = -1;
      for (const h of PROMPT_HEADINGS) {
        const idx = p.indexOf(`\n# ${h}\n`);
        expect(idx, `${mode}: ${h}`).toBeGreaterThan(last);
        last = idx;
      }
    }
  });

  it('keeps detailed and compact within their size budgets', () => {
    const detailed = generatePrompt(analysis, opts('detailed'));
    const compact = generatePrompt(analysis, opts('compact'));
    expect(detailed.length).toBeGreaterThanOrEqual(8000);
    expect(detailed.length).toBeLessThanOrEqual(DETAILED_MAX);
    expect(compact.length).toBeGreaterThanOrEqual(2000);
    expect(compact.length).toBeLessThanOrEqual(COMPACT_MAX);
    expect(compact.length).toBeLessThan(detailed.length);
  });

  it('shrinks oversized prompts to the budget', () => {
    const big = generatePrompt(bodyAnalysis, opts('detailed'));
    expect(big.length).toBeLessThanOrEqual(DETAILED_MAX);
    const small = generatePrompt(bodyAnalysis, opts('compact'));
    expect(small.length).toBeLessThanOrEqual(COMPACT_MAX);
    expect((small.match(/```/g) ?? []).length % 2).toBe(0);
  });

  it('labels measured and inferred values', () => {
    const p = generatePrompt(analysis, opts('detailed'));
    expect(p).toMatch(/\(measured\)/);
    expect(p).toMatch(/inferred/);
    expect(p).toContain('/* inferred:');
  });

  it('respects include/exclude options', () => {
    const withText = generatePrompt(analysis, opts('detailed'));
    expect(withText).toContain('"$29/mo"');
    const noText = generatePrompt(
      analysis,
      opts('detailed', { include: { ...DEFAULT_INCLUDE, visibleText: false } }),
    );
    expect(noText).not.toContain('"$29/mo"');
    const noCss = generatePrompt(
      analysis,
      opts('detailed', { include: { ...DEFAULT_INCLUDE, cssEvidence: false } }),
    );
    expect(noCss).toContain('CSS evidence excluded by the user');
    const noUrls = generatePrompt(
      analysis,
      opts('detailed', { include: { ...DEFAULT_INCLUDE, assetUrls: false } }),
    );
    expect(noUrls).not.toContain('/signup?plan=pro');
  });

  it('applies the build target and custom instructions', () => {
    const tw = generatePrompt(analysis, opts('compact', { buildTarget: 'tailwind' }));
    expect(tw).toContain('Build target: **Tailwind CSS**');
    const custom = generatePrompt(
      analysis,
      opts('compact', { buildTarget: 'custom', customInstructions: 'Use our <Card> primitive.' }),
    );
    expect(custom).toContain('Use our <Card> primitive.');
  });

  it('includes core agent instructions', () => {
    const p = generatePrompt(analysis, opts('compact'));
    for (const phrase of [
      'Inspect the destination repository',
      'reuse existing tokens',
      'do not replace the whole app',
      'Do not use canvas',
      'reference.png',
      'type checks',
    ]) {
      expect(p.toLowerCase()).toContain(phrase.toLowerCase());
    }
  });

  it('never leaks secrets from the page', () => {
    const p = generatePrompt(bodyAnalysis, opts('detailed'));
    expect(p).not.toContain('hunter2-secret');
    expect(p).not.toContain('tok_9f8e7d6c5b4a3210fedcba');
    expect(p).not.toContain('hello@acme.test');
    expect(p).not.toContain('iVBORw0KGgo');
  });

  it('renders a truncated tree', () => {
    const tree = renderTree(bodyAnalysis.structure.root, 5, true);
    expect(tree.split('\n')).toHaveLength(6);
    expect(tree).toContain('truncated');
  });
});

describe('exports', () => {
  it('builds markdown with metadata and appendix', () => {
    const md = buildMarkdownExport(analysis, generatePrompt(analysis, opts('compact')));
    expect(md).toContain('captured_at: "2026-10-07T10:00:00.000Z"');
    expect(md).toContain('reference_image: "reference.png"');
    expect(md).toContain('## Appendix: Sanitized Measurement Summary');
    expect(md).toContain('# Reconstruction Task');
  });

  it('builds parseable JSON with schemaVersion', () => {
    const json = JSON.parse(buildJsonExport(analysis));
    expect(json.schemaVersion).toBe('1.0');
    expect(json.selection.selector).toBe('#pricing');
  });

  it('creates a safe export folder name', () => {
    expect(exportFolder(analysis)).toMatch(/^section-lens\/[\w.-]+-pricing-2026-10-07T10-00-00$/);
  });

  it('encodes UTF-8 data URLs', () => {
    expect(toBase64('× ✓')).toBe(Buffer.from('× ✓', 'utf8').toString('base64'));
    expect(textDataUrl('hi', 'text/markdown')).toBe('data:text/markdown;charset=utf-8;base64,aGk=');
  });
});
