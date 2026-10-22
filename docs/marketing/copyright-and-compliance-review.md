# Record Mockup 首轮传播：版权与合规检查

检查日期：2026-10-22。范围是本仓库当前编辑器、即将发布的用途页、案例页、示意图、短视频和首轮宣传文案。本文件是发布决策清单，不代替针对经营所在地和目标市场的法律意见。

## 先记住三条边界

1. **能从曲库看到或下载封面，不等于获得再发布许可。** MusicBrainz / Cover Art Archive 提供的是检索与图像访问；Cover Art Archive 明确说明图像版权归各权利人。公开案例、广告、Product Hunt 配图和用户的商业预售图应使用自己拥有或获得相应许可的作品。来源标注也不能代替许可。参见 [Cover Art Archive](https://beta.coverartarchive.org/)、[新加坡知识产权局：使用他人作品前取得许可](https://www.ipos.gov.sg/about-ip/copyright/ownership-and-commercialisation/)。
2. **模型图是示意，不是对实物规格的证明。** 宣传一款实际预售商品前，先核对胶色、2LP 数量、封套结构、贴纸、Obi、限量数等；还没确认的项目要写明“mockup / final product may vary”，且不能用小字补救本身明显错误的展示。广告的整体印象应真实、不误导。参见 [美国 FTC 广告原则](https://www.ftc.gov/business-guidance/advertising-marketing)、[英国 ASA 图像指引](https://www.asa.org.uk/news/a-picture-says-a-thousand-words-avoiding-misleading-imagery-in-ads.html)。
3. **“用户上传本地处理”要说完整。** 上传图片、字体和导出文件在浏览器中处理与存储；网站同时加载 CDN 脚本/字体，正式站使用 Cloudflare Web Analytics，并向 `/api/log` 发送错误、性能和导出事件。不能笼统说“网站不收集任何数据”。参见 [Cloudflare Web Analytics 说明](https://developers.cloudflare.com/web-analytics/about/) 和本仓库 `docs/observability.md`。

## 本次材料的判断

| 项目 | 当前事实与风险 | 已处理 / 上线前动作 |
|---|---|---|
| 公开示意图和短视频 | 使用编辑器内置的程序化示例图，无真实发行封面。视觉上有虚构的首版、180g、限量编号信息，可能被误认为真实商品。 | 用途页、案例页、帖子和视频说明均标“示意设计，非真实发行”；不要用真实艺人/厂牌名暗示背书。留存 `docs/specs/`、`docs/marketing/demo.json` 作为来源记录。 |
| 曲库素材 | `index.html` 从 MusicBrainz / Cover Art Archive 请求图像，可放入场景并导出。现有曲库提示写“仅供预览”，但导出按钮仍可用，用户可能误解为可商用。 | 已在导出区域补充权利提醒。后续如公开推广曲库功能，最好在选择曲库图时再给一次显著提示；不要拿抓取的真实专辑封面做本站广告。 |
| 用户自有封面 | 音乐人可能拥有录音但不拥有封面插画、摄影、字体或艺人肖像的商业宣传权。委托设计的权利归属也要看合同。 | 页面改为“拥有或获授权使用的封面”；收真实案例时取得书面许可，写清楚可用在本站页面、社媒、Product Hunt、广告、可否修改和署名。参见 [IPOS 所有权及商业化说明](https://www.ipos.gov.sg/about-ip/copyright/ownership-and-commercialisation/)。 |
| 预售准确性 | 工具可随意设置色胶、包装和限量号；发行方若把未确定规格当实物卖，可能误导购买者。 | 页面和文案增加核对实际发行规格的提醒。真实案例展示“效果示意”与最终规格的差异时，须显著说明。 |
| 隐私及统计 | Web Analytics 无 Cookie，Cloudflare 称该产品不收集访客个人数据；但本站自有 `/api/log` 会记录随机会话标识、用户代理、国家、设备档位、GPU、报错等。Cloudflare 当前文档称 Analytics Engine 数据保留三个月。 | 已新增 `/privacy/`，写明本地存储、诊断数据、第三方服务、三个月诊断记录保留期和公开联系邮箱。不要把技术诊断说成“完全匿名”；上线时核对页面与实际部署配置。参见 [Cloudflare 保留期说明](https://developers.cloudflare.com/analytics/analytics-engine/limits/)。 |
| 主动联系试用者 | 原方案的陌生人一对一邮件/私信可能触发目标市场的电子营销规则。英国 ICO 明确将社媒私信纳入电子邮件营销规则；新加坡 IMDA 对群发商业电子信息也有要求。 | 首轮改为公开作品展示和自愿报名，回复主动联系者；不批量群发冷邮件/私信。若以后做主动获客，先核对收件人所在地、身份、退订和平台规则。参见 [ICO B2B 指南](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/)、[IMDA 组织指引](https://www.imda.gov.sg/infocomm-regulation-and-guides/unsolicited-communications/best-practices-for-organisations)。 |
| 流量归因 | 首轮帖子原来用 UTM 参数，但 Cloudflare Web Analytics 当前不记录查询参数。 | 已从发布文案移除“UTM 可归因”的说法；先看来源网站、落地页路径和导出趋势。参见 [Cloudflare Web Analytics FAQ](https://developers.cloudflare.com/web-analytics/faq/)。 |
| 第三方代码/字体 | 仓库已有许可证文本及说明。网页从 CDN 和 Google Fonts 加载资源。 | 继续保留 `THIRD_PARTY_NOTICES.md`，更新依赖时检查许可和字体版本。 |

用途页首屏的切换视频（`docs/marketing/hero-reel.mp4`）用了 16 张 Unsplash 照片做封面底图，均为 Unsplash License（可免费商用，不要求署名），只选了风景、质感和抽象光影，没有可辨认的人物、品牌或他人画作。标题是虚构的示意专辑名，并印有 SAMPLE COVER。作者和原图链接记在 `docs/specs/hero-variants/photos/credits.json` 和各 spec 的 `meta.assets` 里。Unsplash License 不允许把照片原样单独出售或做成同类图库，这里只作为合成封面的一部分使用。

## 真实客户案例的最小授权记录

在取得对方同意前，只用本站示例图。取得同意时记录：权利方名称、授权人的身份和联系方式、所授权的具体封面/标志/图片文件、可使用渠道（网站、社媒、Product Hunt、付费广告）、使用期限和地域、可否裁切与合成、署名方式、撤回或修改联系渠道，以及对方已核对展示的实际发行规格。保存授权邮件或合同原文，不仅记录一句“已同意”。

## 上线门槛

- 公开联系邮箱为专用的 `recordmockup@gmail.com`，已写入隐私与版权页面；上线前确认这个邮箱有人定期查看。
- 确认示例图全部来自内置素材，没有混入真实发行封面、未经授权的字体或商标。
- 发布文案和页面继续使用“示意设计”说明；任何真实预售图须核对实际规格。
- 外部帖子与客户邀约由账号所有者审阅后发布；不使用未经同意的真实发行素材作本站案例。
