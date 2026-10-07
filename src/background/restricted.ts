/** Returns a user-facing reason when Chrome forbids injecting into the URL, or null when allowed. */
export function restrictionReason(url: string): string | null {
  if (!url) return null; // URL hidden (no activeTab yet) — attempt injection and handle failure.
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const p = u.protocol;
  if (
    p === 'chrome:' ||
    p === 'edge:' ||
    p === 'brave:' ||
    p === 'opera:' ||
    p === 'vivaldi:' ||
    p === 'about:' ||
    p === 'devtools:' ||
    p === 'view-source:'
  ) {
    return 'Browser pages (chrome://, edge://, about:) cannot be inspected by extensions.';
  }
  if (p === 'chrome-extension:' || p === 'moz-extension:' || p === 'extension:') {
    return 'Extension pages cannot be inspected by other extensions.';
  }
  if (p === 'chrome-search:' || p === 'chrome-untrusted:')
    return 'This Chrome page cannot be inspected.';
  if (
    u.hostname === 'chromewebstore.google.com' ||
    (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore'))
  ) {
    return 'The Chrome Web Store blocks all extensions from running on its pages.';
  }
  if (u.hostname === 'microsoftedge.microsoft.com' && u.pathname.startsWith('/addons')) {
    return 'The Edge Add-ons store blocks extensions from running on its pages.';
  }
  if (p === 'data:' || p === 'blob:') return 'data: and blob: pages cannot be inspected.';
  return null;
}
