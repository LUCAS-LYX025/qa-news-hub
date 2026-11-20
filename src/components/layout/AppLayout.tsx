import { useState } from "react";
import { Link, Outlet, useNavigate, useLocation } from "react-router-dom";
import { Newspaper, PlusCircle, LayoutGrid, LogOut, Menu, X, Rss } from "lucide-react";
import { useAuth } from "@/auth/store";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/", label: "资讯流", icon: Newspaper },
  { to: "/submit", label: "添加资讯", icon: PlusCircle },
  { to: "/subscriptions", label: "订阅源", icon: Rss },
  { to: "/categories", label: "分类", icon: LayoutGrid },
];

export default function AppLayout() {
  const session = useAuth((s) => s.session);
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const onLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      {/* 侧边栏（桌面） */}
      <aside className="hidden md:flex w-60 flex-col bg-slate-900 text-slate-200">
        <div className="flex items-center gap-2 px-5 h-16 border-b border-slate-800">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500 text-white font-bold">QA</div>
          <div className="leading-tight">
            <div className="font-semibold text-white">测试工程师</div>
            <div className="text-[11px] text-slate-400">资讯工作台</div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map((n) => {
            const active = location.pathname === n.to;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm",
                  active ? "bg-amber-500 text-white" : "text-slate-300 hover:bg-slate-800"
                )}
              >
                <n.icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-4 py-3 border-t border-slate-800 text-xs text-slate-400">
          <div>{session?.user?.display_name}</div>
          <button onClick={onLogout} className="mt-2 flex items-center gap-1 text-slate-300 hover:text-white">
            <LogOut className="h-3.5 w-3.5" /> 退出登录
          </button>
        </div>
      </aside>

      {/* 移动端抽屉 */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-60 bg-slate-900 text-slate-200 p-4">
            <div className="flex justify-between items-center mb-4">
              <span className="font-semibold text-white">导航</span>
              <button onClick={() => setOpen(false)}><X className="h-5 w-5" /></button>
            </div>
            {nav.map((n) => (
              <Link key={n.to} to={n.to} onClick={() => setOpen(false)} className="flex items-center gap-3 py-2 text-sm">
                <n.icon className="h-4 w-4" /> {n.label}
              </Link>
            ))}
            <button onClick={onLogout} className="mt-4 flex items-center gap-1 text-sm">
              <LogOut className="h-3.5 w-3.5" /> 退出登录
            </button>
          </aside>
        </div>
      )}

      {/* 主区域 */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 flex items-center justify-between px-4 border-b border-slate-200 bg-white md:hidden">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-500 text-white font-bold text-sm">QA</div>
            <span className="font-semibold text-slate-800">测试工程师资讯</span>
          </div>
          <button onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl px-4 py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
