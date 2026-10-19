# 素材生图提示词模板

给 agent 补齐缺失素材时使用。核心规则：**生图模型只画底图，不画任何文字**。曲目表、厂牌、标题、面号、歌词这类文字，全部用代码排版后叠到底图上。

每条生图提示词由三段拼成：**风格卡 + 贴图位模板 + 统一禁止项**。提示词用英文写，生图模型对英文的遵循度更高。

各贴图位的尺寸、可见区域和遮挡，以 `node cli/groove-mock.mjs slots spec.json` 的输出为准。下面写的尺寸是默认值。

## 0. 风格卡（先做，不是生图）

用 agent 自己的看图能力读封面，输出一份 JSON，后面每条提示词都要引用它。

```text
Analyze this album cover. Return JSON with:
palette (5 hex colors, dominant first), medium (photo / illustration / graphic / collage),
texture, lighting, mood (3 words), motifs (recurring shapes or subjects, max 4).
Describe only what is visible; do not invent.
```

如果生图工具支持参考图，把封面作为风格参考一起传入。

## 统一禁止项（每条提示词末尾都加）

```text
Flat, straight-on, full-bleed artwork filling the entire canvas.
No text, no letters, no numbers, no logos, no watermark, no border, no frame,
no mockup, no perspective, no hands, no vinyl record or sleeve objects.
```

## 1. 封套背面底图

1:1，2048 × 2048。Obi 打开时会盖住右侧（从背后看），编号默认在右下角。

```text
Back cover background artwork for a vinyl record, companion to this front cover: {style card}.
Same palette, medium and texture, but quieter and less detailed than the front.
Keep a calm, low-contrast area over the left two-thirds for a tracklist overlay;
visual interest may sit along the bottom edge and lower-right corner.
{禁止项}
```

排版层：专辑名、曲目表（A/B 面分组，带时长）、厂牌、编号文字、条码占位。

## 2. 唱片标签底图

1:1，1024 × 1024。只显示内切圆（Ø100 mm），正中 Ø7.24 mm 是中孔。

```text
Circular record label artwork, seen exactly top-down, centered, filling a perfect circle
that touches all four canvas edges. Simple graphic design: a solid field of {palette[0]}
with one subtle motif derived from {motifs}. Keep the center plain for a spindle hole.
Areas outside the circle plain {palette[0]}.
{禁止项}
```

排版层：专辑名（上半圈）、SIDE A / B / C / D（下半圈）、33⅓ RPM、编号。A/B 两面可以用同一张底图配不同的面号，也可以分别换主色。

## 3. 双开内页跨页

先生成 2:1 的整张跨页（4096 × 2048），再从中间切成 innerLeft、innerRight 两张方图。

```text
Wide gatefold interior spread for a vinyl record, {style card}.
One continuous scene across both halves. Keep the exact vertical center line free of faces
and key subjects because the fold sits there. Leave the right half calmer for a lyrics overlay.
{禁止项}
```

排版层：右页放歌词或制作名单，左页可以不放文字。

## 4. 插页底图

1:1，2048 × 2048，正反两面。

```text
Printed insert background for a vinyl record, {style card}.
Mostly calm, low-contrast surface suitable for dense small text; one quiet visual accent near a corner.
{禁止项}
```

排版层：歌词、制作名单、致谢。

## 5. 内袋印刷底纹

1:1，2048 × 2048。中心 Ø90 mm 会被挖空。

```text
Subtle repeating paper texture pattern inspired by {motifs}, {palette[1]} on {palette[3]},
very low contrast, suitable as a printed inner sleeve background.
{禁止项}
```

一般不排文字。

## 不生图的贴图位

| 贴图位 | 做法 |
|---|---|
| front 封面 | 用用户提供的正式封面。真实发行不要生成封面 |
| spine 书脊 | 取风格卡主色做底，竖排专辑名和编号（64 × 4096 px） |
| obi 侧标 | 纯排版：展开图从左到右为背面、书脊、正面，宽度看 `slots` 输出 |
| sticker 贴纸 | 纯排版：卖点文案，如首版、限定、彩胶 |

## 来源登记（必做）

每用一张图，都要在 spec 的 `meta.assets` 里登记来源：

```json
"meta": {
  "title": "Absolution 2LP 预售图",
  "assets": {
    "front": {"source": "user"},
    "back": {"source": "composite", "tool": "image model + compose.py", "prompt": "Back cover background artwork…", "note": "示意设计，非官方背面"},
    "labelA": {"source": "composite", "tool": "image model + compose.py"}
  }
}
```

`source` 可选值：`user`、`generated`、`typeset`、`composite`、`sample`。没登记的图，`render` 会给出警告。最终交付时，在说明里写清哪些是示意设计、不是官方素材。
