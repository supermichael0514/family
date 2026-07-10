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
const sitePassword = process.env.SITE_PASSWORD || "150921";
const sessionToken = randomUUID();
const travelPhotoCount = 10;
const publicPaths = new Set([
  "/",
  "/index.html",
  "/styles.css",
  "/script.js",
  "/assets/family/favicon.png",
  "/assets/family/favicon.svg",
  "/assets/family/hero-family.jpg",
]);

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
    if (!isPublicRequest(request) && !isAuthenticated(request)) {
      sendJson(response, 401, { error: "需要密码" });
      return;
    }
    if (request.method === "POST" && request.url === "/api/create") {
      await handleCreate(request, response);
      return;
    }
    await serveStatic(request, response);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Family site running at http://127.0.0.1:${port}/`);
});

async function handleLogin(request, response) {
  const body = await readBody(request);
  const { password } = JSON.parse(body || "{}");
  if (!passwordMatches(password)) {
    sendJson(response, 401, { error: "密码不正确" });
    return;
  }

  const data = await readData();
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Set-Cookie": `family_site_session=${sessionToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`,
  });
  response.end(JSON.stringify({ ok: true, data }));
}

async function handleCreate(request, response) {
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
  sendJson(response, 200, { data, created });
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

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = safePath(pathname.slice(1));
  const fileStat = await stat(filePath);
  if (fileStat.isDirectory() && isArchivePath(filePath)) {
    await serveArchiveDirectory(filePath, pathname, response);
    return;
  }
  if (!fileStat.isFile()) throw new Error("不是文件");
  response.writeHead(200, { "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream" });
  createReadStream(filePath).pipe(response);
}

async function serveArchiveDirectory(folder, pathname, response) {
  const files = (await readdir(folder, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".pdf")
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
  const basePath = pathname.endsWith("/") ? pathname : `${pathname}/`;
  const links = files.map((file) => `<li><a href="${basePath}${encodeURIComponent(file)}">${escapeHtml(file)}</a></li>`).join("");
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
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

function isAuthenticated(request) {
  const cookies = Object.fromEntries(
    String(request.headers.cookie || "")
      .split(";")
      .map((cookie) => cookie.trim().split("="))
      .filter(([key, value]) => key && value),
  );
  return cookies.family_site_session === sessionToken;
}

function passwordMatches(password) {
  const actual = Buffer.from(String(password || ""));
  const expected = Buffer.from(sitePassword);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
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
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
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
