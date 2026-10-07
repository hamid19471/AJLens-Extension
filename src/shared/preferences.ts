/** User preferences — the only data Section Lens persists. */

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

export const INCLUDE_LABELS: Record<keyof IncludeOptions, string> = {
  visibleText: 'Visible text',
  assetUrls: 'Asset URLs',
  domSummary: 'DOM summary',
  cssEvidence: 'CSS evidence',
  accessibility: 'Accessibility',
  interactions: 'Interactions',
  responsive: 'Responsive evidence',
  customProperties: 'CSS custom properties',
};

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
};

export const STORAGE_KEY = 'sectionLens.preferences';
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
  if (isRecord(raw.include)) {
    for (const key of Object.keys(DEFAULT_INCLUDE) as (keyof IncludeOptions)[]) {
      const v = raw.include[key];
      if (typeof v === 'boolean') prefs.include[key] = v;
    }
  }
  return prefs;
}

interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function defaultArea(): StorageArea | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  return chrome.storage.local as unknown as StorageArea;
}

export async function loadPreferences(
  area: StorageArea | null = defaultArea(),
): Promise<Preferences> {
  if (!area) return normalizePreferences(null);
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
): Promise<void> {
  if (!area) return;
  try {
    await area.set({ [STORAGE_KEY]: normalizePreferences(prefs) });
  } catch {
    // Storage quota or context invalidation — preferences are best-effort.
  }
}
