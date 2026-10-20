# 第三方依赖与素材

本仓库的原始代码按根目录 LICENSE 保留所有权，不代表第三方依赖采用相同许可。

## JavaScript 依赖

| 依赖 | 固定版本 | 许可 | 完整许可位置 |
|---|---|---|---|
| three | 0.169.0 | MIT | `third-party/three-LICENSE.txt` |
| playwright-core | 1.63.0 | Apache-2.0 | `third-party/playwright-core-LICENSE.txt` |
| mediabunny | 1.61.3 | MPL-2.0 | `third-party/mediabunny-LICENSE.txt` |
| gifenc | 1.0.3 | MIT | `third-party/gifenc-LICENSE.txt` |

安装后的依赖还可能带有自己的 NOTICE、第三方声明和许可证；请保留并遵循这些文件。此处附带的许可文本来自当前锁定版本的 npm 包。

## 浏览器与网页字体

Chrome 或 Chromium 由使用者单独安装，不随本仓库分发。

页面引用 Google Fonts 中的 Archivo、IBM Plex Mono、Caveat、Noto Serif SC、Special Elite、Noto Sans SC。本仓库不内置这些字体文件；下载、自托管或再分发字体时，应同时检查并保留所选字体版本的许可证。

## 示例及本地素材

页面内置的程序化示例可用于演示渲染器，不代表真实音乐发行。`examples/2lp-gatefold.json` 不依赖外部专辑素材。`docs/images/` 中的 README 配图全部由 `docs/specs/` 渲染，只使用内置示例图，不含外部专辑素材。

`output/` 已从 Git 排除，包括下载的真实专辑封面、AI 配套图、修改字体、原始生图结果及渲染报告。保留来源说明不等同于获得再分发许可。尤其不应将本地修改的 Arial 编号字体作为可自由分发字体发布。

未来添加可提交示例时，应仅使用权属明确的自制素材或已获许可素材，并在场景 `meta.assets` 和相应说明中登记来源。
