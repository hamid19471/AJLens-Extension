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
const userDataDir = mkdtempSync(join(tmpdir(), 'section-lens-smoke-'));
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
    manifest.name === 'Section Lens' && manifest.manifest_version === 3,
    `v${manifest.version}`,
  );
  check(
    'permissions are minimal',
    JSON.stringify(manifest.permissions) ===
      JSON.stringify(['activeTab', 'scripting', 'storage', 'downloads']),
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
  await page.exposeFunction('__slCapture', async () => {
    const buf = await page.screenshot({ type: 'png' });
    return `data:image/png;base64,${buf.toString('base64')}`;
  });
  await page.addInitScript(() => {
    const stored = {};
    window.__slDownloads = [];
    window.chrome = {
      runtime: {
        id: 'smoke-test',
        onMessage: { addListener() {} },
        async sendMessage(msg) {
          if (msg.type === 'sl/capture-visible-tab')
            return { ok: true, dataUrl: await window.__slCapture() };
          if (msg.type === 'sl/download') {
            window.__slDownloads.push({
              filename: msg.filename,
              size: msg.dataUrl.length,
              dataUrl: msg.dataUrl,
            });
            return { ok: true, downloadId: window.__slDownloads.length };
          }
          return { ok: true };
        },
      },
      storage: {
        local: {
          async get(k) {
            return { [k]: stored[k] };
          },
          async set(items) {
            Object.assign(stored, items);
          },
        },
      },
    };
  });
  await page.goto(url);
  await page.addScriptTag({ content: readFileSync(resolve(dist, 'content.js'), 'utf8') });
  check(
    'content script bootstraps',
    await page.evaluate(() => typeof window.__sectionLens?.toggle === 'function'),
  );
  await page.evaluate(() => window.__sectionLens.toggle());
  const panel = page.locator('section-lens-root .panel');
  await panel.waitFor({ timeout: 5000 });
  check(
    'panel mounted in shadow DOM',
    await page.evaluate(
      () => !!document.querySelector('section-lens-root')?.shadowRoot?.querySelector('.panel'),
    ),
  );
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
  const label = await page.locator('section-lens-root .sl-label').textContent();
  check('hover highlights a meaningful region', /div\.plan/.test(label ?? ''), label ?? '');
  const selText = await page.locator('section-lens-root .selector').textContent();
  check('selection card shows selector', selText === 'div.plan', selText ?? '');

  // Parent navigation via keyboard.
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(100);
  const parentSel = await page.locator('section-lens-root .selector').textContent();
  check(
    'ArrowUp selects meaningful parent',
    parentSel === 'div.pricing' || parentSel === 'section#pricing',
    parentSel ?? '',
  );
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(100);
  check(
    'second ArrowUp reaches the section',
    (await page.locator('section-lens-root .selector').textContent()) === 'section#pricing',
  );

  // Lock with Enter (section is partially visible → choose "Scroll into view and capture").
  await page.keyboard.press('Enter');
  const choice = page.locator('section-lens-root .choice');
  const needsChoice = await choice.waitFor({ timeout: 3000 }).then(
    () => true,
    () => false,
  );
  if (needsChoice) {
    check('partial-capture choice offered', true);
    await page.locator('section-lens-root .choice .btn.primary').click();
  }
  await page.waitForFunction(
    () => {
      const ta = document
        .querySelector('section-lens-root')
        ?.shadowRoot?.querySelector('textarea.prompt');
      return ta && ta.value.length > 1000;
    },
    null,
    { timeout: 15000 },
  );
  const prompt = await page.locator('section-lens-root textarea.prompt').inputValue();
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
  check(
    'status shows locked',
    (await page.locator('section-lens-root .status').textContent())?.includes('LOCKED'),
  );
  check(
    'lock button switched to Unlock',
    (await page.locator('section-lens-root .controls .wide').textContent()) === 'Unlock section',
  );
  const preview = await page.locator('section-lens-root .preview figcaption').textContent();
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
    () => getComputedStyle(document.querySelector('section-lens-root')).visibility,
  );
  check('UI restored after capture', overlayVisibleAfterCapture === 'visible');

  // Compact toggle.
  await page.locator('section-lens-root .seg button', { hasText: 'Compact' }).click();
  const compact = await page.locator('section-lens-root textarea.prompt').inputValue();
  check(
    'compact prompt within 2k–6k',
    compact.length >= 2000 && compact.length <= 6000,
    `${compact.length}`,
  );

  // Exports.
  await page.locator('section-lens-root .actions .btn', { hasText: 'Save prompt.md' }).click();
  await page.locator('section-lens-root .actions .btn', { hasText: 'Save reference.png' }).click();
  await page.locator('section-lens-root .actions .btn', { hasText: 'Save analysis.json' }).click();
  await page.waitForTimeout(300);
  const downloads = await page.evaluate(() => window.__slDownloads);
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
  await page.locator('section-lens-root .controls .wide').click();
  check(
    'unlock returns to hover mode',
    (await page.locator('section-lens-root .status').textContent())?.includes('INSPECTOR ACTIVE'),
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  check('Escape removes all injected UI', (await page.locator('section-lens-root').count()) === 0);
  for (let i = 0; i < 5; i++) await page.evaluate(() => window.__sectionLens.toggle());
  check(
    'repeated toggling leaves a single host',
    (await page.locator('section-lens-root').count()) === 1,
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
  const partialSel = await page.locator('section-lens-root .selector').textContent();
  check(
    'hovering a heading selects its section',
    partialSel === 'section#pricing',
    partialSel ?? '',
  );
  await page.keyboard.press('Enter');
  const partialChoice = await page
    .locator('section-lens-root .choice')
    .waitFor({ timeout: 4000 })
    .then(
      () => true,
      () => false,
    );
  check('partial-capture choice offered', partialChoice);
  if (partialChoice) {
    await page
      .locator('section-lens-root .choice .btn', { hasText: 'Capture visible area' })
      .click();
    await page.waitForFunction(
      () =>
        (document.querySelector('section-lens-root')?.shadowRoot?.querySelector('textarea.prompt')
          ?.value.length ?? 0) > 1000,
      null,
      { timeout: 15000 },
    );
    const partialPrompt = await page.locator('section-lens-root textarea.prompt').inputValue();
    check(
      'partial capture recorded as visible-only',
      partialPrompt.includes('**visible part only**'),
    );
  }
  await page.evaluate(() => window.__sectionLens.toggle());
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
