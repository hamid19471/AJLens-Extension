import type { BackgroundRequest, CaptureResponse, DownloadResponse } from '../shared/messages';
import { isCaptureResponse, isDownloadResponse } from '../shared/messages';

export function runtimeAvailable(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

const CONTEXT_LOST = 'Section Lens was updated or reloaded. Reload this page to keep using it.';

async function send(message: BackgroundRequest): Promise<unknown> {
  if (!runtimeAvailable()) throw new Error(CONTEXT_LOST);
  return chrome.runtime.sendMessage(message);
}

export async function requestCapture(): Promise<CaptureResponse> {
  try {
    const res = await send({ type: 'sl/capture-visible-tab' });
    return isCaptureResponse(res)
      ? res
      : { ok: false, error: 'Unexpected response from the service worker.' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function requestDownload(
  filename: string,
  dataUrl: string,
): Promise<DownloadResponse> {
  try {
    const res = await send({ type: 'sl/download', filename, dataUrl });
    return isDownloadResponse(res)
      ? res
      : { ok: false, error: 'Unexpected response from the service worker.' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function notifyState(active: boolean): void {
  if (!runtimeAvailable()) return;
  send({ type: 'sl/state', active }).catch(() => undefined);
}
