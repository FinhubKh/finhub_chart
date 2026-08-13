import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import type { StrategyRow } from "../lib/database.types";
import { createStrategy, deleteStrategy, listStrategies } from "../lib/strategiesApi";
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
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
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

  const onDelete = async (id: string, strategyName: string) => {
    if (!confirm(`Delete “${strategyName}”? Drawings and backtest runs will be removed.`)) {
      return;
    }
    try {
      await deleteStrategy(id);
      setItems((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(String((err as Error).message || err));
    }
  };

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
            {user?.email}
          </span>
          <Link className="fh-btn" to="/chart">
            Open chart
          </Link>
          <button type="button" className="fh-btn primary" onClick={() => setModalOpen(true)}>
            New strategy
          </button>
          <button type="button" className="fh-btn" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <main className="strategies-main">
        <div className="strategies-toolbar">
          <div>
            <h1>Strategies</h1>
            <p>Open a workspace to draw and backtest, or jump straight into the chart.</p>
          </div>
          <div className="strategies-toolbar-right">
            <input
              className="strategies-search"
              type="search"
              placeholder="Search name, TF, engine…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search strategies"
            />
          </div>
        </div>

        {error && <div className="fh-alert error">{error}</div>}

        <section className="strategies-panel">
          <div className="strategies-panel-head">
            <span>
              {loading
                ? "Loading…"
                : `${filtered.length} strateg${filtered.length === 1 ? "y" : "ies"}`}
            </span>
            <button type="button" className="fh-btn subtle" onClick={() => void refresh()}>
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="strategies-state">Loading strategies…</div>
          ) : filtered.length === 0 ? (
            <div className="strategies-state empty">
              <strong>{items.length === 0 ? "No strategies yet" : "No matches"}</strong>
              <p>
                {items.length === 0
                  ? "Create a strategy workspace to save drawings and backtests, or open the chart without one."
                  : "Try a different search."}
              </p>
              <div className="strategies-state-actions">
                {items.length === 0 && (
                  <>
                    <button
                      type="button"
                      className="fh-btn primary"
                      onClick={() => setModalOpen(true)}
                    >
                      Create strategy
                    </button>
                    <Link className="fh-btn" to="/chart">
                      Open chart
                    </Link>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="strategies-table-wrap">
              <table className="strategies-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Pair</th>
                    <th>TF</th>
                    <th>Engine</th>
                    <th>Updated</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <button
                          type="button"
                          className="strategies-name-btn"
                          onClick={() => navigate(`/chart?strategyId=${s.id}`)}
                        >
                          {s.name}
                        </button>
                      </td>
                      <td>
                        <span className="fh-chip mono">{s.pair}</span>
                      </td>
                      <td>
                        <span className="fh-chip mono">{s.tf}</span>
                      </td>
                      <td className="muted">
                        {s.engine ? ENGINE_LABEL[s.engine] || s.engine : "—"}
                      </td>
                      <td className="muted">{formatUpdated(s.updated_at)}</td>
                      <td className="strategies-row-actions">
                        <button
                          type="button"
                          className="fh-btn subtle"
                          onClick={() => navigate(`/chart?strategyId=${s.id}`)}
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          className="fh-btn danger-ghost"
                          onClick={() => void onDelete(s.id, s.name)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
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
    </div>
  );
}
