# Troubleshooting

### Clicking the icon does nothing / a red `!` badge appears

The page is restricted. Chrome does not let extensions run on `chrome://`, `edge://`, `about:`, extension pages, the Chrome Web Store, or `data:`/`blob:` pages. Click the icon again to see the reason in the popup, then open a normal `http(s)` page.

### "Section Lens could not be injected"

- **Local files:** enable **Allow access to file URLs** for Section Lens at `chrome://extensions`.
- **Enterprise policy:** some managed browsers block extensions on certain sites (`runtime_blocked_hosts`).
- **Tab opened before install or reload:** reload the tab and try again.

### "Section Lens was updated or reloaded. Reload this page…"

After you reload the extension in `chrome://extensions`, pages that were already open keep an orphaned copy of the old script. Reload the page.

### "Screenshot permission expired"

`activeTab` access is revoked when the tab navigates (including single-page-app route changes that Chrome treats as navigations). Click the toolbar icon or press Alt+Shift+S again, then press **R** to refresh.

### "Chrome rate-limited screenshots"

Chrome allows about two `captureVisibleTab` calls per second. Wait a moment and press **R**.

### The screenshot is partial

Only the visible viewport can be captured. Choose **Scroll into view and capture**, make the window taller, or select smaller sub-sections with **↓ Smaller**.

### The selected element was removed

Frameworks often re-render nodes, for example on hover, data refresh or route changes. Hover and lock the section again. If it keeps disappearing, lock its parent.

### "Cross-origin iframe"

Content from another origin cannot be read by any extension script running in this page. Select the iframe box to capture its size and reference image, or open the iframe's URL in its own tab and inspect it there.

### Some media queries, fonts or variables are missing

Stylesheets served from another origin without CORS cannot be read. The analysis lists how many were inaccessible. The prompt then labels responsive recommendations as **inferred**.

### Copy prompt fails

Some pages restrict clipboard access, or the document lost focus. Click inside the panel and try again, select the text in the prompt box and press Cmd/Ctrl+C, or use **Save prompt.md**.

### Downloads go to an unexpected place

Files are saved to `Downloads/section-lens/<host>-<type>-<timestamp>/`. If Chrome is set to "Ask where to save each file", it prompts for each file.

### The hover target flickers or is too big or too small

Hysteresis keeps nested regions stable, so pause briefly over the region you want. Use **↑ Parent** or **↓ Smaller** (or the arrow keys) to step exactly. Keyboard navigation pins the selection until the pointer moves more than about 14 px.

### The panel is off-screen

The panel is clamped into the viewport on every resize. If a saved position is somehow unreachable, close and reopen the inspector, or drag it from the header after minimizing.
