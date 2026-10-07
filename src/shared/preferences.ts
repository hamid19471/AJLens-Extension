/** User preferences — the only data AJ Lens persists. */
import { DEFAULT_LOCALE, isLocale, type Locale, type MessageKey } from './i18n';

export type BuildTarget =
  | 'existing'
  | 'react'
  | 'nextjs'
  | 'vue'
  | 'nuxt'
  | 'svelte'
  | 'astro'
  | 'html'
  | 'tailwind'
  | 'custom';

export const BUILD_TARGETS: { value: BuildTarget; label: string }[] = [
  { value: 'existing', label: 'Follow the existing project stack' },
  { value: 'react', label: 'React' },
  { value: 'nextjs', label: 'Next.js' },
  { value: 'vue', label: 'Vue' },
  { value: 'nuxt', label: 'Nuxt' },
  { value: 'svelte', label: 'Svelte' },
  { value: 'astro', label: 'Astro' },
  { value: 'html', label: 'HTML/CSS/JavaScript' },
  { value: 'tailwind', label: 'Tailwind CSS' },
  { value: 'custom', label: 'Custom instructions' },
];

export type PromptDetail = 'detailed' | 'compact';

export interface IncludeOptions {
  visibleText: boolean;
  assetUrls: boolean;
  domSummary: boolean;
  cssEvidence: boolean;
  accessibility: boolean;
  interactions: boolean;
  responsive: boolean;
  customProperties: boolean;
}

/** Dictionary keys for the include/exclude checkboxes (see shared/i18n.ts). */
export const INCLUDE_MESSAGE_KEYS = {
  visibleText: 'includeVisibleText',
  assetUrls: 'includeAssetUrls',
  domSummary: 'includeDomSummary',
  cssEvidence: 'includeCssEvidence',
  accessibility: 'includeAccessibility',
  interactions: 'includeInteractions',
  responsive: 'includeResponsive',
  customProperties: 'includeCustomProperties',
} as const satisfies Record<keyof IncludeOptions, MessageKey>;

export interface PanelPosition {
  x: number;
  y: number;
}

export interface Preferences {
  version: 1;
  panelPosition: PanelPosition | null;
  minimized: boolean;
  buildTarget: BuildTarget;
  customInstructions: string;
  promptDetail: PromptDetail;
  include: IncludeOptions;
  /** Interface language. Persian unless the user explicitly picks English. */
  locale: Locale;
}

export const DEFAULT_INCLUDE: IncludeOptions = {
  visibleText: true,
  assetUrls: true,
  domSummary: true,
  cssEvidence: true,
  accessibility: true,
  interactions: true,
  responsive: true,
  customProperties: true,
};

export const DEFAULT_PREFERENCES: Preferences = {
  version: 1,
  panelPosition: null,
  minimized: false,
  buildTarget: 'existing',
  customInstructions: '',
  promptDetail: 'detailed',
  include: DEFAULT_INCLUDE,
  locale: DEFAULT_LOCALE,
};

export const STORAGE_KEY = 'aj-lens.preferences';
/**
 * Keys written by releases published as "Section Lens". Kept only so existing users'
 * preferences can be migrated to STORAGE_KEY; nothing writes to them any more.
 */
export const LEGACY_STORAGE_KEYS = ['sectionLens.preferences'] as const;
const MAX_CUSTOM_INSTRUCTIONS = 4000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Coerces untrusted stored data into a valid Preferences object, falling back to defaults per field. */
export function normalizePreferences(raw: unknown): Preferences {
  const prefs: Preferences = {
    ...DEFAULT_PREFERENCES,
    include: { ...DEFAULT_INCLUDE },
  };
  if (!isRecord(raw)) return prefs;

  const pos = raw.panelPosition;
  if (isRecord(pos) && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    prefs.panelPosition = { x: Math.round(Number(pos.x)), y: Math.round(Number(pos.y)) };
  }
  if (typeof raw.minimized === 'boolean') prefs.minimized = raw.minimized;
  if (BUILD_TARGETS.some((t) => t.value === raw.buildTarget)) {
    prefs.buildTarget = raw.buildTarget as BuildTarget;
  }
  if (typeof raw.customInstructions === 'string') {
    prefs.customInstructions = raw.customInstructions.slice(0, MAX_CUSTOM_INSTRUCTIONS);
  }
  if (raw.promptDetail === 'detailed' || raw.promptDetail === 'compact') {
    prefs.promptDetail = raw.promptDetail;
  }
  if (isLocale(raw.locale)) prefs.locale = raw.locale;
  if (isRecord(raw.include)) {
    for (const key of Object.keys(DEFAULT_INCLUDE) as (keyof IncludeOptions)[]) {
      const v = raw.include[key];
      if (typeof v === 'boolean') prefs.include[key] = v;
    }
  }
  return prefs;
}

export interface StorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove?(keys: string | string[]): Promise<void>;
}

export type MigrationResult = 'none' | 'migrated' | 'kept-existing' | 'failed';

/**
 * Idempotent migration from legacy keys to STORAGE_KEY.
 * - Copies legacy preferences only when no value exists under the new key.
 * - Verifies the new value was written before removing legacy keys.
 * - Safe to run on every load; a second run finds nothing to do.
 */
export async function migratePreferences(
  area: StorageArea | null = defaultArea(),
): Promise<MigrationResult> {
  if (!area) return 'none';
  const legacyKeys = [...LEGACY_STORAGE_KEYS];
  try {
    const stored = await area.get([STORAGE_KEY, ...legacyKeys]);
    const legacyKey = legacyKeys.find((k) => stored[k] !== undefined);
    if (!legacyKey) return 'none';
    let result: MigrationResult = 'kept-existing';
    if (stored[STORAGE_KEY] === undefined) {
      await area.set({ [STORAGE_KEY]: normalizePreferences(stored[legacyKey]) });
      const check = await area.get(STORAGE_KEY);
      if (check[STORAGE_KEY] === undefined) return 'failed';
      result = 'migrated';
    }
    // The new key is confirmed present, so the legacy copies can go.
    await area.remove?.(legacyKeys.filter((k) => stored[k] !== undefined));
    return result;
  } catch {
    // Leave legacy data untouched; the next load retries.
    return 'failed';
  }
}

/**
 * Idempotent: stores the default Persian locale for installs that have no saved locale yet.
 * Never infers English from the browser, and preserves every other stored field as-is.
 */
export async function migrateLocale(area: StorageArea | null = defaultArea()): Promise<boolean> {
  if (!area) return false;
  try {
    const stored = (await area.get(STORAGE_KEY))[STORAGE_KEY];
    if (isRecord(stored) && isLocale(stored.locale)) return false;
    const next = isRecord(stored)
      ? { ...stored, locale: DEFAULT_LOCALE }
      : normalizePreferences(null);
    await area.set({ [STORAGE_KEY]: next });
    return true;
  } catch {
    return false;
  }
}

function defaultArea(): StorageArea | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  return chrome.storage.local as unknown as StorageArea;
}

export async function loadPreferences(
  area: StorageArea | null = defaultArea(),
): Promise<Preferences> {
  if (!area) return normalizePreferences(null);
  await migratePreferences(area);
  await migrateLocale(area);
  try {
    const stored = await area.get(STORAGE_KEY);
    return normalizePreferences(stored[STORAGE_KEY]);
  } catch {
    return normalizePreferences(null);
  }
}

export async function savePreferences(
  prefs: Preferences,
  area: StorageArea | null = defaultArea(),
): Promise<boolean> {
  if (!area) return true;
  try {
    await area.set({ [STORAGE_KEY]: normalizePreferences(prefs) });
    return true;
  } catch {
    // Storage quota or context invalidation — the caller shows a localized notice.
    return false;
  }
}

/** Reads only the saved interface locale (used by the service worker). */
export async function loadLocale(area: StorageArea | null = defaultArea()): Promise<Locale> {
  if (!area) return DEFAULT_LOCALE;
  try {
    const stored = (await area.get(STORAGE_KEY))[STORAGE_KEY];
    return isRecord(stored) && isLocale(stored.locale) ? stored.locale : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}
