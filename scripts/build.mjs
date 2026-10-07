// Builds the three extension entry points with Vite and copies static files from public/.
// Usage: node scripts/build.mjs [--watch]
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const outDir = resolve(root, 'dist');
const watch = process.argv.includes('--watch');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const entries = [
  // Content script: classic IIFE (injected with chrome.scripting.executeScript).
  { name: 'content', entry: 'src/content/index.ts', format: 'iife', publicDir: 'public' },
  // Service worker: ES module ("type": "module" in the manifest).
  { name: 'background', entry: 'src/background/index.ts', format: 'es', publicDir: false },
  // Notice popup script for restricted pages.
  { name: 'notice', entry: 'src/notice/index.ts', format: 'iife', publicDir: false },
];

rmSync(outDir, { recursive: true, force: true });

for (const e of entries) {
  await build({
    root,
    configFile: false,
    logLevel: watch ? 'info' : 'warn',
    publicDir: e.publicDir ? resolve(root, e.publicDir) : false,
    plugins: [react()],
    define: {
      'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production'),
      __AJL_VERSION__: JSON.stringify(pkg.version),
    },
    build: {
      outDir,
      emptyOutDir: false,
      target: 'chrome127',
      minify: !watch,
      sourcemap: watch ? 'inline' : false,
      copyPublicDir: Boolean(e.publicDir),
      watch: watch ? {} : null,
      lib: {
        entry: resolve(root, e.entry),
        formats: [e.format],
        name: 'AJLens',
        fileName: () => `${e.name}.js`,
      },
    },
  });
}

if (!watch) console.log(`Built AJ Lens ${pkg.version} → dist/`);
