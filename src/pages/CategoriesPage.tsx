import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchStats, type Stats } from "@/api/client";

export default function CategoriesPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    fetchStats().then(setStats).catch(() => {});
  }, []);

  if (!stats) return <div className="text-slate-400">加载中…</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-1">分类与统计</h1>
      <p className="text-sm text-slate-500 mb-4">平台共收录 {stats.total} 篇资讯</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {stats.by_category.map((c) => (
          <Link
            key={c.id}
            to={`/?cat=${c.id}`}
            className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-900">{c.name}</span>
              <span className="text-amber-600 font-bold">{c.count}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1">{c.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
