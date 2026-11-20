import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAndExtract, extractLinks, looksLikeListing, looksLikeListingUrl, htmlToMarkdown, httpError, readHtmlResponse } from "./extractors.mjs";
import { isDuplicate, qualityScore, summarize, keywords, normalizeUrl, rewriteArticle, originalityScore, attributionBlock, translateArticle, isMostlyChinese } from "./analyze.mjs";
import {
  loadStore,
  getArticles,
  getSubscriptions,
  getCategories,
  addArticle,
  updateArticle,
  removeArticle,
  findArticle,
  addSubscription,
  updateSubscription,
  removeSubscription,
  findSubscription,
  getArticleVersions,
  addArticleVersion,
  updateArticleVersion,
  removeArticleVersion,
  activateArticleVersion,
  setAttribution,
} from "./store.mjs";

loadStore();

// 资讯流只保留评分大于 60 的内容。所有抓取入口与订阅配置共用该下限，
// 避免手工添加或接口调用绕过订阅页的质量要求。
export const MIN_CRAWL_QUALITY = 61;

const USERS = [
  { id: "u_admin", username: "admin-demo", display_name: "管理员", role: "ADMIN", enabled: true },
  { id: "u_editor", username: "editor-demo", display_name: "测试编辑", role: "EDITOR", enabled: true },
];

// ---------------- 路由 ----------------
const routes = [];
function add(method, path, handler) {
  const keys = [];
  const pattern = new RegExp(
    "^" +
      path.replace(/:[^/]+/g, (m) => {
        keys.push(m.slice(1));
        return "([^/]+)";
      }) +
      "$"
  );
  routes.push({ method, pattern, keys, handler });
}

// 注意：handleRequest 依赖 throw 来返回错误状态，这里必须抛而不是返回
function notFound() {
  throw httpError(404, "资源不存在", "NOT_FOUND");
}

// 鉴权
add("POST", "/auth/login", async (_p, body) => {
  const u = USERS.find((x) => x.username === body?.username);
  if (!u || body?.password !== "1234567890" || !u.enabled) {
    throw httpError(401, "用户名或密码错误（演示账号 admin-demo / 1234567890）", "AUTH_FAILED");
  }
  return {
    access_token: "mock-" + u.id,
    token_type: "bearer",
    expires_in: 3600,
    user: { id: u.id, username: u.username, display_name: u.display_name, role: u.role },
  };
});
add("POST", "/auth/refresh", () => ({
  access_token: "mock-refresh",
  token_type: "bearer",
  expires_in: 3600,
  user: { id: "u_admin", username: "admin-demo", display_name: "管理员", role: "ADMIN" },
}));
add("POST", "/auth/logout", () => null);

// 分类
add("GET", "/categories", () => getCategories());

// 推荐订阅源（业界常用测试/QA 源）
const RECOMMENDED_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "recommended-sources.json");
add("GET", "/recommended-sources", () => {
  try {
    if (fs.existsSync(RECOMMENDED_FILE)) {
      return JSON.parse(fs.readFileSync(RECOMMENDED_FILE, "utf-8"));
    }
  } catch {
    /* ignore */
  }
  return [];
});

// 能力探测：前端据此提示「是否接入本地大模型（更强改写）」「免费翻译是否可用」
add("GET", "/features", () => ({
  local_llm: !!process.env.LOCAL_LLM_URL,
  local_llm_url: process.env.LOCAL_LLM_URL || null,
  // 免费在线翻译默认开启；设置 DISABLE_FREE_TRANSLATE=1 后关闭（离线/隐私场景）
  free_translate: process.env.DISABLE_FREE_TRANSLATE !== "1",
}));

// 统计（含质量分布）
add("GET", "/stats", () => {
  const arts = getArticles();
  const scored = arts.filter((a) => typeof a.quality_score === "number");
  const avg = scored.length ? Math.round(scored.reduce((s, a) => s + a.quality_score, 0) / scored.length) : 0;
  return {
    total: arts.length,
    crawled: arts.filter((a) => a.crawled).length,
    avg_quality: avg,
    by_category: getCategories().map((c) => ({
      ...c,
      count: arts.filter((a) => a.category === c.id).length,
    })),
    by_source: Object.entries(
      arts.reduce((acc, a) => {
        acc[a.source_name] = (acc[a.source_name] || 0) + 1;
        return acc;
      }, {})
    ).map(([name, count]) => ({ name, count })),
  };
});

// 列表
add("GET", "/articles", (_p, _b, q) => {
  const page = Number(q.get("page") || "1");
  const pageSize = Number(q.get("page_size") || "12");
  const category = q.get("category");
  const keyword = q.get("keyword");
  const tag = q.get("tag");
  const source = q.get("source");
  const minQuality = q.get("min_quality");
  const sort = q.get("sort") || "latest";

  let items = getArticles().slice();
  if (category) items = items.filter((a) => a.category === category);
  if (tag) items = items.filter((a) => (a.tags || []).includes(tag));
  if (source) items = items.filter((a) => a.source_name === source);
  if (minQuality) items = items.filter((a) => (a.quality_score ?? 0) >= Number(minQuality));
  if (keyword) {
    items = items.filter(
      (a) =>
        a.title.includes(keyword) ||
        a.summary.includes(keyword) ||
        (a.tags || []).some((t) => t.includes(keyword))
    );
  }
  if (sort === "quality") items.sort((a, b) => (b.quality_score ?? 0) - (a.quality_score ?? 0));
  else if (sort === "views") items.sort((a, b) => (b.view_count || 0) - (a.view_count || 0));
  else items.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  const total = items.length;
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total, page, page_size: pageSize };
});

// 单篇抓取（去重 + 评分 + 摘要）
add("POST", "/articles/crawl", async (_p, body) => {
  const url = (body?.url || "").trim();
  if (!/^https?:\/\//.test(url)) throw httpError(400, "请提供合法的 http(s) 链接", "BAD_URL");

  const arts = getArticles();

  // 先在 URL 层面拦掉明显的栏目/列表页，省一次抓取请求
  if (looksLikeListingUrl(url) && !body?.force) {
    throw httpError(422, "这看起来是列表/栏目页地址而非具体文章，请粘贴文章详情页链接", "LISTING_PAGE");
  }

  const extracted = await fetchAndExtract(url);

  if (looksLikeListing(extracted.text, extracted.content) && !body?.force) {
    throw httpError(422, "抓到的内容像是列表/导航页而非文章正文，请确认链接为文章详情页", "LISTING_PAGE");
  }

  const dup = isDuplicate(arts, { url, title: extracted.title });
  if (dup.duplicate && !body?.force) {
    throw httpError(409, `内容重复（${dup.reason}）：已存在《${dup.existing.title}》`, "DUPLICATE");
  }

  const { score, reasons } = qualityScore({
    text: extracted.text,
    content: extracted.content,
    source_name: extracted.source_name,
    published_at: extracted.published_at,
  });
  if (score < MIN_CRAWL_QUALITY) {
    throw httpError(422, `文章质量分 ${score}，低于入库门槛 ${MIN_CRAWL_QUALITY} 分，已拒绝保存`, "QUALITY_TOO_LOW");
  }
  const { summary, mode } = await summarize(extracted.text, 3);

  const article = addArticle({
    title: extracted.title,
    author: extracted.author,
    source_name: extracted.source_name,
    source_url: extracted.source_url,
    cover_image: extracted.cover_image,
    category: body?.category || "c_industry",
    tags: body?.tags?.length ? body.tags : keywords(extracted.text, 5),
    summary: summary || extracted.text.slice(0, 120),
    summary_source: mode,
    content: extracted.content,
    crawled: true,
    published_at: extracted.published_at || undefined,
    quality_score: score,
    quality_reasons: reasons,
    keywords: keywords(extracted.text, 6),
    text_length: extracted.text.length,
  });
  return article;
});

// 批量抓取（并发受控）
add("POST", "/articles/crawl-batch", async (_p, body) => {
  const urls = [...new Set((body?.urls || []).map((u) => String(u).trim()).filter(Boolean))];
  if (!urls.length) throw httpError(400, "请提供至少一个链接", "BAD_URLS");
  const concurrency = Math.min(4, Math.max(1, Number(body?.concurrency) || 3));

  const results = new Array(urls.length);
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= urls.length) break;
      const url = urls[i];
      try {
        if (looksLikeListingUrl(url) && !body?.force) {
          results[i] = { url, status: "failed", reason: "疑似列表/栏目页地址，已跳过", code: "LISTING_PAGE" };
          continue;
        }
        const extracted = await fetchAndExtract(url);
        if (looksLikeListing(extracted.text, extracted.content) && !body?.force) {
          results[i] = { url, status: "failed", reason: "内容像列表页而非正文，已跳过", code: "LISTING_PAGE" };
          continue;
        }
        const dup = isDuplicate(getArticles(), { url, title: extracted.title });
        if (dup.duplicate && !body?.force) {
          results[i] = { url, status: "duplicate", id: dup.existing.id, title: dup.existing.title, reason: dup.reason };
          continue;
        }
        const { score, reasons } = qualityScore({
          text: extracted.text,
          content: extracted.content,
          source_name: extracted.source_name,
          published_at: extracted.published_at,
        });
        if (score < MIN_CRAWL_QUALITY) {
          results[i] = { url, status: "failed", reason: `文章质量分 ${score}，低于入库门槛 ${MIN_CRAWL_QUALITY} 分`, code: "QUALITY_TOO_LOW", quality_score: score };
          continue;
        }
        const { summary, mode } = await summarize(extracted.text, 3);
        const a = addArticle({
          title: extracted.title,
          author: extracted.author,
          source_name: extracted.source_name,
          source_url: extracted.source_url,
          cover_image: extracted.cover_image,
          category: body?.category || "c_industry",
          tags: body?.tags?.length ? body.tags : keywords(extracted.text, 5),
          summary: summary || extracted.text.slice(0, 120),
          summary_source: mode,
          content: extracted.content,
          crawled: true,
          published_at: extracted.published_at || undefined,
          quality_score: score,
          quality_reasons: reasons,
          keywords: keywords(extracted.text, 6),
          text_length: extracted.text.length,
        });
        results[i] = { url, status: "ok", id: a.id, title: a.title, quality_score: score };
      } catch (e) {
        results[i] = { url, status: "failed", reason: e.message || "抓取失败", code: e.code || "ERROR" };
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const ok = results.filter((r) => r.status === "ok").length;
  const dup = results.filter((r) => r.status === "duplicate").length;
  const failed = results.filter((r) => r.status === "failed").length;
  return { results, summary: { total: urls.length, ok, duplicate: dup, failed } };
});

// 订阅源（定时采集）
add("GET", "/subscriptions", () => getSubscriptions());
add("POST", "/subscriptions", (_p, body) => {
  const url = (body?.url || "").trim();
  if (!/^https?:\/\//.test(url)) throw httpError(400, "请提供合法的 http(s) 链接", "BAD_URL");
  // 去重：同一订阅源 URL（归一化后）只允许添加一次，避免重复巡检与重复抓取
  const norm = normalizeUrl(url);
  const existing = getSubscriptions().find((x) => normalizeUrl(x.url) === norm);
  if (existing) throw httpError(409, `订阅源已存在：${existing.name}`, "DUPLICATE_SUBSCRIPTION");
  return addSubscription({
    url,
    name: body?.name || new URL(url).hostname.replace(/^www\./, ""),
    category: body?.category || "c_industry",
    tags: body?.tags || [],
    interval_minutes: Number(body?.interval_minutes) || 60,
    max_per_run: Number(body?.max_per_run) || 5,
    // 采集质量门槛：低于该分数的文章直接丢弃，避免把低质量内容灌进资讯流
    min_quality: Math.max(MIN_CRAWL_QUALITY, Number.isFinite(Number(body?.min_quality)) ? Number(body.min_quality) : MIN_CRAWL_QUALITY),
    enabled: body?.enabled !== false,
  });
});
add("PATCH", "/subscriptions/:id", (p, body) => {
  const s = findSubscription(p.id);
  if (!s) throw notFound();
  const patch = { ...body };
  if (Object.hasOwn(patch, "min_quality")) patch.min_quality = Math.max(MIN_CRAWL_QUALITY, Number(patch.min_quality) || MIN_CRAWL_QUALITY);
  return updateSubscription(p.id, patch);
});
add("DELETE", "/subscriptions/:id", (p) => {
  const s = findSubscription(p.id);
  if (!s) throw notFound();
  removeSubscription(p.id);
  return null;
});

// 详情 / 阅读数 / 删除 / 重新生成摘要
add("GET", "/articles/:id", (p) => {
  const a = findArticle(p.id);
  if (!a) throw notFound();
  // 历史文章可能只有 HTML content，按需补算一份 Markdown 并落库，供二创/查重/复制使用
  if (!a.content_md && a.content) {
    try {
      return updateArticle(p.id, { content_md: htmlToMarkdown(a.content) });
    } catch {
      /* 忽略落库失败，回退返回原文 */
    }
  }
  return a;
});
add("POST", "/articles/:id/view", (p) => {
  const a = findArticle(p.id);
  if (!a) throw notFound();
  return { view_count: updateArticle(p.id, { view_count: (a.view_count || 0) + 1 }).view_count };
});
add("POST", "/articles/:id/summarize", async (p, body) => {
  const a = findArticle(p.id);
  if (!a) throw notFound();
  const text = a.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const { summary, mode } = await summarize(text, Number(body?.sentences) || 3);
  return updateArticle(p.id, { summary, summary_source: mode, keywords: keywords(text, 6) });
});
add("POST", "/articles/:id/rescore", (p) => {
  const a = findArticle(p.id);
  if (!a) throw notFound();
  const text = a.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const { score, reasons } = qualityScore({
    text,
    content: a.content,
    source_name: a.source_name,
    published_at: a.published_at,
  });
  return updateArticle(p.id, { quality_score: score, quality_reasons: reasons });
});

// ---------------- 二创：AI 改写 / 版本 / 查重 / 署名 ----------------
add("POST", "/articles/:id/rewrite", async (p, body) => {
  const a = findArticle(p.id);
  if (!a) throw notFound();
  const intensity = ["light", "medium", "deep"].includes(body?.intensity) ? body.intensity : "medium";
  const style = ["tutorial", "opinion", "dry", "csdn"].includes(body?.style) ? body.style : "csdn";
  const template = typeof body?.template === "string" ? body.template : "";
  const protect = Array.isArray(body?.protect) ? body.protect : String(body?.protect || "").split(/[\n,，]/).map((s) => s.trim()).filter(Boolean);
  const custom_prompt = typeof body?.custom_prompt === "string" ? body.custom_prompt.slice(0, 6000) : "";
  // 改写基于 Markdown（启发式/大模型都按 Markdown 处理），避免对 HTML 标签做同义词替换导致结构损坏
  const src = a.content_md || htmlToMarkdown(a.content || "");
  const { content, engine } = await rewriteArticle(src, { intensity, style, protect, template, custom_prompt });
  const v = addArticleVersion(a.id, {
    type: "ai",
    title: `${a.title}（AI改写·${style}）`,
    content,
    engine,
    intensity,
    style,
    template,
    protect,
  });
  return v;
});
add("POST", "/articles/:id/translate", async (p) => {
  const a = findArticle(p.id);
  if (!a) throw notFound();
  // 翻译基于 Markdown；中文文章无需翻译（保留原文，逻辑不变）
  const src = a.content_md || htmlToMarkdown(a.content || "");
  if (isMostlyChinese(src)) {
    return { content: src, engine: "skipped", message: "原文已是中文，无需翻译。", is_chinese: true };
  }
  const { content, engine, message } = await translateArticle(src, { target: "zh" });
  return { content, engine, message, is_chinese: false };
});
add("GET", "/articles/:id/versions", (p) => {
  const a = findArticle(p.id);
  if (!a) throw notFound();
  return a.versions || [];
});
add("POST", "/articles/:id/versions", (p, body) => {
  const a = findArticle(p.id);
  if (!a) throw notFound();
  if (!body?.content || !String(body.content).trim()) throw httpError(400, "版本内容不能为空", "BAD_CONTENT");
  return addArticleVersion(a.id, {
    type: body?.type === "ai" ? "ai" : "manual",
    title: body?.title?.trim() || `${a.title}（手动改写）`,
    content: body.content,
  });
});
add("PATCH", "/articles/:id/versions/:vid", (p, body) => {
  const v = updateArticleVersion(p.id, p.vid, body || {});
  if (!v) throw notFound();
  return v;
});
add("DELETE", "/articles/:id/versions/:vid", (p) => {
  if (!removeArticleVersion(p.id, p.vid)) throw notFound();
  return null;
});
add("POST", "/articles/:id/versions/:vid/activate", (p) => {
  const a = activateArticleVersion(p.id, p.vid);
  if (!a) throw notFound();
  return a;
});
add("POST", "/articles/:id/originality", (p, body) => {
  const a = findArticle(p.id);
  if (!a) throw notFound();
  const versions = a.versions || [];
  const target =
    body?.text != null
      ? body.text
      : versions.find((v) => v.id === a.active_version)?.content || versions[versions.length - 1]?.content || "";
  const base = a.content_md || htmlToMarkdown(a.content || "");
  const { similarity, similar, flagged } = originalityScore(base, target);
  return { similarity, similar, flagged, base: "original" };
});
add("GET", "/articles/:id/attribution", (p) => {
  const a = findArticle(p.id);
  if (!a) throw notFound();
  const att = a.attribution || { author: a.author, url: a.source_url, note: "", declare_original: false };
  return { attribution: att, snippet: attributionBlock(a, { declare_original: att.declare_original }) };
});
add("POST", "/articles/:id/attribution", (p, body) => {
  const a = findArticle(p.id);
  if (!a) throw notFound();
  const att = {
    author: body?.author ?? a.author,
    url: body?.url ?? a.source_url,
    note: body?.note ?? "",
    declare_original: !!body?.declare_original,
  };
  setAttribution(a.id, att);
  return { attribution: att, snippet: attributionBlock(a, { declare_original: att.declare_original }) };
});
add("POST", "/articles", (_p, body) =>
  addArticle({
    title: body?.title || "未命名",
    author: body?.author || "手动录入",
    source_name: body?.source_name || "站内",
    source_url: body?.source_url || null,
    category: body?.category || "c_industry",
    tags: body?.tags || [],
    summary: body?.summary || (body?.content || "").replace(/<[^>]+>/g, " ").slice(0, 120),
    content: body?.content || "",
    crawled: false,
  })
);
add("DELETE", "/articles/:id", (p) => {
  const a = findArticle(p.id);
  if (!a) throw notFound();
  removeArticle(p.id);
  return null;
});

// 去重预检：给定 URL 判断是否已存在
add("POST", "/dedup-check", (_p, body) => {
  const arts = getArticles();
  const nUrl = normalizeUrl(body?.url || "");
  const hit = arts.find((a) => normalizeUrl(a.source_url || "") === nUrl);
  return { duplicate: !!hit, existing: hit ? { id: hit.id, title: hit.title } : null };
});

// ---------------- 调度：订阅源定时采集 ----------------
const JUEJIN_TAG_IDS = {
  Agent: "7516396389476401162",
  "人工智能": "6809640642101116936",
};

export function extractJuejinTagLinks(feed) {
  const seen = new Set();
  return (Array.isArray(feed?.data) ? feed.data : [])
    .map((item) => {
      const info = item?.article_info;
      const id = String(info?.article_id || item?.article_id || "");
      if (!/^\d{10,}$/.test(id) || !info?.title || seen.has(id)) return null;
      seen.add(id);
      return { url: `https://juejin.cn/post/${id}`, title: info.title.trim() };
    })
    .filter(Boolean);
}

function juejinTagId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.replace(/^www\./, "") !== "juejin.cn") return null;
    return JUEJIN_TAG_IDS[decodeURIComponent(u.pathname).replace(/^\/tag\//, "")] || null;
  } catch {
    return null;
  }
}

async function getSubscriptionLinks(sub) {
  const tagId = juejinTagId(sub.url);
  if (tagId) {
    const res = await fetch("https://api.juejin.cn/recommend_api/v1/article/recommend_tag_feed?aid=2608&uuid=&spider=0", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://juejin.cn", Referer: "https://juejin.cn/" },
      body: JSON.stringify({ id_type: 2, cursor: "0", tag_ids: [tagId], sort_type: 200 }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw httpError(502, `掘金标签接口返回 ${res.status}`, "SOURCE_FETCH_FAILED");
    const feed = await res.json();
    if (feed?.err_no !== 0) throw httpError(502, `掘金标签接口失败：${feed?.err_msg || "未知错误"}`, "SOURCE_FETCH_FAILED");
    return extractJuejinTagLinks(feed).slice(0, (sub.max_per_run || 5) * 4);
  }

  const res = await fetch(sub.url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; QANewsHub/1.0)" },
    signal: AbortSignal.timeout(20000),
  });
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("html")) throw httpError(415, "订阅源不是 HTML 页面", "BAD_SOURCE");
  const html = await readHtmlResponse(res, sub.url);
  return extractLinks(html, sub.url, { limit: (sub.max_per_run || 5) * 4 });
}

async function runSubscription(sub) {
  const startedAt = Date.now();
  let added = 0;
  let skipped = 0;
  let failed = 0;
  // 被质量门槛 / 列表页识别拦下的数量
  let lowQuality = 0;
  try {
    const links = await getSubscriptionLinks(sub);
    const target = sub.max_per_run || 5;
    for (const link of links) {
      if (added >= target) break;
      try {
        // URL 层面先过滤栏目/导航页，避免把「Selenium · 社区」这类节点页当文章抓进来
        if (looksLikeListingUrl(link.url)) {
          lowQuality++;
          continue;
        }
        const dup = isDuplicate(getArticles(), { url: link.url, title: link.title });
        if (dup.duplicate) {
          skipped++;
          continue;
        }
        const extracted = await fetchAndExtract(link.url);
        if (looksLikeListing(extracted.text)) {
          lowQuality++;
          continue;
        }
        const dup2 = isDuplicate(getArticles(), { url: link.url, title: extracted.title });
        if (dup2.duplicate) {
          skipped++;
          continue;
        }
        const { score, reasons } = qualityScore({
          text: extracted.text,
          content: extracted.content,
          source_name: extracted.source_name,
          published_at: extracted.published_at,
        });
        if (score < Math.max(MIN_CRAWL_QUALITY, sub.min_quality ?? MIN_CRAWL_QUALITY)) {
          lowQuality++;
          continue;
        }
        const { summary, mode } = await summarize(extracted.text, 3);
        addArticle({
          title: extracted.title,
          author: extracted.author,
          source_name: extracted.source_name,
          source_url: extracted.source_url,
          cover_image: extracted.cover_image,
          category: sub.category || "c_industry",
          tags: sub.tags?.length ? sub.tags : keywords(extracted.text, 5),
          summary: summary || extracted.text.slice(0, 120),
          summary_source: mode,
          content: extracted.content,
          crawled: true,
          via_subscription: sub.id,
          published_at: extracted.published_at || undefined,
          quality_score: score,
          quality_reasons: reasons,
          text_length: extracted.text.length,
          keywords: keywords(extracted.text, 6),
        });
        added++;
      } catch {
        failed++;
      }
    }
    updateSubscription(sub.id, {
      last_run_at: new Date().toISOString(),
      last_status: `新增 ${added} / 重复 ${skipped} / 低质 ${lowQuality} / 失败 ${failed}（${Date.now() - startedAt}ms）`,
      collected_count: (sub.collected_count || 0) + added,
    });
    return { added, skipped, low_quality: lowQuality, failed };
  } catch (e) {
    updateSubscription(sub.id, {
      last_run_at: new Date().toISOString(),
      last_status: `失败：${e.message}`,
    });
    throw e;
  }
}

add("POST", "/subscriptions/:id/run", async (p) => {
  const s = findSubscription(p.id);
  if (!s) throw notFound();
  return runSubscription(s);
});

export function startScheduler(intervalMs = 60000) {
  // 跨进程文件锁：确保全局只有一个 dev/后端实例在跑定时采集。
  // 否则多个 vite 实例（各自 startScheduler）会并发采集、互相看不到对方已写入的文章，
  // 导致同一篇文章被重复入库。dev server 正常退出会删锁；崩溃则用陈旧时间兜底清理。
  const LOCK = path.join(__dirname, "..", ".scheduler.lock");
  try {
    if (fs.existsSync(LOCK)) {
      const age = Date.now() - fs.statSync(LOCK).mtimeMs;
      if (age > 5 * 60 * 1000) fs.unlinkSync(LOCK);
    }
    fs.writeFileSync(LOCK, String(process.pid), { flag: "wx" });
  } catch {
    console.log("[scheduler] 已有实例在运行定时采集，本进程跳过 startScheduler");
    return null;
  }
  const releaseLock = () => { try { fs.unlinkSync(LOCK); } catch { /* ignore */ } };
  process.on("exit", releaseLock);
  process.on("SIGINT", () => { releaseLock(); process.exit(0); });
  process.on("SIGTERM", () => { releaseLock(); process.exit(0); });

  const timer = setInterval(async () => {
    const due = getSubscriptions().filter((s) => {
      if (!s.enabled) return false;
      if (!s.last_run_at) return true;
      const next = new Date(s.last_run_at).getTime() + (s.interval_minutes || 60) * 60000;
      return Date.now() >= next;
    });
    // 每周期最多处理 2 个到期订阅源，把采集负载摊平，避免 23 个源在首个周期被一次性触发导致 CPU 飙高、服务卡顿
    for (const s of due.slice(0, 2)) {
      try {
        await runSubscription(s);
      } catch {
        /* 已在 runSubscription 内记录状态 */
      }
    }
  }, intervalMs);
  return timer;
}

// ---------------- 请求分发（供 Vite 中间件 & 独立 Node 服务复用） ----------------
export async function handleRequest({ method, path, query, body }) {
  const route = routes.find((r) => r.method === method && r.pattern.test(path));
  if (!route) return { status: 404, body: { detail: { message: `未实现的接口 ${method} ${path}`, code: "NOT_FOUND" } } };
  try {
    const params = {};
    const m = path.match(route.pattern);
    route.keys.forEach((k, i) => (params[k] = m[i + 1]));
    const result = await route.handler(params, body || {}, query || new URLSearchParams());
    if (result === null) return { status: 204, body: null };
    return { status: 200, body: { entity: result } };
  } catch (err) {
    if (err?.status) {
      return { status: err.status, body: { detail: { message: err.message, code: err.code || "ERROR" } } };
    }
    console.error("[api] 未处理异常:", err);
    return { status: 500, body: { detail: { message: err?.message || "服务端错误", code: "INTERNAL" } } };
  }
}

export { runSubscription };
