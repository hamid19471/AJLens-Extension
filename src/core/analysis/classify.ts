import type {
  AssetSummary,
  ClassificationSummary,
  ColorSummary,
  InteractionSummary,
  LayoutSummary,
  Rect,
  SectionKind,
  StructureSummary,
  TypographySummary,
} from '../../shared/types';
import { luminance, parseColor } from '../color';
import { px } from '../styles';

export interface ClassifierInput {
  tag: string;
  role: string;
  /** Lowercased id + class names + aria-label of the root. */
  hints: string;
  bounds: Rect;
  /** Bounds relative to the document (scroll added). */
  documentY: number;
  documentHeight: number;
  viewport: { width: number; height: number };
  structure: StructureSummary;
  layout: LayoutSummary;
  typography: TypographySummary;
  colors: ColorSummary;
  assets: AssetSummary[];
  interactions: InteractionSummary[];
}

type Scores = Map<SectionKind, { score: number; evidence: string[] }>;

const PRICE =
  /(?:[$€£¥₹]\s?\d[\d,.]*|\d[\d,.]*\s?(?:usd|eur|gbp)\b|\/\s?(?:mo|month|yr|year)\b|per (?:month|year|user|seat))/i;
const DATE =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}|\d{4}-\d{2}-\d{2}|\b\d{1,2} (?:min|minute)s? read\b/i;

export function classifySection(input: ClassifierInput): ClassificationSummary {
  const s = input.structure;
  const text = s.visibleText.join(' ');
  const lowerText = text.toLowerCase();
  const hints = `${input.hints} ${input.tag} ${input.role}`.toLowerCase();
  const tagCount = (t: string) => s.tagCounts[t] ?? 0;
  const headings = s.headings;
  const images = input.assets.filter(
    (a) => ['img', 'picture', 'background-image', 'video'].includes(a.kind) && a.role !== 'icon',
  );
  const controls = s.formControls;
  const repeated = s.repeatedPatterns;
  const biggestRepeat = repeated[0]?.count ?? 0;
  const widthRatio = input.viewport.width ? input.bounds.width / input.viewport.width : 0;
  const maxHeadingSize = Math.max(
    0,
    ...input.typography.styles.filter((t) => t.role === 'heading').map((t) => px(t.fontSize)),
  );
  const prices = (text.match(new RegExp(PRICE.source, 'gi')) ?? []).length;
  const numerals = (text.match(/\b\d[\d,.]*\s?(?:%|\+|k|m|x|×)(?=\s|$)/gi) ?? []).length;

  const scores: Scores = new Map();
  const add = (kind: SectionKind, points: number, why: string) => {
    const e = scores.get(kind) ?? { score: 0, evidence: [] };
    e.score += points;
    e.evidence.push(why);
    scores.set(kind, e);
  };
  const hint = (re: RegExp) => re.test(hints);

  // Navigation
  if (input.tag === 'nav' || input.role === 'navigation')
    add('navigation', 6, `Root is <${input.tag}>${input.role ? ` role=${input.role}` : ''}.`);
  if (hint(/\b(nav|navbar|menu|topbar|header)\b/))
    add('navigation', 2, 'Class/id names mention navigation.');
  if (s.links.length >= 3 && input.bounds.height < 140 && widthRatio > 0.6)
    add(
      'navigation',
      4,
      `${s.links.length} links in a short (${Math.round(input.bounds.height)}px) full-width bar.`,
    );
  if (input.tag === 'header' && input.documentY < 200)
    add('navigation', 3, 'Header element at the top of the page.');

  // Footer
  if (input.tag === 'footer' || input.role === 'contentinfo')
    add('footer', 7, 'Root is <footer>/contentinfo.');
  if (hint(/footer/)) add('footer', 3, 'Class/id names mention footer.');
  if (
    input.documentHeight > 0 &&
    input.documentY + input.bounds.height > input.documentHeight - 50 &&
    s.links.length >= 4
  )
    add('footer', 3, 'Link-heavy region at the bottom of the document.');
  if (/©|copyright|all rights reserved|privacy policy|terms/.test(lowerText))
    add('footer', 3, 'Copyright/legal text present.');

  // Hero
  if (
    input.documentY < input.viewport.height * 0.9 &&
    widthRatio > 0.75 &&
    input.bounds.height >= 280
  )
    add('hero', 3, 'Large, wide region near the top of the page.');
  if (tagCount('h1') > 0) add('hero', 3, 'Contains the page <h1>.');
  if (maxHeadingSize >= 36) add('hero', 2, `Display-size heading (${maxHeadingSize}px).`);
  if (hint(/hero|jumbotron|masthead|banner|splash/))
    add('hero', 4, 'Class/id names mention hero/banner.');
  if (
    s.buttons.length + s.links.length >= 1 &&
    s.buttons.length + s.links.length <= 4 &&
    headings.length <= 3 &&
    input.bounds.height >= 280
  )
    add('hero', 1, 'Few prominent calls to action.');

  // Feature grid
  if (biggestRepeat >= 3 && headings.length >= 3 && prices === 0)
    add('feature grid', 4, `${biggestRepeat} repeated items with headings.`);
  if (hint(/feature|benefit|service|capabilit/))
    add('feature grid', 4, 'Class/id names mention features.');
  if (input.assets.filter((a) => a.role === 'icon').length >= 3 && biggestRepeat >= 3)
    add('feature grid', 2, 'Repeated items with icons.');

  // Pricing
  if (prices >= 2) add('pricing', 5, `${prices} price-like values in text.`);
  if (hint(/pricing|price|plan|tier/)) add('pricing', 4, 'Class/id names mention pricing/plans.');
  if (/\b(per month|\/mo|billed|annually|monthly|free trial|most popular)\b/.test(lowerText))
    add('pricing', 3, 'Billing vocabulary present.');

  // Testimonials
  if (tagCount('blockquote') > 0 || tagCount('q') > 0)
    add('testimonials', 3, 'Contains quotations.');
  if (hint(/testimonial|review|quote|customer/))
    add('testimonials', 4, 'Class/id names mention testimonials/reviews.');
  if (input.assets.filter((a) => a.role === 'avatar').length >= 2)
    add('testimonials', 3, 'Multiple avatar images.');
  if (/★|⭐|rating|stars?\b/.test(lowerText)) add('testimonials', 1, 'Rating vocabulary present.');

  // Article / blog list
  if (input.tag === 'article' && biggestRepeat < 3) add('article', 4, 'Root is <article>.');
  if (tagCount('p') >= 4 && text.length > 1200)
    add('article', 4, `Long-form text (${tagCount('p')} paragraphs, ${text.length} chars).`);
  if (biggestRepeat >= 3 && (tagCount('time') >= 2 || DATE.test(text)) && headings.length >= 3)
    add('blog list', 6, 'Repeated items with headings and dates.');
  if (hint(/blog|post|article|news|stories/)) add('blog list', 2, 'Class/id names mention posts.');

  // Product grid / detail / checkout
  if (biggestRepeat >= 3 && prices >= 2 && images.length >= 2)
    add('product grid', 7, 'Repeated items with images and prices.');
  if (hint(/product|shop|catalog|collection/))
    add('product grid', 2, 'Class/id names mention products.');
  if (/add to (cart|bag|basket)|buy now/.test(lowerText) && biggestRepeat < 3)
    add('product detail', 6, 'Add-to-cart action on a single product.');
  if (
    /\b(size|color|colour|quantity|in stock|sku)\b/.test(lowerText) &&
    prices >= 1 &&
    biggestRepeat < 3
  )
    add('product detail', 2, 'Product option vocabulary.');
  if (/checkout|shipping|billing address|payment|order summary|subtotal/.test(lowerText))
    add('checkout', 6, 'Checkout vocabulary present.');

  // Forms
  const passwordField = controls.some((c) => c.type === 'password');
  if (input.tag === 'form' || tagCount('form') > 0) add('form', 3, 'Contains a <form>.');
  if (controls.length >= 2) add('form', 3, `${controls.length} form controls.`);
  if (passwordField) add('authentication', 7, 'Contains a password field.');
  if (/\b(sign in|log in|login|sign up|register|forgot password|create account)\b/.test(lowerText))
    add('authentication', 4, 'Authentication vocabulary present.');
  if (
    controls.some((c) => c.type === 'email') &&
    controls.length <= 2 &&
    s.buttons.length >= 1 &&
    text.length < 600
  )
    add('CTA', 3, 'Short email capture form.');
  if (/contact|get in touch|message us|send (us )?a message/.test(lowerText) || hint(/contact/))
    add('contact', 4, 'Contact vocabulary present.');
  if (tagCount('textarea') > 0) add('contact', 2, 'Contains a message textarea.');
  if (/\b(address|phone|email us)\b/.test(lowerText) && !passwordField)
    add('contact', 1, 'Contact details vocabulary.');

  // Data
  if (tagCount('table') > 0 || input.role === 'table' || input.role === 'grid')
    add('table', 6, 'Contains a table/grid.');
  if (numerals >= 3 && text.length < 800)
    add('statistics', 5, `${numerals} prominent numeric values.`);
  if (hint(/stat|metric|kpi|number|counter/)) add('statistics', 3, 'Class/id names mention stats.');
  if (tagCount('canvas') > 0 || hint(/dashboard|chart|widget|analytics/))
    add('dashboard', 4, 'Charts/canvas or dashboard naming.');
  if (numerals >= 3 && (tagCount('canvas') > 0 || tagCount('table') > 0))
    add('dashboard', 3, 'Numbers combined with charts/tables.');

  // Sidebar
  if (input.tag === 'aside' || input.role === 'complementary')
    add('sidebar', 6, 'Root is <aside>/complementary.');
  if (widthRatio < 0.32 && input.bounds.height > 400 && hint(/side|drawer|rail/))
    add('sidebar', 4, 'Narrow, tall region named sidebar.');

  // CTA
  if (hint(/\bcta\b|call-to-action|signup|newsletter|subscribe/))
    add('CTA', 4, 'Class/id names mention CTA/newsletter.');
  if (
    text.length > 0 &&
    text.length < 320 &&
    headings.length >= 1 &&
    s.buttons.length + s.links.length >= 1 &&
    s.buttons.length + s.links.length <= 3 &&
    input.bounds.height < 520 &&
    biggestRepeat < 3
  ) {
    add('CTA', 3, 'Short headline with one to three actions.');
  }

  // FAQ
  const questionHeadings = headings.filter((h) => h.text.trim().endsWith('?')).length;
  if (tagCount('details') >= 2) add('FAQ', 6, `${tagCount('details')} <details> disclosures.`);
  if (questionHeadings >= 2) add('FAQ', 4, `${questionHeadings} question-style headings.`);
  if (input.interactions.filter((i) => i.kind === 'accordion').length >= 2)
    add('FAQ', 3, 'Multiple accordion toggles.');
  if (hint(/faq|question|accordion/)) add('FAQ', 4, 'Class/id names mention FAQ.');

  // Gallery
  if (images.length >= 4 && text.length < 300)
    add('gallery', 6, `${images.length} images with little text.`);
  if (hint(/gallery|carousel|slider|lightbox|masonry|portfolio/))
    add('gallery', 3, 'Class/id names mention gallery/carousel.');

  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  const [top, second] = ranked;
  let primary: SectionKind = 'unknown';
  let confidence = 0.2;
  let evidence: string[] = [
    'No strong structural or semantic signals matched a known section type.',
  ];
  if (top && top[1].score >= 4) {
    primary = top[0];
    const margin = second ? (top[1].score - second[1].score) / top[1].score : 1;
    confidence = Math.min(0.95, 0.35 + Math.min(top[1].score, 14) / 28 + margin * 0.25);
    confidence = Math.round(confidence * 100) / 100;
    evidence = top[1].evidence;
  }

  // Qualitative descriptors.
  const areaK = (input.bounds.width * input.bounds.height) / 10000;
  const elementsPerArea = areaK > 0 ? s.analyzedElementCount / areaK : 0;
  const density: ClassificationSummary['density'] =
    elementsPerArea > 2.2 ? 'dense' : elementsPerArea < 0.5 ? 'sparse' : 'balanced';

  const visualStyle: string[] = [];
  const bg = parseColor(input.colors.backgrounds[0]?.value ?? '#ffffff');
  if (bg)
    visualStyle.push(
      luminance(bg) < 0.2
        ? 'dark surface'
        : luminance(bg) > 0.8
          ? 'light surface'
          : 'mid-tone surface',
    );
  if (input.colors.radii.some((r) => px(r.value) >= 8)) visualStyle.push('rounded corners');
  if (input.colors.shadows.length) visualStyle.push('elevated (shadows)');
  if (input.colors.borders.length) visualStyle.push('bordered elements');
  if (input.colors.gradients.length) visualStyle.push('gradients');
  if (input.typography.styles.some((t) => t.textTransform === 'uppercase'))
    visualStyle.push('uppercase labels');
  if (images.length >= 3) visualStyle.push('image-heavy');
  if (
    !input.colors.shadows.length &&
    !input.colors.gradients.length &&
    input.colors.backgrounds.length <= 2
  )
    visualStyle.push('flat/minimal');

  const interactiveCount = input.interactions.length;
  const interactionLevel: ClassificationSummary['interactionLevel'] =
    interactiveCount === 0
      ? 'static'
      : interactiveCount <= 3
        ? 'light'
        : interactiveCount <= 15
          ? 'interactive'
          : 'highly interactive';

  const contentEmphasis =
    images.length >= 3 && text.length < 400
      ? 'media-led'
      : numerals >= 3
        ? 'data-led'
        : controls.length >= 2
          ? 'input-led'
          : s.buttons.length + s.links.length > 0 && text.length < 400
            ? 'action-led'
            : 'text-led';

  const aligns = new Map<string, number>();
  for (const t of input.typography.styles) {
    const a =
      t.textAlign === 'start' || t.textAlign === 'justify'
        ? 'left'
        : t.textAlign === 'end'
          ? 'right'
          : t.textAlign;
    aligns.set(a, (aligns.get(a) ?? 0) + t.count);
  }
  const alignRanked = [...aligns.entries()].sort((a, b) => b[1] - a[1]);
  const total = alignRanked.reduce((n, [, c]) => n + c, 0);
  let dominantAlignment: ClassificationSummary['dominantAlignment'] = 'left';
  if (alignRanked[0]) {
    const [name, count] = alignRanked[0];
    dominantAlignment =
      count / total < 0.6
        ? 'mixed'
        : name === 'center'
          ? 'center'
          : name === 'right'
            ? 'right'
            : 'left';
  }

  const componentBoundaries: string[] = [];
  for (const p of repeated.slice(0, 4))
    componentBoundaries.push(`${p.count} × ${p.selector} (repeated item component)`);
  for (const r of input.layout.regions.slice(0, 6))
    componentBoundaries.push(
      `${r.selector} (${Math.round(r.bounds.width)}×${Math.round(r.bounds.height)})`,
    );

  return {
    primary,
    confidence,
    evidence,
    inferred: confidence < 0.75,
    alternatives: ranked.slice(1, 4).map(([kind, v]) => ({ kind, score: v.score })),
    density,
    visualStyle,
    contentEmphasis,
    interactionLevel,
    dominantAlignment,
    componentBoundaries,
  };
}
