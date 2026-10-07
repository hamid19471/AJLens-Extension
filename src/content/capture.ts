import type { ReferenceInfo } from '../shared/types';
import { computeCrop, roundRect } from '../core/geometry';
import { toRect } from '../core/geometry';
import { requestCapture } from './runtime';
import type { ReferenceImage } from './store';

export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(5, comma);
  const mime = header.split(';')[0] || 'application/octet-stream';
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image.'));
    reader.readAsDataURL(blob);
  });
}

export const nextFrames = (n = 2): Promise<void> =>
  new Promise((resolve) => {
    const step = (left: number) =>
      left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1));
    step(n);
  });

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface CaptureHooks {
  hideUi(): void;
  showUi(): void;
}

export interface CaptureResult {
  info: ReferenceInfo;
  image: ReferenceImage | null;
}

/**
 * Hides the extension UI, captures the visible tab through the service worker, and crops the
 * bitmap to the element's visible rectangle. The scale comes from the bitmap width divided by
 * the viewport width, so devicePixelRatio and browser zoom are both accounted for.
 */
export async function captureElement(el: Element, hooks: CaptureHooks): Promise<CaptureResult> {
  let dataUrl: string;
  let rect;
  let viewport;
  hooks.hideUi();
  try {
    await nextFrames(2);
    await sleep(40);
    rect = toRect(el.getBoundingClientRect());
    viewport = { width: window.innerWidth, height: window.innerHeight };
    const res = await requestCapture();
    if (!res.ok) throw new Error(res.error);
    dataUrl = res.dataUrl;
  } finally {
    hooks.showUi();
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(dataUrlToBlob(dataUrl));
  } catch {
    throw new Error('The captured screenshot could not be decoded.');
  }
  try {
    const crop = computeCrop({
      rect,
      viewport,
      image: { width: bitmap.width, height: bitmap.height },
    });
    if (!crop)
      throw new Error(
        'The selected section is not visible in the viewport, so nothing could be cropped.',
      );
    const { sourceRect: s } = crop;
    const canvas = document.createElement('canvas');
    canvas.width = s.width;
    canvas.height = s.height;
    const ctx = canvas.getContext('2d');
    if (!ctx)
      throw new Error('Canvas 2D context unavailable; the screenshot could not be cropped.');
    ctx.drawImage(bitmap, s.x, s.y, s.width, s.height, 0, 0, s.width, s.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The cropped screenshot could not be encoded as PNG.');
    return {
      image: { blob, width: s.width, height: s.height },
      info: {
        fileName: 'reference.png',
        status: crop.clipped ? 'partial' : 'captured',
        capturedRect: roundRect(crop.cssRect),
        scale: crop.scale,
        pixelSize: { width: s.width, height: s.height },
        note: crop.clipped
          ? `Only ${Math.round(crop.visibleFraction * 100)}% of the section was visible.`
          : undefined,
      },
    };
  } finally {
    bitmap.close();
  }
}
