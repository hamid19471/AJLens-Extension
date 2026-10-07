import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SectionAnalysis } from '../src/shared/types';
import { analyzeSection } from '../src/core/analysis';
import { generatePrompt } from '../src/core/prompt/generate';
import { buildMarkdownExport } from '../src/core/prompt/export';
import { DEFAULT_PREFERENCES } from '../src/shared/preferences';
import { COPY_FEEDBACK_MS, InspectorController } from '../src/content/controller';
import { Panel } from '../src/content/panel/Panel';
import { TRANSLATIONS, type Locale } from '../src/shared/i18n';

const EN = TRANSLATIONS.en;
const FA = TRANSLATIONS.fa;

function setLocale(c: InspectorController, locale: Locale) {
  c.store.set({ prefs: { ...c.store.get().prefs, locale } });
}
import type { ClipboardService } from '../src/content/clipboard';
import { $, loadFixture, testMeasurer } from './helpers';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let analysis: SectionAnalysis;

beforeAll(async () => {
  globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;
  loadFixture('landing.html');
  // Persian content captured from the inspected site must survive verbatim.
  $('#pricing h2').textContent = 'Pricing — قیمت‌گذاری ماهانه';
  analysis = await analyzeSection($('#pricing'), { measurer: testMeasurer() });
});

function fakeClipboard() {
  const copied: string[] = [];
  const service: ClipboardService & { copied: string[] } = {
    copied,
    copyText: vi.fn(async (v: string) => {
      copied.push(v);
    }),
  };
  return service;
}

function readyController(clipboard: ClipboardService, prompt?: string) {
  const c = new InspectorController({ onClose: () => undefined, clipboard });
  // Copy tests run in English unless a test opts into Persian with setLocale().
  const prefs = {
    ...DEFAULT_PREFERENCES,
    locale: 'en' as const,
    include: { ...DEFAULT_PREFERENCES.include },
  };
  c.store.set({
    mode: 'locked',
    stage: 'ready',
    analysis,
    prefs,
    prompt:
      prompt ??
      generatePrompt(analysis, {
        detail: prefs.promptDetail,
        buildTarget: prefs.buildTarget,
        customInstructions: '',
        include: prefs.include,
      }),
  });
  return c;
}

describe('controller.copyPrompt', () => {
  it('copies the entire detailed prompt from state with an exact character count', async () => {
    const clip = fakeClipboard();
    const c = readyController(clip);
    const full = c.store.get().prompt;
    await c.copyPrompt();
    expect(clip.copied).toHaveLength(1);
    expect(clip.copied[0]).toBe(full);
    expect(clip.copied[0].length).toBe(full.length);
    // Final sections and Markdown structure are intact.
    expect(clip.copied[0]).toContain('\n# Visual Validation Checklist\n');
    expect(clip.copied[0]).toContain('\n# Source Measurements\n');
    expect(clip.copied[0]).toContain('\n# Assumptions and Uncertainties\n');
    expect(clip.copied[0]).toMatch(/```css\n[\s\S]+?\n```/);
    expect(clip.copied[0]).toContain('\n- [ ] ');
    expect(clip.copied[0].split('\n').length).toBe(full.split('\n').length);
    expect(clip.copied[0].startsWith('Reconstruct the selected website section')).toBe(true);
  });

  it('preserves Persian text from the page inside the English prompt', async () => {
    const clip = fakeClipboard();
    await readyController(clip).copyPrompt();
    expect(clip.copied[0]).toContain('قیمت‌گذاری ماهانه');
    expect(clip.copied[0]).toContain('# Reconstruction Task');
  });

  it('copies the compact prompt after switching modes, and the detailed one after switching back', async () => {
    const clip = fakeClipboard();
    const c = readyController(clip);
    const detailed = c.store.get().prompt;
    c.setPrefs({ promptDetail: 'compact' });
    const compact = c.store.get().prompt;
    expect(compact).not.toBe(detailed);
    expect(compact.length).toBeLessThan(detailed.length);
    await c.copyPrompt();
    c.setPrefs({ promptDetail: 'detailed' });
    await c.copyPrompt();
    expect(clip.copied).toEqual([compact, detailed]);
  });

  it('does not copy while the prompt is incomplete', async () => {
    const clip = fakeClipboard();
    const c = readyController(clip);
    c.store.set({ stage: 'typography', prompt: '' });
    await c.copyPrompt();
    c.store.set({ stage: 'prompt', prompt: 'partial' });
    await c.copyPrompt();
    expect(clip.copyText).not.toHaveBeenCalled();
  });

  it('copies very large prompts without truncation', async () => {
    const clip = fakeClipboard();
    const huge = `# Reconstruction Task\n${'- measured value\n'.repeat(200_000)}# Assumptions and Uncertainties\nEND`;
    const c = readyController(clip, huge);
    await c.copyPrompt();
    expect(clip.copied[0].length).toBe(huge.length);
    expect(clip.copied[0].endsWith('END')).toBe(true);
  });

  it('reports success and failure, then resets after the feedback delay', async () => {
    vi.useFakeTimers();
    try {
      const c = readyController(fakeClipboard());
      await c.copyPrompt();
      expect(c.store.get().copyStatus).toBe('copied');
      expect(c.store.get().announcement).toBe(EN.fullPromptCopied);
      vi.advanceTimersByTime(COPY_FEEDBACK_MS);
      expect(c.store.get().copyStatus).toBe('idle');

      const failing = readyController({
        copyText: async () => Promise.reject(new Error('denied')),
      });
      setLocale(failing, 'fa');
      await failing.copyPrompt();
      expect(failing.store.get().copyStatus).toBe('failed');
      expect(failing.store.get().announcement).toBe(FA.copyFailed);
      vi.advanceTimersByTime(COPY_FEEDBACK_MS);
      expect(failing.store.get().copyStatus).toBe('idle');
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves prompt exports unchanged', () => {
    const c = readyController(fakeClipboard());
    const prompt = c.store.get().prompt;
    const md = buildMarkdownExport(analysis, prompt);
    expect(md).toContain(prompt.trim());
    expect(md).toContain('reference_image: "reference.png"');
  });
});

describe('Copy full prompt button', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (c: InspectorController) =>
    act(() => root.render(createElement(Panel, { controller: c })));
  const button = () =>
    container.querySelector<HTMLButtonElement>('[data-testid="copy-full-prompt"]')!;
  const status = () => container.querySelector('.copy-status')!;

  it('is disabled with a generating state before the prompt is ready', () => {
    const c = readyController(fakeClipboard());
    c.store.set({ stage: 'layout', prompt: '', analysis: null });
    render(c);
    expect(button().disabled).toBe(true);
    expect(button().getAttribute('aria-busy')).toBe('true');
    expect(status().textContent).toBe(EN.generatingPrompt);
  });

  it('becomes enabled when the full prompt is ready and copies it in one click', async () => {
    const clip = fakeClipboard();
    const c = readyController(clip);
    c.store.set({ stage: 'layout', prompt: '', analysis: null });
    render(c);
    expect(button().disabled).toBe(true);
    const full = generatePrompt(analysis, {
      detail: 'detailed',
      buildTarget: 'existing',
      customInstructions: '',
      include: DEFAULT_PREFERENCES.include,
    });
    act(() => c.store.set({ stage: 'ready', analysis, prompt: full }));
    expect(button().disabled).toBe(false);
    expect(button().getAttribute('aria-busy')).toBe('false');
    expect(button().textContent).toBe('Copy full prompt');
    expect(status().textContent).toBe(EN.modeDetailed);
    await act(async () => button().click());
    expect(clip.copied).toEqual([full]);
    expect(button().textContent).toContain('Full prompt copied');
  });

  it('copies state, not the textarea: text beyond the visible area and no UI labels', async () => {
    const clip = fakeClipboard();
    const c = readyController(clip);
    render(c);
    const ta = container.querySelector<HTMLTextAreaElement>('textarea.prompt')!;
    // Simulate a scrolled, partially visible textarea with a user selection.
    ta.scrollTop = 50;
    ta.setSelectionRange(0, 20);
    await act(async () => button().click());
    const copied = clip.copied[0];
    expect(copied).toBe(c.store.get().prompt);
    expect(copied.length).toBeGreaterThan(20);
    expect(copied).toContain('# Assumptions and Uncertainties');
    for (const label of [
      'RECONSTRUCTION PROMPT',
      'BUILD WITH',
      'Copy full prompt',
      'Save prompt.md',
      'chars',
      'INCLUDE IN PROMPT',
      'Measured locally',
    ]) {
      expect(copied).not.toContain(label);
    }
  });

  it('switching modes in the UI changes what is copied', async () => {
    const clip = fakeClipboard();
    const c = readyController(clip);
    render(c);
    const compactRadio = container.querySelector<HTMLButtonElement>(
      '[data-testid="mode-compact"]',
    )!;
    act(() => compactRadio.click());
    expect(status().textContent).toBe(EN.modeCompact);
    await act(async () => button().click());
    expect(clip.copied[0]).toBe(c.store.get().prompt);
    expect(clip.copied[0].length).toBeLessThanOrEqual(6000);
  });

  it('regeneration disables the button until the new prompt is complete', async () => {
    const clip = fakeClipboard();
    const c = readyController(clip);
    render(c);
    expect(button().disabled).toBe(false);
    // Re-run the real analysis pipeline on the locked section (jsdom: section is off-viewport → capture choice).
    (c as unknown as { target: Element }).target = $('#pricing');
    await act(async () => c.refresh());
    expect(c.store.get().stage).not.toBe('ready');
    expect(button().disabled).toBe(true);
    await act(async () => button().click());
    expect(clip.copyText).not.toHaveBeenCalled();
    await act(async () => {
      c.chooseCapture('cancel');
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(c.store.get().stage).toBe('ready');
    expect(button().disabled).toBe(false);
    await act(async () => button().click());
    expect(clip.copied[0]).toBe(c.store.get().prompt);
  });

  it('shows localized failure feedback without changing the button label', async () => {
    const c = readyController({ copyText: async () => Promise.reject(new Error('denied')) });
    render(c);
    await act(async () => button().click());
    expect(status().textContent).toBe('Could not copy the prompt. Please try again.');
    expect(status().classList.contains('failed')).toBe(true);
    expect(button().textContent).toBe('Copy full prompt');
    const live = container.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toBe('Could not copy the prompt. Please try again.');
  });

  it('uses Persian labels, accessible name and confirmation in the fa locale', async () => {
    const clip = fakeClipboard();
    const c = readyController(clip);
    setLocale(c, 'fa');
    render(c);
    expect(button().textContent).toBe('کپی کامل پرامپت');
    expect(button().getAttribute('aria-label')).toBe('کپی کامل پرامپت بازسازی در کلیپ‌بورد');
    expect(button().closest('[lang]')?.getAttribute('lang')).toBe('fa');
    expect(button().closest('[dir]')?.getAttribute('dir')).toBe('rtl');
    await act(async () => button().click());
    expect(button().textContent).toContain('پرامپت کامل کپی شد');
    expect(container.querySelector('[aria-live="polite"]')!.textContent).toBe('پرامپت کامل کپی شد');
    // The prompt itself stays English.
    expect(clip.copied[0]).toContain('# Reconstruction Task');
  });

  it('uses English labels and accessible name in the en locale', () => {
    const c = readyController(fakeClipboard());
    render(c);
    expect(button().tagName).toBe('BUTTON');
    expect(button().type).toBe('button');
    expect(button().textContent).toBe('Copy full prompt');
    expect(button().getAttribute('aria-label')).toBe(
      'Copy the complete reconstruction prompt to the clipboard',
    );
    // Only one copy action exists.
    const copyButtons = Array.from(container.querySelectorAll('button')).filter((b) =>
      /copy/i.test(b.textContent ?? ''),
    );
    expect(copyButtons).toHaveLength(1);
  });
});
