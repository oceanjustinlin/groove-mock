# Record Mockup：首轮获客包

**一句话：** 把已有专辑封面做成黑胶预售商品图和短视频，在浏览器里完成，免费、无需注册。

**目标用户**

- 主要：准备黑胶预售的独立音乐人和小厂牌。需求明确，但一年只有一两次。
- 次要：唱片封套设计师、压片厂和代理商的客户经理。他们经常要给客户出效果图，用得更频繁，适合合作而不是发广告。

**他们现在怎么做：** Photoshop 样机模板（PSD）、Placeit 一类的在线样机网站，或者直接放平面封面。我们的不同在于：3D、可导出视频、彩胶纹路、2LP 和双开、Obi 和限量编号，全部免费，素材不上传。

对外发布前，先按 [`copyright-and-compliance-review.md`](copyright-and-compliance-review.md) 核对素材和公开联系方式。本包只在本地准备，尚未部署或发帖。

## 发布前准备

1. **录操作视频（最重要）。** 15–30 秒，竖屏和方形各一版：上传一张封面 → 换彩胶 → 加 Obi 或贴纸 → 导出 → 展示导出的图。现有的 `demo.mp4` 只是成品转一圈，适合做配图，但说明不了「多快能做出来」。录屏用内置示例封面，或者用已取得授权的封面。
2. **换联系邮箱。** 隐私页现在公开的是个人 Gmail，上线前换成专用别名。
3. **部署三个页面**：`/for-artists/`、`/examples/`、`/privacy/`，并在 Search Console 提交 sitemap。

现成素材：

- 页面：`https://recordmockup.com/for-artists/`（用途页）、`/examples/`（案例页）、`/`（编辑器）
- 配图：`docs/images/hero.jpg`、`gatefold-open.jpg`、`vinyl-patterns.jpg`、`back-cover.jpg`、`vinyl-variants.jpg`
- 6 秒方形转台视频：`docs/marketing/demo.mp4`（场景 `demo.json`，已抽查 0、1/4、1/2、3/4 四处画面）

所有配图都由内置示例设计渲染。图片说明统一写 **"Sample artwork, not a real release" / 「示意设计，非真实发行」**，正文不用反复声明。

## 渠道

先到人已经在的地方展示作品，不要四处贴同一段话。每个社区发帖前看当时的自我推广规则，有固定的推广帖或展示日就发在那里。

| 渠道 | 发什么 | 角度 |
|---|---|---|
| Reddit：r/WeAreTheMusicMakers、各曲风的制作人社区、r/graphic_design | 操作录屏 + 一句问题 | 「预售时你们怎么做商品图？」以征求反馈为主 |
| Hacker News：Show HN | 链接到编辑器 | 浏览器里实时渲染 3D、素材不上传、有给 agent 用的 CLI（`cli/record-mockup.mjs`）。这是给开发者看的角度，和音乐人帖子分开写 |
| Instagram Reels / TikTok | 竖屏操作录屏、彩胶纹路合集 | 视觉内容，不用多解释 |
| Bandcamp / Discogs 论坛 | 一条展示帖 | 小厂牌和压片相关讨论集中在这里 |
| 小红书 | 图文笔记：3–6 张示例图 + 操作录屏 | 黑胶和彩胶在小红书本来就有人看，标题突出「预售图」「彩胶预览」 |
| 即刻、V2EX（分享创造节点） | 独立开发者自述 | 做这个工具的原因和技术实现 |
| Product Hunt | 第 4 周一次集中发布 | 见下文草稿 |

## 帖子文案

### 1. 音乐人（英文，Reddit / 论坛）

> Your record is still at the plant, but the preorder page needs an image today. I built a free browser tool for that: drop in your cover, pick the jacket, vinyl color and extras, and export a PNG or a short reveal video. No account, and your artwork never leaves your browser.
>
> How do you make preorder images right now? I'd like to know what it's missing. https://recordmockup.com/for-artists/

配图：操作录屏，或 `hero.jpg` + `gatefold-open.jpg`。

### 2. 小厂牌（英文）

> One flat cover rarely shows what a pressing actually looks like. Record Mockup previews the whole package (2LP, gatefold, colored vinyl, obi, sticker, edition number) and exports a still or a loop for the preorder page. Free, runs in the browser.
>
> What detail do your buyers most want to see before the records arrive? https://recordmockup.com/examples/

配图：`vinyl-patterns.jpg` + `back-cover.jpg`。

### 3. Show HN（英文）

> Show HN: Record Mockup – 3D vinyl mockups rendered in the browser
>
> I made this for musicians who need preorder images before their records exist. It's a single-page Three.js app: jackets, gatefolds, 2LP, colored and patterned vinyl, exported as PNG, MP4 or GIF client-side. Uploaded artwork stays in the browser. There's also a CLI that renders scenes from a JSON spec, which I use to let coding agents iterate on mockups. Feedback on rendering and export is welcome. https://recordmockup.com/

### 4. 中文（小红书 / 即刻）

标题：黑胶还没压好，预售图先做出来了

> 做黑胶预售最尴尬的是：唱片还在工厂，预售页已经要上图了。
>
> 我做了个免费的网页工具 Record Mockup：上传封面，选单开或双开、彩胶颜色和纹路、2LP、腰封、贴纸、限量编号，就能导出商品图或几秒的动画。不用注册，封面只在你自己的浏览器里处理。
>
> 正在筹备黑胶的音乐人和厂牌，想听听你们最需要展示哪个细节。

链接放编辑器首页 `https://recordmockup.com/`（编辑器有中文界面，两个推广页目前只有英文）。小红书正文不放外链，链接放评论区或个人简介。

图片说明：示意设计，非真实发行。

## 试用招募

只回复主动表示兴趣的人，或者用公开帖子招募。不群发冷邮件或私信：各地对电子营销的规定不同，社媒私信在一些地区也算在内。

> Hi [name], thanks for asking about Record Mockup. It turns your cover art into vinyl preorder images and short clips, including 2LP and colored pressings. Examples: https://recordmockup.com/examples/ . No account needed, and your artwork stays in your browser. If you try it, one sentence on whether the exported image works for your release would help a lot.

没有对方书面许可，不公开对方的封面、名字或试用结果。授权要记录的内容见合规清单的「真实客户案例的最小授权记录」。

## Product Hunt 草稿

- Name: Record Mockup
- Tagline: Make 3D vinyl preorder images from your album art
- Description: Create LP jackets, gatefolds, 2LP sets and colored vinyl in your browser. Export transparent PNGs or short MP4/GIF reveal clips. Free, no account, artwork stays on your device.
- Maker comment: I built this for the gap between "the cover is done" and "the records arrived". The editor opens with sample artwork so you can explore before uploading your own. I'd especially like feedback from independent artists and small labels preparing preorders.
- Gallery: 操作录屏 → hero → gatefold → 彩胶纹路 → 背面。每张标注示意设计。

## 30 天安排

| 时间 | 动作 | 判断点 |
|---|---|---|
| 第 1 周 | 完成「发布前准备」三项；先发 1–2 个渠道（建议一个 Reddit 社区 + 小红书） | 页面可访问；首帖有没有人问「怎么用 / 能不能做 X」 |
| 第 2 周 | 再发 2–3 个渠道，分别试「预售图」和「彩胶展示」两个角度；Show HN 选一个工作日上午（美东时间）发 | 哪个角度带来更多导出 |
| 第 2–3 周 | 公开招募约 15 位试用者，争取 5 位做 15 分钟访谈；接触 2–3 位封套设计师 | 他们原来怎么做、卡在哪、导出的图能不能直接用 |
| 第 4 周 | 按反馈改文案和流程；达到下面的门槛就上 Product Hunt，没达到就再迭代两周 | 见门槛 |

**上 Product Hunt 的门槛（初定，按第一周数据调整）：**

- 5 位访谈对象里至少 3 位说「会用它做真实的预售图」；
- 真实导出会话连续两周增长。

## 每周复盘

主指标：**成功导出 PNG / MP4 / GIF 的真实使用会话数**。用 `ready` 和 `export` 事件，按 `docs/observability.md` 的方法排除机器人。辅助看：来源网站、用途页到编辑器的点击、试用反馈、Search Console 的展示和点击。PV 和预览机器人访问不算获客。

Cloudflare Web Analytics 不记录 URL 查询参数，UTM 无法归因；站内也没有跨页面的转化链路。所以「某个帖子带来多少导出」只能用来源网站 + 同一时段的导出量粗估。某个渠道值得加大投入时，再设计必要且公开说明的归因方式。
