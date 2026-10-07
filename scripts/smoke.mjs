// Chromium smoke test (no secrets, no network):
//  1. Loads dist/ as an unpacked extension and checks the service worker boots with the right manifest.
//  2. Runs the built content.js against tests/fixtures/landing.html with a stubbed extension runtime,
//     then drives hover → lock → analysis → capture → prompt end-to-end in real Chromium.
// Usage: npm run build && npm run test:smoke   (set CHROMIUM_PATH to override the browser binary)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const dist = resolve(root, 'dist');
if (!existsSync(resolve(dist, 'manifest.json'))) {
  console.error('dist/ missing — run npm run build first.');
  process.exit(1);
}

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    const p = chromium.executablePath();
    if (existsSync(p)) return p;
  } catch {
    // fall through to cached builds
  }
  const cache = join(
    homedir(),
    process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright',
  );
  if (!existsSync(cache)) return undefined;
  const dirs = readdirSync(cache)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort()
    .reverse();
  for (const d of dirs) {
    const candidates = [
      join(
        cache,
        d,
        'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      ),
      join(
        cache,
        d,
        'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      ),
      join(cache, d, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
      join(cache, d, 'chrome-linux/chrome'),
      join(cache, d, 'chrome-linux64/chrome'),
      join(cache, d, 'chrome-win/chrome.exe'),
    ];
    const hit = candidates.find((c) => existsSync(c));
    if (hit) return hit;
  }
  return undefined;
}

async function copyAndRead(p) {
  await p.locator('aj-lens-root [data-testid="copy-full-prompt"]').click();
  await p.waitForTimeout(150);
  const writes = await p.evaluate(() => window.__ajlClipboardWrites.slice());
  // null when clipboard reads are blocked in this environment; checks then fail loudly.
  const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  return { written: writes[writes.length - 1], clip, writes: writes.length };
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const fixture = readFileSync(resolve(root, 'tests/fixtures/landing.html'), 'utf8');
const server = createServer((req, res) => {
  if (req.url === '/' || req.url?.startsWith('/?')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fixture);
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const executablePath = findChromium();
const userDataDir = mkdtempSync(join(tmpdir(), 'aj-lens-smoke-'));
let context;
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless: true,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, '--headless=new'],
  });

  // ---- 1. Extension loads and its service worker boots.
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const manifest = await sw.evaluate(() => chrome.runtime.getManifest());
  check('service worker registered', sw.url().endsWith('/background.js'), sw.url());
  check(
    'manifest loaded',
    manifest.name === 'AJ Lens' && manifest.manifest_version === 3,
    `v${manifest.version}`,
  );
  check(
    'permissions are minimal',
    JSON.stringify(manifest.permissions) ===
      JSON.stringify(['activeTab', 'scripting', 'storage', 'downloads']),
  );

  check('toolbar title is AJ Lens', manifest.action?.default_title === 'AJ Lens');
  check('short name is AJ Lens', manifest.short_name === 'AJ Lens');
  check(
    'command description uses AJ Lens',
    manifest.commands?._execute_action?.description === 'Toggle the AJ Lens inspector',
  );

  // ---- 2. Content script end-to-end against the fixture with a stubbed runtime.
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Fixture images intentionally 404 / point at unresolvable hosts; ignore resource errors.
  page.on(
    'console',
    (m) =>
      m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()),
  );
  await page.exposeFunction('__ajlCapture', async () => {
    const buf = await page.screenshot({ type: 'png' });
    return `data:image/png;base64,${buf.toString('base64')}`;
  });
  const stubRuntime = () => {
    // Simulates a user upgrading from "Section Lens": preferences exist only under the legacy key.
    const stored = (window.__ajlStored = {
      'sectionLens.preferences': {
        version: 1,
        minimized: false,
        buildTarget: 'nextjs',
        promptDetail: 'detailed',
        customInstructions: '',
        include: { visibleText: true },
      },
    });
    window.__ajlDownloads = [];
    window.chrome = {
      runtime: {
        id: 'smoke-test',
        onMessage: { addListener() {} },
        async sendMessage(msg) {
          if (msg.type === 'aj-lens/capture-visible-tab')
            return { ok: true, dataUrl: await window.__ajlCapture() };
          if (msg.type === 'aj-lens/download') {
            window.__ajlDownloads.push({
              filename: msg.filename,
              size: msg.dataUrl.length,
              dataUrl: msg.dataUrl,
            });
            return { ok: true, downloadId: window.__ajlDownloads.length };
          }
          return { ok: true };
        },
      },
      storage: {
        local: {
          async get(keys) {
            const out = {};
            for (const k of Array.isArray(keys) ? keys : [keys])
              if (k in stored) out[k] = stored[k];
            return out;
          },
          async remove(keys) {
            for (const k of Array.isArray(keys) ? keys : [keys]) delete stored[k];
          },
          async set(items) {
            Object.assign(stored, items);
          },
        },
      },
    };
  };
  // Records the exact string handed to the Clipboard API, then calls the real implementation.
  const spyClipboard = () => {
    window.__ajlClipboardWrites = [];
    const original = navigator.clipboard?.writeText?.bind(navigator.clipboard);
    if (original) {
      navigator.clipboard.writeText = async (value) => {
        window.__ajlClipboardWrites.push(value);
        return original(value);
      };
    }
  };
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(url).origin,
  });
  await page.addInitScript(stubRuntime);
  await page.addInitScript(spyClipboard);
  await page.goto(url);
  await page.addScriptTag({ content: readFileSync(resolve(dist, 'content.js'), 'utf8') });
  check(
    'content script bootstraps',
    await page.evaluate(() => typeof window.__ajLens?.toggle === 'function'),
  );
  await page.evaluate(() => window.__ajLens.toggle());
  const panel = page.locator('aj-lens-root .panel');
  await panel.waitFor({ timeout: 5000 });
  check(
    'panel mounted in shadow DOM',
    await page.evaluate(
      () => !!document.querySelector('aj-lens-root')?.shadowRoot?.querySelector('.panel'),
    ),
  );
  check(
    'panel header reads "AJ Lens"',
    (await page.locator('aj-lens-root .brand').textContent()) === 'AJ Lens',
  );
  await page.waitForTimeout(200);
  const migrated = await page.evaluate(() => ({
    legacy: 'sectionLens.preferences' in window.__ajlStored,
    current: window.__ajlStored['aj-lens.preferences']?.buildTarget,
    shown: document.querySelector('aj-lens-root').shadowRoot.querySelector('select').value,
  }));
  check(
    'legacy Section Lens settings migrate',
    !migrated.legacy && migrated.current === 'nextjs' && migrated.shown === 'nextjs',
    JSON.stringify(migrated),
  );
  // Restore the default build target so prompt assertions below stay comparable.
  await page.locator('aj-lens-root select').selectOption('existing');
  check(
    'panel isolated from page CSS',
    (await panel.evaluate((el) => getComputedStyle(el).fontFamily)).includes('system-ui'),
  );
  const box = await panel.boundingBox();
  check(
    'panel docked top-right, ~340px wide',
    box && box.x > 800 && box.width >= 330 && box.width <= 350,
    box ? `${box.width}px at x=${box.x}` : 'no box',
  );

  // Hover a pricing plan's button: expect the plan card, not the button text.
  const plan = page.locator('.plan').nth(1);
  await page.evaluate(() =>
    window.scrollTo(
      0,
      document.querySelector('#pricing').getBoundingClientRect().top + window.scrollY - 40,
    ),
  );
  const pb = await plan.boundingBox();
  await page.mouse.move(pb.x + 40, pb.y + pb.height - 40);
  await page.waitForTimeout(250);
  await page.mouse.move(pb.x + 42, pb.y + pb.height - 38);
  await page.waitForTimeout(250);
  const label = await page.locator('aj-lens-root .ajl-label').textContent();
  check('hover highlights a meaningful region', /div\.plan/.test(label ?? ''), label ?? '');
  const selText = await page.locator('aj-lens-root .selector').textContent();
  check('selection card shows selector', selText === 'div.plan', selText ?? '');

  // Parent navigation via keyboard.
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(100);
  const parentSel = await page.locator('aj-lens-root .selector').textContent();
  check(
    'ArrowUp selects meaningful parent',
    parentSel === 'div.pricing' || parentSel === 'section#pricing',
    parentSel ?? '',
  );
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(100);
  check(
    'second ArrowUp reaches the section',
    (await page.locator('aj-lens-root .selector').textContent()) === 'section#pricing',
  );

  // Lock with Enter (section is partially visible → choose "Scroll into view and capture").
  await page.keyboard.press('Enter');
  const choice = page.locator('aj-lens-root .choice');
  const needsChoice = await choice.waitFor({ timeout: 3000 }).then(
    () => true,
    () => false,
  );
  if (needsChoice) {
    check('partial-capture choice offered', true);
    await page.locator('aj-lens-root .choice .btn.primary').click();
  }
  await page.waitForFunction(
    () => {
      const ta = document
        .querySelector('aj-lens-root')
        ?.shadowRoot?.querySelector('textarea.prompt');
      return ta && ta.value.length > 1000;
    },
    null,
    { timeout: 15000 },
  );
  const prompt = await page.locator('aj-lens-root textarea.prompt').inputValue();
  check(
    'prompt generated',
    prompt.startsWith('Reconstruct the selected website section'),
    `${prompt.length} chars`,
  );
  check(
    'detailed prompt within 8k–25k',
    prompt.length >= 8000 && prompt.length <= 25000,
    `${prompt.length}`,
  );
  check('classified as pricing', /Type: \*\*pricing\*\*/.test(prompt));

  // One-click copy of the full detailed prompt, verified against the real clipboard.
  await page.locator('aj-lens-root .seg button', { hasText: 'Detailed' }).click();
  const detailedPrompt = await page.locator('aj-lens-root textarea.prompt').inputValue();
  const detailedCount = Number(
    (await page.locator('aj-lens-root .count').textContent()).replace(/\D/g, ''),
  );
  const copiedDetailed = await copyAndRead(page);
  check(
    'one click copies the full detailed prompt to the clipboard',
    copiedDetailed.clip === detailedPrompt && copiedDetailed.written === detailedPrompt,
    `clipboard ${copiedDetailed.clip?.length ?? 'unreadable'} / written ${copiedDetailed.written?.length} / generated ${detailedPrompt.length}`,
  );
  check(
    'copied length equals the generated character count',
    copiedDetailed.clip?.length === detailedCount && detailedCount === detailedPrompt.length,
    `${copiedDetailed.clip?.length} vs ${detailedCount}`,
  );
  check(
    'copied prompt includes beginning and final sections',
    copiedDetailed.clip?.startsWith('Reconstruct the selected website section') &&
      [
        '# Visual Validation Checklist',
        '# Source Measurements',
        '# Assumptions and Uncertainties',
      ].every((h) => copiedDetailed.clip.includes(`\n${h}\n`)),
  );
  check(
    'success feedback shown on the button',
    (await page.locator('aj-lens-root [data-testid="copy-full-prompt"]').textContent()).includes(
      'Full prompt copied',
    ),
  );
  check(
    'status shows locked',
    (await page.locator('aj-lens-root .status').textContent())?.includes('LOCKED'),
  );
  check(
    'lock button switched to Unlock',
    (await page.locator('aj-lens-root .controls .wide').textContent()) === 'Unlock section',
  );
  const preview = await page.locator('aj-lens-root .preview figcaption').textContent();
  check(
    'reference captured and cropped',
    /reference\.png · \d+ × \d+ px/.test(preview ?? ''),
    preview ?? '',
  );
  const [pw, ph] = (preview?.match(/(\d+) × (\d+)/) ?? []).slice(1).map(Number);
  const sb = await page.locator('#pricing').boundingBox();
  check(
    'crop size matches section × DPR',
    Math.abs(pw - Math.round(sb.width * 2)) <= 2 &&
      Math.abs(ph - Math.min(Math.round(sb.height * 2), 1600)) <= 4,
    `${pw}×${ph} vs ${sb.width * 2}×${sb.height * 2}`,
  );
  const overlayVisibleAfterCapture = await page.evaluate(
    () => getComputedStyle(document.querySelector('aj-lens-root')).visibility,
  );
  check('UI restored after capture', overlayVisibleAfterCapture === 'visible');

  // Compact toggle.
  await page.locator('aj-lens-root .seg button', { hasText: 'Compact' }).click();
  const compact = await page.locator('aj-lens-root textarea.prompt').inputValue();
  check(
    'compact prompt within 2k–6k',
    compact.length >= 2000 && compact.length <= 6000,
    `${compact.length}`,
  );
  await page.waitForTimeout(2100); // let the previous confirmation reset
  const copiedCompact = await copyAndRead(page);
  check(
    'one click copies the full compact prompt after switching modes',
    copiedCompact.clip === compact && copiedCompact.clip !== copiedDetailed.clip,
    `${copiedCompact.clip?.length} chars`,
  );

  // Real-browser fallback: Clipboard API rejects → shadow-root textarea + execCommand('copy').
  await page.evaluate(() => navigator.clipboard.writeText('stale'));
  await page.evaluate(() => {
    window.__ajlRealWrite = navigator.clipboard.writeText;
    navigator.clipboard.writeText = () =>
      Promise.reject(new DOMException('blocked', 'NotAllowedError'));
  });
  await page.waitForTimeout(2100);
  await page.locator('aj-lens-root [data-testid="copy-full-prompt"]').click();
  await page.waitForTimeout(150);
  const fallbackClip = await page.evaluate(() => navigator.clipboard.readText());
  const leftovers = await page.evaluate(
    () =>
      document
        .querySelector('aj-lens-root')
        .shadowRoot.querySelectorAll('textarea:not(.prompt):not(.custom)').length +
      document.querySelectorAll('body > textarea').length,
  );
  check(
    'execCommand fallback copies the full prompt from Shadow DOM',
    fallbackClip === compact,
    `${fallbackClip.length} chars`,
  );
  check('fallback textarea removed', leftovers === 0);
  await page.evaluate(() => {
    navigator.clipboard.writeText = window.__ajlRealWrite;
  });

  // Exports.
  await page.locator('aj-lens-root .actions .btn', { hasText: 'Save prompt.md' }).click();
  await page.locator('aj-lens-root .actions .btn', { hasText: 'Save reference.png' }).click();
  await page.locator('aj-lens-root .actions .btn', { hasText: 'Save analysis.json' }).click();
  await page.waitForTimeout(300);
  const downloads = await page.evaluate(() => window.__ajlDownloads);
  check(
    'three artifacts exported',
    downloads.length === 3 &&
      ['reconstruction-prompt.md', 'reference.png', 'section-analysis.json'].every((n) =>
        downloads.some((d) => d.filename.endsWith(`/${n}`)),
      ),
    downloads.map((d) => d.filename.split('/').pop()).join(', '),
  );
  if (process.env.SMOKE_ARTIFACTS) {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(process.env.SMOKE_ARTIFACTS, { recursive: true });
    for (const d of downloads) {
      const name = d.filename.split('/').pop();
      writeFileSync(
        join(process.env.SMOKE_ARTIFACTS, name),
        Buffer.from(d.dataUrl.split(',')[1], 'base64'),
      );
    }
    await page.screenshot({ path: join(process.env.SMOKE_ARTIFACTS, 'page-with-panel.png') });
  }
  check('secrets absent from prompt', !compact.includes('hunter2') && !prompt.includes('hunter2'));

  // Unlock / close / cleanup.
  await page.locator('aj-lens-root .controls .wide').click();
  check(
    'unlock returns to hover mode',
    (await page.locator('aj-lens-root .status').textContent())?.includes('INSPECTOR ACTIVE'),
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  check('Escape removes all injected UI', (await page.locator('aj-lens-root').count()) === 0);
  for (let i = 0; i < 5; i++) await page.evaluate(() => window.__ajLens.toggle());
  check(
    'repeated toggling leaves a single host',
    (await page.locator('aj-lens-root').count()) === 1,
  );

  // Partially visible section: expect the capture choice and a partial reference.
  await page.setViewportSize({ width: 1280, height: 420 });
  await page.evaluate(() =>
    window.scrollTo(
      0,
      document.querySelector('#pricing').getBoundingClientRect().top + window.scrollY - 100,
    ),
  );
  const hb = await page.locator('#pricing > h2').boundingBox();
  await page.mouse.move(hb.x + 30, hb.y + hb.height / 2);
  await page.waitForTimeout(200);
  await page.mouse.move(hb.x + 32, hb.y + hb.height / 2);
  await page.waitForTimeout(200);
  const partialSel = await page.locator('aj-lens-root .selector').textContent();
  check(
    'hovering a heading selects its section',
    partialSel === 'section#pricing',
    partialSel ?? '',
  );
  await page.keyboard.press('Enter');
  const partialChoice = await page
    .locator('aj-lens-root .choice')
    .waitFor({ timeout: 4000 })
    .then(
      () => true,
      () => false,
    );
  check('partial-capture choice offered', partialChoice);
  if (partialChoice) {
    await page.locator('aj-lens-root .choice .btn', { hasText: 'Capture visible area' }).click();
    await page.waitForFunction(
      () =>
        (document.querySelector('aj-lens-root')?.shadowRoot?.querySelector('textarea.prompt')?.value
          .length ?? 0) > 1000,
      null,
      { timeout: 15000 },
    );
    const partialPrompt = await page.locator('aj-lens-root textarea.prompt').inputValue();
    check(
      'partial capture recorded as visible-only',
      partialPrompt.includes('**visible part only**'),
    );
  }
  await page.evaluate(() => window.__ajLens.toggle());
  check(
    'page clicks work after closing',
    await page.evaluate(() => {
      let clicked = false;
      const a = document.querySelector('.plan a');
      a.addEventListener(
        'click',
        (e) => {
          clicked = true;
          e.preventDefault();
        },
        { once: true },
      );
      a.click();
      return clicked;
    }),
  );
  // Persian interface: same flow on a page whose browser language is fa-IR.
  const fa = await context.newPage();
  fa.on('pageerror', (e) => errors.push(e.message));
  await fa.exposeFunction('__ajlCapture', async () => {
    const buf = await fa.screenshot({ type: 'png' });
    return `data:image/png;base64,${buf.toString('base64')}`;
  });
  await fa.addInitScript(() => {
    Object.defineProperty(navigator, 'language', { get: () => 'fa-IR' });
    Object.defineProperty(navigator, 'languages', { get: () => ['fa-IR', 'fa'] });
  });
  await fa.addInitScript(stubRuntime);
  await fa.addInitScript(spyClipboard);
  await fa.goto(url);
  await fa.addScriptTag({ content: readFileSync(resolve(dist, 'content.js'), 'utf8') });
  await fa.evaluate(() => window.__ajLens.toggle());
  await fa.locator('aj-lens-root .panel').waitFor();
  await fa.evaluate(() =>
    window.scrollTo(
      0,
      document.querySelector('#pricing').getBoundingClientRect().top + window.scrollY - 40,
    ),
  );
  const faH = await fa.locator('#pricing > h2').boundingBox();
  await fa.mouse.move(faH.x + 30, faH.y + faH.height / 2);
  await fa.waitForTimeout(200);
  await fa.mouse.move(faH.x + 32, faH.y + faH.height / 2);
  await fa.waitForTimeout(200);
  const faButton = fa.locator('aj-lens-root [data-testid="copy-full-prompt"]');
  check(
    'Persian button label before generation',
    (await faButton.textContent()) === 'کپی کامل پرامپت' && (await faButton.isDisabled()),
  );
  await fa.keyboard.press('Enter');
  if (
    await fa
      .locator('aj-lens-root .choice')
      .waitFor({ timeout: 2000 })
      .then(
        () => true,
        () => false,
      )
  ) {
    await fa.locator('aj-lens-root .choice .btn.primary').click();
  }
  await fa.waitForFunction(
    () => {
      const b = document
        .querySelector('aj-lens-root')
        ?.shadowRoot?.querySelector('[data-testid="copy-full-prompt"]');
      return b && !b.disabled;
    },
    null,
    { timeout: 15000 },
  );
  const faPrompt = await fa.locator('aj-lens-root textarea.prompt').inputValue();
  const faCopied = await copyAndRead(fa);
  const faFeedback = await faButton.textContent();
  const faLive = await fa.locator('aj-lens-root [aria-live="polite"]').textContent();
  check(
    'Persian feedback "پرامپت کامل کپی شد" and full English prompt copied',
    faFeedback.includes('پرامپت کامل کپی شد') &&
      faLive === 'پرامپت کامل کپی شد' &&
      faCopied.clip === faPrompt &&
      faPrompt.startsWith('Reconstruct'),
    `${faFeedback} / ${faCopied.clip?.length} chars`,
  );
  check(
    'Persian accessible name',
    (await faButton.getAttribute('aria-label')) === 'کپی کامل پرامپت بازسازی در کلیپ‌بورد',
  );
  await fa.close();

  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (err) {
  check('smoke run', false, err instanceof Error ? (err.stack ?? err.message) : String(err));
} finally {
  await context?.close();
  server.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} smoke checks passed${executablePath ? ` (browser: ${executablePath.split('/').slice(-1)[0]})` : ''}`,
);
process.exit(failed.length ? 1 : 0);
