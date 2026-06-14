const cloudbase = require("@cloudbase/node-sdk");

const app = cloudbase.init({
  env: cloudbase.SYMBOL_CURRENT_ENV,
});

const db = app.database();
const _ = db.command;
const IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const DOCUMENT_MAX_BYTES = 100 * 1024 * 1024;
const DOCUMENT_EXTENSION_RE = /\.(ppt|pptx|pdf|doc|docx)$/i;
const SITE_PLATFORM = "site-homework";

exports.main = async (event = {}, context = {}) => {
  try {
    const action = event.action;
    const data = event.data || {};

    if (action === "listPublicContents") {
      return ok({ items: await listPublicContents() });
    }

    const user = await getCurrentUser(context, action === "me" ? data.fallbackUser : {});

    if (action === "me") {
      return ok({ user });
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

    if (action === "listSiteContents") {
      assertAdmin(user);
      return ok({ items: await listSiteContents() });
    }

    if (action === "deleteSiteContent") {
      assertAdmin(user);
      return ok(await deleteSiteContent(data.id));
    }

    return fail(`未知操作：${action || "empty"}`, 400);
  } catch (error) {
    return fail(error.message || "云函数执行失败", error.statusCode || 500);
  }
};

async function getCurrentUser(context, fallbackUser = {}) {
  const auth = app.auth();
  const authUser = getAuthUserInfo(auth);
  const uid = authUser.uid || context.OPENID || context.TCB_UUID || fallbackUser.uid || "";
  const endUser = await getEndUserInfo(auth, uid);
  const email = normalizeEmail(authUser.email || pickUserEmail(endUser.userInfo) || fallbackUser.email || "");
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

async function getEndUserInfo(auth, uid) {
  if (uid) {
    const result = await auth.getEndUserInfo(uid).catch(() => null);
    if (result?.userInfo) return result;
  }

  return (await auth.getEndUserInfo().catch(() => ({}))) || {};
}

function pickUserEmail(userInfo = {}) {
  const identities = Array.isArray(userInfo.identities) ? userInfo.identities : [];
  const identityEmail = identities.map((identity) => identity.email || identity.userName).find(Boolean);
  return userInfo.email || identityEmail || "";
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

async function listSiteContents() {
  const items = [];
  let offset = 0;

  while (true) {
    const result = await db
      .collection("contents")
      .where({ platform: SITE_PLATFORM })
      .orderBy("submittedAt", "desc")
      .skip(offset)
      .limit(100)
      .get();
    const batch = Array.isArray(result.data) ? result.data : [];
    if (!batch.length) break;
    items.push(...batch);
    offset += batch.length;
    if (batch.length < 100) break;
  }

  return enrichItems(items);
}

async function deleteSiteContent(id) {
  if (!id) throw makeError("缺少内容 ID", 400);
  const result = await db.collection("contents").doc(id).get();
  const item = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!item) throw makeError("内容不存在", 404);
  if (item.platform !== SITE_PLATFORM) throw makeError("只能删除站内上传内容", 400);

  const fileIds = collectContentFileIds(item);
  await db.collection("contents").doc(id).remove();
  const fileResult = await deleteCloudFiles([...fileIds]);

  return {
    deleted: 1,
    id,
    filesRequested: fileResult.requested,
    filesDeleted: fileResult.deleted,
    filesFailed: fileResult.failed,
  };
}

function collectContentFileIds(item = {}) {
  const fileIds = [];
  const attachments = Array.isArray(item.attachments) ? item.attachments : [];
  attachments.forEach((file) => {
    if (file?.fileId) fileIds.push(cleanText(file.fileId));
  });

  String(item.bodyHtml || "").replace(/data-cloud-file-id=["']([^"']+)["']/g, (_, fileId) => {
    fileIds.push(cleanText(fileId));
    return "";
  });

  return fileIds.filter(Boolean);
}

async function deleteCloudFiles(fileIds = []) {
  const unique = [...new Set(fileIds.filter(Boolean))];
  const stats = { requested: unique.length, deleted: 0, failed: 0 };

  for (let index = 0; index < unique.length; index += 50) {
    const fileList = unique.slice(index, index + 50);
    try {
      const result = await app.deleteFile({ fileList });
      const list = Array.isArray(result.fileList) ? result.fileList : [];
      if (!list.length) {
        stats.deleted += fileList.length;
        continue;
      }
      for (const file of list) {
        const code = String(file.code || file.status || "").toUpperCase();
        if (!code || code === "SUCCESS" || code === "0") {
          stats.deleted += 1;
        } else {
          stats.failed += 1;
        }
      }
    } catch {
      stats.failed += fileList.length;
    }
  }

  return stats;
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
  if (attachment.size > IMAGE_MAX_BYTES) throw makeError("图片大小不能超过 25MB", 400);
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
