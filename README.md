# 诗话桥 / 诗画桥 内容档案

一个静态数据驱动的网站，用于展示从微信搜索、中南大学古桥研究中心、微博采集到的“诗话桥”“诗画桥”相关文章和视频。

网站只把 `sourceUrl` 判定为具体内容页的条目显示为可跳转；搜索结果页、平台首页或空链接会显示为“缺少原文链接”。

## 本地预览

```bash
python3 -m http.server 4173
```

然后打开 `http://localhost:4173`。

## 登录、发布与审核接口

前端默认会读取静态 `data/items.json`。未配置 CloudBase 环境时，可用本地预览验证码 `123456` 测试登录、提交审核和管理员审核流程。

正式接入腾讯云 CloudBase 时，在 `index.html` 中填写：

```html
<meta name="bridge-cloudbase-env" content="你的 CloudBase 环境 ID" />
<meta name="bridge-cloudbase-region" content="ap-shanghai" />
<meta name="bridge-cloudbase-function" content="bridge-api" />
```

登录流程使用 CloudBase 邮箱验证码登录：输入邮箱、发送验证码、验证后登录。前端使用 `auth.getVerification({ email })` 发送验证码，并用 `auth.signInWithEmail(...)` 完成登录。首次登录即注册，CloudBase 会生成用户 `uid`。

云函数建议使用 `cloudfunctions/bridge-api` 模板。前端调用同一个云函数并传入 `action`：

- `me`：返回当前用户 `uid`、`email`、`isAdmin`
- `listPublicContents`：返回已审核公开内容
- `submitContent`：提交站内作业展示；普通用户保存为 `pending`，管理员保存为 `approved`
- `listPendingContents`：管理员获取待审核内容
- `reviewContent`：管理员通过或拒绝内容

管理员身份必须由云函数查询 CloudBase 数据库判断。建议创建 `admins` 集合：

```json
{
  "email": "admin@example.com",
  "enabled": true
}
```

前端里的 `bridge-admin-emails` 只能作为无后端本地预览或 UI 提示，不作为正式权限依据。

站内发布目前支持：

- 文章：标题、上传者、富文本正文、插入图片。图片前端限制 5MB。
- 文件：标题、上传者、PPT / PDF / Word 文件。文件前端限制 100MB。

日期由系统按提交/发布当天生成，精确到日。所有站内发布内容都会自动带 `作业展示` 标签。

## 数据更新

页面读取 `data/items.json`。爬虫或人工整理脚本需要输出同样的字段：

```json
{
  "id": "weibo-001",
  "platform": "weibo",
  "type": "video",
  "keyword": "诗画桥",
  "title": "内容标题",
  "author": "作者",
  "summary": "准确摘要，来自原文摘录、页面描述、全文摘要或人工校对",
  "summarySource": "raw_excerpt",
  "publishedAt": "2026-05-26",
  "capturedAt": "2026-06-10T09:00:00+08:00",
  "engagement": 3890,
  "tags": ["短视频", "桥梁"],
  "sourceUrl": "https://example.com/source-detail"
}
```

`platform` 常用值：`wechat-search`、`csu-bridge-center`、`site-homework`、`weibo`。

`type` 可选值：`article`、`video`、`file`。

`summarySource` 可选值：

- `raw_excerpt`：直接摘自原文局部内容。
- `meta_description`：来自页面描述、公众号摘要等结构化字段。
- `generated_from_fulltext`：从已抓取全文生成的短摘要。
- `manual_verified`：人工读过并校对过。

## 精准链接要求

不要把搜索结果页写入 `sourceUrl`。例如：

- 微信公众号文章应使用 `https://mp.weixin.qq.com/s/...`
- 中南大学古桥研究中心应使用 `https://civil.csu.edu.cn/abrccsu/...` 下的具体内容页
- 微博应使用 `https://weibo.com/{uid}/{mid}`、`https://m.weibo.cn/detail/{mid}` 或视频详情页

## 数据校验

替换真实采集数据后运行：

```bash
node tools/validate-items.mjs
```

校验会拦截空链接、搜索页、平台首页、缺摘要来源和过短摘要。

## 采集脚本

微信搜索可以先自动发现公众号文章链接：

```bash
npm run discover:wechat -- --keyword 诗话桥 --pages 2
npm run resolve:wechat -- --headful
npm run scrape:wechat
```

如果搜狗微信返回验证码，脚本会停止。完成浏览器验证后可以传 `SOGOU_COOKIE` 再跑：

```bash
SOGOU_COOKIE='你的搜狗微信 Cookie' npm run discover:wechat -- --keyword 诗话桥 --pages 2
```

如果发现结果里是 `weixin.sogou.com/link?...` 中转链接，运行：

```bash
npm run resolve:wechat -- --headful
```

第一次会打开一个专用 Chrome。若停在搜狗验证页，请在这个 Chrome 窗口里完成验证，然后重新运行同一条命令。解析成功后，`data/links/wechat.json` 里的 `url` 会被替换为 `mp.weixin.qq.com/s/...`，原中转链接会保存在 `sogouUrl`。

先把精准链接放到对应文件：

- `data/links/wechat.json`
- `data/links/csu-bridge-center.json`
- `data/links/weibo.json`

链接格式示例：

```json
[
  {
    "url": "https://mp.weixin.qq.com/s/xxxxxxxx",
    "keyword": "诗画桥",
    "type": "article",
    "tags": ["微信公众号"]
  }
]
```

然后运行：

```bash
npm run scrape:wechat
npm run scrape:weibo
npm run validate
```

一次性抓取全部平台：

```bash
npm run scrape:all
```

如果页面需要登录，把 Cookie 作为环境变量传入，不要写进文件：

```bash
WECHAT_COOKIE='你的微信 Cookie' npm run scrape:wechat
WEIBO_COOKIE='你的微博 Cookie' npm run scrape:weibo
```

也可以先只打印结果，不写入 `data/items.json`：

```bash
node tools/scrape-wechat.mjs --print
```

## 采集提醒

各平台有自己的服务条款、robots 规则和反爬策略。建议只保存必要元数据、短摘要、原始链接和采集时间；需要展示全文或视频时，优先跳转到原平台。
