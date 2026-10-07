import type { AnalysisStage, SectionAnalysis } from '../shared/types';
import type { Preferences } from '../shared/preferences';
import { DEFAULT_PREFERENCES } from '../shared/preferences';
import type { MessageKey } from '../shared/i18n';

export interface CandidateInfo {
  tag: string;
  selector: string;
  width: number;
  height: number;
  descendants: number;
  assets: number;
  /** True once the full analysis has replaced the quick hover estimate. */
  assetsMeasured: boolean;
  accessibleName?: string;
}

/** Localized at render time so switching language re-translates visible messages. */
export interface Notice {
  kind: 'info' | 'warning' | 'error';
  key: MessageKey;
  params?: Record<string, string | number>;
  /** Raw technical detail (browser error text) — shown LTR and untranslated. */
  detail?: string;
}

export interface ReferenceImage {
  blob: Blob;
  width: number;
  height: number;
}

export interface InspectorState {
  mode: 'hover' | 'locked';
  candidate: CandidateInfo | null;
  notice: Notice | null;
  stage: AnalysisStage | null;
  analysis: SectionAnalysis | null;
  prompt: string;
  reference: ReferenceImage | null;
  /** Shown when the locked section is partially outside the viewport. */
  captureChoice: { visiblePercent: number } | null;
  prefs: Preferences;
  /** Polite live-region text. */
  announcement: string;
  /** Result of the last "Copy full prompt" click; resets to idle after a short delay. */
  copyStatus: 'idle' | 'copied' | 'failed';
}

export const INITIAL_STATE: InspectorState = {
  mode: 'hover',
  candidate: null,
  notice: null,
  stage: null,
  analysis: null,
  prompt: '',
  reference: null,
  captureChoice: null,
  prefs: DEFAULT_PREFERENCES,
  announcement: '',
  copyStatus: 'idle',
};

export class Store<T extends object> {
  private listeners = new Set<() => void>();
  constructor(private state: T) {}

  get = (): T => this.state;

  set(patch: Partial<T>): void {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof T)[]) {
      if (!Object.is(this.state[key], patch[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  clear(): void {
    this.listeners.clear();
  }
}
