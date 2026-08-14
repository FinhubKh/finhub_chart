import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import type { StrategyRow } from "../lib/database.types";
import { createStrategy, deleteStrategy, listStrategies } from "../lib/strategiesApi";
import {
  applyDocumentTheme,
  loadTheme,
  saveTheme,
  type ColorScheme,
} from "../lib/theme";
import "../styles/pages/strategies-page.css";

const TFS = ["1M", "5M", "15M", "1H", "4H", "1D", "1W", "1MN"];
const ENGINES = [
  { id: "", label: "None" },
  { id: "sma_cross", label: "SMA Cross" },
  { id: "rsi_mean_reversion", label: "RSI Mean Reversion" },
];

const ENGINE_LABEL: Record<string, string> = {
  sma_cross: "SMA Cross",
  rsi_mean_reversion: "RSI Mean Reversion",
};

function formatUpdated(iso: string) {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const mins = Math.round(diff / 60_000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    if (days < 14) return `${days}d ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function initialsFromEmail(email?: string | null) {
  if (!email) return "U";
  const local = email.split("@")[0] || email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

export default function StrategiesPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<StrategyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [tf, setTf] = useState("1H");
  const [engine, setEngine] = useState("");
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [colorScheme, setColorScheme] = useState<ColorScheme>(() => loadTheme());
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    applyDocumentTheme(colorScheme);
    saveTheme(colorScheme);
  }, [colorScheme]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listStrategies());
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.tf.toLowerCase().includes(q) ||
        (s.engine || "").toLowerCase().includes(q) ||
        s.pair.toLowerCase().includes(q)
    );
  }, [items, query]);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const row = await createStrategy({
        userId: user.id,
        name: name.trim(),
        tf,
        engine: engine || null,
      });
      setModalOpen(false);
      setName("");
      setTf("1H");
      setEngine("");
      navigate(`/chart?strategyId=${row.id}`);
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setSaving(false);
    }
  };

  const closeDelete = () => {
    if (deleting) return;
    setPendingDelete(null);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteStrategy(pendingDelete.id);
      setItems((prev) => prev.filter((s) => s.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    if (!pendingDelete) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deleting) setPendingDelete(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingDelete, deleting]);

  return (
    <div className="strategies-page">
      <header className="strategies-header">
        <div className="strategies-brand">
          <img src="/logo.png" alt="FinHubKh" />
          <div>
            <strong>FINHUBKH</strong>
            <span>Strategy workspace</span>
          </div>
        </div>
        <div className="strategies-actions">
          <span className="strategies-user" title={user?.email || ""}>
            <span className="strategies-avatar" aria-hidden="true">
              {initialsFromEmail(user?.email)}
            </span>
            <span className="strategies-user-email">{user?.email}</span>
          </span>
          <Link className="fh-btn" to="/chart">
            Open chart
          </Link>
          <button
            type="button"
            className="theme-toggle"
            title={colorScheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={colorScheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            onClick={() => setColorScheme((s) => (s === "dark" ? "light" : "dark"))}
          >
            {colorScheme === "dark" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z" />
              </svg>
            )}
          </button>
          <button type="button" className="fh-btn" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <main className="strategies-main">
        <div className="strategies-hero">
          <div>
            <p className="strategies-kicker">Chart terminal</p>
            <h1>Workspaces</h1>
            <p className="strategies-lead">
              Keep each setup on its own chart. Draw levels, then open it when you need it.
            </p>
          </div>
          <label className="strategies-search-wrap">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              className="strategies-search"
              type="search"
              placeholder="Search name, pair, timeframe…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search strategies"
            />
          </label>
        </div>

        {error && <div className="fh-alert error">{error}</div>}

        <div className="strategies-list-head">
          <span className="strategies-count">
            {loading
              ? "Loading workspaces"
              : `${filtered.length} workspace${filtered.length === 1 ? "" : "s"}`}
          </span>
          <button type="button" className="fh-btn subtle" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="strategies-grid">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="strategy-card skeleton" aria-hidden="true">
                <div className="skel skel-tape" />
                <div className="skel skel-title" />
                <div className="skel skel-specs" />
                <div className="skel skel-footer" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="strategies-state empty">
            <div className="strategies-empty-mark" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
            <strong>{items.length === 0 ? "No workspaces yet" : "No matches"}</strong>
            <p>
              {items.length === 0
                ? "Name a setup, pick a timeframe, and open the chart to start drawing."
                : "Try a different name, pair, or timeframe."}
            </p>
            <div className="strategies-state-actions">
              {items.length === 0 && (
                <>
                  <button
                    type="button"
                    className="fh-btn primary"
                    onClick={() => setModalOpen(true)}
                  >
                    New strategy
                  </button>
                  <Link className="fh-btn" to="/chart">
                    Open chart
                  </Link>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="strategies-grid">
            {filtered.map((s) => (
              <article
                key={s.id}
                className="strategy-card"
                onClick={() => navigate(`/chart?strategyId=${s.id}`)}
              >
                <div className="strategy-card-ticket">
                  <span className="strategy-ticker">{s.pair}</span>
                  <span className="strategy-tf">{s.tf}</span>
                  <span className={`strategy-engine${s.engine ? "" : " muted"}`}>
                    {s.engine ? ENGINE_LABEL[s.engine] || s.engine : "Manual"}
                  </span>
                </div>
                <div className="strategy-card-body">
                  <h2 className="strategy-card-name">{s.name}</h2>
                  {s.notes ? (
                    <p className="strategy-card-notes">{s.notes}</p>
                  ) : (
                    <p className="strategy-card-notes muted">Chart workspace</p>
                  )}
                </div>
                <div className="strategy-card-footer">
                  <span className="strategy-card-updated">{formatUpdated(s.updated_at)}</span>
                  <span className="strategy-open">Open chart</span>
                </div>
                <button
                  type="button"
                  className="strategy-delete"
                  aria-label={`Delete ${s.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void setPendingDelete({ id: s.id, name: s.name });
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M4 7h16M9 7V5h6v2M8 7l1 13h6l1-13" />
                  </svg>
                </button>
              </article>
            ))}
            <button type="button" className="strategy-card create" onClick={() => setModalOpen(true)}>
              <span className="strategy-create-plus" aria-hidden="true">
                +
              </span>
              <strong>New strategy</strong>
              <span>Start another workspace</span>
            </button>
          </div>
        )}
      </main>

      {modalOpen && (
        <div
          className="fh-modal-backdrop"
          role="presentation"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="fh-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-strategy-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="fh-modal-head">
              <h2 id="new-strategy-title">New strategy</h2>
              <button
                type="button"
                className="fh-btn subtle"
                onClick={() => setModalOpen(false)}
                aria-label="Close"
              >
                Esc
              </button>
            </div>
            <form onSubmit={(e) => void onCreate(e)} className="fh-form">
              <label>
                <span>Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. London breakout"
                  required
                  autoFocus
                />
              </label>
              <div className="fh-form-row">
                <label>
                  <span>Timeframe</span>
                  <select value={tf} onChange={(e) => setTf(e.target.value)}>
                    {TFS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Default engine</span>
                  <select value={engine} onChange={(e) => setEngine(e.target.value)}>
                    {ENGINES.map((en) => (
                      <option key={en.id || "none"} value={en.id}>
                        {en.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="fh-modal-actions">
                <button type="button" className="fh-btn" onClick={() => setModalOpen(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="fh-btn primary"
                  disabled={saving || !name.trim()}
                >
                  {saving ? "Creating…" : "Create & open"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div
          className="fh-modal-backdrop"
          role="presentation"
          onClick={closeDelete}
        >
          <div
            className="fh-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-strategy-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="fh-modal-head">
              <h2 id="delete-strategy-title">Delete workspace</h2>
              <button
                type="button"
                className="fh-btn subtle"
                onClick={closeDelete}
                aria-label="Close"
                disabled={deleting}
              >
                Esc
              </button>
            </div>
            <p className="fh-modal-copy">
              Delete <strong>{pendingDelete.name}</strong>? Drawings on this workspace
              will be removed. This cannot be undone.
            </p>
            <div className="fh-modal-actions">
              <button
                type="button"
                className="fh-btn"
                onClick={closeDelete}
                disabled={deleting}
                autoFocus
              >
                Cancel
              </button>
              <button
                type="button"
                className="fh-btn danger"
                disabled={deleting}
                onClick={() => void confirmDelete()}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
