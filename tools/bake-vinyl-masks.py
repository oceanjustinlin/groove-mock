#!/usr/bin/env python3
"""Bake VinylLab mask masters into runtime vinyl pattern masks for Groove Mock.

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
CROP = 0.975
CURATED = {
    'splatter-04': {'role': 'effect'},
    'splatter-05': {'role': 'effect', 'floor': True},
    'splatter-07': {'role': 'effect'},
    'splatter-08': {'role': 'effect', 'floor': True},
    'starburst-04': {'role': 'effect', 'status': 'review'},
    'starburst-06': {'role': 'effect'},
    'blob-01': {'role': 'layout'},
    'blob-03': {'role': 'layout'},
    'pinwheel-02': {'role': 'layout', 'crop': 0.92},
    'ripple-01': {'role': 'layout', 'status': 'review'},
    'swirl-02': {'role': 'layout', 'status': 'review'},
}

# meta.disc_frac is the disc diameter as a fraction of the master's width. The masters extend the
# pattern past the rim with polar streaks; inset slightly so the extension seam never shows.
SEAM_INSET = 0.002


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
    return {
        'id': mask_id,
        'family': mask_id.rsplit('-', 1)[0],
        'role': cfg['role'],
        'file': f'{mask_id}.png',
        'size': size,
        'accents': len(channels),
        # cluster_colors[0] is the base cluster, the rest follow the accent channel order.
        'base': colors[0] if colors else None,
        'colors': colors[1:1 + len(channels)],
        'labelRadius': meta.get('label_radius'),
        'source': {'kind': 'generated', 'master': f'VinylLab/assets/masks/{mask_id}', 'file': meta.get('source')},
        'status': cfg.get('status', 'draft'),
        'bake': {'crop': crop, 'floor': floors},
    }


def preview(mask_id: str, entry: dict, dest: Path):
    """Flat two-palette check: the extracted palette, then a deliberately different one."""
    m = np.asarray(Image.open(OUT / entry['file'])).astype(np.float32) / 255
    palettes = [
        [entry['base'] or '#dddddd', *entry['colors']],
        ['#141414', '#f2c14e', '#e4572e', '#4c9f70'][:1 + entry['accents']],
    ]
    tiles = []
    for pal in palettes:
        rgb = lambda h: np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32)
        out = np.broadcast_to(rgb(pal[0]), m.shape).copy()
        for c in range(entry['accents']):
            a = m[..., c:c + 1]
            out = out * (1 - a) + rgb(pal[1 + c]) * a
        h, w = m.shape[:2]
        yy, xx = np.mgrid[:h, :w]
        r = np.hypot(xx - w / 2 + .5, yy - h / 2 + .5) / (w / 2)
        out[r > 1] = 255
        out[r < 0.331] = 200  # Ø100 label of a Ø302 disc
        tiles.append(Image.fromarray(out.astype(np.uint8)))
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
        if args.preview:
            preview(mask_id, entries[mask_id], args.preview)
        kb = (OUT / entries[mask_id]['file']).stat().st_size / 1024
        e = entries[mask_id]
        print(f'{mask_id}: {e["role"]}, {e["accents"]} accent(s), floor {e["bake"]["floor"]}, {e["status"]}, {kb:.0f} KB')

    masks = [entries[k] for k in sorted(entries) if (OUT / entries[k]['file']).exists()]
    manifest_path.write_text(json.dumps({'version': 1, 'masks': masks}, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
