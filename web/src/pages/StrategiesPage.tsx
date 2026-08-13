import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import type { StrategyRow } from "../lib/database.types";
import { createStrategy, deleteStrategy, listStrategies } from "../lib/strategiesApi";
import "./StrategiesPage.css";

const TFS = ["1M", "5M", "15M", "1H", "4H", "1D", "1W", "1MN"];
const ENGINES = [
  { id: "", label: "None (draw only)" },
  { id: "sma_cross", label: "SMA Cross" },
  { id: "rsi_mean_reversion", label: "RSI Mean Reversion" },
];

function formatUpdated(iso: string) {
  try {
    return new Date(iso).toLocaleString();
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
    if (!confirm(`Delete strategy “${strategyName}”? Drawings and runs will be removed.`)) {
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
            <strong>Strategies</strong>
            <span>{user?.email}</span>
          </div>
        </div>
        <div className="strategies-actions">
          <Link className="btn ghost" to="/chart">
            Open chart
          </Link>
          <button type="button" className="btn primary" onClick={() => setModalOpen(true)}>
            New strategy
          </button>
          <button type="button" className="btn ghost" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <main className="strategies-main">
        <p className="strategies-lead">
          Create a strategy workspace, open the chart to draw and backtest. You can also open the
          chart without a strategy.
        </p>

        {error && <div className="strategies-error">{error}</div>}

        {loading ? (
          <p className="strategies-muted">Loading strategies…</p>
        ) : items.length === 0 ? (
          <div className="strategies-empty">
            <p>No strategies yet.</p>
            <button type="button" className="btn primary" onClick={() => setModalOpen(true)}>
              Create your first strategy
            </button>
            <Link className="btn ghost" to="/chart">
              Or open chart directly
            </Link>
          </div>
        ) : (
          <ul className="strategies-grid">
            {items.map((s) => (
              <li key={s.id} className="strategy-card">
                <button
                  type="button"
                  className="strategy-card-main"
                  onClick={() => navigate(`/chart?strategyId=${s.id}`)}
                >
                  <strong>{s.name}</strong>
                  <span className="strategy-meta">
                    {s.pair} · {s.tf}
                    {s.engine ? ` · ${s.engine}` : ""}
                  </span>
                  <span className="strategy-meta">Updated {formatUpdated(s.updated_at)}</span>
                </button>
                <button
                  type="button"
                  className="strategy-delete"
                  title="Delete"
                  onClick={() => void onDelete(s.id, s.name)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      {modalOpen && (
        <div className="strategies-modal-backdrop" role="presentation" onClick={() => setModalOpen(false)}>
          <div
            className="strategies-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-strategy-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="new-strategy-title">New strategy</h2>
            <form onSubmit={(e) => void onCreate(e)}>
              <label>
                Name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. London breakout"
                  required
                  autoFocus
                />
              </label>
              <label>
                Timeframe
                <select value={tf} onChange={(e) => setTf(e.target.value)}>
                  {TFS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Default engine
                <select value={engine} onChange={(e) => setEngine(e.target.value)}>
                  {ENGINES.map((en) => (
                    <option key={en.id || "none"} value={en.id}>
                      {en.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="strategies-modal-actions">
                <button type="button" className="btn ghost" onClick={() => setModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn primary" disabled={saving || !name.trim()}>
                  {saving ? "Creating…" : "Create & open chart"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
