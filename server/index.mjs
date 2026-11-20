import http from "node:http";
import { handleRequest, startScheduler } from "./lib/api.mjs";

/**
 * 独立后端服务（便于真实部署）
 *   node server/index.mjs
 * 默认端口 8787，可通过 PORT 覆盖；开启 CORS，前端用 VITE_API_BASE_URL 指向它。
 */
const PORT = Number(process.env.PORT || 8787);
const PREFIX = "/api/v1/qa-news";

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
  });
}

function send(res, status, payload) {
  if (status === 204) {
    res.writeHead(204);
    res.end();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const method = (req.method || "GET").toUpperCase();
  const body = ["POST", "PATCH", "PUT"].includes(method) ? await readBody(req) : {};

  const { status, body: payload } = await handleRequest({
    method,
    // 统一去掉 /api/v1/qa-news 前缀，与 Vite 中间件保持同一套路由约定
    path: url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) || "/" : url.pathname,
    query: url.searchParams,
    body,
  });
  send(res, status, payload);
});

startScheduler();
server.listen(PORT, () => {
  console.log(`[server] 测试工程师资讯平台后端已启动: http://localhost:${PORT}`);
});
