/** Clipboard access for the panel, isolated behind a small interface so it can be tested and swapped. */
export interface ClipboardService {
  /** Copies `value` verbatim. Rejects when every strategy fails. */
  copyText(value: string): Promise<void>;
}

export class ClipboardError extends Error {
  constructor(message = 'Clipboard access was denied.') {
    super(message);
    this.name = 'ClipboardError';
  }
}

export interface ClipboardEnv {
  /** Where the temporary fallback textarea is mounted (the extension's shadow root). */
  container: () => ShadowRoot | HTMLElement | null;
  navigator?: Pick<Navigator, 'clipboard'>;
  document?: Document;
}

/** The element that currently has focus, looking through open shadow roots. */
function deepActiveElement(doc: Document): HTMLElement | null {
  let el: Element | null = doc.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el instanceof HTMLElement ? el : null;
}

/**
 * Copies with an off-screen textarea and execCommand('copy'). The textarea lives in the
 * extension's shadow root (never in the page's light DOM) and is removed immediately.
 */
export function fallbackCopy(
  value: string,
  container: ShadowRoot | HTMLElement,
  doc: Document,
): boolean {
  const previous = deepActiveElement(doc);
  const ta = doc.createElement('textarea');
  ta.value = value;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  ta.tabIndex = -1;
  ta.style.cssText =
    'position:fixed;top:0;left:-10000px;width:1px;height:1px;opacity:0;pointer-events:none;';
  container.append(ta);
  try {
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, value.length);
    return typeof doc.execCommand === 'function' && doc.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    ta.remove();
    if (previous && previous.isConnected) previous.focus({ preventScroll: true });
  }
}

export function createClipboardService(env: ClipboardEnv): ClipboardService {
  return {
    async copyText(value: string): Promise<void> {
      const nav = env.navigator ?? (typeof navigator !== 'undefined' ? navigator : undefined);
      const doc = env.document ?? document;
      if (nav?.clipboard && typeof nav.clipboard.writeText === 'function') {
        try {
          await nav.clipboard.writeText(value);
          return;
        } catch {
          // Permission denied or document not focused: fall through to the legacy path.
        }
      }
      const container = env.container();
      if (!container || !fallbackCopy(value, container, doc)) throw new ClipboardError();
    },
  };
}
