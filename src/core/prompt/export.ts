import type { SectionAnalysis } from '../../shared/types';

export type ArtifactType = 'reference' | 'prompt' | 'analysis';

export const ARTIFACT_TYPES: readonly ArtifactType[] = ['reference', 'prompt', 'analysis'];

/** Fixed filenames: the page never chooses what is written to disk. */
export const ARTIFACT_FILES: Record<ArtifactType, string> = {
  reference: 'reference.png',
  prompt: 'prompt.md',
  analysis: 'analysis.json',
};

export const ARTIFACT_MIME: Record<ArtifactType, string> = {
  reference: 'image/png',
  prompt: 'text/markdown;charset=utf-8',
  analysis: 'application/json;charset=utf-8',
};

/** Root folder inside the browser's Downloads directory. */
export const EXPORT_ROOT = 'AJ-Lens';

/** `AJ-Lens/<safe-segment>` — the only directory shape the service worker accepts. */
export const EXPORT_DIRECTORY_PATTERN = /^AJ-Lens\/[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

/** One locked capture: all of its artifacts are saved into the same folder. */
export interface CaptureExportSession {
  id: string;
  hostname: string;
  capturedAt: string;
  relativeDirectory: string;
}

/**
 * Reduces any string to a safe single path segment: only A–Z, a–z, 0–9, "-" and "_".
 * Dots, spaces, slashes, colons and everything else become "-"; runs collapse; ".." cannot survive.
 */
export function sanitizeSegment(raw: string, fallback = 'page', max = 60): string {
  const cleaned = raw
    .normalize('NFKD')
    .replace(/[?#].*$/, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/[-_]{2,}/g, (m) => (m.includes('-') ? '-' : '_'))
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, max)
    .replace(/[-_]+$/, '');
  return cleaned || fallback;
}

/** Hostname of a sanitized origin, e.g. "https://crm.karinmed.com" → "crm.karinmed.com". */
export function hostnameOf(origin: string): string {
  if (origin === 'file://') return 'local-file';
  try {
    return new URL(origin).hostname || 'page';
  } catch {
    return 'page';
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Deterministic `YYYY-MM-DD-HHmmss` in the user's local time. */
export function formatTimestamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** Folder for a capture, derived from the page hostname and the capture time (not click time). */
export function createExportSession(a: SectionAnalysis): CaptureExportSession {
  const hostname = hostnameOf(a.metadata.sourceOrigin);
  const captured = new Date(a.metadata.capturedAt);
  const stamp = formatTimestamp(Number.isNaN(captured.getTime()) ? new Date() : captured);
  const id = `${sanitizeSegment(hostname, 'page', 60)}-${stamp}`;
  return {
    id,
    hostname,
    capturedAt: a.metadata.capturedAt,
    relativeDirectory: `${EXPORT_ROOT}/${id}`,
  };
}

export function artifactPath(directory: string, type: ArtifactType): string {
  return `${directory}/${ARTIFACT_FILES[type]}`;
}

export function buildMarkdownExport(a: SectionAnalysis, prompt: string): string {
  const v = a.metadata.viewport;
  const appendix = {
    selection: a.selection,
    classification: { primary: a.classification.primary, confidence: a.classification.confidence },
    layout: {
      outer: a.layout.outer,
      padding: a.layout.padding,
      display: a.layout.display,
      arrangement: a.layout.arrangement,
      rows: a.layout.rows,
      columns: a.layout.columns,
      gap: a.layout.gap,
    },
    typography: a.typography.families.map((f) => f.stack),
    tokens: a.colors.suggestedTokens,
    reference: a.reference,
  };
  return [
    '---',
    `title: "AJ Lens reconstruction prompt"`,
    `captured_at: "${a.metadata.capturedAt}"`,
    `source_origin: "${a.metadata.sourceOrigin}"`,
    `source_path: "${a.metadata.sourcePath}"`,
    `page_title: ${JSON.stringify(a.metadata.pageTitle)}`,
    `selected_element: ${JSON.stringify(`${a.selection.tagName} — ${a.selection.selector}`)}`,
    `viewport: "${v.width}x${v.height} @${v.devicePixelRatio}x"`,
    `classification: "${a.classification.primary} (${a.classification.confidence})"`,
    `reference_image: "${ARTIFACT_FILES.reference}"`,
    `analysis_file: "${ARTIFACT_FILES.analysis}"`,
    '---',
    '',
    '> Expected companion files in the same folder: `reference.png` (cropped screenshot) and `analysis.json` (full measurements).',
    '',
    prompt.trim(),
    '',
    '---',
    '',
    '## Appendix: Sanitized Measurement Summary',
    '',
    '```json',
    JSON.stringify(appendix, null, 2),
    '```',
    '',
  ].join('\n');
}

export function buildJsonExport(a: SectionAnalysis): string {
  return `${JSON.stringify(a, null, 2)}\n`;
}

/** UTF-8 safe base64 for data URLs. */
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function textDataUrl(text: string, mime: string): string {
  return `data:${mime};charset=utf-8;base64,${toBase64(text)}`;
}
