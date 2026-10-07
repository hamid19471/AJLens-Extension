import { isContentRequest } from '../shared/messages';
import { HOST_TAG } from '../core/filters';
import { InspectorController } from './controller';
import { notifyState, runtimeAvailable } from './runtime';

declare const __AJL_VERSION__: string;

interface AJLensGlobal {
  version: string;
  toggle(): boolean;
  isActive(): boolean;
}

declare global {
  interface Window {
    __ajLens?: AJLensGlobal;
  }
}

function bootstrap(): void {
  if (window.top !== window) return; // top frame only
  if (window.__ajLens) return;

  // Remove UI orphaned by a previous extension instance (e.g. after an update).
  // 'section-lens-root' is the host tag used before the AJ Lens rename.
  document.querySelectorAll(`${HOST_TAG}, section-lens-root`).forEach((n) => n.remove());

  let controller: InspectorController | null = null;
  const api: AJLensGlobal = {
    version: typeof __AJL_VERSION__ === 'string' ? __AJL_VERSION__ : 'dev',
    toggle() {
      if (controller) {
        controller.destroy();
        controller = null;
        return false;
      }
      controller = new InspectorController({
        onClose: () => {
          controller = null;
          notifyState(false);
        },
      });
      controller.start();
      return true;
    },
    isActive: () => controller !== null,
  };
  window.__ajLens = api;

  if (runtimeAvailable()) {
    chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id || !isContentRequest(message)) return false;
      if (message.type === 'aj-lens/toggle') sendResponse({ ok: true, active: api.toggle() });
      else sendResponse({ ok: true, version: api.version });
      return false;
    });
  }
}

bootstrap();
