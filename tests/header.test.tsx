import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SectionAnalysis } from '../src/shared/types';
import { TRANSLATIONS, type Locale } from '../src/shared/i18n';
import {
  DEFAULT_PREFERENCES,
  STORAGE_KEY,
  loadPreferences,
  type StorageArea,
} from '../src/shared/preferences';
import { InspectorController } from '../src/content/controller';
import { Panel } from '../src/content/panel/Panel';
import { analyzeSection } from '../src/core/analysis';
import { generatePrompt } from '../src/core/prompt/generate';
import { $, loadFixture, testMeasurer } from './helpers';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let analysis: SectionAnalysis;
beforeAll(async () => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  // jsdom lacks pointer capture; the drag handler calls it.
  HTMLElement.prototype.setPointerCapture = () => undefined;
  HTMLElement.prototype.releasePointerCapture = () => undefined;
  loadFixture('landing.html');
  analysis = await analyzeSection($('#pricing'), { measurer: testMeasurer() });
});

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

function controller(locale: Locale | null = null, onClose = () => undefined) {
  const c = new InspectorController({ onClose, clipboard: { copyText: async () => undefined } });
  if (locale) c.store.set({ prefs: { ...c.store.get().prefs, locale } });
  return c;
}
const render = (c: InspectorController) =>
  act(() => root.render(createElement(Panel, { controller: c })));
const q = <T extends HTMLElement = HTMLElement>(sel: string) => container.querySelector<T>(sel)!;
const header = () => q('header.hdr');
const body = () => q('.body');

function pointer(target: Element, type: string, x: number, y: number) {
  const init = { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, pointerId: 1 };
  const Ctor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  target.dispatchEvent(new Ctor(type, init));
}

describe('language selector placement', () => {
  it('renders exactly one selector, inside the header, between brand and window controls', () => {
    render(controller());
    expect(container.querySelectorAll('[data-testid="language-selector"]')).toHaveLength(1);
    expect(header().contains(q('[data-testid="language-selector"]'))).toBe(true);
    const order = Array.from(header().children).map((c) => c.getAttribute('data-testid'));
    expect(order).toEqual(['brand-group', 'language-selector', 'window-controls']);
    expect(q('[data-testid="brand-group"]').textContent).toBe('AJ Lens');
  });

  it('removes the old body language section', () => {
    render(controller());
    expect(body().querySelector('[data-testid="language-selector"]')).toBeNull();
    expect(body().querySelector('.lang-row')).toBeNull();
    const bodyLabels = Array.from(body().querySelectorAll('.label')).map((l) => l.textContent);
    expect(bodyLabels).not.toContain('زبان');
    expect(bodyLabels).not.toContain('Language');
    // The first settings control in the body is now the build-target label.
    expect(bodyLabels[0]).toBe(TRANSLATIONS.fa.buildWith);
  });

  it('renders compact Persian and English choices with Persian selected by default', () => {
    render(controller());
    const fa = q('[data-testid="locale-fa"]');
    const en = q('[data-testid="locale-en"]');
    expect(fa.textContent).toBe('فارسی');
    expect(en.textContent).toBe('EN');
    expect(fa.tagName).toBe('BUTTON');
    expect((fa as HTMLButtonElement).type).toBe('button');
    expect(fa.getAttribute('aria-pressed')).toBe('true');
    expect(en.getAttribute('aria-pressed')).toBe('false');
    expect(
      q('[data-testid="language-selector"]').classList.contains('language-selector--compact'),
    ).toBe(true);
  });

  it('exposes accessible group and button labels', () => {
    const c = controller();
    render(c);
    const group = q('[data-testid="language-selector"]');
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('انتخاب زبان رابط');
    expect(q('[data-testid="locale-fa"]').getAttribute('aria-label')).toBe(
      'تغییر زبان رابط به فارسی',
    );
    expect(q('[data-testid="locale-fa"]').getAttribute('lang')).toBe('fa');
    expect(q('[data-testid="locale-en"]').getAttribute('aria-label')).toBe(
      'Change interface language to English',
    );
    expect(q('[data-testid="locale-en"]').getAttribute('lang')).toBe('en');
    act(() => q('[data-testid="locale-en"]').click());
    expect(group.getAttribute('aria-label')).toBe('Select interface language');
  });
});

describe('language switching from the header', () => {
  it('switches the whole interface immediately and back', () => {
    const c = controller();
    render(c);
    const panel = q('[data-testid="panel"]');
    act(() => q('[data-testid="locale-en"]').click());
    expect(panel.getAttribute('lang')).toBe('en');
    expect(panel.getAttribute('dir')).toBe('ltr');
    expect(q('[data-testid="status"]').textContent).toBe('Inspector active');
    expect(q('[data-testid="locale-en"]').getAttribute('aria-pressed')).toBe('true');
    act(() => q('[data-testid="locale-fa"]').click());
    expect(panel.getAttribute('lang')).toBe('fa');
    expect(panel.getAttribute('dir')).toBe('rtl');
    expect(q('[data-testid="status"]').textContent).toBe('بازرس فعال است');
  });

  it('persists the locale chosen in the header', async () => {
    const data: Record<string, unknown> = {};
    const area: StorageArea = {
      get: async (keys) => {
        const out: Record<string, unknown> = {};
        for (const k of Array.isArray(keys) ? keys : [keys])
          if (k in data) out[k] = structuredClone(data[k]);
        return out;
      },
      set: async (items) => void Object.assign(data, structuredClone(items)),
    };
    vi.stubGlobal('chrome', { storage: { local: area } });
    try {
      const c = controller();
      render(c);
      act(() => q('[data-testid="locale-en"]').click());
      c.destroy(); // flushes the debounced save
      await new Promise((r) => setTimeout(r, 0));
      expect((data[STORAGE_KEY] as { locale: string }).locale).toBe('en');
      expect((await loadPreferences(area)).locale).toBe('en');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not regenerate or translate the prompt when the locale changes', () => {
    const c = controller();
    const prompt = generatePrompt(analysis, {
      detail: 'detailed',
      buildTarget: 'existing',
      customInstructions: '',
      include: DEFAULT_PREFERENCES.include,
    });
    c.store.set({ mode: 'locked', stage: 'ready', analysis, prompt });
    render(c);
    act(() => q('[data-testid="locale-en"]').click());
    expect(c.store.get().prompt).toBe(prompt);
    act(() => q('[data-testid="locale-fa"]').click());
    expect(c.store.get().prompt).toBe(prompt);
    expect(q<HTMLTextAreaElement>('textarea.prompt').value).toBe(prompt);
    expect(prompt).not.toMatch(/[؀-ۿ]/);
  });
});

describe('window controls and dragging', () => {
  it('close and minimize still work', () => {
    const onClose = vi.fn();
    const c = controller(null, onClose);
    render(c);
    act(() => q('[data-testid="minimize"]').click());
    expect(c.store.get().prefs.minimized).toBe(true);
    // Minimized header keeps brand, selector and controls usable.
    expect(header().querySelector('[data-testid="language-selector"]')).not.toBeNull();
    act(() => q('[data-testid="locale-en"]').click());
    expect(c.store.get().prefs.locale).toBe('en');
    expect(q('[data-testid="minimize"]').getAttribute('aria-label')).toBe('Expand panel');
    act(() => q('[data-testid="minimize"]').click());
    expect(c.store.get().prefs.minimized).toBe(false);
    act(() => q('[data-testid="close"]').click());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('dragging empty header space moves the panel', () => {
    render(controller());
    const panel = q('[data-testid="panel"]');
    const before = panel.style.transform;
    act(() => {
      pointer(header(), 'pointerdown', 100, 20);
      pointer(header(), 'pointermove', 60, 80);
      pointer(header(), 'pointerup', 60, 80);
    });
    expect(panel.style.transform).not.toBe(before);
  });

  it('pressing or dragging on the language selector does not drag the panel', () => {
    const c = controller();
    render(c);
    const panel = q('[data-testid="panel"]');
    const before = panel.style.transform;
    for (const target of [
      q('[data-testid="locale-en"]'),
      q('[data-testid="language-selector"]'),
      q('[data-testid="close"]'),
    ]) {
      act(() => {
        pointer(target, 'pointerdown', 100, 20);
        pointer(header(), 'pointermove', 40, 90);
        pointer(header(), 'pointerup', 40, 90);
      });
      expect(panel.style.transform).toBe(before);
    }
    expect(c.store.get().prefs.panelPosition).toBeNull();
  });
});
