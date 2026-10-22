// Record library for the CLI: MusicBrainz and the Cover Art Archive, the same sources and the same choices
// as the web page's library panel (index.html, "Record library"), so a pick here fills the same slots.
// Network only; downloading into files, label crops and spec writing live in record-mockup.mjs.
export class LibraryError extends Error {}

const MB = 'https://musicbrainz.org/ws/2/', CAA = 'https://coverartarchive.org/';
// MusicBrainz asks API clients to name themselves and to send at most one request a second.
const UA = 'record-mockup-cli/0.1.0 ( https://recordmockup.com )';
let mbLast = 0, mbChain = Promise.resolve();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Calls queue, so requests made together still go out a second apart.
function mbGet(p) {
  const run = () => mbFetch(p);
  const r = mbChain.then(run, run);
  mbChain = r.catch(() => {});
  return r;
}
async function mbFetch(p) {
  for (let tryNo = 0; ; tryNo++) {
    const wait = mbLast + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    mbLast = Date.now();
    let res;
    try { res = await fetch(MB + p + (p.includes('?') ? '&' : '?') + 'fmt=json', {headers: {'user-agent': UA, accept: 'application/json'}}); }
    catch (e) { throw new LibraryError(`连不上 MusicBrainz：${e.cause?.code || e.message}`); }
    if (res.ok) return res.json();
    // 503 is MusicBrainz shedding load; back off and retry a few times before giving up.
    if (res.status === 503 && tryNo < 3) { await sleep(2000 * (tryNo + 1)); continue; }
    if (res.status === 404) throw new LibraryError(`MusicBrainz 里没有这一项：${p.split('?')[0]}`);
    throw new LibraryError(`MusicBrainz 返回 HTTP ${res.status}：${p.split('?')[0]}`);
  }
}
async function caaIndex(releaseId) {
  try {
    const res = await fetch(`${CAA}release/${releaseId}/`, {headers: {'user-agent': UA}});
    return res.ok ? await res.json() : {images: []};
  } catch { return {images: []}; }
}

const luceneTerm = s => String(s || '').trim().replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ').replace(/\s+/g, ' ').trim();
const artistName = ac => (ac || []).map(a => a.name + (a.joinphrase || '')).join('');
// 12" and generic vinyl only; 7" and 10" don't fit a 12" jacket.
const isLp = m => /^(12" )?Vinyl$/.test(m.format || '');
const isLpRelease = r => (r.media || []).some(isLp);
const isDigital = r => (r.media || []).some(m => m.format === 'Digital Media');
const art = r => r['cover-art-archive'] || {};
// Equal matches: albums before EPs, singles and the rest, since a mockup is usually for an album.
const sortGroups = gs => {
  const rank = g => ({Album: 0, EP: 1, Single: 2}[g['primary-type']] ?? 3);
  return gs.map((g, i) => ({g, i})).sort((a, b) => (b.g.score ?? 0) - (a.g.score ?? 0) || rank(a.g) - rank(b.g) || a.i - b.i).map(x => x.g);
};
const groupRow = g => ({id: g.id, title: g.title, artist: artistName(g['artist-credit']), year: g['first-release-date']?.slice(0, 4) || null,
  type: g['primary-type'] || null, ...(g.score != null ? {score: g.score} : {})});

// Albums matching artist / album. When the album search finds nothing for an artist, look the artist up by
// alias (release-group search only sees the credited name, so "Jay Chou" misses 周杰倫): one hit lists that
// artist's albums, several come back as `artists` to choose from with artistId.
export async function search({artist, album, artistId, limit = 25}) {
  const a = luceneTerm(artist), al = luceneTerm(album);
  if (artistId) return artistAlbums({id: artistId}, al, limit);
  if (!a && !al) throw new LibraryError('library search 需要 --artist 或 --album');
  // Every artist word must match; album words stay loose.
  const q = [al && `releasegroup:(${al})`, a && `artist:(${a.split(' ').join(' AND ')})`].filter(Boolean).join(' AND ');
  const j = await mbGet(`release-group?query=${encodeURIComponent(q)}&limit=${limit}`);
  const groups = sortGroups(j['release-groups'] || []);
  if (groups.length || !a) return {groups: groups.map(groupRow), total: j.count || 0};
  const found = ((await mbGet(`artist?query=${encodeURIComponent(a)}&limit=6`)).artists || []).filter(x => (x.score ?? 0) >= 60);
  if (found.length === 1) return artistAlbums(found[0], al, limit);
  return {groups: [], artists: found.map(x => ({id: x.id, name: x.name, disambiguation: x.disambiguation || null, type: x.type || null,
    country: x.country || null, begin: x['life-span']?.begin?.slice(0, 4) || null})),
  note: found.length ? '没有直接匹配的专辑，按别名找到多位艺人，用 --artist-id 选一位' : '没有找到这张专辑或这位艺人'};
}
async function artistAlbums(x, album, limit) {
  if (album) {
    const j = await mbGet(`release-group?query=${encodeURIComponent(`arid:${x.id} AND releasegroup:(${album})`)}&limit=${limit}`);
    const gs = sortGroups(j['release-groups'] || []);
    if (gs.length) return {artist: {id: x.id, name: x.name || artistName(gs[0]['artist-credit'])}, groups: gs.map(groupRow), total: j.count || 0};
  }
  // Browse returns 100 at a time; read up to 500 before sorting by date, newest first.
  let gs = [];
  for (let off = 0, total = 1; off < total && off < 500; off += 100) {
    const j = await mbGet(`release-group?artist=${x.id}&type=album|ep&inc=artist-credits&limit=100&offset=${off}`);
    gs = gs.concat(j['release-groups'] || []); total = j['release-group-count'] || 0;
  }
  gs.sort((a, b) => String(b['first-release-date'] || '').localeCompare(String(a['first-release-date'] || '')));
  const name = x.name || artistName(gs[0]?.['artist-credit']);
  return {artist: {id: x.id, name}, groups: gs.map(groupRow), total: gs.length,
    ...(album ? {note: `没找到「${album}」，这是 ${name} 的全部专辑，可能用了原文标题`} : {})};
}

// Every release of an album, up to 300. Vinyl pressings come first (they also set the record settings),
// then any other release that has artwork, so an album with no vinyl yet still has art.
async function groupReleases(groupId) {
  let all = [], offset = 0, total = 1;
  while (offset < total && offset < 300) {
    const j = await mbGet(`release?release-group=${groupId}&inc=labels+media&limit=100&offset=${offset}`);
    all = all.concat(j.releases || []); total = j['release-count'] || 0; offset += 100;
  }
  const byArt = (a, b) => (art(b).count || 0) - (art(a).count || 0) || (+!!art(b).back) - (+!!art(a).back) || String(a.date || '9').localeCompare(String(b.date || '9'));
  return {all, total, lps: all.filter(isLpRelease).sort(byArt), rest: all.filter(r => !isLpRelease(r) && art(r).artwork).sort(byArt)};
}
const releaseRow = r => {
  const lp = (r.media || []).filter(isLp).length;
  return {id: r.id, title: r.title, date: r.date || null, country: r.country || null,
    catalog: (r['label-info'] || []).map(l => l['catalog-number']).filter(Boolean)[0] || null,
    format: lp ? `${lp}LP` : [...new Set((r.media || []).map(m => m.format).filter(Boolean))].join(' + ') || null,
    packaging: r.packaging && r.packaging !== 'None' ? r.packaging : null, vinyl: lp > 0,
    art: {front: !!art(r).front, back: !!art(r).back, count: art(r).count || 0}};
};
export async function releases(groupId) {
  const [g, {lps, rest, total, all}] = await Promise.all([mbGet(`release-group/${groupId}?inc=artist-credits`), groupReleases(groupId)]);
  return {group: groupRow(g), releases: [...lps, ...rest].map(releaseRow), vinylCount: lps.length, read: all.length, total};
}

// Tracks per side from the A1 / B2 numbering; plain 1, 2, 3 numbering splits the disc in half.
function sideCounts(medium) {
  const by = {};
  for (const t of medium.tracks || []) { const m = /^([A-Z])/i.exec(t.number || ''); if (m) { const k = m[1].toUpperCase(); by[k] = (by[k] || 0) + 1; } }
  const v = Object.values(by); if (v.length) return v;
  const n = (medium.tracks || []).length; return n ? [Math.ceil(n / 2), Math.floor(n / 2)] : [];
}

export const LABEL_SLOTS = ['labelA', 'labelB', 'labelC', 'labelD'];
export const isLabelSlot = s => LABEL_SLOTS.includes(s);

// What a release offers and where each image would go, as the page's library would fill it.
// keep: slots that already hold the viewer's own image; they are only replaced through --use.
// sleeveOn: whether the inner sleeve shows, since its art is only filled when it does.
export async function plan(releaseId, {keep = [], sleeveOn = false} = {}) {
  const rel = await mbGet(`release/${releaseId}?inc=recordings+labels+release-groups+artist-credits`);
  const group = rel['release-group'];
  const [caa, gr] = await Promise.all([caaIndex(rel.id), group ? groupReleases(group.id) : {all: [], lps: []}]);
  // CAA lists http:// links.
  const https = list => JSON.parse(JSON.stringify(list || []).replace(/http:\/\//g, 'https://'));
  const toImg = (i, rid) => ({types: i.types || [], front: !!i.front, back: !!i.back, note: i.comment || '', ref: `${rid}/${i.id}`,
    full: [i.thumbnails?.['1200'], i.thumbnails?.['500'] || i.thumbnails?.large, i.image].filter(Boolean)});
  const own = https(caa.images).map(i => toImg(i, rel.id));
  // Other pressings of the same album often carry a different cover; offer their fronts as well.
  const others = gr.lps.filter(o => o.id !== rel.id && art(o).front).slice(0, 12).map(o => ({types: ['Front'], front: false, back: false, other: true,
    from: '其他版本', note: [o.date?.slice(0, 4), o.country, (o['label-info'] || []).map(l => l['catalog-number']).filter(Boolean)[0]].filter(Boolean).join(' · '),
    ref: `${o.id}/front`, full: [`${CAA}release/${o.id}/front-1200`, `${CAA}release/${o.id}/front-500`]}));
  // A new pressing often has no scans yet, while the CD or digital release of the same album does.
  let formats = [];
  if (!own.some(i => i.front || i.types.includes('Front')) || !own.some(i => i.back || i.types.includes('Back'))) {
    const alt = gr.all.filter(o => o.id !== rel.id && !isLpRelease(o) && art(o).artwork).sort((a, b) => (art(b).count || 0) - (art(a).count || 0)).slice(0, 2);
    const idx = await Promise.all(alt.map(o => caaIndex(o.id)));
    formats = alt.flatMap((o, n) => {
      const from = [...new Set((o.media || []).map(m => m.format).filter(Boolean))].join(' + ') || '其他格式';
      return https(idx[n].images).map(i => ({...toImg(i, o.id), from, note: [o.date?.slice(0, 4), o.country].filter(Boolean).join(' · ')}));
    });
  }
  // The cover comes first from a digital release: that is the label's own artwork file, not a scan.
  const dig = isDigital(rel) ? null : gr.all.filter(o => o.id !== rel.id && isDigital(o) && art(o).front).sort((a, b) => (art(b).count || 0) - (art(a).count || 0))[0];
  if (dig) formats = formats.filter(i => !(i.ref.startsWith(dig.id + '/') && i.types.includes('Front')));
  const digital = dig ? [{types: ['Front'], front: false, back: false, digital: true, from: '数字版', note: [dig.date?.slice(0, 4), dig.country].filter(Boolean).join(' · '),
    ref: `${dig.id}/front`, full: [`${CAA}release/${dig.id}/front`, `${CAA}release/${dig.id}/front-1200`]}] : [];

  const assign = {}, kept = [];
  const take = slot => { if (keep.includes(slot)) { if (!kept.includes(slot)) kept.push(slot); return false; } return true; };
  for (const [slot, f] of [['front', i => i.front], ['front', i => i.types.includes('Front')], ['back', i => i.back], ['back', i => i.types.includes('Back')],
    ['spine', i => i.types.includes('Spine')], ['sleeve', i => i.types.includes('Liner')]]) {
    if (slot in assign || kept.includes(slot) || (slot === 'sleeve' && !sleeveOn)) continue;
    const k = own.findIndex((im, n) => f(im) && !Object.values(assign).includes(n)); if (k < 0) continue;
    if (take(slot)) assign[slot] = k;
  }
  // Only a vinyl pressing says anything about the records; a CD or digital release lends its images alone.
  const lps = (rel.media || []).filter(isLp), vinyl = lps.length > 0, sides = lps.slice(0, 2).map(sideCounts), nLp = Math.min(2, lps.length) || 1;
  // Disc images go to the sides: first where the uploader's comment names one ("Side B"), then in upload order.
  const free = LABEL_SLOTS.slice(0, vinyl ? nLp * 2 : 0).filter(take);
  const discs = own.map((im, n) => im.types.includes('Medium') ? n : -1).filter(n => n >= 0);
  for (const n of [...discs]) {
    const m = /\bside\s*([A-D])\b/i.exec(own[n].note) || /^\s*([A-D])\s*$/.exec(own[n].note), sl = m && 'label' + m[1].toUpperCase();
    if (sl && free.includes(sl)) { assign[sl] = n; free.splice(free.indexOf(sl), 1); discs.splice(discs.indexOf(n), 1); }
  }
  for (const n of discs) { const sl = free.shift(); if (!sl) break; assign[sl] = n; }
  // Front: the digital cover when there is one; else this release's own; else another pressing's or format's.
  if (digital.length) { if (take('front')) assign.front = own.length + others.length + formats.length; }
  else if (!('front' in assign) && !kept.includes('front')) {
    const k = [...others, ...formats].findIndex(i => i.types.includes('Front'));
    if (k >= 0 && take('front')) assign.front = own.length + k;
  }
  const pack = rel.packaging, jacket = !vinyl ? null : pack === 'Gatefold Cover' ? 'gatefold' : pack ? 'single' : null;
  const images = [...own, ...others, ...formats, ...digital].map((im, n) => ({n, ...im}));
  const notes = [];
  if (!vinyl) notes.push(`这是 ${[...new Set((rel.media || []).map(m => m.format).filter(Boolean))].join(' + ') || '非黑胶'} 版本，只用它的图，不改唱片参数；CD 背面比例和黑胶不同，用作背面前先看看`);
  if (lps.length > 2) notes.push(`这一版共 ${lps.length} 张唱片，只做前 2 张`);
  if (images.length && !own.length) notes.push('这一版还没有图，用的是同一张专辑其他版本和格式的图');
  if (!images.length) notes.push('这一版在曲库里没有图片，只能写入唱片参数');
  if (kept.length) notes.push(`${kept.join(', ')} 已有非曲库的图，默认保留；要替换用 --use <贴图位>=<图号>`);
  return {
    release: {...releaseRow(rel), url: `https://musicbrainz.org/release/${rel.id}`},
    group: group ? {id: group.id, title: group.title, artist: artistName(group['artist-credit'] || rel['artist-credit'])} : null,
    images, assign, kept,
    records: vinyl ? {count: nLp, jacket, tracks: sides.map(s => s.length ? Math.min(20, Math.max(...s)) : null), sides} : null,
    notes,
  };
}

// The first URL of an image that downloads.
export async function download(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url, {headers: {'user-agent': UA}});
      if (res.ok) return {url, type: res.headers.get('content-type')?.split(';')[0] || 'image/jpeg', buffer: Buffer.from(await res.arrayBuffer())};
    } catch {}
  }
  throw new LibraryError(`图片下载失败：${urls[0]}`);
}
