import React, { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import "./LoginPage.css";

export default function LoginPage() {
  const { user, ready, configured, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from =
    (location.state as { from?: string } | null)?.from || "/strategies";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  if (ready && user) {
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    if (!email.trim() || !password.trim()) {
      setError("Please enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        await signIn(email.trim(), password);
        navigate(from, { replace: true });
      } else {
        await signUp(email.trim(), password);
        setInfo(
          "Account created. If email confirmation is enabled in Supabase, check your inbox; otherwise you can sign in now."
        );
        setMode("signin");
      }
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <img src="/logo.png" alt="FinHubKh Logo" className="login-logo" />
          <h2>Welcome to FinHubKh</h2>
          <p>Sign in to manage strategies, drawings, and backtests.</p>
        </div>

        {!configured && (
          <div className="login-error">
            Supabase keys are missing. Add <code>VITE_SUPABASE_URL</code> and{" "}
            <code>VITE_SUPABASE_ANON_KEY</code> to <code>web/.env.local</code>.
          </div>
        )}

        <form className="login-form" onSubmit={(e) => void handleSubmit(e)}>
          {error && <div className="login-error">{error}</div>}
          {info && <div className="login-info">{info}</div>}

          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="member@finhubkh.com"
              required
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              minLength={6}
            />
          </div>

          <button type="submit" className="login-button" disabled={busy || !configured}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div className="login-footer">
          {mode === "signin" ? (
            <p>
              No account?{" "}
              <button type="button" className="register-link" onClick={() => setMode("signup")}>
                Create one
              </button>
            </p>
          ) : (
            <p>
              Already registered?{" "}
              <button type="button" className="register-link" onClick={() => setMode("signin")}>
                Sign in
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
