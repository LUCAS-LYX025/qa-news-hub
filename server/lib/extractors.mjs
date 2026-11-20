import * as cheerio from "cheerio";
import { listingSignals } from "./analyze.mjs";

/**
 * 平台专属解析规则 + 通用兜底提取
 *
 * 思路：先用站点规则精确命中正文容器 / 标题 / 作者；
 * 命中失败再退回“文本最长容器”的启发式。
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// 站点规则：match 命中则按序尝试选择器
const SITE_RULES = [
  {
    site: "CSDN",
    match: /blog\.csdn\.net/i,
    content: ["#content_views", ".blog-content-box", "article"],
    title: ["h1.title-article", "h1"],
    author: [".follow-nickName", ".user-info .name", ".author-name"],
    date: [".article-info-box .time", ".bar-content .time"],
  },
  {
    site: "掘金",
    match: /juejin\.cn/i,
    content: [".markdown-body", ".article-content", "article"],
    title: ["h1.article-title", "h1"],
    author: [".author-info .name", ".user-info .name"],
    date: ["time", ".article-meta time"],
  },
  {
    site: "知乎",
    match: /(zhihu\.com|zhuanlan\.zhihu\.com)/i,
    content: [".RichText", ".Post-RichText", ".RichContent-inner", "article"],
    title: ["h1.QuestionHeader-title", ".Post-Title h1", "h1"],
    author: [".AuthorInfo-name", ".UserLink .name"],
    date: ["time", ".ContentItem-time"],
  },
  {
    site: "博客园",
    match: /cnblogs\.com/i,
    content: ["#cnblogs_post_body", ".postBody", ".post", "article"],
    title: ["#cb_post_title_url", ".postTitle a", "h1"],
    author: ["#author_profile_detail a", ".postDesc a"],
    date: ["#post-date", ".postDesc"],
  },
  {
    site: "微信公众号",
    match: /mp\.weixin\.qq\.com/i,
    content: ["#js_content", ".rich_media_content"],
    title: ["#activity-name", "h1.rich_media_title", "h1"],
    author: ["#js_name", ".rich_media_meta_nickname"],
    date: ["#publish_time", "em#publish_time"],
  },
  {
    site: "Medium",
    match: /medium\.com/i,
    content: ["article", ".pw-post-body", "main"],
    title: ["h1", "article h1"],
    author: ['[data-testid="authorName"]', ".pw-author-name"],
    date: ["time"],
  },
  {
    site: "InfoQ",
    match: /infoq\.cn/i,
    content: [".article-content", ".com-article-detail", "article"],
    title: ["h1", ".article-title"],
    author: [".author-name", ".name"],
    date: ["time", ".article-meta"],
  },
  {
    site: "简书",
    match: /jianshu\.com/i,
    content: ["article", ".ouvjEz", ".show-content"],
    title: ["h1.title", "h1"],
    author: [".name", ".author .name"],
    date: [".publish-time", "time"],
  },
  {
    site: "TesterHome",
    match: /testerhome\.com/i,
    content: [".card-body", ".panel-body", "article"],
    title: ["h1", ".topic-title"],
    author: [".user-name", ".author .name"],
    date: ["time"],
  },
  {
    site: "开源中国",
    match: /oschina\.net/i,
    content: [".article-detail", "#articleContent", "article"],
    title: ["h1.article-title", "h1"],
    author: [".author-name", ".article-info a"],
    date: ["time", ".article-meta"],
  },
];

// 噪音节点（正文里不要的）
const NOISE_SELECTOR = [
  "script",
  "style",
  "noscript",
  "iframe",
  "svg",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "button",
  ".advertisement",
  ".ad",
  ".ads",
  ".advert",
  ".recommend",
  ".recommend-box",
  ".recommend-list",
  ".share",
  ".share-box",
  ".social-share",
  ".copyright",
  ".tag-list",
  ".article-tag",
  ".toolbar",
  ".tool-box",
  ".post-meta",
  ".article-meta",
  ".comment",
  ".comments",
  "#comments",
  ".sidebar",
  "#sidebar",
  ".read-more",
  ".related",
  ".bookmark",
  ".follow",
  ".vote",
  ".Reward",
  ".reward",
  ".c-toolbar",
  ".csdn-toolbar",
  ".hide-article-box",
]
  .map((s) => s)
  .join(",");

function absolutize(html, baseUrl) {
  if (!html) return "";
  const base = new URL(baseUrl);
  return html.replace(/(src|href)="([^"]+)"/g, (_m, attr, val) => {
    if (/^(https?:|data:|mailto:|#|javascript:)/i.test(val)) return `${attr}="${val}"`;
    if (val.startsWith("//")) return `${attr}="${new URL(base.protocol + val).href}"`;
    try {
      return `${attr}="${new URL(val, base).href}"`;
    } catch {
      return `${attr}="${val}"`;
    }
  });
}

function plainText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function pickText($, selectors, fallback = "") {
  for (const sel of selectors) {
    const t = $(sel).first().text().trim();
    if (t) return t.replace(/\s+/g, " ");
  }
  return fallback;
}

function pickElement($, selectors) {
  for (const sel of selectors) {
    const el = $(sel).first();
    if (el.length) return el;
  }
  return null;
}

/** 选择正文容器：优先站点规则，其次取“文本最长”的候选 */
function pickContent($, rules, keepNoise) {
  if (rules) {
    for (const sel of rules.content) {
      const el = $(sel).first();
      if (el.length) {
        const len = el.text().replace(/\s+/g, "").length;
        if (len > 120) return el;
      }
    }
  }
  const candidates = [
    "article",
    '[class*="article-content"]',
    '[class*="articleContent"]',
    '[class*="post-content"]',
    '[class*="postContent"]',
    '[class*="entry-content"]',
    ".markdown-body",
    '[id*="content"]',
    "main",
    '[role="main"]',
  ];
  let best = null;
  let bestLen = 0;
  for (const sel of candidates) {
    const el = $(sel).first();
    if (!el.length) continue;
    const len = el.text().replace(/\s+/g, "").length;
    if (len > bestLen) {
      bestLen = len;
      best = el;
    }
  }
  return keepNoise ? best || $("body") : best;
}

/** 抓取并提取一篇文章 */
export async function fetchAndExtract(url, opts = {}) {
  const timeout = opts.timeout ?? 20000;
  let res;
  try {
    res = await fetchWithTimeout(url, timeout);
  } catch (e) {
    throw httpError(502, `无法访问该链接：${e.message}`, "FETCH_FAILED");
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("html")) {
    throw httpError(415, "该链接不是 HTML 页面，无法抓取正文", "UNSUPPORTED_TYPE");
  }
  const html = await readHtmlResponse(res, url);
  const $ = cheerio.load(html);

  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    host = "未知来源";
  }

  const rules = SITE_RULES.find((r) => r.match.test(host)) || null;
  const site = rules?.site || host;

  // 1) 懒加载图片：data-src → src
  $("img").each((_i, el) => {
    const $img = $(el);
    const src = $img.attr("src");
    if (!src || src.startsWith("data:") || src.includes("placeholder")) {
      const lazy = $img.attr("data-src") || $img.attr("data-original") || $img.attr("data-lazy-src");
      if (lazy) $img.attr("src", lazy);
    }
  });

  // 2) 标题 / 作者 / 时间（优先站点规则，其次通用 meta）
  const title = (
    pickText($, rules?.title || []) ||
    $('meta[property="og:title"]').attr("content") ||
    $("h1").first().text().trim() ||
    $("title").text().trim() ||
    "未命名文章"
  ).trim();

  const author = (
    pickText($, rules?.author || []) ||
    $('meta[property="article:author"]').attr("content") ||
    $('meta[name="author"]').attr("content") ||
    ""
  ).trim();

  // 平台专属规则优先，其次走通用多策略解析（time[datetime] / meta / JSON-LD / 可见文本）
  const publishedAt = (rules?.date && pickText($, rules.date)) || extractDate($, url) || "";

  // 3) 正文
  const contentEl = pickContent($, rules);
  if (contentEl) contentEl.find(NOISE_SELECTOR).remove();
  const rawHtml = contentEl ? contentEl.html() : $("body").html() || "";
  const content = absolutize(rawHtml || "", url);
  const text = plainText(content);

  // 4) 封面
  let cover =
    $('meta[property="og:image"]').attr("content") ||
    $('meta[name="twitter:image"]').attr("content") ||
    contentEl?.find("img").first().attr("src") ||
    null;
  if (cover) cover = absolutize(`src="${cover}"`, url).match(/src="([^"]+)"/)?.[1] || cover;

  if (text.length < 60) {
    throw httpError(422, "正文字数过少（可能被反爬或需登录），抓取未完成", "CONTENT_TOO_SHORT");
  }

  return {
    title,
    author: author || site,
    published_at: publishedAt ? safeDate(normalizeDateText(publishedAt)) : null,
    source_name: site,
    source_url: url,
    cover_image: cover,
    content,
    // 同时产出一份干净 Markdown：二创改写 / 查重 / 复制发布稿都基于 Markdown，
    // 避免把 HTML 标签直接复制进 CSDN / 公众号编辑器
    content_md: htmlToMarkdown(content),
    text,
  };
}

/**
 * 少数旧站仍使用 GBK/GB2312。Response.text() 会强制按 UTF-8 解码，
 * 导致标题和正文乱码，因此在读取正文和订阅列表时统一从字节解码。
 */
export async function readHtmlResponse(res, url = "") {
  const contentType = res.headers.get("content-type") || "";
  const declared = contentType.match(/charset\s*=\s*([^;\s]+)/i)?.[1]?.replace(/["']/g, "").toLowerCase();
  const host = new URL(url).hostname.replace(/^www\./, "");
  const encoding = /^(gbk|gb2312|gb18030)$/i.test(declared || "") || host === "51testing.com" ? "gbk" : "utf-8";
  return new TextDecoder(encoding).decode(await res.arrayBuffer());
}

/** 给链接打分：优先像“文章详情页”的 URL，压低列表/栏目页 */
function detailScore(url) {
  let s = 0;
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);
    const last = segs[segs.length - 1] || "";
    if (/^\d+$/.test(last)) s += 6; // 数字 ID：详情页强特征
    if (segs.length >= 3) s += 2;
    if (/\/(node|nodes|cate|category|column|list|index|archive|tag|tags)(\/|$)/i.test(u.pathname)) s -= 6;
    if (/^topics?$/.test(last)) s -= 5; // 列表页
    if (/\.[a-z0-9]{2,5}$/i.test(last)) s -= 5; // 静态资源
    if (segs.length <= 1) s -= 3;
  } catch {
    /* ignore */
  }
  return s;
}

/** 从列表页抽取候选文章链接（用于订阅源定时采集） */
export function extractLinks(html, baseUrl, opts = {}) {
  const limit = opts.limit ?? 20;
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const seen = new Set();
  const links = [];
  const badPath =
    /\/(tag|tags|category|categories|user|u|author|login|signup|about|search|page|index|list|archive|feed|rss|comment|reply)(\/|$|\?)/i;

  $("a").each((_i, el) => {
    const href = $(el).attr("href");
    if (!href || /^(#|javascript:|mailto:)/i.test(href)) return;
    let abs;
    try {
      abs = new URL(href, base).href;
    } catch {
      return;
    }
    const u = new URL(abs);
    if (u.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) return;
    if (u.pathname === "/" || u.pathname === "") return;
    if (badPath.test(u.pathname)) return;
    const text = $(el).text().trim();
    if (text.length < 6) return;
    const clean = u.origin + u.pathname.replace(/\/$/, "");
    if (seen.has(clean)) return;
    seen.add(clean);
    links.push({ url: clean, title: text.replace(/\s+/g, " ") });
  });

  // 按“是否像详情页”排序，优先抓取正文页
  return links
    .map((l) => ({ ...l, _score: detailScore(l.url) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map(({ url, title }) => ({ url, title }));
}

/**
 * 判断正文是否其实是“列表页”（订阅源抽错、或用户直接粘贴栏目页时的兜底识别）。
 * 判定逻辑统一复用 analyze.mjs 的 listingSignals，避免两处标准不一致。
 * @param {string} text 正文纯文本
 * @param {string} [html] 正文 HTML（用于链接密度判定，强烈建议传入以准确区分长列表页）
 */
export function looksLikeListing(text, html = "") {
  return listingSignals(text || "", html || "").isListing;
}

/**
 * URL 层面的列表页识别：在发起抓取前就拦掉明显的栏目/导航页，省一次请求。
 * 只拦「明确的列表特征」，避免误伤正常文章。
 */
export function looksLikeListingUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  const segs = u.pathname.split("/").filter(Boolean);
  // 站点首页
  if (segs.length === 0) return true;
  const last = segs[segs.length - 1].toLowerCase();

  // 末段是数字 ID / 长 slug / 带连字符的，通常是文章详情页
  const looksDetail = /^\d+$/.test(last) || /^p\d+$/.test(last) || last.length > 24 || /-/.test(last);

  // 末段本身就是栏目词（/topics、/news、/latest）
  const listingWords =
    /^(topics?|posts?|articles?|blogs?|news|list|lists|index|home|forum|forums|nodes?|category|categories|cate|column|columns|tag|tags|archive|archives|explore|discover|feed|rss|latest|hot|recommend|following|search)$/;
  if (listingWords.test(last)) return true;

  if (segs.length >= 2) {
    const head = segs[segs.length - 2].toLowerCase();
    // 强栏目前缀：即便后面跟着 ID 也仍是列表页（如 /nodes/26、/tag/123、/category/5）
    if (/^(nodes?|category|categories|cate|column|columns|tag|tags|archive|archives)$/.test(head)) return true;
    // 弱前缀：后面跟 ID 时是详情页（如 /topics/38912），否则视为栏目页
    if (/^(user|users|u|author|authors|people|space|member|members)$/.test(head) && !looksDetail) return true;
  }
  return false;
}

function safeDate(v) {
  let d = null;
  if (v) {
    if (isNaN(Number(v))) {
      d = new Date(v);
    } else {
      const n = Number(v);
      // 纯数字：秒级时间戳（~1e9）需乘 1000，毫秒级（~1e12+）直接用；
      // 小于 1e9 的数字多为误匹配（如孤立年份/序号），不当作日期
      if (n >= 1e12) d = new Date(n);
      else if (n >= 1e9) d = new Date(n * 1000);
      else d = null;
    }
  }
  if (!d || isNaN(d.getTime())) return null;
  // 合理性兜底：早于 1995（万维网之前）或晚于明年的日期视为误解析
  const y = d.getFullYear();
  if (y < 1995 || y > new Date().getFullYear() + 1) return null;
  return d.toISOString();
}

/** 归一化时间文本：支持「2026年8月27日」「2026/08/27」等写法 */
function normalizeDateText(v = "") {
  const s = String(v).trim();
  const cjk = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
  if (cjk) return `${cjk[1]}-${String(cjk[2]).padStart(2, "0")}-${String(cjk[3]).padStart(2, "0")}`;
  return s;
}

/**
 * 多策略解析发布时间。
 * 优先级：结构化数据（time[datetime] / meta / JSON-LD）> 页面可见文本兜底。
 * 相对时间（「3天前」「2 hours ago」）解析不出则自动跳过，避免写入错误日期。
 * @returns ISO 字符串或 null
 */
const ISO_DATE_RE = /20\d{2}-\d{2}-\d{2}/;
// 注意结尾不用 \b：cheerio 的 .text() 会把相邻元素文本无分隔拼接（如 "2025Direct"），\b 会拦死匹配
const EN_MDY_RE = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2}(?!\d)/i;
const EN_DMY_RE = /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*,?\s+20\d{2}(?!\d)/i;

/** 从 URL 路径提取日期：/2026/08/31/、/2026-08-31-xxx、/2026/Aug/31/ */
function dateFromUrl(url) {
  const pad = (n) => String(n).padStart(2, "0");
  try {
    const p = new URL(url).pathname;
    const m = p.match(/\/(20\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?!\d)/);
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    const m2 = p.match(/\/(20\d{2})\/([a-z]{3,9})\/(\d{1,2})(?!\d)/i);
    if (m2) {
      const mo = MON[m2[2].slice(0, 3).toLowerCase()];
      if (mo) return `${m2[1]}-${pad(mo)}-${pad(m2[3])}`;
    }
  } catch {
    /* URL 非法则忽略 */
  }
  return null;
}

function extractDate($, url = "") {
  const tier1 = []; // 结构化发布时间，可信度最高
  const tier2 = []; // URL 日期 / 更新时间 / 日期容器文本
  const tier3 = []; // 正文可见文本兜底

  // 1) <time datetime="...">
  $("time").each((_, el) => {
    const dt = $(el).attr("datetime");
    if (dt) tier1.push(dt);
  });

  // 2) meta 标签（各家命名不统一，尽量多覆盖）
  const META = [
    'meta[property="article:published_time"]',
    'meta[property="og:article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[itemprop="datePublished"]',
    'meta[name="pubdate"]',
    'meta[name="publishdate"]',
    'meta[name="publish-date"]',
    'meta[name="date"]',
    'meta[name="DC.date.issued"]',
    'meta[name="sailthru.date"]',
    'meta[name="parsely-pub-date"]',
  ];
  for (const sel of META) {
    const v = $(sel).attr("content");
    if (v) tier1.push(v);
  }
  // 更新时间：不等于发布时间，但好过没有，放低优先级
  for (const sel of [
    'meta[property="og:updated_time"]',
    'meta[property="article:modified_time"]',
    'meta[name="lastmod"]',
  ]) {
    const v = $(sel).attr("content");
    if (v) tier2.push(v);
  }

  // 3) JSON-LD（Next.js / Ghost / WordPress / Hugo 等普遍使用）
  $('script[type="application/ld+json"]').each((_, el) => {
    let data;
    try {
      data = JSON.parse($(el).text());
    } catch {
      return; // 一段非法 JSON-LD 不应影响后续解析
    }
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      if (typeof n.datePublished === "string") tier1.push(n.datePublished);
      if (typeof n.dateCreated === "string") tier1.push(n.dateCreated);
      if (typeof n.dateModified === "string") tier2.push(n.dateModified);
      Object.values(n).forEach(walk);
    };
    walk(data);
  });

  // 4) 可见文本兜底
  $("time").each((_, el) => {
    const t = $(el).text().trim();
    if (t && t.length <= 40) tier2.push(t);
  });
  for (const sel of [
    ".published",
    ".post-date",
    ".entry-date",
    ".article-date",
    ".date",
    "[class*='publish']",
    "[class*='post-date']",
  ]) {
    const t = $(sel).first().text().trim();
    if (t && t.length <= 40) tier2.push(t);
  }

  // 5) URL 路径中的日期（博客型站点常见，如 /2026/Aug/31/）
  const fromUrl = dateFromUrl(url);
  if (fromUrl) tier2.push(fromUrl);

  // 6) 正文可见文本兜底：部分站点（如 anthropic.com）把日期渲染成纯文本，无任何结构化标记
  //    必须先剔除 script/style：Next.js 的 __NEXT_DATA__ 动辄上百 KB，会把日期挤出扫描窗口
  const bodyText = $("body").clone().find("script, style, noscript").remove().end().text().slice(0, 20000);
  for (const re of [ISO_DATE_RE, EN_MDY_RE, EN_DMY_RE]) {
    const m = bodyText.match(re);
    if (m) tier3.push(m[0]);
  }

  for (const c of [...tier1, ...tier2, ...tier3]) {
    const d = safeDate(normalizeDateText(c));
    if (d) return d;
  }
  return null;
}

function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "zh-CN,zh;q=0.9" },
    redirect: "follow",
    signal: ctrl.signal,
  }).finally(() => clearTimeout(t));
}

/**
 * 把抓取到的 HTML 正文转成干净的 Markdown（供二创改写 / 查重 / 复制发布稿使用）。
 * 只做最常见的块级与行内映射；未识别的包裹元素会递归下钻，保证文本不丢。
 * 若输入已经不含 HTML 标签（如种子文章是 Markdown），则原样返回。
 */
export function htmlToMarkdown(html = "") {
  if (!html || !/<[a-z][\s\S]*>/i.test(html)) return html;
  const $ = cheerio.load(html);
  $("script, style, noscript, iframe, svg, head").remove();

  function tableToMd($tbl) {
    const rows = [];
    $tbl.find("tr").each((_, tr) => {
      const cells = [];
      $(tr).children("th, td").each((_, c) => {
        cells.push(render($(c)).replace(/\n/g, " ").replace(/\|/g, "\\|").trim());
      });
      if (cells.length) rows.push(cells);
    });
    if (!rows.length) return "";
    const cols = rows[0].length;
    const head = "| " + rows[0].join(" | ") + " |";
    const sep = "| " + Array(cols).fill("---").join(" | ") + " |";
    const body = rows.slice(1).map((r) => "| " + r.join(" | ") + " |").join("\n");
    return [head, sep, body].filter(Boolean).join("\n");
  }

  function render($el) {
    const parts = [];
    $el.contents().each((_, node) => {
      if (node.type === "text") {
        parts.push(node.data);
      } else if (node.type === "comment") {
        /* 跳过注释 */
      } else if (node.type === "tag") {
        const tag = node.name.toLowerCase();
        const $n = $(node);
        if (tag === "script" || tag === "style" || tag === "noscript" || tag === "iframe" || tag === "svg") return;
        if (tag === "br") { parts.push("\n"); return; }
        if (tag === "hr") { parts.push("\n\n---\n\n"); return; }
        if (tag === "a") {
          const h = $n.attr("href") || "";
          const t = render($n).trim();
          parts.push(h ? "[" + t + "](" + h + ")" : t);
          return;
        }
        if (tag === "img") {
          const s = $n.attr("src") || "";
          const alt = $n.attr("alt") || "";
          parts.push(s ? "![" + alt + "](" + s + ")" : "");
          return;
        }
        if (tag === "strong" || tag === "b") { parts.push("**" + render($n).trim() + "**"); return; }
        if (tag === "em" || tag === "i") { parts.push("*" + render($n).trim() + "*"); return; }
        if (tag === "code") { parts.push("`" + render($n).replace(/\n/g, " ") + "`"); return; }
        if (tag === "pre") {
          const code = $n.find("code");
          const text = code.length ? code.text() : $n.text();
          const lang = (code.attr("class") || "").replace(/^language-/, "").trim();
          parts.push("\n\n```" + lang + "\n" + text.replace(/\n+$/, "") + "\n```\n\n");
          return;
        }
        const inner = render($n);
        if (/^h[1-6]$/.test(tag)) {
          const level = Number(tag[1]);
          parts.push("\n\n" + "#".repeat(level) + " " + inner.trim() + "\n\n");
        } else if (tag === "p") {
          parts.push("\n\n" + inner.trim() + "\n\n");
        } else if (tag === "blockquote") {
          const bq = inner.trim().split("\n").map((l) => "> " + l).join("\n");
          parts.push("\n\n" + bq + "\n\n");
        } else if (tag === "ul" || tag === "ol") {
          const items = [];
          $n.children("li").each((_, li) => {
            const prefix = tag === "ol" ? items.length + 1 + ". " : "- ";
            items.push(prefix + render($(li)).trim());
          });
          parts.push("\n\n" + items.join("\n") + "\n\n");
        } else if (tag === "table") {
          parts.push("\n\n" + tableToMd($n) + "\n\n");
        } else {
          parts.push(inner);
        }
      }
    });
    return parts.join("");
  }

  let md = render($("body"));
  md = md.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return md;
}

export function httpError(status, message, code) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

export { SITE_RULES };
