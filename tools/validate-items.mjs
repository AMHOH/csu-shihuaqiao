import fs from "node:fs";

const file = process.argv[2] || "data/items.json";
const items = JSON.parse(fs.readFileSync(file, "utf8"));

const validPlatforms = new Set([
  "wechat-search",
  "csu-bridge-center",
  "site-homework",
  "hunan-cppcc-news",
  "yueyang-news",
  "visit-beijing",
  "changsha-evening-news",
  "xingchen-news",
  "bilibili",
  "weibo",
]);
const validTypes = new Set(["article", "video", "file"]);
const validSummarySources = new Set([
  "raw_excerpt",
  "meta_description",
  "generated_from_fulltext",
  "manual_verified",
]);

const problems = [];

items.forEach((item, index) => {
  const label = item.id || `#${index + 1}`;

  requireText(item, "id", label);
  requireText(item, "title", label);
  requireText(item, "summary", label);
  requireText(item, "sourceUrl", label);
  requireText(item, "publishedAt", label);
  requireText(item, "capturedAt", label);

  if (!validPlatforms.has(item.platform)) {
    problems.push(`${label}: platform 必须是 ${[...validPlatforms].join(", ")}`);
  }

  if (!validTypes.has(item.type)) {
    problems.push(`${label}: type 必须是 ${[...validTypes].join(", ")}`);
  }

  if (!validSummarySources.has(item.summarySource)) {
    problems.push(`${label}: summarySource 必须是 ${[...validSummarySources].join(", ")}`);
  }

  if (item.sourceUrl && !isExactContentUrl(item.sourceUrl)) {
    problems.push(`${label}: sourceUrl 不是具体内容页，不能是搜索页、首页或无效 URL`);
  }

  if (item.summary && item.summary.length < 24) {
    problems.push(`${label}: summary 太短，建议保留能说明内容主题的准确摘要`);
  }
});

if (problems.length) {
  console.error(`发现 ${problems.length} 个数据问题：`);
  problems.forEach((problem) => console.error(`- ${problem}`));
  process.exit(1);
}

console.log(`通过：${items.length} 条内容都有精准链接和摘要标注。`);

function requireText(item, key, label) {
  if (typeof item[key] !== "string" || item[key].trim() === "") {
    problems.push(`${label}: 缺少 ${key}`);
  }
}

function isExactContentUrl(value) {
  try {
    const parsed = new URL(value);
    const path = parsed.pathname.replace(/\/+$/, "");
    const isSiteContent = parsed.protocol === "site:" && value.startsWith("site://homework/");
    const isSearchPage =
      parsed.hostname.includes("sogou.com") ||
      parsed.pathname.includes("/search") ||
      (parsed.searchParams.has("q") && parsed.hostname !== "s.weibo.com") ||
      parsed.searchParams.has("query");
    const isHomepage = path === "" || path === "/";

    return isSiteContent || (!isSearchPage && !isHomepage);
  } catch {
    return false;
  }
}
