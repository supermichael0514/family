import { createServer } from "node:http";
import { readFile, writeFile, mkdir, copyFile, stat, readdir, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, timingSafeEqual } from "node:crypto";
import vm from "node:vm";

const root = fileURLToPath(new URL(".", import.meta.url));
const dataFile = join(root, "data.js");
const placeholderFile = join(root, "assets/family/placeholder.bmp");
const archiveRoot = join(root, "assets/archive");
const port = Number(process.env.PORT || 8001);
const host = process.env.HOST || "127.0.0.1";
const adminPassword = process.env.ADMIN_PASSWORD || process.env.SITE_PASSWORD;
const viewerPassword = process.env.VIEWER_PASSWORD;
const minPasswordLength = Number(process.env.MIN_PASSWORD_LENGTH || 12);
const sessionMaxAgeSeconds = Number(process.env.SESSION_MAX_AGE_SECONDS || 60 * 60 * 24 * 30);
const cookieSecure = process.env.COOKIE_SECURE !== "false";
const trustProxy = process.env.TRUST_PROXY === "true";
const maxLoginAttempts = Number(process.env.LOGIN_MAX_ATTEMPTS || 5);
const loginWindowMs = Number(process.env.LOGIN_WINDOW_MS || 15 * 60 * 1000);
const loginBlockMs = Number(process.env.LOGIN_BLOCK_MS || 15 * 60 * 1000);
const ROLE_ADMIN = "admin";
const ROLE_VIEWER = "viewer";
const sessions = new Map();
const loginAttempts = new Map();
const travelPhotoCount = 10;
const publicPaths = new Set([
  "/",
  "/index.html",
  "/styles.css",
  "/script.js",
  "/robots.txt",
  "/assets/family/favicon.png",
  "/assets/family/favicon.svg",
  "/assets/family/hero-family.jpg",
  "/assets/maps/world-map.png",
  "/assets/maps/china-map.png",
]);
const cacheablePublicPaths = new Set([
  "/assets/family/favicon.png",
  "/assets/family/favicon.svg",
  "/assets/family/hero-family.jpg",
  "/assets/maps/world-map.png",
  "/assets/maps/china-map.png",
]);

if (!adminPassword || !viewerPassword || adminPassword.length < minPasswordLength || viewerPassword.length < minPasswordLength) {
  console.error(`请先设置 ADMIN_PASSWORD 和 VIEWER_PASSWORD 环境变量，长度都至少 ${minPasswordLength} 个字符。`);
  process.exit(1);
}

if (adminPassword === viewerPassword) {
  console.error("ADMIN_PASSWORD 和 VIEWER_PASSWORD 不能相同。");
  process.exit(1);
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".bmp": "image/bmp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml; charset=utf-8",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
};

createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/api/login") {
      await handleLogin(request, response);
      return;
    }
    const session = currentSession(request);
    if (!isPublicRequest(request) && !session) {
      sendJson(response, 401, { error: "需要密码" });
      return;
    }
    if (request.method === "POST" && request.url === "/api/create") {
      await handleCreate(request, response, session);
      return;
    }
    await serveStatic(request, response, session);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}).listen(port, host, () => {
  console.log(`Family site running at http://${host}:${port}/`);
});

async function handleLogin(request, response) {
  const blockedMs = remainingLoginBlockMs(request);
  if (blockedMs > 0) {
    sendJson(response, 429, { error: `尝试次数过多，请 ${Math.ceil(blockedMs / 60000)} 分钟后再试。` });
    return;
  }

  const body = await readBody(request);
  const { password } = JSON.parse(body || "{}");
  const role = matchingRole(password);
  if (!role) {
    recordFailedLogin(request);
    sendJson(response, 401, { error: "密码不正确" });
    return;
  }

  clearFailedLogins(request);
  const data = await readData();
  const token = createSession(role);
  response.writeHead(200, {
    ...securityHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Set-Cookie": sessionCookie(token),
  });
  response.end(JSON.stringify({ ok: true, role, data: visibleDataForRole(data, role) }));
}

async function handleCreate(request, response, session) {
  if (!isAdminSession(session)) {
    sendJson(response, 403, { error: "访客模式不能创建或修改内容" });
    return;
  }

  const body = await readBody(request);
  const { kind, payload } = JSON.parse(body || "{}");
  const data = await readData();
  let created;

  if (kind === "timeline") created = await createTimeline(data, payload);
  else if (kind === "album") created = await createAlbum(data, payload);
  else if (kind === "map") created = await createTravel(data, payload);
  else if (kind === "calendar") created = await createCalendarEvent(data, payload);
  else throw new Error("未知创建类型");

  await writeData(data);
  sendJson(response, 200, { data: visibleDataForRole(data, ROLE_ADMIN), created });
}

async function createTimeline(data, payload) {
  requireFields(payload, ["date", "title", "place", "summary"]);
  const folder = `assets/timeline/${payload.date}`;
  await createPhotoFolder(folder, 1, { removeExtraPlaceholders: true });
  const event = {
    date: payload.date,
    title: payload.title,
    place: payload.place,
    summary: payload.summary,
    folder,
    photos: makePhotos(folder, 1, payload.title),
  };
  data.timelineEvents.push(event);
  return { kind: "timeline", folder, id: null };
}

async function createAlbum(data, payload) {
  requireFields(payload, ["month", "title", "summary"]);
  const folder = `assets/monthly/${payload.month}`;
  await createPhotoFolder(folder, 5);
  const album = {
    id: payload.month,
    month: `${payload.month.slice(0, 4)} 年 ${Number(payload.month.slice(5, 7))} 月`,
    title: payload.title,
    summary: payload.summary,
    folder,
    photos: makePhotos(folder, 5, payload.title),
  };
  data.monthlyAlbums = data.monthlyAlbums.filter((item) => item.id !== payload.month);
  data.monthlyAlbums.push(album);
  data.family.latestMonthId = payload.month;
  return { kind: "album", folder, id: payload.month };
}

async function createTravel(data, payload) {
  requireFields(payload, ["date", "name", "country", "kind", "placeSummary", "x", "y", "summary"]);
  const folder = `assets/travel/${payload.date}-${slug(payload.name)}`;
  await createPhotoFolder(folder, travelPhotoCount);
  const id = `${payload.date}-${slug(payload.name)}`;
  const photos = makePhotos(folder, travelPhotoCount, payload.name);
  const worldPosition = { x: clamp(Number(payload.x), 0, 100), y: clamp(Number(payload.y), 0, 100) };
  const chinaPosition = { x: clamp(Number(payload.chinaX), 0, 100), y: clamp(Number(payload.chinaY), 0, 100) };
  const place = {
    id,
    name: payload.name,
    country: payload.country,
    kind: payload.kind,
    date: payload.date,
    worldPosition,
    chinaPosition,
    placeSummary: payload.placeSummary,
    summary: payload.summary,
    folder,
    cover: photos[0],
    photos,
  };
  data.travelPlaces.push(place);
  return { kind: "map", folder, id };
}

async function createCalendarEvent(data, payload) {
  requireFields(payload, ["date", "title"]);
  const allDay = payload.allDay === true || payload.allDay === "true" || !payload.time;
  const event = {
    id: nextId(data.calendarEvents),
    date: payload.date,
    title: payload.title,
    time: allDay ? "" : payload.time,
    allDay,
  };
  data.calendarEvents.push(event);
  data.family.currentCalendar = {
    year: Number(payload.date.slice(0, 4)),
    month: Number(payload.date.slice(5, 7)),
  };
  return { kind: "calendar", id: event.id };
}

function nextId(items) {
  return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

async function createPhotoFolder(folder, count, options = {}) {
  const absoluteFolder = safePath(folder);
  await mkdir(absoluteFolder, { recursive: true });
  const readme = [
    "把真实照片拖进这个文件夹，并覆盖 01.bmp、02.bmp 这样的占位文件即可。",
    `需要照片数量：${count}`,
    "建议保留两位数字文件名，网页会按编号顺序读取。",
    "",
  ].join("\n");
  await writeFile(join(absoluteFolder, "README.txt"), readme, "utf8");
  for (let index = 1; index <= count; index += 1) {
    await copyFile(placeholderFile, join(absoluteFolder, `${String(index).padStart(2, "0")}.bmp`));
  }
  if (options.removeExtraPlaceholders) await removeExtraPlaceholderFiles(absoluteFolder, count);
}

async function removeExtraPlaceholderFiles(folder, count) {
  const placeholder = await readFile(placeholderFile);
  const files = await readdir(folder);
  await Promise.all(
    files
      .filter((file) => /^\d{2}\.bmp$/i.test(file) && Number(file.slice(0, 2)) > count)
      .map(async (file) => {
        const target = join(folder, file);
        const content = await readFile(target);
        if (Buffer.compare(content, placeholder) === 0) await unlink(target);
      }),
  );
}

function makePhotos(folder, count, label) {
  return Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return { src: `${folder}/${number}.bmp`, caption: `${label} ${index + 1}` };
  });
}

async function readData() {
  const text = await readFile(dataFile, "utf8");
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(text, sandbox, { filename: "data.js", timeout: 1000 });
  if (!sandbox.window.familyData) throw new Error("data.js 格式不正确");
  return sandbox.window.familyData;
}

async function writeData(data) {
  await writeFile(dataFile, `window.familyData = ${JSON.stringify(data, null, 2)};\n`, "utf8");
}

async function serveStatic(request, response, session) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  if (pathname === "/data.js") {
    await serveDataJs(response, session);
    return;
  }

  const filePath = safePath(pathname.slice(1));
  if (isArchivePath(filePath) && !isAdminSession(session)) {
    sendJson(response, 403, { error: "访客模式不能访问家庭资料库" });
    return;
  }

  const fileStat = await stat(filePath);
  if (fileStat.isDirectory() && isArchivePath(filePath)) {
    await serveArchiveDirectory(filePath, pathname, response);
    return;
  }
  if (!fileStat.isFile()) throw new Error("不是文件");
  response.writeHead(200, {
    ...staticFileHeaders(pathname),
    "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
}

async function serveDataJs(response, session) {
  const data = visibleDataForRole(await readData(), session?.role);
  response.writeHead(200, {
    ...securityHeaders(),
    "Content-Type": "text/javascript; charset=utf-8",
  });
  response.end(`window.familyData = ${JSON.stringify(data, null, 2)};\n`);
}

async function serveArchiveDirectory(folder, pathname, response) {
  const files = (await readdir(folder, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".pdf")
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
  const basePath = pathname.endsWith("/") ? pathname : `${pathname}/`;
  const links = files.map((file) => `<li><a href="${basePath}${encodeURIComponent(file)}">${escapeHtml(file)}</a></li>`).join("");
  response.writeHead(200, { ...securityHeaders(), "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><meta charset="utf-8"><title>PDF List</title><ul>${links}</ul>`);
}

function safePath(relativePath) {
  const target = resolve(root, normalize(relativePath));
  if (!target.startsWith(root)) throw new Error("路径不允许");
  return target;
}

function isArchivePath(target) {
  return target === archiveRoot || target.startsWith(`${archiveRoot}/`);
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function isPublicRequest(request) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  return (request.method === "GET" || request.method === "HEAD") && publicPaths.has(url.pathname);
}

function currentSession(request) {
  const cookies = Object.fromEntries(
    String(request.headers.cookie || "")
      .split(";")
      .map((cookie) => cookie.trim().split("="))
      .filter(([key, value]) => key && value),
  );
  const token = cookies.family_site_session;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function isAdminSession(session) {
  return session?.role === ROLE_ADMIN;
}

function matchingRole(password) {
  if (passwordMatches(password, adminPassword)) return ROLE_ADMIN;
  if (passwordMatches(password, viewerPassword)) return ROLE_VIEWER;
  return null;
}

function passwordMatches(password, expectedPassword) {
  const actual = Buffer.from(String(password || ""));
  const expected = Buffer.from(expectedPassword);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function createSession(role) {
  pruneExpiredSessions();
  const token = randomUUID();
  sessions.set(token, { role, expiresAt: Date.now() + sessionMaxAgeSeconds * 1000 });
  return token;
}

function sessionCookie(token) {
  return [
    `family_site_session=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${sessionMaxAgeSeconds}`,
    cookieSecure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}

function visibleDataForRole(data, role) {
  const visibleData = JSON.parse(JSON.stringify(data));
  visibleData.access = accessForRole(role);
  if (role !== ROLE_ADMIN) {
    visibleData.calendarEvents = [];
    if (visibleData.family) delete visibleData.family.currentCalendar;
  }
  return visibleData;
}

function accessForRole(role) {
  const isAdmin = role === ROLE_ADMIN;
  return {
    role: isAdmin ? ROLE_ADMIN : ROLE_VIEWER,
    canCreate: isAdmin,
    canViewCalendar: isAdmin,
    canViewArchive: isAdmin,
  };
}

function remainingLoginBlockMs(request) {
  const attempt = loginAttempts.get(clientKey(request));
  if (!attempt) return 0;
  if (attempt.blockedUntil > Date.now()) return attempt.blockedUntil - Date.now();
  return 0;
}

function recordFailedLogin(request) {
  const key = clientKey(request);
  const now = Date.now();
  const attempt = loginAttempts.get(key);
  const nextAttempt = !attempt || now - attempt.firstAt > loginWindowMs ? { count: 0, firstAt: now, blockedUntil: 0 } : attempt;
  nextAttempt.count += 1;
  if (nextAttempt.count >= maxLoginAttempts) nextAttempt.blockedUntil = now + loginBlockMs;
  loginAttempts.set(key, nextAttempt);
}

function clearFailedLogins(request) {
  loginAttempts.delete(clientKey(request));
}

function clientKey(request) {
  if (trustProxy) {
    const forwardedFor = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwardedFor) return forwardedFor;
  }
  return request.socket.remoteAddress || "unknown";
}

function securityHeaders(extraHeaders = {}) {
  return {
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...extraHeaders,
  };
}

function staticFileHeaders(pathname) {
  if (cacheablePublicPaths.has(pathname)) {
    return securityHeaders({ "Cache-Control": "public, max-age=604800, immutable" });
  }
  return securityHeaders();
}

function readBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) request.destroy();
    });
    request.on("end", () => resolveBody(body));
    request.on("error", rejectBody);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { ...securityHeaders(), "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function requireFields(payload, fields) {
  const missing = fields.filter((field) => !String(payload?.[field] ?? "").trim());
  if (missing.length) throw new Error(`缺少字段：${missing.join(", ")}`);
}

function slug(value) {
  const cleaned = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "event";
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}
