// Screenshot a 1024 × 1024 sticker page to a PNG next to it: node tools/typeset-sticker.mjs <page.html> [--browser chromium]
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(new URL('../cli/package.json', import.meta.url));
const { chromium } = require('playwright-core');

const src = resolve(process.argv[2]);
const out = src.replace(/\.html$/, '.png');
const channel = process.argv.includes('--browser') ? undefined : 'chrome';
const browser = await chromium.launch({ channel });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.goto(pathToFileURL(src).href);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: out });
await browser.close();
console.log(out);
