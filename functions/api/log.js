// POST /api/log: error and timing reports from site/rum.js, written to Workers Analytics Engine.
// The binding LOGS is declared in wrangler.toml. Without it (local dev, a deploy that lost the binding) reports
// are accepted and dropped, so the page never sees an error from here.
//
// Column layout, for SQL against the dataset (keep in sync with docs/observability.md):
//   index1  type
//   blob1 type     blob2 message   blob3 source     blob4 stack     blob5 path      blob6 host
//   blob7 country  blob8 colo      blob9 user agent blob10 gpu      blob11 lang     blob12 session
//   blob13 format  blob14 release  blob15 bot reasons (webdriver / ua-bot / ua-spoof, comma-separated; '' = none)
//   blob16 art (export only: front cover source, user / fetched / sample)
//   double1 ms     double2 line    double3 column   double4 dpr     double5 memory  double6 cores
//   double7 width  double8 height  double9 bytes    double10 ok     double11 viewport w double12 viewport h
//   double13 bot (1 when blob15 is not empty)  double14 lib (export only: slots filled from the record library)
// Rows written before the bot flag existed have no blob15/double13, and rows before the art source have no
// blob16/double14; they read as '' and 0.

const TYPES = new Set(['error', 'rejection', 'resource', 'context-lost', 'gl-unavailable', 'ready', 'export']);
const MAX_BODY = 8192;

const str = (v, n) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, n);
const num = v => (Number.isFinite(+v) ? +v : 0);

export async function onRequestPost({request, env}) {
  const text = await request.text();
  if (text.length > MAX_BODY) return new Response(null, {status: 413});
  let r;
  try { r = JSON.parse(text) } catch { return new Response(null, {status: 400}) }
  if (!r || !TYPES.has(r.type)) return new Response(null, {status: 400});

  const cf = request.cf || {};
  const bot = str(r.bot, 40);
  env.LOGS?.writeDataPoint({
    indexes: [r.type],
    blobs: [
      r.type, str(r.msg, 500), str(r.src, 300), str(r.stack, 2000), str(r.path, 200),
      new URL(request.url).hostname, str(cf.country, 8), str(cf.colo, 8), str(request.headers.get('user-agent'), 300),
      str(r.gpu, 200), str(r.lang, 20), str(r.session, 20), str(r.format, 10), str(r.release, 40), bot, str(r.art, 10),
    ],
    doubles: [
      num(r.ms), num(r.line), num(r.col), num(r.dpr), num(r.mem), num(r.cores),
      num(r.w), num(r.h), num(r.bytes), r.ok ? 1 : 0, num(r.vw), num(r.vh), bot ? 1 : 0, num(r.lib),
    ],
  });
  return new Response(null, {status: 204});
}
