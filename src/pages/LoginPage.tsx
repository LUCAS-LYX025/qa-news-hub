import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/auth/store";
import { ApiError } from "@/api/client";

export default function LoginPage() {
  const login = useAuth((s) => s.login);
  const navigate = useNavigate();
  const location = useLocation() as any;
  const [username, setUsername] = useState("admin-demo");
  const [password, setPassword] = useState("1234567890");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username.trim(), password);
      navigate(location.state?.from?.pathname || "/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6 justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500 text-white font-bold text-lg">QA</div>
          <div className="text-white text-xl font-semibold">测试工程师资讯工作台</div>
        </div>
        <form onSubmit={onSubmit} className="bg-white rounded-2xl p-6 shadow-xl space-y-4">
          <div>
            <label className="text-sm text-slate-600">用户名</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-amber-400"
              placeholder="admin-demo"
            />
          </div>
          <div>
            <label className="text-sm text-slate-600">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-amber-400"
              placeholder="1234567890"
            />
          </div>
          {error && <div className="text-sm text-red-500">{error}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-amber-500 py-2.5 text-white font-medium hover:bg-amber-600 disabled:opacity-60"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} 登录
          </button>
          <div className="text-xs text-slate-400 text-center">
            演示账号：<code className="bg-slate-100 px-1 rounded">admin-demo</code> / <code className="bg-slate-100 px-1 rounded">1234567890</code>
          </div>
        </form>
      </div>
    </div>
  );
}
