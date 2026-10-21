# 线上监控：访问量、报错和导出耗时

网页部署在 Cloudflare Pages。监控分两块：

- **访问量**：Cloudflare Web Analytics。正式站构建时注入 beacon，预览站不注入。不用 Cookie。
- **报错和耗时**：`site/rum.js` 把浏览器里的事件发到 `/api/log`（`functions/api/log.js`），写进 Workers Analytics Engine 的数据集 `record_mockup_logs`。只有部署出去的网页会上报；CLI 和本地直接打开 `index.html` 都不上报。

上报内容不含用户上传的图片、spec 或文件名，只有报错信息、耗时、尺寸和设备信息（UA、GPU 型号、屏幕像素比、内存档位、国家）。

## 事件类型

| type | 何时发 | 主要字段 |
|---|---|---|
| `ready` | 第一帧画出来 | `ms` 从打开页面到第一帧，`gpu` |
| `export` | PNG / GIF / MP4 导出结束（取消不算） | `format`，`ok`，`ms`，`w` × `h`，`bytes`，失败时 `msg` |
| `error` | 未捕获的脚本错误 | `msg`，`src`，`line`，`col`，`stack` |
| `rejection` | 未处理的 Promise 拒绝 | `msg`，`stack` |
| `resource` | 脚本、样式、图片加载失败（比如 CDN 挂了） | `src` |
| `context-lost` | WebGL 上下文丢失（多见于手机内存不足） | `ms` |
| `gl-unavailable` | 浏览器起不来 WebGL 2 | `msg` |

同一个页面里，重复的报错只发一次，每个页面最多发 30 条。

## 一次性设置

1. **Cloudflare Pages 项目** `record-mockup`：生产分支设为 `main`。
2. **Analytics Engine**：在 Cloudflare 后台 Workers & Pages → Analytics Engine 里启用（免费额度够用）。数据集在第一次写入时自动创建，绑定写在 `wrangler.toml` 里。
3. **自定义域名**：在 Pages 项目 → Custom domains 添加 `recordmockup.com`，再按提示到域名注册商（Spaceship）把记录改为 CNAME 指向 `record-mockup.pages.dev`。切换完成后，删掉 `.github/workflows/pages.yml` 里的 `github-pages` 任务。
4. **Web Analytics**：后台 Web Analytics → Add a site → 填 `recordmockup.com`，选手动安装（JS snippet），把其中的 token 填到 GitHub 仓库变量 `CF_WEB_ANALYTICS_TOKEN`（Settings → Secrets and variables → Actions → Variables）。
5. GitHub 仓库 secrets `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 预览部署已经在用，不用再加。查询数据另需一个带 **Account Analytics: Read** 权限的 token。

## 查询

Analytics Engine 用 SQL API 查询，列名是位置编号，对应关系见 `functions/api/log.js` 顶部的注释。数据保留 90 天。

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $CF_ANALYTICS_TOKEN" \
  --data "SELECT blob2 AS message, blob3 AS source, count() AS n FROM record_mockup_logs WHERE index1 IN ('error','rejection') AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY message, source ORDER BY n DESC LIMIT 20"
```

常用查询：

```sql
-- 最近 7 天各类事件数量（正式站）
SELECT blob1 AS type, count() AS n FROM record_mockup_logs
WHERE blob6 = 'recordmockup.com' AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY type

-- 各格式导出成功率和耗时中位数
SELECT blob13 AS format, sum(double10) / count() AS ok_rate, quantileWeighted(0.5, double1, _sample_interval) AS p50_ms
FROM record_mockup_logs WHERE index1 = 'export' AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY format

-- 首帧耗时 p75，按国家
SELECT blob7 AS country, count() AS n, quantileWeighted(0.75, double1, _sample_interval) AS p75_ms
FROM record_mockup_logs WHERE index1 = 'ready' AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY country ORDER BY n DESC

-- 导出失败和上下文丢失集中在哪些 GPU、哪些机型
SELECT blob10 AS gpu, double5 AS memory_gb, blob1 AS type, count() AS n FROM record_mockup_logs
WHERE (index1 = 'export' AND double10 = 0) OR index1 = 'context-lost' GROUP BY gpu, memory_gb, type ORDER BY n DESC LIMIT 20
```

`blob6` 是主机名：`recordmockup.com` 为正式站，`*.record-mockup.pages.dev` 为预览站。`blob14` 是构建时的 commit，用来判断某个报错是从哪次发布开始出现的。
