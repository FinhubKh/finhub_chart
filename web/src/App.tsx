import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import LoginPage from "./components/LoginPage";
import StrategiesPage from "./pages/StrategiesPage";
import ChartPage from "./pages/ChartPage";
import { useAuth } from "./lib/auth";

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
            <StrategiesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/chart"
        element={
          <ProtectedRoute>
            <ChartPage />
          </ProtectedRoute>
        }
      />
      <Route path="/" element={<HomeRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
