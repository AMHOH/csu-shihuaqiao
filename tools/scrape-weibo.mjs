import {
  capturedAt,
  cleanText,
  cliOutputFile,
  fetchHtml,
  fetchJson,
  getCookie,
  makeId,
  mergeItems,
  parseDate,
  pickKeyword,
  printRunResult,
  readLinks,
  shouldMerge,
  stripHtml,
  truncate,
} from "./lib/common.mjs";

const platform = "weibo";
const outputFile = cliOutputFile();
const cookie = getCookie("WEIBO_COOKIE");
const links = readLinks(platform);
const items = [];

for (const link of links) {
  const mid = extractMid(link.url);
  if (!mid) {
    if (link.summary) {
      items.push(makeManualWeiboItem(link, link.url));
      continue;
    }
    console.warn(`跳过无法识别 mid 的微博链接：${link.url}`);
    continue;
  }

  const webApi = await fetchJson(`https://weibo.com/ajax/statuses/show?id=${encodeURIComponent(mid)}`, {
    cookie,
    headers: {
      referer: "https://weibo.com/",
    },
  });
  const webData = webApi.json;
  if (webData?.idstr || webData?.mblogid) {
    const body = cleanText(stripHtml(webData.text_raw || webData.text || ""));
    if (isUsefulBody(body)) {
      const title = link.title && !link.title.startsWith("微博博文：") ? link.title : truncate(body, 42);
      const keyword = link.keyword || pickKeyword(body);
      const engagement =
        Number(webData.attitudes_count || 0) + Number(webData.comments_count || 0) + Number(webData.reposts_count || 0);

      items.push({
        id: link.id || makeId(platform, link.url),
        platform,
        type: link.type || (webData.page_info?.type === "video" ? "video" : "article"),
        keyword,
        title,
        author: webData.user?.screen_name || link.author || "微博用户",
        summary: truncate(body, 150),
        summarySource: "raw_excerpt",
        publishedAt: parseDate(webData.created_at) || link.publishedAt || new Date().toISOString().slice(0, 10),
        capturedAt: capturedAt(),
        engagement,
        tags: link.tags || ["微博"],
        sourceUrl: link.url,
      });
      continue;
    }
  }

  const apiUrl = `https://m.weibo.cn/statuses/show?id=${encodeURIComponent(mid)}`;
  const api = await fetchJson(apiUrl, { cookie });
  const data = api.json?.data;

  if (data?.id) {
    const body = stripHtml(data.text || data.longText?.longTextContent || "");
    const title = link.title || truncate(body, 42) || `微博 ${data.id}`;
    const keyword = link.keyword || pickKeyword(body);
    const engagement = Number(data.attitudes_count || 0) + Number(data.comments_count || 0) + Number(data.reposts_count || 0);
    const sourceUrl = link.url.includes("weibo.com") ? link.url : `https://m.weibo.cn/detail/${data.id}`;

    items.push({
      id: link.id || makeId(platform, sourceUrl),
      platform,
      type: link.type || (data.page_info?.type === "video" ? "video" : "article"),
      keyword,
      title,
      author: data.user?.screen_name || link.author || "微博用户",
      summary: truncate(body, 150),
      summarySource: "raw_excerpt",
      publishedAt: link.publishedAt || parseDate(data.created_at) || new Date().toISOString().slice(0, 10),
      capturedAt: capturedAt(),
      engagement,
      tags: link.tags || ["微博"],
      sourceUrl,
    });
    continue;
  }

  const page = await fetchHtml(link.url, { cookie });
  if (!page.ok) {
    if (link.summary) {
      items.push(makeManualWeiboItem(link, link.url));
      continue;
    }
    console.warn(`跳过 ${link.url}: HTTP ${page.status}`);
    continue;
  }

  const body = cleanText(stripHtml(page.text));
  if ((!isUsefulBody(body) || isVisitorPage(body)) && link.summary) {
    items.push(makeManualWeiboItem(link, link.url));
    continue;
  }
  const keyword = link.keyword || pickKeyword(body);
  items.push({
    id: link.id || makeId(platform, page.url),
    platform,
    type: link.type || "article",
    keyword,
    title: link.title || truncate(body, 42) || `微博 ${mid}`,
    author: link.author || "微博用户",
    summary: truncate(body, 150),
    summarySource: "raw_excerpt",
    publishedAt: link.publishedAt || new Date().toISOString().slice(0, 10),
    capturedAt: capturedAt(),
    engagement: Number(link.engagement || 0),
    tags: link.tags || ["微博"],
    sourceUrl: page.url,
  });
}

if (shouldMerge()) mergeItems(items, outputFile);
printRunResult("微博", items, outputFile);

function makeManualWeiboItem(link, sourceUrl) {
  return {
    id: link.id || makeId(platform, sourceUrl),
    platform,
    type: link.type || "article",
    keyword: link.keyword || "诗话桥",
    title: link.title || "微博内容",
    author: link.author || "微博用户",
    summary: link.summary,
    summarySource: "manual_verified",
    publishedAt: link.publishedAt || new Date().toISOString().slice(0, 10),
    capturedAt: capturedAt(),
    engagement: Number(link.engagement || 0),
    tags: link.tags || ["微博"],
    sourceUrl,
  };
}

function extractMid(value) {
  try {
    const url = new URL(value);
    const detail = url.pathname.match(/\/detail\/([A-Za-z0-9]+)/);
    if (detail) return detail[1];
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.at(-1) || url.searchParams.get("id") || "";
  } catch {
    return "";
  }
}

function isVisitorPage(body) {
  return body.includes("Sina Visitor System") || body.includes("passport.weibo.com/visitor");
}

function isUsefulBody(body) {
  const text = cleanText(body);
  return text.length >= 24 && !text.includes("{{") && text !== "微博" && text !== "视频 - 微博 微博视频";
}
