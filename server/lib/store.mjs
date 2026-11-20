import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { qualityScore, keywords as extractKeywords, normalizeUrl } from "./analyze.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "..", "data.json");

const CATEGORIES = [
  { id: "c_auto", name: "自动化测试", slug: "automation", description: "UI / 接口 / 端到端自动化" },
  { id: "c_perf", name: "性能测试", slug: "performance", description: "压测、容量、稳定性" },
  { id: "c_api", name: "接口测试", slug: "api", description: "API 契约、Mock、联调" },
  { id: "c_quality", name: "质量效能", slug: "quality", description: "测试左移、度量、DevOps" },
  { id: "c_tool", name: "测试工具", slug: "tool", description: "框架、平台、脚手架" },
  { id: "c_ai", name: "AI 应用", slug: "ai", description: "Agent / Skill / 工作流与 AI 工程实践" },
  { id: "c_industry", name: "行业资讯", slug: "industry", description: "质量趋势与岗位动态" },
];

const SEED = [
  {
    category: "c_auto",
    title: "Playwright 多浏览器并行执行的最佳实践",
    author: "测试之家",
    source_name: "CSDN",
    source_url: "https://blog.csdn.net/example/playwright-parallel",
    summary: "通过分片（shard）与 worker 隔离，把单条流水线从 40 分钟压缩到 8 分钟，并规避了状态串扰。",
    tags: ["Playwright", "CI", "并行"],
    content: `## 背景\n\n在微服务回归场景中，端到端用例超过 1200 条，单次串行执行超过 40 分钟，成为发布瓶颈。\n\n## 方案\n\n1. **分片执行**：利用 \`--shard=1/6\` 把用例均分到 6 个节点；\n2. **结果汇聚**：各节点产出 JUnit 报告，由流水线合并；\n3. **隔离策略**：每个 worker 使用独立上下文与测试数据前缀，避免串扰。\n\n## 收益\n\n| 指标 | 优化前 | 优化后 |\n|------|--------|--------|\n| 执行时长 | 42 min | 8 min |\n| 失败误报 | 6% | 1.2% |\n\n> 关键点是给每个分片分配稳定的测试数据命名空间。`,
  },
  {
    category: "c_api",
    title: "用契约测试守住微服务接口边界",
    author: "质量效能笔记",
    source_name: "掘金",
    source_url: "https://juejin.cn/example/contract-testing",
    summary: "Provider 与 Consumer 双向校验，把接口破坏性变更拦截在联调之前。",
    tags: ["契约测试", "Pact", "Mock"],
    content: `## 为什么需要契约测试\n\n接口文档滞后、字段偷偷改名，是联调阶段最大的时间黑洞。\n\n## 实践\n\n- **Consumer 端**录制期望，生成契约文件；\n- **Provider 端**在 CI 中校验契约，破坏式变更直接红灯；\n- 契约纳入制品库，作为发布门禁。\n\n## 代码示例\n\n\`\`\`ts\nawait provider.addInteraction({\n  uponReceiving: "获取用户订单",\n  withRequest: { method: "GET", path: "/orders/123" },\n  willRespondWith: { status: 200, body: { id: "123" } },\n});\n\`\`\`\n\n落地后，接口类线上故障下降约 35%。`,
  },
  {
    category: "c_perf",
    title: "一次电商大促的容量评估复盘",
    author: "性能那些事",
    source_name: "博客园",
    source_url: "https://cnblogs.com/example/capacity-review",
    summary: "从流量模型、拐点识别到弹性扩容，把预估误差控制在 8% 以内。",
    tags: ["容量规划", "压测", "弹性"],
    content: `## 流量模型\n\n以历史大促的 **TPS 曲线** 为基线，叠加业务增长系数，得到目标模型。\n\n## 拐点识别\n\n逐步加压过程中，在 70% 目标容量处出现 RT 陡增，定位到连接池上限。\n\n## 结论\n\n- 连接池从 200 提到 800；\n- 非核心链路做**提前降级**；\n- 弹性扩容阈值设为 60% 水位。\n\n最终预估误差 7.4%，大促零事故。`,
  },
  {
    category: "c_quality",
    title: "测试左移：把缺陷消灭在需求阶段",
    author: "DevQA",
    source_name: "InfoQ",
    source_url: "https://infoq.cn/example/shift-left",
    summary: "需求评审引入 AC 验收标准 + 示例，缺陷逃逸率显著下降。",
    tags: ["测试左移", "需求", "验收标准"],
    content: `## 痛点\n\n需求模糊 → 开发理解偏差 → 测试阶段才发现，返工成本高。\n\n## 左移动作\n\n1. 需求必须附带 **验收标准（AC）**；\n2. 用具体示例替代抽象描述；\n3. QA 在需求评审即介入，输出测试点。\n\n## 度量\n\n左移后，需求阶段拦截的歧义占全部缺陷的 28%。`,
  },
  {
    category: "c_tool",
    title: "自研测试平台的脚手架设计",
    author: "工具控",
    source_name: "知乎",
    source_url: "https://zhihu.com/example/test-platform",
    summary: "用例即代码 + 插件化执行器，让业务团队低门槛接入自动化。",
    tags: ["测试平台", "脚手架", "插件化"],
    content: `## 设计原则\n\n- **用例即代码**：版本可控、可评审；\n- **执行器插件化**：不同协议（HTTP / gRPC / 消息）各自实现；\n- **结果标准化**：统一报告模型，便于度量。\n\n## 接入成本\n\n业务团队只需实现协议插件，平台负责调度与报告。`,
  },
  {
    category: "c_industry",
    title: "2026 测试工程师能力模型更新",
    author: "行业观察",
    source_name: "Medium",
    source_url: "https://medium.com/example/qa-skill-2026",
    summary: "从“找 bug”到“质量赋能”，工程化与数据素养成为分水岭。",
    tags: ["职业发展", "能力模型"],
    content: `## 趋势\n\n- 自动化成为基础能力而非差异点；\n- 质量度量与风险研判能力稀缺；\n- AI 辅助用例生成进入日常。\n\n## 建议\n\n补齐 **代码能力 + 数据分析 + 业务理解** 三角。`,
  },
];

let seq = 1;
const uid = (p) => `${p}_${(seq++).toString(36)}${Date.now().toString(36).slice(-4)}`;
const now = () => new Date().toISOString();

const state = {
  articles: [],
  subscriptions: [],
};

/** markdown -> 纯文本，供评分与关键词抽取使用 */
function mdToText(md = "") {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[>#\-*|+\s]+/gm, "")
    .replace(/\*\*?([^*]*)\*\*?/g, "$1")
    .trim();
}

function seedArticles() {
  return SEED.map((a, i) => {
    const text = mdToText(a.content || "");
    const { score, reasons } = qualityScore({
      text,
      content: a.content || "",
      source_name: a.source_name || "",
      published_at: a.published_at || now(),
    });
    return {
      id: `a_${i + 1}`,
      crawled: false,
      view_count: Math.floor(Math.random() * 500) + 50,
      created_at: now(),
      published_at: now(),
      cover_image: null,
      quality_score: score,
      quality_reasons: reasons,
      text_length: text.length,
      summary_source: "manual",
      keywords: extractKeywords(text, 6),
      // 二创：版本、激活版本、来源署名
      versions: [],
      active_version: null,
      attribution: null,
      ...a,
    };
  });
}

// ---------- 持久化 ----------
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), "utf-8");
    } catch (e) {
      console.error("[store] 持久化失败:", e.message);
    }
  }, 400);
}

export function loadStore() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      state.articles = Array.isArray(raw.articles) ? raw.articles : [];
      state.subscriptions = Array.isArray(raw.subscriptions) ? raw.subscriptions : [];
      console.log(`[store] 已加载 ${state.articles.length} 篇文章、${state.subscriptions.length} 个订阅源`);
      return;
    }
  } catch (e) {
    console.error("[store] 读取数据失败，使用种子数据:", e.message);
  }
  state.articles = seedArticles();
  scheduleSave();
}

export function getArticles() {
  return state.articles;
}
export function getSubscriptions() {
  return state.subscriptions;
}
export function getCategories() {
  return CATEGORIES;
}
export function addArticle(a) {
  const incoming = a || {};
  // 入库前最后一道去重闸：抓取类文章（crawled=true 且带 source_url）若已存在同归一化 URL，
  // 则更新已有记录而非新建，避免并发/多实例/重复触发导致同一篇被写入多份。
  if (incoming.crawled && incoming.source_url) {
    const nUrl = normalizeUrl(incoming.source_url);
    const hit = state.articles.find((x) => normalizeUrl(x.source_url || "") === nUrl);
    if (hit) {
      const merged = { ...hit };
      // 质量分取较高者，其余抓取字段覆盖；保留更早的 created_at（原始入库时间）
      const baseCreated = hit.created_at;
      Object.assign(merged, incoming, { id: hit.id, created_at: baseCreated });
      if (typeof incoming.quality_score === "number" && typeof hit.quality_score === "number") {
        if (hit.quality_score >= incoming.quality_score) {
          merged.quality_score = hit.quality_score;
          merged.quality_reasons = hit.quality_reasons;
        }
      }
      Object.assign(hit, merged);
      scheduleSave();
      return hit;
    }
  }
  const article = { id: uid("a"), created_at: now(), view_count: 0, quality_score: null, keywords: [], summary_source: "manual", versions: [], active_version: null, attribution: null, ...a };
  state.articles.unshift(article);
  scheduleSave();
  return article;
}
export function updateArticle(id, patch) {
  const a = state.articles.find((x) => x.id === id);
  if (!a) return null;
  Object.assign(a, patch);
  scheduleSave();
  return a;
}
export function removeArticle(id) {
  state.articles = state.articles.filter((x) => x.id !== id);
  scheduleSave();
}
export function findArticle(id) {
  return state.articles.find((x) => x.id === id) || null;
}

// ---------------- 二创版本 / 来源署名 ----------------
export function getArticleVersions(id) {
  const a = findArticle(id);
  return a ? a.versions || [] : null;
}
export function addArticleVersion(id, version) {
  const a = findArticle(id);
  if (!a) return null;
  if (!Array.isArray(a.versions)) a.versions = [];
  const v = { id: uid("v"), created_at: now(), type: "manual", title: "", content: "", ...version };
  a.versions.push(v);
  if (!a.active_version) a.active_version = v.id;
  scheduleSave();
  return v;
}
export function updateArticleVersion(id, vid, patch) {
  const a = findArticle(id);
  if (!a) return null;
  const v = (a.versions || []).find((x) => x.id === vid);
  if (!v) return null;
  Object.assign(v, patch);
  scheduleSave();
  return v;
}
export function removeArticleVersion(id, vid) {
  const a = findArticle(id);
  if (!a) return false;
  a.versions = (a.versions || []).filter((x) => x.id !== vid);
  if (a.active_version === vid) a.active_version = a.versions[0]?.id || null;
  scheduleSave();
  return true;
}
export function activateArticleVersion(id, vid) {
  const a = findArticle(id);
  if (!a) return null;
  if (!(a.versions || []).some((x) => x.id === vid)) return null;
  a.active_version = vid;
  scheduleSave();
  return a;
}
export function setAttribution(id, attribution) {
  const a = findArticle(id);
  if (!a) return null;
  a.attribution = attribution;
  scheduleSave();
  return a;
}
export function addSubscription(s) {
  const sub = {
    id: uid("sub"),
    enabled: true,
    last_run_at: null,
    last_status: null,
    collected_count: 0,
    created_at: now(),
    ...s,
  };
  state.subscriptions.unshift(sub);
  scheduleSave();
  return sub;
}
export function updateSubscription(id, patch) {
  const s = state.subscriptions.find((x) => x.id === id);
  if (!s) return null;
  Object.assign(s, patch);
  scheduleSave();
  return s;
}
export function removeSubscription(id) {
  state.subscriptions = state.subscriptions.filter((x) => x.id !== id);
  scheduleSave();
}
export function findSubscription(id) {
  return state.subscriptions.find((x) => x.id === id) || null;
}
export { uid, now, scheduleSave };
