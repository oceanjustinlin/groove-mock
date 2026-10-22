# record-mockup CLI

用一份 JSON 场景描述（spec）渲染黑胶 3D 模型图。它在后台用 Chrome 打开上一级目录的 `index.html`，调用页面上的 `window.recordMockup` 接口，所以出图效果和网页完全一致。

## 安装

```bash
cd cli
npm install
```

默认使用本机的 Google Chrome。没有 Chrome 时，运行 `npx playwright-core install chromium`，并在命令后加 `--browser chromium`。

## 命令

```bash
node record-mockup.mjs schema -o schema.json              # 字段说明（JSON Schema）
node record-mockup.mjs init -o spec.json                  # 生成默认 spec
node record-mockup.mjs slots spec.json                    # 贴图位、尺寸和遮挡
node record-mockup.mjs render spec.json -o out.png        # 渲染一张
node record-mockup.mjs render spec.json --set number.current=88 --set camera.view=front
node record-mockup.mjs numbers spec.json --from 1 --to 50 # 批量渲染编号图
node record-mockup.mjs video spec.json -o turn.mp4          # 旋转视频，按 spec.animation
node record-mockup.mjs video spec.json -o turn.gif --set animation.aspect=1:1
node record-mockup.mjs video spec.json -o open.mp4 --set animation.preset=gatefold
```

### 曲库（MusicBrainz + Cover Art Archive）

```bash
node record-mockup.mjs library search --artist "Radiohead" --album "OK Computer"   # 专辑 → group id
node record-mockup.mjs library releases <group-id>                                 # 版本 → release id，黑胶在前
node record-mockup.mjs library pick <release-id> spec.json --dry-run               # 看图号和分配方案
node record-mockup.mjs library pick <release-id> spec.json --use front=0 --use labelC=none
```

`pick` 和网页的曲库面板选图规则一致：正面优先用数字版原图，盘面照片按 A–D 面分给标签，并用网页同一套算法按中孔裁切；同时写入唱片张数、单开/双开、每面音轨数、`meta.artist` / `album`，以及 `meta.assets`（来源为 `fetched`）。图片存到 spec 旁边的 `<spec 名>-library/`（可用 `--dir` 改）。spec 不存在时会新建；已有的非 `fetched` 贴图默认保留。`--images-only` 只填图片，`--crop labelA=zoom:1.1,rot:15,dx:0,dy:-8` 微调标签裁切。请求 MusicBrainz 时每秒最多一次，并带上 User-Agent。取到的图片版权归原权利方，仅供预览。

通用选项：`--json` 输出一行 JSON；`--strict` 遇到场景或素材来源警告时不渲染并返回退出码 2；`--width` / `--height` 覆盖输出尺寸；`--software` 强制软件渲染；`--verbose` 显示页面错误。

`video` 的格式由扩展名决定（`.mp4` / `.gif`），画幅和尺寸用 `animation.aspect`、`animation.size`，不用 `--width` / `--height`。视频不支持透明背景，`output.background` 为 transparent 时改用纯色并给出警告。`--encoder` 选择 MP4 编码器，默认 `software`；`hardware` 每帧更快，但在 macOS headless 下首次启动会卡十几秒，只在长视频或 4K 时划算。

`render`、`numbers` 与 `video` 均要求为自定义贴图填写 `meta.assets.<贴图位>.source`。不使用 `--strict` 时，来源缺失会保留警告并继续出图。JSON 结果的 `assets` 字段汇总每个贴图位的来源。内置程序化示例不需要登记外部贴图。

## 速度

在 Apple Silicon 的 Mac 上，1600 × 1000 px 的图，第一张约 5–9 秒（含启动浏览器），批量出图约每张 1–2 秒。6 秒 30 fps 的旋转视频：1080p 约 18 秒，4K 约 32 秒，均含启动浏览器。没有 GPU 的机器会自动改用软件渲染，大约慢 4 倍。

## 依赖

- `three`、`mediabunny`（MP4 封装）、`gifenc`（GIF 编码）从本地 `node_modules` 加载，不依赖 CDN。
- 网页字体（Archivo、Noto Sans SC 等）仍然从 Google Fonts 加载。离线时会退回系统字体，只影响示例图和编号的字形。

字段说明和 agent 的使用流程，见上一级目录的 `AGENTS.md`。
