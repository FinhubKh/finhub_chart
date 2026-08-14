import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import LoginPage from "./components/LoginPage";
import { useAuth } from "./lib/auth";

const StrategiesPage = lazy(() => import("./pages/StrategiesPage"));
const ChartPage = lazy(() => import("./pages/ChartPage"));

function PageFallback() {
  return (
    <div className="auth-boot">
      <p>Loading…</p>
    </div>
  );
}

function HomeRedirect() {
  const { ready, user } = useAuth();
  if (!ready) {
    return (
      <div className="auth-boot">
        <p>Loading…</p>
      </div>
    );
  }
  return <Navigate to={user ? "/strategies" : "/login"} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/strategies"
        element={
          <ProtectedRoute>
            <Suspense fallback={<PageFallback />}>
              <StrategiesPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/chart"
        element={
          <ProtectedRoute>
            <Suspense fallback={<PageFallback />}>
              <ChartPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route path="/" element={<HomeRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
