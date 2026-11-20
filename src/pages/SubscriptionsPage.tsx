import { useEffect, useState } from "react";
import { Loader2, Play, Trash2, Rss } from "lucide-react";
import {
  fetchSubscriptions,
  fetchCategories,
  createSubscription,
  deleteSubscription,
  updateSubscription,
  runSubscription,
  fetchRecommendedSources,
  type Subscription,
  type Category,
  type RecommendedSource,
} from "@/api/client";
import { formatDate, cn } from "@/lib/utils";

export default function SubscriptionsPage() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [intervalMin, setIntervalMin] = useState(60);
  const [maxPerRun, setMaxPerRun] = useState(5);
  const [minQuality, setMinQuality] = useState(61);
  const [recs, setRecs] = useState<RecommendedSource[]>([]);
  const [addingRec, setAddingRec] = useState<string | null>(null);

  // 与后端 normalizeUrl 对齐：去协议/末尾斜杠、小写主机，用于判断推荐源是否已添加
  const normUrl = (raw: string) => {
    try {
      const u = new URL(raw);
      const host = u.hostname.replace(/^www\./, "").toLowerCase();
      const path = u.pathname.replace(/\/+$/, "");
      return `${u.protocol}//${host}${path}`.toLowerCase();
    } catch {
      return (raw || "").toLowerCase().replace(/\/+$/, "");
    }
  };
  const subscribedUrls = new Set(subs.map((s) => normUrl(s.url)));

  const load = () => fetchSubscriptions().then(setSubs).catch(() => {});

  useEffect(() => {
    load();
    fetchCategories().then((c) => {
      setCategories(c);
      setCategory(c[0]?.id || "");
    });
    fetchRecommendedSources().then(setRecs).catch(() => {});
  }, []);

  const addRec = async (r: RecommendedSource) => {
    // 前端兜底：已添加的推荐源不再重复请求
    if (subscribedUrls.has(normUrl(r.url))) {
      setMsg({ type: "ok", text: `订阅源已存在：${r.name}` });
      return;
    }
    setAddingRec(r.url);
    try {
      await createSubscription({ url: r.url, name: r.name, category: r.category, min_quality: 61 });
      load();
      setMsg({ type: "ok", text: `已添加推荐订阅源：${r.name}` });
    } catch (err: any) {
      // 后端已做去重（409 DUPLICATE_SUBSCRIPTION），这里把已存在也当成功提示
      if (err?.code === "DUPLICATE_SUBSCRIPTION") {
        load();
        setMsg({ type: "ok", text: err?.message || `订阅源已存在：${r.name}` });
      } else {
        setMsg({ type: "err", text: err?.message || "添加失败" });
      }
    } finally {
      setAddingRec(null);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    try {
      await createSubscription({
        url,
        name,
        category,
        interval_minutes: intervalMin,
        max_per_run: maxPerRun,
        min_quality: minQuality,
      });
      setUrl("");
      setName("");
      load();
      setMsg({ type: "ok", text: "订阅源已添加，调度器会按间隔自动采集" });
    } catch (err: any) {
      setMsg({ type: "err", text: err?.message || "添加失败" });
    } finally {
      setLoading(false);
    }
  };

  const run = async (id: string) => {
    setRunning(id);
    try {
      const r = await runSubscription(id);
      setMsg({
        type: "ok",
        text: `采集完成：新增 ${r.added} / 重复 ${r.skipped} / 低质过滤 ${r.low_quality ?? 0} / 失败 ${r.failed}`,
      });
      load();
    } catch (err: any) {
      setMsg({ type: "err", text: err?.message || "采集失败" });
    } finally {
      setRunning(null);
    }
  };

  const toggle = async (s: Subscription) => {
    await updateSubscription(s.id, { enabled: !s.enabled });
    load();
  };

  const remove = async (id: string) => {
    await deleteSubscription(id);
    load();
  };

  const field = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-amber-400";

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-1">订阅源（定时采集）</h1>
      <p className="text-sm text-slate-500 mb-4">
        填入平台的「列表页 / 专栏页」链接，系统会按间隔自动巡检、抽取文章链接并抓取新内容（自动去重）
      </p>

      {msg && (
        <div className={cn("mb-4 rounded-lg px-3 py-2 text-sm", msg.type === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600")}>
          {msg.text}
        </div>
      )}

      <form onSubmit={add} className="bg-white rounded-xl border border-slate-200 p-5 mb-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-slate-600">列表页链接</label>
            <input className={field} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://blog.csdn.net/nav/ops" required />
          </div>
          <div>
            <label className="text-sm text-slate-600">名称（可选）</label>
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="CSDN 运维专栏" />
          </div>
          <div>
            <label className="text-sm text-slate-600">默认分类</label>
            <select className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-sm text-slate-600">采集间隔(分钟)</label>
              <input type="number" min={5} className={field} value={intervalMin} onChange={(e) => setIntervalMin(Number(e.target.value))} />
            </div>
            <div>
              <label className="text-sm text-slate-600">每次最多抓</label>
              <input type="number" min={1} max={20} className={field} value={maxPerRun} onChange={(e) => setMaxPerRun(Number(e.target.value))} />
            </div>
            <div>
              <label className="text-sm text-slate-600" title="低于该质量分的文章会被自动丢弃">
                质量门槛
              </label>
              <input
                type="number"
                min={0}
                max={100}
                className={field}
                value={minQuality}
                onChange={(e) => setMinQuality(Number(e.target.value))}
              />
            </div>
          </div>
        </div>
        <button disabled={loading || !url} className="mt-4 flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-white font-medium hover:bg-amber-600 disabled:opacity-60">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />} 添加订阅源
        </button>
      </form>

      {recs.length > 0 && (
        <div className="mb-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">业界常用订阅源（一键添加）</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {recs.map((r) => {
              const added = subscribedUrls.has(normUrl(r.url));
              return (
                <div key={r.url} className="bg-white rounded-xl border border-slate-200 p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">{r.name}</div>
                    <div className="text-xs text-slate-400 truncate">{r.note}</div>
                  </div>
                  <button
                    onClick={() => addRec(r)}
                    disabled={added || addingRec === r.url}
                    className={cn(
                      "shrink-0 rounded-lg px-3 py-1.5 text-xs",
                      added
                        ? "bg-emerald-50 text-emerald-600 cursor-default"
                        : "bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-60"
                    )}
                  >
                    {added ? "已添加" : addingRec === r.url ? "添加中…" : "添加"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {subs.length === 0 ? (
        <div className="text-center py-12 text-slate-400">还没有订阅源，添加一个列表页试试</div>
      ) : (
        <div className="space-y-3">
          {subs.map((s) => (
            <div key={s.id} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Rss className="h-4 w-4 text-amber-500" />
                    <span className="font-semibold text-slate-900 truncate">{s.name}</span>
                    <span className={cn("text-[11px] px-2 py-0.5 rounded-full", s.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                      {s.enabled ? "运行中" : "已暂停"}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1 truncate">{s.url}</div>
                  <div className="text-xs text-slate-400 mt-1">
                    每 {s.interval_minutes} 分钟 · 每次最多 {s.max_per_run} 篇 · 质量门槛 {s.min_quality ?? 61} 分 · 已采集{" "}
                    {s.collected_count || 0} 篇
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    上次：{s.last_run_at ? formatDate(s.last_run_at) : "从未"}{s.last_status ? ` · ${s.last_status}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => run(s.id)} disabled={running === s.id} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50" title="立即采集">
                    {running === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  </button>
                  <button onClick={() => toggle(s)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm hover:bg-slate-50">
                    {s.enabled ? "暂停" : "启用"}
                  </button>
                  <button onClick={() => remove(s.id)} className="p-2 rounded-lg border border-slate-200 hover:bg-red-50" title="删除">
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
