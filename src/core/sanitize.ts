/** Privacy helpers: URL sanitization and redaction of sensitive text. */

const SENSITIVE_PARAM =
  /^(?:.*(?:token|secret|password|passwd|pwd|auth|session|sess|sid|key|apikey|signature|sig|credential|cookie|jwt|bearer|otp|code|state|nonce|ticket|hash)|x-amz-.*|x-goog-.*|email|e-mail|phone|ssn)$/i;
const TRACKING_PARAM =
  /^(?:utm_.*|fbclid|gclid|dclid|msclkid|mc_eid|mc_cid|_ga|_gl|yclid|igshid|ref_src|spm)$/i;

export const REDACTED = '[redacted]';

/**
 * Removes credentials, fragments that look like tokens, tracking parameters, and sensitive
 * query values from a URL. Returns a relative-safe string; data/blob URLs are summarized.
 */
export function sanitizeUrl(raw: string, base?: string): string {
  const value = raw.trim();
  if (!value) return '';
  if (/^data:/i.test(value)) return describeDataUrl(value);
  if (/^blob:/i.test(value)) return 'blob:[in-memory object URL]';
  if (/^javascript:/i.test(value)) return 'javascript:[script URL removed]';
  let url: URL;
  try {
    url = new URL(value, base ?? (typeof location !== 'undefined' ? location.href : undefined));
  } catch {
    return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  }
  if (!/^(https?|ftp|file|mailto|tel):$/.test(url.protocol)) {
    return `${url.protocol}[url removed]`;
  }
  if (url.protocol === 'mailto:' || url.protocol === 'tel:') {
    return `${url.protocol}${REDACTED}`;
  }
  url.username = '';
  url.password = '';
  const keep: [string, string][] = [];
  url.searchParams.forEach((v, k) => {
    if (TRACKING_PARAM.test(k)) return;
    if (SENSITIVE_PARAM.test(k) || looksLikeSecret(v)) keep.push([k, REDACTED]);
    else keep.push([k, v.length > 80 ? `${v.slice(0, 80)}…` : v]);
  });
  url.search = '';
  for (const [k, v] of keep) url.searchParams.append(k, v);
  if (url.hash && (url.hash.length > 64 || /token|access|id_token|code=/i.test(url.hash))) {
    url.hash = '';
  }
  return url.toString().replace(/%5Bredacted%5D/g, REDACTED);
}

/** Origin only, safe for metadata. */
export function sanitizeOrigin(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.protocol === 'file:') return 'file://';
    return u.origin;
  } catch {
    return 'unknown';
  }
}

/** Path without query/fragment and with long opaque segments redacted. */
export function sanitizePath(raw: string): string {
  try {
    const u = new URL(raw);
    return u.pathname
      .split('/')
      .map((seg) => (looksLikeSecret(seg) ? REDACTED : seg))
      .join('/');
  } catch {
    return '/';
  }
}

export function describeDataUrl(dataUrl: string): string {
  const info = parseDataUrl(dataUrl);
  return `data:${info.mime};[redacted ~${formatBytes(info.approxBytes)}]`;
}

export function parseDataUrl(dataUrl: string): { mime: string; approxBytes: number } {
  const comma = dataUrl.indexOf(',');
  const header = comma > 0 ? dataUrl.slice(5, comma) : dataUrl.slice(5, 60);
  const mime = header.split(';')[0] || 'application/octet-stream';
  const payload = comma > 0 ? dataUrl.length - comma - 1 : 0;
  const base64 = /;base64/i.test(header);
  const approxBytes = base64 ? Math.floor((payload * 3) / 4) : payload;
  return { mime, approxBytes };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Heuristic for opaque secrets: JWTs, long hex/base64 blobs. */
export function looksLikeSecret(value: string): boolean {
  if (value.length < 20) return false;
  if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) return true; // JWT
  if (/^[a-f0-9]{32,}$/i.test(value)) return true; // hex digests / tokens
  if (
    /^[A-Za-z0-9+/_-]{32,}={0,2}$/.test(value) &&
    /\d/.test(value) &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value)
  ) {
    return true;
  }
  return false;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const LONG_DIGITS = /\b(?:\d[ -]?){13,19}\b/g; // card-like numbers
const JWT_INLINE = /eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g;

/** Redacts emails, card-like digit runs and inline tokens from visible text. */
export function redactText(text: string): string {
  return text
    .replace(JWT_INLINE, REDACTED)
    .replace(EMAIL, '[email]')
    .replace(LONG_DIGITS, '[number]');
}

/** Collapses whitespace and truncates. */
export function cleanText(text: string, max = 160): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Attributes that are useful for reconstruction. Everything else (data-*, tracking, handlers) is dropped. */
const SAFE_ATTRIBUTE =
  /^(?:role|aria-[a-z]+|type|alt|title|placeholder|for|name|href|src|srcset|sizes|loading|target|rel|width|height|viewBox|lang|dir|open|disabled|checked|selected|required|tabindex)$/;

export function isSafeAttribute(name: string): boolean {
  return SAFE_ATTRIBUTE.test(name);
}
