import type {
  BackgroundRequest,
  CaptureResponse,
  DownloadArtifactPayload,
  DownloadArtifactResponse,
} from '../shared/messages';
import { isCaptureResponse, isDownloadArtifactResponse } from '../shared/messages';

export function runtimeAvailable(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

const CONTEXT_LOST = 'AJ Lens was updated or reloaded. Reload this page to keep using it.';

async function send(message: BackgroundRequest): Promise<unknown> {
  if (!runtimeAvailable()) throw new Error(CONTEXT_LOST);
  return chrome.runtime.sendMessage(message);
}

export async function requestCapture(): Promise<CaptureResponse> {
  try {
    const res = await send({ type: 'aj-lens/capture-visible-tab' });
    return isCaptureResponse(res)
      ? res
      : { ok: false, error: 'Unexpected response from the service worker.' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Asks the service worker to save one artifact via chrome.downloads. Never throws. */
export async function requestArtifactDownload(
  payload: DownloadArtifactPayload,
): Promise<DownloadArtifactResponse> {
  if (!runtimeAvailable()) {
    return { ok: false, code: 'unavailable', error: CONTEXT_LOST };
  }
  try {
    const res = await send({ type: 'aj-lens/download-artifact', payload });
    if (isDownloadArtifactResponse(res)) return res;
    return {
      ok: false,
      code: 'unavailable',
      error: 'The AJ Lens service worker did not answer. Reload the extension and try again.',
    };
  } catch (err) {
    // Context invalidated, or the service worker could not be reached / was restarting.
    return {
      ok: false,
      code: 'unavailable',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function requestShowDownload(downloadId: number): void {
  if (!runtimeAvailable()) return;
  send({ type: 'aj-lens/show-download', downloadId }).catch(() => undefined);
}

export function notifyState(active: boolean): void {
  if (!runtimeAvailable()) return;
  send({ type: 'aj-lens/state', active }).catch(() => undefined);
}
