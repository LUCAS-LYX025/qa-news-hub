import { useEffect, useState, useMemo } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import { ArrowLeft, ExternalLink, Eye, Tag } from "lucide-react";
import { Alert, Button } from "antd";
import { fetchArticle, fetchCategories, viewArticle, resummarize, rescore, type Article, type Category } from "@/api/client";
import ChunkedMarkdownView from "@/components/article/ChunkedMarkdownView";
import { formatDate, cn } from "@/lib/utils";

export default function ArticleDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const [article, setArticle] = useState<Article | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    if (!id) return;
    setShowContent(false);
    fetchArticle(id)
      .then(setArticle)
      .catch(() => setArticle(null));
    viewArticle(id).catch(() => {});
    fetchCategories().then(setCategories).catch(() => {});
  }, [id]);

  const catName = useMemo(() => {
    if (!article) return "";
    return categories.find((c) => c.id === article.category)?.name || "";
  }, [article, categories]);

  const [busy, setBusy] = useState<string | null>(null);
  const onResummarize = async () => {
    if (!article) return;
    setBusy("sum");
    try {
      setArticle(await resummarize(article.id, 3));
    } finally {
      setBusy(null);
    }
  };
  const onRescore = async () => {
    if (!article) return;
    setBusy("score");
    try {
      setArticle(await rescore(article.id));
    } finally {
      setBusy(null);
    }
  };

  if (!article) {
    return <div className="text-center py-16 text-slate-400">加载中或文章不存在…</div>;
  }

  return (
    <div>
      <Link to={`/${location.search}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-amber-600 mb-4">
        <ArrowLeft className="h-4 w-4" /> 返回资讯流
      </Link>

      <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
        {catName && <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">{catName}</span>}
        <span>{article.source_name}</span>
        <span>·</span>
        <span>{article.author}</span>
        <span>·</span>
        <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> {article.view_count}</span>
        <span>·</span>
        <span>{formatDate(article.published_at)}</span>
      </div>

      <h1 className="text-2xl font-bold text-slate-900 leading-snug">{article.title}</h1>

      {article.tags?.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {article.tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 text-xs text-slate-500 bg-slate-100 rounded-full px-2.5 py-1">
              <Tag className="h-3 w-3" /> {t}
            </span>
          ))}
        </div>
      )}

      {article.cover_image && (
        <img src={article.cover_image} alt="" className="w-full rounded-xl mt-4 mb-2 max-h-80 object-cover" />
      )}

      {/* 质量分析面板 */}
      {(article.quality_score !== null || !!article.keywords?.length) && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              {article.quality_score !== null && article.quality_score !== undefined && (
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "text-2xl font-bold",
                      article.quality_score >= 80
                        ? "text-emerald-600"
                        : article.quality_score >= 60
                        ? "text-amber-600"
                        : "text-slate-400"
                    )}
                  >
                    {article.quality_score}
                  </span>
                  <span className="text-xs text-slate-500">内容质量分</span>
                </div>
              )}
              <span className="text-xs text-slate-400">
                摘要来源：{article.summary_source === "llm" ? "本地大模型" : article.summary_source === "extractive" ? "抽取式算法" : "手动"}
              </span>
            </div>
            <div className="flex gap-2">
              <Link
                to={`/article/${article.id}/rewrite${location.search}`}
                className="px-3 py-1.5 text-xs rounded-lg bg-amber-500 text-white hover:bg-amber-600"
              >
                二创工作台
              </Link>
              <button
                onClick={onResummarize}
                disabled={!!busy}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
              >
                {busy === "sum" ? "生成中…" : "重新摘要"}
              </button>
              <button
                onClick={onRescore}
                disabled={!!busy}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
              >
                {busy === "score" ? "评分中…" : "重新评分"}
              </button>
            </div>
          </div>

          {!!article.quality_reasons?.length && (
            <details className="mt-3">
              <summary className="text-xs text-slate-500 cursor-pointer">查看评分依据</summary>
              <ul className="mt-2 space-y-1">
                {article.quality_reasons.map((r, i) => (
                  <li key={i} className="text-xs text-slate-500">· {r}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="mt-5">
        {article.content.length > 12000 && !showContent ? (
          <Alert
            type="info"
            showIcon
            message="正文较长，未自动展开"
            action={<Button size="small" onClick={() => setShowContent(true)}>查看全文</Button>}
          />
        ) : (
          <ChunkedMarkdownView content={article.content} />
        )}
      </div>

      {article.source_url && (
        <a
          href={article.source_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 mt-6 text-sm text-amber-600 hover:underline"
        >
          查看原始链接 <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}
