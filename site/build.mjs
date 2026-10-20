#!/usr/bin/env node
// Build the GitHub Pages site into _site/.
// index.html stays a head-less fragment (the CLI and the Claude preview load it as is); this script wraps
// it in a full document with search and sharing metadata, and adds the favicon, social card, robots.txt
// and sitemap. Usage: node site/build.mjs   (SITE_URL overrides the public address)
// SITE_PREVIEW=1 builds a preview (e.g. Cloudflare Pages per branch): noindex everywhere, no sitemap, and the
// canonical link still points at the public site.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, '_site');
const SITE_URL = (process.env.SITE_URL || 'https://recordmockup.com/').replace(/\/?$/, '/');
const REPO_URL = 'https://github.com/oceanjustinlin/record-mockup';
const PREVIEW = process.env.SITE_PREVIEW === '1';

const TITLE = 'Record Mockup — 3D Vinyl & LP Mockup Generator';
const DESCRIPTION = 'Make photorealistic 3D vinyl record mockups in your browser: LP jackets, gatefolds, 2LP sets, ' +
  'shrink wrap, hype stickers, obi strips, coloured vinyl and edition numbers. Export transparent PNGs.';
const esc = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const source = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
// The fragment opens with its own charset, viewport, title and preview-only meta; the document head below
// replaces them. Everything up to the end of the first <style> block is head material.
const styleEnd = source.indexOf('</style>') + '</style>'.length;
if (styleEnd < '</style>'.length) throw new Error('index.html: no <style> block found');
const headPart = source.slice(0, styleEnd)
  .replace(/<meta charset="utf-8">\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '')
  .replace(/<title>[^<]*<\/title>\s*/i, '')
  .replace(/<meta name="claude:[^>]*>\s*/gi, '');
const bodyPart = source.slice(styleEnd);

const jsonLd = {
  '@context': 'https://schema.org', '@type': 'WebApplication', name: 'Record Mockup', url: SITE_URL,
  description: DESCRIPTION, image: SITE_URL + 'social-preview.png', applicationCategory: 'DesignApplication',
  operatingSystem: 'Any (modern web browser with WebGL 2)', browserRequirements: 'Requires WebGL 2',
  inLanguage: 'zh-CN', sameAs: [REPO_URL],
};

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(TITLE)}</title>
<meta name="description" content="${esc(DESCRIPTION)}">
<meta name="keywords" content="vinyl mockup, LP mockup, record sleeve mockup, album cover mockup, gatefold mockup, 3D vinyl mockup, 黑胶模型图, 唱片封套样机">
<link rel="canonical" href="${SITE_URL}">${PREVIEW ? '\n<meta name="robots" content="noindex,nofollow">' : ''}
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<meta name="theme-color" content="#eceee9">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Record Mockup">
<meta property="og:title" content="${esc(TITLE)}">
<meta property="og:description" content="${esc(DESCRIPTION)}">
<meta property="og:url" content="${SITE_URL}">
<meta property="og:image" content="${SITE_URL}social-preview.png">
<meta property="og:image:width" content="1280">
<meta property="og:image:height" content="640">
<meta property="og:image:alt" content="Record Mockup: a 3D vinyl mockup of a 2LP in shrink wrap with an obi strip and a hype sticker">
<meta property="og:locale" content="zh_CN">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(TITLE)}">
<meta name="twitter:description" content="${esc(DESCRIPTION)}">
<meta name="twitter:image" content="${SITE_URL}social-preview.png">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
${headPart.trim()}
</head>
<body>
${bodyPart.trim()}
</body>
</html>
`;

await fs.rm(OUT, {recursive: true, force: true});
await fs.mkdir(OUT, {recursive: true});
await fs.writeFile(path.join(OUT, 'index.html'), html);
await fs.copyFile(path.join(ROOT, 'site', 'favicon.svg'), path.join(OUT, 'favicon.svg'));
// Vinyl pattern masks, manifest and picker thumbnails, fetched by the page at runtime.
await fs.cp(path.join(ROOT, 'vinyl-masks'), path.join(OUT, 'vinyl-masks'), {recursive: true});
await fs.copyFile(path.join(ROOT, 'docs', 'images', 'social-preview.png'), path.join(OUT, 'social-preview.png'));
if (PREVIEW) {
  await fs.writeFile(path.join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  // Cloudflare Pages reads _headers; the header also covers files that carry no robots meta.
  await fs.writeFile(path.join(OUT, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow\n');
} else {
  await fs.writeFile(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}sitemap.xml\n`);
  await fs.writeFile(path.join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `  <url><loc>${SITE_URL}</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>\n</urlset>\n`);
}
await fs.writeFile(path.join(OUT, '.nojekyll'), '');
console.log(`Built ${path.relative(ROOT, OUT)}/ for ${SITE_URL}${PREVIEW ? ' (preview, noindex)' : ''}`);
