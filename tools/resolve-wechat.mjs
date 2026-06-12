import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { decodeHtml, readJson, writeJson } from "./lib/common.mjs";

const inputFile = getArg("--in") || "data/links/wechat.json";
const outputFile = getArg("--out") || inputFile;
const limit = Number(getArg("--limit") || 0);
const headful = process.argv.includes("--headful") || process.env.HEADFUL === "1";
const userDataDir = getArg("--user-data-dir") || path.resolve(".browser/wechat-sogou");
const chromePath = getArg("--chrome") || findChrome();
const waitMs = Number(getArg("--wait") || 12000);
const cookieHeader = process.env.SOGOU_COOKIE || "";

if (!chromePath) {
  throw new Error("没有找到 Chrome。可用 --chrome /path/to/Chrome 指定。");
}

const links = readJson(inputFile, []);
const targets = links
  .map((item, index) => ({ item, index }))
  .filter(({ item }) => isSogouWechatLink(item.url) && !item.resolvedUrl);
const selected = limit > 0 ? targets.slice(0, limit) : targets;

if (selected.length === 0) {
  console.log("没有需要解析的微信中转链接。");
  process.exit(0);
}

fs.mkdirSync(userDataDir, { recursive: true });

let context = null;
let page = null;
let resolved = 0;
let blocked = 0;

for (const { item, index } of selected) {
  console.log(`解析 ${index + 1}/${links.length}: ${item.title || item.url}`);

  try {
    let finalUrl = cookieHeader ? await resolveByFetch(item.url, cookieHeader) : "";
    if (!finalUrl) {
      ({ context, page } = await ensureBrowser({ context, page }));
      finalUrl = await resolveOne(page, item.url);
    }

    if (finalUrl) {
      links[index] = {
        ...item,
        url: finalUrl,
        resolvedUrl: finalUrl,
        sogouUrl: item.sogouUrl || item.url,
      };
      resolved += 1;
      console.log(`  -> ${finalUrl}`);
    } else {
      blocked += 1;
      console.log(`  -> 未解析，可能停在反爬/验证页`);
      if (headful) {
        console.log("     请在打开的 Chrome 里完成验证后重新运行本命令。");
      }
    }
  } catch (error) {
    blocked += 1;
    console.warn(`  -> 失败：${error.message}`);
  }

  writeJson(outputFile, links);
  if (page) await page.waitForTimeout(800 + Math.floor(Math.random() * 700));
}

if (context) await context.close();

console.log(`完成：解析 ${resolved} 条，未解析 ${blocked} 条，输出 ${outputFile}`);

async function resolveOne(page, url) {
  await page.goto("https://weixin.sogou.com/", { waitUntil: "domcontentloaded", timeout: waitMs }).catch(() => {});
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: waitMs }).catch(() => {});

  for (let i = 0; i < 10; i += 1) {
    const current = page.url();
    if (isWechatArticleUrl(current)) return current;
    if (isAntiSpiderUrl(current)) {
      if (!headful) return "";
      await page.waitForTimeout(3000);
    } else {
      await page.waitForTimeout(1200);
    }
  }

  const anchors = await page
    .locator("a[href*='mp.weixin.qq.com/s/']")
    .evaluateAll((nodes) => nodes.map((node) => node.href))
    .catch(() => []);
  return anchors.find(isWechatArticleUrl) || "";
}

async function resolveByFetch(url, cookie) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      cookie,
      referer: "https://weixin.sogou.com/",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
  });

  if (isWechatArticleUrl(response.url)) return response.url;

  const buffer = Buffer.from(await response.arrayBuffer());
  const html = decodeResponse(buffer, response.headers.get("content-type") || "");
  const scriptUrl = extractWechatUrlFromScript(html);
  if (scriptUrl) return scriptUrl;

  const directUrl = html.match(/https?:\\?\/\\?\/mp\.weixin\.qq\.com[^"'<>\\\s]+/i)?.[0];
  return directUrl ? normalizeScriptUrl(directUrl) : "";
}

async function ensureBrowser(current) {
  if (current.context && current.page) return current;

  const nextContext = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromePath,
    headless: !headful,
    locale: "zh-CN",
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });

  if (cookieHeader) {
    await nextContext.addCookies(parseCookieHeader(cookieHeader, "https://weixin.sogou.com/"));
  }

  return {
    context: nextContext,
    page: await nextContext.newPage(),
  };
}

function decodeResponse(buffer, contentType) {
  const charset = contentType.match(/charset=([^;\s]+)/i)?.[1]?.toLowerCase() || "utf-8";
  const decoder = new TextDecoder(charset === "gb2312" ? "gbk" : charset);
  return decoder.decode(buffer);
}

function extractWechatUrlFromScript(html) {
  const chunks = [...html.matchAll(/url\s*\+=\s*(['"])([\s\S]*?)\1\s*;/g)].map((match) => match[2]);
  if (chunks.length === 0) return "";
  const url = normalizeScriptUrl(chunks.join(""));
  return isWechatArticleUrl(url) ? url : "";
}

function normalizeScriptUrl(value) {
  return decodeHtml(value)
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, "")
    .trim();
}

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

function isAntiSpiderUrl(value) {
  try {
    const url = new URL(value);
    return url.pathname.includes("/antispider");
  } catch {
    return false;
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function getArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function parseCookieHeader(header, url) {
  const seen = new Set();
  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      if (separator < 0) return null;
      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      if (!name || seen.has(name)) return null;
      seen.add(name);
      return { name, value, url };
    })
    .filter(Boolean);
}
