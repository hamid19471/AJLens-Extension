import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClipboardError, createClipboardService, fallbackCopy } from '../src/content/clipboard';

function shadowHost() {
  const host = document.createElement('aj-lens-root');
  document.body.append(host);
  return { host, root: host.attachShadow({ mode: 'open' }) };
}

/** jsdom has no execCommand; install a spy that records the selected textarea value. */
function installExecCommand(result: boolean, seen: string[]) {
  const fn = vi.fn((cmd: string) => {
    const active = document.activeElement?.shadowRoot?.activeElement ?? document.activeElement;
    if (cmd === 'copy' && active instanceof HTMLTextAreaElement) {
      seen.push(active.value.slice(active.selectionStart ?? 0, active.selectionEnd ?? 0));
    }
    return result;
  });
  Object.defineProperty(document, 'execCommand', { value: fn, configurable: true, writable: true });
  return fn;
}

afterEach(() => {
  document.body.innerHTML = '';
  Reflect.deleteProperty(document, 'execCommand');
});

describe('ClipboardService', () => {
  it('uses navigator.clipboard.writeText with the exact value', async () => {
    const writeText = vi.fn(async () => undefined);
    const svc = createClipboardService({
      container: () => null,
      navigator: { clipboard: { writeText } as unknown as Clipboard },
    });
    const value = '# Heading\n\n- item\n\n```css\na { b: c; }\n```\n';
    await svc.copyText(value);
    expect(writeText).toHaveBeenCalledWith(value);
  });

  it('falls back to a shadow-root textarea when the Clipboard API rejects', async () => {
    const { root } = shadowHost();
    const seen: string[] = [];
    const exec = installExecCommand(true, seen);
    const writeText = vi.fn(async () =>
      Promise.reject(new DOMException('denied', 'NotAllowedError')),
    );
    const svc = createClipboardService({
      container: () => root,
      navigator: { clipboard: { writeText } as unknown as Clipboard },
    });
    await svc.copyText('full prompt\nline 2');
    expect(writeText).toHaveBeenCalledOnce();
    expect(exec).toHaveBeenCalledWith('copy');
    expect(seen).toEqual(['full prompt\nline 2']);
  });

  it('falls back when the Clipboard API is unavailable', async () => {
    const { root } = shadowHost();
    const seen: string[] = [];
    installExecCommand(true, seen);
    const svc = createClipboardService({
      container: () => root,
      navigator: {} as Pick<Navigator, 'clipboard'>,
    });
    await svc.copyText('abc');
    expect(seen).toEqual(['abc']);
  });

  it('removes the temporary textarea and leaves nothing in the page', async () => {
    const { root } = shadowHost();
    installExecCommand(true, []);
    const before = document.querySelectorAll('textarea').length;
    await createClipboardService({
      container: () => root,
      navigator: {} as Pick<Navigator, 'clipboard'>,
    }).copyText('x');
    expect(root.querySelectorAll('textarea')).toHaveLength(0);
    expect(document.querySelectorAll('textarea')).toHaveLength(before);
  });

  it('restores the previously focused element', () => {
    const { root } = shadowHost();
    installExecCommand(true, []);
    const button = document.createElement('button');
    root.append(button);
    button.focus();
    expect(root.activeElement).toBe(button);
    expect(fallbackCopy('x', root, document)).toBe(true);
    expect(root.activeElement).toBe(button);
  });

  it('rejects with ClipboardError when every strategy fails, still cleaning up', async () => {
    const { root } = shadowHost();
    installExecCommand(false, []);
    const svc = createClipboardService({
      container: () => root,
      navigator: {
        clipboard: {
          writeText: async () => Promise.reject(new Error('no')),
        } as unknown as Clipboard,
      },
    });
    await expect(svc.copyText('x')).rejects.toBeInstanceOf(ClipboardError);
    expect(root.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('rejects when there is no fallback container', async () => {
    const svc = createClipboardService({
      container: () => null,
      navigator: {} as Pick<Navigator, 'clipboard'>,
    });
    await expect(svc.copyText('x')).rejects.toBeInstanceOf(ClipboardError);
  });

  it('copies very large values without truncation through the fallback', async () => {
    const { root } = shadowHost();
    const seen: string[] = [];
    installExecCommand(true, seen);
    const big = `START\n${'# Section\n- line ✓ قیمت\n'.repeat(120_000)}END`;
    await createClipboardService({
      container: () => root,
      navigator: {} as Pick<Navigator, 'clipboard'>,
    }).copyText(big);
    expect(seen[0].length).toBe(big.length);
    expect(seen[0]).toBe(big);
  });
});
