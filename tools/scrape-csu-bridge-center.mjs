import {
  capturedAt,
  cleanText,
  contextAroundKeyword,
  decodeHtml,
  extractDescription,
  fetchHtml,
  makeId,
  mergeItems,
  printRunResult,
  shouldMerge,
  stripHtml,
  truncate,
  writeJson,
} from "./lib/common.mjs";

const platform = "csu-bridge-center";
const baseUrl = "https://civil.csu.edu.cn/abrccsu/shql.htm";
const outputFile = getArg("--out") || "data/items.json";
const linksFile = getArg("--links-out") || "data/links/csu-bridge-center.json";
const sourceTag = "中南大学古桥研究中心";

const listUrls = await discoverListPages(baseUrl);
const articleLinks = new Map();

for (const listUrl of listUrls) {
  const page = await fetchHtml(listUrl);
  if (!page.ok) {
    console.warn(`跳过列表页 ${listUrl}: HTTP ${page.status}`);
    continue;
  }

  for (const link of extractArticleLinks(page.text, page.url)) {
    articleLinks.set(link.url, { ...articleLinks.get(link.url), ...link });
  }
}

const items = [];

for (const link of articleLinks.values()) {
  const page = await fetchHtml(link.url);
  if (!page.ok) {
    console.warn(`跳过文章 ${link.url}: HTTP ${page.status}`);
    continue;
  }

  const html = page.text;
  const title = extractTitle(html) || link.title;
  const contentHtml = extractContentHtml(html);
  const body = stripHtml(contentHtml || html);
  const publishedAt = extractPublishedAt(html) || "2020-01-01";
  const description = extractDescription(html);
  const summary = makeCsuSummary({ description, body });

  if (!title || !body) {
    console.warn(`跳过无法解析标题或正文的文章：${link.url}`);
    continue;
  }

  items.push({
    id: makeId(platform, page.url),
    platform,
    type: "article",
    keyword: "诗话桥",
    title,
    author: extractAuthor(body),
    summary,
    summarySource: description ? "meta_description" : "raw_excerpt",
    publishedAt,
    capturedAt: capturedAt(),
    engagement: 0,
    tags: [sourceTag, "诗话桥梁"],
    sourceUrl: page.url,
  });
}

const sortedLinks = [...articleLinks.values()].sort((a, b) => a.url.localeCompare(b.url));
if (shouldMerge()) writeJson(linksFile, sortedLinks);
if (shouldMerge()) mergeItems(items, outputFile);
printRunResult(sourceTag, items, outputFile);
if (shouldMerge()) console.log(`链接清单：${sortedLinks.length} 条 -> ${linksFile}`);

async function discoverListPages(startUrl) {
  const seen = new Set();
  const queue = [startUrl];

  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);

    const page = await fetchHtml(url);
    if (!page.ok) continue;

    for (const href of extractHrefValues(page.text)) {
      const nextUrl = normalizeUrl(href, page.url);
      if (isListPage(nextUrl) && !seen.has(nextUrl)) queue.push(nextUrl);
    }
  }

  return [...seen].sort();
}

function extractArticleLinks(html, pageUrl) {
  const links = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const url = normalizeUrl(match[1], pageUrl);
    if (!isArticlePage(url)) continue;

    const title = cleanText(stripHtml(match[2]));
    if (!title) continue;

    links.push({ url, title });
  }

  return links;
}

function extractHrefValues(html) {
  return [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map((match) => match[1]);
}

function normalizeUrl(href, pageUrl) {
  try {
    return new URL(decodeHtml(href), pageUrl).href;
  } catch {
    return "";
  }
}

function isListPage(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "civil.csu.edu.cn" && /^\/abrccsu\/(?:shql\.htm|shql\/\d+\.htm)$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isArticlePage(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "civil.csu.edu.cn" && /^\/info\/1622\/\d+\.htm$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function extractTitle(html) {
  return cleanText(decodeHtml(html.match(/<h1[^>]+class=["']title["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1] || ""));
}

function extractContentHtml(html) {
  return html.match(/<div[^>]+class=["']v_news_content["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i)?.[1] || "";
}

function extractPublishedAt(html) {
  const clockLine = html.match(/fa-clock-o[\s\S]{0,160}?(\d{4}-\d{1,2}-\d{1,2}(?:\s+\d{1,2}:\d{1,2})?)/i)?.[1] || "";
  const date = clockLine.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!date) return "";
  return `${date[1]}-${date[2].padStart(2, "0")}-${date[3].padStart(2, "0")}`;
}

function makeCsuSummary({ description, body }) {
  const desc = cleanText(description);
  if (desc.length >= 24) return truncate(desc, 150);

  const excerpt = contextAroundKeyword(body, "诗话桥", 80);
  if (excerpt.length >= 24) return truncate(excerpt, 150);

  return truncate(body, 150);
}

function extractAuthor(body) {
  const author = body.match(/作者简介[:：]\s*([^，。；;]+)/)?.[1] || "";
  return cleanText(author) || sourceTag;
}

function getArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}
