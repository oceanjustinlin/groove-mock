# Record Mockup：给 agent 的操作说明

本目录是一个黑胶唱片 3D 模型工具。`index.html` 既是网页，也是渲染器。agent 通过命令行工具 `cli/record-mockup.mjs` 操作它：写一份 JSON 场景描述（spec），渲染出 PNG，看图后调整参数，再渲染。

不要为了出图去改 `index.html`。所有可调的东西都在 spec 里。

## 准备（只需一次）

```bash
cd cli && npm install
```

需要本机装有 Google Chrome（默认使用）。没有的话，运行 `npx playwright-core install chromium`，之后每条命令加 `--browser chromium`。

## 工作流程

1. 查看可用字段：`node cli/record-mockup.mjs schema`。输出的是 JSON Schema，每个字段都有单位、范围、默认值和中文说明。
2. 写 spec：把 spec 和图片放在同一个目录，图片路径写相对路径。可以从 `examples/2lp-gatefold.json` 改，也可以用 `node cli/record-mockup.mjs init -o spec.json` 生成默认模板。
3. 渲染：`node cli/record-mockup.mjs render spec.json -o out.png --json`。
4. 检查：打开输出的 PNG 看效果，同时看结果里的 `warnings`。
5. 调整：改 spec 后重新渲染。只试一两个参数时，用 `--set path=value`，不用改文件。

结果是单行 JSON：`{"ok":true,"out":…,"width":…,"height":…,"warnings":[…],"ms":…}`。退出码：0 成功；1 出错（看 `error`）；2 在 `--strict` 下有警告。

## 素材不全时：生图 + 排版链路

用户只给了部分素材（比如只有封面）时，按这个顺序补齐。提示词模板在 `prompts/image-prompts.md`。

1. **盘点**：运行 `node cli/record-mockup.mjs slots spec.json`，看当前场景用到哪些贴图位（标 ●）、各自的尺寸、可见区域、遮挡，以及建议做法（用户提供 / 生图 / 排版 / 生图底 + 排版）。
2. **风格卡**：先看封面，按模板第 0 节输出主色和风格描述。后面每条生图提示词都要带上它。
3. **生成底图**：只给建议为"生图"或"生图底 + 排版"的贴图位生成，**底图不能有任何文字**，尺寸按 `slots` 的输出来。
4. **排版文字**：曲目、标题、面号、歌词、Obi、贴纸文案用代码排版（Python 或 HTML 截图都可以），叠到底图上。文字内容来自用户给的信息；用户没给的，用明显的占位文字，不要编造曲目。
5. **出图检查**：`render` 后看图，重点看三件事：重点内容有没有被 Obi、贴纸或编号挡住；文字在 3D 里是否清楚；整套颜色是否协调。
6. **登记来源**：在 spec 的 `meta.assets` 里登记每张图的来源（`user` / `generated` / `typeset` / `composite`；网页曲库搜索取到的图为 `fetched`），生图的写上提示词。最终回复里要说明哪些是示意设计、不是官方素材。

不要生成真实发行的封面。

## spec 速查

单位与面板一致：长度用 mm，比例用 %，角度用度。省略的字段保持默认值。

| 想做的事 | 字段 |
|---|---|
| 换封面、背面、书脊 | `images.front` / `images.back` / `images.spine` |
| 双开及内页 | `jacket.type: "gatefold"`，`images.innerLeft` / `innerRight`，`jacket.gateOpen` 为 0–180 |
| 2LP | `records.count: 2`，`records.disc2.*`，标签用 `images.labelC` / `labelD`。单开时两张叠在同一个口袋；双开时按 `records.layout` 分装：`split`（默认）左右两扇各装一张，第 2 张在左扇（封面）里，打开后向左抽出；`stacked` 两张叠在右扇。第 2 张默认沿用第 1 张的胶色和纹路（`records.disc2.sameAsDisc1: true`）；写了 `disc2` 的 `vinyl` / `color` / `transparency` / `pattern` 就视为分别设置 |
| 胶色 | `records.discN.vinyl`：`black` 纯黑胶（不叠纹路、不透明），`color` 彩胶：`color` 为颜色，`transparency` 为透明度（0–80%）。旧值 `clear` 等于 `color` + `transparency: 38` |
| 彩胶纹路 | `records.discN.pattern.id`（可选值和分类见 `schema`）。底色是 `records.discN.color`。分色类（`split-*`）：`pattern.color` 为第二块，`split-tri` 用 `pattern.color2` 为第三块；主次类：`pattern.color` 为纹路色，其余色层自动推算；同色系：只用底色，`pattern.contrast` 调反差。只在 `vinyl: color` 时生效。`rotation` 旋转纹路。`transparency` 是底色的透明度；主次类可以再用 `pattern.transparency`（0–80%，默认 0）让纹路色和推算出的色层也变透明，底色不透明时纹路会变淡、透出底色。分色类（`transparency` 只作用于第一块）和同色系不使用 `pattern.transparency`，写了会给警告。`pattern.fromCover: true` 从 `images.front` 自动取底色和纹路色，写明的颜色优先 |
| 音轨数 | `records.discN.tracks`：每面音轨数（1–20，默认 6），盘面按等宽分圈，两面相同 |
| 内袋 | `records.sleeve.on` 默认 `false`，不显示内袋，唱片直接从封套抽出；要显示就设为 `true` |
| 抽出程度 | 显示内袋时：`records.discN.sleeveOut`（内袋出封套），`records.discN.recordOut`（唱片出内袋）；不显示内袋时只用 `recordOut`（唱片出封套，100 为完全抽出），`sleeveOut` 会被忽略并给出警告。`insert.out` 为插页 |
| 塑封、贴纸、Obi | `wrap.*`、`sticker.*`、`obi.*`，图片为 `images.sticker` / `images.obi` |
| 限量编号 | `number.current` / `total` / `format` / `place` / `finish` / `font`，自定义字体用 `number.fontFile` |
| 构图 | `camera.view`：quarter / front / side，再用 `zoom`、`azimuth`、`elevation` 微调，用 `panX` / `panY`（mm）平移画面中心；拍背面用 `view: front` + `azimuth: 180` + `panX: -90` |
| 输出 | `output.width` / `height`（px，最大 4096），`output.background`：`"transparent"` 或 `#rrggbb` |
| 视频 / 动图 | `animation.preset`：`turntable` 转一整圈 / `swing` 左右摆 `angle` 度（不露背面）/ `spin` 唱片自转（标签要露出来）/ `gatefold` 双开封面打开再合上（开到 `jacket.gateOpen`，为 0 时 160°）/ `pull` 内袋和唱片抽出再推回（抽到 `sleeveOut` / `recordOut`，都为 0 时用常见值）；`direction` 只用于 turntable 和 swing，`duration`（秒），`aspect`：`16:9` / `1:1` / `9:16`，`size` 短边 px。用 `video spec.json -o x.mp4`（或 `.gif`）出片，构图沿用 `camera.*`，镜头自动拉远到整段不出画。网页工作台的 ▶ 播放同一段动画 |
| 素材来源 | `meta.assets.<贴图位>.source`，渲染器不读，`render` 会在结果的 `assets` 里汇总 |

## 容易踩的点

- `jacket.gateOpen` 大于 0 时，塑封、贴纸和 Obi 视为已拆除，不会出现在图里。
- 双开 2LP（`records.layout: split`）合上时，第 2 张在前面那扇里，会挡住第 1 张：要两张都露出来，让第 1 张抽得比第 2 张多。第 2 张合上时 C 面朝外，打开超过 90° 后翻成 C 面朝上。打开到 90° 左右时，从左扇抽出的唱片会朝镜头转过来，可能出画。
- 插页在内袋后面。`insert.out` 要比内袋的抽出比例大，才看得到插页。
- 抽得很多时，唱片可能跑出画面。可以减小 `recordOut`，或者把 `camera.zoom` 调到 1 以下。
- 只改 `number.place` 时，编号的位置、字高、角度会回到该位置的默认值；只改 `number.finish` 时，颜色会回到该工艺的默认色。要固定这些值，就同时写上对应字段。
- 背面编号的 `number.x` 以从背后看为准，向右为正。
- 换 `pattern.id` 不会改底色：写了 `records.discN.color` 而没写 `pattern.color` 时，纹路色按底色推算；`color` 也没写时，用这款纹路的默认配色。要固定纹路色，就写上 `pattern.color`。
- Obi 图是一张展开图，从左到右依次为背面、书脊、正面。
- 视频不支持透明背景：`output.background` 为 transparent 时会改用纯色并给出警告，出视频时写明背景色。
- `video` 的警告里有 `animation` 相关的（单开封套用 gatefold、自转时标签被挡住），说明这段动画看不出效果，先改场景再出片。
- 转台会转到背面，没给 `images.back` 时出现的是示例图；没有背面素材就用 `animation.preset: "swing"`。
- 检查视频时不要看第一帧就算数：GIF 和 MP4 都要抽几帧看（比如 0、1/4、1/2、3/4 处），确认转到侧面和背面时没有穿帮。
- 批量出编号图：`node cli/record-mockup.mjs numbers spec.json --from 1 --to 50 --dir out/`。
