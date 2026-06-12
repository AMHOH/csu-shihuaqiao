import {
  capturedAt,
  cliOutputFile,
  cleanText,
  decodeHtml,
  extractDescription,
  extractFirst,
  extractTitle,
  fetchHtml,
  getCookie,
  makeSummary,
  mergeItems,
  parseDate,
  pickKeyword,
  printRunResult,
  readLinks,
  shouldMerge,
  stripHtml,
  writeJson,
} from "./lib/common.mjs";

const platform = "wechat-search";
const outputFile = cliOutputFile();
const pendingFile = getArg("--pending") || "data/review/wechat-pending.json";
const cookie = getCookie("WECHAT_COOKIE");
const links = readLinks("wechat");
const items = [];
const pendingItems = [];
const seenItems = new Set();
const exactKeywords = ["诗话桥", "诗画桥"];
const authorityTerms = ["中南大学", "杨雨", "何旭辉"];

for (const link of links) {
  if (!isWechatArticleUrl(link.url) && !isSogouWechatLink(link.url)) {
    console.warn(`跳过非微信公众号文章或搜狗微信中转链接：${link.url}`);
    continue;
  }

  const page = await fetchHtml(link.url, {
    cookie,
    headers: {
      referer: "https://weixin.sogou.com/",
    },
  });
  if (!page.ok) {
    console.warn(`跳过 ${link.url}: HTTP ${page.status}`);
    continue;
  }
  if (!isWechatArticleUrl(page.url)) {
    console.warn(`跳过未跳转到公众号原文的链接：${link.url}`);
    continue;
  }

  const html = page.text;
  const title =
    cleanText(decodeHtml(link.title || "")) ||
    jsString(html, "msg_title") ||
    cleanText(extractTitle(html).replace(/^微信公众平台$/, ""));
  const author = jsString(html, "nickname") || jsString(html, "author") || link.author || "微信公众号";
  const description = jsString(html, "msg_desc") || extractDescription(html) || cleanText(decodeHtml(link.summary || ""));
  const contentHtml = html.match(/<div[^>]+id=["']js_content["'][^>]*>([\s\S]*?)<\/div>\s*<script/i)?.[1] || "";
  const body = stripHtml(contentHtml || html);
  const keyword = pickExactKeyword(`${title} ${description} ${body}`) || link.keyword || pickKeyword(`${title} ${description} ${body}`);
  if (!body.includes(keyword)) {
    console.warn(`跳过正文未出现 ${keyword} 的文章：${title}`);
    continue;
  }

  const fullText = `${title} ${description} ${body}`;
  const hasExtendedKeyword = isExtendedKeywordUse(fullText, keyword);
  const hasAuthority = authorityTerms.some((term) => fullText.includes(term));
  if (hasExtendedKeyword && !hasAuthority) {
    pendingItems.push({
      title,
      author,
      keyword,
      publishedAt: parseDate(link.publishedAt) || parseDate(jsNumber(html, "ct")) || "",
      reason: `含有${keyword}扩展词，但正文未出现${authorityTerms.join(" / ")}`,
      sourceUrl: page.url,
      sogouUrl: link.sogouUrl || (isSogouWechatLink(link.url) ? link.url : ""),
      summary: makeSummary({ description, body, keyword }).summary,
    });
    console.warn(`待人工判断：${title}`);
    continue;
  }

  const summary = makeSummary({ description, body, keyword });
  const timestamp = jsNumber(html, "ct");
  const publishedAt = parseDate(link.publishedAt) || parseDate(timestamp) || new Date().toISOString().slice(0, 10);
  const fingerprint = makeWechatFingerprint({ keyword, publishedAt, author, title });
  if (seenItems.has(fingerprint)) {
    console.warn(`跳过重复文章：${title}`);
    continue;
  }
  seenItems.add(fingerprint);

  items.push({
    id: fingerprint,
    platform,
    type: link.type || "article",
    keyword,
    title,
    author,
    ...summary,
    publishedAt,
    capturedAt: capturedAt(),
    engagement: Number(link.engagement || 0),
    tags: link.tags || [],
    sourceUrl: page.url,
  });
}

if (shouldMerge()) mergeItems(items, outputFile);
if (shouldMerge()) writeJson(pendingFile, pendingItems);
printRunResult("微信文章", items, outputFile);
if (shouldMerge()) console.log(`待判断：${pendingItems.length} 条 -> ${pendingFile}`);

function isWechatArticleUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === "mp.weixin.qq.com" && url.pathname.startsWith("/s");
  } catch {
    return false;
  }
}

function isSogouWechatLink(value) {
  try {
    const url = new URL(value);
    return url.hostname === "weixin.sogou.com" && url.pathname === "/link";
  } catch {
    return false;
  }
}

function makeWechatFingerprint({ keyword, publishedAt, author, title }) {
  return [
    platform,
    keyword || "",
    publishedAt || "",
    author || "",
    title || "",
  ]
    .join("-")
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function jsString(html, name) {
  const htmlDecodeMatch = html.match(
    new RegExp(`var\\s+${name}\\s*=\\s*htmlDecode\\(\\s*["']((?:\\\\.|[^"'\\\\])*)["']\\s*\\)\\s*;`, "i"),
  );
  const plainMatch = html.match(new RegExp(`var\\s+${name}\\s*=\\s*["']((?:\\\\.|[^"'\\\\])*)["']\\s*;`, "i"));
  const value = htmlDecodeMatch?.[1] || plainMatch?.[1] || "";

  return value ? cleanText(decodeHtml(unescapeJsString(value))) : "";
}

function jsNumber(html, name) {
  return extractFirst(html, [new RegExp(`var\\s+${name}\\s*=\\s*['"]?([0-9]+)['"]?\\s*;`, "i")]);
}

function unescapeJsString(value) {
  return value
    .replace(/\\x([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\"/g, "\"")
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");
}

function pickExactKeyword(text) {
  return exactKeywords.find((item) => text.includes(item)) || "";
}

function isExtendedKeywordUse(text, keyword) {
  if (!keyword) return false;
  return new RegExp(`${escapeRegExp(keyword)}[\\u4e00-\\u9fa5]`).test(text);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}
