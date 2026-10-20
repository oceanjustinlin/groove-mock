#!/usr/bin/env python3
"""Run the photo-variant route for vinyl masks (docs/vinyl-mask-image-to-image-workflow.md, section 4).

  python3 tools/vinyl-gen.py new marble-p132 --ref refs/p132.jpg --url https://www.pinterest.com/pin/... [--accents 2] [--role layout]
  python3 tools/vinyl-gen.py gen marble-p132 [more ids] [-j 2]     # Codex: ref.jpg + prompt.txt -> gen.png
  python3 tools/vinyl-gen.py post marble-p132 [more ids]           # extract, bake into the review library, 3D, review sheet

Each candidate is a folder under output/texture-gen/masters/<id> (ignored) holding ref.jpg, prompt.txt, job.json and,
once generated, gen.png. job.json carries what used to be guessed from the id: the reference URL, how many pattern
colours to unmix, and the role. `gen` skips folders that already have gen.png; move the old one into attempts/ first
to regenerate. Nothing here touches the live vinyl-masks library: promote accepted masks with bake-vinyl-masks.py.
"""
import argparse, json, shutil, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
G = ROOT / 'output/texture-gen'
FONT = '/System/Library/Fonts/STHeiti Medium.ttc'

# Few words on purpose: wording about direction or shape steered the model wrong more often than the reference did
# (radial "petals" and "swirls" on ring marbles). The reference carries the look; the text only fixes the shot.
PROMPT = """附图是一张彩胶唱片照片。

请生成一张新的产品照片：和附图同一批次压出来的另一张唱片。材料、颜色和压片工艺完全相同，纹路的样子和附图一致，只是具体排布不同。

拍摄要求：
- 严格正俯拍，相机正对中心孔，无透视，唱片是正圆，居中，直径约占画面边长的 92%。
- 背景是均匀的纯中灰色。
- 光线均匀漫射，没有高光、反光条和暗角；看不到沟槽。
- 中心标签是完全空白的浅色哑光纸，没有文字或图案。
- 没有手、封套、道具、文字或水印。
"""
CODEX_TASK = ("The attached image is ref.jpg. Read prompt.txt and use your image generation tool, with the attached image "
              "as the input reference, to produce exactly the photo prompt.txt describes. Copy the generated image, "
              "unmodified, into the current directory as gen.png. Reply with the path and pixel size only.")


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT, **kw)
    if r.returncode:
        raise RuntimeError(f'{" ".join(map(str, cmd[:3]))} failed:\n{r.stderr[-1500:]}')
    return r.stdout


def job(mid):
    d = G / 'masters' / mid
    if not (d / 'job.json').exists():
        sys.exit(f'{mid}: no job.json in {d}; create it with `new`')
    return d, json.loads((d / 'job.json').read_text())


def cmd_new(a):
    d = G / 'masters' / a.id
    d.mkdir(parents=True, exist_ok=True)
    shutil.copy(a.ref, d / 'ref.jpg')
    if not (d / 'prompt.txt').exists():
        (d / 'prompt.txt').write_text(PROMPT)
    role = a.role or ('effect' if a.id.startswith(('smoke', 'splatter', 'starburst')) else 'layout')
    (d / 'job.json').write_text(json.dumps({'reference': a.url, 'accents': a.accents, 'role': role,
                                            'palette': a.palette}, ensure_ascii=False, indent=2) + '\n')
    print(d)


def gen_one(mid):
    d, _ = job(mid)
    if (d / 'gen.png').exists():
        return f'skip {mid} (gen.png exists)'
    with open(d / 'codex.log', 'w') as log:
        subprocess.run(['codex', 'exec', '--skip-git-repo-check', '-s', 'workspace-write', '-C', str(d), CODEX_TASK,
                        '-i', str(d / 'ref.jpg')], stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
    if (d / 'gen.png').exists():
        return f'done {mid}'
    tail = [l for l in (d / 'codex.log').read_text().splitlines() if l.startswith('ERROR')]
    return f'FAILED {mid}: {tail[-1] if tail else "no gen.png, see codex.log"}'


def cmd_gen(a):
    with ThreadPoolExecutor(a.j) as ex:
        for msg in ex.map(gen_one, a.ids):
            print(msg)


def scene(mid, base, view):
    s = {'version': 1, 'jacket': {'type': 'single'},
         'images': {'front': 'cover-neutral.png', 'labelA': 'label-neutral.png'},
         'meta': {'assets': {k: {'source': 'typeset', 'note': 'Neutral review placeholder'} for k in ('front', 'labelA')}},
         'records': {'count': 1, 'sleeve': {'on': False},
                     'disc1': {'vinyl': 'color', 'color': base, 'recordOut': 100 if view == 'front' else 88, 'pattern': {'id': mid}}},
         'obi': {'on': False}, 'wrap': {'on': False}, 'sticker': {'on': False}, 'number': {'on': False}}
    if view == 'front':
        s['camera'] = {'view': 'front', 'zoom': 1.4, 'panX': 300}
        s['output'] = {'width': 1200, 'height': 1200, 'background': '#eeece7'}
    else:
        s['camera'] = {'view': 'quarter', 'zoom': 0.72}
        s['output'] = {'width': 1400, 'height': 1000, 'background': '#eeece7'}
    p = G / f'scene-{mid}-{view}.json'
    p.write_text(json.dumps(s, indent=2))
    return p


def placeholders():
    """Neutral cover and label for the review scenes (typeset, no text worth reading)."""
    from PIL import Image, ImageDraw
    if not (G / 'cover-neutral.png').exists():
        im = Image.new('RGB', (800, 800), '#dedbd3')
        dr = ImageDraw.Draw(im)
        dr.text((65, 80), 'VINYL / MATERIAL STUDY', fill='#393e40', font_size=32)
        dr.text((65, 135), 'LOCAL TEXTURE REVIEW', fill='#676b6c', font_size=20)
        im.save(G / 'cover-neutral.png')
    if not (G / 'label-neutral.png').exists():
        im = Image.new('RGB', (600, 600), '#e9e5db')
        dr = ImageDraw.Draw(im)
        dr.text((170, 190), 'MASK STUDY', fill='#393e40', font_size=32)
        dr.text((205, 365), 'SIDE / A', fill='#676b6c', font_size=22)
        im.save(G / 'label-neutral.png')


def sheet(mid, d, ex, qc):
    from PIL import Image, ImageDraw, ImageFont
    F, f = ImageFont.truetype(FONT, 20), ImageFont.truetype(FONT, 16)
    S = 560
    sq = lambda p, box=None: (Image.open(p).convert('RGB').crop(box) if box else Image.open(p).convert('RGB')).resize((S, S), Image.LANCZOS)
    tiles = [(sq(d / 'ref.jpg'), '参考'), (sq(d / 'gen.png'), 'Codex 生成的照片'),
             (sq(G / 'renders' / f'{mid}-front.png', (150, 150, 1050, 1050)), '提取后 正面 3D')]
    W = 3 * S + 40
    q = Image.open(G / 'renders' / f'{mid}-quarter.png').convert('RGB')
    qh = int((W - 20) * 0.43)
    q = q.crop((0, int(q.height * 0.2), q.width, int(q.height * 0.2) + int(q.width * qh / (W - 20))))
    out = Image.new('RGB', (W, 40 + S + 50 + qh + 50), 'white')
    dr = ImageDraw.Draw(out)
    for i, (t, n) in enumerate(tiles):
        out.paste(t, (10 + i * (S + 10), 40))
        dr.text((14 + i * (S + 10), 8), n, fill='#000', font=F)
    out.paste(q.resize((W - 20, qh)), (10, 40 + S + 50))
    dr.text((14, 40 + S + 16), f'{mid}  斜 45°', fill='#000', font=F)
    note = f"底胶 {ex['base']}  纹路 {' '.join(ex['patterns'])}  相似度 {qc['similarityNcc']:.2f}（描摹阈值 0.7）"
    dr.text((14, 40 + S + 50 + qh + 14), note, fill='#333', font=f)
    p = G / 'boards' / f'{mid}-review.jpg'
    out.save(p, quality=88)
    return p


def cmd_post(a):
    placeholders()
    (G / 'renders').mkdir(exist_ok=True)
    for mid in a.ids:
        d, j = job(mid)
        if not (d / 'gen.png').exists():
            print(f'skip {mid}: no gen.png')
            continue
        ex = json.loads(run(['python3', 'tools/vinyl-photo-extract.py', str(d), '--accents', str(j.get('accents', 1))]))
        qc = ['python3', 'tools/vinyl-gen-qc.py', str(d), '--master', ','.join(ex['layers']),
              '--palette', j.get('palette', 'tonal'), '--role', j.get('role', 'layout')]
        if j.get('reference'):
            qc += ['--ref-url', j['reference']]
        run(qc)
        for view in ('front', 'quarter'):
            run(['node', 'cli/record-mockup.mjs', 'render', str(scene(mid, ex['base'], view)), '--page', str(G / 'index.html'),
                 '-o', str(G / 'renders' / f'{mid}-{view}.png'), '--strict', '--json'])
        out = json.loads(run(qc + ['--render', str(G / 'renders' / f'{mid}-front.png')]).strip().splitlines()[-1])
        print(json.dumps({'id': mid, 'base': ex['base'], 'patterns': ex['patterns'], 'similarity': out['similarityNcc'],
                          'flags': out['flags'], 'sheet': str(sheet(mid, d, ex, out).relative_to(ROOT))}, ensure_ascii=False))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    n = sub.add_parser('new', help='create a candidate folder from a reference photo')
    n.add_argument('id')
    n.add_argument('--ref', type=Path, required=True)
    n.add_argument('--url', help='where the reference came from (pin, licence page)')
    n.add_argument('--accents', type=int, choices=[1, 2], default=1)
    n.add_argument('--role', choices=['layout', 'effect'])
    n.add_argument('--palette', choices=['tonal', 'accent'], default='tonal')
    g = sub.add_parser('gen', help='generate gen.png with Codex')
    g.add_argument('ids', nargs='+')
    g.add_argument('-j', type=int, default=1, help='parallel Codex runs (default 1)')
    p = sub.add_parser('post', help='extract, bake for review, render, write the review sheet')
    p.add_argument('ids', nargs='+')
    a = ap.parse_args()
    {'new': cmd_new, 'gen': cmd_gen, 'post': cmd_post}[a.cmd](a)


if __name__ == '__main__':
    main()
