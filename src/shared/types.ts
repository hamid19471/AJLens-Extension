import type { MessageKey } from './i18n';

/**
 * Versioned schema for analysis.json and the in-memory analysis model.
 * Every field is plain JSON so it can be exported verbatim.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface BoxSides {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** measured = direct observation, discovered = read from CSS, inferred = heuristic. */
export type Provenance = 'measured' | 'discovered' | 'inferred';

export type SectionKind =
  | 'hero'
  | 'navigation'
  | 'footer'
  | 'feature grid'
  | 'pricing'
  | 'testimonials'
  | 'article'
  | 'blog list'
  | 'product grid'
  | 'product detail'
  | 'checkout'
  | 'form'
  | 'authentication'
  | 'dashboard'
  | 'statistics'
  | 'table'
  | 'sidebar'
  | 'CTA'
  | 'FAQ'
  | 'gallery'
  | 'contact'
  | 'unknown';

export interface StructureNode {
  tag: string;
  selector: string;
  depth: number;
  id?: string;
  classes: string[];
  role?: string;
  label?: string;
  text?: string;
  display?: string;
  bounds?: Rect;
  /** Number of consecutive siblings collapsed into this node (>= 2 when repeated). */
  repeat?: number;
  children: StructureNode[];
}

export interface HeadingInfo {
  level: number;
  text: string;
}

export interface ListInfo {
  selector: string;
  ordered: boolean;
  itemCount: number;
}

export interface FormControlInfo {
  tag: string;
  type: string;
  name?: string;
  label?: string;
  placeholder?: string;
  required: boolean;
  autocomplete?: string;
}

export type LinkIntent =
  'internal' | 'external' | 'anchor' | 'mailto' | 'tel' | 'javascript' | 'other';

export interface LinkInfo {
  text: string;
  intent: LinkIntent;
  href?: string;
  opensNewTab: boolean;
}

export interface ButtonInfo {
  text: string;
  type: string;
  label?: string;
}

export interface RepeatedPattern {
  selector: string;
  signature: string;
  count: number;
  itemSize?: Size;
  sampleText: string[];
}

export interface StructureSummary {
  root: StructureNode;
  stableSelector: string;
  elementCount: number;
  analyzedElementCount: number;
  maxDepth: number;
  truncated: boolean;
  tagCounts: Record<string, number>;
  landmarks: string[];
  headings: HeadingInfo[];
  lists: ListInfo[];
  formControls: FormControlInfo[];
  links: LinkInfo[];
  buttons: ButtonInfo[];
  repeatedPatterns: RepeatedPattern[];
  visibleText: string[];
}

export type StyleMap = Record<string, string>;

export type ElementRole =
  'root' | 'container' | 'heading' | 'text' | 'control' | 'media' | 'decoration';

export interface ElementStyleEvidence {
  selector: string;
  tag: string;
  role: ElementRole;
  bounds: Rect;
  styles: StyleMap;
  before?: StyleMap;
  after?: StyleMap;
}

export interface LayoutRegion {
  selector: string;
  tag: string;
  bounds: Rect;
  display: string;
}

export interface LayoutSummary {
  outer: Rect;
  contentBox: Rect;
  padding: BoxSides;
  display: string;
  position: string;
  flexDirection?: string;
  flexWrap?: string;
  gridTemplateColumns?: string;
  gridTemplateRows?: string;
  gap?: string;
  alignItems?: string;
  justifyContent?: string;
  arrangement: 'row' | 'column' | 'grid' | 'stack' | 'single' | 'overlap' | 'empty';
  columns: number;
  rows: number;
  centeredContainer: boolean;
  maxContentWidth?: number;
  absoluteElements: number;
  overlappingLayers: number;
  stickyOrFixed: string[];
  regions: LayoutRegion[];
  description: string[];
  mobileStackingHint: string;
  styleEvidence: ElementStyleEvidence[];
}

export type TypographyRole = 'heading' | 'body' | 'label' | 'control' | 'other';

export interface TypographyStyle {
  role: TypographyRole;
  tag: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  lineHeight: string;
  letterSpacing: string;
  textTransform: string;
  textAlign: string;
  textDecoration: string;
  color: string;
  count: number;
  sample: string;
}

export interface FontFamilyInfo {
  family: string;
  stack: string;
  usage: number;
  loaded: boolean;
}

export interface FontFaceInfo {
  family: string;
  weight: string;
  style: string;
  source: 'document.fonts' | 'stylesheet';
}

export interface TypographySummary {
  families: FontFamilyInfo[];
  fontFaces: FontFaceInfo[];
  styles: TypographyStyle[];
  headingScale: { tag: string; fontSize: string; fontWeight: string; lineHeight: string }[];
  body?: TypographyStyle;
  label?: TypographyStyle;
  control?: TypographyStyle;
}

export interface ValueUsage {
  value: string;
  count: number;
  usage: string[];
}

export interface DesignToken {
  name: string;
  value: string;
  provenance: 'inferred';
  source: string;
}

export interface ColorSummary {
  backgrounds: ValueUsage[];
  foregrounds: ValueUsage[];
  borders: ValueUsage[];
  accents: ValueUsage[];
  gradients: ValueUsage[];
  shadows: ValueUsage[];
  radii: ValueUsage[];
  spacing: ValueUsage[];
  controlHeights: ValueUsage[];
  customProperties: { name: string; value: string }[];
  suggestedTokens: DesignToken[];
}

export type AssetKind =
  | 'img'
  | 'picture'
  | 'background-image'
  | 'inline-svg'
  | 'icon-svg'
  | 'video'
  | 'canvas'
  | 'svg-image';

export type AssetRole =
  'logo' | 'icon' | 'illustration' | 'photo' | 'avatar' | 'decoration' | 'unknown';

export interface AssetSummary {
  kind: AssetKind;
  role: AssetRole;
  selector: string;
  renderedSize: Size;
  intrinsicSize?: Size;
  aspectRatio?: number;
  objectFit?: string;
  alt?: string;
  label?: string;
  src?: string;
  srcset?: string[];
  inline: boolean;
  dataUrl?: { mime: string; approxBytes: number };
  svgSummary?: { viewBox?: string; paths: number; fill?: string; stroke?: string };
}

export type InteractionKind =
  | 'link'
  | 'button'
  | 'form'
  | 'input'
  | 'select'
  | 'textarea'
  | 'checkbox'
  | 'radio'
  | 'tab'
  | 'accordion'
  | 'menu'
  | 'dropdown'
  | 'slider'
  | 'carousel'
  | 'dialog'
  | 'switch';

export interface InteractionSummary {
  kind: InteractionKind;
  selector: string;
  text?: string;
  href?: string;
  states: Record<string, string | boolean>;
  activeClasses: string[];
  cursor?: string;
  transition?: string;
}

export interface ContrastSample {
  text: string;
  foreground: string;
  background: string;
  ratio: number;
  passesAA: boolean;
}

export interface AccessibilitySummary {
  landmarks: string[];
  headingOutline: HeadingInfo[];
  namedControls: number;
  unnamedControls: number;
  imagesMissingAlt: number;
  focusableCount: number;
  ariaAttributes: string[];
  contrast: ContrastSample[];
  issues: string[];
}

export interface MediaQueryEvidence {
  query: string;
  matches: boolean;
  ruleCount: number;
  sampleSelectors: string[];
}

export interface ResponsiveSummary {
  measured: {
    viewportWidth: number;
    viewportHeight: number;
    devicePixelRatio: number;
    orientation: 'portrait' | 'landscape';
    sectionWidthRatio: number;
  };
  discovered: {
    mediaQueries: MediaQueryEvidence[];
    containerQueries: number;
    inaccessibleStylesheets: number;
    accessibleStylesheets: number;
  };
  activeBreakpoints: string[];
  clues: string[];
  inferred: string[];
}

export interface ClassificationSummary {
  primary: SectionKind;
  confidence: number;
  evidence: string[];
  inferred: boolean;
  alternatives: { kind: SectionKind; score: number }[];
  density: 'sparse' | 'balanced' | 'dense';
  visualStyle: string[];
  contentEmphasis: string;
  interactionLevel: 'static' | 'light' | 'interactive' | 'highly interactive';
  dominantAlignment: 'left' | 'center' | 'right' | 'mixed';
  componentBoundaries: string[];
}

export interface ReferenceInfo {
  fileName: 'reference.png';
  status: 'captured' | 'partial' | 'skipped' | 'failed';
  /** Cropped area in CSS pixels relative to the viewport at capture time. */
  capturedRect?: Rect;
  /** Captured image pixels per CSS pixel (devicePixelRatio × zoom). */
  scale?: number;
  pixelSize?: Size;
  note?: string;
}

export interface SectionAnalysis {
  schemaVersion: '1.0';
  metadata: {
    capturedAt: string;
    sourceOrigin: string;
    sourcePath: string;
    pageTitle: string;
    viewport: {
      width: number;
      height: number;
      devicePixelRatio: number;
    };
    scroll: { x: number; y: number };
    generator: string;
  };
  selection: {
    tagName: string;
    selector: string;
    bounds: Rect;
    descendantCount: number;
    assetCount: number;
    accessibleName?: string;
  };
  classification: ClassificationSummary;
  structure: StructureSummary;
  layout: LayoutSummary;
  typography: TypographySummary;
  colors: ColorSummary;
  assets: AssetSummary[];
  interactions: InteractionSummary[];
  accessibility: AccessibilitySummary;
  responsive: ResponsiveSummary;
  reference: ReferenceInfo;
  assumptions: string[];
  warnings: string[];
}

export type AnalysisStage =
  | 'measuring'
  | 'layout'
  | 'typography'
  | 'assets'
  | 'responsive'
  | 'capturing'
  | 'classifying'
  | 'prompt'
  | 'ready';

/** Dictionary keys for progress messages (see shared/i18n.ts). */
export const STAGE_MESSAGE_KEYS = {
  measuring: 'stageMeasuring',
  layout: 'stageLayout',
  typography: 'stageTypography',
  assets: 'stageAssets',
  responsive: 'stageResponsive',
  capturing: 'stageCapturing',
  classifying: 'stageClassifying',
  prompt: 'stagePrompt',
  ready: 'stageReady',
} as const satisfies Record<AnalysisStage, MessageKey>;

export const STAGE_ORDER: AnalysisStage[] = [
  'measuring',
  'layout',
  'typography',
  'assets',
  'responsive',
  'capturing',
  'classifying',
  'prompt',
  'ready',
];
