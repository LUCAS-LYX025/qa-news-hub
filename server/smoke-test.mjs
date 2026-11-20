/**
 * 后端接口冒烟测试（直接调用 handleRequest，不依赖 HTTP 服务）
 *   node server/smoke-test.mjs
 *
 * 目的：一次性覆盖全部路由，捕获未声明变量、字段缺失等运行时错误。
 * 默认跳过真实网络抓取；加 --network 参数会额外跑一次真实抓取。
 */
import { handleRequest, MIN_CRAWL_QUALITY } from "./lib/api.mjs";
import { extractJuejinTagLinks } from "./lib/api.mjs";
import { readHtmlResponse } from "./lib/extractors.mjs";
import { translateArticle, isMostlyChinese, rewriteArticle } from "./lib/analyze.mjs";

const WITH_NETWORK = process.argv.includes("--network");
let pass = 0;
let fail = 0;
const failures = [];

async function call(method, path, { body = {}, query = {} } = {}) {
  const qs = new URLSearchParams(query);
  return handleRequest({ method, path, query: qs, body });
}

async function check(name, fn, expect = (r) => r.status >= 200 && r.status < 300) {
  try {
    const r = await fn();
    const ok = expect(r);
    if (ok) {
      pass++;
      console.log(`✓ ${name}  [${r.status}]`);
    } else {
      fail++;
      failures.push(`${name} → status=${r.status} body=${JSON.stringify(r.body).slice(0, 160)}`);
      console.log(`✗ ${name}  [${r.status}] ${JSON.stringify(r.body).slice(0, 120)}`);
    }
    return r;
  } catch (e) {
    fail++;
    failures.push(`${name} → 抛出异常: ${e.message}`);
    console.log(`✗ ${name}  抛出异常: ${e.message}`);
    return null;
  }
}

console.log("=== 基础读接口 ===");
// 订阅源适配器必须独立于外网可回归：掘金标签 API 的文章记录应变成正文 URL。
{
  const links = extractJuejinTagLinks({ data: [{ article_info: { article_id: "7681266980105142278", title: "Agent 实践" } }] });
  await check("掘金标签 API → 文章链接", async () => ({ status: links[0]?.url === "https://juejin.cn/post/7681266980105142278" ? 200 : 500, body: links }));
}
// 51Testing 的 GBK 列表页必须按原编码读取，不能出现 UTF-8 乱码。
{
  // "测试" 的 GBK 字节为 B2 E2 CA D4，UTF-8 解码会变成乱码。
  const bytes = Uint8Array.from([0xb2, 0xe2, 0xca, 0xd4]);
  const gbkResponse = { headers: new Headers({ "content-type": "text/html; charset=gbk" }), arrayBuffer: async () => bytes.buffer };
  const decoded = await readHtmlResponse(gbkResponse, "http://www.51testing.com/html/index.html");
  await check("GBK HTML 解码路径", async () => ({ status: decoded === "测试" ? 200 : 500, body: { decoded } }));
}
await check("GET /categories", () => call("GET", "/categories"));
await check("GET /articles", () => call("GET", "/articles"));
await check("GET /articles?sort=quality", () => call("GET", "/articles", { query: { sort: "quality" } }));
await check("GET /articles?sort=views", () => call("GET", "/articles", { query: { sort: "views" } }));
await check("GET /articles?min_quality=50", () => call("GET", "/articles", { query: { min_quality: "50" } }));
await check("GET /articles?keyword=测试", () => call("GET", "/articles", { query: { keyword: "测试" } }));
await check("GET /stats", () => call("GET", "/stats"));
await check("GET /subscriptions", () => call("GET", "/subscriptions"));

console.log("\n=== 鉴权 ===");
await check("POST /auth/login 正确密码", () =>
  call("POST", "/auth/login", { body: { username: "admin-demo", password: "1234567890" } }),
);
await check(
  "POST /auth/login 错误密码（应 401）",
  () => call("POST", "/auth/login", { body: { username: "admin-demo", password: "wrong" } }),
  (r) => r.status === 401,
);

console.log("\n=== 文章操作 ===");
const list = await call("GET", "/articles");
const first = list.body?.entity?.items?.[0];
if (first) {
  await check(`GET /articles/${first.id}`, () => call("GET", `/articles/${first.id}`));
  await check("POST /articles/:id/view", () => call("POST", `/articles/${first.id}/view`));
  await check("POST /articles/:id/summarize", () => call("POST", `/articles/${first.id}/summarize`));
  await check("POST /articles/:id/rescore", () => call("POST", `/articles/${first.id}/rescore`));
} else {
  console.log("(跳过：没有文章数据)");
}
await check("GET /articles/不存在（应 404）", () => call("GET", "/articles/nope_xxx"), (r) => r.status === 404);

console.log("\n=== 参数校验（应被拒绝） ===");
await check("crawl 空 URL（应 400）", () => call("POST", "/articles/crawl", { body: { url: "" } }), (r) => r.status === 400);
await check(
  "crawl 列表页 URL（应 422）",
  () => call("POST", "/articles/crawl", { body: { url: "https://testerhome.com/topics" } }),
  (r) => r.status === 422,
);
await check(
  "crawl-batch 空数组（应 400）",
  () => call("POST", "/articles/crawl-batch", { body: { urls: [] } }),
  (r) => r.status === 400,
);
await check(
  "订阅源非法 URL（应 400）",
  () => call("POST", "/subscriptions", { body: { url: "abc" } }),
  (r) => r.status === 400,
);

// 去重：同一 URL（含末尾斜杠/大小写差异）重复添加应返回 409
await (async () => {
  const dupUrl = "https://example-dedup-test.com/feed";
  const a = await call("POST", "/subscriptions", { body: { url: dupUrl, name: "去重源A" } });
  const aId = a?.body?.entity?.id;
  const b = await call("POST", "/subscriptions", { body: { url: dupUrl + "/", name: "去重源B" } });
  await check(
    "订阅源重复添加（应 409 DUPLICATE_SUBSCRIPTION）",
    () => ({ status: b.status, body: b.body }),
    (r) => r.status === 409 && r.body?.detail?.code === "DUPLICATE_SUBSCRIPTION",
  );
  if (aId) await call("DELETE", `/subscriptions/${aId}`);
})();

console.log("\n=== 订阅源 CRUD + 采集 ===");
const created = await check("POST /subscriptions", () =>
  call("POST", "/subscriptions", {
    body: {
      url: "https://smoke-test.local/feed-" + Date.now(),
      name: "冒烟测试源",
      category: "c_auto",
      interval_minutes: 120,
      max_per_run: 1,
      min_quality: 1, // 尝试降低门槛时必须被服务端钳制为 61 分
    },
  }),
);
const subId = created?.body?.entity?.id;
if (subId) {
  const s = created.body.entity;
  await check(
    "订阅源质量门槛不得低于 61 分",
    async () => ({ status: s.min_quality === MIN_CRAWL_QUALITY && s.enabled === true ? 200 : 500, body: s }),
  );
  await check("PATCH /subscriptions/:id", () => call("PATCH", `/subscriptions/${subId}`, { body: { enabled: false } }));

  if (WITH_NETWORK) {
    // 真实采集：门槛 95 分，几乎必然全部被低质过滤，用于验证 lowQuality 统计分支
    const r = await check("POST /subscriptions/:id/run（真实网络）", () => call("POST", `/subscriptions/${subId}/run`));
    if (r?.body?.entity) console.log("   采集统计:", JSON.stringify(r.body.entity));
  } else {
    console.log("(跳过真实采集，加 --network 可启用)");
  }
  await check("DELETE /subscriptions/:id", () => call("DELETE", `/subscriptions/${subId}`));
  await check("DELETE 已删除的订阅源（应 404）", () => call("DELETE", `/subscriptions/${subId}`), (r) => r.status === 404);
}

console.log("\n=== 二创：AI 改写 / 版本 / 查重 / 署名 ===");
// 本地模型改写：CSDN 规则、自定义提示词和反编造约束必须进入模型请求。
{
  const prevUrl = process.env.LOCAL_LLM_URL;
  const origFetch = global.fetch;
  try {
    process.env.LOCAL_LLM_URL = "http://127.0.0.1:11434/v1";
    let prompt = "";
    global.fetch = async (_url, init) => {
      prompt = JSON.parse(init.body).messages[0].content;
      return { ok: true, json: async () => ({ choices: [{ message: { content: "# CSDN 标题\n\n改写结果" } }] }) };
    };
    const r = await rewriteArticle("原文内容", { style: "csdn", custom_prompt: "自定义：用表格列出适用场景。" });
    const ok = r.engine === "llm" && prompt.includes("自定义：用表格列出适用场景。") && prompt.includes("不得添加输入文章没有的测试结论");
    await check("rewriteArticle CSDN 自定义提示词与反编造约束", async () => ({ status: ok ? 200 : 500, body: { r, prompt } }), (x) => x.status === 200);
  } finally {
    process.env.LOCAL_LLM_URL = prevUrl;
    global.fetch = origFetch;
  }
}
if (first) {
  const v = await check("POST /articles/:id/rewrite（AI 改写）", () =>
    call("POST", `/articles/${first.id}/rewrite`, { body: { intensity: "medium", style: "tutorial", protect: ["Playwright"] } }),
  );
  const vid = v?.body?.entity?.id;
  await check("GET /articles/:id/versions", () => call("GET", `/articles/${first.id}/versions`));
  const mv = await check("POST /articles/:id/versions（手动保存）", () =>
    call("POST", `/articles/${first.id}/versions`, { body: { title: "手动版", content: "这是一段手动改写的内容。" } }),
  );
  const mvid = mv?.body?.entity?.id;
  if (mvid) {
    await check("PATCH /articles/:id/versions/:vid", () =>
      call("PATCH", `/articles/${first.id}/versions/${mvid}`, { body: { content: "改后的内容。" } }),
    );
    await check("POST /articles/:id/versions/:vid/activate", () =>
      call("POST", `/articles/${first.id}/versions/${mvid}/activate`),
    );
    await check("DELETE /articles/:id/versions/:vid", () =>
      call("DELETE", `/articles/${first.id}/versions/${mvid}`),
    );
  } else {
    console.log("(跳过：手动版本创建失败)");
  }
  const o = await check("POST /articles/:id/originality（查重）", () =>
    call("POST", `/articles/${first.id}/originality`, { body: { text: "这是一段完全不同的测试内容用于检测相似度。" } }),
  );
  if (o?.body?.entity) console.log(`   原创度相似度: ${o.body.entity.similarity}%`);
  await check("GET /articles/:id/attribution", () => call("GET", `/articles/${first.id}/attribution`));
  const att = await check("POST /articles/:id/attribution（署名）", () =>
    call("POST", `/articles/${first.id}/attribution`, { body: { author: "原作者A", url: "https://example.com/a", declare_original: true } }),
  );
  if (att?.body?.entity?.snippet) console.log("   署名片段:\n" + att.body.entity.snippet.split("\n").map((l) => "     " + l).join("\n"));
  // 翻译：用 mock fetch 避免沙箱无网络时真实调用挂起；验证端点返回 200 且 engine 合法
  {
    const origFetch = global.fetch;
    global.fetch = async (u) => {
      const q = new URL(String(u)).searchParams.get("q") || "译文";
      return { ok: true, json: async () => [[[`译文${q}`]], null, "zh-CN"] };
    };
    await check("POST /articles/:id/translate（翻译：中文跳过/外文免费或需大模型）", () =>
      call("POST", `/articles/${first.id}/translate`),
      (r) => r.status === 200 && ["llm", "free", "skipped", "unavailable", "error"].includes(r.body?.entity?.engine),
    );
    global.fetch = origFetch;
  }
} else {
  console.log("(跳过：没有文章数据)");
}

console.log("\n=== 翻译模块（免费在线翻译管线，mock fetch 确定性验证） ===");
// 1) 中文文章应直接跳过
{
  const r = await translateArticle("# 标题\n这是一段中文内容，无需翻译。", { target: "zh" });
  await check(
    "translateArticle 中文 → skipped",
    async () => ({ status: r.engine === "skipped" && r.is_chinese === true ? 200 : 500, body: r }),
    (x) => x.status === 200,
  );
}
// 2) 英文文章 + mock fetch（回显 q，模拟 Google 保留占位符）→ 走 free 路径，且代码块/行内代码被保留
{
  const origFetch = global.fetch;
  try {
    global.fetch = async (u) => {
      const q = new URL(String(u)).searchParams.get("q") || "译文";
      return { ok: true, json: async () => [[[`译文${q}`]], null, "zh-CN"] };
    };
    const md =
      "## Getting Started\n\nRun `npm test` to verify.\n\n```bash\nkubectl apply -f app.yaml\n```\n\nHello world, this is a test.";
    const r = await translateArticle(md, { target: "zh" });
    const ok =
      r.engine === "free" &&
      !r.content.includes("CODESLOT") &&
      r.content.includes("npm test") &&
      r.content.includes("kubectl apply -f app.yaml");
    await check("translateArticle 英文 → free（代码块/行内代码保留，无残留占位符）", async () => ({ status: ok ? 200 : 500, body: r }), (x) => x.status === 200);
    if (r.content) console.log("   译文(回显模拟):\n" + r.content.split("\n").map((l) => "     " + l).join("\n"));
  } finally {
    global.fetch = origFetch;
  }
}
// 3) 长文翻译应使用全局 6 路并发池，而不是按段落串行请求。
{
  const origFetch = global.fetch;
  try {
    let active = 0;
    let maxActive = 0;
    global.fetch = async (u) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      const q = new URL(String(u)).searchParams.get("q") || "译文";
      return { ok: true, json: async () => [[[`译文${q}`]], null, "zh-CN"] };
    };
    const md = Array.from({ length: 7 }, (_, i) => `Paragraph ${i + 1}: ${"translation speed verification ".repeat(70)}`).join("\n\n");
    const r = await translateArticle(md, { target: "zh" });
    const ok = r.engine === "free" && maxActive === 6 && r.content.includes("Paragraph 7");
    await check("translateArticle 长文 → 全局 6 路并发", async () => ({ status: ok ? 200 : 500, body: { maxActive, engine: r.engine } }), (x) => x.status === 200);
  } finally {
    global.fetch = origFetch;
  }
}

// 4) 关闭免费翻译 → unavailable
{
  const prev = process.env.DISABLE_FREE_TRANSLATE;
  process.env.DISABLE_FREE_TRANSLATE = "1";
  const r = await translateArticle("Hello world, this is English.", { target: "zh" });
  process.env.DISABLE_FREE_TRANSLATE = prev;
  await check(
    "translateArticle DISABLE_FREE_TRANSLATE=1 → unavailable",
    async () => ({ status: r.engine === "unavailable" ? 200 : 500, body: r }),
    (x) => x.status === 200,
  );
}

// 5) 启动器配置的 LOCAL_LLM_URL 可带 /v1，接口路径不得重复拼接 /v1。
{
  const prevUrl = process.env.LOCAL_LLM_URL;
  const prevDisabled = process.env.DISABLE_FREE_TRANSLATE;
  const origFetch = global.fetch;
  try {
    process.env.LOCAL_LLM_URL = "http://127.0.0.1:11434/v1";
    process.env.DISABLE_FREE_TRANSLATE = "1";
    let requestedUrl = "";
    global.fetch = async (u) => {
      requestedUrl = String(u);
      return { ok: true, json: async () => ({ choices: [{ message: { content: "本地模型译文" } }] }) };
    };
    const r = await translateArticle("Hello world, this is English.", { target: "zh" });
    const ok = r.engine === "llm" && requestedUrl === "http://127.0.0.1:11434/v1/chat/completions";
    await check("translateArticle LOCAL_LLM_URL 含 /v1 → 正确端点", async () => ({ status: ok ? 200 : 500, body: { r, requestedUrl } }), (x) => x.status === 200);
  } finally {
    process.env.LOCAL_LLM_URL = prevUrl;
    process.env.DISABLE_FREE_TRANSLATE = prevDisabled;
    global.fetch = origFetch;
  }
}

// 6) 配置百度翻译时优先使用百度，并校验签名请求参数。
{
  const prevAppid = process.env.BAIDU_TRANSLATE_APPID;
  const prevKey = process.env.BAIDU_TRANSLATE_KEY;
  const origFetch = global.fetch;
  try {
    process.env.BAIDU_TRANSLATE_APPID = "test-appid";
    process.env.BAIDU_TRANSLATE_KEY = "test-key";
    let requestUrl = "";
    global.fetch = async (u) => {
      requestUrl = String(u);
      return { ok: true, json: async () => ({ trans_result: [{ dst: "这是百度译文。" }] }) };
    };
    const r = await translateArticle("This is a translation provider test.", { target: "zh" });
    const url = new URL(requestUrl);
    const ok = r.engine === "free" && r.content.includes("百度") && url.hostname === "fanyi-api.baidu.com" && url.searchParams.get("appid") === "test-appid";
    await check("translateArticle 配置百度 → 国内优先使用百度", async () => ({ status: ok ? 200 : 500, body: { r, requestUrl } }), (x) => x.status === 200);
  } finally {
    process.env.BAIDU_TRANSLATE_APPID = prevAppid;
    process.env.BAIDU_TRANSLATE_KEY = prevKey;
    global.fetch = origFetch;
  }
}

// 7) 配置 DeepL Key 时优先使用 DeepL，并通过表单 POST 传参。
{
  const prevKey = process.env.DEEPL_API_KEY;
  const origFetch = global.fetch;
  try {
    process.env.DEEPL_API_KEY = "test-key";
    let request = null;
    global.fetch = async (u, init = {}) => {
      request = { url: String(u), method: init.method, body: String(init.body || "") };
      return { ok: true, json: async () => ({ translations: [{ text: "这是 DeepL 译文。" }] }) };
    };
    const r = await translateArticle("This is a translation provider test.", { target: "zh" });
    const ok = r.engine === "free" && r.content.includes("DeepL") && request?.url.includes("api-free.deepl.com") && request.method === "POST";
    await check("translateArticle 配置 DeepL → 优先使用 DeepL", async () => ({ status: ok ? 200 : 500, body: { r, request } }), (x) => x.status === 200);
  } finally {
    process.env.DEEPL_API_KEY = prevKey;
    global.fetch = origFetch;
  }
}

console.log("\n=== 推荐订阅源 ===");
const recs = await check("GET /recommended-sources", () => call("GET", "/recommended-sources"));
if (Array.isArray(recs?.body?.entity)) console.log(`   推荐源数量: ${recs.body.entity.length}`);

console.log("\n" + "=".repeat(52));
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (failures.length) {
  console.log("\n失败明细:");
  failures.forEach((f) => console.log("  -", f));
}
process.exit(fail === 0 ? 0 : 1);
