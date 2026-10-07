import type {
  BackgroundRequest,
  CaptureResponse,
  DownloadResponse,
  ToggleResponse,
} from '../shared/messages';
import { isBackgroundRequest } from '../shared/messages';
import { restrictionReason } from './restricted';

const CONTENT_SCRIPT = 'content.js';
const NOTICE_PAGE = 'notice.html';

async function showNotice(tabId: number | undefined, reason: string): Promise<void> {
  const popup = `${NOTICE_PAGE}?reason=${encodeURIComponent(reason)}`;
  try {
    if (tabId !== undefined) await chrome.action.setPopup({ tabId, popup });
    await chrome.action.openPopup();
  } catch {
    // openPopup can fail without a user gesture or on older Chrome; the badge still signals the problem.
  }
  if (tabId !== undefined) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#d56d6d' });
    await chrome.action.setBadgeText({ tabId, text: '!' });
    await chrome.action.setTitle({ tabId, title: `AJ Lens — ${reason}` });
  }
}

async function setActiveBadge(tabId: number, active: boolean): Promise<void> {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#718f50' });
    await chrome.action.setBadgeText({ tabId, text: active ? 'ON' : '' });
    await chrome.action.setTitle({
      tabId,
      title: active ? 'AJ Lens — inspector active' : 'AJ Lens',
    });
  } catch {
    // Tab may have closed.
  }
}

async function sendToggle(tabId: number): Promise<ToggleResponse | null> {
  try {
    const res: unknown = await chrome.tabs.sendMessage(tabId, { type: 'aj-lens/toggle' });
    if (res && typeof res === 'object' && (res as ToggleResponse).ok) return res as ToggleResponse;
    return null;
  } catch {
    return null;
  }
}

async function toggleInspector(tab: chrome.tabs.Tab): Promise<void> {
  const tabId = tab.id;
  if (tabId === undefined) return;
  const reason = restrictionReason(tab.url ?? '');
  if (reason) {
    await showNotice(tabId, reason);
    return;
  }
  let res = await sendToggle(tabId);
  if (!res) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: [CONTENT_SCRIPT],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const friendly = /cannot be scripted|cannot access|chrome-extension|webstore|gallery/i.test(
        message,
      )
        ? 'Chrome does not allow extensions to run on this page.'
        : /file:/i.test(tab.url ?? '')
          ? 'Enable "Allow access to file URLs" for AJ Lens in chrome://extensions to inspect local files.'
          : `AJ Lens could not be injected: ${message}`;
      await showNotice(tabId, friendly);
      return;
    }
    res = await sendToggle(tabId);
  }
  if (res) await setActiveBadge(tabId, res.active);
  else await showNotice(tabId, 'The page did not respond. Reload the tab and try again.');
}

chrome.action.onClicked.addListener((tab) => {
  void toggleInspector(tab);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    // Navigation tears down the content script; reset per-tab action state.
    void chrome.action.setPopup({ tabId, popup: '' }).catch(() => undefined);
    void chrome.action.setBadgeText({ tabId, text: '' }).catch(() => undefined);
    void chrome.action.setTitle({ tabId, title: 'AJ Lens' }).catch(() => undefined);
  }
});

async function handleCapture(sender: chrome.runtime.MessageSender): Promise<CaptureResponse> {
  const windowId = sender.tab?.windowId;
  if (windowId === undefined) return { ok: false, error: 'No source tab for capture.' };
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    return { ok: true, dataUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: /permission|activeTab|<all_urls>/i.test(message)
        ? 'Screenshot permission expired. Click the AJ Lens toolbar icon again to re-grant access, then retry.'
        : /MAX_CAPTURE/i.test(message)
          ? 'Chrome rate-limited screenshots. Wait a moment and retry.'
          : `Screenshot failed: ${message}`,
    };
  }
}

async function handleDownload(filename: string, dataUrl: string): Promise<DownloadResponse> {
  try {
    const downloadId = await chrome.downloads.download({
      url: dataUrl,
      filename,
      saveAs: false,
      conflictAction: 'uniquify',
    });
    return { ok: true, downloadId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (!isBackgroundRequest(message)) return false;
  const req: BackgroundRequest = message;
  switch (req.type) {
    case 'aj-lens/capture-visible-tab':
      void handleCapture(sender).then(sendResponse);
      return true;
    case 'aj-lens/download':
      void handleDownload(req.filename, req.dataUrl).then(sendResponse);
      return true;
    case 'aj-lens/state':
      if (sender.tab?.id !== undefined) void setActiveBadge(sender.tab.id, req.active);
      sendResponse({ ok: true });
      return false;
  }
  return false;
});
