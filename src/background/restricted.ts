import type { MessageKey } from '../shared/i18n';

export type RestrictionKey = Extract<
  MessageKey,
  'restrictedBrowser' | 'restrictedExtension' | 'restrictedData'
>;

/** Returns the message key explaining why Chrome forbids injecting into the URL, or null. */
export function restrictionReason(url: string): RestrictionKey | null {
  if (!url) return null; // URL hidden (no activeTab yet) — attempt injection and handle failure.
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const p = u.protocol;
  if (
    [
      'chrome:',
      'edge:',
      'brave:',
      'opera:',
      'vivaldi:',
      'about:',
      'devtools:',
      'view-source:',
      'chrome-search:',
      'chrome-untrusted:',
    ].includes(p)
  ) {
    return 'restrictedBrowser';
  }
  if (p === 'chrome-extension:' || p === 'moz-extension:' || p === 'extension:') {
    return 'restrictedExtension';
  }
  if (
    u.hostname === 'chromewebstore.google.com' ||
    (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore')) ||
    (u.hostname === 'microsoftedge.microsoft.com' && u.pathname.startsWith('/addons'))
  ) {
    return 'restrictedBrowser';
  }
  if (p === 'data:' || p === 'blob:') return 'restrictedData';
  return null;
}
