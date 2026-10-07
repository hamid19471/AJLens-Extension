# Privacy Policy — Section Lens

_Last updated: 2026-10-07_

Section Lens is a developer tool. It analyzes a part of a web page that **you** select and turns it into a prompt for a coding agent. It is built so that your data never leaves your browser.

## What Section Lens does not do

- It does not send any data to any server. The extension makes no network requests.
- It does not use analytics, telemetry, tracking, or third-party SDKs.
- It does not read browsing history, bookmarks, cookies, or other tabs.
- It does not read passwords, hidden inputs, payment or one-time-code fields, or any form field values.
- It does not read script contents, serialized application state, or storage belonging to the page.
- It does not run on any page until you click its toolbar icon or press its shortcut on that tab.
- It does not click, submit, navigate, or modify the pages you inspect. Its UI is drawn in its own shadow root and removed when you close it.

## What is processed, and where

When you lock a section, Section Lens reads that section's DOM structure, computed styles, visible text, asset references, ARIA attributes, and the page's readable stylesheets. All of this happens **locally, inside the tab**. It then takes a screenshot of the visible tab via Chrome's `captureVisibleTab`, crops it to the selection, and keeps it in memory.

Before anything is shown or exported:

- URLs lose their credentials and tracking parameters. Sensitive parameters (tokens, keys, sessions, codes, signatures and similar) are replaced with `[redacted]`.
- Data URLs are replaced with their MIME type and approximate size.
- Email addresses, card-like numbers and token-like strings in visible text are redacted.

## What is stored

Only your preferences are stored, in `chrome.storage.local` on your device:

- panel position and minimized state
- build target and custom build instructions
- prompt detail level
- include/exclude options

Inspected content, prompts, analyses and screenshots are **never** persisted. They exist only in memory while the inspector is open, and are discarded when you close it, navigate away, or close the tab. The exception is a file you choose to download, which goes to your Downloads folder like any other download.

## Your control

- Close the inspector (Esc or ×) to discard everything in memory.
- Remove the extension to delete its stored preferences.
- Review every exported file before you share it with an AI service. Section Lens redacts common secrets, but you decide what to send to third parties.

## Contact

Open an issue in the project repository.
