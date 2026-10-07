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

/** Header geometry from inside the shadow root. */
async function headerLayout(p) {
  return p.evaluate(() => {
    const r = document.querySelector('aj-lens-root').shadowRoot;
    const box = (sel) => {
      const b = r.querySelector(sel).getBoundingClientRect();
      return { x: b.x, right: b.right, width: b.width, height: b.height };
    };
    const hdr = r.querySelector('header.hdr');
    const sel = r.querySelector('[data-testid="language-selector"]');
    return {
      brand: box('[data-testid="brand-group"]'),
      selector: box('[data-testid="language-selector"]'),
      controls: box('[data-testid="window-controls"]'),
      header: box('header.hdr'),
      panel: box('.panel'),
      overflow: hdr.scrollWidth > hdr.clientWidth + 1 || sel.scrollWidth > sel.clientWidth + 1,
      selectorsTotal: r.querySelectorAll('[data-testid="language-selector"]').length,
      inHeader: hdr.contains(sel),
      inBody: !!r.querySelector('.body [data-testid="language-selector"], .body .lang-row'),
      bodyHasLanguageLabel: Array.from(r.querySelectorAll('.body .label')).some((l) =>
        ['زبان', 'Language'].includes(l.textContent.trim()),
      ),
      lang: r.querySelector('.panel').getAttribute('lang'),
    };
  });
}
const ordered = (l, rtl) =>
  rtl
    ? l.brand.x > l.selector.right - 1 && l.selector.x > l.controls.right - 1
    : l.brand.right < l.selector.x + 1 && l.selector.right < l.controls.x + 1;
const fitsInside = (l) =>
  l.brand.x >= l.header.x - 1 &&
  l.controls.right <= l.header.right + 1 &&
  l.selector.x >= l.header.x &&
  l.selector.right <= l.header.right;

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
    // English browser with no stored AJ Lens locale: the panel must still open in Persian.
    locale: 'en-US',
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
  const rawManifest = JSON.parse(readFileSync(resolve(dist, 'manifest.json'), 'utf8'));
  const localeMsgs = (l) =>
    JSON.parse(readFileSync(resolve(dist, '_locales', l, 'messages.json'), 'utf8'));
  check(
    'command description localized via _locales (fa + en)',
    rawManifest.commands._execute_action.description === '__MSG_commandToggle__' &&
      rawManifest.description === '__MSG_extDescription__' &&
      // English browser → Chrome resolves the English message.
      manifest.commands?._execute_action?.description === 'Toggle the AJ Lens inspector' &&
      localeMsgs('fa').commandToggle.message === 'فعال یا غیرفعال‌کردن بازرس AJ Lens' &&
      localeMsgs('en').commandToggle.message === 'Toggle the AJ Lens inspector' &&
      manifest.default_locale === 'fa',
  );
  check(
    'Chrome resolves the localized description',
    (await sw.evaluate(() => chrome.i18n.getMessage('extDescription'))).length > 20,
  );

  // Restricted-page popup renders in Persian.
  const noticePage = await context.newPage();
  await noticePage.goto(
    sw.url().replace('background.js', 'notice.html?key=restrictedBrowser&lang=fa'),
  );
  check(
    'restricted-page popup is Persian and RTL',
    (await noticePage.locator('#reason').textContent()) ===
      'AJ Lens نمی‌تواند در صفحات داخلی مرورگر یا فروشگاه Chrome اجرا شود. یک وب‌سایت معمولی را باز کنید و دوباره تلاش کنید.' &&
      (await noticePage.evaluate(() => document.documentElement.dir)) === 'rtl',
  );
  await noticePage.close();

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
  check(
    'no stored locale + English browser → Persian saved as default',
    (await page.evaluate(() => window.__ajlStored['aj-lens.preferences']?.locale)) === 'fa' &&
      (await page.evaluate(() => navigator.language)) === 'en-US',
  );
  const sr = (sel) => page.locator(`aj-lens-root ${sel}`);
  const txt = async (sel) => ((await sr(sel).first().textContent()) ?? '').trim();
  check(
    'panel root is lang="fa" dir="rtl"',
    (await panel.getAttribute('lang')) === 'fa' && (await panel.getAttribute('dir')) === 'rtl',
  );
  check('inspector state is Persian', (await txt('[data-testid="status"]')) === 'بازرس فعال است');
  check(
    'heading and description are Persian',
    (await txt('.tagline')) === 'انتخاب کنید، ثبت کنید، بازسازی کنید.' &&
      (await txt('.desc')).startsWith('نشانگر را روی یک بخش ببرید'),
  );
  const persianButtons = {
    '[data-testid="nav-parent"]': '↑ والد',
    '[data-testid="nav-child"]': '↓ بخش کوچک‌تر',
    '[data-testid="pick-another"]': 'انتخاب بخش دیگر',
    '[data-testid="lock-toggle"]': 'قفل‌کردن بخش',
    '[data-testid="refresh"]': '↻ اندازه‌گیری دوباره',
    '[data-testid="mode-detailed"]': 'کامل',
    '[data-testid="mode-compact"]': 'خلاصه',
    '[data-testid="copy-full-prompt"]': 'کپی کامل پرامپت',
    '[data-testid="save-prompt"]': 'ذخیره prompt.md',
    '[data-testid="save-reference"]': 'ذخیره reference.png',
    '[data-testid="save-analysis"]': 'ذخیره analysis.json',
  };
  const wrongButtons = [];
  for (const [sel, want] of Object.entries(persianButtons)) {
    const got = await txt(sel);
    if (got !== want) wrongButtons.push(`${sel}: "${got}"`);
  }
  check(
    'buttons, prompt tabs, copy and export buttons are Persian',
    wrongButtons.length === 0,
    wrongButtons.join('; '),
  );
  const buildLabel = await txt('label.label');
  const buildOption = await page.evaluate(() => {
    const sel = document
      .querySelector('aj-lens-root')
      .shadowRoot.querySelector('[data-testid="build-target"]');
    return sel.querySelector('option[value="existing"]').text; // default option (migrated user has Next.js)
  });
  check(
    'build target label and default option are Persian',
    buildLabel === 'فناوری ساخت' && buildOption === 'پیروی از فناوری‌های موجود پروژه',
    `${buildLabel} / ${buildOption}`,
  );
  check('include section is Persian', (await txt('.options summary')) === 'موارد موجود در پرامپت');
  const footer = await txt('[data-testid="footer"]');
  check(
    'footer is Persian',
    footer.includes('Esc: بستن') &&
      footer.includes('کلیک: قفل‌کردن') &&
      footer.includes('هیچ داده‌ای بارگذاری نمی‌شود'),
  );
  const clipped = await page.evaluate(() =>
    Array.from(
      document
        .querySelector('aj-lens-root')
        .shadowRoot.querySelectorAll('.btn, .seg button, .label, .status, .tagline'),
    )
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .map((el) => el.textContent.trim()),
  );
  check('no Persian label is clipped', clipped.length === 0, clipped.join(' | '));

  // ---- Header language selector.
  let hl = await headerLayout(page);
  check(
    'single language selector, in the header, none in the body',
    hl.selectorsTotal === 1 && hl.inHeader && !hl.inBody && !hl.bodyHasLanguageLabel,
  );
  check(
    'Persian active in header selector',
    (await sr('[data-testid="locale-fa"]').getAttribute('aria-pressed')) === 'true' &&
      (await txt('[data-testid="locale-fa"]')) === 'فارسی' &&
      (await txt('[data-testid="locale-en"]')) === 'EN',
  );
  check(
    'RTL header: brand right, selector middle, controls left',
    ordered(hl, true) && fitsInside(hl) && !hl.overflow,
    `brand ${Math.round(hl.brand.x)} / selector ${Math.round(hl.selector.x)} / controls ${Math.round(hl.controls.x)}`,
  );
  check('header height stays compact', hl.header.height <= 48, `${hl.header.height}px`);

  // Real keyboard activation (Space / Enter) on the header buttons.
  await sr('[data-testid="locale-en"]').focus();
  await page.keyboard.press('Space');
  hl = await headerLayout(page);
  check(
    'Space on EN switches to English; LTR header order',
    hl.lang === 'en' &&
      (await txt('[data-testid="status"]')) === 'Inspector active' &&
      ordered(hl, false) &&
      !hl.overflow,
  );
  await sr('[data-testid="locale-fa"]').focus();
  await page.keyboard.press('Enter');
  hl = await headerLayout(page);
  check('Enter on فارسی switches back to Persian', hl.lang === 'fa' && ordered(hl, true));

  // Language-button presses never drag the panel.
  const posBefore = await panel.boundingBox();
  const enBox = await sr('[data-testid="locale-en"]').boundingBox();
  await page.mouse.move(enBox.x + 5, enBox.y + 5);
  await page.mouse.down();
  await page.mouse.move(enBox.x - 120, enBox.y + 140, { steps: 5 });
  await page.mouse.up();
  const posAfter = await panel.boundingBox();
  check(
    'pressing/dragging on the language selector does not move the panel',
    Math.abs(posAfter.x - posBefore.x) < 1 && Math.abs(posAfter.y - posBefore.y) < 1,
  );
  await sr('[data-testid="locale-fa"]').click();

  // Minimized header stays usable in both languages.
  await sr('[data-testid="minimize"]').click();
  for (const loc of ['fa', 'en']) {
    await sr(`[data-testid="locale-${loc}"]`).click();
    hl = await headerLayout(page);
    check(
      `minimized header (${loc}) fits without overflow`,
      hl.lang === loc && !hl.overflow && fitsInside(hl) && ordered(hl, loc === 'fa'),
      `${Math.round(hl.panel.width)}px wide`,
    );
  }
  await sr('[data-testid="locale-fa"]').click();
  await sr('[data-testid="minimize"]').click();

  // Browser zoom 125% / 150% ≈ CSS viewport 1024 / 853 px wide at 1280 device px.
  for (const [w, h, label] of [
    [1024, 640, '125%'],
    [853, 533, '150%'],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(150);
    hl = await headerLayout(page);
    check(
      `header fits at ${label} zoom-equivalent width`,
      !hl.overflow && fitsInside(hl) && hl.panel.right <= w + 1 && hl.panel.x >= 0,
    );
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(150);
  // Leave focus on the page: Enter on a focused panel button activates that button, not "lock".
  await page.evaluate(() =>
    document.querySelector('aj-lens-root').shadowRoot.activeElement?.blur(),
  );
  // Restore the default build target so prompt assertions below stay comparable.
  await page.locator('aj-lens-root select').selectOption('existing');
  check(
    'panel isolated from page CSS (Persian font stack)',
    /Vazirmatn/.test(await panel.evaluate((el) => getComputedStyle(el).fontFamily)) &&
      !/Georgia/.test(await panel.evaluate((el) => getComputedStyle(el).fontFamily)),
  );
  const box = await panel.boundingBox();
  check(
    'panel docked top-right, ~360px wide',
    box && box.x > 800 && box.width >= 330 && box.width <= 365,
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
  await page.locator('aj-lens-root [data-testid="mode-detailed"]').click();
  const detailedPrompt = await page.locator('aj-lens-root textarea.prompt').inputValue();
  const detailedCount = Number(
    await page.locator('aj-lens-root [data-testid="char-count"]').getAttribute('data-count'),
  );
  check(
    'generated prompt is English in an LTR editor',
    !/[\u0600-\u06FF]/.test(detailedPrompt) &&
      (await sr('textarea.prompt').getAttribute('dir')) === 'ltr' &&
      (await sr('textarea.prompt').getAttribute('lang')) === 'en',
  );
  const meta = await page.evaluate(() => {
    const el = document
      .querySelector('aj-lens-root')
      .shadowRoot.querySelector('[data-testid="selection-meta"] bdi');
    return { text: el.textContent, dir: getComputedStyle(el).direction };
  });
  check(
    'selector and dimensions stay LTR',
    /^[\d.]+ × [\d.]+ px$/.test(meta.text) &&
      meta.dir === 'ltr' &&
      (await sr('.selector').evaluate((e) => getComputedStyle(e).direction)) === 'ltr',
    meta.text,
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
      'پرامپت کامل کپی شد',
    ),
  );
  check(
    'Persian copy confirmation announced',
    (await sr('[aria-live="polite"]').textContent()) === 'پرامپت کامل کپی شد',
  );
  const lockedLabel = await page.evaluate(() => {
    const el = document.querySelector('aj-lens-root').shadowRoot.querySelector('.ajl-label');
    return { text: el.textContent, dir: el.getAttribute('dir') };
  });
  check(
    'page overlay label is Persian with LTR selector',
    lockedLabel.text.startsWith('قفل‌شده · section#pricing · ') &&
      lockedLabel.dir === 'rtl' &&
      !/LOCKED/i.test(lockedLabel.text),
    lockedLabel.text,
  );
  check(
    'status shows locked',
    (await page.locator('aj-lens-root .status').textContent())?.includes('بخش قفل شده است'),
  );
  check(
    'lock button switched to Unlock',
    (await page.locator('aj-lens-root .controls .wide').textContent()) === 'بازکردن قفل',
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
  await page.locator('aj-lens-root [data-testid="mode-compact"]').click();
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
  await page.locator('aj-lens-root [data-testid="save-prompt"]').click();
  await page.locator('aj-lens-root [data-testid="save-reference"]').click();
  await page.locator('aj-lens-root [data-testid="save-analysis"]').click();
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
    // Header screenshots (Persian, English) for the documentation.
    await page
      .locator('aj-lens-root header.hdr')
      .screenshot({ path: join(process.env.SMOKE_ARTIFACTS, 'header-fa.png') });
    await page.locator('aj-lens-root [data-testid="locale-en"]').click();
    await page
      .locator('aj-lens-root header.hdr')
      .screenshot({ path: join(process.env.SMOKE_ARTIFACTS, 'header-en.png') });
    await page
      .locator('aj-lens-root .panel')
      .screenshot({ path: join(process.env.SMOKE_ARTIFACTS, 'panel-en.png') });
    await page.locator('aj-lens-root [data-testid="locale-fa"]').click();
    // Full-height Persian panel for the documentation.
    await page.setViewportSize({ width: 1280, height: 1500 });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      document.querySelector('aj-lens-root').shadowRoot.querySelector('.body').scrollTop = 0;
    });
    await page
      .locator('aj-lens-root .panel')
      .screenshot({ path: join(process.env.SMOKE_ARTIFACTS, 'panel-fa.png') });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(150);
  }
  check('secrets absent from prompt', !compact.includes('hunter2') && !prompt.includes('hunter2'));

  // Unlock / close / cleanup.
  await page.locator('aj-lens-root .controls .wide').click();
  check(
    'unlock returns to hover mode',
    (await page.locator('aj-lens-root .status').textContent())?.includes('بازرس فعال است'),
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
    check(
      'partial-capture dialog is Persian',
      (await sr('[data-testid="capture-choice"]').textContent()).includes(
        'بخشی از ناحیه انتخاب‌شده خارج از محدوده قابل مشاهده است.',
      ) && (await txt('[data-testid="capture-visible"]')) === 'ثبت بخش قابل مشاهده',
    );
    await page.locator('aj-lens-root [data-testid="capture-visible"]').click();
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
  // Language selector: switch to English immediately, persist across close/reopen, switch back.
  if ((await page.locator('aj-lens-root .panel').count()) === 0) {
    await page.evaluate(() => window.__ajLens.toggle());
    await page.locator('aj-lens-root .panel').waitFor();
  }
  await page.locator('aj-lens-root [data-testid="locale-en"]').click();
  const panelNow = page.locator('aj-lens-root .panel');
  check(
    'switching to English updates the panel immediately',
    (await panelNow.getAttribute('dir')) === 'ltr' &&
      (await txt('[data-testid="copy-full-prompt"]')) === 'Copy full prompt',
  );
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__ajLens.toggle());
  await page.locator('aj-lens-root .panel').waitFor();
  await page.waitForTimeout(200);
  check(
    'English choice persists after closing and reopening',
    (await page.locator('aj-lens-root .panel').getAttribute('lang')) === 'en' &&
      (await txt('[data-testid="status"]')) === 'Inspector active',
  );
  await page.locator('aj-lens-root [data-testid="locale-fa"]').click();
  check(
    'switching back to فارسی restores RTL',
    (await page.locator('aj-lens-root .panel').getAttribute('dir')) === 'rtl' &&
      (await txt('[data-testid="status"]')) === 'بازرس فعال است',
  );
  await page.evaluate(() => window.__ajLens.toggle());

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
