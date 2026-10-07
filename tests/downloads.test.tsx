import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SectionAnalysis } from '../src/shared/types';
import type { DownloadArtifactPayload, DownloadArtifactResponse } from '../src/shared/messages';
import { isBackgroundRequest } from '../src/shared/messages';
import { TRANSLATIONS, type Locale } from '../src/shared/i18n';
import { DEFAULT_PREFERENCES } from '../src/shared/preferences';
import { downloadArtifact, type DownloadsApi } from '../src/background/downloads';
import {
  createExportSession,
  formatTimestamp,
  hostnameOf,
  sanitizeSegment,
} from '../src/core/prompt/export';
import { generatePrompt } from '../src/core/prompt/generate';
import { analyzeSection } from '../src/core/analysis';
import { InspectorController } from '../src/content/controller';
import { Panel } from '../src/content/panel/Panel';
import { $, loadFixture, testMeasurer } from './helpers';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FA = TRANSLATIONS.fa;
const EN = TRANSLATIONS.en;
// 1×1 PNG.
const PNG_BYTES = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

let pricing: SectionAnalysis;
let signup: SectionAnalysis;

beforeAll(async () => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  // The reference preview decodes the PNG; jsdom has no createImageBitmap.
  globalThis.createImageBitmap ??= (async () => ({
    width: 1,
    height: 1,
    close() {},
  })) as unknown as typeof createImageBitmap;
  loadFixture('landing.html');
  pricing = await analyzeSection($('#pricing'), { measurer: testMeasurer() });
  signup = await analyzeSection($('#signup'), { measurer: testMeasurer() });
});

/** Mock chrome.downloads that records every request. */
function mockDownloads(behavior: { reject?: string; interrupt?: string } = {}) {
  const calls: chrome.downloads.DownloadOptions[] = [];
  const listeners = new Set<(d: chrome.downloads.DownloadDelta) => void>();
  let next = 1;
  const api: DownloadsApi & { calls: typeof calls } = {
    calls,
    download: vi.fn(async (options: chrome.downloads.DownloadOptions) => {
      calls.push(options);
      if (behavior.reject) throw new Error(behavior.reject);
      const id = next++;
      setTimeout(() => {
        for (const l of listeners) {
          l(
            behavior.interrupt
              ? { id, state: { current: 'interrupted' }, error: { current: behavior.interrupt } }
              : { id, state: { current: 'complete' } },
          );
        }
      }, 0);
      return id;
    }),
    onChanged: {
      addListener: (cb) => void listeners.add(cb),
      removeListener: (cb) => void listeners.delete(cb),
    },
  };
  return api;
}

/** Decodes the data URL Chrome would receive. */
function decode(url: string): { mime: string; text: string; bytes: Uint8Array } {
  const comma = url.indexOf(',');
  const bytes = Uint8Array.from(atob(url.slice(comma + 1)), (c) => c.charCodeAt(0));
  return { mime: url.slice(5, comma), text: new TextDecoder().decode(bytes), bytes };
}

function readyController(
  api: DownloadsApi,
  analysis: SectionAnalysis = pricing,
  locale: Locale = 'en',
  downloader?: (p: DownloadArtifactPayload) => Promise<DownloadArtifactResponse>,
) {
  const c = new InspectorController({
    onClose: () => undefined,
    clipboard: { copyText: async () => undefined },
    downloader: downloader ?? ((p) => downloadArtifact(p, api, 20)),
  });
  const prefs = { ...DEFAULT_PREFERENCES, locale, include: { ...DEFAULT_PREFERENCES.include } };
  c.store.set({
    prefs,
    mode: 'locked',
    stage: 'ready',
    analysis,
    prompt: generatePrompt(analysis, {
      detail: prefs.promptDetail,
      buildTarget: prefs.buildTarget,
      customInstructions: '',
      include: prefs.include,
    }),
    reference: { blob: new Blob([PNG_BYTES], { type: 'image/png' }), width: 1, height: 1 },
    exportSession: createExportSession(analysis),
  });
  return c;
}

describe('folder and filename sanitization', () => {
  it('reduces hostnames to safe segments', () => {
    expect(sanitizeSegment('crm.karinmed.com')).toBe('crm-karinmed-com');
    expect(sanitizeSegment('../../etc/passwd')).toBe('etc-passwd');
    expect(sanitizeSegment('a\\b:c?q=1#frag')).toBe('a-b-c');
    expect(sanitizeSegment('two  spaces..and--dashes__x')).toBe('two-spaces-and-dashes_x');
    expect(sanitizeSegment('\u0000\u001f<script>')).toBe('script');
    expect(sanitizeSegment('....')).toBe('page');
    expect(sanitizeSegment('')).toBe('page');
    expect(sanitizeSegment('x'.repeat(200)).length).toBeLessThanOrEqual(60);
    expect(sanitizeSegment('مثال.ایران')).toBe('page');
  });

  it('extracts hostnames from sanitized origins', () => {
    expect(hostnameOf('https://crm.karinmed.com')).toBe('crm.karinmed.com');
    expect(hostnameOf('http://localhost:5173')).toBe('localhost');
    expect(hostnameOf('file://')).toBe('local-file');
    expect(hostnameOf('garbage')).toBe('page');
  });

  it('formats a deterministic local timestamp', () => {
    expect(formatTimestamp(new Date(2026, 9, 7, 6, 36, 55))).toBe('2026-10-07-063655');
    expect(formatTimestamp(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02-030405');
  });

  it('names the folder from the hostname and the capture time, not the click time', () => {
    const captured = new Date(2026, 9, 7, 6, 36, 55);
    const a = {
      ...pricing,
      metadata: {
        ...pricing.metadata,
        sourceOrigin: 'https://crm.karinmed.com',
        capturedAt: captured.toISOString(),
      },
    };
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2030, 0, 1));
    try {
      const s = createExportSession(a);
      expect(s.relativeDirectory).toBe('AJ-Lens/crm-karinmed-com-2026-10-07-063655');
      expect(s.id).toBe('crm-karinmed-com-2026-10-07-063655');
      expect(s.hostname).toBe('crm.karinmed.com');
    } finally {
      vi.useRealTimers();
    }
  });

  it('never lets a page control the download path', () => {
    const s = createExportSession({
      ...pricing,
      metadata: { ...pricing.metadata, sourceOrigin: 'https://..%2f..%2fevil' },
    });
    expect(s.relativeDirectory).toMatch(/^AJ-Lens\/[A-Za-z0-9][A-Za-z0-9_-]*$/);
    expect(s.relativeDirectory).not.toContain('..');
  });
});

describe('service worker downloadArtifact (chrome.downloads)', () => {
  const dir = 'AJ-Lens/crm-karinmed-com-2026-10-07-063655';

  it('sends the complete request: relative path, saveAs false, uniquify', async () => {
    const api = mockDownloads();
    const res = await downloadArtifact(
      {
        artifactType: 'prompt',
        directory: dir,
        filename: 'prompt.md',
        mimeType: 'text/markdown;charset=utf-8',
        content: { kind: 'text', value: '# Héllo قیمت\n\n- a\n' },
      },
      api,
      20,
    );
    expect(res).toEqual({ ok: true, downloadId: 1, relativePath: `${dir}/prompt.md` });
    expect(api.calls).toHaveLength(1);
    const call = api.calls[0];
    expect(call).toEqual({
      url: expect.stringMatching(/^data:text\/markdown;charset=utf-8;base64,/),
      filename: `${dir}/prompt.md`,
      saveAs: false,
      conflictAction: 'uniquify',
    });
    expect(decode(call.url).text).toBe('# Héllo قیمت\n\n- a\n');
  });

  it('rejects invalid analysis JSON before calling Chrome', async () => {
    const api = mockDownloads();
    const res = await downloadArtifact(
      {
        artifactType: 'analysis',
        directory: dir,
        filename: 'analysis.json',
        mimeType: 'application/json;charset=utf-8',
        content: { kind: 'text', value: '{oops' },
      },
      api,
    );
    expect(res).toMatchObject({ ok: false, code: 'invalid-data' });
    expect(api.calls).toHaveLength(0);
  });

  it('maps Chrome errors, cancellations and a missing permission', async () => {
    const payload: DownloadArtifactPayload = {
      artifactType: 'prompt',
      directory: dir,
      filename: 'prompt.md',
      mimeType: 'text/markdown;charset=utf-8',
      content: { kind: 'text', value: 'x' },
    };
    expect(
      await downloadArtifact(payload, mockDownloads({ reject: 'Invalid filename' }), 20),
    ).toMatchObject({ ok: false, code: 'filename' });
    expect(
      await downloadArtifact(payload, mockDownloads({ reject: 'Download failed' }), 20),
    ).toMatchObject({ ok: false, code: 'rejected' });
    expect(
      await downloadArtifact(payload, mockDownloads({ interrupt: 'USER_CANCELED' }), 50),
    ).toMatchObject({ ok: false, code: 'cancelled' });
    expect(
      await downloadArtifact(payload, mockDownloads({ interrupt: 'FILE_NO_SPACE' }), 50),
    ).toMatchObject({ ok: false, code: 'rejected', error: 'FILE_NO_SPACE' });
    expect(await downloadArtifact(payload, undefined)).toMatchObject({
      ok: false,
      code: 'permission',
    });
  });

  it('only accepts validated requests (no arbitrary paths)', () => {
    const ok = {
      artifactType: 'analysis',
      directory: dir,
      filename: 'analysis.json',
      mimeType: 'application/json;charset=utf-8',
      content: { kind: 'text', value: '{}' },
    };
    expect(isBackgroundRequest({ type: 'aj-lens/download-artifact', payload: ok })).toBe(true);
    expect(
      isBackgroundRequest({
        type: 'aj-lens/download-artifact',
        payload: { ...ok, directory: 'AJ-Lens/../x' },
      }),
    ).toBe(false);
    expect(
      isBackgroundRequest({
        type: 'aj-lens/download-artifact',
        payload: { ...ok, directory: '/Users/me' },
      }),
    ).toBe(false);
  });
});

describe('controller exports (end to end with mocked chrome.downloads)', () => {
  it('saves all three artifacts into one shared capture folder', async () => {
    const api = mockDownloads();
    const c = readyController(api);
    const dir = c.store.get().exportSession!.relativeDirectory;
    await c.saveArtifact('reference');
    await c.saveArtifact('prompt');
    await c.saveArtifact('analysis');
    expect(api.calls.map((x) => x.filename)).toEqual([
      `${dir}/reference.png`,
      `${dir}/prompt.md`,
      `${dir}/analysis.json`,
    ]);
    for (const call of api.calls) {
      expect(call.saveAs).toBe(false);
      expect(call.conflictAction).toBe('uniquify');
    }
    expect(dir).toMatch(/^AJ-Lens\/[A-Za-z0-9-]+-\d{4}-\d{2}-\d{2}-\d{6}$/);
  });

  it('exports a valid, non-empty PNG', async () => {
    const api = mockDownloads();
    await readyController(api).saveArtifact('reference');
    const { mime, bytes } = decode(api.calls[0].url);
    expect(mime).toBe('image/png;base64');
    expect(Array.from(bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(bytes.length).toBe(PNG_BYTES.length);
  });

  it('exports the complete detailed and compact prompts with Markdown intact', async () => {
    const api = mockDownloads();
    const c = readyController(api);
    const detailed = c.store.get().prompt;
    await c.saveArtifact('prompt');
    c.setPrefs({ promptDetail: 'compact' });
    const compact = c.store.get().prompt;
    await new Promise((r) => setTimeout(r, 2100)); // feedback timer resets; same session
    await c.saveArtifact('prompt');
    const [d, k] = api.calls.map((x) => decode(x.url));
    expect(d.mime).toBe('text/markdown;charset=utf-8;base64');
    expect(d.text).toContain(detailed.trim());
    expect(k.text).toContain(compact.trim());
    expect(d.text).toContain('\n# Assumptions and Uncertainties\n');
    expect(d.text).toMatch(/```css\n[\s\S]+?\n```/);
    expect(d.text).toContain('\n- [ ] ');
    expect(d.text).not.toMatch(/Save prompt\.md|RECONSTRUCTION PROMPT|Copy full prompt/);
    // Mode switch did not create a new folder.
    expect(api.calls[0].filename).toBe(api.calls[1].filename);
  });

  it('exports valid two-space formatted JSON with the schema version', async () => {
    const api = mockDownloads();
    await readyController(api).saveArtifact('analysis');
    const { mime, text } = decode(api.calls[0].url);
    expect(mime).toBe('application/json;charset=utf-8;base64');
    const json = JSON.parse(text);
    expect(json.schemaVersion).toBe('1.0');
    expect(text).toBe(`${JSON.stringify(json, null, 2)}\n`);
  });

  it('never exports sensitive fixture values', async () => {
    const api = mockDownloads();
    const c = readyController(api, signup);
    await c.saveArtifact('prompt');
    await c.saveArtifact('analysis');
    for (const call of api.calls) {
      const { text } = decode(call.url);
      expect(text).not.toContain('hunter2-secret');
      expect(text).not.toContain('tok_9f8e7d6c5b4a3210fedcba');
      expect(text).not.toContain('hello@acme.test');
    }
  });

  it('keeps the folder across mode, language and copy; a new capture gets a new folder', async () => {
    const c = readyController(mockDownloads());
    const first = c.store.get().exportSession!.id;
    c.setPrefs({ promptDetail: 'compact' });
    c.setPrefs({ locale: 'fa' });
    await c.copyPrompt();
    expect(c.store.get().exportSession!.id).toBe(first);
    // A new capture (different time / section) produces a new session.
    const later = {
      ...signup,
      metadata: {
        ...signup.metadata,
        capturedAt: new Date(Date.parse(pricing.metadata.capturedAt) + 61_000).toISOString(),
      },
    };
    expect(createExportSession(later).id).not.toBe(first);
    // Unlocking (explicit reset) drops the session.
    c.unlock();
    expect(c.store.get().exportSession).toBeNull();
  });

  it('re-analysis of a locked section starts a new export session', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(2026, 9, 7, 6, 36, 55));
      const c = readyController(mockDownloads());
      (c as unknown as { target: Element }).target = $('#pricing');
      c.refresh();
      await vi.waitFor(() => expect(c.store.get().captureChoice).not.toBeNull());
      c.chooseCapture('cancel');
      await vi.waitFor(() => expect(c.store.get().stage).toBe('ready'));
      const first = c.store.get().exportSession!.relativeDirectory;
      vi.setSystemTime(new Date(2026, 9, 7, 6, 40, 1));
      (c as unknown as { target: Element }).target = $('#features');
      c.refresh();
      await vi.waitFor(() => expect(c.store.get().captureChoice).not.toBeNull());
      c.chooseCapture('cancel');
      await vi.waitFor(() => expect(c.store.get().stage).toBe('ready'));
      const second = c.store.get().exportSession!.relativeDirectory;
      expect(first).toMatch(/-2026-10-07-063655$/);
      expect(second).toMatch(/-2026-10-07-064001$/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('export buttons in the panel', () => {
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
  const btn = (type: string) =>
    container.querySelector<HTMLButtonElement>(`[data-testid="save-${type}"]`)!;
  const status = () => container.querySelector('[data-testid="export-live"]')!.textContent ?? '';

  it('stays disabled until each artifact is ready', () => {
    const c = readyController(mockDownloads());
    c.store.set({ stage: 'layout', prompt: '', exportSession: null });
    render(c);
    for (const t of ['prompt', 'reference', 'analysis']) expect(btn(t).disabled).toBe(true);
    act(() => {
      c.store.set({
        stage: 'ready',
        prompt: 'x',
        exportSession: createExportSession(pricing),
        reference: null,
      });
    });
    expect(btn('prompt').disabled).toBe(false);
    expect(btn('analysis').disabled).toBe(false);
    expect(btn('reference').disabled).toBe(true); // no screenshot (e.g. capture cancelled)
  });

  it('prevents duplicate clicks while pending and shows per-button states (English)', async () => {
    let resolve!: (r: DownloadArtifactResponse) => void;
    const downloader = vi.fn(() => new Promise<DownloadArtifactResponse>((r) => (resolve = r)));
    const c = readyController(mockDownloads(), pricing, 'en', downloader);
    render(c);
    await act(async () => {
      btn('prompt').click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(btn('prompt').textContent).toBe('Saving prompt…');
    expect(btn('prompt').disabled).toBe(true);
    expect(btn('prompt').getAttribute('aria-busy')).toBe('true');
    expect(btn('analysis').disabled).toBe(false); // independent
    await act(async () => {
      btn('prompt').click();
      await c.saveArtifact('prompt');
    });
    expect(downloader).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ ok: true, downloadId: 7, relativePath: 'AJ-Lens/x-2026-10-07-063655/prompt.md' });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(btn('prompt').textContent).toBe('Prompt saved ✓');
    expect(status()).toBe('Saved to Downloads/AJ-Lens/x-2026-10-07-063655/prompt.md');
    expect(container.querySelector('[data-testid="show-in-downloads"]')!.textContent).toBe(
      'Show in downloads',
    );
  });

  it('restores the normal label after about two seconds', async () => {
    vi.useFakeTimers();
    try {
      const c = readyController(mockDownloads(), pricing, 'en', async () => ({
        ok: true,
        downloadId: 1,
        relativePath: 'AJ-Lens/x/analysis.json',
      }));
      render(c);
      await act(async () => {
        await c.saveArtifact('analysis');
      });
      expect(btn('analysis').textContent).toBe('Analysis saved ✓');
      act(() => vi.advanceTimersByTime(2000));
      expect(btn('analysis').textContent).toBe('Save analysis.json');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows Persian pending, success and failure messages', async () => {
    let resolve!: (r: DownloadArtifactResponse) => void;
    const c = readyController(
      mockDownloads(),
      pricing,
      'fa',
      () => new Promise((r) => (resolve = r)),
    );
    render(c);
    await act(async () => {
      btn('reference').click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(btn('reference').textContent).toBe(FA.savingImage);
    await act(async () => {
      await vi.waitFor(() => {
        if (typeof resolve !== 'function') throw new Error('downloader not called yet');
      });
      resolve({ ok: true, downloadId: 2, relativePath: 'AJ-Lens/x/reference.png' });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(btn('reference').textContent).toBe('تصویر ذخیره شد ✓');
    expect(status()).toContain('در Downloads/');
    expect(container.querySelector('[data-testid="show-in-downloads"]')!.textContent).toBe(
      'نمایش در دانلودها',
    );

    const failing = readyController(mockDownloads(), pricing, 'fa', async () => ({
      ok: false,
      code: 'cancelled',
      error: 'USER_CANCELED',
    }));
    act(() => root.render(createElement(Panel, { controller: failing })));
    await act(async () => {
      await failing.saveArtifact('analysis');
    });
    expect(status()).toContain('ذخیره تحلیل انجام نشد.');
    expect(status()).toContain(FA.downloadErrorCancelled);
    expect(status()).toContain('USER_CANCELED');
    expect(btn('analysis').getAttribute('data-state')).toBe('failed');
  });

  it('shows English failure messages for each artifact and keeps the panel open', async () => {
    const onClose = vi.fn();
    const c = new InspectorController({
      onClose,
      clipboard: { copyText: async () => undefined },
      downloader: async () => ({
        ok: false,
        code: 'unavailable',
        error: 'Extension context invalidated.',
      }),
    });
    const ready = readyController(mockDownloads());
    c.store.set({ ...ready.store.get() });
    render(c);
    for (const [type, key] of [
      ['reference', 'saveImageFailed'],
      ['prompt', 'savePromptFailed'],
      ['analysis', 'saveAnalysisFailed'],
    ] as const) {
      await act(async () => {
        await c.saveArtifact(type);
      });
      expect(status()).toContain(EN[key]);
      expect(status()).toContain(EN.downloadErrorUnavailable);
    }
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="panel"]')).not.toBeNull();
  });

  it('reports serialization failures without calling Chrome', async () => {
    const api = mockDownloads();
    const c = readyController(api);
    c.store.set({
      reference: { blob: new Blob(['not a png'], { type: 'text/plain' }), width: 1, height: 1 },
    });
    await c.saveArtifact('reference');
    expect(api.calls).toHaveLength(0);
    expect(c.store.get().exportResult).toMatchObject({ ok: false, code: 'serialization' });
  });
});
