import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import type { AnalysisStage, ReferenceInfo, Rect } from '../shared/types';
import { STAGE_LABELS } from '../shared/types';
import type { PanelPosition, Preferences } from '../shared/preferences';
import { loadPreferences, savePreferences } from '../shared/preferences';
import { createDomMeasurer } from '../core/measure';
import { HOST_TAG, MIN_REGION_AREA, isExtensionNode } from '../core/filters';
import {
  StableCandidate,
  pickHoverCandidate,
  selectChild,
  selectParent,
  type Point,
} from '../core/selection';
import { conciseSelector } from '../core/selector';
import { area, round, visibleFraction } from '../core/geometry';
import { quickAssetCount } from '../core/analysis/assets';
import { accessibleName } from '../core/analysis/context';
import { AnalysisAbortedError, analyzeSection } from '../core/analysis';
import { generatePrompt } from '../core/prompt/generate';
import {
  FILES,
  buildJsonExport,
  buildMarkdownExport,
  exportFolder,
  textDataUrl,
} from '../core/prompt/export';
import {
  INITIAL_STATE,
  Store,
  type CandidateInfo,
  type InspectorState,
  type Notice,
} from './store';
import { Overlay } from './overlay';
import { blobToDataUrl, captureElement, nextFrames } from './capture';
import { requestDownload, runtimeAvailable } from './runtime';
import { createClipboardService, type ClipboardService } from './clipboard';
import { COPY_STRINGS, browserLanguage, detectLocale } from './i18n';
import { Panel } from './panel/Panel';
import panelCss from './panel/panel.css?inline';

export type CaptureChoice = 'visible' | 'scroll' | 'cancel';

export interface ControllerOptions {
  onClose: () => void;
  /** Injected for tests; defaults to the Clipboard API with a shadow-root execCommand fallback. */
  clipboard?: ClipboardService;
}

/** How long the copy success/failure feedback stays visible. */
export const COPY_FEEDBACK_MS = 2000;

const BLOCKED_POINTER_EVENTS = [
  'pointerdown',
  'mousedown',
  'pointerup',
  'mouseup',
  'click',
  'dblclick',
  'auxclick',
] as const;

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type;
    return ![
      'button',
      'submit',
      'reset',
      'checkbox',
      'radio',
      'range',
      'color',
      'file',
      'image',
    ].includes(type);
  }
  return (el as HTMLElement).isContentEditable === true;
}

function isPanelControl(el: Element | null): boolean {
  if (!el) return false;
  return ['button', 'summary', 'a', 'input', 'select', 'textarea', 'label'].includes(
    el.tagName.toLowerCase(),
  );
}

function crossOriginFrame(el: Element): boolean {
  if (el.tagName.toLowerCase() !== 'iframe') return false;
  try {
    return (el as HTMLIFrameElement).contentDocument === null;
  } catch {
    return true;
  }
}

export class InspectorController {
  readonly store = new Store<InspectorState>(INITIAL_STATE);
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private overlay: Overlay | null = null;
  private reactRoot: Root | null = null;
  private events = new AbortController();
  private m = createDomMeasurer();
  private stable = new StableCandidate();
  private target: Element | null = null;
  private pointer: Point | null = null;
  private pointerDirty = false;
  private manualAnchor: Point | null = null;
  private raf = 0;
  private retryTimer: number | undefined;
  private pollTimer: number | undefined;
  private saveTimer: number | undefined;
  private copiedTimer: number | undefined;
  private resizeObs: ResizeObserver | null = null;
  private analysisAbort: AbortController | null = null;
  private choiceResolver: ((c: CaptureChoice) => void) | null = null;
  private infoCache = new WeakMap<
    Element,
    { descendants: number; assets: number; name?: string }
  >();
  private destroyed = false;
  private readonly clipboard: ClipboardService;
  private capturing = false;

  constructor(private readonly opts: ControllerOptions) {
    this.clipboard = opts.clipboard ?? createClipboardService({ container: () => this.shadow });
    this.store.set({ locale: detectLocale(browserLanguage()) });
  }

  // ---------------------------------------------------------------- lifecycle

  start(): void {
    const host = document.createElement(HOST_TAG);
    host.setAttribute(
      'style',
      'all: initial !important; position: fixed !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483647 !important; display: block !important; contain: style !important; pointer-events: none !important;',
    );
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = panelCss;
    shadow.append(style);
    this.overlay = new Overlay(shadow);
    const mount = document.createElement('div');
    mount.className = 'ajl-mount';
    shadow.append(mount);
    (document.documentElement ?? document.body).append(host);
    this.host = host;
    this.shadow = shadow;
    this.reactRoot = createRoot(mount);
    this.reactRoot.render(createElement(Panel, { controller: this }));

    this.bindEvents();
    this.resizeObs = new ResizeObserver(() => this.schedule());
    this.pollTimer = window.setInterval(() => this.schedule(), 300);
    this.store.set({ announcement: 'AJ Lens inspector active. Hover over a section.' });
    if (!runtimeAvailable()) {
      this.setNotice({
        kind: 'warning',
        text: 'Extension runtime unavailable — screenshots and downloads may not work. Reload the page if AJ Lens was updated.',
      });
    }
    void loadPreferences().then((prefs) => {
      if (!this.destroyed) this.store.set({ prefs });
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.events.abort();
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.pollTimer);
    window.clearTimeout(this.copiedTimer);
    if (this.saveTimer !== undefined) {
      window.clearTimeout(this.saveTimer);
      void savePreferences(this.store.get().prefs);
    }
    this.resizeObs?.disconnect();
    this.analysisAbort?.abort();
    this.choiceResolver?.('cancel');
    this.choiceResolver = null;
    this.reactRoot?.unmount();
    this.overlay?.destroy();
    this.host?.remove();
    this.store.clear();
    this.reactRoot = null;
    this.overlay = null;
    this.host = null;
    this.shadow = null;
    this.target = null;
    this.stable.set(null);
  }

  close(): void {
    this.destroy();
    this.opts.onClose();
  }

  get shadowRoot(): ShadowRoot | null {
    return this.shadow;
  }

  // ---------------------------------------------------------------- events

  private bindEvents(): void {
    const signal = this.events.signal;
    window.addEventListener(
      'pointermove',
      (e) => {
        this.pointer = { x: e.clientX, y: e.clientY };
        this.pointerDirty = true;
        this.schedule();
      },
      { capture: true, passive: true, signal },
    );
    window.addEventListener('scroll', () => this.schedule(), {
      capture: true,
      passive: true,
      signal,
    });
    window.addEventListener('resize', () => this.schedule(), { passive: true, signal });
    for (const type of BLOCKED_POINTER_EVENTS) {
      window.addEventListener(type, (e) => this.onPagePointer(e as MouseEvent), {
        capture: true,
        signal,
      });
    }
    window.addEventListener('keydown', (e) => this.onKeyDown(e), { capture: true, signal });
  }

  private eventInsideUi(e: Event): boolean {
    return this.host !== null && e.composedPath().includes(this.host);
  }

  private onPagePointer(e: MouseEvent): void {
    if (this.eventInsideUi(e) || this.store.get().mode !== 'hover') return;
    if (e.button !== 0 && e.type !== 'auxclick') return;
    if (e.type === 'auxclick') return;
    // Block the page from reacting while the user is choosing a section.
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'click') {
      this.pointer = { x: e.clientX, y: e.clientY };
      void this.lock();
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const origin = (e.composedPath()[0] as Element | undefined) ?? null;
    const inUi = this.eventInsideUi(e);
    if (isEditable(origin)) {
      if (e.key === 'Escape' && inUi) {
        (origin as HTMLElement).blur();
        e.stopPropagation();
      }
      return;
    }
    const consume = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    switch (e.key) {
      case 'Escape':
        if (this.store.get().captureChoice) {
          consume();
          this.chooseCapture('cancel');
          return;
        }
        consume();
        this.close();
        return;
      case 'ArrowUp':
        consume();
        this.navigate('up');
        return;
      case 'ArrowDown':
        consume();
        this.navigate('down');
        return;
      case 'Enter':
        if (inUi && isPanelControl(origin)) return;
        consume();
        if (this.store.get().mode === 'hover') void this.lock();
        return;
      case 'r':
      case 'R':
        consume();
        this.refresh();
        return;
      case 'c':
      case 'C':
        if (this.store.get().mode === 'locked' && this.store.get().prompt) {
          consume();
          void this.copyPrompt();
        }
        return;
      default:
        return;
    }
  }

  // ---------------------------------------------------------------- frame loop

  private schedule(): void {
    if (this.destroyed || this.raf) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (): void => {
    this.raf = 0;
    if (this.destroyed) return;
    this.m.reset();
    const state = this.store.get();
    if (state.mode === 'hover' && this.pointerDirty && this.pointer && !this.capturing) {
      this.pointerDirty = false;
      this.updateHover(this.pointer);
    }
    this.draw();
  };

  private updateHover(p: Point): void {
    if (this.manualAnchor) {
      if (Math.hypot(p.x - this.manualAnchor.x, p.y - this.manualAnchor.y) < 14) return;
      this.manualAnchor = null;
    }
    const hit = document.elementFromPoint(p.x, p.y);
    if (!hit || isExtensionNode(hit)) return; // pointer over the panel — keep the current target
    let candidate: Element | null;
    if (hit.tagName.toLowerCase() === 'iframe' && area(this.m.rect(hit)) >= MIN_REGION_AREA)
      candidate = hit;
    else candidate = pickHoverCandidate(hit, this.m);
    const res = this.stable.update(candidate, performance.now());
    if (res.retryIn !== undefined) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = window.setTimeout(() => {
        this.pointerDirty = true;
        this.schedule();
      }, res.retryIn + 5);
    }
    if (res.current !== this.target) this.setTarget(res.current);
  }

  private draw(): void {
    const overlay = this.overlay;
    if (!overlay) return;
    const target = this.target;
    if (!target) {
      overlay.hide();
      return;
    }
    if (!target.isConnected) {
      this.handleRemoved();
      return;
    }
    const rect = this.m.rect(target);
    const state = this.store.get();
    const label = `${conciseSelector(target)} · ${Math.round(rect.width)} × ${Math.round(rect.height)}`;
    overlay.show(
      rect,
      state.mode === 'locked' ? `LOCKED · ${label}` : label,
      state.mode === 'locked',
    );
    const c = state.candidate;
    if (c && (c.width !== round(rect.width) || c.height !== round(rect.height))) {
      this.store.set({ candidate: { ...c, width: round(rect.width), height: round(rect.height) } });
    }
  }

  private handleRemoved(): void {
    this.analysisAbort?.abort();
    this.choiceResolver?.('cancel');
    this.setTarget(null);
    this.stable.set(null);
    this.store.set({
      mode: 'hover',
      stage: null,
      analysis: null,
      prompt: '',
      reference: null,
      captureChoice: null,
      notice: {
        kind: 'error',
        text: 'The selected element was removed from the page (the site re-rendered it). Hover and select it again.',
      },
      announcement: 'Selected element was removed from the page.',
    });
  }

  // ---------------------------------------------------------------- selection

  private candidateInfo(el: Element): CandidateInfo {
    let info = this.infoCache.get(el);
    if (!info) {
      const name =
        el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
          ? accessibleName(el, 60)
          : undefined;
      info = {
        descendants: el.getElementsByTagName('*').length,
        assets: quickAssetCount(el),
        name,
      };
      this.infoCache.set(el, info);
    }
    const r = this.m.rect(el);
    return {
      tag: el.tagName.toLowerCase(),
      selector: conciseSelector(el),
      width: round(r.width),
      height: round(r.height),
      descendants: info.descendants,
      assets: info.assets,
      assetsMeasured: false,
      accessibleName: info.name || undefined,
    };
  }

  private setTarget(el: Element | null): void {
    if (this.target) this.resizeObs?.unobserve(this.target);
    this.target = el;
    if (!el) {
      this.store.set({ candidate: null });
      this.schedule();
      return;
    }
    this.resizeObs?.observe(el);
    const patch: Partial<InspectorState> = { candidate: this.candidateInfo(el) };
    const notice = this.store.get().notice;
    if (crossOriginFrame(el)) {
      patch.notice = {
        kind: 'warning',
        text: 'Cross-origin iframe: its contents belong to another site and cannot be inspected. You can still capture its outer box.',
      };
    } else if (notice && notice.kind !== 'error') {
      patch.notice = null;
    }
    this.store.set(patch);
    this.schedule();
  }

  navigate(direction: 'up' | 'down'): void {
    const current = this.target;
    if (!current) {
      this.announce('Hover over a section first.');
      return;
    }
    this.m.reset();
    const next =
      direction === 'up'
        ? selectParent(current, this.m)
        : selectChild(current, this.m, this.pointer);
    if (!next) {
      this.setNotice({
        kind: 'info',
        text:
          direction === 'up'
            ? 'No larger meaningful parent — this is the outermost region.'
            : 'No smaller meaningful child inside this section.',
      });
      this.announce(direction === 'up' ? 'No meaningful parent.' : 'No meaningful child.');
      return;
    }
    this.stable.set(next);
    this.manualAnchor = this.pointer ?? { x: -100, y: -100 };
    this.setTarget(next);
    this.announce(`Selected ${conciseSelector(next)}.`);
    if (this.store.get().mode === 'locked') void this.runAnalysis();
  }

  async lock(): Promise<void> {
    if (!this.target) {
      this.setNotice({
        kind: 'info',
        text: 'No meaningful section under the pointer. Move over a visible region and try again.',
      });
      return;
    }
    this.stable.set(this.target);
    this.store.set({
      mode: 'locked',
      notice: null,
      announcement: `Locked ${conciseSelector(this.target)}.`,
    });
    this.schedule();
    await this.runAnalysis();
  }

  unlock(): void {
    this.cancelAnalysis();
    this.manualAnchor = null;
    this.store.set({
      mode: 'hover',
      stage: null,
      analysis: null,
      prompt: '',
      reference: null,
      captureChoice: null,
      copyStatus: 'idle',
      notice: null,
      announcement: 'Selection unlocked. Hover over a section.',
    });
    if (this.target) this.setTarget(this.target);
    this.schedule();
  }

  toggleLock(): void {
    if (this.store.get().mode === 'locked') this.unlock();
    else void this.lock();
  }

  pickAnother(): void {
    this.unlock();
    this.stable.set(null);
    this.setTarget(null);
    this.pointerDirty = true;
    this.announce('Pick another section: hover and click to lock.');
  }

  refresh(): void {
    this.m.reset();
    this.infoCache = new WeakMap();
    if (this.target) this.setTarget(this.target);
    if (this.store.get().mode === 'locked') void this.runAnalysis();
    else this.announce('Measurement refreshed.');
  }

  // ---------------------------------------------------------------- analysis

  private cancelAnalysis(): void {
    this.analysisAbort?.abort();
    this.analysisAbort = null;
    this.choiceResolver?.('cancel');
    this.choiceResolver = null;
  }

  private async runAnalysis(): Promise<void> {
    const el = this.target;
    if (!el) return;
    this.cancelAnalysis();
    const ac = new AbortController();
    this.analysisAbort = ac;
    this.store.set({
      analysis: null,
      prompt: '',
      reference: null,
      copyStatus: 'idle',
      stage: 'measuring',
    });
    try {
      const analysis = await analyzeSection(el, {
        measurer: createDomMeasurer(),
        signal: ac.signal,
        onStage: (stage: AnalysisStage) => {
          if (!ac.signal.aborted) this.store.set({ stage, announcement: STAGE_LABELS[stage] });
        },
        capture: () => this.captureFor(el, ac.signal),
      });
      if (ac.signal.aborted || this.destroyed) return;
      const prompt = generatePrompt(analysis, this.promptOptions(this.store.get().prefs));
      const c = this.store.get().candidate;
      const warning = analysis.warnings[0];
      this.store.set({
        analysis,
        prompt,
        stage: 'ready',
        candidate: c ? { ...c, assets: analysis.assets.length, assetsMeasured: true } : c,
        notice: warning ? { kind: 'warning', text: warning } : null,
        announcement: `Ready. Prompt generated with ${prompt.length.toLocaleString()} characters.`,
      });
    } catch (err) {
      if (err instanceof AnalysisAbortedError || ac.signal.aborted || this.destroyed) return;
      this.store.set({
        stage: null,
        notice: { kind: 'error', text: err instanceof Error ? err.message : 'Analysis failed.' },
        announcement: 'Analysis failed.',
      });
    }
  }

  private async captureFor(el: Element, signal: AbortSignal): Promise<ReferenceInfo> {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const fraction = visibleFraction(this.freshRect(el), viewport);
    if (fraction < 0.995) {
      const choice = await this.askCaptureChoice(Math.round(fraction * 100));
      if (signal.aborted) throw new AnalysisAbortedError();
      if (choice === 'cancel')
        return {
          fileName: 'reference.png',
          status: 'skipped',
          note: 'Capture cancelled by the user.',
        };
      if (choice === 'scroll') {
        const r = this.freshRect(el);
        el.scrollIntoView({
          block: r.height > viewport.height ? 'start' : 'center',
          inline: 'nearest',
          behavior: 'instant' as ScrollBehavior,
        });
        await nextFrames(2);
      } else if (fraction === 0) {
        return {
          fileName: 'reference.png',
          status: 'skipped',
          note: 'The section was not visible in the viewport.',
        };
      }
    }
    if (signal.aborted) throw new AnalysisAbortedError();
    this.capturing = true;
    try {
      const result = await captureElement(el, {
        hideUi: () => this.host?.style.setProperty('visibility', 'hidden', 'important'),
        showUi: () => this.host?.style.setProperty('visibility', 'visible', 'important'),
      });
      if (!signal.aborted) this.store.set({ reference: result.image });
      return result.info;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { fileName: 'reference.png', status: 'failed', note: message };
    } finally {
      this.capturing = false;
      this.schedule();
    }
  }

  private freshRect(el: Element): Rect {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }

  private askCaptureChoice(visiblePercent: number): Promise<CaptureChoice> {
    this.store.set({
      captureChoice: { visiblePercent },
      announcement: `Only ${visiblePercent}% of the section is visible. Choose how to capture the reference.`,
    });
    return new Promise((resolve) => {
      this.choiceResolver = (c) => {
        this.choiceResolver = null;
        if (!this.destroyed) this.store.set({ captureChoice: null });
        resolve(c);
      };
    });
  }

  chooseCapture(choice: CaptureChoice): void {
    this.choiceResolver?.(choice);
  }

  // ---------------------------------------------------------------- prompt & exports

  private promptOptions(prefs: Preferences) {
    return {
      detail: prefs.promptDetail,
      buildTarget: prefs.buildTarget,
      customInstructions: prefs.customInstructions,
      include: prefs.include,
    };
  }

  setPrefs(patch: Partial<Preferences>): void {
    const prefs = { ...this.store.get().prefs, ...patch };
    const analysis = this.store.get().analysis;
    const promptAffected =
      'promptDetail' in patch ||
      'buildTarget' in patch ||
      'customInstructions' in patch ||
      'include' in patch;
    this.store.set({
      prefs,
      ...(analysis && promptAffected
        ? { prompt: generatePrompt(analysis, this.promptOptions(prefs)), copyStatus: 'idle' }
        : {}),
    });
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = undefined;
      void savePreferences(this.store.get().prefs);
    }, 300);
  }

  setPanelPosition(pos: PanelPosition): void {
    this.setPrefs({ panelPosition: pos });
  }

  /** True only when a complete prompt for the current settings is available. */
  promptReady(): boolean {
    const { stage, prompt, analysis } = this.store.get();
    return stage === 'ready' && analysis !== null && prompt.length > 0;
  }

  /**
   * Copies the complete prompt for the active mode, read from state — never from the
   * textarea, a selection, or rendered text — so nothing is truncated.
   */
  async copyPrompt(): Promise<void> {
    if (!this.promptReady()) return;
    const fullPrompt = this.store.get().prompt;
    const strings = COPY_STRINGS[this.store.get().locale];
    window.clearTimeout(this.copiedTimer);
    let ok: boolean;
    try {
      await this.clipboard.copyText(fullPrompt);
      ok = true;
    } catch {
      ok = false;
    }
    if (this.destroyed) return;
    this.store.set({ copyStatus: ok ? 'copied' : 'failed' });
    this.announce(ok ? strings.copied : strings.copyFailed);
    this.copiedTimer = window.setTimeout(() => {
      if (!this.destroyed) this.store.set({ copyStatus: 'idle' });
    }, COPY_FEEDBACK_MS);
  }

  private async download(name: string, dataUrl: string): Promise<void> {
    const analysis = this.store.get().analysis;
    if (!analysis) return;
    const path = `${exportFolder(analysis)}/${name}`;
    const res = await requestDownload(path, dataUrl);
    if (res.ok) {
      this.announce(`Saved ${name} to Downloads/${exportFolder(analysis)}.`);
      return;
    }
    // Fallback: anchor download from the page (works when the service worker is unavailable).
    try {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = name;
      a.style.display = 'none';
      this.shadow?.append(a);
      a.click();
      a.remove();
      this.announce(`Saved ${name}.`);
    } catch {
      this.setNotice({ kind: 'error', text: `Download failed: ${res.error}` });
    }
  }

  async savePrompt(): Promise<void> {
    const { analysis, prompt } = this.store.get();
    if (!analysis || !prompt) return;
    await this.download(
      FILES.prompt,
      textDataUrl(buildMarkdownExport(analysis, prompt), 'text/markdown'),
    );
  }

  async saveAnalysis(): Promise<void> {
    const { analysis } = this.store.get();
    if (!analysis) return;
    await this.download(FILES.analysis, textDataUrl(buildJsonExport(analysis), 'application/json'));
  }

  async saveReference(): Promise<void> {
    const { reference } = this.store.get();
    if (!reference) return;
    try {
      await this.download(FILES.reference, await blobToDataUrl(reference.blob));
    } catch (err) {
      this.setNotice({
        kind: 'error',
        text: `Download failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // ---------------------------------------------------------------- helpers

  setNotice(notice: Notice | null): void {
    this.store.set({ notice });
  }

  dismissNotice(): void {
    this.store.set({ notice: null });
  }

  announce(text: string): void {
    // Re-announce identical text by appending a zero-width space toggle.
    const prev = this.store.get().announcement;
    this.store.set({ announcement: prev === text ? `${text}\u200b` : text });
  }
}
