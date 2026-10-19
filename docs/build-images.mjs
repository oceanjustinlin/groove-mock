#!/usr/bin/env node
// Rebuild the README images from docs/specs/*.json.
// Every image uses the renderer's built-in sample artwork, so the repository can show them freely.
// Usage: node docs/build-images.mjs   (after `npm ci --prefix cli`)
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

const DOCS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(DOCS);
const CLI = path.join(ROOT, 'cli', 'groove-mock.mjs');
const OUT = path.join(DOCS, 'images');
const {chromium} = createRequire(path.join(ROOT, 'cli', 'package.json'))('playwright-core');

// README images: [spec name, output file]. JPEG keeps the README light.
const SHOTS = [['hero', 'hero.jpg'], ['gatefold-open', 'gatefold-open.jpg'], ['back', 'back-cover.jpg'], ['vinyl', 'vinyl-variants.jpg'], ['patterns', 'vinyl-patterns.jpg']];

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'groove-mock-docs-'));
const render = name => {
  const out = path.join(tmp, `${name}.png`);
  execFileSync(process.execPath, [CLI, 'render', path.join(DOCS, 'specs', `${name}.json`), '-o', out, '--strict'], {stdio: 'inherit'});
  return out;
};

const browser = await chromium.launch({channel: process.env.GROOVE_BROWSER || 'chrome'});
try {
  await fs.mkdir(OUT, {recursive: true});
  for (const [name, file] of SHOTS) {
    const png = render(name);
    const page = await browser.newPage();
    await page.goto(pathToFileURL(png).href);
    const {w, h} = await page.evaluate(() => ({w: document.images[0].naturalWidth, h: document.images[0].naturalHeight}));
    await page.setViewportSize({width: w, height: h});
    await page.addStyleTag({content: 'html,body{margin:0}img{display:block}'});
    await page.screenshot({path: path.join(OUT, file), type: 'jpeg', quality: 84});
    await page.close();
    console.log(`docs/images/${file}`);
  }

  // GitHub social preview: 1280 × 640, product name + one line + a transparent render.
  const art = await fs.readFile(render('social'));
  const page = await browser.newPage({viewport: {width: 1280, height: 640}});
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..100,600..800&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;width:1280px;height:640px;overflow:hidden;background:#ece9e2;color:#1a1e1b;font-family:"Archivo",system-ui,sans-serif}
  .wrap{position:relative;height:100%;padding:72px 0 0 72px;box-sizing:border-box}
  h1{margin:0;font-size:92px;font-weight:800;font-stretch:78%;line-height:.95;letter-spacing:-.01em}
  p{margin:22px 0 0;max-width:430px;font-size:27px;line-height:1.3;font-weight:600;font-stretch:90%}
  .tags{position:absolute;left:72px;bottom:64px;max-width:400px;font:500 16px/1.6 "IBM Plex Mono",monospace;letter-spacing:.04em;color:#4d564f}
  img{position:absolute;right:-70px;top:22px;width:880px}
</style></head><body><div class="wrap">
  <h1>Groove<br>Mock</h1>
  <p>3D vinyl record mockups, in the browser or from a JSON spec.</p>
  <div class="tags">GATEFOLD · 2LP · SHRINK WRAP · OBI · EDITION NUMBERS</div>
  <img src="data:image/png;base64,${art.toString('base64')}" alt="">
</div></body></html>`, {waitUntil: 'networkidle'});
  await page.screenshot({path: path.join(OUT, 'social-preview.png')});
  console.log('docs/images/social-preview.png');
} finally {
  await browser.close();
  await fs.rm(tmp, {recursive: true, force: true});
}
