import type {
  DownloadArtifactPayload,
  DownloadArtifactResponse,
  DownloadErrorCode,
} from '../shared/messages';
import { artifactPath, textDataUrl } from '../core/prompt/export';

/** The subset of chrome.downloads used here (injectable for tests). */
export interface DownloadsApi {
  download(options: chrome.downloads.DownloadOptions): Promise<number>;
  onChanged: {
    addListener(cb: (delta: chrome.downloads.DownloadDelta) => void): void;
    removeListener(cb: (delta: chrome.downloads.DownloadDelta) => void): void;
  };
}

/** How long to watch a new download for an immediate interruption (cancel, invalid file). */
export const ACCEPT_WINDOW_MS = 1500;

function fail(code: DownloadErrorCode, error: string): DownloadArtifactResponse {
  return { ok: false, code, error };
}

/**
 * Resolves once Chrome has accepted the download: completed, still in progress after the
 * acceptance window, or interrupted (user cancelled a Save As dialog, disk error, …).
 */
function watchAcceptance(
  api: DownloadsApi,
  id: number,
  windowMs: number,
): Promise<{ interrupted: false } | { interrupted: true; reason: string }> {
  return new Promise((resolve) => {
    const done = (r: { interrupted: false } | { interrupted: true; reason: string }) => {
      clearTimeout(timer);
      api.onChanged.removeListener(listener);
      resolve(r);
    };
    const listener = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== id) return;
      if (delta.state?.current === 'interrupted') {
        done({ interrupted: true, reason: delta.error?.current ?? 'INTERRUPTED' });
      } else if (delta.state?.current === 'complete') {
        done({ interrupted: false });
      }
    };
    const timer = setTimeout(() => done({ interrupted: false }), windowMs);
    api.onChanged.addListener(listener);
  });
}

/**
 * Saves one inspection artifact under the browser's Downloads directory as
 * `AJ-Lens/<capture-folder>/<fixed filename>`. Text is encoded as UTF-8 data URLs (service
 * workers have no URL.createObjectURL); the screenshot arrives as a PNG data URL. Nothing is
 * kept after Chrome accepts the download.
 */
export async function downloadArtifact(
  payload: DownloadArtifactPayload,
  api: DownloadsApi | undefined = typeof chrome !== 'undefined' ? chrome.downloads : undefined,
  windowMs = ACCEPT_WINDOW_MS,
): Promise<DownloadArtifactResponse> {
  if (!api || typeof api.download !== 'function') {
    return fail('permission', 'The "downloads" permission is unavailable.');
  }
  const relativePath = artifactPath(payload.directory, payload.artifactType);
  let url: string;
  if (payload.content.kind === 'dataUrl') {
    url = payload.content.value;
  } else {
    if (payload.artifactType === 'analysis') {
      try {
        JSON.parse(payload.content.value);
      } catch {
        return fail('invalid-data', 'analysis.json is not valid JSON.');
      }
    }
    url = textDataUrl(payload.content.value, payload.mimeType.split(';')[0]);
  }
  let downloadId: number;
  try {
    downloadId = await api.download({
      url,
      filename: relativePath,
      saveAs: false,
      conflictAction: 'uniquify',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(/filename/i.test(message) ? 'filename' : 'rejected', message);
  }
  if (typeof downloadId !== 'number') return fail('rejected', 'Chrome did not start the download.');
  const outcome = await watchAcceptance(api, downloadId, windowMs);
  if (outcome.interrupted) {
    return fail(/USER_CANCELED/i.test(outcome.reason) ? 'cancelled' : 'rejected', outcome.reason);
  }
  return { ok: true, downloadId, relativePath };
}
