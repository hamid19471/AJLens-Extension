import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SectionAnalysis } from '../src/shared/types';
import { STAGE_MESSAGE_KEYS, STAGE_ORDER } from '../src/shared/types';
import {
  DEFAULT_LOCALE,
  TRANSLATIONS,
  format,
  formatNumber,
  messages,
  type Locale,
  type MessageKey,
} from '../src/shared/i18n';
import {
  DEFAULT_PREFERENCES,
  INCLUDE_MESSAGE_KEYS,
  STORAGE_KEY,
  loadPreferences,
  migrateLocale,
  normalizePreferences,
  type StorageArea,
} from '../src/shared/preferences';
import { InspectorController, noticeForAnalysis } from '../src/content/controller';
import { Panel } from '../src/content/panel/Panel';
import { analyzeSection } from '../src/core/analysis';
import { PROMPT_HEADINGS, generatePrompt } from '../src/core/prompt/generate';
import { buildJsonExport, buildMarkdownExport } from '../src/core/prompt/export';
import { $, loadFixture, testMeasurer } from './helpers';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FA = TRANSLATIONS.fa;
const EN = TRANSLATIONS.en;
const PERSIAN = /[؀-ۿ]/;

function memoryArea(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = structuredClone(initial);
  const area: StorageArea & { data: Record<string, unknown> } = {
    data,
    get: async (keys) => {
      const out: Record<string, unknown> = {};
      for (const k of Array.isArray(keys) ? keys : [keys])
        if (k in data) out[k] = structuredClone(data[k]);
      return out;
    },
    set: async (items) => void Object.assign(data, structuredClone(items)),
    remove: async (keys) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
  };
  return area;
}

let analysis: SectionAnalysis;
beforeAll(async () => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  loadFixture('landing.html');
  analysis = await analyzeSection($('#pricing'), { measurer: testMeasurer() });
});

function controllerWith(locale: Locale | null) {
  const c = new InspectorController({
    onClose: () => undefined,
    clipboard: { copyText: async () => undefined },
  });
  if (locale) c.store.set({ prefs: { ...c.store.get().prefs, locale } });
  return c;
}

const CANDIDATE = {
  tag: 'article',
  selector: 'article.entry',
  width: 320.4,
  height: 180,
  descendants: 17,
  assets: 2,
  assetsMeasured: true,
};

function readyState(c: InspectorController) {
  const prefs = c.store.get().prefs;
  c.store.set({
    mode: 'locked',
    stage: 'ready',
    analysis,
    candidate: CANDIDATE,
    prompt: generatePrompt(analysis, {
      detail: prefs.promptDetail,
      buildTarget: prefs.buildTarget,
      customInstructions: '',
      include: prefs.include,
    }),
  });
}

describe('translation dictionary', () => {
  it('Persian dictionary has a non-empty value for every key', () => {
    const keys = Object.keys(EN) as MessageKey[];
    expect(Object.keys(FA).sort()).toEqual([...keys].sort());
    for (const key of keys) expect(FA[key].trim(), key).not.toBe('');
  });

  it('Persian strings are actually Persian (except product/technical-only entries)', () => {
    const technicalOnly: MessageKey[] = ['titleIdle'];
    for (const key of Object.keys(FA) as MessageKey[]) {
      if (technicalOnly.includes(key)) continue;
      expect(FA[key], key).toMatch(PERSIAN);
    }
  });

  it('uses the required wording', () => {
    expect(FA.inspectorActive).toBe('بازرس فعال است');
    expect(FA.sectionLocked).toBe('بخش قفل شده است');
    expect(FA.tagline).toBe('انتخاب کنید، ثبت کنید، بازسازی کنید.');
    expect(FA.copyFullPrompt).toBe('کپی کامل پرامپت');
    expect(FA.restrictedBrowser).toBe(
      'AJ Lens نمی‌تواند در صفحات داخلی مرورگر یا فروشگاه Chrome اجرا شود. یک وب‌سایت معمولی را باز کنید و دوباره تلاش کنید.',
    );
    expect(FA.footerPrivate).toBe(
      'اندازه‌گیری به‌صورت محلی انجام می‌شود و هیچ داده‌ای بارگذاری نمی‌شود.',
    );
  });

  it('falls back to English for empty entries', () => {
    const original = FA.tagline;
    (FA as Record<MessageKey, string>).tagline = '';
    try {
      expect(messages('fa').tagline).toBe(EN.tagline);
    } finally {
      (FA as Record<MessageKey, string>).tagline = original;
    }
  });

  it('formats placeholders and Persian digits', () => {
    expect(format(FA.partialVisible, { percent: formatNumber(42, 'fa') })).toContain('۴۲٪');
    expect(formatNumber(14327, 'en')).toBe('14,327');
  });
});

describe('default locale and persistence', () => {
  it('a fresh installation defaults to Persian and stores it', async () => {
    const area = memoryArea();
    expect(DEFAULT_LOCALE).toBe('fa');
    expect(DEFAULT_PREFERENCES.locale).toBe('fa');
    const prefs = await loadPreferences(area);
    expect(prefs.locale).toBe('fa');
    expect((area.data[STORAGE_KEY] as { locale: string }).locale).toBe('fa');
  });

  it('an English browser still defaults to Persian', () => {
    const spy = vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
    try {
      expect(controllerWith(null).store.get().prefs.locale).toBe('fa');
      expect(normalizePreferences({}).locale).toBe('fa');
    } finally {
      spy.mockRestore();
    }
  });

  it('respects an explicit English choice', async () => {
    const area = memoryArea({ [STORAGE_KEY]: { ...DEFAULT_PREFERENCES, locale: 'en' } });
    expect((await loadPreferences(area)).locale).toBe('en');
  });

  it('migrates existing installs without a locale to Persian, preserving everything else', async () => {
    const existing = {
      version: 1,
      panelPosition: { x: 40, y: 60 },
      minimized: true,
      buildTarget: 'vue',
      customInstructions: 'keep it',
      promptDetail: 'compact',
      include: { ...DEFAULT_PREFERENCES.include, visibleText: false },
    };
    const area = memoryArea({ [STORAGE_KEY]: existing });
    expect(await migrateLocale(area)).toBe(true);
    expect(area.data[STORAGE_KEY]).toEqual({ ...existing, locale: 'fa' });
    // Idempotent and never overrides an explicit choice.
    expect(await migrateLocale(area)).toBe(false);
    const english = memoryArea({ [STORAGE_KEY]: { ...existing, locale: 'en' } });
    expect(await migrateLocale(english)).toBe(false);
    expect((english.data[STORAGE_KEY] as { locale: string }).locale).toBe('en');
  });

  it('locale persists after closing and reopening', async () => {
    const area = memoryArea();
    vi.stubGlobal('chrome', { storage: { local: area } });
    try {
      const c = controllerWith(null);
      c.setPrefs({ locale: 'en' });
      c.destroy(); // flushes the pending save
      await new Promise((r) => setTimeout(r, 0));
      expect((await loadPreferences(area)).locale).toBe('en');
      const reopened = await loadPreferences(area);
      expect(reopened.locale).toBe('en');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('panel localization', () => {
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
  const q = (sel: string) => container.querySelector<HTMLElement>(sel)!;
  const text = (sel: string) => q(sel).textContent ?? '';

  it('Persian panel root uses lang="fa" dir="rtl" by default', () => {
    render(controllerWith(null));
    expect(q('[data-testid="panel"]').getAttribute('lang')).toBe('fa');
    expect(q('[data-testid="panel"]').getAttribute('dir')).toBe('rtl');
    expect(text('.brand')).toBe('AJ Lens');
  });

  it('English panel uses lang="en" dir="ltr"', () => {
    render(controllerWith('en'));
    expect(q('[data-testid="panel"]').getAttribute('lang')).toBe('en');
    expect(q('[data-testid="panel"]').getAttribute('dir')).toBe('ltr');
    expect(text('[data-testid="status"]')).toBe(EN.inspectorActive);
    expect(text('[data-testid="copy-full-prompt"]')).toBe('Copy full prompt');
  });

  it('shows the complete Persian panel', () => {
    const c = controllerWith('fa');
    readyState(c);
    render(c);
    expect(text('[data-testid="status"]')).toBe(FA.sectionLocked);
    expect(text('.tagline')).toBe(FA.tagline);
    expect(text('.desc')).toBe(FA.description);
    // Selection controls
    expect(text('[data-testid="nav-parent"]')).toBe(`↑ ${FA.parent}`);
    expect(text('[data-testid="nav-child"]')).toBe(`↓ ${FA.smaller}`);
    expect(text('[data-testid="pick-another"]')).toBe(FA.pickAnother);
    expect(text('[data-testid="lock-toggle"]')).toBe(FA.unlockSection);
    expect(text('[data-testid="refresh"]')).toBe(`↻ ${FA.refresh}`);
    // Build target
    const select = q('[data-testid="build-target"]') as HTMLSelectElement;
    expect(select.options[0].text).toBe('پیروی از فناوری‌های موجود پروژه');
    expect(Array.from(select.options).map((o) => o.text)).toContain('Next.js');
    expect(Array.from(select.options).map((o) => o.text)).toContain('دستورهای سفارشی');
    // Prompt area
    expect(text('[data-testid="mode-detailed"]')).toBe('کامل');
    expect(text('[data-testid="mode-compact"]')).toBe('خلاصه');
    expect(text('[data-testid="char-count"]')).toContain(FA.characters);
    expect(text('[data-testid="char-count"]')).toMatch(/[۰-۹]/);
    expect(text('[data-testid="copy-full-prompt"]')).toBe('کپی کامل پرامپت');
    // Export buttons keep filenames LTR inside Persian labels
    expect(text('[data-testid="save-prompt"]')).toBe('ذخیره prompt.md');
    expect(text('[data-testid="save-reference"]')).toBe('ذخیره reference.png');
    expect(text('[data-testid="save-analysis"]')).toBe('ذخیره analysis.json');
    expect(q('[data-testid="save-prompt"] bdi[dir="ltr"]').textContent).toBe('prompt.md');
    // Include section
    expect(text('.options summary')).toBe('موارد موجود در پرامپت');
    const checks = Array.from(container.querySelectorAll('.check span')).map((s) => s.textContent);
    expect(checks).toEqual(Object.values(INCLUDE_MESSAGE_KEYS).map((k) => FA[k]));
    // Footer
    expect(text('[data-testid="footer"]')).toContain('Esc: بستن');
    expect(text('[data-testid="footer"]')).toContain('↑/↓: تغییر انتخاب');
    expect(text('[data-testid="footer"]')).toContain('کلیک: قفل‌کردن');
    expect(text('[data-testid="footer"]')).toContain(FA.footerPrivate);
    // Language selector
    expect(q('[data-testid="locale-fa"]').getAttribute('aria-checked')).toBe('true');
    expect(text('[data-testid="locale-fa"]')).toBe('فارسی');
    expect(text('[data-testid="locale-en"]')).toBe('English');
  });

  it('keeps selectors and dimensions LTR with Persian counts', () => {
    const c = controllerWith('fa');
    c.store.set({ candidate: CANDIDATE });
    render(c);
    expect(q('.sel-head').getAttribute('dir')).toBe('ltr');
    expect(text('.selector')).toBe('article.entry');
    const meta = q('[data-testid="selection-meta"]');
    expect(meta.querySelector('bdi[dir="ltr"]')!.textContent).toBe('320.4 × 180 px');
    expect(meta.textContent).toContain('، ۱۷ عنصر، ');
    expect(meta.textContent).toContain('۲ فایل');
  });

  it('keeps the prompt textarea English and LTR in the Persian UI', () => {
    const c = controllerWith('fa');
    readyState(c);
    render(c);
    const ta = q('textarea.prompt') as HTMLTextAreaElement;
    expect(ta.getAttribute('lang')).toBe('en');
    expect(ta.getAttribute('dir')).toBe('ltr');
    expect(ta.value).not.toMatch(PERSIAN);
    expect(ta.value.startsWith('Reconstruct the selected website section')).toBe(true);
  });

  it('switching language updates the panel immediately and leaves the prompt unchanged', () => {
    const c = controllerWith('fa');
    readyState(c);
    render(c);
    const before = c.store.get().prompt;
    act(() => q('[data-testid="locale-en"]').click());
    expect(q('[data-testid="panel"]').getAttribute('dir')).toBe('ltr');
    expect(text('[data-testid="status"]')).toBe(EN.sectionLocked);
    expect(text('[data-testid="copy-full-prompt"]')).toBe('Copy full prompt');
    expect(c.store.get().prompt).toBe(before);
    act(() => q('[data-testid="locale-fa"]').click());
    expect(q('[data-testid="panel"]').getAttribute('dir')).toBe('rtl');
    expect(text('[data-testid="status"]')).toBe(FA.sectionLocked);
    expect(c.store.get().prompt).toBe(before);
  });

  it('shows every progress message in Persian', () => {
    const c = controllerWith('fa');
    render(c);
    for (const stage of STAGE_ORDER) {
      act(() => c.store.set({ stage }));
      expect(text('[data-testid="progress"] .progress-text span')).toBe(
        FA[STAGE_MESSAGE_KEYS[stage]],
      );
    }
    act(() => c.store.set({ stage: 'layout' }));
    expect(text('[data-testid="copy-status"]')).toBe('در حال تولید پرامپت…');
  });

  it('shows the partial-capture dialog in Persian', () => {
    const c = controllerWith('fa');
    c.store.set({ captureChoice: { visiblePercent: 42 } });
    render(c);
    const dialog = q('[data-testid="capture-choice"]');
    expect(dialog.textContent).toContain(
      'بخشی از ناحیه انتخاب‌شده خارج از محدوده قابل مشاهده است.',
    );
    expect(dialog.textContent).toContain('۴۲٪');
    expect(text('[data-testid="capture-visible"]')).toBe('ثبت بخش قابل مشاهده');
    expect(text('[data-testid="capture-scroll"]')).toBe('نمایش کامل بخش و ثبت تصویر');
    expect(text('[data-testid="capture-cancel"]')).toBe('انصراف');
  });

  it('shows notices in Persian with raw technical detail kept LTR', () => {
    const c = controllerWith('fa');
    c.store.set({
      notice: { kind: 'error', key: 'downloadFailed', detail: 'Error: NETWORK_FAILED' },
    });
    render(c);
    const notice = q('[data-testid="notice"]');
    expect(notice.textContent).toContain('دانلود انجام نشد.');
    expect(notice.querySelector('bdi[dir="ltr"]')!.textContent).toBe('Error: NETWORK_FAILED');
  });

  it('shows copy success and failure feedback in Persian', async () => {
    const c = controllerWith('fa');
    readyState(c);
    render(c);
    await act(async () => q('[data-testid="copy-full-prompt"]').click());
    expect(text('[data-testid="copy-full-prompt"]')).toContain('پرامپت کامل کپی شد');
    const failing = new InspectorController({
      onClose: () => undefined,
      clipboard: { copyText: async () => Promise.reject(new Error('denied')) },
    });
    readyState(failing);
    act(() => root.render(createElement(Panel, { controller: failing })));
    await act(async () => q('[data-testid="copy-full-prompt"]').click());
    expect(text('[data-testid="copy-status"]')).toBe('کپی پرامپت انجام نشد. دوباره تلاش کنید.');
  });

  /**
   * Guard against untranslated UI: render the Persian panel in every major state and fail on
   * any Latin word outside LTR-isolated technical content or the allowlist.
   */
  it('contains no stray English UI strings in Persian mode', () => {
    const ALLOWED = [
      'AJ Lens',
      'HTML/CSS/JavaScript',
      'Tailwind CSS',
      'Next.js',
      'React',
      'Vue',
      'Nuxt',
      'Svelte',
      'Astro',
      'English',
      'Esc',
      'Enter',
      'DOM',
      'CSS',
      'Chrome',
      '<Card>',
      'theme.ts',
      'src/sections/',
      '(C)',
      '(R)',
    ];
    const leaks: string[] = [];
    const scan = (label: string) => {
      const strings: string[] = [];
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const parent = n.parentElement;
        if (
          !parent ||
          parent.closest('[dir="ltr"]:not([data-testid^="locale"])') ||
          parent.closest('textarea.prompt')
        )
          continue;
        strings.push(n.textContent ?? '');
      }
      for (const el of Array.from(container.querySelectorAll('*'))) {
        if (el.closest('[dir="ltr"]') && !el.matches('[data-testid="panel"]')) continue;
        for (const attr of ['aria-label', 'title', 'placeholder', 'aria-description']) {
          const v = el.getAttribute(attr);
          if (v && !(el.matches('textarea.prompt') && attr === 'value')) strings.push(v);
        }
      }
      for (const s of strings) {
        let rest = s;
        for (const a of ALLOWED) rest = rest.split(a).join(' ');
        const words = rest.match(/[A-Za-z]{2,}/g);
        if (words) leaks.push(`${label}: "${s}" → ${words.join(', ')}`);
      }
    };
    const c = controllerWith('fa');
    render(c);
    scan('idle');
    act(() => c.store.set({ candidate: CANDIDATE, notice: { kind: 'info', key: 'noParent' } }));
    scan('hover');
    act(() =>
      c.store.set({ mode: 'locked', stage: 'typography', captureChoice: { visiblePercent: 30 } }),
    );
    scan('analyzing');
    act(() => {
      readyState(c);
      c.store.set({ captureChoice: null });
      c.setPrefs({ buildTarget: 'custom' });
    });
    scan('ready');
    expect(leaks).toEqual([]);
  });
});

describe('panel source has no hard-coded English strings', () => {
  it('Panel.tsx JSX text and labels come from the dictionary', () => {
    const src = readFileSync(resolve(__dirname, '../src/content/panel/Panel.tsx'), 'utf8');
    const jsxText = [...src.matchAll(/>\s*([^<>{}\n]*[A-Za-z]{3,}[^<>{}\n]*)\s*</g)].map((m) =>
      m[1].trim(),
    );
    const attrs = [
      ...src.matchAll(/(?:aria-label|title|placeholder)="([^"]*[A-Za-z]{3,}[^"]*)"/g),
    ].map((m) => m[1]);
    const allowed = new Set(['AJ Lens']);
    expect([...jsxText, ...attrs].filter((s) => s && !allowed.has(s))).toEqual([]);
  });
});

describe('generated output stays English', () => {
  const opts = (detail: 'detailed' | 'compact') => ({
    detail,
    buildTarget: 'existing' as const,
    customInstructions: '',
    include: DEFAULT_PREFERENCES.include,
  });

  it('detailed and compact prompts are English with English headings', () => {
    for (const mode of ['detailed', 'compact'] as const) {
      const p = generatePrompt(analysis, opts(mode));
      expect(p).not.toMatch(PERSIAN);
      for (const h of PROMPT_HEADINGS) expect(p).toContain(`\n# ${h}\n`);
    }
  });

  it('the Persian UI does not change the generated prompt', () => {
    const fa = controllerWith('fa');
    const en = controllerWith('en');
    for (const c of [fa, en]) {
      c.store.set({ analysis, stage: 'ready' });
      c.setPrefs({ promptDetail: 'compact' });
    }
    expect(fa.store.get().prompt).toBe(en.store.get().prompt);
    expect(fa.store.get().prompt).not.toMatch(PERSIAN);
  });

  it('prompt.md export and JSON keys stay English', () => {
    const md = buildMarkdownExport(analysis, generatePrompt(analysis, opts('detailed')));
    expect(md).not.toMatch(PERSIAN);
    const json = buildJsonExport(analysis);
    const keys = [...json.matchAll(/"([^"]+)":/g)].map((m) => m[1]);
    for (const k of keys) expect(k).toMatch(/^[\x20-\x7E]+$/);
    expect(JSON.parse(json).classification.primary).toBe('pricing');
  });

  it('Persian page content is kept verbatim inside the English prompt', async () => {
    document.body.innerHTML =
      '<section id="fa"><h2>قیمت‌گذاری ماهانه</h2><p>شروع رایگان</p></section>';
    const a = await analyzeSection($('#fa'), { measurer: testMeasurer() });
    const p = generatePrompt(a, opts('detailed'));
    expect(p).toContain('قیمت‌گذاری ماهانه');
    expect(p).toContain('# Reconstruction Task');
    loadFixture('landing.html');
  });

  it('analysis notices map to dictionary keys, not English warnings', () => {
    const notice = noticeForAnalysis({
      ...analysis,
      reference: { fileName: 'reference.png', status: 'partial' },
    });
    expect(notice?.key).toBe('partialReference');
    expect(FA[notice!.key]).toMatch(PERSIAN);
  });
});

describe('restricted-page popup', () => {
  const html = readFileSync(resolve(__dirname, '../public/notice.html'), 'utf8');

  it('ships Persian RTL markup by default', () => {
    expect(html).toMatch(/<html lang="fa" dir="rtl">/);
    expect(html.replace(/\s+/g, ' ')).toContain(FA.restrictedBrowser);
  });

  it('renders the localized reason from the query string', async () => {
    document.documentElement.innerHTML = html.replace(/<script[^>]*><\/script>/, '');
    window.history.replaceState(
      null,
      '',
      '/notice.html?key=restrictedBrowser&lang=fa&detail=Cannot%20access%20chrome%3A%2F%2F',
    );
    vi.resetModules();
    await import('../src/notice/index');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.getElementById('reason')!.textContent).toBe(FA.restrictedBrowser);
    expect(document.getElementById('heading')!.textContent).toBe(FA.noticeHeading);
    expect(document.getElementById('detail')!.textContent).toBe('Cannot access chrome://');
    window.history.replaceState(null, '', '/');
    loadFixture('landing.html');
  });
});

describe('page overlay label', () => {
  it('localizes the locked state and keeps selector/size LTR', async () => {
    const { overlayLabel, Overlay } = await import('../src/content/overlay');
    expect(overlayLabel('section#pricing', 1080.4, 460, true, 'fa')).toEqual({
      prefix: 'قفل‌شده',
      technical: 'section#pricing · 1080 × 460',
      locale: 'fa',
    });
    expect(overlayLabel('div.plan', 10, 20, false, 'fa').prefix).toBeUndefined();
    expect(overlayLabel('div.plan', 10, 20, true, 'en').prefix).toBe('Locked');

    const host = document.createElement('div');
    document.body.append(host);
    const overlay = new Overlay(host.attachShadow({ mode: 'open' }));
    overlay.show(
      { x: 0, y: 40, width: 100, height: 50 },
      overlayLabel('section#pricing', 100, 50, true, 'fa'),
      true,
    );
    const label = overlay.root.querySelector('.ajl-label')!;
    expect(label.getAttribute('dir')).toBe('rtl');
    expect(label.querySelector('bdi')!.getAttribute('dir')).toBe('ltr');
    expect(label.textContent).toBe('قفل‌شده · section#pricing · 100 × 50');
    expect(label.textContent).not.toMatch(/LOCKED/i);
    overlay.destroy();
    host.remove();
  });
});
