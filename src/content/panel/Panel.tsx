import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { InspectorController } from '../controller';
import type { BuildTarget, IncludeOptions } from '../../shared/preferences';
import { BUILD_TARGETS, INCLUDE_LABELS } from '../../shared/preferences';
import { STAGE_LABELS, STAGE_ORDER } from '../../shared/types';
import { clampToViewport } from '../../core/geometry';
import { LensIcon } from './LensIcon';
import type { ReferenceImage } from '../store';

const PANEL_WIDTH = 340;
const MARGIN = 16;

function defaultPosition(): { x: number; y: number } {
  return { x: Math.max(8, window.innerWidth - PANEL_WIDTH - MARGIN), y: MARGIN };
}

function ReferencePreview({ image }: { image: ReferenceImage }) {
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
        aria-label={`Captured reference, ${image.width} by ${image.height} pixels`}
      />
      <figcaption>
        reference.png · {image.width} × {image.height} px
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
      if (e.button !== 0 || (e.target as Element).closest('button')) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { dx: e.clientX - clamped.x, dy: e.clientY - clamped.y, id: e.pointerId };
    },
    [clamped.x, clamped.y],
  );
  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    setPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy });
  }, []);
  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!drag.current) return;
      drag.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
      controller.setPanelPosition(clamped);
    },
    [controller, clamped],
  );

  const stageIndex = stage ? STAGE_ORDER.indexOf(stage) : -1;
  const progress = stage ? Math.round(((stageIndex + 1) / STAGE_ORDER.length) * 100) : 0;
  const ready = stage === 'ready' && !!analysis;

  const setInclude = (key: keyof IncludeOptions, value: boolean) =>
    controller.setPrefs({ include: { ...prefs.include, [key]: value } });

  return (
    <div
      ref={panelRef}
      className={`panel${prefs.minimized ? ' minimized' : ''}`}
      style={{ transform: `translate(${clamped.x}px, ${clamped.y}px)` }}
      role="region"
      aria-label="AJ Lens inspector"
      tabIndex={-1}
    >
      <header
        className="hdr"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        title="Drag to move"
      >
        <LensIcon />
        <span className="brand">AJ Lens</span>
        {prefs.minimized && (
          <span className={`mini-dot${locked ? ' locked' : ''}`} aria-hidden="true" />
        )}
        <span className="spacer" />
        <button
          type="button"
          className="icon-btn"
          aria-label={prefs.minimized ? 'Expand panel' : 'Minimize panel'}
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
          aria-label="Close AJ Lens"
          onClick={() => controller.close()}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
          </svg>
        </button>
      </header>

      {!prefs.minimized && (
        <div className="body">
          <div className={`status${locked ? ' locked' : ''}`}>
            <span className="dot" aria-hidden="true" />
            {locked ? 'SECTION LOCKED' : 'INSPECTOR ACTIVE'}
          </div>
          <h2 className="tagline">Point. Capture. Rebuild.</h2>
          <p className="desc">
            Hover over a section to generate its prompt. Click the page to lock it and capture a
            reference.
          </p>

          <div className={`card selection${locked ? ' locked' : ''}`} aria-live="off">
            {candidate ? (
              <>
                <div className="sel-head">
                  <span className="tag">{candidate.tag}</span>
                  <code className="selector" title={candidate.selector}>
                    {candidate.selector}
                  </code>
                </div>
                <div className="meta">
                  {candidate.width} × {candidate.height} px · {candidate.descendants} elements ·{' '}
                  {candidate.assets}
                  {candidate.assetsMeasured ? '' : '~'} assets
                </div>
                {candidate.accessibleName && (
                  <div className="aname">“{candidate.accessibleName}”</div>
                )}
              </>
            ) : (
              <div className="meta empty">
                No section selected yet — move the pointer over the page.
              </div>
            )}
          </div>

          {notice && (
            <div
              className={`notice ${notice.kind}`}
              role={notice.kind === 'error' ? 'alert' : 'status'}
            >
              <span>{notice.text}</span>
              <button
                type="button"
                className="link-btn"
                onClick={() => controller.dismissNotice()}
                aria-label="Dismiss message"
              >
                ×
              </button>
            </div>
          )}

          <div className="controls">
            <button
              type="button"
              className="btn"
              onClick={() => controller.navigate('up')}
              disabled={!candidate}
              title="Arrow Up"
            >
              ↑ Parent
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => controller.navigate('down')}
              disabled={!candidate}
              title="Arrow Down"
            >
              ↓ Smaller
            </button>
            <button type="button" className="btn" onClick={() => controller.pickAnother()}>
              Pick another
            </button>
            <button
              type="button"
              className={`btn ${locked ? 'secondary' : 'primary'} wide`}
              onClick={() => controller.toggleLock()}
              disabled={!candidate && !locked}
              title={locked ? 'Unlock section' : 'Enter'}
            >
              {locked ? 'Unlock section' : 'Lock section'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => controller.refresh()}
              disabled={!candidate}
              title="R"
              aria-label="Refresh measurement"
            >
              ↻ Refresh
            </button>
          </div>

          {captureChoice && (
            <div className="choice" role="group" aria-label="Partial capture options">
              <p>
                Only {captureChoice.visiblePercent}% of this section is in the viewport. How should
                the reference be captured?
              </p>
              <div className="choice-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => controller.chooseCapture('visible')}
                  disabled={captureChoice.visiblePercent === 0}
                >
                  Capture visible area
                </button>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => controller.chooseCapture('scroll')}
                >
                  Scroll into view and capture
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => controller.chooseCapture('cancel')}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <label className="label" htmlFor={buildId}>
            BUILD WITH
          </label>
          <select
            id={buildId}
            className="select"
            value={prefs.buildTarget}
            onChange={(e) => controller.setPrefs({ buildTarget: e.target.value as BuildTarget })}
          >
            {BUILD_TARGETS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {prefs.buildTarget === 'custom' && (
            <>
              <label className="sr-only" htmlFor={customId}>
                Custom build instructions
              </label>
              <textarea
                id={customId}
                className="custom"
                rows={3}
                maxLength={4000}
                placeholder="e.g. Use our <Card> component, Tailwind tokens from theme.ts, and put it in src/sections/"
                value={prefs.customInstructions}
                onChange={(e) => controller.setPrefs({ customInstructions: e.target.value })}
              />
            </>
          )}

          <div className="label-row">
            <label className="label" htmlFor={promptId}>
              RECONSTRUCTION PROMPT
            </label>
            <span className="count" aria-live="off">
              {prompt ? `${prompt.length.toLocaleString()} chars` : '—'}
            </span>
          </div>

          <div className="seg" role="radiogroup" aria-label="Prompt detail">
            {(['detailed', 'compact'] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={prefs.promptDetail === d}
                className={prefs.promptDetail === d ? 'on' : ''}
                onClick={() => controller.setPrefs({ promptDetail: d })}
              >
                {d === 'detailed' ? 'Detailed' : 'Compact'}
              </button>
            ))}
          </div>

          {stage && (
            <div className="progress" aria-hidden={stage === 'ready'}>
              <div className="progress-text">
                <span>{STAGE_LABELS[stage]}</span>
                <span>{progress}%</span>
              </div>
              <div
                className="bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
                aria-label="Analysis progress"
              >
                <div style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          <textarea
            id={promptId}
            className="prompt"
            readOnly
            value={prompt}
            placeholder={
              locked ? 'Analyzing…' : 'Lock a section to generate its reconstruction prompt.'
            }
            spellCheck={false}
          />

          {reference && <ReferencePreview image={reference} />}

          <div className="actions">
            <button
              type="button"
              className="btn primary wide"
              disabled={!ready}
              onClick={() => void controller.copyPrompt()}
              title="C"
            >
              {state.copied ? 'Copied ✓' : 'Copy prompt'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!ready}
              onClick={() => void controller.savePrompt()}
            >
              Save prompt.md
            </button>
            <button
              type="button"
              className="btn"
              disabled={!ready || !reference}
              onClick={() => void controller.saveReference()}
            >
              Save reference.png
            </button>
            <button
              type="button"
              className="btn"
              disabled={!ready}
              onClick={() => void controller.saveAnalysis()}
            >
              Save analysis.json
            </button>
          </div>

          <details className="options">
            <summary>Include in prompt</summary>
            <div className="checks">
              {(Object.keys(INCLUDE_LABELS) as (keyof IncludeOptions)[]).map((key) => (
                <label key={key} className="check">
                  <input
                    type="checkbox"
                    checked={prefs.include[key]}
                    onChange={(e) => setInclude(key, e.target.checked)}
                  />
                  <span>{INCLUDE_LABELS[key]}</span>
                </label>
              ))}
            </div>
          </details>
        </div>
      )}

      {!prefs.minimized && (
        <footer className="ftr">
          <div>Esc closes · ↑/↓ changes selection · Click locks</div>
          <div className="private">
            <span className="dot" aria-hidden="true" />
            Measured locally. Nothing is uploaded.
          </div>
        </footer>
      )}
      <div className="sr-only" aria-live="polite" role="status">
        {state.announcement}
      </div>
    </div>
  );
}
