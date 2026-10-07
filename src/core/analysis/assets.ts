import type { AssetKind, AssetRole, AssetSummary, Size } from '../../shared/types';
import type { AnalysisContext } from './context';
import type { Measurer } from '../measure';
import { accessibleName } from './context';
import { conciseSelector } from '../selector';
import { cleanText, parseDataUrl, sanitizeUrl } from '../sanitize';
import { round } from '../geometry';

const MAX_ASSETS = 60;

/** Extracts url(...) references from a computed background-image value. */
export function extractCssUrls(value: string): string[] {
  const out: string[] = [];
  const re = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) if (m[2]) out.push(m[2]);
  return out;
}

export function parseSrcset(srcset: string): string[] {
  return srcset
    .split(/,\s+(?=[^\s,])/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function inferRole(
  el: Element,
  kind: AssetKind,
  size: Size,
  hint: string,
  borderRadius: string,
): AssetRole {
  const text =
    `${hint} ${typeof el.className === 'string' ? el.className : (el.getAttribute('class') ?? '')} ${el.id}`.toLowerCase();
  if (/logo|brand|wordmark/.test(text)) return 'logo';
  if (/avatar|profile|author|user-?photo/.test(text)) return 'avatar';
  const small = size.width <= 48 && size.height <= 48;
  if (small || kind === 'icon-svg' || /icon|glyph/.test(text)) return 'icon';
  const squareish = Math.abs(size.width - size.height) <= 2;
  if (
    squareish &&
    size.width <= 120 &&
    (borderRadius === '50%' || parseFloat(borderRadius) >= size.width / 2 - 1)
  )
    return 'avatar';
  if (kind === 'inline-svg' || /\.svg(\?|$)/.test(hint) || /illustration|graphic/.test(text))
    return 'illustration';
  if (kind === 'background-image' && /pattern|noise|texture|grain|bg-?decor/.test(text))
    return 'decoration';
  if (kind === 'img' || kind === 'picture' || kind === 'background-image')
    return size.width >= 120 ? 'photo' : 'unknown';
  return 'unknown';
}

function sizeOf(m: Measurer, el: Element): Size {
  const r = m.rect(el);
  return { width: round(r.width), height: round(r.height) };
}

function urlInfo(raw: string, base: string): Pick<AssetSummary, 'src' | 'inline' | 'dataUrl'> {
  if (/^data:/i.test(raw)) {
    return { src: sanitizeUrl(raw, base), inline: true, dataUrl: parseDataUrl(raw) };
  }
  return { src: sanitizeUrl(raw, base), inline: false };
}

export function analyzeAssets(ctx: AnalysisContext): AssetSummary[] {
  const assets: AssetSummary[] = [];
  const base = ctx.doc.baseURI;
  const push = (a: AssetSummary) => {
    if (assets.length < MAX_ASSETS) assets.push(a);
  };

  for (const el of ctx.elements) {
    if (assets.length >= MAX_ASSETS) break;
    const tag = el.tagName.toLowerCase();
    const s = ctx.m.style(el);
    const size = sizeOf(ctx.m, el);
    const selector = conciseSelector(el);

    if (tag === 'img') {
      const img = el as HTMLImageElement;
      const raw = img.currentSrc || img.getAttribute('src') || '';
      const inPicture = el.parentElement?.tagName.toLowerCase() === 'picture';
      const intrinsic = img.naturalWidth
        ? { width: img.naturalWidth, height: img.naturalHeight }
        : undefined;
      const srcsetAttr = img.getAttribute('srcset');
      const sources = inPicture
        ? Array.from(el.parentElement?.querySelectorAll('source') ?? []).flatMap((src) => {
            const set = src.getAttribute('srcset');
            const media = src.getAttribute('media');
            const type = src.getAttribute('type');
            return set
              ? parseSrcset(set)
                  .slice(0, 2)
                  .map((x) =>
                    `${sanitizeUrl(x.split(/\s+/)[0], base)} ${x.split(/\s+/).slice(1).join(' ')}${media ? ` (media: ${media})` : ''}${type ? ` (${type})` : ''}`.trim(),
                  )
              : [];
          })
        : [];
      const srcset = [
        ...(srcsetAttr
          ? parseSrcset(srcsetAttr)
              .slice(0, 6)
              .map((x) => {
                const [u, ...d] = x.split(/\s+/);
                return `${sanitizeUrl(u, base)}${d.length ? ` ${d.join(' ')}` : ''}`;
              })
          : []),
        ...sources,
      ].slice(0, 8);
      const alt = img.getAttribute('alt');
      const kind: AssetKind = inPicture ? 'picture' : 'img';
      push({
        kind,
        role: inferRole(el, kind, size, `${alt ?? ''} ${raw}`, s.borderTopLeftRadius),
        selector,
        renderedSize: size,
        intrinsicSize: intrinsic,
        aspectRatio:
          intrinsic && intrinsic.height
            ? round(intrinsic.width / intrinsic.height, 3)
            : size.height
              ? round(size.width / size.height, 3)
              : undefined,
        objectFit: s.objectFit && s.objectFit !== 'fill' ? s.objectFit : undefined,
        alt: alt === null ? undefined : cleanText(alt, 120),
        label: el.getAttribute('aria-label') ?? undefined,
        srcset: srcset.length ? srcset : undefined,
        ...urlInfo(raw, base),
      });
    } else if (tag === 'svg') {
      const small = size.width <= 40 && size.height <= 40;
      const kind: AssetKind = small ? 'icon-svg' : 'inline-svg';
      const firstShape = el.querySelector('path, circle, rect, polygon, line, polyline, ellipse');
      const shapeStyle = firstShape ? ctx.win.getComputedStyle(firstShape) : null;
      const label = accessibleName(el, 60);
      push({
        kind,
        role: inferRole(el, kind, size, label, s.borderTopLeftRadius),
        selector,
        renderedSize: size,
        aspectRatio: size.height ? round(size.width / size.height, 3) : undefined,
        label: label || undefined,
        inline: true,
        svgSummary: {
          viewBox: el.getAttribute('viewBox') ?? undefined,
          paths: el.querySelectorAll('path, circle, rect, polygon, line, polyline, ellipse').length,
          fill: shapeStyle?.fill ?? el.getAttribute('fill') ?? undefined,
          stroke:
            shapeStyle && shapeStyle.stroke !== 'none'
              ? shapeStyle.stroke
              : (el.getAttribute('stroke') ?? undefined),
        },
      });
      const imageEl = el.querySelector('image');
      const href = imageEl?.getAttribute('href') ?? imageEl?.getAttribute('xlink:href');
      if (href) {
        push({
          kind: 'svg-image',
          role: 'illustration',
          selector: `${selector} image`,
          renderedSize: size,
          ...urlInfo(href, base),
        });
      }
    } else if (tag === 'video') {
      const v = el as HTMLVideoElement;
      const poster = v.getAttribute('poster');
      const src =
        v.currentSrc ||
        v.getAttribute('src') ||
        el.querySelector('source')?.getAttribute('src') ||
        '';
      push({
        kind: 'video',
        role: 'photo',
        selector,
        renderedSize: size,
        intrinsicSize: v.videoWidth ? { width: v.videoWidth, height: v.videoHeight } : undefined,
        objectFit: s.objectFit !== 'fill' ? s.objectFit : undefined,
        label:
          [
            poster ? `poster: ${sanitizeUrl(poster, base)}` : '',
            v.autoplay ? 'autoplay' : '',
            v.loop ? 'loop' : '',
            v.muted ? 'muted' : '',
          ]
            .filter(Boolean)
            .join(', ') || undefined,
        ...urlInfo(src, base),
      });
    } else if (tag === 'canvas') {
      push({
        kind: 'canvas',
        role: 'unknown',
        selector,
        renderedSize: size,
        inline: true,
        label: el.getAttribute('aria-label') ?? undefined,
      });
    }

    const bgi = s.backgroundImage;
    if (bgi && bgi !== 'none') {
      for (const url of extractCssUrls(bgi).slice(0, 3)) {
        push({
          kind: 'background-image',
          role: inferRole(el, 'background-image', size, url, s.borderTopLeftRadius),
          selector,
          renderedSize: size,
          aspectRatio: size.height ? round(size.width / size.height, 3) : undefined,
          objectFit:
            s.backgroundSize && s.backgroundSize !== 'auto'
              ? `background-size: ${s.backgroundSize}`
              : undefined,
          label: el.getAttribute('aria-label') ?? undefined,
          ...urlInfo(url, base),
        });
      }
    }
  }
  return assets;
}

/** Cheap asset count used during hover (no computed styles except inline). */
export function quickAssetCount(el: Element): number {
  let count = el.querySelectorAll('img, video, canvas, svg:not(svg svg)').length;
  count += el.querySelectorAll('[style*="background-image"], [style*="background: url"]').length;
  const tag = el.tagName.toLowerCase();
  if (['img', 'video', 'canvas', 'svg'].includes(tag)) count += 1;
  return count;
}
