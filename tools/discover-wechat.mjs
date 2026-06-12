import { cleanText, decodeHtml, fetchHtml, getCookie, parseDate, readJson, writeJson } from "./lib/common.mjs";

const keyword = getArg("--keyword") || process.env.KEYWORD || "诗话桥";
const pages = Number(getArg("--pages") || process.env.PAGES || 1);
const outputFile = getArg("--out") || "data/links/wechat.json";
const cookie = getCookie("SOGOU_COOKIE") || getCookie("WECHAT_COOKIE");
const fresh = process.argv.includes("--fresh");
const exactKeywords = ["诗话桥", "诗画桥"];

const discovered = [];
let stoppedByCaptcha = "";

for (let page = 1; page <= pages; page += 1) {
  const url = `https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(keyword)}&page=${page}`;
  const response = await fetchHtml(url, {
    cookie,
    headers: {
      referer: "https://weixin.sogou.com/",
    },
  });

  if (isCaptchaPage(response.text)) {
    stoppedByCaptcha = url;
    console.warn(`搜狗微信返回验证码页，已停止并保存当前发现结果：${url}`);
    break;
  }

  if (!response.ok) {
    console.warn(`跳过第 ${page} 页：HTTP ${response.status}`);
    continue;
  }

  discovered.push(...extractResults(response.text, keyword));
}

const existingLinks = readJson(outputFile, []);
if (fresh && discovered.length === 0 && stoppedByCaptcha) {
  console.warn("未发现新结果且遇到验证码，保留现有链接清单。");
  process.exit(0);
}

const oldLinks = fresh ? [] : existingLinks;
const byUrl = new Map(oldLinks.map((item) => [item.url, item]));

for (const item of discovered) {
  byUrl.set(item.url, { ...byUrl.get(item.url), ...item });
}

const merged = [...byUrl.values()];
writeJson(outputFile, merged);

console.log(`微信发现：新增/更新 ${discovered.length} 条，当前 ${merged.length} 条 -> ${outputFile}`);
if (stoppedByCaptcha) {
  console.log("提示：如需继续更多页，请在浏览器完成验证后传 SOGOU_COOKIE 重新运行。");
}

function extractResults(html, defaultKeyword) {
  const results = [];
  const blocks = html.split(/<li[^>]+id=["']sogou_vr_11002601_box_/i).slice(1);

  for (const block of blocks) {
    const itemHtml = block.split("</li>")[0] || block;
    const rawHref = matchFirst(itemHtml, [
      /<h3[^>]*>\s*<a[^>]+href=["']([^"']+)["']/i,
      /<a[^>]+href=["']([^"']+)["'][^>]*data-share/i,
      /(https?:\/\/mp\.weixin\.qq\.com\/s\/[^"'<\s]+)/i,
    ]);
    const url = normalizeWechatUrl(rawHref);
    if (!url) continue;

    const title = cleanText(stripTags(matchFirst(itemHtml, [/<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i])));
    const snippet = cleanText(stripTags(matchFirst(itemHtml, [/<p[^>]+class=["']txt-info["'][^>]*>([\s\S]*?)<\/p>/i])));
    const matchedKeyword = pickExactKeyword(`${title} ${snippet}`);
    if (!matchedKeyword) continue;

    const author = cleanText(stripTags(matchFirst(itemHtml, [/<a[^>]+class=["']account["'][^>]*>([\s\S]*?)<\/a>/i])));
    const rawDate = cleanText(stripTags(matchFirst(itemHtml, [/<span[^>]+class=["']s2["'][^>]*>([\s\S]*?)<\/span>/i])));
    const publishedAt = parseSogouDate(rawDate);

    results.push({
      url,
      keyword: matchedKeyword || defaultKeyword,
      type: "article",
      title,
      author,
      publishedAt,
      summary: snippet,
      tags: [],
    });
  }

  return results;
}

function normalizeWechatUrl(value) {
  if (!value) return "";
  const decoded = decodeHtml(value);

  if (decoded.startsWith("https://mp.weixin.qq.com/s/")) return decoded;
  if (decoded.startsWith("http://mp.weixin.qq.com/s/")) return decoded.replace("http://", "https://");

  if (decoded.startsWith("/link?")) {
    return `https://weixin.sogou.com${decoded}`;
  }

  if (decoded.startsWith("https://weixin.sogou.com/link?")) {
    return decoded;
  }

  return "";
}

function stripTags(value) {
  return decodeHtml(value.replace(/<[^>]+>/g, ""));
}

function parseSogouDate(value) {
  const timestamp = value.match(/timeConvert\(['"]?(\d+)['"]?\)/)?.[1];
  if (timestamp) return parseDate(timestamp);
  return parseDate(value) || value;
}

function matchFirst(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function isCaptchaPage(html) {
  return html.includes("此验证码用于确认") || html.includes("请输入验证码") || html.includes("VerifyCode");
}

function pickExactKeyword(text) {
  return exactKeywords.find((item) => text.includes(item)) || "";
}

function getArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}
