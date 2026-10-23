// Cut several clips of the same animation into one reel: frames [0, cut) come from the first clip, [cut, 2·cut)
// from the second, and so on, cycling. The clips must share timing and framing (same animation settings and record
// positions), so the motion runs on unbroken while the artwork changes at every cut.
// Usage: node tools/stitch-hero-reel.mjs --cut 12 -o reel.mp4 a.mp4 b.mp4 …   (also writes reel.jpg, the first frame)
// Decoding and encoding run in Chrome through mediabunny, the same library the editor uses for MP4 export.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const require = createRequire(new URL('../cli/package.json', import.meta.url));
const { chromium } = require('playwright-core');
const MEDIABUNNY_URL = 'https://cdn.jsdelivr.net/npm/mediabunny@1.61.3/dist/bundles/mediabunny.min.mjs';

const {values: opt, positionals: clips} = parseArgs({allowPositionals: true,
  options: {cut: {type: 'string', default: '12'}, out: {type: 'string', short: 'o'}, browser: {type: 'string'}}});
if (!opt.out || clips.length < 2) throw new Error('usage: stitch-hero-reel.mjs --cut 12 -o reel.mp4 a.mp4 b.mp4 …');

const browser = await chromium.launch({channel: opt.browser ? undefined : 'chrome'});
const page = await browser.newPage();
// WebCodecs needs a secure context, so serve an empty page from an https origin intercepted right here.
await page.route('https://reel.localhost/', r => r.fulfill({contentType: 'text/html', body: '<!doctype html>'}));
await page.goto('https://reel.localhost/');
const data = await Promise.all(clips.map(async f => (await readFile(f)).toString('base64')));
const result = await page.evaluate(async ({url, data, cut}) => {
  const mb = await import(url);
  const bytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
  const b64 = buf => {let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(bin)};
  const tracks = await Promise.all(data.map(d =>
    new mb.Input({source: new mb.BufferSource(bytes(d)), formats: mb.ALL_FORMATS}).getPrimaryVideoTrack()));
  const t0 = tracks[0], fps = (await t0.computePacketStats()).averagePacketRate, frames = Math.round(await t0.computeDuration() * fps);
  const w = t0.displayWidth, h = t0.displayHeight;
  const sinks = tracks.map(t => new mb.VideoSampleSink(t));
  const output = new mb.Output({format: new mb.Mp4OutputFormat({fastStart: 'in-memory'}), target: new mb.BufferTarget()});
  const src = new mb.VideoSampleSource({codec: 'avc', quality: mb.QUALITY_HIGH, keyFrameInterval: 1});
  output.addVideoTrack(src, {frameRate: Math.round(fps)});
  await output.start();
  let n = 0, poster = '';
  for (let start = 0, seg = 0; start < frames; start += cut, seg++) {
    const end = Math.min(frames, start + cut);
    // The sink yields every sample overlapping the range, so keep only the frames whose index falls inside it.
    for await (const s of sinks[seg % sinks.length].samples(start / fps, end / fps)) {
      const i = Math.round(s.timestamp * fps);
      if (i < start || i >= end) { s.close(); continue }
      if (!poster) {
        const cv = new OffscreenCanvas(w, h);
        s.draw(cv.getContext('2d'), 0, 0, w, h);
        const blob = await cv.convertToBlob({type: 'image/jpeg', quality: .86});
        poster = b64(new Uint8Array(await blob.arrayBuffer()));
      }
      await src.add(s); s.close(); n++;
    }
  }
  await output.finalize();
  return {mp4: b64(new Uint8Array(output.target.buffer)), poster, frames, written: n, fps, w, h};
}, {url: MEDIABUNNY_URL, data, cut: +opt.cut});
await browser.close();

await writeFile(opt.out, Buffer.from(result.mp4, 'base64'));
await writeFile(opt.out.replace(/\.mp4$/, '.jpg'), Buffer.from(result.poster, 'base64'));
console.log(JSON.stringify({out: opt.out, frames: result.frames, written: result.written, fps: result.fps, size: [result.w, result.h]}));
