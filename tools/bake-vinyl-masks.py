#!/usr/bin/env python3
"""Bake VinylLab mask masters into runtime vinyl pattern masks for Record Mockup.

Masters stay outside the repo (16-bit field.png + RGB layers.png + meta.json per set). Each baked
mask is an 8-bit RGB PNG whose R/G/B channels are the accent1..3 soft masks, cropped so the disc
fills the square exactly: that matches the record face UVs in index.html (remapUV(face, r*2)).
Alpha is never used for packing, because canvas premultiplies it and would wipe RGB where A = 0.

  python3 tools/bake-vinyl-masks.py --src ~/Documents/VinylLab/assets/masks [--size 1024] [--preview DIR] [ids...]

Without ids, every entry in CURATED is baked. vinyl-masks/manifest.json is rewritten from the
baked files on every run, so it never lists a mask that is not on disk.
"""
import argparse, json, sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'vinyl-masks'

# Curated sets. Roles come from inspection, not from the folder prefix:
# layout = colour regions on the base, effect = overlay on top of the base.
# crop: fraction of the master's disc radius kept; the rest is cut off and the pattern scaled up to fill
#   the disc, because the masters carry the photographed rim's reflection as a thin accent ring and
#   ragged shapes near it. Default CROP.
# floor: subtract each channel's 5th-percentile haze, so a faint wash does not tint the whole disc.
# status: draft = usable, review = shape may still carry lighting from the master.
# palette: how the user colours it (index.html derives the rest from the parameters baked here):
#   accent = base + one pattern colour; further accents keep their default relation to those two.
#   tonal  = base only; every accent keeps its default lightness/chroma/hue offset from the base.
CROP = 0.975
CURATED = {
    'splatter-04': {'role': 'effect', 'palette': 'accent'},
    'splatter-05': {'role': 'effect', 'palette': 'accent', 'floor': True},
    'splatter-07': {'role': 'effect', 'palette': 'accent'},
    'splatter-08': {'role': 'effect', 'palette': 'accent', 'floor': True},
    'starburst-04': {'role': 'effect', 'palette': 'tonal', 'status': 'review'},
    'starburst-06': {'role': 'effect', 'palette': 'accent'},
    'blob-01': {'role': 'layout', 'palette': 'accent'},
    'blob-03': {'role': 'layout', 'palette': 'accent'},
    'pinwheel-02': {'role': 'layout', 'palette': 'accent', 'crop': 0.92},
    'ripple-01': {'role': 'layout', 'palette': 'tonal', 'status': 'review'},
    'swirl-02': {'role': 'layout', 'palette': 'accent', 'status': 'review'},
}

# meta.disc_frac is the disc diameter as a fraction of the master's width. The masters extend the
# pattern past the rim with polar streaks; inset slightly so the extension seam never shows.
SEAM_INSET = 0.002
THUMB = 160  # px, about 2x the picker tile


# ---- OKLab (Björn Ottosson). Must match the conversion in index.html, which applies these parameters.
def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _enc(c):
    c = min(1.0, max(0.0, c))
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def hex_to_oklab(h):
    r, g, b = (_lin(int(h[i:i + 2], 16) / 255) for i in (1, 3, 5))
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return np.array([0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
                     1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
                     0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s])


def oklab_to_hex(lab):
    L, a, b = lab
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    rgb = (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
           -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
           -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
    return '#' + ''.join(f'{round(_enc(c) * 255):02x}' for c in rgb)


def lch(lab):
    return lab[0], float(np.hypot(lab[1], lab[2])), float(np.arctan2(lab[2], lab[1]))


GREY = 0.02  # OKLab chroma below which a colour has no usable hue


def derive_params(mode, base, colors):
    """Relation of each derived accent to the user's colours, from the mask's default palette."""
    B = hex_to_oklab(base)
    if mode == 'accent':
        # Accent k = A + t (B - A) + dL: t is its place on the pattern colour (0) -> base (1) line, which
        # may extrapolate past either end; dL is the leftover lightness. The leftover hue is dropped on
        # purpose: it belongs to the default palette and turns into an unrelated hue for other colours.
        A = hex_to_oklab(colors[0])
        d = B - A
        out = []
        for c in colors[1:]:
            C = hex_to_oklab(c)
            t = float(np.dot(C - A, d) / max(np.dot(d, d), 1e-9))
            out.append({'t': round(t, 4), 'dL': round(float((C - (A + t * d))[0]), 4)})
        return out
    # Tonal accents keep the base hue: only lightness and chroma offsets carry over.
    Lb, Cb, _ = lch(B)
    out = []
    for c in colors:
        Lk, Ck, _ = lch(hex_to_oklab(c))
        out.append({'dL': round(Lk - Lb, 4), 'dC': round(Ck - Cb, 4)})
    return out


def apply_params(mode, base, color, params, contrast=1.0):
    """Python twin of derivePattern() in index.html; used to report how faithful the derivation is."""
    B = hex_to_oklab(base)
    if mode == 'accent':
        A = hex_to_oklab(color)
        return [oklab_to_hex(A + p['t'] * (B - A) + np.array([p['dL'], 0, 0])) for p in params]
    Lb, Cb, hb = lch(B)
    out = []
    for p in params:
        dL = p['dL'] * contrast
        # A darkening that would sink below the usable range goes the other way (a dark wash on black turns
        # light); a brightening past white just clamps.
        L = Lb + dL if Lb + dL >= 0.1 else Lb - dL
        L = min(0.98, max(0.05, L))
        C = Cb if Cb < GREY else max(0.0, Cb + p['dC'] * contrast)
        out.append(oklab_to_hex(np.array([L, C * np.cos(hb), C * np.sin(hb)])))
    return out


def bake(src_dir: Path, mask_id: str, size: int):
    meta = json.loads((src_dir / 'meta.json').read_text())
    layers = Image.open(src_dir / 'layers.png').convert('RGB')
    n = layers.width
    if layers.height != n:
        raise ValueError(f'{mask_id}: layers.png is not square ({layers.size})')
    cfg = CURATED[mask_id]
    crop = cfg.get('crop', CROP)
    frac = float(meta['disc_frac']) * crop - SEAM_INSET
    side = n * frac
    box = ((n - side) / 2, (n - side) / 2, (n + side) / 2, (n + side) / 2)
    img = layers.resize((size, size), Image.LANCZOS, box=box)

    arr = np.asarray(img).astype(np.float32) / 255
    yy, xx = np.mgrid[:size, :size]
    r = np.hypot(xx - size / 2 + .5, yy - size / 2 + .5) / (size / 2)

    floors = [0.0, 0.0, 0.0]
    if cfg.get('floor'):
        ring = (r > 0.4) & (r < 1)
        for c in range(3):
            f = float(np.percentile(arr[..., c][ring], 5))
            if f > 0.005:
                arr[..., c] = np.clip((arr[..., c] - f) / (1 - f), 0, 1)
                floors[c] = round(f, 3)

    # Corners outside the disc are never visible; blank them (keeping a filtering margin) to shrink the PNG.
    arr[r > 1.01] = 0
    arr = np.round(arr * 255).astype(np.uint8)
    img = Image.fromarray(arr)
    channels = [c for c in range(3) if arr[..., c].max() > 8]
    if not channels:
        raise ValueError(f'{mask_id}: every layers.png channel is empty')
    if channels != list(range(len(channels))):
        raise ValueError(f'{mask_id}: accent channels are not contiguous from R ({channels})')

    OUT.mkdir(exist_ok=True)
    img.save(OUT / f'{mask_id}.png', optimize=True)

    colors = meta.get('cluster_colors') or []
    mode = cfg['palette']
    accents = colors[1:1 + len(channels)]
    params = derive_params(mode, colors[0], accents)
    return {
        'id': mask_id,
        'family': mask_id.rsplit('-', 1)[0],
        'role': cfg['role'],
        'file': f'{mask_id}.png',
        'thumb': f'thumbs/{mask_id}.jpg',
        'size': size,
        'accents': len(channels),
        # cluster_colors[0] is the base cluster, the rest follow the accent channel order.
        'base': colors[0] if colors else None,
        'colors': accents,
        'palette': {'mode': mode, 'derive': params},
        'labelRadius': meta.get('label_radius'),
        'source': {'kind': 'generated', 'master': f'VinylLab/assets/masks/{mask_id}', 'file': meta.get('source')},
        'status': cfg.get('status', 'draft'),
        'bake': {'crop': crop, 'floor': floors},
    }


def tint(m: np.ndarray, palette: list) -> Image.Image:
    """Flat composite of a mask: palette[0] is the base, then one colour per accent channel.
    Outside the disc is white and the Ø100 label area (of a Ø302 disc) is grey."""
    rgb = lambda h: np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32)
    out = np.broadcast_to(rgb(palette[0]), m.shape).copy()
    for c in range(len(palette) - 1):
        a = m[..., c:c + 1]
        out = out * (1 - a) + rgb(palette[1 + c]) * a
    h, w = m.shape[:2]
    yy, xx = np.mgrid[:h, :w]
    r = np.hypot(xx - w / 2 + .5, yy - h / 2 + .5) / (w / 2)
    out[r > 1] = 255
    out[r < 0.331] = 200
    return Image.fromarray(out.astype(np.uint8))


def load(entry: dict) -> np.ndarray:
    return np.asarray(Image.open(OUT / entry['file'])).astype(np.float32) / 255


def thumb(entry: dict):
    """Panel picker thumbnail in the mask's own palette; the page crops it to a circle."""
    img = Image.fromarray(np.asarray(Image.open(OUT / entry['file']).resize((THUMB, THUMB), Image.LANCZOS)))
    m = np.asarray(img).astype(np.float32) / 255
    (OUT / 'thumbs').mkdir(exist_ok=True)
    tint(m, [entry['base'] or '#dddddd', *entry['colors']]).save(OUT / entry['thumb'], quality=82)


def preview(mask_id: str, entry: dict, dest: Path):
    """Flat two-palette check: the extracted palette, then a deliberately different one."""
    m = load(entry)
    palettes = [
        [entry['base'] or '#dddddd', *entry['colors']],
        ['#141414', '#f2c14e', '#e4572e', '#4c9f70'][:1 + entry['accents']],
    ]
    tiles = [tint(m, pal) for pal in palettes]
    sheet = Image.new('RGB', (tiles[0].width * 2, tiles[0].height), 'white')
    for i, t in enumerate(tiles):
        sheet.paste(t, (i * t.width, 0))
    dest.mkdir(parents=True, exist_ok=True)
    sheet.save(dest / f'{mask_id}.jpg', quality=85)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--src', type=Path, required=True, help='VinylLab assets/masks directory')
    ap.add_argument('--size', type=int, default=1024, help='output edge in px (default 1024)')
    ap.add_argument('--preview', type=Path, help='also write flat two-palette previews here')
    ap.add_argument('ids', nargs='*', help='mask ids to bake (default: all curated)')
    args = ap.parse_args()

    ids = args.ids or list(CURATED)
    unknown = [i for i in ids if i not in CURATED]
    if unknown:
        sys.exit(f'not in CURATED: {", ".join(unknown)}')

    manifest_path = OUT / 'manifest.json'
    entries = {}
    if manifest_path.exists():
        entries = {e['id']: e for e in json.loads(manifest_path.read_text())['masks']}
    for mask_id in ids:
        d = args.src.expanduser() / mask_id
        missing = [f for f in ('meta.json', 'layers.png') if not (d / f).exists()]
        if missing:
            sys.exit(f'{mask_id}: missing {", ".join(missing)} in {d}')
        entries[mask_id] = bake(d, mask_id, args.size)
        thumb(entries[mask_id])
        if args.preview:
            preview(mask_id, entries[mask_id], args.preview)
        kb = (OUT / entries[mask_id]['file']).stat().st_size / 1024
        e = entries[mask_id]
        # Re-derive the default palette from the user-facing colours and report the worst channel error.
        mode, params = e['palette']['mode'], e['palette']['derive']
        want = e['colors'][1:] if mode == 'accent' else e['colors']
        got = apply_params(mode, e['base'], e['colors'][0], params)
        err = max((abs(int(g[i:i + 2], 16) - int(w[i:i + 2], 16)) for g, w in zip(got, want) for i in (1, 3, 5)), default=0)
        print(f'{mask_id}: {e["role"]}/{mode}, {e["accents"]} accent(s), floor {e["bake"]["floor"]}, {e["status"]}, '
              f'{kb:.0f} KB, derive err {err}/255')

    masks = [entries[k] for k in sorted(entries) if (OUT / entries[k]['file']).exists()]
    manifest_path.write_text(json.dumps({'version': 1, 'masks': masks}, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
