const SESSION_DURATION_MS = 2 * 60 * 60 * 1000;
const IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const DOCUMENT_MAX_BYTES = 100 * 1024 * 1024;

const state = {
  platform: "all",
  category: "all",
  type: "all",
  query: "",
  sort: "newest",
  items: [],
  remoteItems: [],
  pendingItems: [],
  siteItems: [],
  currentUser: null,
  activeRoute: "landing",
  pendingRoute: "publish",
  publishKind: "article",
  otpEmail: "",
  otpVerification: null,
};

const platformLabels = {
  "wechat-search": "微信公众号",
  "csu-bridge-center": "中南大学古桥研究中心",
  "site-homework": "站内资源",
  "hunan-cppcc-news": "湖南政协新闻网",
  "yueyang-news": "岳阳新闻网",
  "visit-beijing": "北京旅游网",
  "changsha-evening-news": "长沙晚报网",
  "xingchen-news": "星辰在线",
  bilibili: "B站",
  weibo: "微博",
};

const typeLabels = {
  article: "文章",
  file: "文件",
  video: "视频",
};

const uploaderLabels = {
  "site-homework": "上传者",
};

const apiBase = (document.querySelector('meta[name="bridge-api-base"]')?.content.trim() || "").replace(/\/+$/, "");
const cloudbaseEnv = document.querySelector('meta[name="bridge-cloudbase-env"]')?.content.trim() || "";
const cloudbaseRegion = document.querySelector('meta[name="bridge-cloudbase-region"]')?.content.trim() || "";
const cloudbaseFunctionName = document.querySelector('meta[name="bridge-cloudbase-function"]')?.content.trim() || "bridge-api";
const fallbackAdminEmails = new Set(
  (document.querySelector('meta[name="bridge-admin-emails"]')?.content || "")
    .split(/[,，\s]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

let cloudbaseApp = null;
let cloudbaseAuth = null;
let richTextEditor = null;
let editorImageAttachments = [];

const landingView = document.querySelector("#landingView");
const appHeader = document.querySelector("#appHeader");
const appMain = document.querySelector("#appMain");
const backHomeButton = document.querySelector("#backHomeButton");
const archiveView = document.querySelector("#archiveView");
const authView = document.querySelector("#authView");
const publishView = document.querySelector("#publishView");
const manageSiteView = document.querySelector("#manageSiteView");
const grid = document.querySelector("#contentGrid");
const template = document.querySelector("#itemTemplate");
const emptyState = document.querySelector("#emptyState");
const resultMeta = document.querySelector("#resultMeta");
const searchInput = document.querySelector("#searchInput");
const sortSelect = document.querySelector("#sortSelect");
const authForm = document.querySelector("#authForm");
const authTitle = document.querySelector("#authTitle");
const authCopy = document.querySelector(".auth-copy");
const authSubmit = document.querySelector("#authSubmit");
const authEmail = document.querySelector("#authEmail");
const authCode = document.querySelector("#authCode");
const authMessage = document.querySelector("#authMessage");
const sendCodeButton = document.querySelector("#sendCodeButton");
const publishForm = document.querySelector("#publishForm");
const uploaderNameInput = document.querySelector("#uploaderNameInput");
const publishHint = document.querySelector("#publishHint");
const publishSubmit = document.querySelector("#publishSubmit");
const publishMessage = document.querySelector("#publishMessage");
const logoutButton = document.querySelector("#logoutButton");
const reviewPanel = document.querySelector("#reviewPanel");
const reviewMeta = document.querySelector("#reviewMeta");
const reviewList = document.querySelector("#reviewList");
const manageSiteMeta = document.querySelector("#manageSiteMeta");
const manageSiteList = document.querySelector("#manageSiteList");
const publishKindInput = document.querySelector("#publishKind");
const articleFields = document.querySelector("#articleFields");
const fileFields = document.querySelector("#fileFields");
const articleEditor = document.querySelector("#articleEditor");
const articleToolbar = document.querySelector("#articleToolbar");
const documentFileInput = document.querySelector("#documentFileInput");
const detailDialog = document.querySelector("#detailDialog");
const detailCloseButton = document.querySelector("#detailCloseButton");
const detailPlatform = document.querySelector("#detailPlatform");
const detailType = document.querySelector("#detailType");
const detailDate = document.querySelector("#detailDate");
const detailTitle = document.querySelector("#detailTitle");
const detailBody = document.querySelector("#detailBody");
const detailFiles = document.querySelector("#detailFiles");

const storageKeys = {
  session: "bridge-session",
  publicItems: "bridge-public-items",
  pendingItems: "bridge-pending-items",
};

const api = {
  async request(action, data = {}) {
    if (cloudbaseEnv) {
      const app = getCloudbaseApp();
      const response = await app.callFunction({
        name: cloudbaseFunctionName,
        data: { action, data },
      });
      const payload = response.result || {};
      if (payload.ok === false) throw new Error(payload.message || "云函数请求失败。");
      return payload.data || payload;
    }

    if (apiBase) {
      return requestLegacyApi(action, data);
    }

    throw new Error("API_NOT_CONFIGURED");
  },

  async me(fallbackUser) {
    return this.request("me", { fallbackUser });
  },

  async listItems() {
    return this.request("listPublicContents");
  },

  async createItem(item) {
    return this.request("submitContent", { item });
  },

  async listPendingItems() {
    return this.request("listPendingContents");
  },

  async reviewItem(id, action) {
    return this.request("reviewContent", { id, reviewAction: action });
  },

  async listSiteItems() {
    return this.request("listSiteContents");
  },

  async deleteSiteItem(id) {
    return this.request("deleteSiteContent", { id });
  },
};

async function requestLegacyApi(action, data) {
  const map = {
    listPublicContents: { path: "/items", method: "GET" },
    submitContent: { path: "/items", method: "POST", body: data.item },
    listPendingContents: { path: "/admin/pending-items", method: "GET" },
    reviewContent: {
      path: `/admin/pending-items/${encodeURIComponent(data.id)}`,
      method: "POST",
      body: { action: data.reviewAction },
    },
    listSiteContents: { path: "/admin/site-contents", method: "GET" },
    deleteSiteContent: { path: `/admin/site-contents/${encodeURIComponent(data.id)}`, method: "DELETE" },
    me: { path: "/auth/me", method: "GET" },
  };
  const target = map[action];
  if (!target) throw new Error(`未知接口：${action}`);

  const headers = { "Content-Type": "application/json" };
  if (state.currentUser?.token) headers.Authorization = `Bearer ${state.currentUser.token}`;

  const response = await fetch(`${apiBase}${target.path}`, {
    method: target.method,
    headers,
    body: target.body ? JSON.stringify(target.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
  return payload;
}

async function loadItems() {
  try {
    const response = await fetch("./data/items.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const staticItems = await response.json();
    const remoteItems = await loadRemotePublicItems();
    state.remoteItems = remoteItems;
    state.items = mergeById([...remoteItems, ...staticItems, ...getLocalPublicItems()]);
    render();
  } catch (error) {
    resultMeta.textContent = "数据载入失败，请通过本地服务器打开页面。";
    console.error(error);
  }
}

async function loadRemotePublicItems() {
  try {
    const payload = await api.listItems();
    return Array.isArray(payload) ? payload : payload.items || [];
  } catch (error) {
    if (cloudbaseEnv || apiBase) console.warn("公开内容接口不可用，已使用本地数据。", error);
    return [];
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
    .filter((item) => item.status !== "pending" && item.status !== "rejected")
    .filter((item) => {
      if (!query) return true;
      const haystack = [
        item.title,
        item.author,
        item.summary,
        item.bodyText,
        item.keyword,
        item.sourceUrl,
        item.contentKind,
        platformLabels[item.platform],
        typeLabels[item.type],
        ...(item.tags || []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => {
      const left = new Date(a.publishedAt || 0).getTime();
      const right = new Date(b.publishedAt || 0).getTime();
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
    const uploader = node.querySelector(".item-uploader");
    const tags = node.querySelector(".item-tags");
    const link = node.querySelector(".source-link");
    const urlStatus = getUrlStatus(item);
    const isHomework = (item.tags || []).includes("作业展示");
    const isSiteContent = item.platform === "site-homework";

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
    renderUploader(uploader, item);
    renderTags(tags, item.tags, isHomework ? ["作业展示"] : []);

    if (isSiteContent) {
      link.href = "#";
      link.dataset.openItem = item.id;
      link.textContent = item.type === "file" ? "查看文件" : "查看内容";
      link.setAttribute("aria-label", `打开站内内容：${item.title}`);
    } else if (urlStatus === "exact") {
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
  resultMeta.textContent = `当前显示 ${items.length} / ${state.items.length} 条，${exactCount} 条可回跳原文或站内内容`;
  updateStats(items);
}

function loadSession() {
  const session = readJson(storageKeys.session, null);

  if (!session || !session.email || !session.expiresAt || session.expiresAt <= Date.now()) {
    clearSession();
    return;
  }

  state.currentUser = session;
  updateSessionExpiry();
  updateAuthAwareUi();
}

function updateSessionExpiry() {
  if (!state.currentUser) return;
  state.currentUser.expiresAt = Date.now() + SESSION_DURATION_MS;
  localStorage.setItem(storageKeys.session, JSON.stringify(state.currentUser));
}

function persistSession(user) {
  const normalized = normalizeUser(user);
  state.currentUser = normalized;
  localStorage.setItem(storageKeys.session, JSON.stringify(normalized));
  updateAuthAwareUi();
}

function clearSession() {
  state.currentUser = null;
  localStorage.removeItem(storageKeys.session);
  updateAuthAwareUi();
}

function normalizeUser(user = {}) {
  const email = getUserEmail(user);
  const uid = user.uid || user.id || user.userId || user._id || "";
  const isAdminUser = Boolean(user.isAdmin || user.role === "admin" || fallbackAdminEmails.has(email));

  return {
    uid,
    email,
    role: isAdminUser ? "admin" : "user",
    isAdmin: isAdminUser,
    token: user.token || user.accessToken || "",
    expiresAt: user.expiresAt || Date.now() + SESSION_DURATION_MS,
  };
}

function getUserEmail(user = {}) {
  const identities = Array.isArray(user.identities) ? user.identities : [];
  const identityEmail = identities
    .map((identity) => identity.email || identity.mailbox || identity.userName)
    .find(Boolean);
  return String(user.email || user.mailbox || user.username || identityEmail || "").trim().toLowerCase();
}

function isAdmin() {
  return Boolean(state.currentUser?.isAdmin || state.currentUser?.role === "admin");
}

function updateAuthCopy() {
  authTitle.textContent = "内容发布";
  authCopy.textContent = "输入邮箱获取验证码，首次登录会自动创建账号。";
  authSubmit.textContent = "登录 / 注册";
}

function showView(route) {
  if (route === "landing") {
    state.activeRoute = "landing";
    landingView.hidden = false;
    appHeader.hidden = true;
    appMain.hidden = true;
    return;
  }

  const needsAuth = route === "publish" || route === "manage-site";
  const nextRoute = needsAuth && !state.currentUser ? "auth" : route;

  if (needsAuth && !state.currentUser) {
    state.pendingRoute = route;
    updateAuthCopy();
  }

  state.activeRoute = nextRoute;
  landingView.hidden = true;
  appHeader.hidden = false;
  appMain.hidden = false;
  archiveView.hidden = nextRoute !== "archive";
  authView.hidden = nextRoute !== "auth";
  publishView.hidden = nextRoute !== "publish";
  manageSiteView.hidden = nextRoute !== "manage-site";
  archiveView.classList.toggle("is-active", nextRoute === "archive");
  authView.classList.toggle("is-active", nextRoute === "auth");
  publishView.classList.toggle("is-active", nextRoute === "publish");
  manageSiteView.classList.toggle("is-active", nextRoute === "manage-site");

  if (nextRoute === "publish") {
    updateAuthAwareUi();
    initRichTextEditor();
    loadPendingItems();
  }

  if (nextRoute === "manage-site") {
    if (!isAdmin()) {
      showView("publish");
      return;
    }
    loadSiteItems();
  }

  updateViewToggle(nextRoute);
}

function updateViewToggle(activeRoute = state.activeRoute) {
  const selectedRoute = activeRoute === "auth" || activeRoute === "manage-site" ? "publish" : activeRoute;

  document.querySelectorAll('.site-nav [data-route="archive"], .site-nav [data-route="publish"]').forEach((button) => {
    const isActive = button.dataset.route === selectedRoute;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function updateAuthAwareUi() {
  const admin = isAdmin();
  const signedIn = Boolean(state.currentUser);

  publishHint.textContent = admin
    ? "管理员提交的作业展示会直接公开。"
    : "普通用户提交后会进入管理员审核，通过后公开展示。";
  publishSubmit.textContent = admin ? "直接发布" : "提交审核";
  logoutButton.hidden = !signedIn;
  reviewPanel.hidden = !admin;
}

async function signIn(user) {
  const normalized = normalizeUser(user);
  const profile = await fetchCurrentUserProfile(normalized);
  persistSession(profile);
  showView(state.pendingRoute || "publish");
}

async function fetchCurrentUserProfile(fallbackUser) {
  try {
    const payload = await api.me(fallbackUser);
    const user = payload.user || payload;
    return normalizeUser({ ...fallbackUser, ...user });
  } catch (error) {
    if (cloudbaseEnv || apiBase) console.warn("用户权限接口不可用，已使用前端显示兜底。", error);
    return normalizeUser(fallbackUser);
  }
}

async function handleSendCode() {
  const email = authEmail.value.trim().toLowerCase();
  if (!email) {
    authMessage.textContent = "请先填写邮箱。";
    return;
  }

  sendCodeButton.disabled = true;
  authMessage.textContent = "正在发送验证码...";

  try {
    if (cloudbaseEnv) {
      const auth = getCloudbaseAuth();
      state.otpVerification = await auth.getVerification({ email });
    } else {
      state.otpVerification = async ({ token }) => {
        if (token !== "123456") throw new Error("本地预览验证码为 123456。");
        return { data: { user: { email, uid: `local-${email}` } } };
      };
    }

    state.otpEmail = email;
    authMessage.textContent = cloudbaseEnv ? "验证码已发送，请查看邮箱。" : "本地预览验证码：123456。";
  } catch (error) {
    authMessage.textContent = error.message || "验证码发送失败，请稍后重试。";
  } finally {
    sendCodeButton.disabled = false;
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const email = authEmail.value.trim().toLowerCase();
  const code = authCode.value.trim();

  if (!email || !code) {
    authMessage.textContent = "请填写邮箱和验证码。";
    return;
  }

  const hasVerification = cloudbaseEnv ? Boolean(state.otpVerification) : typeof state.otpVerification === "function";
  if (state.otpEmail !== email || !hasVerification) {
    authMessage.textContent = "请先获取验证码。";
    return;
  }

  authSubmit.disabled = true;
  authMessage.textContent = "正在登录...";

  try {
    let user = { email };
    if (cloudbaseEnv) {
      const auth = getCloudbaseAuth();
      await auth.signInWithEmail({
        verificationInfo: state.otpVerification,
        verificationCode: code,
        email,
      });
      user = (typeof auth.getCurrentUser === "function" ? await auth.getCurrentUser() : auth.currentUser) || user;
    } else {
      const response = await state.otpVerification({ token: code });
      if (response.error) throw new Error(response.error.message || "验证码不正确。");
      user = response.data?.user || response.user || user;
    }
    authMessage.textContent = "";
    authCode.value = "";
    await signIn(user);
  } catch (error) {
    authMessage.textContent = error.message || "登录失败，请重新获取验证码。";
  } finally {
    authSubmit.disabled = false;
  }
}

async function handlePublishSubmit(event) {
  event.preventDefault();

  if (!state.currentUser) {
    state.pendingRoute = "publish";
    showView("publish");
    return;
  }

  publishSubmit.disabled = true;
  publishMessage.textContent = isAdmin() ? "正在发布..." : "正在提交审核...";

  try {
    const item = await getPublishFormItem();
    const localStatus = isAdmin() ? "approved" : "pending";
    const saved = await createItem(item);
    const normalized = normalizeItem(saved, { ...item, status: localStatus });

    resetPublishForm();
    publishMessage.textContent = normalized.status === "approved" ? "已发布，所有用户都可以查看。" : "已提交管理员审核。";

    if (normalized.status === "approved") {
      state.items = mergeById([normalized, ...state.items]);
      saveLocalPublicItem(normalized);
      focusPublishedItem(normalized);
      render();
    } else {
      state.pendingItems = mergeById([normalized, ...state.pendingItems]);
      saveLocalPendingItems(state.pendingItems);
      renderPendingItems();
    }
  } catch (error) {
    publishMessage.textContent = error.message || "发布失败，请稍后重试。";
  } finally {
    publishSubmit.disabled = false;
  }
}

async function getPublishFormItem() {
  const formData = new FormData(publishForm);
  const title = String(formData.get("title") || "").trim();
  const uploaderName = String(formData.get("uploaderName") || "").trim();
  const kind = state.publishKind;
  const now = new Date();
  const id = `homework-${now.getTime()}`;

  if (!title) throw new Error("请填写标题。");
  if (!uploaderName) throw new Error("请填写上传者。");

  const base = {
    id,
    platform: "site-homework",
    type: kind === "file" ? "file" : "article",
    contentKind: kind,
    keyword: "诗话桥",
    title,
    author: uploaderName,
    uploaderName,
    submittedBy: state.currentUser.email,
    submittedByUid: state.currentUser.uid,
    publishedAt: now.toISOString().slice(0, 10),
    submittedAt: now.toISOString(),
    capturedAt: now.toISOString(),
    summarySource: "manual_verified",
    engagement: 0,
    tags: ["作业展示"],
    sourceUrl: `site://homework/${id}`,
  };

  if (kind === "file") {
    const file = documentFileInput.files?.[0];
    if (!file) throw new Error("请选择文件。");
    validateDocument(file);
    const attachment = await uploadDocument(file, id);
    return {
      ...base,
      summary: `文件作业展示：${file.name}`,
      bodyText: "",
      attachments: [attachment],
    };
  }

  const rawHtml = getEditorHtml();
  const text = getEditorText();
  const attachments = collectEditorImages(rawHtml);
  if (!text && attachments.length === 0) throw new Error("请填写正文内容。");

  return {
    ...base,
    summary: truncate(text || "图片作业展示", 120),
    bodyHtml: sanitizeRichHtml(rawHtml),
    bodyText: text,
    attachments,
  };
}

async function createItem(payload) {
  try {
    const response = await api.createItem(payload);
    return response.item || response;
  } catch (error) {
    if (cloudbaseEnv || apiBase) throw error;
    return { ...payload, status: isAdmin() ? "approved" : "pending" };
  }
}

async function loadPendingItems() {
  if (!isAdmin()) return;

  reviewMeta.textContent = "正在载入...";

  try {
    const response = await api.listPendingItems();
    state.pendingItems = Array.isArray(response) ? response : response.items || [];
  } catch (error) {
    if (cloudbaseEnv || apiBase) console.warn("待审核接口不可用，已使用本地待审核数据。", error);
    state.pendingItems = getLocalPendingItems();
  }

  renderPendingItems();
}

function renderPendingItems() {
  if (!isAdmin()) return;

  reviewList.innerHTML = "";
  reviewMeta.textContent = state.pendingItems.length ? `${state.pendingItems.length} 条待审核` : "暂无待审核内容";

  for (const item of state.pendingItems) {
    const card = document.createElement("article");
    card.className = "review-card";
    card.innerHTML = `
      <div class="review-card__meta">
        <span>${escapeHtml(platformLabels[item.platform] || item.platform || "未知平台")}</span>
        <span>${escapeHtml(typeLabels[item.type] || item.type || "内容")}</span>
        <time>${escapeHtml(item.displayDate || formatDate(item.publishedAt))}</time>
      </div>
      <h3>${escapeHtml(item.title || "未命名内容")}</h3>
      <p>${escapeHtml(item.summary || "")}</p>
      <button class="back-link review-preview" type="button" data-open-item="${escapeAttribute(item.id)}">查看内容</button>
      <div class="review-card__actions">
        <button class="secondary-action" type="button" data-review-action="reject" data-review-id="${escapeAttribute(item.id)}">拒绝</button>
        <button class="form-submit" type="button" data-review-action="approve" data-review-id="${escapeAttribute(item.id)}">通过</button>
      </div>
    `;
    reviewList.append(card);
  }
}

async function handleReviewAction(button) {
  const id = button.dataset.reviewId;
  const action = button.dataset.reviewAction;
  const item = state.pendingItems.find((entry) => entry.id === id);
  if (!item) return;

  button.disabled = true;

  try {
    const reviewed = await reviewItem(id, action);
    state.pendingItems = state.pendingItems.filter((entry) => entry.id !== id);
    saveLocalPendingItems(state.pendingItems);

    if (action === "approve") {
      const approved = normalizeItem(reviewed.item || reviewed, { ...item, status: "approved" });
      state.items = mergeById([approved, ...state.items]);
      saveLocalPublicItem(approved);
      render();
    }

    renderPendingItems();
  } catch (error) {
    reviewMeta.textContent = error.message || "审核操作失败，请稍后重试。";
  } finally {
    button.disabled = false;
  }
}

async function reviewItem(id, action) {
  try {
    return await api.reviewItem(id, action);
  } catch (error) {
    if (cloudbaseEnv || apiBase) throw error;
    return { item: { ...state.pendingItems.find((item) => item.id === id), status: action === "approve" ? "approved" : "rejected" } };
  }
}

async function loadSiteItems() {
  if (!isAdmin()) return;

  manageSiteMeta.textContent = "正在载入...";
  manageSiteList.innerHTML = "";

  try {
    if (cloudbaseEnv || apiBase) {
      const response = await api.listSiteItems();
      state.siteItems = Array.isArray(response) ? response : response.items || [];
    } else {
      state.siteItems = getLocalSiteItems();
    }
  } catch (error) {
    manageSiteMeta.textContent = error.message || "站内上传内容载入失败。";
    return;
  }

  renderSiteItems();
}

function renderSiteItems() {
  manageSiteList.innerHTML = "";
  manageSiteMeta.textContent = state.siteItems.length ? `${state.siteItems.length} 条站内上传内容` : "当前没有站内上传内容";

  for (const item of state.siteItems) {
    const card = document.createElement("article");
    card.className = "manage-card";
    card.innerHTML = `
      <div class="review-card__meta">
        <span>${escapeHtml(typeLabels[item.type] || item.type || "内容")}</span>
        <span>${escapeHtml(statusLabel(item.status))}</span>
        <time>${escapeHtml(item.displayDate || formatDate(item.publishedAt || item.submittedAt))}</time>
      </div>
      <h3>${escapeHtml(item.title || "未命名内容")}</h3>
      <p>${escapeHtml(item.summary || "")}</p>
      ${renderManageUploaderHtml(item)}
      <div class="review-card__actions">
        <button class="secondary-action" type="button" data-open-site-item="${escapeAttribute(item.id)}">查看内容</button>
        <button class="danger-action" type="button" data-delete-site-item="${escapeAttribute(item.id)}">删除</button>
      </div>
    `;
    manageSiteList.append(card);
  }
}

function renderManageUploaderHtml(item) {
  const uploaderName = cleanText(item.uploaderName || item.author || "");
  return uploaderName ? `<p class="manage-card__uploader">上传者：${escapeHtml(uploaderName)}</p>` : "";
}

function statusLabel(status) {
  const labels = {
    approved: "已公开",
    pending: "待审核",
    rejected: "已拒绝",
  };
  return labels[status] || "未记录";
}

async function handleDeleteSiteItem(button) {
  if (!isAdmin()) return;
  const id = button.dataset.deleteSiteItem;
  const item = state.siteItems.find((entry) => entry.id === id);
  if (!item) return;

  const confirmed = window.confirm(`确定删除“${item.title || "未命名内容"}”吗？`);
  if (!confirmed) return;

  button.disabled = true;
  manageSiteMeta.textContent = "正在删除...";

  try {
    if (cloudbaseEnv || apiBase) {
      await api.deleteSiteItem(id);
    } else {
      removeLocalSiteItem(id);
    }

    state.siteItems = state.siteItems.filter((entry) => entry.id !== id);
    state.items = state.items.filter((entry) => entry.id !== id);
    state.pendingItems = state.pendingItems.filter((entry) => entry.id !== id);
    render();
    renderPendingItems();
    renderSiteItems();
    manageSiteMeta.textContent = `已删除“${item.title || "未命名内容"}”。`;
  } catch (error) {
    manageSiteMeta.textContent = error.message || "删除失败，请稍后重试。";
  } finally {
    button.disabled = false;
  }
}

function setPublishKind(kind) {
  state.publishKind = kind;
  publishKindInput.value = kind;
  articleFields.hidden = kind !== "article";
  fileFields.hidden = kind !== "file";
  document.querySelectorAll("[data-publish-kind]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.publishKind === kind);
  });
  publishMessage.textContent = "";
}

function focusPublishedItem(item) {
  if (item.platform !== "site-homework") return;
  setFilterValue("platform", "site-homework");
  state.category = "all";
  setFilterValue("type", item.type || "all");
  showView("archive");
}

function setFilterValue(filter, value) {
  state[filter] = value;
  document.querySelectorAll(`[data-filter="${filter}"]`).forEach((button) => {
    button.classList.toggle("is-active", button.dataset.value === value);
  });
}

function resetPublishForm() {
  publishForm.reset();
  setEditorHtml("");
  setPublishKind("article");
}

function validateImage(file) {
  if (!file.type.startsWith("image/")) throw new Error("请选择图片文件。");
  if (file.size > IMAGE_MAX_BYTES) throw new Error("图片大小不能超过 25MB。");
}

function validateDocument(file) {
  const validExt = /\.(ppt|pptx|pdf|doc|docx)$/i.test(file.name);
  if (!validExt) throw new Error("请选择 PPT、PDF 或 Word 文件。");
  if (file.size > DOCUMENT_MAX_BYTES) throw new Error("文件大小不能超过 100MB。");
}

async function uploadEditorImage(file) {
  if (!cloudbaseEnv) {
    return { url: await readFileAsDataUrl(file), fileId: "" };
  }

  const fileId = await uploadFileToCloud(file, "homework/images");
  const url = await getTempFileUrl(fileId);
  return { url, fileId };
}

async function uploadDocument(file, itemId) {
  if (!cloudbaseEnv) {
    return {
      fileName: file.name,
      size: file.size,
      type: file.type,
      url: URL.createObjectURL(file),
    };
  }

  const fileId = await uploadFileToCloud(file, `homework/file/${itemId}`);
  return {
    fileName: file.name,
    size: file.size,
    type: file.type,
    fileId,
  };
}

async function uploadFileToCloud(file, folder) {
  const app = getCloudbaseApp();
  const cloudPath = `${folder}/${Date.now()}-${safeFileName(file.name)}`;
  const result = await app.uploadFile({
    cloudPath,
    filePath: file,
  });
  const fileId = result.fileID || result.fileId || result.data?.id;
  if (!fileId) throw new Error("文件上传成功但未返回 fileID。");
  return fileId;
}

async function getTempFileUrl(fileId) {
  const app = getCloudbaseApp();
  const result = await app.getTempFileURL({
    fileList: [{ fileID: fileId, maxAge: 3600 }],
  });
  const file = result.fileList?.[0];
  if (!file?.tempFileURL) throw new Error("无法获取文件临时链接。");
  return file.tempFileURL;
}

function initRichTextEditor() {
  if (!window.wangEditor || richTextEditor) return;

  const { createEditor, createToolbar } = window.wangEditor;
  richTextEditor = createEditor({
    selector: articleEditor,
    html: "",
    mode: "default",
    config: {
      placeholder: "填写正文内容，可插入图片。",
      scroll: false,
      MENU_CONF: {
        uploadImage: {
          maxFileSize: IMAGE_MAX_BYTES,
          allowedFileTypes: ["image/*"],
          async customUpload(file, insertFn) {
            try {
              validateImage(file);
              publishMessage.textContent = "正在上传图片...";
              const image = await uploadEditorImage(file);
              editorImageAttachments = mergeEditorImages([
                ...editorImageAttachments,
                {
                  fileId: image.fileId,
                  url: image.url,
                  alt: file.name,
                  fileName: file.name,
                  size: file.size,
                  type: file.type,
                },
              ]);
              insertFn(image.url, file.name, "");
              publishMessage.textContent = "";
            } catch (error) {
              publishMessage.textContent = error.message || "图片上传失败。";
            }
          },
        },
      },
    },
  });

  createToolbar({
    editor: richTextEditor,
    selector: articleToolbar,
    mode: "default",
    config: {
      toolbarKeys: [
        "undo",
        "redo",
        "clearStyle",
        "|",
        "fontSize",
        "fontFamily",
        "bold",
        "italic",
        "underline",
        "through",
        "color",
        "bgColor",
        "|",
        "justifyLeft",
        "justifyCenter",
        "justifyRight",
        "numberedList",
        "bulletedList",
        "|",
        "uploadImage",
      ],
    },
  });
}

function getEditorHtml() {
  const html = richTextEditor ? richTextEditor.getHtml().trim() : articleEditor.innerHTML.trim();
  return attachEditorImageIds(html);
}

function getEditorText() {
  return cleanText(richTextEditor ? richTextEditor.getText() : articleEditor.textContent || "");
}

function setEditorHtml(html) {
  editorImageAttachments = [];
  if (richTextEditor) {
    richTextEditor.clear();
    if (html) richTextEditor.setHtml(html);
  } else {
    articleEditor.innerHTML = html;
  }
}

function collectEditorImages(html = getEditorHtml()) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const htmlImages = [...template.content.querySelectorAll("img")]
    .map((img) => ({
      fileId: img.dataset.cloudFileId || findEditorImageByUrl(img.getAttribute("src") || "")?.fileId || "",
      url: img.getAttribute("src") || "",
      alt: img.getAttribute("alt") || "",
      fileName: img.getAttribute("alt") || "",
      size: findEditorImageByUrl(img.getAttribute("src") || "")?.size || 0,
      type: findEditorImageByUrl(img.getAttribute("src") || "")?.type || "",
    }))
    .filter((item) => item.fileId || item.url);
  return mergeEditorImages(htmlImages);
}

function attachEditorImageIds(html) {
  const template = document.createElement("template");
  template.innerHTML = html || "";
  template.content.querySelectorAll("img").forEach((img) => {
    const attachment = findEditorImageByUrl(img.getAttribute("src") || "");
    if (!attachment?.fileId) return;
    img.dataset.cloudFileId = attachment.fileId;
  });
  return template.innerHTML;
}

function findEditorImageByUrl(url) {
  return editorImageAttachments.find((item) => item.url === url);
}

function mergeEditorImages(images) {
  const map = new Map();
  for (const image of images) {
    const key = image.fileId || image.url;
    if (key) map.set(key, image);
  }
  return [...map.values()];
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
  const media = items.filter((item) => item.type === "video" || item.type === "file").length;
  const sources = new Set(items.map((item) => item.platform)).size;

  document.querySelector("#totalCount").textContent = items.length;
  document.querySelector("#articleCount").textContent = articles;
  document.querySelector("#videoCount").textContent = media;
  document.querySelector("#sourceCount").textContent = sources;
}

async function openDetail(item) {
  if (!item) return;

  detailPlatform.textContent = platformLabels[item.platform] || item.platform || "站内内容";
  detailType.textContent = typeLabels[item.type] || item.type || "内容";
  detailDate.textContent = item.displayDate || formatDate(item.publishedAt);
  detailDate.dateTime = item.publishedAt || "";
  detailTitle.textContent = item.title || "未命名内容";
  detailFiles.innerHTML = "";

  if (item.type === "file") {
    detailBody.innerHTML = `${renderUploaderHtml(item)}${escapeHtml(item.summary || "")}`;
    await renderAttachments(item.attachments || []);
  } else {
    detailBody.innerHTML = `${renderUploaderHtml(item)}${sanitizeRichHtml(item.bodyHtml || escapeHtml(item.summary || ""))}`;
    await refreshDetailImages();
  }

  detailDialog.hidden = false;
}

function closeDetail() {
  detailDialog.hidden = true;
}

function renderUploader(container, item) {
  const uploaderName = cleanText(item.uploaderName || (item.platform === "site-homework" ? item.author : ""));
  container.hidden = !uploaderName;
  container.textContent = uploaderName ? `${uploaderLabels[item.platform] || "作者"}：${uploaderName}` : "";
}

function renderUploaderHtml(item) {
  const uploaderName = cleanText(item.uploaderName || (item.platform === "site-homework" ? item.author : ""));
  if (!uploaderName) return "";
  const label = uploaderLabels[item.platform] || "作者";
  return `<p class="detail-uploader">${escapeHtml(label)}：${escapeHtml(uploaderName)}</p>`;
}

async function renderAttachments(attachments) {
  detailFiles.innerHTML = "";
  for (const attachment of attachments) {
    const link = document.createElement("a");
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `${attachment.fileName || "下载文件"}${attachment.size ? `（${formatFileSize(attachment.size)}）` : ""}`;
    link.href = attachment.url || "#";
    detailFiles.append(link);

    if (!attachment.url && attachment.fileId && cloudbaseEnv) {
      try {
        link.href = await getTempFileUrl(attachment.fileId);
      } catch {
        link.removeAttribute("href");
        link.textContent = `${attachment.fileName || "文件"}（临时链接生成失败）`;
      }
    }
  }
}

async function refreshDetailImages() {
  if (!cloudbaseEnv) return;
  const images = [...detailBody.querySelectorAll("img[data-cloud-file-id]")];
  for (const img of images) {
    try {
      img.src = await getTempFileUrl(img.dataset.cloudFileId);
    } catch {
      img.alt = `${img.alt || "图片"}（临时链接生成失败）`;
    }
  }
}

function findItemById(id) {
  return [...state.items, ...state.pendingItems, ...state.siteItems].find((item) => item.id === id);
}

function formatDate(value) {
  if (!value) return "未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

function getUrlStatus(item) {
  if (item.platform === "site-homework") return "exact";
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

function getLocalPublicItems() {
  return readJson(storageKeys.publicItems, []);
}

function saveLocalPublicItem(item) {
  if (cloudbaseEnv || apiBase) return;
  const items = mergeById([item, ...getLocalPublicItems()]);
  localStorage.setItem(storageKeys.publicItems, JSON.stringify(items));
}

function getLocalPendingItems() {
  return readJson(storageKeys.pendingItems, []);
}

function getLocalSiteItems() {
  return mergeById([...getLocalPendingItems(), ...getLocalPublicItems()]).filter((item) => item.platform === "site-homework");
}

function removeLocalSiteItem(id) {
  const publicItems = getLocalPublicItems().filter((item) => item.id !== id);
  const pendingItems = getLocalPendingItems().filter((item) => item.id !== id);
  localStorage.setItem(storageKeys.publicItems, JSON.stringify(publicItems));
  localStorage.setItem(storageKeys.pendingItems, JSON.stringify(pendingItems));
}

function saveLocalPendingItems(items) {
  if (cloudbaseEnv || apiBase) return;
  localStorage.setItem(storageKeys.pendingItems, JSON.stringify(items));
}

function normalizeItem(saved = {}, fallback = {}) {
  const item = {
    ...fallback,
    ...saved,
    id: saved.id || saved._id || fallback.id,
  };
  if (!item.tags?.includes("作业展示") && item.platform === "site-homework") {
    item.tags = [...(item.tags || []), "作业展示"];
  }
  return item;
}

function mergeById(items) {
  const map = new Map();

  for (const item of items) {
    if (!item) continue;
    const id = item.id || item._id || item.sourceUrl || `${item.title}-${item.publishedAt}`;
    map.set(id, { ...item, id });
  }

  return [...map.values()];
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function getCloudbaseApp() {
  if (!cloudbaseEnv) throw new Error("尚未配置 CloudBase 环境 ID。");
  if (!window.cloudbase) throw new Error("CloudBase Web SDK 未加载。");
  if (!cloudbaseApp) {
    cloudbaseApp = window.cloudbase.init({
      env: cloudbaseEnv,
      ...(cloudbaseRegion ? { region: cloudbaseRegion } : {}),
    });
  }
  return cloudbaseApp;
}

function getCloudbaseAuth() {
  if (cloudbaseAuth) return cloudbaseAuth;
  const app = getCloudbaseApp();
  const directAuth = app.auth;
  if (directAuth?.getVerification && directAuth?.signInWithEmail) {
    cloudbaseAuth = directAuth;
  } else if (typeof directAuth === "function") {
    cloudbaseAuth = directAuth.call(app);
  }
  if (!cloudbaseAuth?.getVerification || !cloudbaseAuth?.signInWithEmail) {
    throw new Error("当前 CloudBase SDK 不支持邮箱验证码登录，请检查 SDK 版本。");
  }
  return cloudbaseAuth;
}

function safeFileName(name) {
  return String(name || "file").replace(/[^\w.\-\u4e00-\u9fa5]+/g, "-").replace(/-+/g, "-");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取文件失败。"));
    reader.readAsDataURL(file);
  });
}

function sanitizeRichHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html || "";
  const allowedTags = new Set(["A", "B", "BLOCKQUOTE", "BR", "CODE", "DIV", "EM", "FONT", "H1", "H2", "H3", "H4", "HR", "I", "IMG", "LI", "OL", "P", "PRE", "S", "SPAN", "STRONG", "SUB", "SUP", "U", "UL"]);
  const allowedAttrs = new Set(["alt", "class", "data-cloud-file-id", "face", "href", "size", "src", "style", "target", "title"]);

  template.content.querySelectorAll("*").forEach((node) => {
    if (!allowedTags.has(node.tagName)) {
      node.replaceWith(document.createTextNode(node.textContent || ""));
      return;
    }

    [...node.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (!allowedAttrs.has(name)) {
        node.removeAttribute(attr.name);
        return;
      }
      if ((name === "href" || name === "src") && !isSafeUrl(attr.value)) {
        node.removeAttribute(attr.name);
      }
      if (name === "style") {
        const safeStyle = sanitizeInlineStyle(attr.value);
        if (safeStyle) {
          node.setAttribute("style", safeStyle);
        } else {
          node.removeAttribute(attr.name);
        }
      }
    });

    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noreferrer");
    }
  });

  return template.innerHTML;
}

function sanitizeInlineStyle(value = "") {
  const allowedProps = new Set([
    "background-color",
    "color",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "text-align",
    "text-decoration",
  ]);
  return String(value)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [rawName, ...rawValue] = part.split(":");
      const name = rawName.trim().toLowerCase();
      const propValue = rawValue.join(":").trim();
      if (!allowedProps.has(name) || !propValue || /url\s*\(|expression\s*\(/i.test(propValue)) return "";
      return `${name}: ${propValue}`;
    })
    .filter(Boolean)
    .join("; ");
}

function isSafeUrl(value = "") {
  return /^(https?:|data:image\/|blob:|cloud:\/\/)/i.test(value);
}

function cleanText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function truncate(text, max = 160) {
  const cleaned = cleanText(text);
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}...`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value = "") {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

document.addEventListener("click", async (event) => {
  const reviewButton = event.target.closest("[data-review-action]");
  if (reviewButton) {
    handleReviewAction(reviewButton);
    return;
  }

  const deleteSiteButton = event.target.closest("[data-delete-site-item]");
  if (deleteSiteButton) {
    handleDeleteSiteItem(deleteSiteButton);
    return;
  }

  const openSiteButton = event.target.closest("[data-open-site-item]");
  if (openSiteButton) {
    event.preventDefault();
    await openDetail(findItemById(openSiteButton.dataset.openSiteItem));
    return;
  }

  const openButton = event.target.closest("[data-open-item]");
  if (openButton) {
    event.preventDefault();
    await openDetail(findItemById(openButton.dataset.openItem));
    return;
  }

  const publishKindButton = event.target.closest("[data-publish-kind]");
  if (publishKindButton) {
    setPublishKind(publishKindButton.dataset.publishKind);
    return;
  }

  const routeButton = event.target.closest("[data-route]");
  if (routeButton) {
    showView(routeButton.dataset.route);
    return;
  }

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

backHomeButton.addEventListener("click", () => {
  showView("landing");
});

logoutButton.addEventListener("click", () => {
  clearSession();
  showView("archive");
});

detailCloseButton.addEventListener("click", closeDetail);
detailDialog.addEventListener("click", (event) => {
  if (event.target === detailDialog) closeDetail();
});

sendCodeButton.addEventListener("click", handleSendCode);
authForm.addEventListener("submit", handleAuthSubmit);
publishForm.addEventListener("submit", handlePublishSubmit);

loadSession();
showView("landing");
setPublishKind("article");
loadItems();
