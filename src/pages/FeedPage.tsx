import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Search, Plus, Loader2 } from "lucide-react";
import { fetchArticles, fetchCategories, fetchStats, type Category } from "@/api/client";
import ArticleCard from "@/components/article/ArticleCard";
import { cn } from "@/lib/utils";

export default function FeedPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCat, setActiveCat] = useState<string>(() => searchParams.get("category") || searchParams.get("cat") || "");
  const [keyword, setKeyword] = useState(() => searchParams.get("keyword") || "");
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get("page")) || 1));
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<"latest" | "quality" | "views">(() => (searchParams.get("sort") as "latest" | "quality" | "views") || "latest");
  const [minQuality, setMinQuality] = useState<number>(() => Number(searchParams.get("min_quality")) || 0);
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    fetchCategories().then(setCategories).catch(() => {});
  }, []);

  const setFilters = (changes: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(changes).forEach(([key, value]) => {
      if (value === undefined || value === "" || value === 0 || (key === "sort" && value === "latest")) next.delete(key);
      else next.set(key, String(value));
    });
    navigate({ pathname: "/", search: next.toString() }, { replace: true });
  };

  // 支持从“分类”页通过 ?cat= 进入，也让浏览器前进/后退恢复筛选。
  useEffect(() => {
    setActiveCat(searchParams.get("category") || searchParams.get("cat") || "");
    setKeyword(searchParams.get("keyword") || "");
    setPage(Math.max(1, Number(searchParams.get("page")) || 1));
    setSort((searchParams.get("sort") as "latest" | "quality" | "views") || "latest");
    setMinQuality(Number(searchParams.get("min_quality")) || 0);
  }, [searchParams]);

  useEffect(() => {
    setLoading(true);
    fetchArticles({ page, category: activeCat, keyword, sort, min_quality: minQuality || undefined })
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
      })
      .finally(() => setLoading(false));
    fetchStats().then(setStats).catch(() => {});
  }, [page, activeCat, keyword, sort, minQuality]);

  const catName = useMemo(() => {
    const map: Record<string, string> = {};
    categories.forEach((c) => (map[c.id] = c.name));
    return map;
  }, [categories]);

  const totalPages = Math.max(1, Math.ceil(total / 12));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">资讯流</h1>
          <p className="text-sm text-slate-500 mt-1">汇聚测试工程师领域的优质内容，支持从外部平台链接抓取</p>
        </div>
        <button
          onClick={() => navigate("/submit")}
          className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-amber-600"
        >
          <Plus className="h-4 w-4" /> 添加资讯
        </button>
      </div>

      {/* 搜索 */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value);
            setPage(1);
            setFilters({ keyword: e.target.value, page: undefined });
          }}
          placeholder="搜索标题、摘要或标签…"
          className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2.5 text-sm outline-none focus:border-amber-400"
        />
      </div>

      {/* 分类标签 */}
      <div className="flex flex-wrap gap-2 mb-5">
        <button
          onClick={() => {
            setActiveCat("");
            setPage(1);
            setFilters({ category: undefined, cat: undefined, page: undefined });
          }}
          className={cn(
            "rounded-full px-3.5 py-1.5 text-sm",
            activeCat === "" ? "bg-slate-900 text-white" : "bg-white text-slate-600 border border-slate-200"
          )}
        >
          全部
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setActiveCat(c.id);
              setPage(1);
              setFilters({ category: c.id, cat: undefined, page: undefined });
            }}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-sm",
              activeCat === c.id ? "bg-slate-900 text-white" : "bg-white text-slate-600 border border-slate-200"
            )}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* 概览 + 排序/过滤 */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        {stats && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="px-2.5 py-1 rounded-full bg-white border border-slate-200">
              共 <b className="text-slate-800">{stats.total}</b> 篇
            </span>
            <span className="px-2.5 py-1 rounded-full bg-white border border-slate-200">
              抓取 <b className="text-sky-600">{stats.crawled}</b> 篇
            </span>
            <span className="px-2.5 py-1 rounded-full bg-white border border-slate-200">
              平均质量 <b className="text-amber-600">{stats.avg_quality}</b>
            </span>
          </div>
        )}
        <div className="flex items-center gap-2 text-xs">
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as any);
              setPage(1);
              setFilters({ sort: e.target.value, page: undefined });
            }}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 outline-none focus:border-amber-400"
          >
            <option value="latest">最新优先</option>
            <option value="quality">质量优先</option>
            <option value="views">阅读优先</option>
          </select>
          <select
            value={minQuality}
            onChange={(e) => {
              setMinQuality(Number(e.target.value));
              setPage(1);
              setFilters({ min_quality: Number(e.target.value), page: undefined });
            }}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 outline-none focus:border-amber-400"
          >
            <option value={0}>全部质量</option>
            <option value={80}>质量 ≥ 80</option>
            <option value={60}>质量 ≥ 60</option>
            <option value={40}>质量 ≥ 40</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-slate-400">暂无资讯，去“添加资讯”粘贴一个链接试试吧</div>
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <ArticleCard key={a.id} article={a} categoryName={catName[a.category]} returnSearch={location.search} />
          ))}
        </div>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => { const next = page - 1; setPage(next); setFilters({ page: next }); }}
            className="rounded-md border px-3 py-1 disabled:opacity-40"
          >
            上一页
          </button>
          <span className="text-slate-500">
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => { const next = page + 1; setPage(next); setFilters({ page: next }); }}
            className="rounded-md border px-3 py-1 disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
