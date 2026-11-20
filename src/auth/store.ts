import { create } from "zustand";
import { login as apiLogin, logout as apiLogout, refreshSession, type Category } from "@/api/client";

export interface Session {
  access_token: string;
  user: { id: string; username: string; display_name: string; role: string };
}

interface AuthState {
  session: Session | null;
  init: () => void;
  login: (username: string, password: string) => Promise<Session>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  session: null,
  init: () => {
    const cached = localStorage.getItem("qa_news_token");
    if (cached) {
      refreshSession()
        .then(() => {
          // 刷新成功即视为已登录（演示环境用户固定）
          set({
            session: {
              access_token: cached,
              user: { id: "u_admin", username: "admin-demo", display_name: "管理员", role: "ADMIN" },
            },
          });
        })
        .catch(() => localStorage.removeItem("qa_news_token"));
    }
  },
  login: async (username, password) => {
    const s = await apiLogin(username, password);
    localStorage.setItem("qa_news_token", s.access_token);
    set({ session: s });
    return s;
  },
  logout: async () => {
    await apiLogout();
    localStorage.removeItem("qa_news_token");
    set({ session: null });
  },
}));
