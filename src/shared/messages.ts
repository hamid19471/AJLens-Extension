/** Typed messages exchanged between the service worker and the content script. */
import {
  ARTIFACT_FILES,
  ARTIFACT_MIME,
  EXPORT_DIRECTORY_PATTERN,
  type ArtifactType,
} from '../core/prompt/export';

export type ArtifactContent = { kind: 'text'; value: string } | { kind: 'dataUrl'; value: string };

export interface DownloadArtifactPayload {
  artifactType: ArtifactType;
  /** Relative directory inside Downloads, always `AJ-Lens/<segment>`. */
  directory: string;
  /** Must equal the fixed filename for the artifact type. */
  filename: string;
  mimeType: string;
  content: ArtifactContent;
}

export type DownloadErrorCode =
  | 'permission'
  | 'unavailable'
  | 'invalid-request'
  | 'invalid-data'
  | 'filename'
  | 'cancelled'
  | 'rejected';

export type ContentRequest = { type: 'aj-lens/toggle' } | { type: 'aj-lens/ping' };

export type BackgroundRequest =
  | { type: 'aj-lens/capture-visible-tab' }
  | { type: 'aj-lens/download-artifact'; payload: DownloadArtifactPayload }
  | { type: 'aj-lens/show-download'; downloadId: number }
  | { type: 'aj-lens/state'; active: boolean };

export interface ToggleResponse {
  ok: true;
  active: boolean;
}

export interface PingResponse {
  ok: true;
  version: string;
}

export type CaptureResponse = { ok: true; dataUrl: string } | { ok: false; error: string };

export type DownloadArtifactResponse =
  | { ok: true; downloadId: number; relativePath: string }
  | { ok: false; code: DownloadErrorCode; error: string };

export type StateResponse = { ok: true };

export type ResponseFor<T extends ContentRequest | BackgroundRequest> = T extends {
  type: 'aj-lens/toggle';
}
  ? ToggleResponse
  : T extends { type: 'aj-lens/ping' }
    ? PingResponse
    : T extends { type: 'aj-lens/capture-visible-tab' }
      ? CaptureResponse
      : T extends { type: 'aj-lens/download-artifact' }
        ? DownloadArtifactResponse
        : StateResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const PNG_DATA_URL = /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+$/;
const MAX_TEXT = 20 * 1024 * 1024;
const MAX_DATA_URL = 60 * 1024 * 1024;

function isArtifactType(value: unknown): value is ArtifactType {
  return value === 'reference' || value === 'prompt' || value === 'analysis';
}

/**
 * Strict validation for export requests: the directory must be `AJ-Lens/<safe segment>`, the
 * filename and MIME type must match the artifact type, and screenshots must be real PNG data.
 */
export function isDownloadArtifactPayload(value: unknown): value is DownloadArtifactPayload {
  if (!isRecord(value) || !isArtifactType(value.artifactType)) return false;
  const type = value.artifactType;
  if (typeof value.directory !== 'string' || !EXPORT_DIRECTORY_PATTERN.test(value.directory))
    return false;
  if (value.filename !== ARTIFACT_FILES[type] || value.mimeType !== ARTIFACT_MIME[type])
    return false;
  const content = value.content;
  if (!isRecord(content) || typeof content.value !== 'string' || content.value.length === 0)
    return false;
  if (type === 'reference') {
    return (
      content.kind === 'dataUrl' &&
      content.value.length <= MAX_DATA_URL &&
      PNG_DATA_URL.test(content.value)
    );
  }
  return content.kind === 'text' && content.value.length <= MAX_TEXT;
}

export function isContentRequest(value: unknown): value is ContentRequest {
  if (!isRecord(value)) return false;
  return value.type === 'aj-lens/toggle' || value.type === 'aj-lens/ping';
}

export function isBackgroundRequest(value: unknown): value is BackgroundRequest {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'aj-lens/capture-visible-tab':
      return true;
    case 'aj-lens/state':
      return typeof value.active === 'boolean';
    case 'aj-lens/download-artifact':
      return isDownloadArtifactPayload(value.payload);
    case 'aj-lens/show-download':
      return Number.isInteger(value.downloadId) && (value.downloadId as number) >= 0;
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

export function isDownloadArtifactResponse(value: unknown): value is DownloadArtifactResponse {
  if (!isRecord(value)) return false;
  if (value.ok === true)
    return typeof value.downloadId === 'number' && typeof value.relativePath === 'string';
  return value.ok === false && typeof value.error === 'string' && typeof value.code === 'string';
}
