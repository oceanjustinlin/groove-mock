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

选项
  -o, --out <path>       输出文件（render 默认写到 spec 同目录、同名 .png；video 默认同名 .mp4，扩展名决定格式）
  --width, --height <px> 覆盖 spec 里的 output.width / output.height（video 不用，改 animation.aspect / size）
  --set <path=value>     临时覆盖 spec 字段，可重复，如 --set number.current=88 --set jacket.type=gatefold
  --dir <dir>            numbers 的输出目录（默认 spec 同目录下的 <spec 名>-numbers/）
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
    else throw new CliError(`未知命令：${cmd}\n\n${HELP}`);
  } catch (e) {
    const msg = e instanceof CliError ? e.message : (e.stack || String(e));
    if (opts.json) process.stdout.write(JSON.stringify({ok: false, error: msg}) + '\n');
    else process.stderr.write(`错误：${msg}\n`);
    process.exitCode = 1;
  }
}
main();
