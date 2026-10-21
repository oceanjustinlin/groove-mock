#!/usr/bin/env python3
"""Bake mask masters into runtime vinyl pattern masks for Record Mockup.

Masters stay outside the repo, one folder per mask id under --src, in either of two forms:
- VinylLab sets: 16-bit field.png + RGB layers.png (R/G/B = accent1..3) + meta.json, where the
  disc fills meta.disc_frac of the width and meta.cluster_colors holds the default palette.
- Grayscale layers (e.g. image-to-image output): one single-channel PNG per accent, listed in the
  CURATED entry's `layers`, square, with the pattern filling the whole canvas (the disc is the
  inscribed circle). A grayscale file carries no colours, so the entry states `base` and `colors`.
Each baked mask holds the accent1..3 soft masks, cropped so the disc fills the square exactly: that matches
the record face UVs in index.html (remapUV(face, r*2)). They are stacked as one greyscale WebP (see
save_mask); the page unstacks them into the R/G/B channels it composites from. Alpha is never used for
packing, because canvas premultiplies it and would wipe RGB where A = 0.

  python3 tools/bake-vinyl-masks.py --src <masters root, e.g. ~/Documents/VinylLab/assets/masks> [--size 1024] [--preview DIR] [ids...]

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
# layers / base / colors / source: grayscale masters only (see the module docstring); `source` may carry
#   provenance such as {"prompt": ..., "model": ..., "date": ...} and is copied into the manifest.
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
    'swirl-02': {'role': 'layout', 'palette': 'accent', 'status': 'review'},
    # Smoke: photo variants of unlicensed references, colour-extracted (docs/vinyl-mask-image-to-image-workflow.md
    # sections 3, 4.1, 4.2). Each master folder also keeps ref.jpg, gen.png, prompt.txt and extract.json.
    'smoke-01': {'role': 'effect', 'palette': 'tonal', 'layers': ['layer1.png'], 'base': '#bdbdc3', 'colors': ['#323031'],
                 'source': {'kind': 'unlicensed-reference', 'operation': 'photo variant + colour extraction', 'date': '2026-10-20',
                            'master': 'output/texture-gen/library/smoke-01', 'reference': 'https://www.pinterest.com/pin/475129829451470170/',
                            'referenceSha256': '3670d98e6e26ea331f9829bca7bafc2e106a17e431fb0629eb1d76ab5926aecf',
                            'generatedSha256': '4f058509e5c80e0a5b153db27eae44fd44a0ae2e6f31967e25d9631a497e7c4c'}},
    'smoke-02': {'role': 'effect', 'palette': 'tonal', 'layers': ['layer1.png'], 'base': '#cec5b1', 'colors': ['#7d7467'],
                 'source': {'kind': 'unlicensed-reference', 'operation': 'photo variant + colour extraction', 'date': '2026-10-20',
                            'master': 'output/texture-gen/library/smoke-02', 'reference': 'https://www.pinterest.com/pin/337488565839430032/',
                            'referenceSha256': '5862536036eff71a94eaca41bf6d90b3eb84e061be597f029bc8d5249db22257',
                            'generatedSha256': 'babe8ce350ec3a03efc8758aadcc69959dc1ab7c45e2b83e6d52c5863918a9c5'}},
    'smoke-03': {'role': 'effect', 'palette': 'tonal', 'layers': ['layer1.png'], 'base': '#750d16', 'colors': ['#2a090d'],
                 'source': {'kind': 'unlicensed-reference', 'operation': 'photo variant + colour extraction', 'date': '2026-10-20',
                            'master': 'output/texture-gen/library/smoke-03', 'reference': 'https://www.pinterest.com/pin/989666086837708902/',
                            'referenceSha256': '6d132852b227a2b483eba37abacac519d73665d08adfa17f2cad6908ca5d664a',
                            'generatedSha256': '2de879ab99df51aec9d078e4913e72b63ac978cd8e6d6105c1d395e506e38473'}},
    'smoke-04': {'role': 'effect', 'palette': 'tonal', 'layers': ['layer1.png'], 'base': '#024f4d', 'colors': ['#03171c'],
                 'source': {'kind': 'unlicensed-reference', 'operation': 'photo variant + colour extraction', 'date': '2026-10-20',
                            'master': 'output/texture-gen/library/smoke-04', 'reference': 'https://www.pinterest.com/pin/449445237833759225/',
                            'referenceSha256': 'da7abd33e6e973d5e18a6dbc083fa7f522f7b5a5afb803ca4faf32f6bbcc6b41',
                            'generatedSha256': 'f9ae6fdaec893aad0b5036ee6b57ffd876de18e3c6ffc77d472b52ba508670bf'}},
    # Marble: same route as smoke; two pattern colours unmixed from one photo (vinyl-photo-extract.py --accents 2).
    'marble-01': {'role': 'layout', 'palette': 'tonal', 'layers': ['layer1.png', 'layer2.png'], 'base': '#78acd7',
                  'colors': ['#002885', '#e8f6ff'],
                  'source': {'kind': 'unlicensed-reference', 'operation': 'photo variant + colour extraction', 'date': '2026-10-20',
                             'master': 'output/texture-gen/library/marble-01', 'reference': 'https://www.pinterest.com/pin/648377677607525707/',
                             'referenceSha256': '9fb279c49e0226f1dbd862e856af6c8e015c0da8e06f472dd235eb2381dc31fa',
                             'generatedSha256': '2972051cf3d632871ba41e36dd4583dce3f48f9855e2e8dbe087fd8da4f8a9d1'}},
    'marble-02': {'role': 'layout', 'palette': 'tonal', 'layers': ['layer1.png'], 'base': '#bfbfbe', 'colors': ['#4e4d4e'],
                 'source': {'kind': 'unlicensed-reference', 'operation': 'photo variant + colour extraction', 'date': '2026-10-21',
                            'master': 'output/texture-gen/library/marble-02', 'reference': 'https://www.pinterest.com/pin/706150416610423251/',
                            'referenceSha256': 'f3769adad97ac5de717c94bc96a569181d5b0e5240d299d14a29a876368ae054',
                            'generatedSha256': 'a415441391dd4ac80105ead105da4c20f7d0c5498455db3f1adcc6a61bb3854d'}},
    'marble-03': {'role': 'layout', 'palette': 'accent', 'layers': ['layer1.png', 'layer2.png'], 'base': '#750911', 'colors': ['#ff635e', '#080001'],
                 'source': {'kind': 'unlicensed-reference', 'operation': 'photo variant + colour extraction', 'date': '2026-10-21',
                            'master': 'output/texture-gen/library/marble-03', 'reference': 'https://www.pinterest.com/pin/801570433726270588/',
                            'referenceSha256': '951e08c607087c600c60aaccdfc91ed99998582c0416134d634c6fa21685debd',
                            'generatedSha256': 'e2744a0aa688066b0c54a608e09d282ea1dc0bb3dcaa5ed82f52bfead4012d87'}},
    'marble-04': {'role': 'layout', 'palette': 'tonal', 'layers': ['layer1.png'], 'base': '#36a4d4', 'colors': ['#92bdd9'],
                 'source': {'kind': 'unlicensed-reference', 'operation': 'photo variant + colour extraction', 'date': '2026-10-21',
                            'master': 'output/texture-gen/library/marble-04', 'reference': 'https://www.pinterest.com/pin/660621839101132217/',
                            'referenceSha256': 'c15276a7c770f033353ac2c6d4a13cc7d49269e51aebf4f556bcb4420e2aebb5',
                            'generatedSha256': '55efb8160b28ac57f03395083f08185671462ce3642269c213d2e18a2ddb8620'}},
    'splatter-09': {'role': 'effect', 'palette': 'accent', 'layers': ['layer1.png', 'layer2.png'], 'base': '#e4bc6e', 'colors': ['#e31c21', '#000000'],
                   'source': {'kind': 'unlicensed-reference', 'operation': 'photo variant + colour extraction', 'date': '2026-10-21',
                              'master': 'output/texture-gen/library/splatter-09', 'reference': 'https://www.pinterest.com/pin/27866091425467164/',
                              'referenceSha256': 'd3e0a7ced8002863ed23f6b01b0621c810991bbda60852aae2ab3996a85af7d5',
                              'generatedSha256': '042ee1a4847fbc63695c75faf2dabb2668a3a75a90a89751164ebb783ade77f1'}},
    'splatter-10': {'role': 'effect', 'palette': 'accent', 'layers': ['layer1.png'], 'base': '#dc1e35', 'colors': ['#d8d46e'],
                   'source': {'kind': 'unlicensed-reference', 'operation': 'photo variant + colour extraction', 'date': '2026-10-21',
                              'master': 'output/texture-gen/library/splatter-10', 'reference': 'https://www.pinterest.com/pin/4591701416808519936/',
                              'referenceSha256': 'ccde274329b2739c6dfd49c241b8f35d74b48db2dab2bd917b763dc97acb1b0b',
                              'generatedSha256': '57c59d477dd417a60a87435e7050d5a7a3554c0961083665c63376ee1e27b6b4'}},
    'splatter-11': {'role': 'effect', 'palette': 'accent', 'layers': ['layer1.png'], 'base': '#f49c25', 'colors': ['#050b13'],
                   'source': {'kind': 'unlicensed-reference', 'operation': 'photo variant + colour extraction', 'date': '2026-10-21',
                              'master': 'output/texture-gen/library/splatter-11', 'reference': 'https://www.pinterest.com/pin/660621839101555565/',
                              'referenceSha256': '28880a69256f4bfd8a125a8240350a8915099707f86dbeec845a84bceb5b411f',
                              'generatedSha256': '54700b9fc80f48b270112794fb7ec072b147cf88616130c38e64f8a3710d9395'}},
    'swirl-03': {'role': 'layout', 'palette': 'accent', 'layers': ['layer1.png', 'layer2.png'], 'base': '#537df5', 'colors': ['#ffb7f5', '#0429b5'],
                'source': {'kind': 'unlicensed-reference', 'operation': 'photo variant + colour extraction', 'date': '2026-10-21',
                           'master': 'output/texture-gen/library/swirl-03', 'reference': 'https://www.pinterest.com/pin/687010118200326285/',
                           'referenceSha256': '35c74041f55853ecae4eacf0d56dc82b43a39fdc02a86dbf076a3e40bd07ad3a',
                           'generatedSha256': '7840f9dfaa5409af9f7004e15efd74d0aaf8ef4fa3ce161b9d15cc8d87155429'}},
    'blob-04': {'role': 'layout', 'palette': 'accent', 'layers': ['layer1.png'], 'base': '#f3761a', 'colors': ['#34bbe3'],
               'source': {'kind': 'unlicensed-reference', 'operation': 'photo variant + colour extraction', 'date': '2026-10-21',
                          'master': 'output/texture-gen/library/blob-04', 'reference': 'https://www.pinterest.com/pin/294774738132093067/',
                          'referenceSha256': '42b65bc7485927ff4e1dd0a096e7c76a4c4d180ef07beaaa9f44b8deea64e22b',
                          'generatedSha256': '8f9b9aef603972fde0e29b48a038ee615106b03995ad316f8b0907921a77d8cf'}},
    'blob-05': {'role': 'layout', 'palette': 'tonal', 'layers': ['layer1.png', 'layer2.png'], 'base': '#0034b8', 'colors': ['#e4ecec', '#000c9f'],
               'source': {'kind': 'unlicensed-reference', 'operation': 'photo variant + colour extraction', 'date': '2026-10-21',
                          'master': 'output/texture-gen/library/blob-05', 'reference': 'https://www.pinterest.com/pin/891431319970866278/',
                          'referenceSha256': '84dbe335210957dabf5a645ecc593188eb3eb1d3794dd3bf191e2473e33b65ce',
                          'generatedSha256': '0cfe1aeb463147e7d017a99e681a4195a0eb7975c2079b8c692f32abe22bcf69'}},
    'smoke-05': {'role': 'effect', 'palette': 'tonal', 'layers': ['layer1.png'], 'base': '#0154b1', 'colors': ['#023183'],
                'source': {'kind': 'unlicensed-reference', 'operation': 'photo variant + colour extraction', 'date': '2026-10-21',
                           'master': 'output/texture-gen/library/smoke-05', 'reference': 'https://www.pinterest.com/pin/447404544202932227/',
                           'referenceSha256': '2bcc4b7025e6934c9300023cf5da7eae77bbf7a8c91ce428ffc57054e416d873',
                           'generatedSha256': '79379cd06300afb11c31a6531bedbd9e513ce431a09f330a3bdefea746fab22e'}},
    'starburst-07': {'role': 'effect', 'palette': 'tonal', 'layers': ['layer1.png', 'layer2.png'], 'base': '#01153e', 'colors': ['#e6e9e8', '#187ba2'],
                    'source': {'kind': 'unlicensed-reference', 'operation': 'photo variant + colour extraction', 'date': '2026-10-21',
                               'master': 'output/texture-gen/library/starburst-07', 'reference': 'https://www.pinterest.com/pin/981573681287214589/',
                               'referenceSha256': '8dacbdb4ed11155d5970cddf7dae5cc41879c77e1c3ae5d1e7b7747c4b3a5de8',
                               'generatedSha256': '9d22a3fef06694086d299fdf2620166afd33f1aa33e48914a2be959853f14229'}},
    'pinwheel-02': {'role': 'layout', 'palette': 'accent', 'layers': ['layer1.png', 'layer2.png'], 'base': '#e1087c', 'colors': ['#ffc000', '#ec0f16'],
                   'source': {'kind': 'unlicensed-reference', 'operation': 'photo variant + colour extraction', 'date': '2026-10-21',
                              'master': 'output/texture-gen/library/pinwheel-02', 'reference': 'https://www.pinterest.com/pin/91479436177557268/',
                              'referenceSha256': 'bd8201edccd3cea2ddaac38fb8b0927a42626ebb3bb9d16e21e0927efbe911b7',
                              'generatedSha256': '2e09eb8cf3e3bc115d079ae640a6c7c7f94bc9318f9ec72397176621268583b1'}},
    'pinwheel-03': {'role': 'layout', 'palette': 'tonal', 'layers': ['layer1.png', 'layer2.png'], 'base': '#4b0b1b', 'colors': ['#f6e5f3', '#e1338c'],
                   'source': {'kind': 'unlicensed-reference', 'operation': 'photo variant + colour extraction', 'date': '2026-10-21',
                              'master': 'output/texture-gen/library/pinwheel-03', 'reference': 'https://www.pinterest.com/pin/836965912045205685/',
                              'referenceSha256': 'aae7ee6badddf04881afa19356a5277f780a12f5a638607a1d0032417a3ed22b',
                              'generatedSha256': '413499ac03a06a24f85d0c39b6de7267339999eb668edfb203c95f3c1e9d5284'}},
    'ripple-01': {'role': 'layout', 'palette': 'tonal', 'layers': ['layer1.png', 'layer2.png'], 'base': '#90c9b9', 'colors': ['#eef0e1', '#538a85'],
                 'source': {'kind': 'unlicensed-reference', 'operation': 'photo variant + colour extraction', 'date': '2026-10-22',
                            'master': 'output/texture-gen/library/ripple-01', 'reference': 'https://www.pinterest.com/pin/884464814351029201/',
                            'referenceSha256': '3da1a351d89f770250bcfbdaf64ba3f5140da731a0fc8e0687f4fd3fbfa8dc73',
                            'generatedSha256': '8d1c40fd180b4b5b222e598c75049c12c40760df5c079294992a1d6b06cc11e7'}},
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


def crop_resize(img: Image.Image, frac: float, size: int) -> np.ndarray:
    """Centre square of `frac` x the image width, resampled to size x size, as floats in 0..1."""
    n = img.width
    side = n * frac
    box = ((n - side) / 2, (n - side) / 2, (n + side) / 2, (n + side) / 2)
    return np.asarray(img.resize((size, size), Image.LANCZOS, box=box)).astype(np.float32) / 255


def load_vinyllab(src_dir: Path, mask_id: str, cfg: dict, size: int):
    """A VinylLab set: RGB layers cropped to the safe disc. Returns (layers, base, colors, crop, extra)."""
    meta = json.loads((src_dir / 'meta.json').read_text())
    layers = Image.open(src_dir / 'layers.png').convert('RGB')
    if layers.height != layers.width:
        raise ValueError(f'{mask_id}: layers.png is not square ({layers.size})')
    crop = cfg.get('crop', CROP)
    arr = crop_resize(layers, float(meta['disc_frac']) * crop - SEAM_INSET, size)
    colors = meta.get('cluster_colors') or []
    if len(colors) < 2:
        raise ValueError(f'{mask_id}: meta.json has no cluster_colors to use as the default palette')
    extra = {'labelRadius': meta.get('label_radius'),
             'source': {'kind': 'generated', 'master': f'VinylLab/assets/masks/{mask_id}', 'file': meta.get('source')}}
    return arr, colors[0], colors[1:], crop, extra


def load_gray(src_dir: Path, mask_id: str, cfg: dict, size: int):
    """Grayscale layers, one file per accent, all the same square size; the pattern fills the canvas, so
    nothing is cropped unless the entry asks for it. Returns (layers, base, colors, crop, extra)."""
    files = cfg['layers']
    if not 1 <= len(files) <= 3:
        raise ValueError(f'{mask_id}: layers lists {len(files)} files; 1 to 3 are supported')
    if 'base' not in cfg or len(cfg.get('colors', [])) != len(files):
        raise ValueError(f'{mask_id}: a grayscale entry needs base plus one colour per layer ({len(files)})')
    crop = cfg.get('crop', 1.0)
    arr = np.zeros((size, size, 3), np.float32)
    first = None
    for c, name in enumerate(files):
        img = Image.open(src_dir / name)
        if img.width != img.height:
            raise ValueError(f'{mask_id}/{name}: not square ({img.size}); fix the geometry, do not stretch it')
        if first is None:
            first = img.size
        elif img.size != first:
            raise ValueError(f'{mask_id}/{name}: {img.size} differs from the first layer {first}; layers must share one canvas')
        if 'A' in img.getbands() and img.getchannel('A').getextrema()[0] < 255:
            raise ValueError(f'{mask_id}/{name}: has transparent pixels; masks must be opaque')
        if img.mode not in ('L', 'I;16', 'I'):
            rgb = np.asarray(img.convert('RGB')).astype(np.int16)
            tint = int((rgb.max(axis=2) - rgb.min(axis=2)).max())
            if tint > 16:
                print(f'warning: {mask_id}/{name} is not grayscale (channels differ by up to {tint}); using its luminance',
                      file=sys.stderr)
        # Resample in float ('F') on a 0..255 scale, so 16-bit masters keep their precision until packing.
        deep = img.mode.startswith('I')
        g = np.asarray(img if deep else img.convert('L')).astype(np.float32) * (255 / 65535 if deep else 1)
        arr[..., c] = crop_resize(Image.fromarray(g, mode='F'), crop, size)
    source = {'kind': 'generated', 'master': f'masters/{mask_id}', 'file': files, **cfg.get('source', {})}
    if (src_dir / 'prompt.txt').exists():
        # The full prompt lives beside the master rather than in this table.
        source['prompt'] = (src_dir / 'prompt.txt').read_text().strip()
    return arr, cfg['base'], list(cfg['colors']), crop, {'labelRadius': None, 'source': source}


def bake(src_dir: Path, mask_id: str, size: int):
    cfg = CURATED[mask_id]
    loader = load_gray if 'layers' in cfg else load_vinyllab
    arr, base, colors, crop, extra = loader(src_dir, mask_id, cfg, size)
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

    # Corners outside the disc are never visible; blank them (keeping a filtering margin) to shrink the file.
    arr[r > 1.01] = 0
    arr = np.round(arr * 255).astype(np.uint8)
    channels = [c for c in range(3) if arr[..., c].max() > 8]
    if not channels:
        raise ValueError(f'{mask_id}: every layer is empty')
    if channels != list(range(len(channels))):
        raise ValueError(f'{mask_id}: accent channels are not contiguous from R ({channels})')

    OUT.mkdir(exist_ok=True)
    save_mask(arr, len(channels), OUT / f'{mask_id}.webp')

    mode = cfg['palette']
    accents = colors[:len(channels)]
    params = derive_params(mode, base, accents)
    return {
        'id': mask_id,
        'family': mask_id.rsplit('-', 1)[0],
        'role': cfg['role'],
        'file': f'{mask_id}.webp',
        'thumb': f'thumbs/{mask_id}.jpg',
        'size': size,
        'accents': len(channels),
        # The base colour, then one colour per accent channel in channel order.
        'base': base,
        'colors': accents,
        'palette': {'mode': mode, 'derive': params},
        'labelRadius': extra['labelRadius'],
        'source': extra['source'],
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


# The page downloads a mask the first time it is picked, so the file is kept small: the accent channels are
# stacked top to bottom as one greyscale image (size x size*accents) and saved as lossy WebP. Greyscale keeps
# the channels apart (a colour WebP's chroma subsampling would bleed one layer into the next); at q90 the mean
# error is about 1/255, a third of the lossless PNG's size. loadMask() in index.html unstacks it the same way.
def save_mask(arr: np.ndarray, accents: int, dest: Path):
    Image.fromarray(np.concatenate([arr[..., c] for c in range(accents)], 0)).save(dest, quality=90, method=6)


def unstack(path: Path, accents: int) -> np.ndarray:
    g = np.asarray(Image.open(path).convert('L'))
    n = g.shape[1]
    out = np.zeros((n, n, 3), np.uint8)
    for c in range(accents):
        out[..., c] = g[c * n:(c + 1) * n]
    return out


def load(entry: dict) -> np.ndarray:
    return unstack(OUT / entry['file'], entry['accents']).astype(np.float32) / 255


def thumb(entry: dict):
    """Panel picker thumbnail in the mask's own palette; the page crops it to a circle."""
    img = Image.fromarray(unstack(OUT / entry['file'], entry['accents'])).resize((THUMB, THUMB), Image.LANCZOS)
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
    ap.add_argument('--src', type=Path, required=True, help='masters root: one folder per mask id')
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
        need = CURATED[mask_id].get('layers') or ('meta.json', 'layers.png')
        missing = [f for f in need if not (d / f).exists()]
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
