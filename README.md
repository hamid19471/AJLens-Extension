# AJ Lens

**Point. Capture. Rebuild.**

AJ Lens is a Chrome extension (Manifest V3) that lets you hover over any section of a website, lock it, capture a cropped visual reference, analyze its structure and styling locally, and generate a detailed reconstruction prompt for Claude Code, Codex, GPT, or any other coding agent.

Everything runs in your browser. There is no backend, no API key, and nothing is uploaded.

---

## Contents

- [What it produces](#what-it-produces)
- [Installation (Load unpacked)](#installation-load-unpacked)
- [Using AJ Lens](#using-aj-lens)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Screenshot behavior](#screenshot-behavior)
- [Using the artifacts with coding agents](#using-the-artifacts-with-coding-agents)
- [Permissions](#permissions)
- [Privacy](#privacy)
- [Development](#development)
- [Build and packaging](#build-and-packaging)
- [Project structure](#project-structure)
- [Known limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)

## What it produces

| File                       | Contents                                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reconstruction-prompt.md` | Capture metadata (time, sanitized origin, page title, selected element, viewport, classification), the generated prompt, and a sanitized measurement appendix.                                                                        |
| `reference.png`            | The selected section, cropped from a screenshot of the visible tab at device resolution. The AJ Lens panel and highlight are hidden before capture.                                                                                   |
| `section-analysis.json`    | A typed, versioned (`schemaVersion: "1.0"`) analysis: structure, layout, computed styles, typography, colors and inferred tokens, assets, interactions, accessibility, responsive evidence, classification, assumptions and warnings. |

Exports are saved to `Downloads/aj-lens/<host>-<type>-<timestamp>/`, so the three files stay together.

## Installation (Load unpacked)

1. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the `dist/` folder.
5. Pin **AJ Lens** to the toolbar (puzzle-piece menu → pin).

**After every rebuild or update:** Chrome does not reload unpacked extensions automatically. Open `chrome://extensions`, click **Reload** on AJ Lens, then refresh the website you are inspecting.

A prebuilt archive is created by `npm run package` at `release/aj-lens-1.0.0.zip`. To use it, unzip it and load the unzipped folder the same way.

Requires Chrome 127 or newer (any Chromium browser that supports MV3 should work).

## Interface language

The AJ Lens interface is **Persian (فارسی) by default**, with a full right-to-left layout. The language does not follow the browser language: an English Chrome still opens AJ Lens in Persian until you choose otherwise.

- Switch with the compact **فارسی | EN** selector in the panel header, between the AJ Lens brand and the minimize/close buttons. It works with the mouse or the keyboard (Tab, then Enter or Space). The panel updates immediately, and the choice is saved in `chrome.storage.local`.
- Existing installs with no saved language are migrated to Persian. Other preferences (panel position, prompt mode, build target, include options) are kept.
- **Generated prompts are always English**: detailed and compact prompts, their headings, `reconstruction-prompt.md` and the JSON keys in `section-analysis.json`. Persian text captured from a website is kept as-is inside the English prompt.
- Technical values stay left-to-right inside the Persian UI: selectors, tag names, dimensions, `px`, filenames, URLs, raw browser errors and the prompt editor.
- The extension description and keyboard-shortcut description are localized through `_locales/fa` and `_locales/en`. The name is always **AJ Lens**.

| Persian header                                                  | English header                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| ![AJ Lens header in Persian](docs/images/aj-lens-header-fa.png) | ![AJ Lens header in English](docs/images/aj-lens-header-en.png) |

![AJ Lens panel in Persian](docs/images/aj-lens-panel-fa.png)

## Using AJ Lens

1. Visit a website.
2. Click the toolbar icon, or press **Alt+Shift+S**. The panel appears near the upper right.
3. Hover over the page. A green boundary follows the most meaningful region under the pointer (sections, cards, grids, forms, navs), not the deepest span or icon. The panel shows the tag, a short selector, the dimensions, the descendant count and an asset count.
4. Use **↑ Parent** or **↓ Smaller** (or the arrow keys) to adjust the selection.
5. **Click the page** or press **Lock section** (or Enter). AJ Lens then:
   - keeps a stronger boundary on the locked section
   - analyzes it in stages (the progress bar shows each one)
   - captures and crops a reference screenshot
   - classifies the section and generates the prompt
6. Choose **BUILD WITH** (existing stack, React, Next.js, Vue, Nuxt, Svelte, Astro, HTML/CSS/JS, Tailwind, or custom instructions), **Detailed** or **Compact**, and what the prompt should include.
7. Click **کپی کامل پرامپت** (English UI: **Copy full prompt**) to copy the complete prompt for the selected mode in one click, or save `prompt.md`, `reference.png` and `analysis.json`. The copy always uses the full generated prompt, not the visible part of the text box.
8. Click **Unlock section** or **Pick another** to continue.

The panel can be dragged by its header and minimized. Its position, minimized state and prompt settings are remembered.

## Keyboard shortcuts

| Key         | Action                                                                     |
| ----------- | -------------------------------------------------------------------------- |
| Alt+Shift+S | Toggle the inspector (change it at `chrome://extensions/shortcuts`)        |
| Esc         | Close the inspector (or cancel a pending capture choice)                   |
| ↑           | Select the nearest meaningful parent                                       |
| ↓           | Select the most meaningful child (the one under the pointer when possible) |
| Enter       | Lock the current selection                                                 |
| R           | Refresh the measurement (re-analyzes when locked)                          |
| C           | Copy the prompt (after locking)                                            |

Shortcuts are ignored while you type in an input, textarea, select or contenteditable element. Pressing Esc in a panel text field leaves the field instead of closing the inspector.

## Screenshot behavior

- Capture happens only after you lock a section.
- The panel and overlay are hidden, AJ Lens waits for two animation frames, and the service worker calls `chrome.tabs.captureVisibleTab`.
- The crop scale comes from the captured bitmap width ÷ viewport width, so devicePixelRatio and browser zoom are both handled.
- If the section is only partly inside the viewport, you choose one of three options:
  - **Capture visible area**: crops what is visible. The prompt marks the reference as partial.
  - **Scroll into view and capture**: scrolls the section to the center (or to the top if it is taller than the viewport), then captures.
  - **Cancel**: skips the screenshot. The analysis and prompt are still produced.
- There is **no automatic full-page stitching**, because stitching is unreliable with sticky headers, lazy loading and animations. For very tall sections, capture them in parts.
- Screenshots are kept in memory only, and are lost when the inspector closes unless you save them.

## Using the artifacts with coding agents

**Claude Code / Codex CLI**

1. Save all three files, then move the export folder into (or next to) your project, for example `./design-refs/pricing/`.
2. In the agent, paste the prompt, or say:
   > Read `design-refs/pricing/reconstruction-prompt.md` and implement it. Use `reference.png` and `section-analysis.json` in the same folder as evidence.
3. The prompt tells the agent to inspect your repository first, follow its stack and tokens, build only this section as a component, run type checks and tests, and compare its result against `reference.png`.

**ChatGPT / GPT and other chat UIs**

Paste the copied prompt and attach `reference.png` (and optionally `section-analysis.json`). Use **Compact** mode when the context window is small.

Values marked **measured** come straight from the page. **Discovered** values come from readable stylesheets. **Inferred** values (tokens, breakpoints, classification) are heuristics, and the prompt labels them that way.

## Permissions

| Permission  | Why it is needed                                                                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activeTab` | Grants temporary access to the current tab, and only after you click the toolbar icon or press the shortcut. AJ Lens has no host permissions and cannot see any page you have not activated it on. |
| `scripting` | Injects the inspector (`content.js`) into the active tab on demand. Nothing is injected automatically.                                                                                             |
| `storage`   | Saves your preferences only: panel position, minimized state, build target, custom instructions, prompt detail and include options.                                                                |
| `downloads` | Saves `reconstruction-prompt.md`, `reference.png` and `section-analysis.json` into one Downloads subfolder.                                                                                        |

`chrome.tabs.captureVisibleTab` is covered by `activeTab`, so the broad `tabs` permission is **not** requested. See [docs/PERMISSIONS.md](docs/PERMISSIONS.md).

## Privacy

- Analysis runs locally in the page. No network requests are made by the extension.
- It does not collect browsing history, cookies, credentials, form values, script contents or application state.
- Password fields, hidden inputs and payment/OTP autocomplete fields are never read. Placeholders and visible text are scanned to redact emails, card-like numbers and tokens.
- URLs are sanitized: credentials stripped, tracking parameters removed, sensitive parameters (`token`, `key`, `session`, `code`, `state`, `signature` and similar) redacted, and token-bearing fragments removed. Data URLs are reduced to their type and size.
- Screenshots and analyses stay in memory and are discarded when the inspector closes unless you download them.
- AJ Lens runs only after you explicitly activate it on a tab.

Full policy: [docs/PRIVACY.md](docs/PRIVACY.md).

## Development

```bash
npm install
npm run dev            # rebuilds dist/ on change (reload the extension in chrome://extensions)
npm run typecheck      # tsc --noEmit (strict)
npm run lint           # ESLint (typescript-eslint, react-hooks)
npm run format         # Prettier
npm test               # Vitest unit tests (jsdom)
npm run test:coverage  # with V8 coverage → coverage/
npm run test:smoke     # real-Chromium smoke test (requires a prior build)
npm run icons          # regenerate public/icons/*.png
```

The smoke test uses Playwright's Chromium. It reuses any Chromium already in the Playwright cache, or you can set `CHROMIUM_PATH`. It needs no secrets or network. It:

1. loads `dist/` as an unpacked extension and verifies that the service worker and manifest boot
2. runs the built `content.js` on `tests/fixtures/landing.html` with a stubbed extension runtime, and drives hover → parent navigation → lock → partial-capture choice → screenshot crop → prompt → exports → unlock → close

## Build and packaging

```bash
npm run build     # Vite → dist/ (content.js IIFE, background.js ES module, notice page) + validation
npm run package   # build + release/aj-lens-<version>.zip (manifest at archive root)
npm run validate  # re-check dist/: manifest, permissions, every referenced file exists
```

## Project structure

```
public/                 manifest.json, notice.html (restricted-page popup), icons/
src/
  background/           service worker: toggle/inject, captureVisibleTab, downloads, badge
  content/
    index.ts            bootstrap + typed message listener (top frame only)
    controller.ts       inspector lifecycle, events, rAF loop, lock/analysis/capture/export
    overlay.ts          fixed-position highlight (aria-hidden, pointer-events: none)
    capture.ts          hide UI → capture → crop → PNG
    store.ts            tiny observable store consumed by React
    panel/              React panel (Shadow DOM), scoped CSS, icon
  core/
    selection.ts        hover candidate, parent/child navigation, hysteresis
    filters.ts          ignorable/meaningful/region heuristics
    selector.ts         concise + stable selectors, hashed-class filtering
    styles.ts, color.ts style and color normalization
    sanitize.ts         URL sanitization, redaction
    geometry.ts         rect math, screenshot crop calculation
    analysis/           dom, layout, typography, colors, assets, interactions,
                        accessibility, responsive, classify, orchestrator
    prompt/             prompt generator (detailed/compact), exports
  shared/               analysis schema types, typed messages, preferences
tests/                  Vitest suites + fixtures/landing.html
scripts/                build, validate, package, icons, smoke
docs/                   ARCHITECTURE, PRIVACY, PERMISSIONS, TROUBLESHOOTING
```

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Known limitations

- **Only the current state is observed.** Hover, focus, active, open-menu and animation states are not triggered, because AJ Lens never clicks or modifies the page. The prompt says so explicitly.
- **Cross-origin stylesheets** cannot be read by any page script. Media queries, `@font-face` rules and custom properties from them are missing, and the analysis counts and reports them.
- **Cross-origin iframes:** their contents cannot be inspected. You can select the iframe box, and the panel and analysis warn about it.
- **Same-origin iframes:** only the top frame is instrumented. An iframe's inner document is not analyzed.
- **Closed shadow roots** in web components are opaque. Open shadow roots are measured by their host box only.
- **Screenshots are viewport-only.** There is no full-page stitching. Use "Scroll into view" or select smaller parts.
- Canvas, WebGL and video contents are recorded as present but not reconstructed.
- The classifier is deterministic and heuristic. Uncertain results are labelled inferred, with confidence and evidence.
- Computed values reflect the current viewport width. Responsive behavior at other widths comes from discovered media queries or is labelled inferred.
- Chrome blocks extensions on `chrome://`, `edge://`, extension pages and the Chrome Web Store. AJ Lens shows an explanatory popup there.
- `file://` pages need **Allow access to file URLs** enabled for AJ Lens in `chrome://extensions`.

## Troubleshooting

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md). The most common issues:

- **Nothing happens on click:** the page may be restricted (look for a red `!` badge), or it was opened before the extension was installed or reloaded. Reload the tab.
- **"Screenshot permission expired":** `activeTab` access ends when you navigate. Click the toolbar icon again.
- **"Could not copy the prompt":** some pages block clipboard access. AJ Lens already retries with a fallback copy method. If both fail, use **Save prompt.md**.

## License

MIT
