import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { InspectorController } from '../controller';
import type { BuildTarget, IncludeOptions } from '../../shared/preferences';
import { BUILD_TARGETS, INCLUDE_MESSAGE_KEYS } from '../../shared/preferences';
import { STAGE_MESSAGE_KEYS, STAGE_ORDER } from '../../shared/types';
import { clampToViewport } from '../../core/geometry';
import { LensIcon } from './LensIcon';
import { LanguageSelector } from './LanguageSelector';
import {
  dirFor,
  format,
  formatNumber,
  messages,
  type Locale,
  type Messages,
} from '../../shared/i18n';
import type { ReferenceImage } from '../store';

const PANEL_WIDTH = 360;
const MARGIN = 16;

function defaultPosition(): { x: number; y: number } {
  return { x: Math.max(8, window.innerWidth - PANEL_WIDTH - MARGIN), y: MARGIN };
}

/** Technical content (selectors, sizes, filenames) stays LTR inside RTL text. */
function Ltr({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={`ltr ${className}`.trim()}>
      {children}
    </bdi>
  );
}

function buildTargetLabel(value: BuildTarget, fallback: string, t: Messages): string {
  if (value === 'existing') return t.buildExisting;
  if (value === 'custom') return t.buildCustom;
  return fallback; // Technology names are never translated.
}

/** Persian labels for filenames: translated verb + LTR-isolated filename. */
function SaveLabel({ text, file }: { text: string; file: string }) {
  const [before, after] = text.split(file);
  return (
    <>
      {before}
      <Ltr>{file}</Ltr>
      {after}
    </>
  );
}

function ReferencePreview({ image, t }: { image: ReferenceImage; t: Messages }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    const canvas = ref.current;
    if (!canvas) return;
    void createImageBitmap(image.blob).then((bmp) => {
      if (cancelled) {
        bmp.close();
        return;
      }
      const maxW = PANEL_WIDTH - 34;
      const scale = Math.min(1, maxW / bmp.width, 120 / bmp.height);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(bmp.width * scale * dpr));
      canvas.height = Math.max(1, Math.round(bmp.height * scale * dpr));
      canvas.style.width = `${Math.round(bmp.width * scale)}px`;
      canvas.style.height = `${Math.round(bmp.height * scale)}px`;
      canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close();
    });
    return () => {
      cancelled = true;
    };
  }, [image]);
  return (
    <figure className="preview">
      <canvas
        ref={ref}
        role="img"
        aria-label={format(t.referenceAlt, { width: image.width, height: image.height })}
      />
      <figcaption>
        <Ltr>
          reference.png · {image.width} × {image.height} px
        </Ltr>
      </figcaption>
    </figure>
  );
}

export function Panel({ controller }: { controller: InspectorController }) {
  const state = useSyncExternalStore(controller.store.subscribe, controller.store.get);
  const { prefs, candidate, mode, stage, prompt, analysis, reference, notice, captureChoice } =
    state;
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number; id: number } | null>(null);
  const [pos, setPos] = useState(() => prefs.panelPosition ?? defaultPosition());
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const buildId = useId();
  const customId = useId();
  const promptId = useId();
  const copyStatusId = useId();
  const locked = mode === 'locked';

  // Adopt the stored position once preferences load.
  const storedX = prefs.panelPosition?.x;
  const storedY = prefs.panelPosition?.y;
  useEffect(() => {
    if (storedX !== undefined && storedY !== undefined && !drag.current)
      setPos({ x: storedX, y: storedY });
  }, [storedX, storedY]);

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const [height, setHeight] = useState(400);
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const clamped = clampToViewport(pos, { width: PANEL_WIDTH, height }, viewport);

  useLayoutEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0 || (e.target as Element).closest('button, .no-drag')) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { dx: e.clientX - clamped.x, dy: e.clientY - clamped.y, id: e.pointerId };
    },
    [clamped.x, clamped.y],
  );
  // Latest dragged position, independent of render timing (pointerup can arrive before re-render).
  const livePos = useRef<{ x: number; y: number } | null>(null);
  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    const next = { x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy };
    livePos.current = next;
    setPos(next);
  }, []);
  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!drag.current) return;
      drag.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
      const final = livePos.current
        ? clampToViewport(livePos.current, { width: PANEL_WIDTH, height }, viewport)
        : clamped;
      livePos.current = null;
      controller.setPanelPosition(final);
    },
    [controller, clamped, height, viewport],
  );

  const stageIndex = stage ? STAGE_ORDER.indexOf(stage) : -1;
  const progress = stage ? Math.round(((stageIndex + 1) / STAGE_ORDER.length) * 100) : 0;
  const ready = stage === 'ready' && !!analysis && prompt.length > 0;
  const generating = stage !== null && stage !== 'ready';
  const locale: Locale = prefs.locale;
  const t = messages(locale);
  const dir = dirFor(locale);
  const num = (n: number) => formatNumber(n, locale);
  // "·" is easily confused with the Persian zero "۰", so Persian uses the Persian comma.
  const sep = locale === 'fa' ? '، ' : ' · ';

  const setInclude = (key: keyof IncludeOptions, value: boolean) =>
    controller.setPrefs({ include: { ...prefs.include, [key]: value } });

  return (
    <div
      ref={panelRef}
      className={`panel${prefs.minimized ? ' minimized' : ''}`}
      style={{ transform: `translate(${clamped.x}px, ${clamped.y}px)` }}
      role="region"
      aria-label={t.panelRegion}
      lang={locale}
      dir={dir}
      data-testid="panel"
      tabIndex={-1}
    >
      <header
        className="hdr"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        title={t.dragToMove}
      >
        <div className="brand-group" data-testid="brand-group">
          <LensIcon />
          <bdi className="brand" dir="ltr">
            AJ Lens
          </bdi>
          {prefs.minimized && (
            <span className={`mini-dot${locked ? ' locked' : ''}`} aria-hidden="true" />
          )}
        </div>
        <LanguageSelector
          compact
          value={locale}
          groupLabel={t.languageGroup}
          onChange={(next) => controller.setPrefs({ locale: next })}
        />
        <div className="window-controls no-drag" data-testid="window-controls">
          <button
            type="button"
            className="icon-btn"
            data-testid="minimize"
            aria-label={prefs.minimized ? t.expandPanel : t.minimizePanel}
            title={prefs.minimized ? t.expandPanel : t.minimizePanel}
            aria-expanded={!prefs.minimized}
            onClick={() => controller.setPrefs({ minimized: !prefs.minimized })}
          >
            {prefs.minimized ? (
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 10l4-4 4 4" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 8h8" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="icon-btn"
            data-testid="close"
            aria-label={t.closePanel}
            title={t.closePanel}
            onClick={() => controller.close()}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
            </svg>
          </button>
        </div>
      </header>

      {!prefs.minimized && (
        <div className="body">
          <div className={`status${locked ? ' locked' : ''}`} data-testid="status">
            <span className="dot" aria-hidden="true" />
            <span>{locked ? t.sectionLocked : t.inspectorActive}</span>
          </div>
          <h2 className="tagline">{t.tagline}</h2>
          <p className="desc">{t.description}</p>

          <div
            className={`card selection${locked ? ' locked' : ''}`}
            aria-live="off"
            aria-label={t.selectedSection}
            role="group"
          >
            {candidate ? (
              <>
                <div className="sel-head" dir="ltr">
                  <span className="tag">{candidate.tag}</span>
                  <code className="selector" title={candidate.selector}>
                    {candidate.selector}
                  </code>
                </div>
                <div className="meta" data-testid="selection-meta">
                  <Ltr className="dims">
                    {candidate.width} × {candidate.height} px
                  </Ltr>
                  {sep}
                  {num(candidate.descendants)} {t.elementsUnit}
                  {sep}
                  <span title={candidate.assetsMeasured ? undefined : t.assetsEstimated}>
                    {candidate.assetsMeasured ? '' : '~'}
                    {num(candidate.assets)} {t.assetsUnit}
                  </span>
                </div>
                {candidate.accessibleName && (
                  <div className="aname" dir="auto">
                    “{candidate.accessibleName}”
                  </div>
                )}
              </>
            ) : (
              <div className="meta empty">{t.noSectionSelected}</div>
            )}
          </div>

          {notice && (
            <div
              className={`notice ${notice.kind}`}
              role={notice.kind === 'error' ? 'alert' : 'status'}
              data-testid="notice"
            >
              <span>
                {format(t[notice.key], notice.params ?? {})}
                {notice.detail && (
                  <span className="detail">
                    {t.errorDetail}: <Ltr>{notice.detail}</Ltr>
                  </span>
                )}
              </span>
              <button
                type="button"
                className="link-btn"
                onClick={() => controller.dismissNotice()}
                aria-label={t.dismissMessage}
                title={t.dismissMessage}
              >
                ×
              </button>
            </div>
          )}

          <div className="controls" role="group" aria-label={t.selectionControls}>
            <button
              type="button"
              className="btn"
              onClick={() => controller.navigate('up')}
              disabled={!candidate}
              title={`${t.parent} (↑)`}
              data-testid="nav-parent"
            >
              <span aria-hidden="true">↑</span> {t.parent}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => controller.navigate('down')}
              disabled={!candidate}
              title={`${t.smaller} (↓)`}
              data-testid="nav-child"
            >
              <span aria-hidden="true">↓</span> {t.smaller}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => controller.pickAnother()}
              data-testid="pick-another"
            >
              {t.pickAnother}
            </button>
            <button
              type="button"
              className={`btn ${locked ? 'secondary' : 'primary'} wide`}
              onClick={() => controller.toggleLock()}
              disabled={!candidate && !locked}
              title={locked ? t.unlockSection : `${t.lockSection} (Enter)`}
              data-testid="lock-toggle"
            >
              {locked ? t.unlockSection : t.lockSection}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => controller.refresh()}
              disabled={!candidate}
              title={`${t.refreshMeasurement} (R)`}
              aria-label={t.refreshMeasurement}
              data-testid="refresh"
            >
              <span aria-hidden="true">↻</span> {t.refresh}
            </button>
          </div>

          {captureChoice && (
            <div
              className="choice"
              role="group"
              aria-label={t.partialCaptureGroup}
              data-testid="capture-choice"
            >
              <p>
                {t.partialOutside}{' '}
                {format(t.partialVisible, { percent: num(captureChoice.visiblePercent) })}
              </p>
              <div className="choice-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => controller.chooseCapture('visible')}
                  disabled={captureChoice.visiblePercent === 0}
                  data-testid="capture-visible"
                >
                  {t.captureVisible}
                </button>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => controller.chooseCapture('scroll')}
                  data-testid="capture-scroll"
                >
                  {t.captureScroll}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => controller.chooseCapture('cancel')}
                  data-testid="capture-cancel"
                >
                  {t.cancel}
                </button>
              </div>
            </div>
          )}

          <label className="label" htmlFor={buildId}>
            {t.buildWith}
          </label>
          <select
            id={buildId}
            className="select"
            value={prefs.buildTarget}
            data-testid="build-target"
            onChange={(e) => controller.setPrefs({ buildTarget: e.target.value as BuildTarget })}
          >
            {BUILD_TARGETS.map((b) => (
              <option key={b.value} value={b.value}>
                {buildTargetLabel(b.value, b.label, t)}
              </option>
            ))}
          </select>
          {prefs.buildTarget === 'custom' && (
            <>
              <label className="sr-only" htmlFor={customId}>
                {t.customInstructionsLabel}
              </label>
              <textarea
                id={customId}
                className="custom"
                rows={3}
                maxLength={4000}
                dir="auto"
                placeholder={t.customPlaceholder}
                value={prefs.customInstructions}
                onChange={(e) => controller.setPrefs({ customInstructions: e.target.value })}
              />
            </>
          )}

          <div className="label-row">
            <label className="label" htmlFor={promptId}>
              {t.reconstructionPrompt}
            </label>
            <span
              className="count"
              aria-live="off"
              data-testid="char-count"
              data-count={prompt.length}
            >
              {prompt ? `${num(prompt.length)} ${t.characters}` : '—'}
            </span>
          </div>

          <div className="seg" role="radiogroup" aria-label={t.promptDetail}>
            {(['detailed', 'compact'] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={prefs.promptDetail === d}
                className={prefs.promptDetail === d ? 'on' : ''}
                data-testid={`mode-${d}`}
                onClick={() => controller.setPrefs({ promptDetail: d })}
              >
                {d === 'detailed' ? t.detailed : t.compact}
              </button>
            ))}
          </div>

          {stage && (
            <div className="progress" aria-hidden={stage === 'ready'} data-testid="progress">
              <div className="progress-text">
                <span>{t[STAGE_MESSAGE_KEYS[stage]]}</span>
                <span>{locale === 'fa' ? `${num(progress)}٪` : `${progress}%`}</span>
              </div>
              <div
                className="bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
                aria-label={t.analysisProgress}
              >
                <div style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {/* The generated prompt is always English: keep the editor LTR regardless of locale. */}
          <textarea
            id={promptId}
            className="prompt"
            readOnly
            lang="en"
            dir="ltr"
            aria-description={t.promptPreview}
            value={prompt}
            placeholder={locked ? t.promptPlaceholderBusy : t.promptPlaceholderIdle}
            spellCheck={false}
          />

          {reference && <ReferencePreview image={reference} t={t} />}

          <div className="actions">
            <div className="copy-block wide">
              <button
                type="button"
                className={`btn primary copy-full${state.copyStatus === 'copied' ? ' done' : ''}`}
                data-testid="copy-full-prompt"
                disabled={!ready}
                aria-busy={generating}
                aria-label={t.copyFullPromptAria}
                aria-describedby={copyStatusId}
                onClick={() => void controller.copyPrompt()}
                title={`${t.copyFullPrompt} (C)`}
              >
                {state.copyStatus === 'copied' ? `${t.fullPromptCopied} ✓` : t.copyFullPrompt}
              </button>
              <div
                id={copyStatusId}
                className={`copy-status${state.copyStatus === 'failed' ? ' failed' : ''}`}
                data-testid="copy-status"
              >
                {state.copyStatus === 'failed'
                  ? t.copyFailed
                  : generating
                    ? t.generatingPrompt
                    : ready
                      ? prefs.promptDetail === 'detailed'
                        ? t.modeDetailed
                        : t.modeCompact
                      : ''}
              </div>
            </div>
            <button
              type="button"
              className="btn"
              disabled={!ready}
              data-testid="save-prompt"
              onClick={() => void controller.savePrompt()}
            >
              <SaveLabel text={t.savePrompt} file="prompt.md" />
            </button>
            <button
              type="button"
              className="btn"
              disabled={!ready || !reference}
              data-testid="save-reference"
              onClick={() => void controller.saveReference()}
            >
              <SaveLabel text={t.saveReference} file="reference.png" />
            </button>
            <button
              type="button"
              className="btn"
              disabled={!ready}
              data-testid="save-analysis"
              onClick={() => void controller.saveAnalysis()}
            >
              <SaveLabel text={t.saveAnalysis} file="analysis.json" />
            </button>
          </div>

          <details className="options">
            <summary>{t.includeInPrompt}</summary>
            <div className="checks">
              {(Object.keys(INCLUDE_MESSAGE_KEYS) as (keyof IncludeOptions)[]).map((key) => (
                <label key={key} className="check">
                  <input
                    type="checkbox"
                    checked={prefs.include[key]}
                    onChange={(e) => setInclude(key, e.target.checked)}
                  />
                  <span>{t[INCLUDE_MESSAGE_KEYS[key]]}</span>
                </label>
              ))}
            </div>
          </details>
        </div>
      )}

      {!prefs.minimized && (
        <footer className="ftr" data-testid="footer">
          <div className="keys">
            <span>{t.footerEsc}</span>
            <span aria-hidden="true">{locale === 'fa' ? ' | ' : ' · '}</span>
            <span>{t.footerArrows}</span>
            <span aria-hidden="true">{locale === 'fa' ? ' | ' : ' · '}</span>
            <span>{t.footerClick}</span>
          </div>
          <div className="private">
            <span className="dot" aria-hidden="true" />
            <span>{t.footerPrivate}</span>
          </div>
        </footer>
      )}
      <div className="sr-only" aria-live="polite" role="status">
        {state.announcement}
      </div>
    </div>
  );
}
