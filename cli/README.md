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
```

通用选项：`--json` 输出一行 JSON；`--strict` 遇到场景或素材来源警告时不渲染并返回退出码 2；`--width` / `--height` 覆盖输出尺寸；`--software` 强制软件渲染；`--verbose` 显示页面错误。

`render` 与 `numbers` 均要求为自定义贴图填写 `meta.assets.<贴图位>.source`。不使用 `--strict` 时，来源缺失会保留警告并继续出图。JSON 结果的 `assets` 字段汇总每个贴图位的来源。内置程序化示例不需要登记外部贴图。

## 速度

在 Apple Silicon 的 Mac 上，1600 × 1000 px 的图，第一张约 5–9 秒（含启动浏览器），批量出图约每张 1–2 秒。没有 GPU 的机器会自动改用软件渲染，大约慢 4 倍。

## 依赖

- `three` 从本地 `node_modules` 加载，不依赖 CDN。
- 网页字体（Archivo、Noto Sans SC 等）仍然从 Google Fonts 加载。离线时会退回系统字体，只影响示例图和编号的字形。

字段说明和 agent 的使用流程，见上一级目录的 `AGENTS.md`。
