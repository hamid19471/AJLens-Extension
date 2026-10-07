import type { AnalysisStage, ReferenceInfo, SectionAnalysis } from '../../shared/types';
import type { Measurer } from '../measure';
import type { AnalysisLimits } from './context';
import { DEFAULT_LIMITS, accessibleName, createContext, yieldToBrowser } from './context';
import { analyzeStructure } from './dom';
import { analyzeLayout } from './layout';
import { analyzeTypography } from './typography';
import { analyzeColors } from './colors';
import { analyzeAssets } from './assets';
import { analyzeInteractions } from './interactions';
import { analyzeAccessibility } from './accessibility';
import { analyzeResponsive, scanStylesheets } from './responsive';
import { classifySection } from './classify';
import { roundRect } from '../geometry';
import { sanitizeOrigin, sanitizePath, cleanText } from '../sanitize';

export interface AnalyzeOptions {
  measurer: Measurer;
  limits?: AnalysisLimits;
  onStage?: (stage: AnalysisStage) => void;
  /** Captures the visual reference; called at the "capturing" stage. */
  capture?: () => Promise<ReferenceInfo>;
  /** Abort signal: analysis stops between stages when aborted. */
  signal?: AbortSignal;
  now?: () => Date;
  generator?: string;
}

export class AnalysisAbortedError extends Error {
  constructor() {
    super('Analysis was cancelled.');
    this.name = 'AnalysisAbortedError';
  }
}

function detectIframes(root: Element): { crossOrigin: number; sameOrigin: number } {
  let crossOrigin = 0;
  let sameOrigin = 0;
  const frames =
    root.tagName.toLowerCase() === 'iframe' ? [root] : Array.from(root.querySelectorAll('iframe'));
  for (const f of frames) {
    try {
      if ((f as HTMLIFrameElement).contentDocument) sameOrigin++;
      else crossOrigin++;
    } catch {
      crossOrigin++;
    }
  }
  return { crossOrigin, sameOrigin };
}

/** Full analysis of a locked selection. Runs stage by stage, yielding to keep the page responsive. */
export async function analyzeSection(
  root: Element,
  opts: AnalyzeOptions,
): Promise<SectionAnalysis> {
  const { measurer: m } = opts;
  const stage = async (s: AnalysisStage) => {
    if (opts.signal?.aborted) throw new AnalysisAbortedError();
    opts.onStage?.(s);
    await yieldToBrowser();
    if (opts.signal?.aborted) throw new AnalysisAbortedError();
  };
  const win = root.ownerDocument.defaultView ?? window;

  await stage('measuring');
  m.reset();
  if (!root.isConnected) throw new Error('The selected element was removed from the page.');
  const ctx = createContext(root, m, opts.limits ?? DEFAULT_LIMITS, win);
  const structure = analyzeStructure(ctx);

  await stage('layout');
  const layout = analyzeLayout(ctx);

  await stage('typography');
  const typography = analyzeTypography(ctx);

  await stage('assets');
  const assets = analyzeAssets(ctx);
  const interactions = analyzeInteractions(ctx);

  await stage('responsive');
  const scan = scanStylesheets(ctx);
  const responsive = analyzeResponsive(ctx, scan, layout);
  const colors = analyzeColors(ctx, scan.referencedVars);
  const accessibility = analyzeAccessibility(ctx, structure);

  await stage('capturing');
  let reference: ReferenceInfo = {
    fileName: 'reference.png',
    status: 'skipped',
    note: 'Screenshot capture was not requested.',
  };
  if (opts.capture) {
    try {
      reference = await opts.capture();
    } catch (err) {
      reference = {
        fileName: 'reference.png',
        status: 'failed',
        note: err instanceof Error ? err.message : String(err),
      };
    }
  }

  await stage('classifying');
  const bounds = m.rect(root);
  const doc = root.ownerDocument;
  const classification = classifySection({
    tag: root.tagName.toLowerCase(),
    role: root.getAttribute('role') ?? '',
    hints:
      `${root.id} ${typeof root.className === 'string' ? root.className : ''} ${root.getAttribute('aria-label') ?? ''}`.toLowerCase(),
    bounds,
    documentY: bounds.y + (win.scrollY || 0),
    documentHeight: doc.documentElement.scrollHeight,
    viewport: { width: win.innerWidth, height: win.innerHeight },
    structure,
    layout,
    typography,
    colors,
    assets,
    interactions,
  });

  const warnings = [...ctx.warnings];
  const assumptions: string[] = [
    'Computed styles reflect the current viewport, theme and interaction state only; hover/focus/active styles were not triggered.',
    'Design tokens are inferred from observed values and may not match the source design system names.',
  ];
  if (scan.inaccessible > 0) {
    warnings.push(
      `${scan.inaccessible} cross-origin stylesheet(s) could not be read; media queries and custom properties from them are missing.`,
    );
  }
  const frames = detectIframes(root);
  if (frames.crossOrigin > 0) {
    warnings.push(
      `${frames.crossOrigin} cross-origin iframe(s) inside the selection cannot be inspected; only their outer box is measured.`,
    );
  }
  if (frames.sameOrigin > 0) {
    assumptions.push(
      `${frames.sameOrigin} iframe(s) are present; their inner documents were not analyzed.`,
    );
  }
  if (reference.status === 'failed')
    warnings.push(`Reference capture failed: ${reference.note ?? 'unknown error'}`);
  if (reference.status === 'partial')
    warnings.push(
      'reference.png only contains the part of the section that was visible in the viewport.',
    );
  if (classification.inferred) {
    assumptions.push(
      `Section type "${classification.primary}" is inferred (confidence ${classification.confidence}).`,
    );
  }
  if (typography.families.some((f) => !f.loaded)) {
    assumptions.push(
      'Some font families were not confirmed as loaded web fonts; they may be system fallbacks.',
    );
  }

  await stage('prompt');
  const href = doc.location?.href ?? '';
  const analysis: SectionAnalysis = {
    schemaVersion: '1.0',
    metadata: {
      capturedAt: (opts.now?.() ?? new Date()).toISOString(),
      sourceOrigin: sanitizeOrigin(href),
      sourcePath: sanitizePath(href),
      pageTitle: cleanText(doc.title || '', 140),
      viewport: {
        width: win.innerWidth,
        height: win.innerHeight,
        devicePixelRatio: win.devicePixelRatio || 1,
      },
      scroll: { x: Math.round(win.scrollX || 0), y: Math.round(win.scrollY || 0) },
      generator: opts.generator ?? 'AJ Lens',
    },
    selection: {
      tagName: root.tagName.toLowerCase(),
      selector: structure.stableSelector,
      bounds: roundRect(bounds),
      descendantCount: ctx.totalDescendants,
      assetCount: assets.length,
      accessibleName:
        root.getAttribute('aria-label') || root.getAttribute('aria-labelledby')
          ? accessibleName(root)
          : undefined,
    },
    classification,
    structure,
    layout,
    typography,
    colors,
    assets,
    interactions,
    accessibility,
    responsive,
    reference,
    assumptions,
    warnings,
  };
  return analysis;
}
