import { Link } from "react-router-dom";
import { Eye, ExternalLink, Sparkles } from "lucide-react";
import type { Article } from "@/api/client";
import { formatDate } from "@/lib/utils";

function QualityBadge({ score }: { score?: number | null }) {
  if (score === null || score === undefined) return null;
  const color =
    score >= 80 ? "bg-emerald-50 text-emerald-700" : score >= 60 ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500";
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${color}`} title="内容质量评分（启发式，满分 100）">
      质量 {score}
    </span>
  );
}

export default function ArticleCard({
  article,
  categoryName,
  returnSearch = "",
}: {
  article: Article;
  categoryName?: string;
  returnSearch?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-shadow">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-2">
        {categoryName && (
          <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">{categoryName}</span>
        )}
        <QualityBadge score={article.quality_score} />
        {article.crawled && (
          <span className="px-2 py-0.5 rounded-full bg-sky-50 text-sky-700">已抓取</span>
        )}
        {article.summary_source === "llm" && (
          <span className="px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> AI 摘要
          </span>
        )}
        <span>{article.source_name}</span>
        <span>·</span>
        <span>{article.author}</span>
      </div>

      <Link to={`/article/${article.id}${returnSearch}`} className="block">
        <h3 className="text-lg font-semibold text-slate-900 leading-snug hover:text-amber-600">{article.title}</h3>
      </Link>
      <p className="mt-2 text-sm text-slate-600 line-clamp-2">{article.summary}</p>

      {!!article.keywords?.length && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {article.keywords.slice(0, 5).map((k) => (
            <span key={k} className="text-[11px] text-slate-500 bg-slate-50 border border-slate-100 rounded px-1.5 py-0.5">
              {k}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Eye className="h-3.5 w-3.5" /> {article.view_count}
          </span>
          <span>{formatDate(article.published_at)}</span>
        </div>
        {article.source_url && (
          <a
            href={article.source_url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-slate-500 hover:text-amber-600"
            onClick={(e) => e.stopPropagation()}
          >
            原文 <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}
