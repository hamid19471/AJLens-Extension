import type { Rect } from '../shared/types';
import { dirFor, messages, type Locale } from '../shared/i18n';

export interface OverlayLabel {
  /** Localized state word (e.g. "قفل‌شده"), absent while hovering. */
  prefix?: string;
  /** Selector and dimensions — always rendered LTR. */
  technical: string;
  locale: Locale;
}

/** Builds the highlight label: localized state + LTR-isolated selector and size. */
export function overlayLabel(
  selector: string,
  width: number,
  height: number,
  locked: boolean,
  locale: Locale,
): OverlayLabel {
  return {
    prefix: locked ? messages(locale).overlayLocked : undefined,
    technical: `${selector} · ${Math.round(width)} × ${Math.round(height)}`,
    locale,
  };
}

/**
 * Fixed-position highlight drawn inside the extension's shadow root. It never touches
 * the inspected element and is invisible to pointer hit-testing and assistive tech.
 */
export class Overlay {
  readonly root: HTMLDivElement;
  private box: HTMLDivElement;
  private label: HTMLDivElement;
  private last = '';

  constructor(parent: ShadowRoot) {
    const doc = parent.ownerDocument ?? document;
    this.root = doc.createElement('div');
    this.root.className = 'ajl-overlay';
    this.root.setAttribute('aria-hidden', 'true');
    this.box = doc.createElement('div');
    this.box.className = 'ajl-box';
    this.label = doc.createElement('div');
    this.label.className = 'ajl-label';
    this.root.append(this.box, this.label);
    parent.append(this.root);
    this.hide();
  }

  show(rect: Rect, text: OverlayLabel, locked: boolean): void {
    const key = `${rect.x}|${rect.y}|${rect.width}|${rect.height}|${text.prefix}|${text.technical}|${text.locale}|${locked}`;
    if (key === this.last) return;
    this.last = key;
    this.root.style.display = 'block';
    const b = this.box.style;
    b.transform = `translate(${rect.x}px, ${rect.y}px)`;
    b.width = `${Math.max(0, rect.width)}px`;
    b.height = `${Math.max(0, rect.height)}px`;
    this.box.classList.toggle('ajl-locked', locked);
    this.label.classList.toggle('ajl-locked', locked);
    const doc = this.label.ownerDocument;
    this.label.lang = text.locale;
    this.label.dir = dirFor(text.locale);
    this.label.replaceChildren();
    if (text.prefix) {
      const state = doc.createElement('span');
      state.className = 'ajl-label-state';
      state.textContent = text.prefix;
      this.label.append(state, doc.createTextNode(' · '));
    }
    const tech = doc.createElement('bdi');
    tech.dir = 'ltr';
    tech.textContent = text.technical;
    this.label.append(tech);
    // Place the label above the box, or inside it when the box touches the top edge.
    const above = rect.y >= 22;
    const lx = Math.max(0, Math.min(rect.x, window.innerWidth - 220));
    const ly = above ? rect.y - 21 : Math.max(0, rect.y) + 2;
    this.label.style.transform = `translate(${lx}px, ${ly}px)`;
  }

  hide(): void {
    this.last = '';
    this.root.style.display = 'none';
  }

  destroy(): void {
    this.root.remove();
  }
}
