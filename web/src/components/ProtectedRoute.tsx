import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { ready, user, configured } = useAuth();
  const location = useLocation();

  if (!ready) {
    return (
      <div className="auth-boot">
        <p>Loading…</p>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="auth-boot">
        <p>
          Supabase is not configured yet. Add <code>VITE_SUPABASE_URL</code> and{" "}
          <code>VITE_SUPABASE_ANON_KEY</code> to <code>web/.env.local</code>, then restart the
          dev server.
        </p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return <>{children}</>;
}
