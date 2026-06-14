const cloudbase = require("@cloudbase/node-sdk");

const app = cloudbase.init({
  env: cloudbase.SYMBOL_CURRENT_ENV,
});

const db = app.database();
const _ = db.command;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const DOCUMENT_MAX_BYTES = 100 * 1024 * 1024;
const DOCUMENT_EXTENSION_RE = /\.(ppt|pptx|pdf|doc|docx)$/i;

exports.main = async (event = {}, context = {}) => {
  try {
    const action = event.action;
    const data = event.data || {};
    const user = await getCurrentUser(context, action === "me" ? data.fallbackUser : {});

    if (action === "me") {
      return ok({ user });
    }

    if (action === "listPublicContents") {
      return ok({ items: await listPublicContents() });
    }

    if (action === "submitContent") {
      assertSignedIn(user);
      return ok({ item: await submitContent(data.item, user) });
    }

    if (action === "listPendingContents") {
      assertAdmin(user);
      return ok({ items: await listPendingContents() });
    }

    if (action === "reviewContent") {
      assertAdmin(user);
      return ok({ item: await reviewContent(data.id, data.reviewAction, user) });
    }

    return fail(`未知操作：${action || "empty"}`, 400);
  } catch (error) {
    return fail(error.message || "云函数执行失败", error.statusCode || 500);
  }
};

async function getCurrentUser(context, fallbackUser = {}) {
  const auth = app.auth();
  const authUser = getAuthUserInfo(auth);
  const endUser = (await auth.getEndUserInfo().catch(() => ({}))) || {};
  const uid = authUser.uid || context.OPENID || context.TCB_UUID || fallbackUser.uid || "";
  const identities = Array.isArray(endUser.userInfo?.identities) ? endUser.userInfo.identities : [];
  const identityEmail = identities.map((identity) => identity.email || identity.userName).find(Boolean);
  const email = normalizeEmail(authUser.email || endUser.userInfo?.email || identityEmail || fallbackUser.email || "");
  const isAdmin = await isAdminEmail(email);

  return {
    uid,
    email,
    role: isAdmin ? "admin" : "user",
    isAdmin,
  };
}

function getAuthUserInfo(auth) {
  try {
    return auth.getUserInfo() || {};
  } catch {
    return {};
  }
}

async function isAdminEmail(email) {
  if (!email) return false;
  const result = await db
    .collection("admins")
    .where({
      email,
      enabled: _.neq(false),
    })
    .limit(1)
    .get();
  return result.data.length > 0;
}

async function listPublicContents() {
  const result = await db
    .collection("contents")
    .where({ status: "approved" })
    .orderBy("publishedAt", "desc")
    .limit(100)
    .get();
  return enrichItems(result.data);
}

async function submitContent(item, user) {
  const safe = sanitizeItem(item, user);
  const status = user.isAdmin ? "approved" : "pending";
  const now = new Date();
  const saved = {
    ...safe,
    status,
    submittedBy: user.email,
    submittedByUid: user.uid,
    submittedAt: now.toISOString(),
    publishedAt: now.toISOString().slice(0, 10),
    capturedAt: now.toISOString(),
    approvedBy: user.isAdmin ? user.email : "",
    approvedByUid: user.isAdmin ? user.uid : "",
    approvedAt: user.isAdmin ? now.toISOString() : "",
  };

  const result = await db.collection("contents").add(saved);
  return enrichItem({ ...saved, _id: result.id });
}

async function listPendingContents() {
  const result = await db
    .collection("contents")
    .where({ status: "pending" })
    .orderBy("submittedAt", "desc")
    .limit(100)
    .get();
  return enrichItems(result.data);
}

async function reviewContent(id, action, user) {
  if (!id) throw makeError("缺少内容 ID", 400);
  if (!["approve", "reject"].includes(action)) throw makeError("审核动作无效", 400);

  const now = new Date();
  const status = action === "approve" ? "approved" : "rejected";
  const updates = {
    status,
    approvedBy: user.email,
    approvedByUid: user.uid,
    approvedAt: now.toISOString(),
  };
  if (status === "approved") updates.publishedAt = now.toISOString().slice(0, 10);

  await db.collection("contents").doc(id).update(updates);

  const result = await db.collection("contents").doc(id).get();
  return enrichItem(result.data[0]);
}

function sanitizeItem(item = {}, user) {
  const title = cleanText(item.title);
  const uploaderName = cleanText(item.uploaderName || item.author);
  if (!title) throw makeError("标题不能为空", 400);
  if (!uploaderName) throw makeError("上传者不能为空", 400);

  const contentKind = item.contentKind === "file" ? "file" : "article";
  const type = contentKind === "file" ? "file" : "article";
  const tags = ["作业展示"];

  if (contentKind === "file") {
    const attachments = Array.isArray(item.attachments) ? item.attachments.slice(0, 1).map(sanitizeDocumentAttachment) : [];
    if (!attachments.length) throw makeError("请上传文件", 400);
    return {
      platform: "site-homework",
      type,
      contentKind,
      keyword: "诗话桥",
      title,
      author: uploaderName,
      uploaderName,
      summary: cleanText(item.summary || `文件作业展示：${attachments[0].fileName}`),
      summarySource: "manual_verified",
      tags,
      attachments,
      bodyText: "",
      sourceUrl: "site://homework/file",
      engagement: 0,
    };
  }

  const bodyHtml = String(item.bodyHtml || "").slice(0, 120000);
  const bodyText = cleanText(item.bodyText || stripHtml(bodyHtml));
  if (!bodyText && !bodyHtml.includes("<img")) throw makeError("正文不能为空", 400);

  return {
    platform: "site-homework",
    type,
    contentKind,
    keyword: "诗话桥",
    title,
    author: uploaderName,
    uploaderName,
    summary: cleanText(item.summary || bodyText).slice(0, 160),
    summarySource: "manual_verified",
    tags,
    bodyHtml,
    bodyText,
    attachments: Array.isArray(item.attachments) ? item.attachments.slice(0, 30).map(sanitizeImageAttachment) : [],
    sourceUrl: "site://homework/article",
    engagement: 0,
  };
}

function sanitizeDocumentAttachment(file = {}) {
  const attachment = {
    fileName: cleanText(file.fileName).slice(0, 160),
    fileId: cleanText(file.fileId),
    url: cleanText(file.url),
    size: Number(file.size) || 0,
    type: cleanText(file.type).slice(0, 120),
  };
  if (!attachment.fileName) throw makeError("文件名不能为空", 400);
  if (!attachment.fileId && !attachment.url) throw makeError("文件缺少存储标识", 400);
  if (!DOCUMENT_EXTENSION_RE.test(attachment.fileName)) throw makeError("仅支持 PPT、PDF 或 Word 文件", 400);
  if (attachment.size > DOCUMENT_MAX_BYTES) throw makeError("文件大小不能超过 100MB", 400);
  return attachment;
}

function sanitizeImageAttachment(file = {}) {
  const attachment = {
    fileName: cleanText(file.fileName || file.alt || "插图").slice(0, 160),
    fileId: cleanText(file.fileId),
    url: cleanText(file.url),
    size: Number(file.size) || 0,
    type: cleanText(file.type).slice(0, 120),
    alt: cleanText(file.alt).slice(0, 160),
  };
  if (!attachment.fileId && !attachment.url) throw makeError("图片缺少存储标识", 400);
  if (attachment.size > IMAGE_MAX_BYTES) throw makeError("图片大小不能超过 5MB", 400);
  return attachment;
}

async function enrichItems(items = []) {
  return Promise.all(items.map(enrichItem));
}

async function enrichItem(item = {}) {
  const normalized = normalizeItem(item);
  if (!normalized || !Array.isArray(normalized.attachments) || normalized.attachments.length === 0) {
    return normalized;
  }

  const attachments = await enrichAttachments(normalized.attachments);
  return { ...normalized, attachments };
}

async function enrichAttachments(attachments = []) {
  const fileIds = attachments.map((file) => file.fileId).filter(Boolean);
  if (!fileIds.length) return attachments;

  const tempUrlMap = await getTempUrlMap(fileIds);
  return attachments.map((file) => ({
    ...file,
    url: file.url || tempUrlMap.get(file.fileId) || "",
  }));
}

async function getTempUrlMap(fileIds) {
  try {
    const result = await app.getTempFileURL({ fileList: fileIds });
    const list = Array.isArray(result.fileList) ? result.fileList : [];
    return new Map(list.map((file) => [file.fileID || file.fileId, file.tempFileURL || file.download_url || ""]));
  } catch {
    try {
      const result = await app.getTempFileURL({
        fileList: fileIds.map((fileID) => ({ fileID, maxAge: 3600 })),
      });
      const list = Array.isArray(result.fileList) ? result.fileList : [];
      return new Map(list.map((file) => [file.fileID || file.fileId, file.tempFileURL || file.download_url || ""]));
    } catch {
      return new Map();
    }
  }
}

function normalizeItem(item = {}) {
  if (!item) return item;
  return {
    ...item,
    id: item._id || item.id,
  };
}

function assertSignedIn(user) {
  if (!user.uid && !user.email) throw makeError("请先登录", 401);
}

function assertAdmin(user) {
  assertSignedIn(user);
  if (!user.isAdmin) throw makeError("没有管理员权限", 403);
}

function normalizeEmail(value = "") {
  return String(value).trim().toLowerCase();
}

function cleanText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function stripHtml(html = "") {
  return String(html).replace(/<[^>]+>/g, " ");
}

function ok(data) {
  return { ok: true, data };
}

function fail(message, statusCode) {
  return { ok: false, statusCode, message };
}

function makeError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
