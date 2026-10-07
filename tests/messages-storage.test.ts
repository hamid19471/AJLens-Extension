import { describe, expect, it } from 'vitest';
import {
  isBackgroundRequest,
  isCaptureResponse,
  isContentRequest,
  isDownloadResponse,
} from '../src/shared/messages';
import {
  DEFAULT_PREFERENCES,
  STORAGE_KEY,
  loadPreferences,
  normalizePreferences,
  savePreferences,
} from '../src/shared/preferences';
import { restrictionReason } from '../src/background/restricted';

describe('message validation', () => {
  it('accepts valid content requests only', () => {
    expect(isContentRequest({ type: 'sl/toggle' })).toBe(true);
    expect(isContentRequest({ type: 'sl/ping' })).toBe(true);
    expect(isContentRequest({ type: 'sl/capture-visible-tab' })).toBe(false);
    expect(isContentRequest(null)).toBe(false);
    expect(isContentRequest('sl/toggle')).toBe(false);
  });

  it('validates background requests', () => {
    expect(isBackgroundRequest({ type: 'sl/capture-visible-tab' })).toBe(true);
    expect(isBackgroundRequest({ type: 'sl/state', active: true })).toBe(true);
    expect(isBackgroundRequest({ type: 'sl/state', active: 'yes' })).toBe(false);
    expect(isBackgroundRequest({ type: 'unknown' })).toBe(false);
  });

  it('validates download filenames and data URLs', () => {
    const dataUrl = 'data:text/markdown;charset=utf-8;base64,aGk=';
    expect(
      isBackgroundRequest({
        type: 'sl/download',
        filename: 'section-lens/a.com-hero/reconstruction-prompt.md',
        dataUrl,
      }),
    ).toBe(true);
    expect(isBackgroundRequest({ type: 'sl/download', filename: '../evil.sh', dataUrl })).toBe(
      false,
    );
    expect(isBackgroundRequest({ type: 'sl/download', filename: '/etc/passwd', dataUrl })).toBe(
      false,
    );
    expect(
      isBackgroundRequest({
        type: 'sl/download',
        filename: 'a.md',
        dataUrl: 'https://evil.example/x',
      }),
    ).toBe(false);
    expect(
      isBackgroundRequest({
        type: 'sl/download',
        filename: 'a.png',
        dataUrl: 'data:image/png;base64,AAAA',
      }),
    ).toBe(true);
  });

  it('validates responses', () => {
    expect(isCaptureResponse({ ok: true, dataUrl: 'data:image/png;base64,AA' })).toBe(true);
    expect(isCaptureResponse({ ok: true, dataUrl: 'https://x' })).toBe(false);
    expect(isCaptureResponse({ ok: false, error: 'nope' })).toBe(true);
    expect(isDownloadResponse({ ok: true, downloadId: 3 })).toBe(true);
    expect(isDownloadResponse({ ok: true })).toBe(false);
  });
});

describe('storage defaults', () => {
  it('returns defaults for missing or corrupt data', () => {
    expect(normalizePreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
    expect(normalizePreferences('garbage')).toEqual(DEFAULT_PREFERENCES);
    expect(
      normalizePreferences({ buildTarget: 'cobol', promptDetail: 'huge', minimized: 'yes' }),
    ).toEqual(DEFAULT_PREFERENCES);
  });

  it('keeps valid fields and merges include options', () => {
    const p = normalizePreferences({
      panelPosition: { x: 10.6, y: 20.2 },
      minimized: true,
      buildTarget: 'vue',
      customInstructions: 'x'.repeat(5000),
      promptDetail: 'compact',
      include: { visibleText: false, bogus: true },
    });
    expect(p.panelPosition).toEqual({ x: 11, y: 20 });
    expect(p.minimized).toBe(true);
    expect(p.buildTarget).toBe('vue');
    expect(p.customInstructions).toHaveLength(4000);
    expect(p.promptDetail).toBe('compact');
    expect(p.include.visibleText).toBe(false);
    expect(p.include.assetUrls).toBe(true);
    expect('bogus' in p.include).toBe(false);
  });

  it('does not share default objects between calls', () => {
    const a = normalizePreferences(null);
    a.include.visibleText = false;
    expect(normalizePreferences(null).include.visibleText).toBe(true);
  });

  it('round-trips through a storage area and survives failures', async () => {
    const data: Record<string, unknown> = {};
    const area = {
      get: async (k: string) => ({ [k]: data[k] }),
      set: async (items: Record<string, unknown>) => void Object.assign(data, items),
    };
    await savePreferences({ ...DEFAULT_PREFERENCES, buildTarget: 'astro' }, area);
    expect((data[STORAGE_KEY] as { buildTarget: string }).buildTarget).toBe('astro');
    expect((await loadPreferences(area)).buildTarget).toBe('astro');
    const broken = {
      get: async () => Promise.reject(new Error('x')),
      set: async () => Promise.reject(new Error('x')),
    };
    expect(await loadPreferences(broken)).toEqual(DEFAULT_PREFERENCES);
    await expect(savePreferences(DEFAULT_PREFERENCES, broken)).resolves.toBeUndefined();
    expect(await loadPreferences(null)).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('restricted pages', () => {
  it('explains pages Chrome does not allow', () => {
    expect(restrictionReason('chrome://extensions')).toMatch(/Browser pages/);
    expect(restrictionReason('edge://settings')).toMatch(/Browser pages/);
    expect(restrictionReason('chrome-extension://abc/page.html')).toMatch(/Extension pages/);
    expect(restrictionReason('https://chromewebstore.google.com/detail/x')).toMatch(/Web Store/);
    expect(restrictionReason('https://chrome.google.com/webstore/category')).toMatch(/Web Store/);
  });

  it('allows normal pages', () => {
    expect(restrictionReason('https://example.com/')).toBeNull();
    expect(restrictionReason('')).toBeNull();
    expect(restrictionReason('file:///Users/me/page.html')).toBeNull();
  });
});
