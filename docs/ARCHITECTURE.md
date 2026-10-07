# Architecture

AJ Lens has three runtime pieces and one pure-TypeScript core.

```
toolbar click / Alt+Shift+S
        │
        ▼
┌──────────────────────┐  chrome.scripting.executeScript(content.js)   ┌───────────────────────────────┐
│ background.js (SW)   │ ───────────────────────────────────────────▶ │ content.js (isolated world)    │
│ - restricted check   │  aj-lens/toggle                                    │ InspectorController            │
│ - inject + toggle    │ ◀─────────────────────────────────────────── │  ├ Overlay (shadow root)       │
│ - captureVisibleTab  │  aj-lens/capture-visible-tab, aj-lens/download, aj-lens/state│  ├ React Panel (shadow root)   │
│ - downloads          │                                               │  ├ selection engine (core)     │
│ - badge / notice     │                                               │  └ analysis + prompt (core)    │
└──────────────────────┘                                               └───────────────────────────────┘
```

## Background service worker (`src/background`)

- `action.onClicked`: if the URL is restricted (`restricted.ts`), it sets a per-tab popup (`notice.html?reason=…`), opens it and shows a red badge. Otherwise it sends `aj-lens/toggle`. If no listener answers, it injects `content.js` and toggles again. Injection errors (file URLs without access, policy blocks) become friendly notices.
- `aj-lens/capture-visible-tab`: calls `chrome.tabs.captureVisibleTab(windowId, { format: 'png' })` for the sender's window. Permission and rate-limit errors are mapped to readable messages.
- `aj-lens/download`: validates the filename (no traversal, safe characters) and the data URL, then calls `chrome.downloads.download`.
- `aj-lens/state`: updates the per-tab `ON` badge.
- On navigation (`tabs.onUpdated` status `loading`), it resets the popup, badge and title for that tab.

Every message is validated by type guards in `src/shared/messages.ts`, and messages from other extensions are rejected (`sender.id`).

## Content script (`src/content`)

`index.ts` runs once per page (guarded by `window.__ajLens` in the isolated world), removes UI left over from a previous extension instance, and registers the message listener.

`InspectorController` owns everything created while the inspector is active:

- **Host:** a `<aj-lens-root>` element with `all: initial` inline styles and an open shadow root. The overlay and the React panel live inside it, so page CSS cannot reach them and the extension CSS cannot leak out.
- **Events:** registered with one `AbortController`:
  - `pointermove`, `scroll` (capture, passive) and `resize` schedule a frame.
  - pointer/mouse down/up/click (capture) are swallowed only in hover mode and only outside the extension UI. A click locks.
  - `keydown` (capture) handles shortcuts, ignores editable targets via `composedPath()[0]`, and lets panel controls handle Enter themselves.
- **Frame loop:** `requestAnimationFrame` runs only when something is dirty, plus a 300 ms safety poll and a `ResizeObserver` on the target. Each frame resets the measurement cache, resolves the hover candidate (`elementFromPoint` → `pickHoverCandidate` → `StableCandidate`), and repositions the overlay with transforms. It also detects removed targets.
- **Lock:** this runs `analyzeSection`, which calls back into the controller at the capture stage. If the target is partially visible, the controller asks for a choice, then hides the host, captures and crops. Stage changes are published to the store, which drives the progress bar and the ARIA live region.
- **Teardown:** `destroy()` aborts listeners, cancels the rAF, timers, observers and the pending analysis, unmounts React, and removes the host. Repeated toggling leaves no listeners or nodes behind (the smoke test checks this).

**Localization:** every interface string lives in one typed dictionary, `src/shared/i18n.ts` (`fa` and `en`). `fa` is typed `Record<MessageKey, string>`, so a missing Persian key is a compile error, and `messages()` falls back to English for empty values. The locale comes from `prefs.locale`, which defaults to `fa` and is never taken from the browser. The panel root gets `lang`/`dir`, and technical values are wrapped in `<bdi dir="ltr">`. Notices are stored as message keys, not text, so switching language re-translates messages already on screen. The service worker (badge titles) and `notice.html` read the same dictionary. `tests/i18n.test.tsx` renders the Persian panel in every major state and fails on any untranslated Latin text outside the allowlist.

**Copy full prompt:** `controller.copyPrompt()` reads the complete prompt string for the active mode from the store. It does not read the textarea or a selection. It copies only when generation has finished (`stage === 'ready'`). The copy goes through `ClipboardService` (`clipboard.ts`): first `navigator.clipboard.writeText`, then an off-screen textarea in the extension's shadow root with `execCommand('copy')`. That textarea is removed immediately and focus is restored. Button labels and feedback come from `i18n.ts` (`en`/`fa`, detected from the browser UI language).

The panel is a React 19 component that reads the controller's `Store` through `useSyncExternalStore`. The prompt is regenerated synchronously when prompt preferences change. Re-analysis happens only on lock, on refresh, or when the selection changes while locked.

## Core (`src/core`)

The core is DOM-only, with no `chrome.*` calls, and is unit-tested under jsdom with an injectable `Measurer`. Tests supply geometry through `data-rect`.

| Module                   | Responsibility                                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `measure.ts`             | Cached `getBoundingClientRect` / `getComputedStyle` per pass.                                                                                                                                                       |
| `filters.ts`             | Ignorable (script, style, hidden, extension UI), meaningful, region candidate, significance score.                                                                                                                  |
| `selection.ts`           | Hover candidate (walk up to the first region-sized meaningful element, then collapse same-size wrappers); parent; child (pointer-aware scoring); hysteresis (140 ms for nested changes, 45 ms for sibling changes). |
| `selector.ts`            | Concise display selectors and unique stable selectors. Hashed CSS-in-JS, CSS-module and framework-generated classes and ids are filtered.                                                                           |
| `styles.ts` / `color.ts` | Reconstruction-relevant property allow-list, default and inherited removal, shorthand compression, color normalization, contrast.                                                                                   |
| `sanitize.ts`            | URL sanitization, data-URL summaries, text redaction.                                                                                                                                                               |
| `analysis/*`             | Structure, layout, typography, colors and tokens, assets, interactions, accessibility, responsive (stylesheet scan), classification, orchestrator with stages and abort.                                            |
| `prompt/*`               | Section-based prompt builder with priorities and size budgets, plus markdown and JSON exports.                                                                                                                      |

### Analysis limits

`DEFAULT_LIMITS` sets depth 14, 1,500 nodes, 400 style samples and 6,000 stylesheet rules. Larger selections are truncated, and the analysis and prompt both carry a warning.

### Prompt budgets

Sections have priorities. If the rendered prompt exceeds its budget (25,000 characters detailed, 6,000 compact), the lowest-priority sections are shortened first, with code fences kept balanced. The task, inputs, project requirements and implementation instructions are never shortened.

## Build

`scripts/build.mjs` runs three Vite library builds into `dist/`:

- `content.js`: IIFE, React bundled, CSS inlined via `?inline`
- `background.js`: ES module service worker
- `notice.js`: IIFE

`public/` (manifest, notice page, icons) is copied as-is. `scripts/validate.mjs` checks the manifest, permissions and referenced files, and confirms there is no module syntax in the content script and no inline scripts. `scripts/package.mjs` writes a reproducible ZIP.
