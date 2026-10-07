import { describe, expect, it } from 'vitest';
import {
  REDACTED,
  cleanText,
  describeDataUrl,
  looksLikeSecret,
  parseDataUrl,
  redactText,
  sanitizeOrigin,
  sanitizePath,
  sanitizeUrl,
} from '../src/core/sanitize';

describe('URL sanitization', () => {
  it('strips credentials', () => {
    expect(sanitizeUrl('https://user:pass@example.com/a')).toBe('https://example.com/a');
  });

  it('redacts sensitive query params and drops tracking params', () => {
    const out = sanitizeUrl(
      'https://example.com/p?id=7&token=abc&api_key=zzz&utm_source=x&gclid=1&session=s',
    );
    expect(out).toContain('id=7');
    expect(out).toContain(`token=${REDACTED}`);
    expect(out).toContain(`api_key=${REDACTED}`);
    expect(out).toContain(`session=${REDACTED}`);
    expect(out).not.toContain('utm_source');
    expect(out).not.toContain('gclid');
  });

  it('redacts secret-looking values even with innocuous names', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    expect(sanitizeUrl(`https://example.com/?x=${jwt}`)).toContain(`x=${REDACTED}`);
  });

  it('removes token-bearing fragments', () => {
    expect(sanitizeUrl('https://example.com/cb#access_token=abc&state=1')).toBe(
      'https://example.com/cb',
    );
    expect(sanitizeUrl('https://example.com/docs#install')).toBe(
      'https://example.com/docs#install',
    );
  });

  it('resolves relative URLs against a base', () => {
    expect(sanitizeUrl('/img/a.png', 'https://example.com/page')).toBe(
      'https://example.com/img/a.png',
    );
  });

  it('summarizes data, blob, javascript, mailto and tel URLs', () => {
    expect(sanitizeUrl('data:image/png;base64,AAAA')).toMatch(/^data:image\/png;\[redacted/);
    expect(sanitizeUrl('blob:https://example.com/123')).toBe('blob:[in-memory object URL]');
    expect(sanitizeUrl('javascript:alert(1)')).toBe('javascript:[script URL removed]');
    expect(sanitizeUrl('mailto:me@example.com')).toBe(`mailto:${REDACTED}`);
    expect(sanitizeUrl('tel:+15550100')).toBe(`tel:${REDACTED}`);
  });

  it('reduces page URLs to origin and redacted path', () => {
    expect(sanitizeOrigin('https://user:pw@shop.example.com:8443/a?b=c')).toBe(
      'https://shop.example.com:8443',
    );
    expect(
      sanitizePath('https://example.com/reset/9f8e7d6c5b4a39f8e7d6c5b4a3210fedcba98/confirm?x=1'),
    ).toBe(`/reset/${REDACTED}/confirm`);
  });
});

describe('sensitive data redaction', () => {
  it('parses data URL size without keeping the payload', () => {
    const payload = 'A'.repeat(4000);
    expect(parseDataUrl(`data:image/png;base64,${payload}`)).toEqual({
      mime: 'image/png',
      approxBytes: 3000,
    });
    const described = describeDataUrl(`data:image/png;base64,${payload}`);
    expect(described).not.toContain('AAAA');
    expect(described).toContain('2.9 KB');
  });

  it('detects opaque secrets', () => {
    expect(looksLikeSecret('9f8e7d6c5b4a39f8e7d6c5b4a3210fedcba98')).toBe(true);
    expect(looksLikeSecret('pricing-page')).toBe(false);
  });

  it('redacts emails, card numbers and tokens in visible text', () => {
    const out = redactText(
      'Contact jane.doe@example.com, card 4242 4242 4242 4242, token eyJhbGciOiJ.eyJzdWIiOiIx.dozjgNryP4J3',
    );
    expect(out).toContain('[email]');
    expect(out).toContain('[number]');
    expect(out).not.toContain('jane.doe');
    expect(out).not.toContain('4242 4242');
    expect(out).not.toContain('eyJhbGciOiJ');
  });

  it('cleans and truncates text', () => {
    expect(cleanText('  a \n\n b  ')).toBe('a b');
    expect(cleanText('x'.repeat(50), 10)).toHaveLength(10);
  });
});
