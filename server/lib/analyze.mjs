import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// 开发环境下让 Node 服务也读取项目 .env（Vite 只会注入 VITE_* 到前端）。
try {
  const envFile = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(BAIDU_TRANSLATE_APPID|BAIDU_TRANSLATE_KEY|BAIDU_TRANSLATE_URL|DEEPL_API_KEY|DEEPL_API_URL|LOCAL_LLM_URL|LOCAL_LLM_MODEL|DISABLE_FREE_TRANSLATE)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
} catch {
  /* .env is optional */
}

/** 百度翻译开放平台（国内可访问，通用版有免费额度）。 */
async function baiduTranslate(text, target = "zh") {
  const appid = process.env.BAIDU_TRANSLATE_APPID;
  const key = process.env.BAIDU_TRANSLATE_KEY;
  if (!appid || !key) return "";
  const salt = String(Date.now());
  const sign = crypto.createHash("md5").update(`${appid}${text}${salt}${key}`).digest("hex");
  const endpoint = process.env.BAIDU_TRANSLATE_URL || "https://fanyi-api.baidu.com/api/trans/vip/translate";
  const query = new URLSearchParams({ q: text, from: "auto", to: target, appid, salt, sign });
  const res = await fetch(`${endpoint}?${query}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`baidu ${res.status}`);
  const data = await res.json();
  if (data?.error_code) throw new Error(`baidu ${data.error_code}`);
  return (data?.trans_result || []).map((item) => item?.dst || "").join("\n");
}

/**
 * 内容分析：URL 归一与去重、质量评分、本地摘要、关键词提取
 *
 * 摘要默认走“本地抽取式算法”（无需下载任何模型，离线可用）；
 * 若配置了 LOCAL_LLM_URL（如本地 Ollama / OpenAI 兼容端点），
 * 则自动切换为模型摘要。
 */

// ---------------- 去重 ----------------
// 常见的追踪/营销参数，归一化时直接剥离，避免同一文章因 ?utm_xxx / ?spm 等产生"不同 URL"
const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "spm", "from", "share", "sharefrom", "bdsource", "bd_orig", "bd_vid", "bd_sig",
  "t", "token", "signature", "timestamp", "nonce", "sign", "_t", "_d", "amp",
  "continue", "redirect", "ref", "referrer", "source", "campaign", "mc_cid", "mc_eid",
  "fbclid", "gclid", "wt", "wt_ref", "feature", "fr", "nsukey", "tn", "wd", "p",
]);

export function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    // 仅保留非追踪参数的 query，并按 key 排序，保证顺序无关
    const kept = [];
    u.searchParams.forEach((v, k) => {
      if (!TRACKING_PARAMS.has(k.toLowerCase())) kept.push([k.toLowerCase(), v]);
    });
    kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    const q = kept.length ? "?" + kept.map(([k, v]) => `${k}=${v}`).join("&") : "";
    // 统一为 https，避免 http/https 被当成两篇
    return `https://${host}${path}${q}`.toLowerCase();
  } catch {
    return (raw || "").toLowerCase().replace(/\/+$/, "");
  }
}

/** 生成字符二元组（对中文友好） */
function bigrams(s) {
  const clean = s.replace(/[\s\p{P}]/gu, "").toLowerCase();
  const set = new Set();
  for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2));
  if (clean.length === 1) set.add(clean);
  return set;
}

/** 标题相似度（Jaccard，基于字符二元组） */
export function titleSimilarity(a = "", b = "") {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

export function isDuplicate(articles, { url, title }) {
  const nUrl = normalizeUrl(url);
  const byUrl = articles.find((a) => normalizeUrl(a.source_url || "") === nUrl);
  if (byUrl) return { duplicate: true, reason: "URL 重复", existing: byUrl };

  const THRESHOLD = 0.82;
  for (const a of articles) {
    if (titleSimilarity(a.title, title) >= THRESHOLD) {
      return { duplicate: true, reason: "标题高度相似", existing: a };
    }
  }
  return { duplicate: false };
}

// ---------------- 质量评分 ----------------
const SOURCE_WEIGHT = {
  CSDN: 8,
  掘金: 10,
  知乎: 8,
  博客园: 9,
  微信公众号: 7,
  Medium: 9,
  InfoQ: 10,
  TesterHome: 10,
  简书: 6,
  开源中国: 7,
};

/** 0-100 的内容质量分（启发式，可解释） */
/**
 * 清单/导航式内容识别（唯一实现，供评分与抓取拦截共用）。
 *
 * 不能只依赖换行分行——很多列表页/长文被提取后都会压成「一整行」长文本。
 * 因此综合三组信号，且对「长文」放宽，避免误杀 emoji/代码密集的技术长文：
 *   1) 多行场景：平均行长很短 + 行尾几乎没有句末标点（典型短行清单）；
 *   2) 链接密度：正文由大量短锚点构成、链接文字占正文四成以上且无完整句子（长列表/导航页最可靠信号）；
 *   3) 短碎片页：极短（<800 字）且句末标点稀疏（标签云/导航碎片）。
 *      ——长文（技术文常见）即便标点稀疏也不在此列，否则会误杀正常文章。
 *
 * @param {string} text 正文纯文本
 * @param {string} [html] 正文 HTML（用于计算链接密度，可选）
 */
export function listingSignals(text = "", html = "") {
  const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
  const len = text.length;
  const endMarks = (text.match(/[。！？.!?]/g) || []).length;
  // 每 100 字的句末标点数；正常中文技术文章通常 ≥ 1.5
  const punctDensity = len > 0 ? (endMarks / len) * 100 : 0;
  const avgLineLen = lines.length ? lines.reduce((n, l) => n + l.length, 0) / lines.length : 0;
  const sentenceRatio = lines.length ? lines.filter((l) => /[。！？.!?]$/.test(l)).length / lines.length : 0;

  // 链接密度：列表/导航页锚点密集、正文占比极低；技术长文正文里链接很少
  let linkRatio = 0;
  if (html) {
    const linkTextLen = (html.match(/<a[^>]*>([\s\S]*?)<\/a>/gi) || []).reduce(
      (n, m) => n + m.replace(/<[^>]+>/g, "").trim().length,
      0,
    );
    linkRatio = len ? Math.min(1, linkTextLen / len) : 0;
  }

  const multiLineListing = lines.length >= 8 && avgLineLen < 40 && sentenceRatio < 0.2;
  // 真正的列表页：链接文字占正文四成以上，且几乎无完整句子
  const highLinkListing = !!html && linkRatio >= 0.4 && punctDensity < 1.5;
  // 短碎片页（标签云/导航）：极短且无句子；长文不在此列，避免误杀技术长文
  const shortFragment = len > 0 && len < 800 && punctDensity < 0.6;

  const isListing = multiLineListing || highLinkListing || shortFragment;
  return {
    isListing,
    lines: lines.length,
    avgLineLen,
    sentenceRatio,
    punctDensity,
    linkRatio,
    reason: multiLineListing ? "短行清单" : highLinkListing ? "链接密度过高" : shortFragment ? "内容碎片化" : "",
  };
}

/**
 * 统计正文结构特征。
 * 同时兼容 HTML（抓取来的文章）与 Markdown（本地录入/种子文章），
 * 否则 Markdown 内容会因为没有 HTML 标签而被严重低估。
 */
function structureFeatures(content = "") {
  const isHtml = /<(p|div|h[1-6]|pre|ul|ol|table|img)[\s>]/i.test(content);
  if (isHtml) {
    return {
      kind: "html",
      code: (content.match(/<pre|<code/gi) || []).length,
      heading: (content.match(/<h[1-4][\s>]/gi) || []).length,
      image: (content.match(/<img[\s>]/gi) || []).length,
      table: (content.match(/<table[\s>]/gi) || []).length,
      list: (content.match(/<li[\s>]/gi) || []).length,
      para: (content.match(/<p[\s>]/gi) || []).length,
    };
  }
  // Markdown
  const fences = (content.match(/```/g) || []).length;
  return {
    kind: "markdown",
    code: Math.floor(fences / 2) + (content.match(/(^|\n) {4}\S/g) || []).length,
    heading: (content.match(/(^|\n)#{1,4}\s/g) || []).length,
    image: (content.match(/!\[[^\]]*\]\(/g) || []).length,
    // Markdown 表格：出现分隔行 |---|---|
    table: (content.match(/(^|\n)\s*\|?[\s:-]*-{3,}[\s:|-]*\|/g) || []).length,
    list: (content.match(/(^|\n)\s*(?:[-*+]|\d+\.)\s+\S/g) || []).length,
    // 段落：空行分隔且非标题/列表/代码的块
    para: content
      .split(/\n{2,}/)
      .map((b) => b.trim())
      .filter((b) => b.length > 20 && !/^(#{1,6}\s|```|[-*+]\s|\d+\.\s|\|)/.test(b)).length,
  };
}

export function qualityScore({ text = "", content = "", source_name = "", published_at = null }) {
  const reasons = [];
  let score = 0;

  // 1) 正文长度（最高 30）；技术文章多在 1200~3000 字，1500 字即接近满分
  const len = text.length;
  const lenScore = Math.min(30, Math.round((Math.min(len, 1500) / 1500) * 30));
  score += lenScore;
  reasons.push(`正文 ${len} 字 → +${lenScore}`);

  const f = structureFeatures(content);

  // 2) 代码块（最高 15）
  if (f.code > 0) {
    const s = Math.min(15, 5 + f.code * 3);
    score += s;
    reasons.push(`含 ${f.code} 处代码 → +${s}`);
  }

  // 3) 小标题（最高 12）
  if (f.heading >= 2) {
    const s = Math.min(12, 4 + f.heading * 2);
    score += s;
    reasons.push(`含 ${f.heading} 个小标题 → +${s}`);
  }

  // 4) 图/表/列表（最高 13）
  const imageBonus = Math.min(8, f.image * 2);
  const rich = Math.min(13, imageBonus + f.table * 4 + Math.min(f.list, 5));
  if (rich > 0) {
    score += rich;
    reasons.push(`含 ${f.image} 图 / ${f.table} 表 / ${f.list} 列表项 → +${rich}`);
  }

  // 5) 段落完整度（最高 10）
  const pScore = Math.min(10, f.para * 2);
  score += pScore;
  reasons.push(`段落数 ${f.para} → +${pScore}`);

  // 6) 来源权重（最高 10）
  const sw = SOURCE_WEIGHT[source_name] ?? 5;
  score += sw;
  reasons.push(`来源 ${source_name} 权重 → +${sw}`);

  // 7) 时效性（最高 10）
  if (published_at) {
    const days = (Date.now() - new Date(published_at).getTime()) / 86400000;
    const t = Number.isFinite(days) && days >= 0 ? Math.max(0, 10 - Math.floor(days / 90)) : 5;
    score += t;
    reasons.push(`时效 ${Number.isFinite(days) ? Math.round(days) + " 天前" : "未知"} → +${t}`);
  }

  // 8) 负向惩罚：清单式内容（列表页/导航页误抓的典型特征）
  const sig = listingSignals(text);
  if (sig.isListing) {
    // 清单页的“图”多为头像/缩略图，不代表内容质量：先把图片加分收回
    const shortness = sig.lines >= 8 ? Math.max(0, 1 - sig.avgLineLen / 40) : 1;
    const punctLack = Math.max(0, 1 - sig.punctDensity / 0.8);
    const basePenalty = Math.round(30 * Math.max(shortness, punctLack));
    const penalty = basePenalty + imageBonus;
    score -= penalty;
    reasons.push(
      `疑似清单/导航内容（${sig.reason}：均行 ${Math.round(sig.avgLineLen)} 字、每百字句末标点 ${sig.punctDensity.toFixed(1)}）→ -${penalty}` +
        (imageBonus > 0 ? `（含收回图片分 ${imageBonus}）` : ""),
    );
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

// ---------------- 本地抽取式摘要 ----------------
const STOP = new Set([
  "的", "了", "和", "是", "在", "也", "就", "都", "而", "及", "与", "为", "以", "对", "从", "到", "中", "上", "下",
  "这", "那", "有", "被", "把", "但", "并", "或", "等", "更", "很", "我", "你", "他", "它", "个", "可以", "一个",
  "the", "a", "an", "and", "or", "but", "is", "are", "to", "of", "in", "on", "for", "with", "it", "this", "that",
]);

function splitSentences(text) {
  return text
    .split(/(?<=[。！？；.!?;])\s*|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
}

function tokenize(s) {
  const tokens = [];
  // 英文单词
  (s.toLowerCase().match(/[a-z][a-z0-9+#.-]{1,}/g) || []).forEach((w) => {
    if (!STOP.has(w)) tokens.push(w);
  });
  // 中文二元组
  const cjk = s.replace(/[^\u4e00-\u9fa5]/g, "");
  for (let i = 0; i < cjk.length - 1; i++) {
    const g = cjk.slice(i, i + 2);
    if (!STOP.has(g)) tokens.push(g);
  }
  return tokens;
}

/** 抽取式摘要：词频权重 + 位置加权 */
export function extractiveSummary(text, maxSentences = 3) {
  const sentences = splitSentences(text);
  if (!sentences.length) return "";
  if (sentences.length <= maxSentences) return sentences.join("");

  // 词频
  const tf = new Map();
  for (const s of sentences) {
    for (const t of new Set(tokenize(s))) tf.set(t, (tf.get(t) || 0) + 1);
  }
  const scored = sentences.map((s, i) => {
    const toks = tokenize(s);
    let w = 0;
    for (const t of toks) w += tf.get(t) || 0;
    // 长度归一，避免长句占优
    w = w / Math.sqrt(Math.max(toks.length, 1));
    // 位置加权：段首更重要
    if (i === 0) w *= 1.6;
    else if (i === 1) w *= 1.2;
    // 含数字/百分比的句子通常信息量高
    if (/\d/.test(s)) w *= 1.15;
    return { s, i, w };
  });
  return scored
    .sort((a, b) => b.w - a.w)
    .slice(0, maxSentences)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s)
    .join("");
}

/** 关键词提取 */
export function keywords(text, n = 6) {
  const tf = new Map();
  for (const t of tokenize(text)) tf.set(t, (tf.get(t) || 0) + 1);
  return [...tf.entries()]
    .filter(([t]) => t.length >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t]) => t);
}

/**
 * LOCAL_LLM_URL accepts either an OpenAI-compatible server root or its /v1
 * base URL. Normalizing here prevents requests such as /v1/v1/chat/completions.
 */
function localLlmChatUrl(base) {
  return `${String(base).replace(/\/+$/, "").replace(/\/v1$/, "")}/v1/chat/completions`;
}

/** 若配置了本地 LLM 端点，则用模型摘要；否则退回抽取式 */
export async function summarize(text, maxSentences = 3) {
  const base = process.env.LOCAL_LLM_URL;
  if (base) {
    try {
      const model = process.env.LOCAL_LLM_MODEL || "qwen2.5:7b";
      const prompt = `请为下面这篇技术文章生成 ${maxSentences} 句中文摘要，只输出摘要，不要解释：\n\n${text.slice(0, 4000)}`;
      const res = await fetch(localLlmChatUrl(base), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          stream: false,
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (res.ok) {
        const data = await res.json();
        const out = data?.choices?.[0]?.message?.content?.trim();
        if (out) return { summary: out, mode: "llm" };
      }
    } catch {
      /* 模型不可用则退回抽取式 */
    }
  }
  return { summary: extractiveSummary(text, maxSentences), mode: "extractive" };
}

// ============================================================================
// AI 改写 / 二创（本地启发式，可插拔本地大模型）
// ============================================================================

// 安全同义词表：仅在「不改变技术含义」的边界内替换，避免把命令/术语改错
const SYN_ZH = {
  因此: "所以", 所以: "因此", 然而: "不过", 不过: "然而", 此外: "另外", 另外: "此外",
  首先: "第一步", 其次: "接下来", 最后: "收尾", 例如: "比如", 比如: "例如",
  需要: "应当", 应当: "需要", 进行: "开展", 开展: "进行", 实现: "落地", 落地: "实现",
  问题: "痛点", 痛点: "问题", 方法: "思路", 思路: "方法", 注意: "留意", 留意: "注意",
  建议: "推荐", 推荐: "建议", 重要: "关键", 关键: "重要", 发现: "定位到", 定位到: "发现",
  导致: "引发", 引发: "导致", 提升: "优化", 优化: "提升", 场景: "情形", 情形: "场景",
  通过: "借助", 借助: "通过", 利用: "使用", 使用: "利用", 从而: "进而", 进而: "从而",
  对于: "针对", 针对: "对于", 基于: "依据", 依据: "基于", 结合: "融合", 融合: "结合",
  目前: "当下", 当下: "目前", 其实: "实际上", 实际上: "其实", 常见: "典型", 典型: "常见",
  一般: "通常", 通常: "一般", 简单: "轻量", 轻量: "简单", 方便: "便捷", 便捷: "方便",
  稳定: "可靠", 可靠: "稳定", 直接: "径直", 径直: "直接", 自动: "自动地", 手动: "人工",
  整体: "总体", 总体: "整体", 具体: "详细", 详细: "具体", 说明: "解释", 解释: "说明",
  展示: "呈现", 呈现: "展示", 避免: "规避", 规避: "避免", 支持: "兼容", 兼容: "支持",
  提供: "给出", 给出: "提供", 包含: "涵盖", 涵盖: "包含", 表示: "意味着", 意味着: "表示",
  称为: "称作", 称作: "称为", 过程: "流程", 流程: "过程", 结果: "成效", 成效: "结果",
  原因: "根因", 根因: "原因", 目的: "目标", 目标: "目的", 适合: "契合", 契合: "适合",
  允许: "容许", 容许: "允许", 希望: "期望", 期望: "希望", 认为: "觉得", 觉得: "认为",
  显著: "明显", 明显: "显著", 能够: "可以", 可以: "能够", 情况: "状况", 状况: "情况",
  // —— 以下为扩展的安全连接词 / 通用动词，进一步拉开改写区分度 ——
  如果: "假如", 假如: "如果", 但是: "可是", 可是: "但是", 而且: "并且", 并且: "而且",
  因为: "由于", 由于: "因为", 虽然: "尽管", 尽管: "虽然", 以及: "与", 与: "以及",
  或者: "或", 或: "或者", 用来: "用以", 用以: "用来", 完成: "做完", 做完: "完成",
  开始: "着手", 着手: "开始", 结束: "完毕", 完毕: "结束", 很多: "诸多", 诸多: "很多",
  很少: "极少", 极少: "很少", 经常: "常常", 常常: "经常", 总是: "一直", 一直: "总是",
  可能: "或许", 或许: "可能", 一定: "必然", 必然: "一定", 必须: "务必", 务必: "必须",
  大概: "大约", 大约: "大概", 完全: "彻底", 彻底: "完全", 比较: "相对", 相对: "比较",
  非常: "格外", 格外: "非常", 更加: "愈发", 愈发: "更加", 逐步: "渐渐", 渐渐: "逐步",
  迅速: "快速", 快速: "迅速", 增加: "增多", 增多: "增加", 减少: "降低", 降低: "减少",
  改变: "变动", 变动: "改变", 保持: "维持", 维持: "保持", 出现: "显现", 显现: "出现",
  选择: "选取", 选取: "选择", 设计: "构想", 构想: "设计", 部署: "发布", 发布: "部署",
  开发: "研发", 研发: "开发", 维护: "运维", 运维: "维护", 验证: "确认", 确认: "验证",
  请求: "调用", 调用: "请求", 返回: "回传", 回传: "返回", 处理: "处置", 处置: "处理",
  错误: "异常", 异常: "错误", 数据: "资料", 资料: "数据", 信息: "资讯", 资讯: "信息",
  系统: "平台", 平台: "系统", 用户: "使用者", 使用者: "用户", 配置: "设定", 设定: "配置",
  性能: "表现", 表现: "性能", 效率: "效能", 效能: "效率", 成本: "开销", 开销: "成本",
  确保: "保证", 保证: "确保", 解决: "处置", 关注: "留意",
  帮助: "协助", 协助: "帮助", 影响: "作用", 作用: "影响", 要求: "须要", 须要: "要求",
};
const SYN_EN = {
  therefore: "thus", thus: "therefore", however: "nevertheless", nevertheless: "however",
  "for example": "for instance", "for instance": "for example", use: "leverage", leverage: "use",
  should: "must", must: "should", important: "critical", critical: "important",
  note: "observe", observe: "note", implement: "realize", realize: "implement",
  via: "through", through: "via", approach: "way", way: "approach", issue: "problem", problem: "issue",
  handle: "deal with", "deal with": "handle", ensure: "make sure", "make sure": "ensure",
  provide: "offer", offer: "provide", support: "back", back: "support", reduce: "cut", cut: "reduce",
  increase: "grow", grow: "increase", require: "need", need: "require", allow: "let", let: "allow",
  run: "execute", execute: "run", show: "display", display: "show", apply: "use", help: "assist",
};

// 把双向同义词表解析为「无环」替换表：目标词绝不会再次成为源词，避免来回翻转/随机抖动
function buildSynMap(dict) {
  const map = new Map();
  const sources = new Set(Object.keys(dict));
  for (const [a, b] of Object.entries(dict)) {
    if (map.has(a)) continue;
    if (sources.has(b)) continue; // 目标是别的源词，跳过反向，破坏环路
    map.set(a, b);
  }
  return map;
}
const SYN_ZH_MAP = buildSynMap(SYN_ZH);
const SYN_EN_MAP = buildSynMap(SYN_EN);

// 确定性应用：light 只替换一半词条（易控），medium/deep 替换全部；结果可复现、随强度单调递增
function applyZhSynonyms(text, intensity) {
  const entries = [...SYN_ZH_MAP.entries()];
  const chosen = intensity === "light" ? entries.filter((_, i) => i % 2 === 0) : entries;
  let out = text;
  for (const [a, b] of chosen) {
    if (out.includes(a)) out = out.split(a).join(b);
  }
  return out;
}
function applyEnSynonyms(text, intensity) {
  const entries = [...SYN_EN_MAP.entries()];
  const chosen = intensity === "light" ? entries.filter((_, i) => i % 2 === 0) : entries;
  let out = text;
  for (const [a, b] of chosen) {
    if (!out.includes(a)) continue;
    const re = new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    out = out.replace(re, (m) => (m[0] === m[0].toUpperCase() ? b[0].toUpperCase() + b.slice(1) : b));
  }
  return out;
}

const STYLE_LEAD = {
  tutorial: "本文以实操为主线，带你一步步拆解其中的关键细节：\n\n",
  opinion: "结合一线经验，聊聊笔者的看法——\n\n",
  dry: "",
};

// 把受保护的内容（代码、URL、版本号、命令、用户指定词）先打码，改写后再还原
function maskProtected(text, protect = []) {
  const slots = [];
  const stash = (s) => {
    slots.push(s);
    return `\u0000${slots.length - 1}\u0000`;
  };
  let out = text;
  // 反引号代码 / 行内代码
  out = out.replace(/`[^`]*`/g, (m) => stash(m));
  // URL / 邮箱
  out = out.replace(/https?:\/\/[^\s)]+/g, (m) => stash(m));
  out = out.replace(/[\w.+-]+@[\w.-]+\.\w+/g, (m) => stash(m));
  // 版本号 / 命令式 token（含数字与点的词，如 v1.2、2.0.3、Playwright）
  out = out.replace(/\b[\w+-]*\d+\.\d+(?:\.\d+)?\b/g, (m) => stash(m));
  // 用户保护词（整词，中英文皆可）
  for (const w of protect.filter(Boolean)) {
    if (!w) continue;
    if (/[\u4e00-\u9fa5]/.test(w)) {
      out = out.split(w).join(stash(w));
    } else {
      out = out.replace(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), (m) => stash(m));
    }
  }
  return { text: out, restore: (s) => slots.reduce((acc, v, i) => acc.split(`\u0000${i}\u0000`).join(v), s) };
}

// 按 Markdown 结构切块，代码块 / 标题 / 列表保持原样，只改写 prose 段落
function splitBlocks(content = "") {
  const lines = content.split("\n");
  const blocks = [];
  let buf = [];
  let mode = "text";
  const flush = () => {
    if (buf.length) blocks.push({ type: mode, raw: buf.join("\n") });
    buf = [];
  };
  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      if (mode !== "code") { flush(); mode = "code"; }
      buf.push(line);
      if (buf.length >= 2 && /^```/.test(buf[buf.length - 1].trim()) && buf.length > 1 && /^```/.test(buf[0].trim())) {
        flush(); mode = "text";
      }
      continue;
    }
    if (/^#{1,6}\s/.test(line)) { flush(); mode = "text"; blocks.push({ type: "heading", raw: line }); continue; }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) { flush(); mode = "text"; blocks.push({ type: "list", raw: line }); continue; }
    if (line.trim() === "") { flush(); mode = "text"; continue; }
    if (mode === "code") { flush(); mode = "text"; }
    buf.push(line);
  }
  flush();
  return blocks;
}

// 深度二创：把逗号分隔的小句按逆序重排，显著降低与原文字面相似度（技术含义基本保留）
function reorderClauses(text) {
  return text
    .split(/(?<=[。！？；\n])/)
    .map((seg) => {
      if (!/[，,]/.test(seg)) return seg;
      const clauses = seg.split(/(?<=[，,])/).map((c) => c.trim()).filter(Boolean);
      if (clauses.length < 3) return seg;
      const head = clauses.shift();
      clauses.reverse();
      return [head, ...clauses].join("");
    })
    .join("");
}

// 深度二创：句序重排（段落内逆序），在不改变句子内容的前提下显著降低字面相似度
function reorderSentences(text) {
  const parts = text.split(/(?<=[。！？；])/).map((s) => s.replace(/\s+$/, "")).filter(Boolean);
  if (parts.length < 3) return text;
  const reordered = [...parts].reverse();
  return reordered.join("");
}

function rewriteProse(text, intensity, protectSet) {
  const { text: masked, restore } = maskProtected(text, [...protectSet]);
  let out = applyZhSynonyms(masked, intensity);
  out = applyEnSynonyms(out, intensity);
  if (intensity === "medium" || intensity === "deep") out = reorderClauses(out);
  if (intensity === "deep") out = reorderSentences(out);
  return restore(out);
}

// 模板：将原文顶层 ## 小标题依次重命名为模板章节名（一一对应），无小标题则追加导语
const TEMPLATES = {
  "背景-痛点-方案-踩坑-总结": ["背景", "痛点", "方案", "踩坑", "总结"],
  "是什么-为什么-怎么做": ["是什么", "为什么", "怎么做"],
  "问题-分析-结论": ["问题", "分析", "结论"],
  "无（保留原结构）": null,
};

const CSDN_REWRITE_PROMPT = `你是一位长期写 CSDN 的技术博主。请把输入文章改写为一篇适合 CSDN 发布的中文技术文章。

目标：
- 读者是有基础但不熟悉该项目或技术的开发者。
- 保留技术事实、数据、限制条件、链接、命令、版本号、代码块和代码语言标记。
- 不得添加原文没有的测试结论、性能数据、使用体验、源码分析结论、社区反馈或配图来源。
- 原文是第三方项目时，使用第三方视角。只有原文明确给出依据时，才能写“我试了”或“我查看源码后发现”。

写作规则：
1. 去掉套话、总结腔和机械连接词；不要出现“在这个时代”“技术的魅力”“首先、其次、最后”等空泛表达。
2. 不逐句同义词替换。重新组织文章：先说明它解决什么具体问题，再讲核心机制、适用场景、如何上手和注意事项。
3. 专业术语第一次出现时，用括号给一句不超过 25 字的解释；常见术语不必重复解释。
4. 长段落拆成 2-4 句。涉及多项对比、前提、优缺点或场景时，优先用 Markdown 表格或列表。
5. 保留全部代码块，不改代码语义；若原代码块没有语言标记且能可靠判断，再补充语言类型，否则不猜。
6. 在适合插图的位置插入“> 配图建议：……”，最多 3 处；只描述应展示的内容，不虚构图片。
7. 第一行生成一个 CSDN 风格标题：具体、有信息量、不夸大、不标题党；禁止编造 Star 数、时间或效果数据。

输出格式：
- 只输出完整 Markdown 成稿，第一行必须是“# 标题”。
- 不输出改写说明、写作思路、免责声明等额外内容。
- 不确定的信息明确写“原文未说明”或省略。`;

function applyTemplate(content, templateKey) {
  const sections = TEMPLATES[templateKey];
  if (!sections) return content;
  const blocks = splitBlocks(content);
  const headingIdx = blocks
    .map((b, i) => ({ b, i }))
    .filter((x) => x.b.type === "heading" && /^#{2}\s/.test(x.b.raw));
  if (headingIdx.length >= 2 && headingIdx.length <= sections.length) {
    headingIdx.forEach((x, k) => {
      blocks[x.i].raw = blocks[x.i].raw.replace(/^#{2}\s+/, `## ${sections[k]} `);
    });
    return blocks.map((b) => b.raw).join("\n");
  }
  // 无足够小标题：在开头补一段导语，提示套用模板
  return `> 本文按「${templateKey}」结构组织。\n\n` + content;
}

/**
 * AI 改写核心。优先用本地大模型（LOCAL_LLM_URL），否则走启发式改写。
 * @returns { content, engine, title? }
 */
export async function rewriteArticle(content, opts = {}) {
  const { intensity = "medium", style = "csdn", protect = [], template = "", custom_prompt = "" } = opts;
  const base = process.env.LOCAL_LLM_URL;
  if (base) {
    try {
      const model = process.env.LOCAL_LLM_MODEL || "qwen2.5:7b";
      const nonNegotiableRules = "不得添加输入文章没有的测试结论、性能数据、使用体验、源码分析结论、社区反馈或配图来源；不得改动代码语义、命令、版本号和技术事实。";
      const editingRules = String(custom_prompt).trim() || (style === "csdn" ? CSDN_REWRITE_PROMPT : "使用通俗、准确的技术写作风格。保留事实、代码、命令、版本号和专有名词。");
      const prompt = `${nonNegotiableRules}\n\n${editingRules}\n\n本次改写强度：${intensity === "light" ? "轻度润色" : intensity === "deep" ? "深度二创改写" : "中度改写"}。\n\n输入文章：\n\n${content.slice(0, 12000)}`;
      const res = await fetch(localLlmChatUrl(base), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.6, stream: false }),
        signal: AbortSignal.timeout(120000),
      });
      if (res.ok) {
        const data = await res.json();
        const out = data?.choices?.[0]?.message?.content?.trim();
        if (out) return { content: out, engine: "llm" };
      }
    } catch {
      /* 退回启发式 */
    }
  }

  const blocks = splitBlocks(content);
  const out = blocks.map((b) => {
    if (b.type === "text" || b.type === "list") return rewriteProse(b.raw, intensity, protect);
    return b.raw; // 代码块、标题原样
  });
  let result = out.join("\n");
  if (template) result = applyTemplate(result, template);
  const lead = STYLE_LEAD[style] || "";
  if (lead) result = lead + result;
  return { content: result, engine: "heuristic" };
}

// ============================================================================
// 外文翻译：免费在线翻译（默认，无需任何配置） + 本地大模型（可选，质量更高）
// ============================================================================

/** 粗略判断文本是否以中文为主（决定是否显示「翻译为中文」按钮，避免对中文文章重复翻译） */
export function isMostlyChinese(text = "") {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const en = (text.match(/[A-Za-z]/g) || []).length;
  if (cjk + en === 0) return false;
  return cjk / (cjk + en) >= 0.4;
}

/**
 * 按行合并成 ≤ max 字符的分块，绝不切断单行，保证翻译占位符/结构完整。
 */
function chunkForTranslate(text, max = 1800) {
  const lines = String(text).split("\n");
  const parts = [];
  let buf = "";
  for (const line of lines) {
    if (buf && buf.length + line.length + 1 > max) {
      parts.push(buf);
      buf = "";
    }
    buf = buf ? buf + "\n" + line : line;
  }
  if (buf) parts.push(buf);
  return parts.length ? parts : [""];
}

/**
 * 翻译专用打码：仅保护行内代码（反引号），用翻译稳定的占位符包裹，
 * 避免把命令/代码翻译坏。代码块（```）由外层 splitBlocks 直接保留，不走翻译。
 */
function maskInlineCode(text) {
  const slots = [];
  const stash = (s) => {
    slots.push(s);
    return `CODESLOT${slots.length - 1}CODESLOT`;
  };
  const out = (text || "").replace(/`[^`]*`/g, (m) => stash(m));
  return {
    text: out,
    restore: (s) => slots.reduce((acc, v, i) => acc.split(`CODESLOT${i}CODESLOT`).join(v), s),
  };
}

/** Google 翻译免费端点（client=gtx，无需 key，无需计费） */
async function googleTranslate(text, target = "zh-CN") {
  const url =
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=` +
    encodeURIComponent(text);
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; QANewsHub/1.0)" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`google ${res.status}`);
  const data = await res.json();
  const out = (data?.[0] || []).map((seg) => seg?.[0] || "").join("");
  return out || "";
}

/** DeepL API Free（可选）：免费额度需在服务端设置 DEEPL_API_KEY。 */
async function deeplTranslate(text, target = "ZH") {
  const key = process.env.DEEPL_API_KEY;
  if (!key) return "";
  const endpoint = process.env.DEEPL_API_URL || "https://api-free.deepl.com/v2/translate";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `DeepL-Auth-Key ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ text, target_lang: target }).toString(),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`deepl ${res.status}`);
  const data = await res.json();
  return String(data?.translations?.[0]?.text || "");
}

/** MyMemory 备用翻译（免费 5000 词/天，无需 key） */
async function myMemoryTranslate(text, target = "zh-CN") {
  const lp = target === "zh-CN" ? "en-US|zh-CN" : `en-US|${target}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${lp}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`mymemory ${res.status}`);
  const data = await res.json();
  if (data?.responseStatus !== 200 || !data?.responseData?.translatedText) {
    throw new Error(data?.responseDetails || "mymemory error");
  }
  return String(data.responseData.translatedText);
}

/** 有上限地并发执行任务，避免免费翻译端点被瞬时流量压垮。 */
async function mapWithConcurrency(items, limit, mapper) {
  const output = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      output[index] = await mapper(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

/** 翻译一个自然语言分块；失败时由调用方保留原文。 */
async function translateChunk(text, target) {
  try {
    const baidu = await baiduTranslate(text, "zh");
    if (baidu && baidu.trim() !== text.trim()) return { text: baidu, translated: true, provider: "baidu" };
  } catch {
    /* 继续尝试其它服务 */
  }
  try {
    const deepl = await deeplTranslate(text, "ZH");
    if (deepl && deepl.trim() !== text.trim()) return { text: deepl, translated: true, provider: "deepl" };
  } catch {
    /* 继续尝试其它服务 */
  }
  try {
    const google = await googleTranslate(text, target);
    if (google && google.trim() !== text.trim()) return { text: google, translated: true, provider: "google" };
  } catch {
    /* 尝试备用 */
  }
  try {
    const fallback = await myMemoryTranslate(text, target);
    return { text: fallback || text, translated: !!fallback && fallback.trim() !== text.trim(), provider: "mymemory" };
  } catch {
    return { text, translated: false };
  }
}

/**
 * 将 Markdown 文章翻译为简体中文。
 * 优先级：本地大模型（LOCAL_LLM_URL，质量最高）> 免费在线翻译（默认，无需配置）。
 * 中文文章直接跳过（保留原文，逻辑不变）。代码块与行内代码保持原样。
 * @returns { content, engine, message?, is_chinese? }
 */
export async function translateArticle(content, opts = {}) {
  const src = content || "";
  const isZh = isMostlyChinese(src);
  if (isZh) {
    return { content: src, engine: "skipped", message: "原文已是中文，无需翻译。", is_chinese: true };
  }

  // 1) 优先本地大模型（质量更高，可定制语气/术语）
  const base = process.env.LOCAL_LLM_URL;
  if (base) {
    const prompt = `你是一名专业技术翻译。请将下面的技术文章完整翻译为简体中文；保持 Markdown 结构、代码块、行内代码、URL、命令行、版本号与专有名词不变，仅翻译自然语言叙述部分。直接输出翻译后的 Markdown，不要任何额外解释：\n\n${src.slice(0, 6000)}`;
    try {
      const model = process.env.LOCAL_LLM_MODEL || "qwen2.5:7b";
      const res = await fetch(localLlmChatUrl(base), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.3, stream: false }),
        signal: AbortSignal.timeout(120000),
      });
      if (res.ok) {
        const data = await res.json();
        const out = data?.choices?.[0]?.message?.content?.trim();
        if (out) return { content: out, engine: "llm", message: "已使用本地大模型翻译。", is_chinese: false };
      }
    } catch {
      /* 退回免费翻译 */
    }
  }

  // 2) 免费在线翻译（默认开启；设置 DISABLE_FREE_TRANSLATE=1 可关闭，用于离线/隐私场景）
  if (process.env.DISABLE_FREE_TRANSLATE === "1") {
    return {
      content: "",
      engine: "unavailable",
      message:
        "翻译已关闭（DISABLE_FREE_TRANSLATE）。如需翻译，请接入本地大模型（设置 LOCAL_LLM_URL）或移除该环境变量。",
      is_chinese: false,
    };
  }

  try {
    const blocks = splitBlocks(src);
    const prepared = blocks.map((block) => {
      if (block.type === "code") return { code: block.raw, chunks: [], restore: null };
      const { text, restore } = maskInlineCode(block.raw);
      return { code: null, chunks: chunkForTranslate(text), restore };
    });
    const tasks = prepared.flatMap((block, blockIndex) =>
      block.chunks
        .map((text, chunkIndex) => ({ blockIndex, chunkIndex, text }))
        .filter((task) => task.text.trim()),
    );
    // 全文统一并发池：长段落不再串行，普通段落也能充分利用连接。
    const translatedChunks = prepared.map((block) => block.chunks.slice());
    const results = await mapWithConcurrency(tasks, 6, (task) => translateChunk(task.text, "zh-CN"));
    const translatedCount = results.filter((result) => result.translated).length;
    tasks.forEach((task, index) => {
      translatedChunks[task.blockIndex][task.chunkIndex] = results[index].text;
    });
    const out = prepared
      .map((block, index) => (block.code ?? block.restore(translatedChunks[index].join("\n"))))
      .join("\n");
    if (out && out.trim() && translatedCount > 0) {
      return {
        content: out,
        engine: "free",
        message:
          translatedCount < tasks.length
            ? `免费翻译完成，但有 ${tasks.length - translatedCount} 个片段未能翻译，已保留原文。`
            : "已使用免费在线翻译（Google）完成，可继续在编辑区二创。",
        is_chinese: false,
      };
    }
  } catch (e) {
    return { content: "", engine: "error", message: `免费翻译调用失败：${e?.message || e}`, is_chinese: false };
  }
  return {
    content: "",
    engine: "unavailable",
    message: "免费翻译暂未返回结果，请稍后重试，或接入本地大模型（LOCAL_LLM_URL）获得更稳定的翻译。",
    is_chinese: false,
  };
}

// ============================================================================
// 原创度 / 查重：两段文本相似度（字符二元组 Jaccard）
// ============================================================================
export function originalityScore(a = "", b = "") {
  const A = bigrams(a || "");
  const B = bigrams(b || "");
  if (!A.size || !B.size) return { similarity: 0, similar: false, flagged: false };
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  const sim = Math.round((inter / (A.size + B.size - inter)) * 100);
  return { similarity: sim, similar: sim >= 60, flagged: sim >= 80 };
}

// ============================================================================
// 来源署名片段（二创法定要求）
// ============================================================================
export function attributionBlock(article = {}, opts = {}) {
  const title = article.title || "（原标题）";
  const author = article.author || "原作者";
  const url = article.source_url || "";
  const source = article.source_name || "原文来源";
  const note = opts.declare_original
    ? "本文在原文基础上做了实质性改写与二次创作，转载请注明出处。"
    : "本文整理自上述来源，仅供学习交流，版权归原作者所有。";
  return [
    "---",
    `> 本文整理自 ${author}《${title}》`,
    url ? `> 原文链接：${url}（来源：${source}）` : `> 来源：${source}`,
    `> ${note}`,
    "",
  ].join("\n");
}
