# Groove Mock

黑胶唱片包装的 3D 模型工具。浏览器页面 `index.html` 提供可视化控制，CLI 使用同一个渲染器，读取 JSON 场景并导出 PNG。

支持单开与双开封套、1LP / 2LP、唱片与内袋抽出、插页、塑封、贴纸、Obi、编号及透明背景。素材缺失时，可按 `AGENTS.md` 和 `prompts/image-prompts.md` 的链路补齐。

## 环境与安装

- Node.js 20 或以上版本。
- Google Chrome；也可单独安装 Playwright Chromium。
- 首次安装 npm 依赖需要联网。

在项目根目录运行：

```bash
npm ci --prefix cli
```

默认使用本机 Chrome。没有 Chrome 时：

```bash
cd cli
npx playwright-core install chromium
cd ..
```

之后给 CLI 命令加 `--browser chromium`。

## 快速开始

```bash
mkdir -p output
node cli/groove-mock.mjs schema -o output/schema.json
node cli/groove-mock.mjs slots examples/2lp-gatefold.json
node cli/groove-mock.mjs render examples/2lp-gatefold.json -o output/example.png --json --strict
```

这个例子使用渲染器内置的程序化示例，不需要下载真实专辑封面。

自行创建场景：

```bash
node cli/groove-mock.mjs init -o output/spec.json
```

把图片与 spec 放在同一个工作目录，贴图路径写相对 spec 的路径。为每张自定义贴图填写 `meta.assets.<贴图位>.source`；可选来源有 `user`、`generated`、`typeset`、`composite`、`sample`。生图素材还应记录提示词。

```json
{
  "images": {"front": "cover.jpg"},
  "meta": {
    "assets": {
      "front": {"source": "user", "note": "使用者提供的封面"}
    }
  }
}
```

## 命令与退出码

详细参数见 `node cli/groove-mock.mjs --help` 和 `cli/README.md`。

- `schema`：字段、范围和默认值。
- `slots [spec.json]`：当前场景的贴图位、尺寸和遮挡。
- `render spec.json`：渲染单张 PNG。
- `numbers spec.json --from 1 --to 50`：批量编号。
- `--strict`：遇到场景或来源登记警告时拒绝出图，退出码为 2。
- 退出码 0 表示完成；1 表示执行错误。

## 浏览器页面与网络依赖

可以用本地静态服务器打开页面，例如在项目根目录执行 `python3 -m http.server 8000 --bind 127.0.0.1`，再访问 `http://127.0.0.1:8000`。

直接打开浏览器页面时，three.js 从固定版本 CDN 加载，需要联网。CLI 优先用已安装的本地 three.js 替代 CDN 请求；Google Fonts 仍会尝试联网加载，失败后回退到系统字体，文字外观可能不同。CLI 会临时监听回环地址，运行环境需要允许启动本地服务与浏览器。

## 验证

```bash
node --check cli/groove-mock.mjs
npm test --prefix cli
npm audit --prefix cli --omit=dev
```

集成测试会启动真实无头浏览器，检查严格模式的退出码和是否写出文件。默认使用 Chrome；使用 Chromium 时运行 `GROOVE_TEST_BROWSER=chromium npm test --prefix cli`。

## 仓库范围

这是一个独立 Git 仓库。只跟踪源码、文档、锁文件与权属明确的示例场景。`output/`、依赖目录、本地工具配置、环境变量文件和运行报告均被忽略，留在使用者本机。

`output/` 中的交付物不会随源码推送。需要分发图片时，应单独检查素材和字体的可分发范围，再选择合适的制品存储方式。

## 许可

当前按私有源码管理，项目原始内容保留所有权，未授予开源许可。见 `LICENSE`；第三方软件、字体与素材范围见 `THIRD_PARTY_NOTICES.md`。
