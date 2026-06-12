import fs from "node:fs";
import path from "node:path";

export const keywords = ["诗话桥", "诗画桥"];

export function readJson(file, fallback = []) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function readLinks(platform) {
  return readJson(`data/links/${platform}.json`, []).filter((item) => item.url || item.localFile);
}

export async function fetchHtml(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 20000);
  const headers = {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    ...options.headers,
  };

  if (options.cookie) headers.cookie = options.cookie;

  try {
    const response = await fetch(url, {
      headers,
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      text,
      contentType: response.headers.get("content-type") || "",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJson(url, options = {}) {
  const response = await fetchHtml(url, {
    ...options,
    headers: {
      accept: "application/json,text/plain,*/*",
      ...(options.headers || {}),
    },
  });
  return {
    ...response,
    json: safeJson(response.text),
  };
}

export function mergeItems(newItems, outputFile = "data/items.json") {
  const oldItems = readJson(outputFile, []);
  const byId = new Map(oldItems.map((item) => [item.id, item]));

  for (const item of newItems.filter(Boolean)) {
    byId.set(item.id, item);
  }

  const merged = [...byId.values()].sort((a, b) => {
    return new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime();
  });

  writeJson(outputFile, merged);
  return merged;
}

export function makeId(platform, sourceUrl) {
  const url = new URL(sourceUrl);
  const slug = `${url.hostname}${url.pathname}${url.search}`.replace(/[^a-zA-Z0-9]+/g, "-");
  return `${platform}-${slug}`.replace(/-+/g, "-").replace(/-$/, "").toLowerCase();
}

export function extractMeta(html, name) {
  const escaped = escapeRegExp(name);
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return cleanText(decodeHtml(match[1]));
  }

  return "";
}

export function extractTitle(html) {
  return (
    extractMeta(html, "og:title") ||
    extractMeta(html, "twitter:title") ||
    cleanText(decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ""))
  );
}

export function extractDescription(html) {
  return (
    extractMeta(html, "description") ||
    extractMeta(html, "og:description") ||
    extractMeta(html, "twitter:description")
  );
}

export function extractFirst(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return cleanText(decodeHtml(match[1]));
  }
  return "";
}

export function stripHtml(html) {
  return cleanText(
    decodeHtml(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

export function cleanText(value = "") {
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeHtml(value = "") {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " ",
    middot: "·",
    ldquo: "“",
    rdquo: "”",
    lsquo: "‘",
    rsquo: "’",
    hellip: "...",
    mdash: "-",
    ndash: "-",
  };

  return String(value).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity) => {
    const lower = entity.toLowerCase();
    if (lower[0] === "#") {
      const code = lower[1] === "x" ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    }
    return named[lower] || _;
  });
}

export function pickKeyword(text, fallback = "") {
  return keywords.find((keyword) => text.includes(keyword)) || fallback || keywords[0];
}

export function makeSummary({ description, body, keyword }) {
  const desc = cleanText(description);
  if (desc.length >= 24) {
    return {
      summary: truncate(desc, 150),
      summarySource: "meta_description",
    };
  }

  const around = contextAroundKeyword(body, keyword);
  if (around.length >= 24) {
    return {
      summary: truncate(around, 150),
      summarySource: "raw_excerpt",
    };
  }

  return {
    summary: truncate(cleanText(body), 150),
    summarySource: "raw_excerpt",
  };
}

export function contextAroundKeyword(text, keyword, radius = 70) {
  const cleaned = cleanText(text);
  if (!keyword) return truncate(cleaned, radius * 2);
  const index = cleaned.indexOf(keyword);
  if (index < 0) return truncate(cleaned, radius * 2);
  const start = Math.max(0, index - radius);
  const end = Math.min(cleaned.length, index + keyword.length + radius);
  return `${start > 0 ? "..." : ""}${cleaned.slice(start, end)}${end < cleaned.length ? "..." : ""}`;
}

export function truncate(text, max = 160) {
  const cleaned = cleanText(text);
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}...`;
}

export function parseDate(value) {
  if (!value) return "";
  const text = cleanText(String(value));
  const isoMatch = text.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[ T]\d{1,2}:\d{1,2}(?::\d{1,2})?)?/);
  if (isoMatch) return normalizeDate(isoMatch[0]);

  const timestamp = Number(text);
  if (Number.isFinite(timestamp) && timestamp > 0) {
    const ms = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
    return new Date(ms).toISOString().slice(0, 10);
  }

  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? "" : new Date(parsed).toISOString().slice(0, 10);
}

export function normalizeDate(value) {
  const normalized = value.replace(/\//g, "-").replace(" ", "T");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

export function capturedAt() {
  return new Date().toISOString();
}

export function getCookie(envName) {
  return process.env[envName] || "";
}

export function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function cliOutputFile(defaultFile = "data/items.json") {
  const outIndex = process.argv.indexOf("--out");
  return outIndex >= 0 ? process.argv[outIndex + 1] || defaultFile : defaultFile;
}

export function shouldMerge() {
  return !process.argv.includes("--print");
}

export function printRunResult(platform, items, outputFile) {
  if (process.argv.includes("--print")) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }

  console.log(`${platform}: 写入 ${items.length} 条到 ${outputFile}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
