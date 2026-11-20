const baseUrl =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api/v1/qa-news";

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
}
export interface Article {
  id: string;
  title: string;
  summary: string;
  content: string;
  author: string;
  source_name: string;
  source_url: string | null;
  category: string;
  tags: string[];
  cover_image: string | null;
  view_count: number;
  crawled: boolean;
  created_at: string;
  published_at: string;
  // 分析能力
  quality_score?: number | null;
  quality_reasons?: string[];
  keywords?: string[];
  summary_source?: string;
  text_length?: number;
  via_subscription?: string | null;
  // 二创
  versions?: ArticleVersion[];
  active_version?: string | null;
  attribution?: { author?: string; url?: string; note?: string; declare_original?: boolean } | null;
  // 干净的 Markdown 版本（从 HTML 正文转换而来），二创/查重/复制发布稿都基于它
  content_md?: string;
}
export interface ArticleVersion {
  id: string;
  title: string;
  content: string;
  type: "ai" | "manual";
  created_at: string;
  engine?: string;
  intensity?: string;
  style?: string;
  template?: string;
  protect?: string[];
}
export interface OriginalityResult {
  similarity: number;
  similar: boolean;
  flagged: boolean;
  base: string;
}
export interface AttributionResult {
  attribution: { author?: string; url?: string; note?: string; declare_original?: boolean };
  snippet: string;
}
export interface TranslationResult {
  content: string;
  engine: "llm" | "free" | "skipped" | "unavailable" | "error";
  message?: string;
  is_chinese?: boolean;
}
export interface RecommendedSource {
  name: string;
  url: string;
  category: string;
  note: string;
}
export interface ArticleListResult {
  items: Article[];
  total: number;
  page: number;
  page_size: number;
}
export interface Stats {
  total: number;
  crawled: number;
  avg_quality: number;
  by_category: Array<Category & { count: number }>;
  by_source: Array<{ name: string; count: number }>;
}
export interface Subscription {
  id: string;
  url: string;
  name: string;
  category: string;
  tags: string[];
  interval_minutes: number;
  max_per_run: number;
  /** 采集质量门槛：低于该分数的文章直接丢弃 */
  min_quality: number;
  enabled: boolean;
  last_run_at: string | null;
  last_status: string | null;
  collected_count: number;
}
export interface CrawlResultItem {
  url: string;
  status: "ok" | "duplicate" | "failed";
  id?: string;
  title?: string;
  quality_score?: number;
  reason?: string;
}
export interface CrawlBatchResult {
  results: CrawlResultItem[];
  summary: { total: number; ok: number; duplicate: number; failed: number };
}

interface ApiEnvelope<T> {
  entity: T;
}

let accessToken: string | null = null;
let refreshPromise: Promise<{ access_token: string }> | null = null;

export class ApiError extends Error {
  constructor(message: string, public code: string, public status: number) {
    super(message);
  }
}

async function requestEnvelope<T>(path: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init?.headers || {}),
    },
  });
  if (res.status === 401 && !path.startsWith("/auth/")) {
    try {
      await refreshSession();
      return requestEnvelope<T>(path, init);
    } catch {
      /* ignore */
    }
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let detail: any = null;
    try {
      detail = raw ? JSON.parse(raw) : null;
    } catch {
      /* ignore */
    }
    throw new ApiError(detail?.detail?.message || `请求失败（HTTP ${res.status}）`, detail?.detail?.code || "ERR", res.status);
  }
  if (res.status === 204) return { entity: undefined as T };
  return (await res.json()) as ApiEnvelope<T>;
}
async function request<T>(path: string, init?: RequestInit) {
  return (await requestEnvelope<T>(path, init)).entity;
}

// 鉴权
export const login = async (username: string, password: string) => {
  const s = await request<any>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
  accessToken = s.access_token;
  return s;
};
export const refreshSession = () => {
  if (!refreshPromise) {
    refreshPromise = request<any>("/auth/refresh", { method: "POST" })
      .then((s) => {
        accessToken = s.access_token;
        return s;
      })
      .catch((e) => {
        accessToken = null;
        throw e;
      })
      .finally(() => (refreshPromise = null));
  }
  return refreshPromise;
};
export const logout = async () => {
  try {
    await fetch(`${baseUrl}/auth/logout`, { method: "POST" });
  } finally {
    accessToken = null;
  }
};

// 分类 / 统计
export const fetchCategories = () => request<Category[]>("/categories");
export const fetchStats = () => request<Stats>("/stats");

// 文章
export const fetchArticles = (
  params: {
    page?: number;
    category?: string;
    keyword?: string;
    tag?: string;
    source?: string;
    min_quality?: number;
    sort?: "latest" | "quality" | "views";
  } = {}
) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== "") q.set(k, String(v));
  });
  return request<ArticleListResult>(`/articles?${q.toString()}`);
};
export const fetchArticle = (id: string) => request<Article>(`/articles/${id}`);
export const viewArticle = (id: string) => request<{ view_count: number }>(`/articles/${id}/view`, { method: "POST" });
export const deleteArticle = (id: string) => request<void>(`/articles/${id}`, { method: "DELETE" });
export const createArticle = (payload: Partial<Article>) =>
  request<Article>("/articles", { method: "POST", body: JSON.stringify(payload) });

// 抓取（单篇 / 批量）
export const crawlArticle = (url: string, category?: string, tags: string[] = [], force = false) =>
  request<Article>("/articles/crawl", {
    method: "POST",
    body: JSON.stringify({ url, category, tags, force }),
  });
export const crawlBatch = (urls: string[], category?: string, tags: string[] = [], force = false) =>
  request<CrawlBatchResult>("/articles/crawl-batch", {
    method: "POST",
    body: JSON.stringify({ urls, category, tags, force }),
  });
export const dedupCheck = (url: string) =>
  request<{ duplicate: boolean; existing: { id: string; title: string } | null }>("/dedup-check", {
    method: "POST",
    body: JSON.stringify({ url }),
  });

// 分析
export const resummarize = (id: string, sentences = 3) =>
  request<Article>(`/articles/${id}/summarize`, { method: "POST", body: JSON.stringify({ sentences }) });
export const rescore = (id: string) => request<Article>(`/articles/${id}/rescore`, { method: "POST" });

// 二创：AI 改写 / 版本 / 查重 / 署名
export const rewriteArticleReq = (id: string, payload: { intensity?: string; style?: string; protect?: string[]; template?: string; custom_prompt?: string }) =>
  request<ArticleVersion>(`/articles/${id}/rewrite`, { method: "POST", body: JSON.stringify(payload) });
export const fetchVersions = (id: string) => request<ArticleVersion[]>(`/articles/${id}/versions`);
export const createVersion = (id: string, payload: { title?: string; content: string; type?: "ai" | "manual" }) =>
  request<ArticleVersion>(`/articles/${id}/versions`, { method: "POST", body: JSON.stringify(payload) });
export const updateVersion = (id: string, vid: string, payload: { title?: string; content?: string }) =>
  request<ArticleVersion>(`/articles/${id}/versions/${vid}`, { method: "PATCH", body: JSON.stringify(payload) });
export const deleteVersion = (id: string, vid: string) =>
  request<void>(`/articles/${id}/versions/${vid}`, { method: "DELETE" });
export const activateVersion = (id: string, vid: string) =>
  request<Article>(`/articles/${id}/versions/${vid}/activate`, { method: "POST" });
export const checkOriginality = (id: string, text?: string) =>
  request<OriginalityResult>(`/articles/${id}/originality`, { method: "POST", body: JSON.stringify({ text }) });
export const translateArticleReq = (id: string) =>
  request<TranslationResult>(`/articles/${id}/translate`, { method: "POST", body: JSON.stringify({}) });
export const getAttribution = (id: string) =>
  request<AttributionResult>(`/articles/${id}/attribution`);
export const setAttribution = (id: string, payload: { author?: string; url?: string; note?: string; declare_original?: boolean }) =>
  request<AttributionResult>(`/articles/${id}/attribution`, { method: "POST", body: JSON.stringify(payload) });
export const fetchRecommendedSources = () => request<RecommendedSource[]>(`/recommended-sources`);
export const fetchFeatures = () =>
  request<{ local_llm: boolean; local_llm_url: string | null; free_translate: boolean }>(`/features`);

// 订阅源（定时采集）
export const fetchSubscriptions = () => request<Subscription[]>("/subscriptions");
export const createSubscription = (payload: Partial<Subscription>) =>
  request<Subscription>("/subscriptions", { method: "POST", body: JSON.stringify(payload) });
export const updateSubscription = (id: string, payload: Partial<Subscription>) =>
  request<Subscription>(`/subscriptions/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
export const deleteSubscription = (id: string) => request<void>(`/subscriptions/${id}`, { method: "DELETE" });
export const runSubscription = (id: string) =>
  request<{ added: number; skipped: number; low_quality: number; failed: number }>(`/subscriptions/${id}/run`, {
    method: "POST",
  });
