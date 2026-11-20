import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/store";
import AppLayout from "@/components/layout/AppLayout";
import FeedPage from "@/pages/FeedPage";
import ArticleDetailPage from "@/pages/ArticleDetailPage";
import LoginPage from "@/pages/LoginPage";
import SubmitPage from "@/pages/SubmitPage";
import CategoriesPage from "@/pages/CategoriesPage";
import SubscriptionsPage from "@/pages/SubscriptionsPage";
import RewriteWorkbenchPage from "@/pages/RewriteWorkbenchPage";

function RequireAuth({ children }: { children: JSX.Element }) {
  const session = useAuth((s) => s.session);
  const location = useLocation();
  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children;
}

export default function App() {
  const init = useAuth((s) => s.init);
  const navigate = useNavigate();
  useEffect(() => {
    init();
    // 若缓存了 token 但刷新拿到用户信息前，先放行到首页（刷新成功会回填 session）
    const cached = localStorage.getItem("qa_news_token");
    if (!cached) navigate("/login");
  }, [init, navigate]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<FeedPage />} />
        <Route path="/article/:id" element={<ArticleDetailPage />} />
        <Route path="/article/:id/rewrite" element={<RewriteWorkbenchPage />} />
        <Route path="/submit" element={<SubmitPage />} />
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="/subscriptions" element={<SubscriptionsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
