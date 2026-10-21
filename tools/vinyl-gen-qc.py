#!/usr/bin/env python3
"""Turn a generated vinyl mask into a grayscale master, bake it into an isolated review library, and write a
QC board that puts it next to the photo it was modelled on.

  python3 tools/vinyl-gen-qc.py output/texture-gen/masters/smoke-p22 --palette tonal --base '#e9e7e2' --color '#1d1d1f' \
      --source-kind unlicensed-reference --ref-url https://www.pinterest.com/pin/...

The folder holds ref.(jpg|png) (the photo), raw.png (the image model's output) and prompt.txt. Output stays in
output/texture-gen (ignored): the live vinyl-masks library is never touched. Checks are hints for a human
reviewer, not a verdict; the board is what decides.

Similarity: the reference gets a rough extraction (grayscale, inverted when the pattern is darker than the base),
both are unwrapped to polar strips, and the best normalised correlation over every rotation, with and without a
mirror, is reported. Rotation is a circular shift in polar space, so a traced-and-rotated copy still scores high.
"""
import argparse, importlib.util, json, hashlib, shutil, sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
GEN = ROOT / 'output/texture-gen'
spec = importlib.util.spec_from_file_location('baker', ROOT / 'tools/bake-vinyl-masks.py')
baker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baker)
spec = importlib.util.spec_from_file_location('extractor', ROOT / 'tools/vinyl-photo-extract.py')
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)

N = 1024
LABEL = 100 / 302          # label radius / disc radius, as in index.html
yy, xx = np.mgrid[:N, :N]
R = np.hypot(xx - N / 2 + .5, yy - N / 2 + .5) / (N / 2)
TH = np.arctan2(yy - N / 2 + .5, xx - N / 2 + .5)
FACE = (R > LABEL + 0.03) & (R < 0.97)


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def square(img):
    s = min(img.size)
    l, t = (img.width - s) // 2, (img.height - s) // 2
    return img.crop((l, t, l + s, t + s))


def to_master(raw: Path, gain=None, levels=None):
    """Model output -> square single-channel 8-bit master. Returns (L image, notes).
    gain 'auto' scales linearly so the 99.8th percentile reaches 0.95: image models often paint a faint mask,
    and a linear gain brightens it without changing the relative density (no clipping of the soft range)."""
    im = Image.open(raw)
    notes = {'rawSize': im.size, 'rawMode': im.mode}
    if 'A' in im.getbands():
        notes['alphaMin'] = im.getchannel('A').getextrema()[0]
        im = im.convert('RGB')
    rgb = np.asarray(im.convert('RGB')).astype(np.int16)
    notes['channelSpread'] = int((rgb.max(2) - rgb.min(2)).max())
    if im.width != im.height:
        notes['cropToSquare'] = True
        im = square(im)
    L = im.convert('L')
    if levels:
        # Black point + gamma, chosen by eye against the reference: a model that paints the haze too dense
        # leaves a grey wash; lifting the black point clears it and gamma keeps the cores dense.
        bp, gm = levels
        a = np.asarray(L).astype(np.float32) / 255
        top = float(np.percentile(a, 99.8))
        L = Image.fromarray((np.clip((a - bp) / max(top - bp, 1e-3), 0, 1) ** gm * 255).round().astype(np.uint8))
        notes['levels'] = {'blackPoint': bp, 'gamma': gm, 'whitePointP998': round(top, 3)}
    if gain:
        a = np.asarray(L).astype(np.float32) / 255
        k = float(gain) if gain != 'auto' else 0.95 / max(float(np.percentile(a, 99.8)), 1e-3)
        k = max(1.0, k)
        notes['gain'] = round(k, 3)
        notes['clippedShare'] = round(float((a * k > 1).mean()), 5)
        L = Image.fromarray((np.clip(a * k, 0, 1) * 255).round().astype(np.uint8))
    return L, notes


def disc_of(photo: Image.Image):
    """Rough disc crop of a centred top-down record photo: the bounding box of pixels that differ from the
    border colour, squared up and padded so the rim is just outside."""
    a = np.asarray(photo.convert('RGB')).astype(np.float32)
    border = np.median(np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]]), axis=0)
    diff = np.abs(a - border).sum(2) > 40
    ys, xs = np.where(diff)
    if len(xs) < 100:
        return square(photo)
    x0, x1, y0, y1 = np.percentile(xs, 0.5), np.percentile(xs, 99.5), np.percentile(ys, 0.5), np.percentile(ys, 99.5)
    cx, cy, s = (x0 + x1) / 2, (y0 + y1) / 2, max(x1 - x0, y1 - y0) / 2
    return photo.crop((int(cx - s), int(cy - s), int(cx + s), int(cy + s)))


def rough_extract(photo: Image.Image):
    """Pattern coverage of the reference, for comparison only: luminance, flipped so the minority (pattern)
    side is white, stretched between the face's 2nd and 98th percentiles. Lighting and grooves stay in."""
    g = np.asarray(disc_of(photo).convert('L').resize((N, N), Image.LANCZOS)).astype(np.float32) / 255
    if np.median(g[FACE]) > g[FACE].mean():     # skewed toward dark accents on a light base
        g = 1 - g
    lo, hi = np.percentile(g[FACE], [2, 98])
    return np.clip((g - lo) / max(hi - lo, 1e-3), 0, 1)


def polar(m, rows=96, cols=512):
    r = np.linspace(LABEL + 0.03, 0.95, rows)[:, None]
    t = np.linspace(-np.pi, np.pi, cols, endpoint=False)[None, :]
    x = np.clip((r * np.cos(t) + 1) * N / 2, 0, N - 1).astype(int)
    y = np.clip((r * np.sin(t) + 1) * N / 2, 0, N - 1).astype(int)
    p = m[y, x]
    # Drop each ring's mean: every pressing is denser at some radius, which is not what tracing copies.
    p = p - p.mean(axis=1, keepdims=True)
    return p / (p.std() + 1e-6)


def best_rotation_ncc(a, b):
    """Max normalised cross-correlation over circular shifts in angle (rotation), and over a mirror."""
    best = -1.0
    for bb in (b, b[:, ::-1]):
        F = np.fft.ifft(np.fft.fft(a, axis=1) * np.conj(np.fft.fft(bb, axis=1)), axis=1).real.sum(0)
        best = max(best, float(F.max() / a.size))
    return best


def anisotropy(m):
    """Share of gradient energy across the radius (tangential): ~0.5 is isotropic, higher means the pattern is
    streaked along the radius, as a pressed puck is."""
    sm = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32)
    gy, gx = np.gradient(sm)
    gr = gx * np.cos(TH) + gy * np.sin(TH)
    gt = -gx * np.sin(TH) + gy * np.cos(TH)
    et, er = (gt[FACE] ** 2).sum(), (gr[FACE] ** 2).sum()
    return float(et / (et + er + 1e-9))


def stats(m):
    f = m[FACE]
    rim = m[(R > 0.93) & (R < 0.99)].mean()
    inner = m[(R > 0.80) & (R < 0.92)].mean()
    corners = m[R > 1.05].mean()
    return {'coverageMean': round(float(f.mean()), 3), 'p05': round(float(np.percentile(f, 5)), 3),
            'p50': round(float(np.percentile(f, 50)), 3), 'strong': round(float((f > 0.5).mean()), 3), 'p99': round(float(np.percentile(f, 99)), 3),
            'rimToInner': round(float(rim / (inner + 1e-6)), 2), 'cornersToFace': round(float(corners / (f.mean() + 1e-6)), 2),
            'radialStreak': round(anisotropy(m), 3)}


def flags(gen, ref, ncc, notes, role, from_photo=False):
    out = []
    if role == 'effect' and gen['p50'] > 0.3:
        out.append(f"most of the disc is covered (median {gen['p50']}): polarity inverted, or far too dense?")
    sr = gen['strong'] / max(ref['strong'], 1e-3)
    if sr > 2 or sr < 0.4:
        out.append(f"strong coverage (>0.5) {gen['strong']} vs reference {ref['strong']} (x{sr:.1f})")
    if notes.get('channelSpread', 0) > 16:
        out.append(f"model output not grayscale (channels differ by {notes['channelSpread']}); luminance used")
    if notes.get('alphaMin', 255) < 255:
        out.append('model output had transparency; flattened')
    if gen['p05'] > 0.06:
        out.append(f"haze: 5th percentile {gen['p05']} (overall grey wash?)")
    if gen['rimToInner'] > 1.6 or gen['rimToInner'] < 0.5:
        out.append(f"rim ring: rim/inner coverage {gen['rimToInner']} (disc drawn instead of a full square?)")
    if not from_photo and gen['cornersToFace'] < 0.4:
        out.append(f"corners near empty ({gen['cornersToFace']}): drawn as a disc, check the rim")
    if ncc > 0.7:  # calibrated: unrelated pressings 0.27 mean, 0.54 max; a rotated, blurred copy 0.93
        out.append(f'too similar to the reference (ncc {ncc:.2f}): looks traced, regenerate')
    d = abs(gen['radialStreak'] - ref['radialStreak'])
    if d > 0.08:
        out.append(f"streak direction differs from the reference ({gen['radialStreak']} vs {ref['radialStreak']})")
    cr = gen['coverageMean'] / max(ref['coverageMean'], 1e-3)
    if cr > 2.5 or cr < 0.4:
        out.append(f"coverage {gen['coverageMean']} vs reference ~{ref['coverageMean']} (x{cr:.1f})")
    return out


def tile(img, size, caption):
    t = Image.new('RGB', (size, size + 22), '#f4f3ef')
    t.paste(img.convert('RGB').resize((size, size), Image.LANCZOS), (0, 22))
    ImageDraw.Draw(t).text((6, 4), caption, fill='#222')
    return t


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('folder', type=Path)
    ap.add_argument('--palette', choices=['tonal', 'accent'], required=True)
    ap.add_argument('--role', choices=['layout', 'effect'], default='effect')
    ap.add_argument('--base', help='default base colour (default: from extract.json)')
    ap.add_argument('--color', help='default colour per layer, comma-separated (default: from extract.json)')
    ap.add_argument('--source-kind', default='unlicensed-reference')
    ap.add_argument('--ref-url', default=None)
    ap.add_argument('--gain', help="linear gain for a faint model output: a number or 'auto'")
    ap.add_argument('--levels', help='black point and gamma, e.g. 0.2,2.0')
    ap.add_argument('--id', help='mask id (default: the folder name), for baking variants of one master')
    ap.add_argument('--master', help='grayscale layer file(s) in the folder, comma-separated (e.g. layer1.png,layer2.png from '
                    'vinyl-photo-extract.py), instead of converting raw.png')
    ap.add_argument('--render', type=Path, help='3D render PNG to put on the board')
    args = ap.parse_args()

    d = args.folder.resolve()
    mid = args.id or d.name
    ref_path = next(p for p in (d / 'ref.jpg', d / 'ref.png') if p.exists())
    ex = json.loads((d / 'extract.json').read_text()) if (d / 'extract.json').exists() else {}
    base = args.base or ex.get('base')
    colors = args.color.split(',') if args.color else ex.get('patterns')
    if args.master:
        layers = args.master.split(',')
        masters = [Image.open(d / f).convert('L') for f in layers]
        notes = {'fromPhoto': True}
        generated = next(p for p in (d / 'gen.png', d / 'raw.png') if p.exists())
    else:
        master, notes = to_master(d / 'raw.png', args.gain, tuple(map(float, args.levels.split(','))) if args.levels else None)
        layers = [f'layer1-{mid}.png' if args.id else 'layer1.png']
        master.save(d / layers[0])
        masters = [master]
        generated = d / 'raw.png'
    if not base or not colors or len(colors) != len(layers):
        sys.exit('need --base and one --color per layer (or an extract.json beside them)')

    # Similarity and statistics work on the union of the layers: where any pattern colour is.
    gen_m = np.max([np.asarray(m.resize((N, N), Image.LANCZOS)).astype(np.float32) / 255 for m in masters], axis=0)
    master = Image.fromarray((gen_m * 255).astype(np.uint8))
    if args.master:
        # Compare like with like: the reference through the same colour extraction as the generated photo.
        ref_layers, _ = extractor.extract(ref_path, accents=len(layers))
        ref_m = np.max(ref_layers, axis=0)
    else:
        ref_m = rough_extract(Image.open(ref_path))
    ncc = best_rotation_ncc(polar(gen_m), polar(ref_m))
    g, r = stats(gen_m), stats(ref_m)

    prompt = (d / 'prompt.txt').read_text() if (d / 'prompt.txt').exists() else None
    baker.OUT = GEN / 'vinyl-masks'
    baker.CURATED[mid] = {
        'role': args.role, 'palette': args.palette, 'layers': layers, 'base': base, 'colors': colors,
        'status': 'review',
        'source': {'kind': args.source_kind, 'operation': 'variant-reconstruction', 'reference': args.ref_url,
                   'referenceSha256': sha(ref_path), 'generatedFile': generated.name, 'generatedSha256': sha(generated), 'tool': 'codex exec image_generation',
                   'prompt': prompt},
    }
    entry = baker.bake(d, mid, N)
    entry['source']['master'] = f'output/texture-gen/masters/{mid}'
    entry['processing'] = {'fromPhoto': ex} if args.master and ex else {'fromRaw': 'luminance', **{k: notes[k] for k in ('gain', 'clippedShare', 'cropToSquare', 'levels') if k in notes}}
    if args.master:
        entry['source']['operation'] = 'photo-variant + colour extraction'
    baker.thumb(entry)
    mf = baker.OUT / 'manifest.json'
    masks = {e['id']: e for e in json.loads(mf.read_text())['masks']} if mf.exists() else {}
    masks[mid] = entry
    mf.write_text(json.dumps({'version': 1, 'masks': [masks[k] for k in sorted(masks)]}, ensure_ascii=False, indent=2) + '\n')
    # The CLI renders with the real page; a byte copy beside the review library makes it load this manifest.
    shutil.copyfile(ROOT / 'index.html', GEN / 'index.html')

    baked = baker.load(entry)
    pals = [[base, colors[0]], ['#1b1d22', '#e6e1d6'], ['#2f6f73', '#f1c27d']]
    tints = []
    for i, (b, col) in enumerate(pals):
        if i == 0:
            pal = [base, *colors]
        else:
            rest = baker.apply_params(args.palette, b, col, entry['palette']['derive'])
            pal = [b, *rest] if args.palette == 'tonal' else [b, col, *rest]
        tints.append(baker.tint(baked, pal))
    S = 300
    tiles = [tile(disc_of(Image.open(ref_path)), S, 'reference (photo)'),
             tile(Image.fromarray((ref_m * 255).astype(np.uint8)), S, 'reference, ' + ('colour extraction' if args.master else 'rough extraction')),
             tile(master, S, f'generated mask ({len(layers)} layer{"s" if len(layers) > 1 else ""})')]
    tiles += [tile(t, S, f'tint {i + 1}: {pals[i][0]} / {pals[i][1]}') for i, t in enumerate(tints)]
    if args.render and args.render.exists():
        tiles.append(tile(square(Image.open(args.render)), S, '3D render'))
    fl = flags(g, r, ncc, notes, args.role, bool(args.master))
    # The page re-derives the pattern colours from the base; if that cannot reproduce the default palette (e.g. a
    # tonal near-black accent on a dark base sinks below the floor and flips light), the disc will not look like this.
    mode, params = entry['palette']['mode'], entry['palette']['derive']
    want = entry['colors'][1:] if mode == 'accent' else entry['colors']
    got = baker.apply_params(mode, entry['base'], entry['colors'][0], params)
    err = max((abs(int(x[i:i + 2], 16) - int(y[i:i + 2], 16)) for x, y in zip(got, want) for i in (1, 3, 5)), default=0)
    if err > 40:
        fl.append(f'default palette does not survive derivation (max channel error {err}/255, {want} -> {got})'
                  + ('; try palette accent' if mode == 'tonal' else ''))
    rows = [tiles[:4], tiles[4:]]
    board = Image.new('RGB', (4 * (S + 8) + 8, 2 * (S + 30) + 150), 'white')
    for ri, row in enumerate(rows):
        for ci, t in enumerate(row):
            board.paste(t, (8 + ci * (S + 8), 8 + ri * (S + 30)))
    dr = ImageDraw.Draw(board)
    y = 2 * (S + 30) + 12
    dr.text((10, y), f'{mid}  palette={args.palette}  similarity(ncc, any rotation/mirror)={ncc:.2f}', fill='#000')
    dr.text((10, y + 18), f"generated: {g}", fill='#333')
    dr.text((10, y + 36), f"reference: {r}", fill='#333')
    for i, f in enumerate(fl or ['no automatic flags (still needs a look)']):
        dr.text((10, y + 60 + i * 16), ('! ' if fl else '') + f, fill='#b00' if fl else '#070')
    (GEN / 'boards').mkdir(exist_ok=True)
    board.save(GEN / 'boards' / f'{mid}.jpg', quality=90)
    report = {'id': mid, 'similarityNcc': round(ncc, 3), 'generated': g, 'reference': r, 'flags': fl, 'notes': notes,
              'board': f'output/texture-gen/boards/{mid}.jpg', 'manifestEntry': entry}
    (d / f'qc-{mid}.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ('id', 'similarityNcc', 'flags', 'board')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
