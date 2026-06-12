const state = {
  platform: "all",
  category: "all",
  type: "all",
  query: "",
  sort: "newest",
  items: [],
};

const platformLabels = {
  "wechat-search": "微信搜索",
  "csu-bridge-center": "中南大学古桥研究中心",
  "hunan-cppcc-news": "湖南政协新闻网",
  "yueyang-news": "岳阳新闻网",
  "visit-beijing": "北京旅游网",
  "changsha-evening-news": "长沙晚报网",
  bilibili: "B站",
  weibo: "微博",
};

const typeLabels = {
  article: "文章",
  video: "视频",
};

const grid = document.querySelector("#contentGrid");
const template = document.querySelector("#itemTemplate");
const emptyState = document.querySelector("#emptyState");
const resultMeta = document.querySelector("#resultMeta");
const searchInput = document.querySelector("#searchInput");
const sortSelect = document.querySelector("#sortSelect");

async function loadItems() {
  try {
    const response = await fetch("./data/items.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.items = await response.json();
    render();
  } catch (error) {
    resultMeta.textContent = "数据载入失败，请通过本地服务器打开页面。";
    console.error(error);
  }
}

function getFilteredItems() {
  const query = state.query.trim().toLowerCase();

  return state.items
    .filter((item) => state.platform === "all" || item.platform === state.platform)
    .filter((item) => {
      if (state.category === "all") return true;
      const isHomework = (item.tags || []).includes("作业展示");
      return state.category === "homework" ? isHomework : !isHomework;
    })
    .filter((item) => state.type === "all" || item.type === state.type)
    .filter((item) => {
      if (!query) return true;
      const haystack = [
        item.title,
        item.author,
        item.summary,
        item.excerpt,
        item.keyword,
        item.sourceUrl,
        platformLabels[item.platform],
        typeLabels[item.type],
        ...(item.tags || []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => {
      if (state.sort === "engagement") return b.engagement - a.engagement;
      const left = new Date(a.publishedAt).getTime();
      const right = new Date(b.publishedAt).getTime();
      return state.sort === "oldest" ? left - right : right - left;
    });
}

function render() {
  const items = getFilteredItems();
  grid.innerHTML = "";

  for (const item of items) {
    const node = template.content.cloneNode(true);
    const card = node.querySelector(".item-card");
    const platform = node.querySelector(".platform-pill");
    const type = node.querySelector(".type-pill");
    const category = node.querySelector(".category-pill");
    const time = node.querySelector("time");
    const title = node.querySelector("h3");
    const summary = node.querySelector(".summary");
    const tags = node.querySelector(".item-tags");
    const link = node.querySelector(".source-link");
    const urlStatus = getUrlStatus(item);
    const isHomework = (item.tags || []).includes("作业展示");

    card.dataset.platform = item.platform;
    card.dataset.urlStatus = urlStatus;
    platform.textContent = platformLabels[item.platform] || item.platform;
    type.textContent = typeLabels[item.type] || item.type;
    category.textContent = "作业展示";
    category.hidden = !isHomework;
    time.textContent = item.displayDate || formatDate(item.publishedAt);
    time.dateTime = item.publishedAt;
    title.textContent = item.title;
    summary.textContent = item.summary;
    renderTags(tags, item.tags, isHomework ? ["作业展示"] : []);

    if (urlStatus === "exact") {
      link.href = item.sourceUrl;
      link.textContent = "查看原文";
      link.setAttribute("aria-label", `打开原文：${item.title}`);
    } else {
      link.removeAttribute("href");
      link.textContent = "缺少原文链接";
      link.setAttribute("aria-disabled", "true");
      link.setAttribute("title", "这条数据没有可验证的原内容页链接，不会跳转到搜索页或平台首页。");
    }

    grid.append(node);
  }

  emptyState.hidden = items.length > 0;
  const exactCount = items.filter((item) => getUrlStatus(item) === "exact").length;
  resultMeta.textContent = `当前显示 ${items.length} / ${state.items.length} 条，${exactCount} 条可回跳原文`;
  updateStats(items);
}

function renderTags(container, tags = [], excludedTags = []) {
  container.innerHTML = "";
  const excluded = new Set(excludedTags);
  const visibleTags = [...new Set(tags)].filter((tag) => tag && !excluded.has(tag));
  container.hidden = visibleTags.length === 0;

  for (const tag of visibleTags) {
    const pill = document.createElement("span");
    pill.textContent = tag;
    container.append(pill);
  }
}

function updateStats(items) {
  const articles = items.filter((item) => item.type === "article").length;
  const videos = items.filter((item) => item.type === "video").length;
  const sources = new Set(items.map((item) => item.platform)).size;

  document.querySelector("#totalCount").textContent = items.length;
  document.querySelector("#articleCount").textContent = articles;
  document.querySelector("#videoCount").textContent = videos;
  document.querySelector("#sourceCount").textContent = sources;
}

function formatDate(value) {
  if (!value) return "未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function getUrlStatus(item) {
  const sourceUrl = item.sourceUrl || item.url || "";
  if (!sourceUrl) return "missing";

  try {
    const parsed = new URL(sourceUrl);
    const path = parsed.pathname.replace(/\/+$/, "");
    const isAllowedWeiboTopic =
      parsed.hostname === "s.weibo.com" && parsed.pathname === "/weibo" && parsed.searchParams.has("q");
    const isSearchPage =
      parsed.hostname.includes("sogou.com") ||
      (parsed.hostname.includes("s.weibo.com") && !isAllowedWeiboTopic) ||
      parsed.pathname.includes("/search") ||
      (parsed.searchParams.has("q") && !isAllowedWeiboTopic) ||
      parsed.searchParams.has("query");
    const isHomepage = path === "" || path === "/";

    return isSearchPage || isHomepage ? "not-exact" : "exact";
  } catch {
    return "missing";
  }
}

function setActiveButton(button) {
  const filter = button.dataset.filter;
  document.querySelectorAll(`[data-filter="${filter}"]`).forEach((item) => {
    item.classList.toggle("is-active", item === button);
  });
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  state[button.dataset.filter] = button.dataset.value;
  setActiveButton(button);
  render();
});

searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});

sortSelect.addEventListener("change", (event) => {
  state.sort = event.target.value;
  render();
});

loadItems();
