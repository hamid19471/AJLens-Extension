import { isContentRequest } from '../shared/messages';
import { HOST_TAG } from '../core/filters';
import { InspectorController } from './controller';
import { notifyState, runtimeAvailable } from './runtime';

declare const __SL_VERSION__: string;

interface SectionLensGlobal {
  version: string;
  toggle(): boolean;
  isActive(): boolean;
}

declare global {
  interface Window {
    __sectionLens?: SectionLensGlobal;
  }
}

function bootstrap(): void {
  if (window.top !== window) return; // top frame only
  if (window.__sectionLens) return;

  // Remove UI orphaned by a previous extension instance (e.g. after an update).
  document.querySelectorAll(HOST_TAG).forEach((n) => n.remove());

  let controller: InspectorController | null = null;
  const api: SectionLensGlobal = {
    version: typeof __SL_VERSION__ === 'string' ? __SL_VERSION__ : 'dev',
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
  window.__sectionLens = api;

  if (runtimeAvailable()) {
    chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id || !isContentRequest(message)) return false;
      if (message.type === 'sl/toggle') sendResponse({ ok: true, active: api.toggle() });
      else sendResponse({ ok: true, version: api.version });
      return false;
    });
  }
}

bootstrap();
