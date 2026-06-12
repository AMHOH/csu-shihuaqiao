import {
  capturedAt,
  cliOutputFile,
  extractDescription,
  extractFirst,
  extractTitle,
  fetchHtml,
  getCookie,
  makeId,
  makeSummary,
  mergeItems,
  parseDate,
  pickKeyword,
  printRunResult,
  readLinks,
  shouldMerge,
  stripHtml,
} from "./lib/common.mjs";

const platform = "douban";
const outputFile = cliOutputFile();
const cookie = getCookie("DOUBAN_COOKIE");
const links = readLinks(platform);
const items = [];

for (const link of links) {
  if (!isDoubanContentUrl(link.url)) {
    console.warn(`跳过非豆瓣具体内容页：${link.url}`);
    continue;
  }

  const page = await fetchHtml(link.url, { cookie });
  if (!page.ok) {
    console.warn(`跳过 ${link.url}: HTTP ${page.status}`);
    continue;
  }

  const html = page.text;
  const title = cleanDoubanTitle(extractTitle(html));
  const description = extractDescription(html);
  const articleHtml = extractFirstRaw(html, [
    /<div[^>]+class=["'][^"']*(?:note|article|topic-content|review-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*(?:<div|<script|<footer)/i,
    /<div[^>]+id=["']link-report["'][^>]*>([\s\S]*?)<\/div>/i,
  ]);
  const body = stripHtml(articleHtml || html);
  const keyword = link.keyword || pickKeyword(`${title} ${description} ${body}`);
  const summary = makeSummary({ description, body, keyword });
  const publishedAt =
    link.publishedAt ||
    parseDate(extractFirst(html, [
      /<time[^>]+datetime=["']([^"']+)["']/i,
      /(?:create_time|published_time|datePublished)["']?\s*[:=]\s*["']([^"']+)["']/i,
      /(\d{4}-\d{1,2}-\d{1,2})/i,
    ])) ||
    new Date().toISOString().slice(0, 10);

  items.push({
    id: link.id || makeId(platform, page.url),
    platform,
    type: link.type || guessDoubanType(page.url),
    keyword,
    title,
    author: link.author || extractFirst(html, [/rel=["']author["'][^>]*>([^<]+)/i, /<span[^>]+class=["']from["'][^>]*>([^<]+)/i]) || "豆瓣用户",
    ...summary,
    publishedAt,
    capturedAt: capturedAt(),
    engagement: Number(link.engagement || 0),
    tags: link.tags || ["豆瓣"],
    sourceUrl: page.url,
  });
}

if (shouldMerge()) mergeItems(items, outputFile);
printRunResult("豆瓣", items, outputFile);

function isDoubanContentUrl(value) {
  try {
    const url = new URL(value);
    return /(^|\.)douban\.com$/.test(url.hostname) && !url.pathname.includes("/search") && url.pathname !== "/";
  } catch {
    return false;
  }
}

function guessDoubanType(url) {
  if (url.includes("/video/")) return "video";
  if (url.includes("/note/") || url.includes("/status/")) return "note";
  return "article";
}

function cleanDoubanTitle(title) {
  return title.replace(/\s*\(豆瓣\)\s*$/, "").replace(/\s*_豆瓣\s*$/, "").trim();
}

function extractFirstRaw(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}
