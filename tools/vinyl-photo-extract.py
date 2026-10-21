#!/usr/bin/env python3
"""Extract a recolourable coverage mask from a top-down photo of a coloured record.

  python3 tools/vinyl-photo-extract.py output/texture-gen/masters/smoke-p22-photo [--photo gen.png] [--crop 0.975]

The image model is only asked for a photo (another pressing of the reference), which is what it is good at;
the mask comes from the photo's colours, so polarity and density follow the vinyl and nothing is invented.

1. Disc: pixels that differ from the border colour; centre = their centroid, radius from their area.
2. Crop a square inside the rim (crop x radius), so the rim's edge and reflection never enter the mask.
3. Colours in OKLab. The base vinyl is the dominant cluster of the face; the pattern colour is the cluster
   farthest from it. Each pixel's coverage is its position on the base -> pattern line (linear unmixing, as a
   translucent pigment mixes), scaled so the densest 0.5 % reach 1.
   With --accents 2 the face is unmixed against two pattern colours at once (least squares, weights clipped
   to 0..1), for marbles whose two pattern colours are not one line through the base.
4. Writes layer1.png (and layer2.png) (8-bit grayscale, square) and extract.json with the geometry, the colours found (usable
   as the default palette) and how even the base looked (an uneven base means lighting leaked into the mask).
"""
import argparse, json
from pathlib import Path

import numpy as np
from PIL import Image

N = 1024
LABEL = 100 / 302


def srgb_to_oklab(rgb):
    c = rgb / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929],
                   [0.2119034982, 0.6806995451, 0.1073969566],
                   [0.0883024619, 0.2817188376, 0.6299787005]])
    M2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468],
                   [1.9779984951, -2.4285922050, 0.4505937099],
                   [0.0259040371, 0.7827717662, -0.8086757660]])
    return np.cbrt(c @ M1.T) @ M2.T


def oklab_to_hex(lab):
    M2i = np.linalg.inv(np.array([[0.2104542553, 0.7936177850, -0.0040720468],
                                  [1.9779984951, -2.4285922050, 0.4505937099],
                                  [0.0259040371, 0.7827717662, -0.8086757660]]))
    M1i = np.linalg.inv(np.array([[0.4122214708, 0.5363325363, 0.0514459929],
                                  [0.2119034982, 0.6806995451, 0.1073969566],
                                  [0.0883024619, 0.2817188376, 0.6299787005]]))
    lin = np.clip((np.asarray(lab) @ M2i.T) ** 3 @ M1i.T, 0, 1)
    s = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)
    return '#' + ''.join(f'{int(round(v * 255)):02x}' for v in s)


def find_disc(a):
    border = np.median(np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]]), axis=0)
    diff = np.abs(a - border).sum(2) > 30
    ys, xs = np.nonzero(diff)
    cx, cy = xs.mean(), ys.mean()
    r = np.sqrt(diff.sum() / np.pi)
    return float(cx), float(cy), float(r), border


def kmeans(x, k, iters=25, seed=0):
    rng = np.random.default_rng(seed)
    c = x[rng.choice(len(x), k, replace=False)]
    for _ in range(iters):
        lab = np.argmin(((x[:, None] - c[None]) ** 2).sum(2), 1)
        c = np.array([x[lab == i].mean(0) if (lab == i).any() else c[i] for i in range(k)])
    return c, lab


def extract(photo, crop=0.975, clusters=3, accents=1):
    """Returns (list of N x N coverage arrays in 0..1, info dict)."""
    src = Image.open(photo).convert('RGB')
    a = np.asarray(src).astype(np.float64)
    cx, cy, r, border = find_disc(a)
    h, w = a.shape[:2]
    if min(cx - r, cy - r, w - cx - r, h - cy - r) < -0.02 * r:
        # The disc touches the frame (or the border is the vinyl itself): take the inscribed circle instead.
        cx, cy, r = w / 2, h / 2, min(w, h) / 2
    half = min(r * crop, cx, cy, w - cx, h - cy)
    img = src.resize((N, N), Image.LANCZOS, box=(cx - half, cy - half, cx + half, cy + half))
    with np.errstate(all='ignore'):
        lab = srgb_to_oklab(np.asarray(img).astype(np.float64))
    yy, xx = np.mgrid[:N, :N]
    R = np.hypot(xx - N / 2 + .5, yy - N / 2 + .5) / (N / 2)       # 1 = the crop circle
    face = (R > LABEL / crop + 0.04) & (R < 0.99)
    px = lab[face]
    sample = px[np.random.default_rng(1).choice(len(px), min(60000, len(px)), replace=False)]
    cents, lbl = kmeans(sample, max(clusters, accents + 1))
    counts = np.bincount(lbl, minlength=len(cents))
    B = cents[counts.argmax()]
    rest = [i for i in np.argsort(-((cents - B) ** 2).sum(1)) if i != counts.argmax()]
    if accents == 1:
        axes = [cents[rest[0]] - B]
    else:
        # The first pattern colour is the farthest cluster. The second is taken from pixels, not clusters: the
        # 0.5 % of the face that the first colour explains worst. A small, saturated colour (red flecks among
        # black splatter) never gets a cluster of its own; k-means folds it into a muddy in-between one. The
        # first colour only explains pixels on its own side of the base (t >= 0), so a colour lying the other
        # way along the same line (white veins against navy ones on a mid-blue base) still counts as far.
        a1 = cents[rest[0]] - B
        d = px - B
        with np.errstate(all='ignore'):
            t = np.clip(d @ a1 / float(a1 @ a1), 0, None)
            res = np.linalg.norm(d - np.outer(t, a1), axis=1)
        axes = [a1, d[res >= np.percentile(res, 99.5)].mean(0)]
    M = np.stack(axes, 1)                                       # 3 x k
    with np.errstate(all='ignore'):
        w = (lab - B).reshape(-1, 3) @ np.linalg.pinv(M).T      # least-squares weights
    w = np.nan_to_num(w)
    if len(axes) == 2:
        # Non-negative: a light and a dark pattern colour point almost opposite ways from the base, so plain least
        # squares explains a dark pixel as "negative light" and clipping then loses it. Where one weight comes
        # out negative, drop that colour and fit the pixel to the other alone.
        d = (lab - B).reshape(-1, 3)
        for k in (0, 1):
            neg = w[:, k] < 0
            o = 1 - k
            w[neg, k] = 0
            with np.errstate(all='ignore'):
                w[neg, o] = np.clip(d[neg] @ axes[o] / float(axes[o] @ axes[o]), 0, None)
    w = w.reshape(N, N, len(axes))
    layers, patterns = [], []
    for k in range(len(axes)):
        top = float(np.percentile(w[..., k][face], 99.5))
        cov = np.clip(w[..., k] / max(top, 1e-3), 0, 1)
        cov[R > 1.0] = 0
        layers.append(cov)
        patterns.append(oklab_to_hex(B + axes[k] * top))
    t0 = w[..., 0][face]
    base_px = px[np.abs(t0) < 0.08]
    info = {
        'photo': Path(photo).name, 'photoSize': list(src.size),
        'disc': {'cx': round(cx, 1), 'cy': round(cy, 1), 'r': round(r, 1), 'crop': crop,
                 'border': '#' + ''.join(f'{int(v):02x}' for v in border)},
        'base': oklab_to_hex(B), 'patterns': patterns,
        'clusters': [{'hex': oklab_to_hex(c), 'share': round(float(n / counts.sum()), 3)} for c, n in zip(cents, counts)],
        'baseLightnessStd': round(float(base_px[:, 0].std()), 4) if len(base_px) else None,
        'coverage': [{'mean': round(float(c[face].mean()), 3), 'p50': round(float(np.percentile(c[face], 50)), 3),
                      'strong': round(float((c[face] > 0.5).mean()), 3)} for c in layers],
    }
    return layers, info


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('folder', type=Path)
    ap.add_argument('--photo', default='gen.png')
    ap.add_argument('--crop', type=float, default=0.975, help='fraction of the disc radius kept')
    ap.add_argument('--clusters', type=int, default=3)
    ap.add_argument('--accents', type=int, choices=[1, 2], default=1)
    args = ap.parse_args()
    d = args.folder.resolve()
    layers, info = extract(d / args.photo, args.crop, args.clusters, args.accents)
    for k, cov in enumerate(layers):
        Image.fromarray((cov * 255).round().astype(np.uint8)).save(d / f'layer{k + 1}.png')
    info['layers'] = [f'layer{k + 1}.png' for k in range(len(layers))]
    (d / 'extract.json').write_text(json.dumps(info, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(info, ensure_ascii=False))


if __name__ == '__main__':
    main()
