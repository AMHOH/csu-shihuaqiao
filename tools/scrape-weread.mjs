import fs from "node:fs";
import {
  capturedAt,
  cliOutputFile,
  extractDescription,
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

const platform = "weread";
const outputFile = cliOutputFile();
const cookie = getCookie("WEREAD_COOKIE");
const links = readLinks(platform);
const items = [];

for (const link of links) {
  if (link.localFile) {
    items.push(...readWereadExport(link));
    continue;
  }

  if (!isWereadUrl(link.url)) {
    console.warn(`跳过非微信读书链接：${link.url}`);
    continue;
  }

  const page = await fetchHtml(link.url, { cookie });
  if (!page.ok) {
    console.warn(`跳过 ${link.url}: HTTP ${page.status}`);
    continue;
  }

  const html = page.text;
  const title = link.title || extractTitle(html).replace(/微信读书$/, "").trim() || "微信读书内容";
  const description = link.summary || extractDescription(html);
  const body = stripHtml(html);
  const keyword = link.keyword || pickKeyword(`${title} ${description} ${body}`);
  const summary = makeSummary({ description, body, keyword });

  items.push({
    id: link.id || makeId(platform, page.url),
    platform,
    type: link.type || "note",
    keyword,
    title,
    author: link.author || "微信读书",
    ...summary,
    publishedAt: link.publishedAt || parseDate(link.date) || new Date().toISOString().slice(0, 10),
    capturedAt: capturedAt(),
    engagement: Number(link.engagement || 0),
    tags: link.tags || ["微信读书"],
    sourceUrl: page.url,
  });
}

if (shouldMerge()) mergeItems(items, outputFile);
printRunResult("微信读书", items, outputFile);

function isWereadUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === "weread.qq.com" && url.pathname !== "/";
  } catch {
    return false;
  }
}

function readWereadExport(link) {
  const raw = JSON.parse(fs.readFileSync(link.localFile, "utf8"));
  const records = Array.isArray(raw) ? raw : raw.items || raw.notes || raw.bookmarks || [];

  return records.map((record, index) => {
    const sourceUrl = record.sourceUrl || record.url || link.sourceUrl || link.url;
    const text = record.summary || record.note || record.markText || record.text || record.content || "";
    const title = record.title || record.bookTitle || link.title || "微信读书摘录";
    const keyword = record.keyword || link.keyword || pickKeyword(`${title} ${text}`);

    return {
      id: record.id || `${makeId(platform, sourceUrl)}-${index + 1}`,
      platform,
      type: record.type || link.type || "note",
      keyword,
      title,
      author: record.author || link.author || "微信读书",
      summary: text,
      summarySource: record.summarySource || "raw_excerpt",
      publishedAt: record.publishedAt || parseDate(record.date || record.createTime) || new Date().toISOString().slice(0, 10),
      capturedAt: capturedAt(),
      engagement: Number(record.engagement || 0),
      tags: record.tags || link.tags || ["微信读书"],
      sourceUrl,
    };
  });
}
