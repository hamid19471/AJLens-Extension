import type { Rect } from '../shared/types';

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
    this.root.className = 'sl-overlay';
    this.root.setAttribute('aria-hidden', 'true');
    this.box = doc.createElement('div');
    this.box.className = 'sl-box';
    this.label = doc.createElement('div');
    this.label.className = 'sl-label';
    this.root.append(this.box, this.label);
    parent.append(this.root);
    this.hide();
  }

  show(rect: Rect, text: string, locked: boolean): void {
    const key = `${rect.x}|${rect.y}|${rect.width}|${rect.height}|${text}|${locked}`;
    if (key === this.last) return;
    this.last = key;
    this.root.style.display = 'block';
    const b = this.box.style;
    b.transform = `translate(${rect.x}px, ${rect.y}px)`;
    b.width = `${Math.max(0, rect.width)}px`;
    b.height = `${Math.max(0, rect.height)}px`;
    this.box.classList.toggle('sl-locked', locked);
    this.label.classList.toggle('sl-locked', locked);
    this.label.textContent = text;
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
