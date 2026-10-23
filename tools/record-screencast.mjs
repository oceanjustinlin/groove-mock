// Record the editor's real mobile UI, then convert its silent WebM to two H.264 MP4s.
// Usage: node tools/record-screencast.mjs [--browser chromium] [--frames <dir>]
// Output: docs/marketing/screencast-{9x16,1x1}.{mp4,jpg} (not committed; re-record when the UI changes).
// The cover comes from docs/specs/hero-variants/art/, so run node tools/typeset-hero-covers.mjs first.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../cli/package.json', import.meta.url));
const { chromium } = require('playwright-core');
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const COVER = join(ROOT, 'docs/specs/hero-variants/art/u07-front.png');
const OUT = join(ROOT, 'docs/marketing');
const framesArg = process.argv.indexOf('--frames');
if (framesArg !== -1 && !process.argv[framesArg + 1]) throw new Error('--frames needs a directory');
const framesDir = framesArg === -1 ? null : resolve(process.argv[framesArg + 1]);
const MEDIABUNNY_URL = 'https://cdn.jsdelivr.net/npm/mediabunny@1.61.3/dist/bundles/mediabunny.min.mjs';
const allowed = u => u.startsWith('http://127.0.0.1:') || u.startsWith('https://cdn.jsdelivr.net/') || u.startsWith('https://fonts.googleapis.com/') || u.startsWith('https://fonts.gstatic.com/') || u.startsWith('https://reel.localhost/');
const sleep = ms => new Promise(r => setTimeout(r, ms));

await readFile(COVER).catch(() => { throw new Error(`${COVER} is missing: run node tools/typeset-hero-covers.mjs first`) });
await mkdir(OUT, {recursive:true});
if (framesDir) await mkdir(framesDir, {recursive:true});
const temp = await mkdtemp(join(tmpdir(), 'record-screencast-'));
const server = createServer(async (req, res) => {
  const path = resolve(ROOT, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (path !== ROOT && !path.startsWith(ROOT + sep)) { res.writeHead(403).end(); return }
  try {
    const body = await readFile(path === ROOT ? join(ROOT, 'index.html') : path);
    const type = path===ROOT ? 'text/html' : ({'.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp'}[extname(path)] || 'application/octet-stream');
    res.writeHead(200, {'Content-Type':type}); res.end(body);
  } catch { res.writeHead(404).end() }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({channel:process.argv.includes('--browser') ? undefined : 'chrome'});

async function record(name, viewport, size) {
  // Playwright pads a recording when recordVideo.size exceeds the CSS viewport.
  const context = await browser.newContext({viewport, deviceScaleFactor:2, recordVideo:{dir:temp, size:viewport}, colorScheme:'light', reducedMotion:'reduce'});
  await context.route('**/*', route => allowed(route.request().url()) ? route.continue() : route.abort());
  const pageCreatedAt = Date.now();
  const page = await context.newPage();
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '#demo-cursor{position:fixed;left:0;top:0;z-index:99999;pointer-events:none;width:19px;height:19px;border:3px solid #fff;border-radius:50%;background:#2544d0;box-shadow:0 0 0 2px #173078,0 3px 10px #0008;transform:translate(-50px,-50px);transition:transform .24s ease-out} .demo-ripple{position:fixed;z-index:99998;pointer-events:none;width:24px;height:24px;border:2px solid #3154dd;border-radius:50%;animation:demo-ripple .42s ease-out forwards}@keyframes demo-ripple{to{opacity:0;transform:scale(2.2)}}';
      document.head.append(style);
      const cursor = document.createElement('div'); cursor.id = 'demo-cursor'; document.body.append(cursor);
      window.demoCursor = (x,y,ripple=false) => {
        cursor.style.transform = `translate(${x-9}px,${y-9}px)`;
        if (ripple) { const ring=document.createElement('div'); ring.className='demo-ripple'; ring.style.left=(x-12)+'px'; ring.style.top=(y-12)+'px'; document.body.append(ring); setTimeout(()=>ring.remove(),500) }
      };
    }, {once:true});
  });
  const click = async selector => {
    const el = page.locator(selector); await el.scrollIntoViewIfNeeded();
    const box = await el.boundingBox(); if (!box) throw new Error(`Not visible: ${selector}`);
    const x=box.x+box.width/2, y=box.y+box.height/2;
    await page.evaluate(([x,y]) => window.demoCursor(x,y), [x,y]); await sleep(300);
    await page.evaluate(([x,y]) => window.demoCursor(x,y,true), [x,y]); await el.click(); await sleep(250);
  };
  try {
    await page.goto(origin, {waitUntil:'domcontentloaded'});
    await page.locator('#loading').waitFor({state:'hidden', timeout:30000});
    await page.evaluate(() => window.recordMockup.apply({obi:{on:false}}));
    const readyAt = Date.now();
    await sleep(1300); // default editor and sample scene
    await click('#tab-jacket');
    const tile = page.locator('label[data-slot="front"]'); await tile.scrollIntoViewIfNeeded();
    const box=await tile.boundingBox(); await page.evaluate(([x,y])=>window.demoCursor(x,y),[box.x+box.width/2,box.y+box.height/2]); await sleep(250);
    const chooser=page.waitForEvent('filechooser'); await tile.click(); await (await chooser).setFiles(COVER);
    await page.waitForFunction(() => document.querySelector('label[data-slot="front"] .tag')?.textContent !== '示例');
    await sleep(1400);
    await click('#tab-records'); await sleep(450);
    await click('#vinyl-style [data-v="color"]'); await sleep(900);
    await click('#vinyl-look [data-v="pattern"]'); await sleep(1000);
    const colour=page.locator('#vinyl-color'); await colour.scrollIntoViewIfNeeded();
    const cb=await colour.boundingBox(); await page.evaluate(([x,y])=>window.demoCursor(x,y,true),[cb.x+cb.width/2,cb.y+cb.height/2]);
    await colour.fill('#25bfb0'); await sleep(1300);
    await click('#tab-pack'); await sleep(400);
    await click('#sticker-on'); await sleep(420); // sample sticker off
    await click('#sticker-on'); await sleep(450); // turn it back on with a template
    await click('#sticker-source [data-v="template"]');
    await click('#tpl-open'); await sleep(700);
    await click('#tpl-grid .tpl-card:nth-child(3)'); await sleep(500);
    const lines=page.locator('#tpl-fields input');
    await lines.nth(1).fill('TEAL SPLATTER');
    await lines.nth(2).fill('');
    await sleep(450);
    await click('#tpl-apply'); await sleep(1400);
    await click('#export-btn');
    await page.locator('#modal-img').waitFor({state:'visible', timeout:30000});
    await page.waitForFunction(() => document.querySelector('#modal-img')?.complete && document.querySelector('#modal-img')?.naturalWidth > 0);
    await sleep(2300);
    const videoEndedAt = Date.now();
    await page.close();
    const webm=await page.video().path();
    await context.close();
    return {webm,readyAt,videoEndedAt,startupMs:readyAt-pageCreatedAt};
  } catch (e) { await context.close(); throw new Error(`${name}: ${e.message}`) }
}

async function convert(name, webm, size, timing) {
  const page=await browser.newPage();
  await page.route('https://reel.localhost/', r=>r.fulfill({contentType:'text/html', body:'<!doctype html>'}));
  await page.goto('https://reel.localhost/');
  const data=(await readFile(webm)).toString('base64');
  const result=await page.evaluate(async ({url,data,size,timing,saveFrames}) => {
    const mb=await import(url);
    const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0)).buffer;
    const b64=buf=>{let s='';for(let i=0;i<buf.length;i+=0x8000)s+=String.fromCharCode(...buf.subarray(i,i+0x8000));return btoa(s)};
    const input=new mb.Input({source:new mb.BufferSource(bytes),formats:mb.ALL_FORMATS});
    const track=await input.getPrimaryVideoTrack();
    const rawDuration=await track.computeDuration();
    const trim=Math.max(0,rawDuration-(timing.videoEndedAt-timing.readyAt)/1000+.2);
    const duration=rawDuration-trim, fps=(await track.computePacketStats()).averagePacketRate;
    if (duration <= 0) throw new Error(`Trim ${trim}s exceeds WebM duration`);
    const w=size.width,h=size.height;
    const output=new mb.Output({format:new mb.Mp4OutputFormat({fastStart:'in-memory'}),target:new mb.BufferTarget()});
    const src=new mb.VideoSampleSource({codec:'avc',quality:mb.QUALITY_MEDIUM,keyFrameInterval:2});
    output.addVideoTrack(src,{frameRate:Math.round(fps)}); await output.start();
    const sinks=new mb.VideoSampleSink(track), frames=saveFrames?Array(6).fill(''):[], targets=frames.map((_,i)=>.2+(duration-.4)*i/5);
    let poster='', count=0;
    for await (const sample of sinks.samples(trim)) {
      if(sample.timestamp<trim){sample.close();continue}
      const t=sample.timestamp-trim;
      const scaled=new OffscreenCanvas(w,h),sc=scaled.getContext('2d');
      sample.draw(sc,0,0,w,h);
      const capture=targets.some((v,i)=>!frames[i] && t>=v) || (!poster && t>=.2);
      if(capture){const jpg=b64(new Uint8Array(await (await scaled.convertToBlob({type:'image/jpeg',quality:.84})).arrayBuffer()));
        if(!poster && t>=.2)poster=jpg;
        targets.forEach((v,i)=>{if(!frames[i]&&t>=v)frames[i]=jpg});}
      const frame=new mb.VideoSample(scaled,{timestamp:t,duration:sample.duration});
      await src.add(frame); frame.close(); sample.close(); count++;
    }
    await output.finalize();
    return {mp4:b64(new Uint8Array(output.target.buffer)),poster,frames,duration,fps,count,w,h,trim};
  }, {url:MEDIABUNNY_URL,data,size,timing,saveFrames:!!framesDir});
  await page.close();
  if(result.w!==size.width || result.h!==size.height) throw new Error(`${name}: video is ${result.w}x${result.h}`);
  const mp4=Buffer.from(result.mp4,'base64');
  if(mp4.length>=8*1024*1024) throw new Error(`${name}: MP4 is ${(mp4.length/1048576).toFixed(1)} MB`);
  await writeFile(join(OUT,`screencast-${name}.mp4`),mp4);
  await writeFile(join(OUT,`screencast-${name}.jpg`),Buffer.from(result.poster,'base64'));
  if(framesDir) for(let i=0;i<6;i++)await writeFile(join(framesDir,`${name}-${i}.jpg`),Buffer.from(result.frames[i],'base64'));
  console.log(JSON.stringify({name,duration:result.duration,resolution:[result.w,result.h],bytes:mp4.length,encodedFrames:result.count,trim:result.trim,startupMs:timing.startupMs}));
}

try {
  for(const [name,viewport,size] of [
    ['9x16',{width:810,height:1440},{width:1080,height:1920}],
    ['1x1',{width:810,height:810},{width:1080,height:1080}],
  ]) { const {webm,...timing}=await record(name,viewport,size); await convert(name,webm,size,timing) }
} finally { await browser.close(); await new Promise(r=>server.close(r)); await rm(temp,{recursive:true,force:true}) }
