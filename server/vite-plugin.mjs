import { handleRequest, startScheduler } from "./lib/api.mjs";

/**
 * Vite 开发中间件：复用 server/lib/api.mjs 的同一套逻辑，
 * 这样 `npm run dev` 无需单独起后端进程；
 * 生产/真实部署则用 `node server/index.mjs`。
 */
export function qaNewsApiPlugin() {
  return {
    name: "qa-news-api",
    configureServer(server) {
      startScheduler();
      server.middlewares.use(async (req, res, next) => {
        const prefix = "/api/v1/qa-news";
        const rawUrl = (req.url || "").split("?")[0];
        if (!rawUrl.startsWith(prefix)) return next();

        const path = rawUrl.slice(prefix.length) || "/";
        const method = (req.method || "GET").toUpperCase();
        const query = new URLSearchParams((req.url || "").split("?")[1] || "");

        let body = {};
        if (["POST", "PATCH", "PUT"].includes(method)) {
          body = await new Promise((resolve) => {
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

        const { status, body: payload } = await handleRequest({ method, path, query, body });
        if (status === 204) {
          res.statusCode = 204;
          res.end();
          return;
        }
        res.statusCode = status;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(payload));
      });
    },
  };
}
