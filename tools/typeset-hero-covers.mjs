// Typeset the sample covers and spines for the landing-page hero reel (docs/specs/hero-variants/).
// Each cover is an Unsplash photo (free licence; credits in photos/credits.json) with a made-up title set in an
// open-licence Google Font. None imitates a real release.
// Usage: node tools/typeset-hero-covers.mjs [--browser chromium]   → docs/specs/hero-variants/art/*.png
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../cli/package.json', import.meta.url));
const { chromium } = require('playwright-core');
const DIR = new URL('../docs/specs/hero-variants/', import.meta.url);
const OUT = fileURLToPath(new URL('art/', DIR));
const FONTS = 'https://fonts.googleapis.com/css2?family=Archivo+Black&family=Bebas+Neue&family=DM+Serif+Display' +
  '&family=Jost:wght@300;500&family=Libre+Baskerville:wght@700&family=Space+Grotesk:wght@700&family=IBM+Plex+Mono:wght@500&display=swap';

// photo: photos/<id>.jpg, ink: text colour, shade: the overlay that keeps the title legible,
// title: CSS placing the title block (1024 px canvas; the hype sticker sits top right, so titles stay clear of it).
const COVERS = [
  {id: 'u01', name: 'LOW TIDE', ink: '#ffffff', font: "'Archivo Black'", shade: 'linear-gradient(to top,#00000088,transparent 55%)',
    title: 'left:64px;bottom:110px;font-size:150px;line-height:.9'},
  {id: 'u03', name: 'UNDERTOW', ink: '#ffffff', font: "'Bebas Neue'", shade: 'linear-gradient(to top,#00000077,transparent 50%)',
    title: 'left:60px;bottom:96px;font-size:250px;line-height:.85'},
  {id: 'u04', name: 'SLOW HEAT', ink: '#3b1d0e', font: "'DM Serif Display'", shade: 'linear-gradient(to bottom,#ffffff44,transparent 45%)',
    title: 'left:64px;top:80px;font-size:140px;line-height:.95'},
  {id: 'u05', name: 'DRIFT', ink: '#1c140c', font: 'Jost', weight: 300, shade: 'none',
    title: 'left:64px;bottom:100px;font-size:220px;line-height:1;letter-spacing:.06em'},
  {id: 'u07', name: 'SOFT RIOT', ink: '#ffffff', font: "'Libre Baskerville'", shade: 'linear-gradient(to top,#3a001888,transparent 55%)',
    title: 'left:64px;bottom:110px;font-size:110px;line-height:1.05'},
  {id: 'u09', name: 'BLOOM CYCLE', ink: '#ffffff', font: "'Space Grotesk'", shade: 'linear-gradient(to bottom,#00000066,transparent 45%)',
    title: 'left:64px;top:70px;font-size:120px;line-height:.92;letter-spacing:-.03em'},
  {id: 'u11', name: 'NORTHERN QUIET', ink: '#1d2328', font: 'Jost', weight: 500, shade: 'linear-gradient(to bottom,#ffffff55,transparent 50%)',
    title: 'left:64px;top:80px;font-size:96px;line-height:1;letter-spacing:.08em'},
  {id: 'u13', name: 'MERCURY DREAM', ink: '#ffffff', font: "'Archivo Black'", shade: 'linear-gradient(to top,#00000088,transparent 55%)',
    title: 'left:64px;bottom:110px;font-size:118px;line-height:.92'},
  {id: 'u15', name: 'AFTERIMAGE', ink: '#ffffff', font: "'Bebas Neue'", shade: 'linear-gradient(to top,#00000088,transparent 50%)',
    title: 'left:60px;bottom:96px;font-size:210px;line-height:.85'},
  {id: 'u16', name: 'SPECTRUM', ink: '#ffffff', font: "'DM Serif Display'", shade: 'none',
    title: 'left:64px;top:80px;font-size:118px;line-height:.95'},
  {id: 'u17', name: 'AMBER SIGNAL', ink: '#f6d48a', font: "'Libre Baskerville'", shade: 'none',
    title: 'left:64px;bottom:110px;font-size:104px;line-height:1.08'},
  {id: 'u19', name: 'NIGHT SHIFT', ink: '#ffffff', font: "'Space Grotesk'", shade: 'linear-gradient(to top,#00000077,transparent 50%)',
    title: 'left:64px;bottom:110px;font-size:140px;line-height:.9;letter-spacing:-.03em'},
  {id: 'u20', name: 'EXIT\u00a09', ink: '#ffffff', font: "'Bebas Neue'", shade: 'none',
    title: 'left:60px;top:70px;font-size:300px;line-height:.85'},
  {id: 'u22', name: 'SUNDIAL', ink: '#ffffff', font: 'Jost', weight: 500, shade: 'none',
    title: 'left:64px;bottom:100px;font-size:150px;line-height:1;letter-spacing:.04em'},
  {id: 'u26', name: 'DEEP CURRENT', ink: '#ffffff', font: "'Archivo Black'", shade: 'linear-gradient(to top,#00000077,transparent 55%)',
    title: 'left:64px;bottom:110px;font-size:120px;line-height:.92'},
  {id: 'u28', name: 'ECLIPSE', ink: '#2a2116', font: "'DM Serif Display'", shade: 'none',
    title: 'left:0;right:0;bottom:90px;text-align:center;font-size:150px;line-height:1'},
];

const page = (body, w, h) => `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${FONTS}">
<style>*{margin:0;box-sizing:border-box}html,body{width:${w}px;height:${h}px;overflow:hidden}</style>${body}`;
const titleStyle = c => `font-family:${c.font};font-weight:${c.weight || 400};color:${c.ink}`;

const cover = (c, photo) => page(`<div style="position:relative;width:1024px;height:1024px;background:url(${photo}) center/cover;overflow:hidden">
  <div style="position:absolute;inset:0;background:${c.shade}"></div>
  <div style="position:absolute;${c.title};${titleStyle(c)}">${c.name.split(' ').join('<br>')}</div>
  <div style="position:absolute;left:64px;right:64px;bottom:40px;display:flex;justify-content:space-between;
    font:500 17px 'IBM Plex Mono';letter-spacing:.1em;color:${c.ink};opacity:.85">
    <span>RM-${c.id.slice(1)} · 12" LP</span><span>SAMPLE COVER</span></div></div>`, 1024, 1024);

// The spine is 6 mm wide: a 32 × 2048 strip cut from the photo's left edge, with the title running top to bottom.
const spine = (c, photo) => page(`<div style="position:relative;width:32px;height:2048px;background:url(${photo}) left center/auto 100%">
  <div style="position:absolute;inset:0;background:#00000055"></div>
  <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
  <div style="writing-mode:vertical-rl;font:500 19px 'IBM Plex Mono';letter-spacing:.14em;color:#ffffff;white-space:nowrap">
    ${c.name} &nbsp;·&nbsp; RM-${c.id.slice(1)}</div></div></div>`, 32, 2048);

await mkdir(OUT, {recursive: true});
const browser = await chromium.launch({channel: process.argv.includes('--browser') ? undefined : 'chrome'});
for (const c of COVERS) {
  const photo = 'data:image/jpeg;base64,' + (await readFile(new URL(`photos/${c.id}.jpg`, DIR))).toString('base64');
  for (const [kind, html, w, h] of [['front', cover(c, photo), 1024, 1024], ['spine', spine(c, photo), 32, 2048]]) {
    const p = await browser.newPage({viewport: {width: w, height: h}, deviceScaleFactor: 2});
    await p.setContent(html, {waitUntil: 'networkidle'});
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({path: `${OUT}${c.id}-${kind}.png`});
    await p.close();
  }
}
await browser.close();
console.log(`${COVERS.length} covers and spines in ${OUT}`);
