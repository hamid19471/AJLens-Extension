import type { SectionAnalysis } from '../../shared/types';

export const FILES = {
  prompt: 'reconstruction-prompt.md',
  reference: 'reference.png',
  analysis: 'section-analysis.json',
} as const;

/** Folder name like `section-lens/example.com-hero-2026-10-07T10-20-00`. */
export function exportFolder(a: SectionAnalysis): string {
  const host =
    a.metadata.sourceOrigin
      .replace(/^[a-z]+:\/\//, '')
      .replace(/[^\w.-]+/g, '-')
      .slice(0, 40) || 'page';
  const kind = a.classification.primary.replace(/[^\w]+/g, '-');
  const stamp = a.metadata.capturedAt.replace(/\.\d+Z$/, '').replace(/[:]/g, '-');
  return `section-lens/${host}-${kind}-${stamp}`;
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
    `title: "Section Lens reconstruction prompt"`,
    `captured_at: "${a.metadata.capturedAt}"`,
    `source_origin: "${a.metadata.sourceOrigin}"`,
    `source_path: "${a.metadata.sourcePath}"`,
    `page_title: ${JSON.stringify(a.metadata.pageTitle)}`,
    `selected_element: ${JSON.stringify(`${a.selection.tagName} — ${a.selection.selector}`)}`,
    `viewport: "${v.width}x${v.height} @${v.devicePixelRatio}x"`,
    `classification: "${a.classification.primary} (${a.classification.confidence})"`,
    `reference_image: "${FILES.reference}"`,
    `analysis_file: "${FILES.analysis}"`,
    '---',
    '',
    '> Expected companion files in the same folder: `reference.png` (cropped screenshot) and `section-analysis.json` (full measurements).',
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
