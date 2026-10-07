import type { SectionAnalysis, StructureNode, StyleMap, ValueUsage } from '../../shared/types';
import type { BuildTarget, IncludeOptions, PromptDetail } from '../../shared/preferences';
import { BUILD_TARGETS, DEFAULT_INCLUDE } from '../../shared/preferences';

export interface PromptOptions {
  detail: PromptDetail;
  buildTarget: BuildTarget;
  customInstructions: string;
  include: IncludeOptions;
}

export const DEFAULT_PROMPT_OPTIONS: PromptOptions = {
  detail: 'detailed',
  buildTarget: 'existing',
  customInstructions: '',
  include: DEFAULT_INCLUDE,
};

export const DETAILED_MAX = 25000;
/** Sections at or above this priority (task, inputs, requirements, instructions) are never shortened. */
const PROTECTED_PRIORITY = 90;
export const COMPACT_MAX = 6000;

export const PROMPT_INTRO = `Reconstruct the selected website section as closely as the available evidence allows. Implement it; do not only describe it.

First inspect the destination repository to identify its framework, routing, styling system, design tokens, reusable components, asset conventions, and tests. Follow the existing project stack unless the instructions below explicitly require otherwise.

Use reference.png and section-analysis.json as implementation evidence. Treat values marked measured as direct observations and values marked inferred as recommendations requiring visual judgment.`;

const TARGET_GUIDANCE: Record<BuildTarget, string> = {
  existing:
    'Follow the existing project stack: use its framework, component patterns, styling approach (CSS modules, Tailwind, styled components, etc.), and token names. Do not introduce a new framework or styling library.',
  react:
    'Build with React function components and hooks. If the repository already has a styling convention, use it; otherwise use CSS Modules. Type props with TypeScript when the project uses TypeScript.',
  nextjs:
    'Build for Next.js. Respect the router in use (App Router vs Pages Router). Default to Server Components and mark interactive parts with "use client". Use next/image for raster images and next/link for internal links when the project already does.',
  vue: 'Build a Vue 3 single-file component using <script setup> (TypeScript if the project uses it) and scoped styles or the project styling convention.',
  nuxt: 'Build a Nuxt 3 component under the project components directory, using auto-imports, NuxtLink for internal links and NuxtImg if the project uses @nuxt/image.',
  svelte:
    'Build a Svelte component (SvelteKit conventions if present) with scoped <style> or the project styling convention.',
  astro:
    'Build an Astro component. Keep it static by default and only hydrate interactive islands (client:visible / client:idle) when interaction requires JavaScript.',
  html: 'Build with semantic HTML, a dedicated CSS file using custom properties, and minimal vanilla JavaScript only for required interactions.',
  tailwind:
    'Style with Tailwind CSS utility classes. Map measured values to the existing Tailwind theme (extend the theme for repeated custom values instead of scattering arbitrary values).',
  custom: 'Follow the custom instructions below.',
};

const bullet = (items: string[]) => items.map((i) => `- ${i}`).join('\n');

function styleLine(styles: StyleMap, max: number): string {
  const entries = Object.entries(styles).slice(0, max);
  return entries.map(([k, v]) => `${k}: ${v}`).join('; ');
}

function usageList(list: ValueUsage[], max: number): string[] {
  return list
    .slice(0, max)
    .map((u) => `\`${u.value}\` — ${u.count}× (${u.usage.slice(0, 2).join(', ')})`);
}

export function renderTree(node: StructureNode, maxLines: number, includeText: boolean): string {
  const lines: string[] = [];
  const visit = (n: StructureNode, indent: number) => {
    if (lines.length >= maxLines) return;
    const parts = [n.selector];
    if (n.role) parts.push(`[role=${n.role}]`);
    if (n.display && /flex|grid/.test(n.display)) parts.push(`{${n.display}}`);
    if (n.repeat) parts.push(`× ${n.repeat}`);
    if (n.bounds) parts.push(`(${Math.round(n.bounds.width)}×${Math.round(n.bounds.height)})`);
    if (includeText && n.text) parts.push(`"${n.text.slice(0, 50)}"`);
    if (n.label) parts.push(`aria-label="${n.label}"`);
    lines.push(`${'  '.repeat(indent)}${parts.join(' ')}`);
    for (const c of n.children) visit(c, indent + 1);
  };
  visit(node, 0);
  if (lines.length >= maxLines) lines.push('  … (truncated; see section-analysis.json)');
  return lines.join('\n');
}

interface Section {
  title: string;
  body: string;
  /** Lower = dropped first when the prompt must be shortened. */
  priority: number;
}

function buildSections(a: SectionAnalysis, o: PromptOptions): Section[] {
  const detailed = o.detail === 'detailed';
  const inc = o.include;
  const n = (d: number, c: number) => (detailed ? d : c);
  const sections: Section[] = [];
  const target =
    BUILD_TARGETS.find((t) => t.value === o.buildTarget)?.label ?? 'Existing project stack';
  const cls = a.classification;
  const sel = a.selection;

  sections.push({
    title: 'Reconstruction Task',
    priority: 100,
    body: [
      `Rebuild the **${cls.primary === 'unknown' ? 'selected section' : `${cls.primary} section`}** captured from ${a.metadata.sourceOrigin} ("${a.metadata.pageTitle || 'untitled page'}").`,
      `The section is \`${sel.selector}\` (<${sel.tagName}>), measured at ${sel.bounds.width} × ${sel.bounds.height} px in a ${a.metadata.viewport.width} × ${a.metadata.viewport.height} viewport (DPR ${a.metadata.viewport.devicePixelRatio}). It contains ${sel.descendantCount} descendant elements and ${sel.assetCount} detected assets.`,
      'Create a reusable component for this section inside the existing application. Do not replace the whole app, its layout, or unrelated pages.',
    ].join('\n\n'),
  });

  sections.push({
    title: 'Reference Inputs',
    priority: 95,
    body: bullet([
      a.reference.status === 'captured'
        ? `\`reference.png\` — cropped screenshot of the section (${a.reference.pixelSize ? `${a.reference.pixelSize.width} × ${a.reference.pixelSize.height} image px` : 'visible area'}, ${a.reference.scale ?? a.metadata.viewport.devicePixelRatio} image px per CSS px). Primary visual truth.`
        : a.reference.status === 'partial'
          ? '`reference.png` — screenshot of the **visible part only** of the section; parts outside the viewport are missing. Infer the rest from the structure and measurements.'
          : `\`reference.png\` — not available (${a.reference.note ?? a.reference.status}). Rely on measurements and structure.`,
      '`section-analysis.json` — full sanitized measurements (schema 1.0): structure, computed styles, typography, colors, assets, interactions, accessibility and responsive evidence.',
      ...(detailed
        ? [
            'Values labelled **measured** were read from the live page; **discovered** were read from accessible stylesheets; **inferred** are heuristics that need visual judgment.',
          ]
        : []),
    ]),
  });

  const reqs = [`Build target: **${target}**. ${TARGET_GUIDANCE[o.buildTarget]}`];
  if (detailed) {
    reqs.push(
      'Before editing, inspect the repository: package.json, framework config, styling setup, design tokens/theme files, shared UI components, icon library, image/asset folders, lint and test setup.',
      'Reuse existing tokens, components (buttons, cards, inputs, containers), and utilities instead of duplicating them. Map measured values to the nearest existing token when the difference is visually negligible.',
      'Place new files according to the project conventions and match its naming, formatting, and import style.',
    );
  }
  if (o.buildTarget === 'custom' && o.customInstructions.trim()) {
    reqs.push(
      `Custom instructions from the user (take precedence over defaults):\n\n${o.customInstructions.trim()}`,
    );
  }
  sections.push({ title: 'Existing Project Requirements', priority: 90, body: bullet(reqs) });

  sections.push({
    title: 'Section Classification',
    priority: 70,
    body: bullet([
      `Type: **${cls.primary}** (${cls.inferred ? 'inferred' : 'high-confidence inference'}, confidence ${cls.confidence}).`,
      `Evidence: ${cls.evidence.slice(0, n(6, 3)).join(' ')}`,
      cls.alternatives.length
        ? `Alternatives considered: ${cls.alternatives.map((x) => `${x.kind} (${x.score})`).join(', ')}.`
        : 'No strong alternatives.',
      `Density: ${cls.density}; interaction level: ${cls.interactionLevel}; content emphasis: ${cls.contentEmphasis}; dominant alignment: ${cls.dominantAlignment}.`,
    ]),
  });

  sections.push({
    title: 'Visual Summary',
    priority: 80,
    body: bullet([
      `Visual style (inferred): ${cls.visualStyle.join(', ') || 'neutral'}.`,
      `Arrangement (measured): ${a.layout.arrangement} — ${a.layout.rows} row(s) × ${a.layout.columns} column(s) at the first visual level.`,
      `Primary background: ${a.colors.backgrounds[0]?.value ?? 'unknown'}; primary text: ${a.colors.foregrounds[0]?.value ?? 'unknown'}${a.colors.accents[0] ? `; accent: ${a.colors.accents[0].value}` : ''}.`,
      a.typography.families[0]
        ? `Main typeface: ${a.typography.families[0].family} (stack: ${a.typography.families[0].stack}).`
        : 'Typeface: system default.',
      'Compare against reference.png for proportions, whitespace rhythm, and visual weight before fine-tuning numbers.',
    ]),
  });

  if (inc.domSummary) {
    const s = a.structure;
    const body = [
      'Measured DOM outline (sanitized; `× n` marks repeated siblings rendered from one component):',
      '```text',
      renderTree(s.root, n(70, 22), inc.visibleText),
      '```',
      bullet([
        `Elements: ${s.elementCount} total, ${s.analyzedElementCount} analyzed, max depth ${s.maxDepth}${s.truncated ? ' (truncated — oversized selection)' : ''}.`,
        s.landmarks.length
          ? `Landmarks: ${s.landmarks.slice(0, 8).join(', ')}.`
          : 'No landmark elements inside the section.',
        `Suggested component boundaries (inferred): ${cls.componentBoundaries.slice(0, n(8, 4)).join('; ') || 'single component'}.`,
      ]),
    ];
    sections.push({ title: 'Component Hierarchy', priority: 75, body: body.join('\n') });
  } else {
    sections.push({
      title: 'Component Hierarchy',
      priority: 75,
      body: `DOM summary excluded by the user. Suggested component boundaries (inferred): ${cls.componentBoundaries.slice(0, 4).join('; ') || 'single component'}.`,
    });
  }

  const L = a.layout;
  const layoutItems = [...L.description];
  layoutItems.push(`Content box (measured): ${L.contentBox.width} × ${L.contentBox.height} px.`);
  if (L.regions.length) {
    layoutItems.push(
      `First-level regions (measured): ${L.regions
        .slice(0, n(12, 5))
        .map(
          (r) =>
            `${r.selector} ${Math.round(r.bounds.width)}×${Math.round(r.bounds.height)} @(${Math.round(r.bounds.x - L.outer.x)}, ${Math.round(r.bounds.y - L.outer.y)})`,
        )
        .join('; ')} — offsets relative to the section's top-left corner.`,
    );
  }
  if (L.stickyOrFixed.length)
    layoutItems.push(`Sticky/fixed (measured): ${L.stickyOrFixed.join(', ')}.`);
  layoutItems.push(
    'Use flex/grid with gaps rather than absolute positioning, unless the source uses absolute layering (noted above).',
  );
  sections.push({ title: 'Layout and Geometry', priority: 85, body: bullet(layoutItems) });

  if (inc.responsive) {
    const r = a.responsive;
    const items = [
      `Measured at viewport ${r.measured.viewportWidth} × ${r.measured.viewportHeight} (${r.measured.orientation}, DPR ${r.measured.devicePixelRatio}); section spans ${Math.round(r.measured.sectionWidthRatio * 100)}% of the viewport width.`,
      ...r.clues,
    ];
    if (r.discovered.mediaQueries.length) {
      items.push(
        `Discovered media queries affecting this section: ${r.discovered.mediaQueries
          .slice(0, n(10, 4))
          .map(
            (q) =>
              `\`@media ${q.query}\` (${q.ruleCount} rule${q.ruleCount === 1 ? '' : 's'}${q.matches ? ', active now' : ''}${detailed ? `; e.g. ${q.sampleSelectors.slice(0, 2).join(', ')}` : ''})`,
          )
          .join('; ')}.`,
      );
    } else {
      items.push('Discovered media queries: none targeting this section were readable.');
    }
    items.push(...r.inferred.map((x) => (x.startsWith('Inferred') ? x : `Inferred: ${x}`)));
    sections.push({ title: 'Responsive Behavior', priority: 60, body: bullet(items) });
  } else {
    sections.push({
      title: 'Responsive Behavior',
      priority: 60,
      body: `Responsive evidence excluded by the user. Inferred: ${a.layout.mobileStackingHint}`,
    });
  }

  const T = a.typography;
  const typo: string[] = [];
  typo.push(
    `Families (measured): ${T.families.map((f) => `${f.family}${f.loaded ? ' (loaded web font)' : ''} — ${f.usage} text node(s); stack \`${f.stack}\``).join('; ') || 'none'}.`,
  );
  if (T.fontFaces.length && detailed)
    typo.push(
      `Font faces (discovered): ${T.fontFaces
        .slice(0, 10)
        .map((f) => `${f.family} ${f.weight} ${f.style}`)
        .join(', ')}.`,
    );
  if (T.headingScale.length)
    typo.push(
      `Heading scale (measured): ${T.headingScale.map((h) => `${h.tag} ${h.fontSize}/${h.lineHeight} weight ${h.fontWeight}`).join('; ')}.`,
    );
  const roleLine = (name: string, t: typeof T.body) =>
    t
      ? `${name} (measured): ${t.fontSize}/${t.lineHeight}, weight ${t.fontWeight}, ${t.color}${t.letterSpacing !== 'normal' ? `, tracking ${t.letterSpacing}` : ''}${t.textTransform !== 'none' ? `, ${t.textTransform}` : ''}.`
      : '';
  [roleLine('Body', T.body), roleLine('Label', T.label), roleLine('Control', T.control)]
    .filter(Boolean)
    .forEach((l) => typo.push(l));
  if (detailed) {
    typo.push(
      'All distinct text styles (measured; size/line-height, weight, color, count, sample):',
    );
    for (const st of T.styles.slice(0, 16)) {
      typo.push(
        `  ${st.role} <${st.tag}> ${st.fontSize}/${st.lineHeight} w${st.fontWeight}${st.fontStyle !== 'normal' ? ` ${st.fontStyle}` : ''}${st.letterSpacing !== 'normal' ? ` ls ${st.letterSpacing}` : ''}${st.textTransform !== 'none' ? ` ${st.textTransform}` : ''} ${st.color} align ${st.textAlign} ×${st.count}${inc.visibleText && st.sample ? ` — "${st.sample}"` : ''}`,
      );
    }
  }
  typo.push(
    'If the exact font is unavailable in the project, use the closest available family with matching x-height and weight, and note the substitution.',
  );
  sections.push({ title: 'Typography', priority: 78, body: bullet(typo) });

  const C = a.colors;
  const colorItems: string[] = [];
  colorItems.push(
    `Backgrounds (measured): ${usageList(C.backgrounds, n(8, 4)).join('; ') || 'none'}.`,
  );
  colorItems.push(
    `Text colors (measured): ${usageList(C.foregrounds, n(8, 4)).join('; ') || 'none'}.`,
  );
  if (C.borders.length)
    colorItems.push(`Border colors (measured): ${usageList(C.borders, n(6, 3)).join('; ')}.`);
  if (C.accents.length)
    colorItems.push(`Accent colors (measured, saturated): ${usageList(C.accents, 4).join('; ')}.`);
  if (C.gradients.length)
    colorItems.push(
      `Gradients (measured): ${C.gradients
        .slice(0, n(4, 2))
        .map((g) => `\`${g.value}\``)
        .join('; ')}.`,
    );
  if (C.spacing.length)
    colorItems.push(
      `Spacing values (measured): ${C.spacing
        .slice(0, n(14, 8))
        .map((s) => `${s.value}×${s.count}`)
        .join(', ')}.`,
    );
  if (C.controlHeights.length)
    colorItems.push(
      `Control heights (measured): ${C.controlHeights.map((c) => `${c.value}×${c.count}`).join(', ')}.`,
    );
  colorItems.push(
    'Suggested design tokens (**inferred** — rename to match the project, reuse existing tokens where equivalent):',
  );
  colorItems.push(
    '```css\n:root {\n' +
      C.suggestedTokens
        .map((t) => `  ${t.name}: ${t.value}; /* inferred: ${t.source} */`)
        .join('\n') +
      '\n}\n```',
  );
  if (inc.customProperties && C.customProperties.length) {
    colorItems.push(
      `CSS custom properties available on the section (discovered): ${C.customProperties
        .slice(0, n(30, 10))
        .map((p) => `\`${p.name}: ${p.value}\``)
        .join(', ')}.`,
    );
  }
  sections.push({ title: 'Colors and Design Tokens', priority: 77, body: bullet(colorItems) });

  const fx: string[] = [];
  if (C.radii.length)
    fx.push(`Border radius (measured): ${usageList(C.radii, n(6, 3)).join('; ')}.`);
  if (C.shadows.length)
    fx.push(
      `Shadows (measured): ${C.shadows
        .slice(0, n(5, 2))
        .map((s) => `\`${s.value}\` ×${s.count}`)
        .join('; ')}.`,
    );
  if (C.borders.length)
    fx.push(
      `Borders (measured): ${C.borders
        .slice(0, 4)
        .map((b) => `${b.value} on ${b.usage[0]}`)
        .join('; ')}.`,
    );
  const decor = L.styleEvidence.filter((e) => e.before || e.after);
  if (decor.length)
    fx.push(
      `Pseudo-element decorations (measured): ${decor
        .slice(0, n(6, 2))
        .map(
          (e) =>
            `${e.selector}${e.before ? ` ::before {${styleLine(e.before, 6)}}` : ''}${e.after ? ` ::after {${styleLine(e.after, 6)}}` : ''}`,
        )
        .join('; ')}.`,
    );
  const effects = L.styleEvidence.filter(
    (e) => e.styles.transform || e.styles.filter || e.styles['backdrop-filter'] || e.styles.opacity,
  );
  if (effects.length)
    fx.push(
      `Transforms/filters/opacity (measured): ${effects
        .slice(0, 5)
        .map(
          (e) =>
            `${e.selector} {${['transform', 'filter', 'backdrop-filter', 'opacity']
              .filter((k) => e.styles[k])
              .map((k) => `${k}: ${e.styles[k]}`)
              .join('; ')}}`,
        )
        .join('; ')}.`,
    );
  if (!fx.length)
    fx.push('No borders, radii, shadows or effects were measured — the section is flat.');
  sections.push({ title: 'Borders, Radius, Shadows and Effects', priority: 72, body: bullet(fx) });

  const assetItems = a.assets.slice(0, n(30, 10)).map((as) => {
    const parts = [
      `${as.kind} (${as.role})`,
      as.selector,
      `${as.renderedSize.width}×${as.renderedSize.height}`,
    ];
    if (as.intrinsicSize)
      parts.push(`intrinsic ${as.intrinsicSize.width}×${as.intrinsicSize.height}`);
    if (as.objectFit) parts.push(`fit ${as.objectFit}`);
    if (as.alt !== undefined) parts.push(`alt="${as.alt}"`);
    if (as.label) parts.push(`label "${as.label}"`);
    if (as.svgSummary)
      parts.push(
        `svg ${as.svgSummary.viewBox ? `viewBox ${as.svgSummary.viewBox}, ` : ''}${as.svgSummary.paths} shapes${as.svgSummary.fill ? `, fill ${as.svgSummary.fill}` : ''}`,
      );
    if (inc.assetUrls && as.src) parts.push(`src ${as.src}`);
    if (as.dataUrl)
      parts.push(`inline ${as.dataUrl.mime} ~${as.dataUrl.approxBytes} bytes (content redacted)`);
    if (inc.assetUrls && detailed && as.srcset?.length)
      parts.push(`srcset: ${as.srcset.slice(0, 3).join(', ')}`);
    return parts.join(' · ');
  });
  const assetBody = [
    assetItems.length
      ? bullet(assetItems)
      : '- No images, SVGs, videos or background images were detected.',
    detailed
      ? bullet([
          'Use supplied or project-owned assets when available. Do not hotlink third-party URLs in production; download or replace them according to the project asset conventions and licensing.',
          'For unavailable assets, create close substitutes: matching aspect ratio, dominant colors and composition; use the project icon library for icons with the same meaning and size.',
          'Inline SVG icons may be recreated as SVG components; never embed large base64 payloads.',
        ])
      : '- Use supplied assets when available; otherwise create close substitutes with the same aspect ratio and role.',
  ];
  sections.push({ title: 'Assets and Icons', priority: 68, body: assetBody.join('\n') });

  const contentItems: string[] = [];
  if (inc.visibleText) {
    const text = a.structure.visibleText.slice(0, n(80, 25));
    if (text.length)
      contentItems.push(
        `Visible text in reading order (measured, sensitive values redacted):\n${text.map((t) => `  - "${t}"`).join('\n')}`,
      );
  } else {
    contentItems.push(
      'Visible text excluded by the user — use realistic placeholder copy of similar length.',
    );
  }
  for (const p of a.structure.repeatedPatterns.slice(0, n(8, 4))) {
    contentItems.push(
      `Repeated pattern (measured): ${p.count} × \`${p.selector}\`${p.itemSize ? `, ~${p.itemSize.width}×${p.itemSize.height}px each` : ''}${inc.visibleText && p.sampleText.length ? `; samples: ${p.sampleText.map((t) => `"${t}"`).join(', ')}` : ''}. Render from a data array with one item component.`,
    );
  }
  if (a.structure.headings.length)
    contentItems.push(
      `Heading outline: ${a.structure.headings
        .slice(0, 12)
        .map((h) => `h${h.level} "${inc.visibleText ? h.text.slice(0, 60) : '…'}"`)
        .join(' → ')}.`,
    );
  sections.push({
    title: 'Visible Content and Repeated Patterns',
    priority: 74,
    body: bullet(contentItems.length ? contentItems : ['No visible text detected.']),
  });

  if (inc.interactions) {
    const items = a.interactions.slice(0, n(30, 10)).map((i) => {
      const st = Object.entries(i.states)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(', ');
      return `${i.kind}: ${i.selector}${i.text ? ` "${i.text}"` : ''}${inc.assetUrls && i.href ? ` → ${i.href}` : ''}${st ? ` [${st}]` : ''}${i.activeClasses.length ? ` classes: ${i.activeClasses.join(' ')}` : ''}${detailed && i.transition ? ` transition: ${i.transition}` : ''}`;
    });
    sections.push({
      title: 'Interactive Behavior and States',
      priority: 58,
      body: [
        items.length ? bullet(items) : '- No interactive controls detected; the section is static.',
        detailed
          ? bullet([
              'Only the current state was observed. Implement sensible hover, focus-visible, active and disabled states consistent with the project design system (inferred).',
              'Wire links and buttons to the project routes/handlers or leave clearly marked TODO handlers; do not submit forms to the source site.',
            ])
          : '- Add hover/focus-visible/active states (inferred); never submit to the source site.',
      ].join('\n'),
    });
  } else {
    sections.push({
      title: 'Interactive Behavior and States',
      priority: 58,
      body: 'Interaction evidence excluded by the user. Implement standard hover/focus/active states for any controls visible in reference.png.',
    });
  }

  const acc = a.accessibility;
  if (inc.accessibility) {
    const items = [
      `Landmarks: ${acc.landmarks.join(', ') || 'none inside the section'}; ${acc.focusableCount} focusable element(s); ${acc.namedControls} named / ${acc.unnamedControls} unnamed controls.`,
      acc.ariaAttributes.length
        ? `ARIA in use (measured): ${acc.ariaAttributes.slice(0, n(20, 8)).join(', ')}.`
        : 'No ARIA attributes in use.',
      ...acc.contrast
        .slice(0, n(8, 3))
        .map(
          (c) =>
            `Contrast ${c.ratio}:1 ${c.passesAA ? 'passes' : 'FAILS'} AA — ${c.foreground} on ${c.background}${inc.visibleText ? ` ("${c.text}")` : ''}.`,
        ),
      ...acc.issues.slice(0, n(10, 4)).map((x) => `Source issue: ${x}`),
      detailed
        ? 'Use semantic elements (headings in order, lists for lists, buttons for actions, links for navigation), keep visible focus styles, label every control, and provide alt text. Fix source issues rather than copying them.'
        : 'Use semantic elements, labelled controls, alt text and visible focus; fix source issues.',
    ];
    sections.push({ title: 'Accessibility Requirements', priority: 62, body: bullet(items) });
  } else {
    sections.push({
      title: 'Accessibility Requirements',
      priority: 62,
      body: '- Use semantic HTML, ordered headings, labelled controls, alt text and visible focus states.',
    });
  }

  sections.push({
    title: 'Implementation Instructions',
    priority: 92,
    body: detailed
      ? [
          '1. Inspect the destination repository before editing (framework, routing, styling, tokens, components, assets, tests).',
          "2. Follow the project's existing framework and conventions; reuse existing tokens and components.",
          '3. Implement only the selected section as a maintainable component (plus small sub-components for repeated items); do not replace the whole app.',
          '4. Recreate structure with semantic HTML and layout with flex/grid, gaps and padding derived from the measurements. Avoid recreating the screenshot as hard-coded pixels or absolute positioning everywhere.',
          '5. Do not use canvas unless the source truly uses canvas.',
          '6. Drive repeated items from data arrays; keep copy editable.',
          '7. Use supplied assets when available and create close substitutes for unavailable ones.',
          '8. Preserve responsive behavior: apply the discovered breakpoints, otherwise make the inferred stacking decisions explicit.',
          '9. Preserve accessibility: semantics, names, focus order, contrast.',
          '10. Mount the component where the user asked (or in an obvious demo/preview route if none was given) so it can be compared visually.',
          '11. Run the project type checks, linters and relevant tests; fix failures you introduced.',
          '12. Compare the result against reference.png at the measured viewport width and iterate until spacing, typography and colors match closely.',
          '13. Complete the implementation instead of returning only instructions, then report what was built, any assumptions, and remaining limitations.',
          ...(o.customInstructions.trim() && o.buildTarget !== 'custom'
            ? [`14. Additional user instructions: ${o.customInstructions.trim()}`]
            : []),
        ].join('\n')
      : [
          '1. Inspect the destination repository before editing; follow its framework and conventions, and reuse existing tokens and components.',
          '2. Implement only this section as a maintainable component (do not replace the whole app); drive repeated items from data.',
          '3. Use semantic HTML and flex/grid layout from the measurements — not hard-coded pixels or absolute positioning. Do not use canvas unless the source does.',
          '4. Use supplied assets or close substitutes; preserve responsive behavior and accessibility.',
          '5. Run type checks, lint and relevant tests; compare against reference.png and iterate.',
          '6. Complete the implementation, then report assumptions and limitations.',
          ...(o.customInstructions.trim() && o.buildTarget !== 'custom'
            ? [`7. Additional user instructions: ${o.customInstructions.trim()}`]
            : []),
        ].join('\n'),
  });

  sections.push({
    title: 'Visual Validation Checklist',
    priority: 88,
    body: [
      `- [ ] Outer size ≈ ${sel.bounds.width} × ${sel.bounds.height} px at a ${a.metadata.viewport.width}px-wide viewport.`,
      `- [ ] Padding ${L.padding.top}/${L.padding.right}/${L.padding.bottom}/${L.padding.left} px and ${L.gap ? `gap ${L.gap}` : 'spacing'} match.`,
      `- [ ] ${L.arrangement} arrangement with ${L.rows} row(s) × ${L.columns} column(s) at the first level.`,
      ...(detailed
        ? [
            '- [ ] Font family, sizes, weights, line heights and letter spacing match the typography section.',
            '- [ ] Background, text, border and accent colors match (use an eyedropper on reference.png).',
            '- [ ] Radii, borders and shadows match.',
            '- [ ] Images/icons have the right aspect ratio, crop and alignment.',
            '- [ ] Repeated items render from data and align identically.',
            '- [ ] Keyboard focus is visible and every control has an accessible name.',
            '- [ ] Layout adapts cleanly at ~375px, ~768px and ~1280px.',
          ]
        : [
            '- [ ] Typography, colors, radii and shadows match reference.png; layout adapts at ~375/768/1280px.',
          ]),
      '- [ ] Type check, lint and tests pass.',
    ].join('\n'),
  });

  if (inc.cssEvidence) {
    const ev = L.styleEvidence.slice(0, n(24, 4));
    const body = [
      'Normalized computed styles (measured; defaults and inherited duplicates removed). Use them as targets, not as code to paste:',
      '```css',
      ...ev.map(
        (e) =>
          `/* ${e.role} · ${Math.round(e.bounds.width)}×${Math.round(e.bounds.height)} */\n${e.selector} { ${styleLine(e.styles, detailed ? 30 : 10)} }${e.before ? `\n${e.selector}::before { ${styleLine(e.before, 10)} }` : ''}${e.after ? `\n${e.selector}::after { ${styleLine(e.after, 10)} }` : ''}`,
      ),
      '```',
    ];
    sections.push({ title: 'Source Measurements', priority: 50, body: body.join('\n') });
  } else {
    sections.push({
      title: 'Source Measurements',
      priority: 50,
      body: 'CSS evidence excluded by the user. See section-analysis.json if available.',
    });
  }

  const uncertain = [...a.assumptions, ...a.warnings.map((w) => `Warning: ${w}`)];
  uncertain.push(
    'Hover/focus/active states, animations and content outside the captured viewport were not observed.',
  );
  uncertain.push('Everything labelled inferred must be validated visually against reference.png.');
  sections.push({
    title: 'Assumptions and Uncertainties',
    priority: 86,
    body: bullet(uncertain.slice(0, n(16, 8))),
  });

  return sections;
}

const ORDER = [
  'Reconstruction Task',
  'Reference Inputs',
  'Existing Project Requirements',
  'Section Classification',
  'Visual Summary',
  'Component Hierarchy',
  'Layout and Geometry',
  'Responsive Behavior',
  'Typography',
  'Colors and Design Tokens',
  'Borders, Radius, Shadows and Effects',
  'Assets and Icons',
  'Visible Content and Repeated Patterns',
  'Interactive Behavior and States',
  'Accessibility Requirements',
  'Implementation Instructions',
  'Visual Validation Checklist',
  'Source Measurements',
  'Assumptions and Uncertainties',
];

export const PROMPT_HEADINGS = ORDER;

function render(sections: Section[]): string {
  const sorted = [...sections].sort((a, b) => ORDER.indexOf(a.title) - ORDER.indexOf(b.title));
  return [PROMPT_INTRO, ...sorted.map((s) => `# ${s.title}\n\n${s.body}`)].join('\n\n') + '\n';
}

function truncateBody(body: string, maxChars: number): string {
  if (body.length <= maxChars) return body;
  const cut = body.slice(0, maxChars);
  const lastBreak = cut.lastIndexOf('\n');
  const inFence = (cut.slice(0, lastBreak).match(/```/g) ?? []).length % 2 === 1;
  return `${cut.slice(0, lastBreak > 0 ? lastBreak : maxChars)}${inFence ? '\n```' : ''}\n- … (shortened; full data in section-analysis.json)`;
}

/** Generates the reconstruction prompt, shortening low-priority sections to respect the size budget. */
export function generatePrompt(
  analysis: SectionAnalysis,
  options: PromptOptions = DEFAULT_PROMPT_OPTIONS,
): string {
  const max = options.detail === 'detailed' ? DETAILED_MAX : COMPACT_MAX;
  const sections = buildSections(analysis, options);
  let out = render(sections);
  if (out.length <= max) return out;
  // Shrink sections from lowest priority upward until the budget is met.
  const byPriority = [...sections].sort((a, b) => a.priority - b.priority);
  for (const s of byPriority) {
    if (s.priority >= PROTECTED_PRIORITY) break;
    const excess = out.length - max;
    if (excess <= 0) break;
    const target = Math.max(options.detail === 'detailed' ? 600 : 180, s.body.length - excess - 60);
    s.body = truncateBody(s.body, target);
    out = render(sections);
  }
  return out;
}
