#!/usr/bin/env node
// record-mockup: render vinyl mockups from a JSON scene spec.
// It serves ../index.html locally, opens it in headless Chrome and drives window.recordMockup,
// so the CLI and the web page share one renderer.
import {chromium} from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import * as library from './library.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PAGE = path.resolve(HERE, '..', 'index.html');
// CDN packages the page imports, served from node_modules when installed so renders do not depend on the network.
const CDN_PACKAGES = {three: '0.169.0', mediabunny: '1.61.3', gifenc: '1.0.3'};
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.avif': 'image/avif', '.bmp': 'image/bmp', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css',
};

const HELP = `record-mockup — 用 JSON 场景描述渲染黑胶 3D 模型图

用法
  record-mockup schema [-o schema.json]           输出 spec 的 JSON Schema（字段、单位、范围、默认值）
  record-mockup init   [-o spec.json]             写一份带默认值的 spec 模板
  record-mockup slots  [spec.json]                各贴图位的尺寸、可见区域、遮挡和制作建议（按 spec 的场景计算）
  record-mockup render <spec.json> [-o out.png]   按 spec 渲染一张 PNG
  record-mockup numbers <spec.json> --from 1 --to 50 [--dir out/]
                                                按号段批量渲染限量编号图
  record-mockup video  <spec.json> [-o out.mp4]   按 spec.animation 渲染旋转视频（.mp4）或动图（.gif）

曲库（MusicBrainz + Cover Art Archive，需联网）
  record-mockup library search --artist <名字> [--album <专辑>] [--artist-id <id>]
                                                搜专辑，列出 release group id
  record-mockup library releases <group-id>       列出这张专辑的各个版本（黑胶在前），列出 release id
  record-mockup library pick <release-id> [spec.json] [--dry-run]
                                                下载这一版的图，填进 spec 的 images（标签按中孔自动裁切），
                                                并写入唱片张数、单开/双开、每面音轨数和 meta.assets 来源

选项
  -o, --out <path>       输出文件（render 默认写到 spec 同目录、同名 .png；video 默认同名 .mp4，扩展名决定格式；
                         library pick 为要写入的 spec，默认 ./spec.json，不存在就新建）
  --width, --height <px> 覆盖 spec 里的 output.width / output.height（video 不用，改 animation.aspect / size）
  --set <path=value>     临时覆盖 spec 字段，可重复，如 --set number.current=88 --set jacket.type=gatefold
  --dir <dir>            numbers 的输出目录（默认 spec 同目录下的 <spec 名>-numbers/）；
                         library pick 的图片目录（默认 spec 同目录下的 <spec 名>-library/）
  --use <slot=n>         pick 时指定贴图位用第 n 张图（图号见 --dry-run），slot=none 不填这个贴图位，可重复
  --crop <slot=k:v,…>    pick 时微调标签裁切，如 --crop labelA=zoom:1.1,rot:15,dx:0,dy:-8（dx/dy 为原图像素）
  --images-only          pick 时只填图片，不改唱片张数、封套类型和音轨数
  --dry-run              pick 时只列出图片和分配方案，不下载、不写文件
  --encoder <name>       video 的 MP4 编码器：software（默认，立即开始）| hardware（每帧更快，但首次启动可能卡十几秒）| auto
  --json                 以一行 JSON 输出结果，便于程序读取
  --strict               spec 有任何警告（未知字段、越界值）就不渲染，退出码 2
  --browser <name>       chrome（默认，使用本机 Google Chrome）| msedge | chromium
  --page <path>          要驱动的页面（默认 ../index.html）
  --software             强制软件渲染（无 GPU 的机器会自动切换，约慢 4 倍）
  --verbose              打印页面里的控制台错误
  -h, --help

spec 里的图片和字体路径相对 spec 文件解析，也可以写 http(s) 地址。
退出码：0 成功，1 出错，2 --strict 下有警告。`;

class CliError extends Error {}

function parse() {
  const {values, positionals} = parseArgs({
    allowPositionals: true,
    options: {
      out: {type: 'string', short: 'o'}, width: {type: 'string'}, height: {type: 'string'},
      set: {type: 'string', multiple: true}, dir: {type: 'string'}, from: {type: 'string'}, to: {type: 'string'},
      encoder: {type: 'string', default: 'software'}, json: {type: 'boolean'}, strict: {type: 'boolean'}, browser: {type: 'string', default: 'chrome'},
      artist: {type: 'string'}, album: {type: 'string'}, 'artist-id': {type: 'string'}, use: {type: 'string', multiple: true},
      crop: {type: 'string', multiple: true}, 'images-only': {type: 'boolean'}, 'dry-run': {type: 'boolean'},
      page: {type: 'string'}, verbose: {type: 'boolean'}, software: {type: 'boolean'}, help: {type: 'boolean', short: 'h'},
    },
  });
  return {cmd: positionals[0], args: positionals.slice(1), opts: values};
}

// ---------- spec loading ----------
const isRemote = s => /^https?:\/\//i.test(s);
async function toDataUrl(ref, baseDir, label) {
  if (ref.startsWith('data:')) return ref;
  if (isRemote(ref)) {
    const res = await fetch(ref);
    if (!res.ok) throw new CliError(`${label}：下载失败（HTTP ${res.status}）${ref}`);
    const type = res.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
  }
  const file = path.resolve(baseDir, ref);
  if (!existsSync(file)) throw new CliError(`${label}：找不到文件 ${file}`);
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  return `data:${type};base64,${(await fs.readFile(file)).toString('base64')}`;
}

function coerce(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}
function setPath(obj, dotted, value) {
  const keys = dotted.split('.');
  let node = obj;
  for (const k of keys.slice(0, -1)) node = node[k] = (node[k] && typeof node[k] === 'object') ? node[k] : {};
  node[keys.at(-1)] = value;
}

async function loadSpec(specPath, opts) {
  const file = path.resolve(specPath);
  if (!existsSync(file)) throw new CliError(`找不到 spec 文件：${file}`);
  let spec;
  try { spec = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { throw new CliError(`spec 不是合法 JSON：${e.message}`); }
  for (const pair of opts.set || []) {
    const i = pair.indexOf('=');
    if (i < 1) throw new CliError(`--set 需要 path=value 形式：${pair}`);
    setPath(spec, pair.slice(0, i), coerce(pair.slice(i + 1)));
  }
  if (opts.width) setPath(spec, 'output.width', Number(opts.width));
  if (opts.height) setPath(spec, 'output.height', Number(opts.height));
  // Images and fonts travel to the page as data URLs, so the page never needs file access.
  const baseDir = path.dirname(file);
  for (const [slot, ref] of Object.entries(spec.images || {})) {
    if (typeof ref === 'string') spec.images[slot] = await toDataUrl(ref, baseDir, `images.${slot}`);
  }
  if (typeof spec.number?.fontFile === 'string') spec.number.fontFile = await toDataUrl(spec.number.fontFile, baseDir, 'number.fontFile');
  return {spec, file};
}

// ---------- page session ----------
function serve(root) {
  const server = http.createServer(async (req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(root, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
      const body = await fs.readFile(file);
      res.writeHead(200, {'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'}).end(body);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// GPU WebGL is about 4x faster; Chrome's software WebGL (SwiftShader) is the fallback for machines
// without a usable GPU, such as CI runners.
const GPU_ARGS = ['--ignore-gpu-blocklist'];
const SOFTWARE_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

async function openPage(opts) {
  if (opts.software) return openPageWith(opts, SOFTWARE_ARGS);
  try { return await openPageWith(opts, GPU_ARGS); }
  catch (e) {
    if (!(e instanceof CliError) || !e.webgl) throw e;
    if (opts.verbose) process.stderr.write('GPU 渲染不可用，改用软件渲染\n');
    return openPageWith(opts, SOFTWARE_ARGS);
  }
}

async function openPageWith(opts, args) {
  const pageFile = path.resolve(opts.page || DEFAULT_PAGE);
  if (!existsSync(pageFile)) throw new CliError(`找不到页面：${pageFile}`);
  const server = await serve(path.dirname(pageFile));
  let browser;
  try {
    browser = await chromium.launch({channel: opts.browser === 'chromium' ? undefined : opts.browser, headless: true, args});
  } catch (e) {
    server.close();
    throw new CliError(`无法启动浏览器（${opts.browser}）：${e.message.split('\n')[0]}\n` +
      `本机没有 Google Chrome 时，可先运行 npx playwright-core install chromium，再加 --browser chromium。`);
  }
  const page = await browser.newPage({viewport: {width: 1280, height: 900}});
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()); });
  const require = createRequire(import.meta.url);
  for (const [name, version] of Object.entries(CDN_PACKAGES)) {
    let root;
    try { root = path.dirname(require.resolve(`${name}/package.json`)); }
    catch { continue; } // not installed locally: fall back to the CDN
    const prefix = `https://cdn.jsdelivr.net/npm/${name}@${version}/`;
    await page.route(prefix + '**', async route => {
      const local = path.join(root, route.request().url().slice(prefix.length));
      if (existsSync(local)) await route.fulfill({path: local, contentType: 'text/javascript'});
      else await route.continue();
    });
  }
  const {port} = server.address();
  await page.goto(`http://127.0.0.1:${port}/${path.basename(pageFile)}`, {waitUntil: 'load'});
  try {
    await page.waitForFunction(() => window.recordMockup, null, {timeout: 30000});
    await page.evaluate(() => window.recordMockup.ready);
  } catch {
    const webgl = await page.evaluate(() => !document.getElementById('gl-error')?.hidden).catch(() => false);
    const detail = pageErrors.length ? `\n页面错误：${pageErrors.join(' | ')}` : '';
    await browser.close(); server.close();
    const err = new CliError(webgl ? `WebGL 不可用。${detail}` : `页面没有在 30 秒内就绪（需要联网加载字体，或页面脚本出错）。${detail}`);
    err.webgl = webgl;
    throw err;
  }
  return {
    page, pageErrors,
    async close() { await browser.close(); server.close(); },
  };
}

const applySpec = (session, spec) => session.page.evaluate(s => window.recordMockup.apply(s), spec);
async function renderTo(session, outFile) {
  const result = await session.page.evaluate(() => window.recordMockup.render());
  await fs.mkdir(path.dirname(outFile), {recursive: true});
  await fs.writeFile(outFile, Buffer.from(result.dataUrl.split(',')[1], 'base64'));
  return {out: outFile, width: result.width, height: result.height, bytes: result.bytes};
}

// ---------- commands ----------
async function cmdSchema(opts) {
  const s = await openPage(opts);
  try {
    const schema = await s.page.evaluate(() => window.recordMockup.schema());
    const text = JSON.stringify(schema, null, 2) + '\n';
    if (opts.out) { await fs.writeFile(path.resolve(opts.out), text); log(opts, {ok: true, out: path.resolve(opts.out)}, `已写入 ${opts.out}`); }
    else process.stdout.write(text);
  } finally { await s.close(); }
}

const RECOMMEND = {user: '用户提供', generated: '生图', typeset: '排版', composite: '生图底 + 排版'};
async function cmdSlots(args, opts) {
  const spec = args[0] ? (await loadSpec(args[0], opts)).spec : null;
  const s = await openPage(opts);
  try {
    if (spec) await applySpec(s, spec);
    const slots = await s.page.evaluate(() => window.recordMockup.slots());
    if (opts.json) { process.stdout.write(JSON.stringify({ok: true, slots}) + '\n'); return; }
    const lines = [];
    for (const x of slots) {
      lines.push(`${x.used ? '●' : '○'} ${x.slot.padEnd(12)}${x.label}  ${x.px.join('×')} px  ${x.mm.join('×')} mm  建议：${RECOMMEND[x.recommend]}`);
      lines.push(`    可见：${x.visible}`);
      if (x.covered.length) lines.push(`    遮挡：${x.covered.join('；')}`);
      if (x.notes) lines.push(`    提示：${x.notes}`);
    }
    lines.push('', '● 当前场景会用到　○ 当前场景用不到（如单开时的双开内页）');
    process.stdout.write(lines.join('\n') + '\n');
  } finally { await s.close(); }
}

// Where each supplied image came from, as registered in meta.assets.
function provenance(spec) {
  const assets = spec.meta?.assets || {};
  const sources = Object.fromEntries(Object.keys(spec.images || {}).map(k => [k, assets[k]?.source || 'unregistered']));
  const unregistered = Object.keys(sources).filter(k => sources[k] === 'unregistered');
  return {
    assets: sources,
    warnings: unregistered.length ? [`meta.assets 没有登记这些贴图的来源：${unregistered.join(', ')}`] : [],
  };
}

async function cmdInit(opts) {
  const out = path.resolve(opts.out || 'spec.json');
  if (existsSync(out)) throw new CliError(`${out} 已存在，换一个 -o 路径或先删除它`);
  const s = await openPage(opts);
  try {
    const spec = await s.page.evaluate(() => window.recordMockup.getSpec());
    spec.images = {};
    await fs.writeFile(out, JSON.stringify(spec, null, 2) + '\n');
    log(opts, {ok: true, out}, `已写入 ${out}\n在 images 里填图片路径（如 "front": "cover.png"），可用字段见 record-mockup schema。`);
  } finally { await s.close(); }
}

async function cmdRender(args, opts) {
  if (!args[0]) throw new CliError('render 需要一个 spec 文件：record-mockup render spec.json');
  const t0 = Date.now();
  const {spec, file} = await loadSpec(args[0], opts);
  const out = path.resolve(opts.out || file.replace(/\.json$/i, '') + '.png');
  const s = await openPage(opts);
  try {
    const {warnings} = await applySpec(s, spec);
    const {assets, warnings: sourceWarnings} = provenance(spec);
    warnings.push(...sourceWarnings);
    if (opts.strict && warnings.length) return strictFail(opts, warnings);
    const r = await renderTo(s, out);
    finish(opts, s, {...r, assets, warnings, ms: Date.now() - t0},
      `已渲染 ${r.out}（${r.width} × ${r.height} px，${(r.bytes / 1048576).toFixed(1)} MB，${((Date.now() - t0) / 1000).toFixed(1)} s）`);
  } finally { await s.close(); }
}

async function cmdNumbers(args, opts) {
  if (!args[0]) throw new CliError('numbers 需要一个 spec 文件：record-mockup numbers spec.json --from 1 --to 50');
  const from = Number(opts.from), to = Number(opts.to);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) throw new CliError('--from 和 --to 需要正整数，且 from ≤ to');
  if (to - from >= 1000) throw new CliError('一次最多渲染 1000 张，请分段运行');
  const t0 = Date.now();
  const {spec, file} = await loadSpec(args[0], opts);
  const dir = path.resolve(opts.dir || file.replace(/\.json$/i, '') + '-numbers');
  const s = await openPage(opts);
  try {
    const {warnings} = await applySpec(s, spec);
    const {assets, warnings: sourceWarnings} = provenance(spec);
    warnings.push(...sourceWarnings);
    if (opts.strict && warnings.length) return strictFail(opts, warnings);
    const total = await s.page.evaluate(() => window.recordMockup.getSpec().number.total);
    if (to > total) throw new CliError(`--to ${to} 超过了 number.total（${total}）`);
    const width = String(total).length, files = [];
    for (let n = from; n <= to; n++) {
      const out = path.join(dir, `${path.basename(file, '.json')}-${String(n).padStart(width, '0')}.png`);
      await applySpec(s, {number: {current: n, on: true}});
      files.push((await renderTo(s, out)).out);
      if (!opts.json) process.stderr.write(`\r${n - from + 1}/${to - from + 1}`);
    }
    if (!opts.json) process.stderr.write('\n');
    finish(opts, s, {out: dir, files, assets, warnings, ms: Date.now() - t0},
      `已渲染 ${files.length} 张到 ${dir}（${((Date.now() - t0) / 1000).toFixed(1)} s）`);
  } finally { await s.close(); }
}

async function cmdVideo(args, opts) {
  if (!args[0]) throw new CliError('video 需要一个 spec 文件：record-mockup video spec.json -o out.mp4');
  if (opts.width || opts.height) throw new CliError('video 不用 --width / --height，请用 --set animation.aspect=1:1 和 --set animation.size=1080');
  const t0 = Date.now();
  const {spec, file} = await loadSpec(args[0], opts);
  const out = path.resolve(opts.out || file.replace(/\.json$/i, '') + '.mp4');
  const format = path.extname(out).slice(1).toLowerCase();
  if (!['mp4', 'gif'].includes(format)) throw new CliError(`输出文件需要 .mp4 或 .gif 扩展名：${out}`);
  const s = await openPage(opts);
  try {
    const {warnings} = await applySpec(s, spec);
    const {assets, warnings: sourceWarnings} = provenance(spec);
    warnings.push(...sourceWarnings);
    if (opts.strict && warnings.length) return strictFail(opts, warnings);
    if (!opts.json) await s.page.exposeFunction('__videoProgress', (done, total) => process.stderr.write(`\r${done}/${total} 帧`));
    let r;
    try { r = await s.page.evaluate(([format, encoder]) => window.recordMockup.renderVideo({format, encoder, onProgress: window.__videoProgress}), [format, opts.encoder]); }
    catch (e) { throw new CliError(e.message.replace(/^page\.evaluate: (Error: )?/, '').split('\n')[0]); }
    if (!opts.json) process.stderr.write('\n');
    await fs.mkdir(path.dirname(out), {recursive: true});
    await fs.writeFile(out, Buffer.from(r.dataUrl.split(',')[1], 'base64'));
    warnings.push(...r.warnings);
    const {dataUrl, warnings: _, ...meta} = r;
    finish(opts, s, {out, ...meta, assets, warnings, ms: Date.now() - t0},
      `已渲染 ${out}（${r.width} × ${r.height} px，${r.frames} 帧 / ${r.duration} s，${(r.bytes / 1048576).toFixed(1)} MB，用时 ${((Date.now() - t0) / 1000).toFixed(1)} s）`);
  } finally { await s.close(); }
}

// ---------- record library ----------
const IMAGE_SLOT_NAMES = ['front', 'back', 'spine', 'innerLeft', 'innerRight', 'obi', 'sleeve', 'labelA', 'labelB', 'labelC', 'labelD', 'insertFront', 'insertBack', 'sticker'];
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXT = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif'};

async function cmdLibrary(args, opts) {
  const [sub, ...rest] = args;
  if (sub === 'search') return librarySearch(opts);
  if (sub === 'releases') return libraryReleases(rest, opts);
  if (sub === 'pick') return libraryPick(rest, opts);
  throw new CliError('library 的子命令：search | releases | pick，见 record-mockup --help');
}

async function librarySearch(opts) {
  const r = await library.search({artist: opts.artist, album: opts.album, artistId: opts['artist-id']});
  const lines = [];
  if (r.artist) lines.push(`艺人：${r.artist.name}（${r.artist.id}）`);
  if (r.note) lines.push(r.note);
  for (const a of r.artists || []) lines.push(`${a.id}  ${a.name}${[a.disambiguation, a.type, a.country, a.begin].filter(Boolean).map(x => ' · ' + x).join('')}`);
  for (const g of r.groups) lines.push(`${g.id}  ${g.title} — ${g.artist}${g.year ? ' · ' + g.year : ''}${g.type ? ' · ' + g.type : ''}`);
  if (!r.groups.length && !r.artists?.length) lines.push('没有找到。换个写法，或用 --artist 单独搜艺人。');
  else if (r.groups.length) lines.push('', `下一步：record-mockup library releases <group-id>`);
  else lines.push('', `下一步：record-mockup library search --artist-id <id>${opts.album ? ` --album "${opts.album}"` : ''}`);
  log(opts, {ok: true, ...r}, lines.join('\n'));
}

async function libraryReleases(args, opts) {
  if (!MBID.test(args[0] || '')) throw new CliError('library releases 需要 release group id（来自 library search 的 UUID）');
  const r = await library.releases(args[0]);
  const row = x => `${x.id}  ${[x.title !== r.group.title && x.title, x.date?.slice(0, 4), x.country, x.catalog, x.format, x.packaging].filter(Boolean).join(' · ')}` +
    `  [图 ${x.art.count}${x.art.front ? ' · 正面' : ''}${x.art.back ? ' · 背面' : ''}]`;
  const lines = [`${r.group.title} — ${r.group.artist}`];
  if (r.vinylCount) lines.push('', `黑胶版本 · ${r.vinylCount}`, ...r.releases.slice(0, r.vinylCount).map(row));
  else lines.push('', '曲库里还没有 12″ 黑胶版本，可以先用其他版本的图。');
  if (r.releases.length > r.vinylCount) lines.push('', `其他版本 · ${r.releases.length - r.vinylCount} · 只用图片，不改唱片参数`, ...r.releases.slice(r.vinylCount).map(row));
  if (r.total > r.read) lines.push('', `共 ${r.total} 个版本，只读了前 ${r.read} 个`);
  if (r.releases.length) lines.push('', '下一步：record-mockup library pick <release-id> spec.json --dry-run');
  log(opts, {ok: true, ...r}, lines.join('\n'));
}

function parseUse(list, images) {
  const use = {};
  for (const pair of list || []) {
    const [slot, v] = pair.split('=');
    if (!IMAGE_SLOT_NAMES.includes(slot)) throw new CliError(`--use 的贴图位不对：${slot}（可选 ${IMAGE_SLOT_NAMES.join(', ')}）`);
    if (v === 'none') { use[slot] = null; continue; }
    const n = Number(v);
    if (!Number.isInteger(n) || !images[n]) throw new CliError(`--use ${pair}：没有第 ${v} 张图（这一版共 ${images.length} 张，从 0 开始）`);
    use[slot] = n;
  }
  return use;
}
function parseCrop(list) {
  const crop = {};
  for (const pair of list || []) {
    const i = pair.indexOf('='), slot = pair.slice(0, i);
    if (!library.isLabelSlot(slot)) throw new CliError(`--crop 只用于标签贴图位（${library.LABEL_SLOTS.join(', ')}）：${pair}`);
    crop[slot] = {};
    for (const kv of pair.slice(i + 1).split(',')) {
      const [k, v] = kv.split(':');
      if (!['zoom', 'rot', 'dx', 'dy'].includes(k) || !Number.isFinite(Number(v))) throw new CliError(`--crop 的写法是 slot=zoom:1.1,rot:15,dx:0,dy:0：${pair}`);
      crop[slot][k] = Number(v);
    }
    const z = crop[slot].zoom;
    if (z != null && (z < .6 || z > 1.4)) throw new CliError(`--crop zoom 范围 0.6–1.4：${pair}`);
  }
  return crop;
}
// Slots the scene won't show, so the art lands but isn't seen until the scene changes.
function hiddenSlots(spec, slots) {
  const why = {
    labelC: spec.records?.count !== 2 && '只在 records.count=2 时可见', labelD: spec.records?.count !== 2 && '只在 records.count=2 时可见',
    innerLeft: spec.jacket?.type !== 'gatefold' && '只在 jacket.type=gatefold 时可见', innerRight: spec.jacket?.type !== 'gatefold' && '只在 jacket.type=gatefold 时可见',
    sleeve: spec.records?.sleeve?.on !== true && '需要 records.sleeve.on=true',
    insertFront: spec.insert?.on !== true && '需要 insert.on=true', insertBack: spec.insert?.on !== true && '需要 insert.on=true',
  };
  return slots.filter(s => why[s]).map(s => `${s}：${why[s]}`);
}

async function libraryPick(args, opts) {
  const id = args[0];
  if (!MBID.test(id || '')) throw new CliError('library pick 需要 release id（来自 library releases 的 UUID）');
  // Check the flags before going to the network.
  parseUse((opts.use || []).map(u => u.replace(/=.*/, '=none')), []);
  const crop = parseCrop(opts.crop);
  if (args[1] && opts.out && path.resolve(args[1]) !== path.resolve(opts.out)) throw new CliError('library pick 直接改写 spec，spec 路径和 -o 只写一个');
  const t0 = Date.now();
  const specFile = path.resolve(args[1] || opts.out || 'spec.json');
  let spec = {version: 1};
  if (existsSync(specFile)) {
    try { spec = JSON.parse(await fs.readFile(specFile, 'utf8')); }
    catch (e) { throw new CliError(`spec 不是合法 JSON：${e.message}`); }
  }
  // Art the spec already has from elsewhere (the viewer's own, generated, typeset) stays unless --use names it.
  const keep = Object.keys(spec.images || {}).filter(s => spec.meta?.assets?.[s]?.source !== 'fetched');
  const p = await library.plan(id, {keep, sleeveOn: spec.records?.sleeve?.on === true});
  const use = parseUse(opts.use, p.images);
  for (const [slot, n] of Object.entries(use)) {
    if (n === null) delete p.assign[slot]; else p.assign[slot] = n;
    p.kept = p.kept.filter(s => s !== slot);
  }
  const slots = IMAGE_SLOT_NAMES.filter(s => s in p.assign);

  if (opts['dry-run']) {
    const by = n => slots.filter(s => p.assign[s] === n);
    const lines = [`${p.group?.title || p.release.title} — ${p.group?.artist || ''}`, `${p.release.id} · ${[p.release.date, p.release.country, p.release.catalog, p.release.format, p.release.packaging].filter(Boolean).join(' · ')}`, p.release.url, ''];
    for (const im of p.images) lines.push(`[${im.n}] ${[im.from, im.types.join('/') || '未分类', im.note].filter(Boolean).join(' · ')}${by(im.n).length ? '  → ' + by(im.n).join(', ') : ''}`);
    if (!p.images.length) lines.push('（没有图）');
    if (p.records && !opts['images-only']) lines.push('', `唱片参数：records.count=${p.records.count}${p.records.jacket ? `，jacket.type=${p.records.jacket}` : ''}` +
      p.records.tracks.map((t, i) => t ? `，disc${i + 1}.tracks=${t}（各面 ${p.records.sides[i].join(' / ')}）` : '').join(''));
    lines.push(...p.notes.map(n => '注意：' + n));
    lines.push('', '改分配用 --use <贴图位>=<图号> 或 --use <贴图位>=none，确认后去掉 --dry-run。');
    log(opts, {ok: true, dryRun: true, ...p}, lines.join('\n'));
    return;
  }

  const dir = path.resolve(opts.dir || specFile.replace(/\.json$/i, '') + '-library');
  await fs.mkdir(dir, {recursive: true});
  const rel = f => path.relative(path.dirname(specFile), f).split(path.sep).join('/');
  const fetched = new Map(), done = {}, failed = [], warnings = [];
  const get = n => { if (!fetched.has(n)) fetched.set(n, library.download(p.images[n].full)); return fetched.get(n); };
  let session = null;
  try {
    for (const slot of slots) {
      const im = p.images[p.assign[slot]];
      let img;
      try { img = await get(im.n); } catch { failed.push(slot); continue; }
      const note = `CAA ${im.ref} · ${im.types.join('/') || 'image'} · ${img.url}`;
      if (library.isLabelSlot(slot)) {
        // Disc photos become labels with the page's own crop, so the hole lands where the GUI would put it.
        session ??= await openPage(opts);
        const c = await session.page.evaluate(([src, adj]) => window.recordMockup.labelCrop(src, adj),
          [`data:${img.type};base64,${img.buffer.toString('base64')}`, crop[slot] || {}]);
        const file = path.join(dir, `${slot}.png`);
        await fs.writeFile(file, Buffer.from(c.dataUrl.split(',')[1], 'base64'));
        if (!c.auto) warnings.push(`${slot}：没找到中孔，按图片中心裁切，用 --crop ${slot}=dx:…,dy:… 微调`);
        done[slot] = {file: rel(file), image: im.n, crop: {auto: c.auto, cx: c.cx, cy: c.cy, radius: c.radius, rot: c.rot}};
        setPath(spec, `meta.assets.${slot}`, {source: 'fetched', tool: 'MusicBrainz + Cover Art Archive',
          note: `${note} · label crop centre ${c.cx},${c.cy} radius ${c.radius} px, rotated ${Math.round(c.rot)}°`});
      } else {
        const file = path.join(dir, slot + (EXT[img.type] || '.jpg'));
        await fs.writeFile(file, img.buffer);
        done[slot] = {file: rel(file), image: im.n};
        setPath(spec, `meta.assets.${slot}`, {source: 'fetched', tool: 'MusicBrainz + Cover Art Archive', note});
      }
      setPath(spec, `images.${slot}`, done[slot].file);
    }
  } finally { if (session) await session.close(); }

  const records = {};
  if (p.records && !opts['images-only']) {
    setPath(spec, 'records.count', records.count = p.records.count);
    if (p.records.jacket) setPath(spec, 'jacket.type', records.jacket = p.records.jacket);
    p.records.tracks.forEach((t, i) => { if (t) setPath(spec, `records.disc${i + 1}.tracks`, records[`disc${i + 1}.tracks`] = t); });
  }
  // A part given new art is switched on, so the image is actually seen.
  for (const s of ['obi', 'sticker']) if (done[s]) setPath(spec, `${s}.on`, true);
  if (p.group) { setPath(spec, 'meta.artist', p.group.artist); setPath(spec, 'meta.album', p.group.title); }
  await fs.mkdir(path.dirname(specFile), {recursive: true});
  await fs.writeFile(specFile, JSON.stringify(spec, null, 2) + '\n');

  if (failed.length) warnings.push(`下载失败，保留 spec 里原来的图：${failed.join(', ')}`);
  warnings.push(...hiddenSlots(spec, Object.keys(done)).map(w => '当前场景看不到 ' + w));
  const result = {spec: specFile, dir, release: p.release, group: p.group, slots: done, kept: p.kept, records, failed, notes: p.notes, warnings, ms: Date.now() - t0};
  for (const w of warnings) if (!opts.json) process.stderr.write(`警告：${w}\n`);
  const text = [`已写入 ${specFile}：${Object.keys(done).join(', ') || '没有图片'}${Object.keys(records).length ? `；${Object.entries(records).map(([k, v]) => `${k}=${v}`).join('，')}` : ''}`,
    ...p.notes.map(n => '注意：' + n), '这些是曲库里的真实发行素材，登记为 fetched。下一步：record-mockup render ' + (path.relative(process.cwd(), specFile).startsWith('..') ? specFile : path.relative(process.cwd(), specFile))].join('\n');
  log(opts, {ok: true, ...result}, text);
}

// ---------- output ----------
function log(opts, obj, text) { process.stdout.write(opts.json ? JSON.stringify(obj) + '\n' : text + '\n'); }
function finish(opts, session, result, text) {
  for (const w of result.warnings || []) if (!opts.json) process.stderr.write(`警告：${w}\n`);
  if (opts.verbose) for (const e of session.pageErrors) process.stderr.write(`页面错误：${e}\n`);
  log(opts, {ok: true, ...result}, text);
}
function strictFail(opts, warnings) {
  if (opts.json) process.stdout.write(JSON.stringify({ok: false, warnings}) + '\n');
  else for (const w of warnings) process.stderr.write(`警告：${w}\n`);
  process.exitCode = 2;
}

async function main() {
  let parsed;
  try { parsed = parse(); }
  catch (e) { process.stderr.write(`${e.message}\n\n${HELP}\n`); process.exitCode = 1; return; }
  const {cmd, args, opts} = parsed;
  if (opts.help || !cmd) { process.stdout.write(HELP + '\n'); return; }
  try {
    if (cmd === 'schema') await cmdSchema(opts);
    else if (cmd === 'init') await cmdInit(opts);
    else if (cmd === 'slots') await cmdSlots(args, opts);
    else if (cmd === 'render') await cmdRender(args, opts);
    else if (cmd === 'numbers') await cmdNumbers(args, opts);
    else if (cmd === 'video') await cmdVideo(args, opts);
    else if (cmd === 'library') await cmdLibrary(args, opts);
    else throw new CliError(`未知命令：${cmd}\n\n${HELP}`);
  } catch (e) {
    const msg = e instanceof CliError || e instanceof library.LibraryError ? e.message : (e.stack || String(e));
    if (opts.json) process.stdout.write(JSON.stringify({ok: false, error: msg}) + '\n');
    else process.stderr.write(`错误：${msg}\n`);
    process.exitCode = 1;
  }
}
main();
