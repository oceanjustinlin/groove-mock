# 线上监控：访问量、报错和导出耗时

网页部署在 Cloudflare Pages。监控分两块：

- **访问量**：Cloudflare Web Analytics。正式站构建时注入 beacon，预览站不注入。不用 Cookie。
- **报错和耗时**：`site/rum.js` 把浏览器里的事件发到 `/api/log`（`functions/api/log.js`），写进 Workers Analytics Engine 的数据集 `record_mockup_logs`。只有部署出去的网页会上报；CLI 和本地直接打开 `index.html` 都不上报。

上报内容不含用户上传的图片、spec 或文件名，只有报错信息、耗时、尺寸和设备信息（UA、GPU 型号、屏幕像素比、内存档位、国家）。

## 事件类型

| type | 何时发 | 主要字段 |
|---|---|---|
| `ready` | 第一帧画出来 | `ms` 从打开页面到第一帧，`gpu` |
| `export` | PNG / GIF / MP4 导出结束（取消不算） | `format`，`ok`，`ms`，`w` × `h`，`bytes`，`art`，`lib`，失败时 `msg` |
| `error` | 未捕获的脚本错误 | `msg`，`src`，`line`，`col`，`stack` |
| `rejection` | 未处理的 Promise 拒绝 | `msg`，`stack` |
| `resource` | 脚本、样式、图片加载失败（比如 CDN 挂了） | `src` |
| `context-lost` | WebGL 上下文丢失（多见于手机内存不足） | `ms` |
| `gl-unavailable` | 浏览器起不来 WebGL 2 | `msg` |

同一个页面里，重复的报错只发一次，每个页面最多发 30 条。WebGL 起不来时只记一条 `gl-unavailable`，随后抛出的未捕获错误不再另记 `error`。

## 素材来源

`export` 事件带两个字段，用来区分「音乐人用自己的封面」和「乐迷拿曲库里的真实发行做图」：

| 字段 | 列 | 含义 |
|---|---|---|
| `art` | `blob16` | 封套正面的来源：`user` 自己上传，`fetched` 从曲库（MusicBrainz / Cover Art Archive）取得，`sample` 内置示例图 |
| `lib` | `double14` | 本次导出时有几个贴图位用的是曲库图（封面、背面、标签等都算） |

刷新页面后恢复的贴图保留原来的来源，按「新建」清空后回到 `sample`。只看唱片模式（`scene.mode: "disc"`）下封面不出现在图里，这时主要看 `lib`。加上这两个字段之前的导出没有这两列，读出来是 `''` 和 `0`。

## 机器人标记

每条上报都带 `bot` 字段（`blob15` 为原因，`double13` 为 0 / 1），原因可以有多个，逗号分隔：

| 原因 | 判断 |
|---|---|
| `webdriver` | `navigator.webdriver` 为真：浏览器由自动化工具控制 |
| `ua-bot` | UA 里有 HeadlessChrome、Lighthouse、bot、crawl、spider 等字样 |
| `ua-spoof` | UA 自称 Safari / iPhone（WebKit）或 Firefox，浏览器却有 `navigator.deviceMemory` 或 `navigator.userAgentData`。这两个只有 Chromium 才有，说明 UA 是伪装的 |

无头爬虫、截图和预览服务常把 UA 改成 iPhone Safari，而且没有 GPU，所以会报 `gl-unavailable`。看真实用户的报错和耗时时加上 `double13 = 0`。加上这个字段之前的数据没有这两列，读出来是 `''` 和 `0`，那段时间的伪装访问要靠 `blob9 LIKE '%Safari%' AND double5 > 0`（Safari 不提供 deviceMemory，读出来恒为 0）来辨认。

## 一次性设置

1. **Cloudflare Pages 项目** `record-mockup`：生产分支设为 `main`。
2. **Analytics Engine**：在 Cloudflare 后台 Workers & Pages → Analytics Engine 里启用（免费额度够用）。数据集在第一次写入时自动创建，绑定写在 `wrangler.toml` 里。
3. **自定义域名**：`recordmockup.com` 和 `www.recordmockup.com` 已加到 Pages 项目。域名在 Spaceship 注册，nameserver 指向 Cloudflare（`louis` / `miki.ns.cloudflare.com`），DNS 记录在 Cloudflare 管理，两个名字都 CNAME 到 `record-mockup.pages.dev`。
4. **Web Analytics**：后台 Web Analytics → Add a site → 填 `recordmockup.com`，选手动安装（JS snippet），把其中的 token 填到 GitHub 仓库变量 `CF_WEB_ANALYTICS_TOKEN`（Settings → Secrets and variables → Actions → Variables）。
5. GitHub 仓库 secrets `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 预览部署已经在用，不用再加。

## 查询用的 token

下面的查询都可以直接用 `wrangler login` 的登录，不用另建 token（也可以用带 **Account Analytics: Read** 权限的 API token）：

```bash
npx wrangler whoami >/dev/null   # 顺便刷新登录
CF_ANALYTICS_TOKEN=$(sed -nE 's/^oauth_token *= *"(.*)"/\1/p' "$HOME/Library/Preferences/.wrangler/config/default.toml")   # Linux 为 ~/.config/.wrangler/config/default.toml
```

`CLOUDFLARE_ACCOUNT_ID` 和 `CF_ZONE_ID`（`recordmockup.com` 的 Zone ID）在 Cloudflare 后台域名 Overview 页右下角。

## 访问量（PV / UV）

三个来源的口径不同，看哪个取决于想回答什么：

| 来源 | 数据集 | 有什么 | 含不含爬虫 |
|---|---|---|---|
| Web Analytics | `rumPageloadEventsAdaptiveGroups`（账户级） | PV（`count`）、访问次数（`sum.visits`），可按主机、页面、国家、浏览器分 | 不含：只算真的跑了 beacon 脚本的浏览器 |
| 域名 HTTP 统计 | `httpRequests1dGroups`（Zone 级） | 请求数、`pageViews`、独立访客 `uniq.uniques`（按 IP 去重） | 含：爬虫、扫描器、脚本请求都算，只能当上限 |
| `/api/log` | `record_mockup_logs`（见下一节） | `ready` 次数 ≈ 能用的页面打开次数，`count(DISTINCT blob12)` ≈ 会话数 | 可以排除：加 `double13 = 0` 去掉带机器人标记的 |

Web Analytics 不提供独立访客数（不用 Cookie，认不出同一个人），要 UV 只能看域名 HTTP 统计的 `uniques`。两个查询都走 GraphQL：

```bash
gql() { python3 -c 'import json,sys;print(json.dumps({"query":sys.argv[1]}))' "$1" |
  curl -sS https://api.cloudflare.com/client/v4/graphql -H "Authorization: Bearer $CF_ANALYTICS_TOKEN" \
    -H 'Content-Type: application/json' --data @-; }

# Web Analytics：最近 7 天每天的 PV 和访问次数（账户里还有别的站，按主机过滤）
gql "{ viewer { accounts(filter:{accountTag:\"$CLOUDFLARE_ACCOUNT_ID\"}) {
  rumPageloadEventsAdaptiveGroups(limit:100, orderBy:[date_ASC],
    filter:{date_geq:\"$(date -v-7d +%F)\", requestHost_in:[\"recordmockup.com\",\"www.recordmockup.com\"]}) {
    count sum { visits } dimensions { date requestHost } } } } }"

# 域名 HTTP 统计：最近 7 天每天的请求、pageViews 和独立访客
gql "{ viewer { zones(filter:{zoneTag:\"$CF_ZONE_ID\"}) {
  httpRequests1dGroups(limit:30, orderBy:[date_ASC], filter:{date_geq:\"$(date -v-7d +%F)\"}) {
    dimensions { date } sum { requests pageViews } uniq { uniques } } } } }"
```

`date -v-7d` 是 macOS 写法，Linux 用 `date -d '7 days ago' +%F`。Web Analytics 的维度还有 `requestPath`、`countryName`、`userAgentBrowser`、`deviceType`、`refererHost`，加到 `dimensions` 里就能分组。`www` 现在不跳转到根域名，所以 PV 会分在两个主机上，合起来看。Web Analytics 没法排除伪装成浏览器的机器人（它们会被算成 MobileSafari 之类），真人用量以 `/api/log` 里 `double13 = 0` 的 `ready` 为准：

```sql
SELECT toDate(timestamp) AS day, count() AS opens, count(DISTINCT blob12) AS sessions FROM record_mockup_logs
WHERE index1 = 'ready' AND double13 = 0 AND blob6 IN ('recordmockup.com', 'www.recordmockup.com')
  AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY day ORDER BY day
```

## 报错和耗时

Analytics Engine 用 SQL API 查询，列名是位置编号，对应关系见 `functions/api/log.js` 顶部的注释。[Cloudflare 当前文档](https://developers.cloudflare.com/analytics/analytics-engine/limits/)称数据保留三个月。

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $CF_ANALYTICS_TOKEN" \
  --data "SELECT blob2 AS message, blob3 AS source, count() AS n FROM record_mockup_logs WHERE index1 IN ('error','rejection') AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY message, source ORDER BY n DESC LIMIT 20"
```

常用查询：

```sql
-- 最近 7 天各类事件数量（正式站，分真人和机器人）
SELECT blob1 AS type, double13 AS bot, count() AS n FROM record_mockup_logs
WHERE blob6 IN ('recordmockup.com', 'www.recordmockup.com') AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY type, bot

-- 各格式导出成功率和耗时中位数
SELECT blob13 AS format, sum(double10) / count() AS ok_rate, quantileWeighted(0.5, double1, _sample_interval) AS p50_ms
FROM record_mockup_logs WHERE index1 = 'export' AND double13 = 0 AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY format

-- 导出按封面来源分：曲库占比高，说明乐迷在用
SELECT blob16 AS art, count() AS exports, count(DISTINCT blob12) AS sessions, sum(if(double14 > 0, 1, 0)) AS with_library
FROM record_mockup_logs WHERE index1 = 'export' AND double10 = 1 AND double13 = 0 AND blob16 != ''
  AND blob6 IN ('recordmockup.com', 'www.recordmockup.com') AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY art

-- 首帧耗时 p75，按国家
SELECT blob7 AS country, count() AS n, quantileWeighted(0.75, double1, _sample_interval) AS p75_ms
FROM record_mockup_logs WHERE index1 = 'ready' AND double13 = 0 AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY country ORDER BY n DESC

-- 真实用户的导出失败、上下文丢失和 WebGL 起不来，集中在哪些 GPU、哪些机型
SELECT blob10 AS gpu, double5 AS memory_gb, blob1 AS type, count() AS n FROM record_mockup_logs
WHERE double13 = 0 AND ((index1 = 'export' AND double10 = 0) OR index1 IN ('context-lost', 'gl-unavailable')) GROUP BY gpu, memory_gb, type ORDER BY n DESC LIMIT 20
```

`blob6` 是主机名：`recordmockup.com` 为正式站，`*.record-mockup.pages.dev` 为预览站。`blob14` 是构建时的 commit，用来判断某个报错是从哪次发布开始出现的。
