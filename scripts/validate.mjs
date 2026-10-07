// Validates dist/: manifest shape, permissions, and that every referenced file exists.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const dist = resolve(root, 'dist');
const errors = [];
const fail = (m) => errors.push(m);

const manifestPath = resolve(dist, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('dist/manifest.json is missing — run npm run build first.');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
if (!manifest.name) fail('name is required');
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) fail(`invalid version "${manifest.version}"`);
if (manifest.version !== pkg.version)
  fail(`manifest version ${manifest.version} != package.json ${pkg.version}`);
if (!manifest.background?.service_worker) fail('background.service_worker missing');
if (manifest.background?.type !== 'module') fail('background.type should be "module"');

const ALLOWED = new Set(['activeTab', 'scripting', 'storage', 'downloads']);
for (const p of manifest.permissions ?? [])
  if (!ALLOWED.has(p)) fail(`unexpected permission "${p}"`);
if (manifest.host_permissions?.length) fail('host_permissions must be empty (activeTab only)');
if (manifest.content_scripts?.length)
  fail('content scripts must be injected on demand, not declared');

const referenced = new Set([
  manifest.background.service_worker,
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
  'content.js', // injected by background.js via chrome.scripting
  'notice.html',
  'notice.js',
]);
if (manifest.action?.default_popup) referenced.add(manifest.action.default_popup);
for (const file of referenced) {
  const p = resolve(dist, file);
  if (!existsSync(p)) fail(`referenced file missing: ${file}`);
  else if (statSync(p).size === 0) fail(`referenced file is empty: ${file}`);
}

const bg = readFileSync(resolve(dist, manifest.background.service_worker), 'utf8');
if (!bg.includes('content.js')) fail('background.js does not reference content.js');
if (/\bimport\s*\(|from\s*["']\.\//.test(bg))
  fail('background.js must be a single self-contained module');
const content = readFileSync(resolve(dist, 'content.js'), 'utf8');
if (/^\s*(import|export)\s/m.test(content))
  fail('content.js must be a classic script (no ES module syntax)');
for (const banned of ['eval(', 'new Function(']) {
  if (content.includes(banned) || bg.includes(banned)) fail(`bundle contains ${banned}`);
}
const html = readFileSync(resolve(dist, 'notice.html'), 'utf8');
if (/<script(?![^>]*\bsrc=)[^>]*>/.test(html))
  fail('notice.html contains an inline script (blocked by MV3 CSP)');

// Manifest localization: default locale present, every __MSG_key__ defined in every locale.
const localesDir = resolve(dist, '_locales');
const msgKeys = [...JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)].map((m) => m[1]);
if (msgKeys.length && !manifest.default_locale) fail('__MSG_ placeholders require default_locale');
if (
  manifest.default_locale &&
  !existsSync(resolve(localesDir, manifest.default_locale, 'messages.json'))
) {
  fail(
    `default_locale "${manifest.default_locale}" has no _locales/${manifest.default_locale}/messages.json`,
  );
}
for (const locale of ['fa', 'en']) {
  const file = resolve(localesDir, locale, 'messages.json');
  if (!existsSync(file)) {
    fail(`missing _locales/${locale}/messages.json`);
    continue;
  }
  const msgs = JSON.parse(readFileSync(file, 'utf8'));
  for (const key of msgKeys)
    if (!msgs[key]?.message) fail(`_locales/${locale} is missing "${key}"`);
}
if (manifest.name !== 'AJ Lens' || manifest.short_name !== 'AJ Lens')
  fail('name and short_name must be "AJ Lens"');

if (errors.length) {
  console.error('Validation failed:\n' + errors.map((e) => `  ✗ ${e}`).join('\n'));
  process.exit(1);
}
console.log(
  `✓ dist/ is a valid MV3 extension (${referenced.size} referenced files present, permissions: ${manifest.permissions.join(', ')})`,
);
