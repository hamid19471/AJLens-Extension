/** Typed messages exchanged between the service worker and the content script. */

export type ContentRequest = { type: 'sl/toggle' } | { type: 'sl/ping' };

export type BackgroundRequest =
  | { type: 'sl/capture-visible-tab' }
  | { type: 'sl/download'; filename: string; dataUrl: string }
  | { type: 'sl/state'; active: boolean };

export interface ToggleResponse {
  ok: true;
  active: boolean;
}

export interface PingResponse {
  ok: true;
  version: string;
}

export type CaptureResponse = { ok: true; dataUrl: string } | { ok: false; error: string };

export type DownloadResponse = { ok: true; downloadId: number } | { ok: false; error: string };

export type StateResponse = { ok: true };

export type ResponseFor<T extends ContentRequest | BackgroundRequest> = T extends {
  type: 'sl/toggle';
}
  ? ToggleResponse
  : T extends { type: 'sl/ping' }
    ? PingResponse
    : T extends { type: 'sl/capture-visible-tab' }
      ? CaptureResponse
      : T extends { type: 'sl/download' }
        ? DownloadResponse
        : StateResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const SAFE_FILENAME = /^[\w\-./ ]{1,200}$/;

export function isContentRequest(value: unknown): value is ContentRequest {
  if (!isRecord(value)) return false;
  return value.type === 'sl/toggle' || value.type === 'sl/ping';
}

export function isBackgroundRequest(value: unknown): value is BackgroundRequest {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'sl/capture-visible-tab':
      return true;
    case 'sl/state':
      return typeof value.active === 'boolean';
    case 'sl/download':
      return (
        typeof value.filename === 'string' &&
        SAFE_FILENAME.test(value.filename) &&
        !value.filename.includes('..') &&
        !value.filename.startsWith('/') &&
        typeof value.dataUrl === 'string' &&
        /^data:[\w.+-]+\/[\w.+-]+(;charset=[\w-]+)?;base64,/.test(value.dataUrl)
      );
    default:
      return false;
  }
}

export function isCaptureResponse(value: unknown): value is CaptureResponse {
  if (!isRecord(value)) return false;
  if (value.ok === true)
    return typeof value.dataUrl === 'string' && value.dataUrl.startsWith('data:image/');
  return value.ok === false && typeof value.error === 'string';
}

export function isDownloadResponse(value: unknown): value is DownloadResponse {
  if (!isRecord(value)) return false;
  if (value.ok === true) return typeof value.downloadId === 'number';
  return value.ok === false && typeof value.error === 'string';
}
