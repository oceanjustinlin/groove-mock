// Error and timing reports for the deployed site, sent to /api/log (functions/api/log.js).
// site/build.mjs loads this before the page's own scripts, so it sees their errors too. index.html reports its
// own events (first frame, exports) through window.rmTrack when it exists; the CLI and local previews load
// index.html without this file, so nothing is reported from them.
(() => {
  const ENDPOINT = '/api/log', MAX = 30, seen = new Set();
  const session = Math.random().toString(36).slice(2, 10);
  const release = document.querySelector('meta[name="rm-release"]')?.content || '';
  let sent = 0;

  function send(type, data = {}) {
    // One report per distinct error per page view, and a cap so a render loop that throws cannot flood the endpoint.
    const key = type + '|' + (data.msg || '') + '|' + (data.src || '');
    if (type !== 'export' && seen.has(key)) return;
    seen.add(key);
    if (sent++ >= MAX) return;
    const body = JSON.stringify({
      type, session, release, path: location.pathname, lang: navigator.language,
      dpr: devicePixelRatio, mem: navigator.deviceMemory || 0, cores: navigator.hardwareConcurrency || 0,
      vw: innerWidth, vh: innerHeight, ...data,
    });
    try {
      if (navigator.sendBeacon?.(ENDPOINT, new Blob([body], {type: 'application/json'}))) return;
    } catch (e) {}
    fetch(ENDPOINT, {method: 'POST', body, keepalive: true, headers: {'content-type': 'application/json'}}).catch(() => {});
  }
  window.rmTrack = send;

  // Capture phase also sees failed <script>/<link>/<img> loads (a CDN that is down or blocked), which do not bubble.
  addEventListener('error', e => {
    const t = e.target;
    if (t && t !== window && (t.src || t.href)) { send('resource', {src: t.src || t.href, msg: t.tagName}); return }
    send('error', {msg: e.message, src: e.filename, line: e.lineno, col: e.colno, stack: e.error?.stack});
  }, true);
  addEventListener('unhandledrejection', e => {
    const r = e.reason;
    send('rejection', {msg: r?.message || String(r), stack: r?.stack});
  });
  // webglcontextlost does not bubble either; the GPU dropped the canvas (driver reset, memory pressure on phones).
  addEventListener('webglcontextlost', () => send('context-lost', {ms: Math.round(performance.now())}), true);
})();
