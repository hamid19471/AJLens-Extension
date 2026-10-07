import { describe, expect, it } from 'vitest';
import {
  isBackgroundRequest,
  isCaptureResponse,
  isContentRequest,
  isDownloadArtifactResponse,
} from '../src/shared/messages';
import {
  DEFAULT_PREFERENCES,
  LEGACY_STORAGE_KEYS,
  STORAGE_KEY,
  loadPreferences,
  migratePreferences,
  normalizePreferences,
  savePreferences,
} from '../src/shared/preferences';
import { restrictionReason } from '../src/background/restricted';

describe('message validation', () => {
  it('accepts valid content requests only', () => {
    expect(isContentRequest({ type: 'aj-lens/toggle' })).toBe(true);
    expect(isContentRequest({ type: 'aj-lens/ping' })).toBe(true);
    expect(isContentRequest({ type: 'aj-lens/capture-visible-tab' })).toBe(false);
    expect(isContentRequest(null)).toBe(false);
    expect(isContentRequest('aj-lens/toggle')).toBe(false);
  });

  it('validates background requests', () => {
    expect(isBackgroundRequest({ type: 'aj-lens/capture-visible-tab' })).toBe(true);
    expect(isBackgroundRequest({ type: 'aj-lens/state', active: true })).toBe(true);
    expect(isBackgroundRequest({ type: 'aj-lens/state', active: 'yes' })).toBe(false);
    expect(isBackgroundRequest({ type: 'unknown' })).toBe(false);
  });

  it('validates download-artifact requests strictly', () => {
    const base = {
      artifactType: 'prompt',
      directory: 'AJ-Lens/crm-karinmed-com-2026-10-07-063655',
      filename: 'prompt.md',
      mimeType: 'text/markdown;charset=utf-8',
      content: { kind: 'text', value: '# Reconstruction Task' },
    };
    const req = (payload: Record<string, unknown>) =>
      isBackgroundRequest({ type: 'aj-lens/download-artifact', payload: { ...base, ...payload } });
    expect(req({})).toBe(true);
    // Path traversal, absolute paths and foreign roots are rejected.
    expect(req({ directory: 'AJ-Lens/../../evil' })).toBe(false);
    expect(req({ directory: '/Users/me/Desktop' })).toBe(false);
    expect(req({ directory: 'C:\\Windows' })).toBe(false);
    expect(req({ directory: 'Other/x' })).toBe(false);
    expect(req({ directory: 'AJ-Lens/a/b' })).toBe(false);
    expect(req({ directory: 'AJ-Lens/a.b' })).toBe(false);
    // Filename and MIME are fixed per artifact type.
    expect(req({ filename: '../evil.sh' })).toBe(false);
    expect(req({ filename: 'analysis.json' })).toBe(false);
    expect(req({ mimeType: 'text/html' })).toBe(false);
    expect(req({ artifactType: 'script' })).toBe(false);
    expect(req({ content: { kind: 'text', value: '' } })).toBe(false);
    expect(req({ content: { kind: 'dataUrl', value: 'https://evil.example/x' } })).toBe(false);
    // Screenshots must be PNG data URLs.
    const png = {
      artifactType: 'reference',
      filename: 'reference.png',
      mimeType: 'image/png',
    };
    expect(
      req({ ...png, content: { kind: 'dataUrl', value: 'data:image/png;base64,iVBORw0KGgoAAAA' } }),
    ).toBe(true);
    expect(req({ ...png, content: { kind: 'dataUrl', value: 'data:image/png;base64,AAAA' } })).toBe(
      false,
    );
    expect(
      req({ ...png, content: { kind: 'dataUrl', value: 'data:image/svg+xml;base64,PHN2Zz4=' } }),
    ).toBe(false);
    expect(req({ ...png, content: { kind: 'text', value: 'x' } })).toBe(false);
    expect(isBackgroundRequest({ type: 'aj-lens/show-download', downloadId: 4 })).toBe(true);
    expect(isBackgroundRequest({ type: 'aj-lens/show-download', downloadId: -1 })).toBe(false);
    expect(
      isBackgroundRequest({ type: 'aj-lens/download', filename: 'a.md', dataUrl: 'data:' }),
    ).toBe(false);
  });

  it('validates responses', () => {
    expect(isCaptureResponse({ ok: true, dataUrl: 'data:image/png;base64,AA' })).toBe(true);
    expect(isCaptureResponse({ ok: true, dataUrl: 'https://x' })).toBe(false);
    expect(isCaptureResponse({ ok: false, error: 'nope' })).toBe(true);
    expect(
      isDownloadArtifactResponse({ ok: true, downloadId: 3, relativePath: 'AJ-Lens/x/prompt.md' }),
    ).toBe(true);
    expect(isDownloadArtifactResponse({ ok: true, downloadId: 3 })).toBe(false);
    expect(
      isDownloadArtifactResponse({ ok: false, code: 'cancelled', error: 'USER_CANCELED' }),
    ).toBe(true);
    expect(isDownloadArtifactResponse({ ok: false, error: 'x' })).toBe(false);
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
    await expect(savePreferences(DEFAULT_PREFERENCES, broken)).resolves.toBe(false);
    expect(await loadPreferences(null)).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('restricted pages', () => {
  it('explains pages Chrome does not allow', () => {
    expect(restrictionReason('chrome://extensions')).toBe('restrictedBrowser');
    expect(restrictionReason('edge://settings')).toBe('restrictedBrowser');
    expect(restrictionReason('chrome-extension://abc/page.html')).toBe('restrictedExtension');
    expect(restrictionReason('https://chromewebstore.google.com/detail/x')).toBe(
      'restrictedBrowser',
    );
    expect(restrictionReason('https://chrome.google.com/webstore/category')).toBe(
      'restrictedBrowser',
    );
  });

  it('allows normal pages', () => {
    expect(restrictionReason('https://example.com/')).toBeNull();
    expect(restrictionReason('')).toBeNull();
    expect(restrictionReason('file:///Users/me/page.html')).toBeNull();
  });
});

describe('legacy storage migration', () => {
  const LEGACY = 'sectionLens.preferences';
  const legacyPrefs = {
    version: 1,
    panelPosition: { x: 120, y: 48 },
    minimized: true,
    buildTarget: 'nextjs',
    customInstructions: 'Use our Card component.',
    promptDetail: 'compact',
    include: { visibleText: false, assetUrls: true, domSummary: false },
  };

  function memoryArea(
    initial: Record<string, unknown>,
    opts: { failSet?: boolean; dropWrites?: boolean } = {},
  ) {
    const data: Record<string, unknown> = structuredClone(initial);
    const area = {
      data,
      get: async (keys: string | string[]) => {
        const out: Record<string, unknown> = {};
        for (const k of Array.isArray(keys) ? keys : [keys])
          if (k in data) out[k] = structuredClone(data[k]);
        return out;
      },
      set: async (items: Record<string, unknown>) => {
        if (opts.failSet) throw new Error('quota');
        if (!opts.dropWrites) Object.assign(data, structuredClone(items));
      },
      remove: async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
      },
    };
    return area;
  }

  it('copies every legacy preference to the new key, then removes the legacy key', async () => {
    const area = memoryArea({ [LEGACY]: legacyPrefs });
    expect(await migratePreferences(area)).toBe('migrated');
    expect(area.data[LEGACY]).toBeUndefined();
    const prefs = await loadPreferences(area);
    expect(prefs.panelPosition).toEqual({ x: 120, y: 48 });
    expect(prefs.minimized).toBe(true);
    expect(prefs.buildTarget).toBe('nextjs');
    expect(prefs.customInstructions).toBe('Use our Card component.');
    expect(prefs.promptDetail).toBe('compact');
    expect(prefs.include.visibleText).toBe(false);
    expect(prefs.include.domSummary).toBe(false);
    expect(prefs.include.assetUrls).toBe(true);
  });

  it('never overwrites values already stored under the new key', async () => {
    const area = memoryArea({
      [LEGACY]: legacyPrefs,
      [STORAGE_KEY]: { ...DEFAULT_PREFERENCES, buildTarget: 'svelte' },
    });
    expect(await migratePreferences(area)).toBe('kept-existing');
    expect((await loadPreferences(area)).buildTarget).toBe('svelte');
    expect(area.data[LEGACY]).toBeUndefined();
  });

  it('is idempotent', async () => {
    const area = memoryArea({ [LEGACY]: legacyPrefs });
    await migratePreferences(area);
    const snapshot = structuredClone(area.data);
    expect(await migratePreferences(area)).toBe('none');
    expect(await migratePreferences(area)).toBe('none');
    expect(area.data).toEqual(snapshot);
  });

  it('keeps legacy data when the new value cannot be written', async () => {
    const failing = memoryArea({ [LEGACY]: legacyPrefs }, { failSet: true });
    expect(await migratePreferences(failing)).toBe('failed');
    expect(failing.data[LEGACY]).toEqual(legacyPrefs);
    const dropped = memoryArea({ [LEGACY]: legacyPrefs }, { dropWrites: true });
    expect(await migratePreferences(dropped)).toBe('failed');
    expect(dropped.data[LEGACY]).toEqual(legacyPrefs);
  });

  it('does nothing for fresh installs', async () => {
    const area = memoryArea({});
    expect(await migratePreferences(area)).toBe('none');
    expect(area.data).toEqual({});
    expect(await migratePreferences(null)).toBe('none');
  });

  it('only reads the documented legacy key', () => {
    expect(LEGACY_STORAGE_KEYS).toEqual([LEGACY]);
    expect(STORAGE_KEY).toBe('aj-lens.preferences');
  });
});
