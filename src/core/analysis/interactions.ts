import type { InteractionKind, InteractionSummary } from '../../shared/types';
import type { AnalysisContext } from './context';
import { accessibleName } from './context';
import { conciseSelector } from '../selector';
import { redactText, sanitizeUrl } from '../sanitize';

const MAX_INTERACTIONS = 60;
const ACTIVE_CLASS =
  /(?:^|[-_])(active|current|selected|open|opened|expanded|checked|disabled|is-[a-z]+|show)$/i;
const STATE_ATTRS = [
  'aria-expanded',
  'aria-selected',
  'aria-current',
  'aria-pressed',
  'aria-checked',
  'aria-disabled',
  'aria-haspopup',
  'aria-controls',
  'aria-hidden',
  'aria-modal',
] as const;

export function interactionKind(el: Element): InteractionKind | null {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role') ?? '';
  const cls =
    `${typeof el.className === 'string' ? el.className : ''} ${el.getAttribute('aria-roledescription') ?? ''}`.toLowerCase();
  if (role === 'tab' || role === 'tablist') return 'tab';
  if (role === 'switch') return 'switch';
  if (role === 'slider' || (tag === 'input' && el.getAttribute('type') === 'range'))
    return 'slider';
  if (role === 'dialog' || role === 'alertdialog' || tag === 'dialog') return 'dialog';
  if (role === 'menu' || role === 'menubar' || role === 'menuitem') return 'menu';
  if (tag === 'details' || tag === 'summary') return 'accordion';
  if (
    /\b(carousel|swiper|slick|splide|glide|embla)\b/.test(cls) ||
    (role === 'region' && /carousel/.test(cls))
  )
    return 'carousel';
  if (el.hasAttribute('aria-haspopup') || role === 'combobox' || role === 'listbox')
    return 'dropdown';
  if (el.hasAttribute('aria-expanded') && el.hasAttribute('aria-controls')) return 'accordion';
  if (tag === 'form') return 'form';
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'textarea';
  if (tag === 'input') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    if (type === 'hidden') return null;
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
    return 'input';
  }
  if (tag === 'button' || role === 'button') return 'button';
  if (tag === 'a' && el.hasAttribute('href')) return 'link';
  if (role === 'link') return 'link';
  return null;
}

export function analyzeInteractions(ctx: AnalysisContext): InteractionSummary[] {
  const out: InteractionSummary[] = [];
  let links = 0;
  for (const el of ctx.elements) {
    if (out.length >= MAX_INTERACTIONS) break;
    const kind = interactionKind(el);
    if (!kind) continue;
    if (kind === 'link' && ++links > 30) continue;
    const states: Record<string, string | boolean> = {};
    for (const attr of STATE_ATTRS) {
      const v = el.getAttribute(attr);
      if (v !== null) states[attr] = v;
    }
    const html = el as HTMLInputElement;
    if (el.hasAttribute('disabled') || html.disabled === true) states.disabled = true;
    if (el.hasAttribute('open')) states.open = true;
    if (
      (kind === 'checkbox' || kind === 'radio' || kind === 'switch') &&
      typeof html.checked === 'boolean'
    )
      states.checked = html.checked;
    if (el.hasAttribute('required')) states.required = true;
    const s = ctx.m.style(el);
    const transition =
      s.transition && !/^all 0s/.test(s.transition) && s.transition !== 'none'
        ? s.transition
        : undefined;
    const href = kind === 'link' ? (el.getAttribute('href') ?? undefined) : undefined;
    out.push({
      kind,
      selector: conciseSelector(el),
      text: kind === 'form' ? undefined : redactText(accessibleName(el, 50)) || undefined,
      href: href && !/^javascript:/i.test(href) ? sanitizeUrl(href, ctx.doc.baseURI) : undefined,
      states,
      activeClasses: Array.from(el.classList)
        .filter((c) => ACTIVE_CLASS.test(c))
        .slice(0, 4),
      cursor: s.cursor && s.cursor !== 'auto' ? s.cursor : undefined,
      transition: transition ? transition.slice(0, 120) : undefined,
    });
  }
  return out;
}
