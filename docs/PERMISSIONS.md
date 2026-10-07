# Permissions

AJ Lens requests the smallest set of permissions that still supports its features. It declares **no host permissions** and **no content scripts**.

| Permission  | Used by    | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activeTab` | background | Grants temporary access to the tab you are on, and only after you click the toolbar icon or press the shortcut (`_execute_action`). This access lets `content.js` be injected into that tab, and it covers `chrome.tabs.captureVisibleTab`. Access ends when the tab navigates.                                                                                                                                                                                                                       |
| `scripting` | background | `chrome.scripting.executeScript({ files: ['content.js'] })` injects the inspector on demand, into the top frame only.                                                                                                                                                                                                                                                                                                                                                                                 |
| `storage`   | content    | `chrome.storage.local` stores UI preferences only. See [PRIVACY.md](PRIVACY.md).                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `downloads` | background | `chrome.downloads.download` saves `reference.png`, `prompt.md` and `analysis.json` into `Downloads/AJ-Lens/<hostname>-<YYYY-MM-DD-HHmmss>/` with `saveAs: false` and `conflictAction: 'uniquify'`. `chrome.downloads.show` powers **Show in downloads**. The service worker owns this API, so the panel sends it a validated message (fixed filename per artifact, `AJ-Lens/<safe-segment>` directory only). There is no in-page fallback, and the permission grants no access to existing downloads. |

## Permissions deliberately not requested

- **`tabs`**: not needed. With `activeTab`, `tab.url` is available inside the click handler and screenshot capture is allowed.
- **`<all_urls>` / host permissions**: not needed. AJ Lens never runs on a page you have not activated it on.
- **`clipboardWrite`**: not needed. Copying uses `navigator.clipboard` from a user gesture inside the panel, with an `execCommand` fallback.
- **`webRequest`, `cookies`, `history`**: never needed.

## Commands

`_execute_action`, suggested key **Alt+Shift+S**, acts exactly like clicking the toolbar icon (including granting `activeTab`). You can change it at `chrome://extensions/shortcuts`.
