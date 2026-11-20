import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Link2, Layers, FileText, CheckCircle2, AlertCircle, Copy } from "lucide-react";
import {
  fetchCategories,
  crawlArticle,
  crawlBatch,
  createArticle,
  type Category,
  type CrawlResultItem,
} from "@/api/client";
import { ApiError } from "@/api/client";
import { cn } from "@/lib/utils";

type Mode = "crawl" | "batch" | "manual";

export default function SubmitPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("crawl");
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // crawl
  const [url, setUrl] = useState("");
  // batch
  const [urlsText, setUrlsText] = useState("");
  const [batchResult, setBatchResult] = useState<CrawlResultItem[] | null>(null);
  const [batchSummary, setBatchSummary] = useState<{ total: number; ok: number; duplicate: number; failed: number } | null>(null);
  // manual
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");

  useEffect(() => {
    fetchCategories().then((c) => {
      setCategories(c);
      setCategory(c[0]?.id || "");
    });
  }, []);

  const parsedTags = () => tags.split(/[,，\s]+/).filter(Boolean);

  const doCrawl = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      const a = await crawlArticle(url.trim(), category, parsedTags());
      setMsg({ type: "ok", text: `抓取成功，质量分 ${a.quality_score ?? "-"}：${a.title}` });
      setTimeout(() => navigate(`/article/${a.id}`), 900);
    } catch (err) {
      setMsg({ type: "err", text: err instanceof ApiError ? err.message : "抓取失败" });
    } finally {
      setLoading(false);
    }
  };

  const doBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setBatchResult(null);
    setBatchSummary(null);
    const urls = urlsText
      .split(/[\n,，\s]+/)
      .map((u) => u.trim())
      .filter(Boolean);
    if (!urls.length) {
      setMsg({ type: "err", text: "请至少粘贴一个链接" });
      return;
    }
    setLoading(true);
    try {
      const r = await crawlBatch(urls, category, parsedTags());
      setBatchResult(r.results);
      setBatchSummary(r.summary);
      setMsg({
        type: r.summary.ok > 0 ? "ok" : "err",
        text: `批量完成：新增 ${r.summary.ok} / 重复 ${r.summary.duplicate} / 失败 ${r.summary.failed}`,
      });
    } catch (err) {
      setMsg({ type: "err", text: err instanceof ApiError ? err.message : "批量抓取失败" });
    } finally {
      setLoading(false);
    }
  };

  const doManual = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      const a = await createArticle({
        title,
        author,
        source_url: sourceUrl || null,
        category,
        tags: parsedTags(),
        content,
      });
      setMsg({ type: "ok", text: "已发布" });
      setTimeout(() => navigate(`/article/${a.id}`), 800);
    } catch (err) {
      setMsg({ type: "err", text: err instanceof ApiError ? err.message : "发布失败" });
    } finally {
      setLoading(false);
    }
  };

  const field = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-amber-400";
  const tabCls = (m: Mode) =>
    cn(
      "flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm",
      mode === m ? "bg-amber-500 text-white" : "bg-white border border-slate-200 text-slate-600"
    );

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-1">添加资讯</h1>
      <p className="text-sm text-slate-500 mb-4">
        支持单篇 / 批量抓取（CSDN、掘金、知乎、博客园、公众号、Medium…），自动去重、评分与摘要
      </p>

      <div className="flex flex-wrap gap-2 mb-5">
        <button onClick={() => setMode("crawl")} className={tabCls("crawl")}>
          <Link2 className="h-4 w-4" /> 单篇抓取
        </button>
        <button onClick={() => setMode("batch")} className={tabCls("batch")}>
          <Layers className="h-4 w-4" /> 批量抓取
        </button>
        <button onClick={() => setMode("manual")} className={tabCls("manual")}>
          <FileText className="h-4 w-4" /> 手动录入
        </button>
      </div>

      {msg && (
        <div className={cn("mb-4 rounded-lg px-3 py-2 text-sm", msg.type === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600")}>
          {msg.text}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        {mode === "crawl" && (
          <form onSubmit={doCrawl} className="space-y-4">
            <div>
              <label className="text-sm text-slate-600">文章链接</label>
              <input className={field} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://blog.csdn.net/..." />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-slate-600">分类</label>
                <select className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-600">标签（逗号分隔，可选）</label>
                <input className={field} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Playwright, 性能" />
              </div>
            </div>
            <button disabled={loading || !url} className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-white font-medium hover:bg-amber-600 disabled:opacity-60">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />} 抓取并入库
            </button>
          </form>
        )}

        {mode === "batch" && (
          <form onSubmit={doBatch} className="space-y-4">
            <div>
              <label className="text-sm text-slate-600">批量链接（每行一个，或用逗号分隔）</label>
              <textarea
                className={field}
                rows={6}
                value={urlsText}
                onChange={(e) => setUrlsText(e.target.value)}
                placeholder={"https://blog.csdn.net/xxx\nhttps://juejin.cn/post/xxx\nhttps://www.cnblogs.com/xxx"}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-slate-600">分类</label>
                <select className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-600">标签（可选）</label>
                <input className={field} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="批量采集" />
              </div>
            </div>
            <button disabled={loading} className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-white font-medium hover:bg-amber-600 disabled:opacity-60">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />} 开始批量抓取
            </button>

            {batchResult && batchSummary && (
              <div className="mt-4 border-t pt-4">
                <div className="text-sm text-slate-600 mb-2">
                  结果：新增 <b className="text-emerald-600">{batchSummary.ok}</b> · 重复{" "}
                  <b className="text-amber-600">{batchSummary.duplicate}</b> · 失败{" "}
                  <b className="text-red-600">{batchSummary.failed}</b>
                </div>
                <div className="space-y-1.5 max-h-64 overflow-auto">
                  {batchResult.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      {r.status === "ok" ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                      ) : r.status === "duplicate" ? (
                        <Copy className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                      )}
                      <div className="min-w-0">
                        {r.status === "ok" ? (
                          <span className="text-slate-700">
                            <a className="text-amber-600 hover:underline" href={`#/article/${r.id}`}>{r.title}</a>
                            <span className="ml-2 text-slate-400">质量 {r.quality_score}</span>
                          </span>
                        ) : (
                          <span className="text-slate-500">
                            {r.status === "duplicate" ? "重复跳过" : "失败"}：{r.reason}
                          </span>
                        )}
                        <div className="text-slate-400 truncate">{r.url}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </form>
        )}

        {mode === "manual" && (
          <form onSubmit={doManual} className="space-y-4">
            <div>
              <label className="text-sm text-slate-600">标题</label>
              <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="文章标题" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-slate-600">作者</label>
                <input className={field} value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="作者名" />
              </div>
              <div>
                <label className="text-sm text-slate-600">原始链接（可选）</label>
                <input className={field} value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://..." />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-slate-600">分类</label>
                <select className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-600">标签（逗号分隔，可选）</label>
                <input className={field} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Playwright, 性能" />
              </div>
            </div>
            <div>
              <label className="text-sm text-slate-600">正文（支持 Markdown）</label>
              <textarea className={field} rows={10} value={content} onChange={(e) => setContent(e.target.value)} placeholder="## 小标题\n正文内容…" />
            </div>
            <button disabled={loading || !title} className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-white font-medium hover:bg-amber-600 disabled:opacity-60">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />} 发布
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
