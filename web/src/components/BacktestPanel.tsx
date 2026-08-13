import { useEffect, useMemo, useState } from "react";
import {
  fetchStrategies,
  runBacktest,
  type BacktestResult,
  type StrategyInfo,
} from "../lib/api";
import type { BacktestRunRow } from "../lib/database.types";
import { listBacktestRuns, saveBacktestRun } from "../lib/strategiesApi";
import "../styles/components/backtest-panel.css";

type Props = {
  open: boolean;
  onClose: () => void;
  strategyId: string;
  userId: string;
  tf: string;
  defaultEngine?: string | null;
  defaultParams?: Record<string, number>;
  fromInput: string;
  toInput: string;
};

function localInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

export default function BacktestPanel({
  open,
  onClose,
  strategyId,
  userId,
  tf,
  defaultEngine,
  defaultParams,
  fromInput,
  toInput,
}: Props) {
  const [engines, setEngines] = useState<StrategyInfo[]>([]);
  const [engine, setEngine] = useState(defaultEngine || "sma_cross");
  const [params, setParams] = useState<Record<string, number>>(defaultParams || {});
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [runs, setRuns] = useState<BacktestRunRow[]>([]);

  useEffect(() => {
    if (!open) return;
    fetchStrategies()
      .then((res) => {
        setEngines(res.strategies);
        const pick =
          res.strategies.find((s) => s.id === (defaultEngine || "sma_cross")) ||
          res.strategies[0];
        if (pick) {
          setEngine(pick.id);
          setParams({ ...pick.defaults, ...(defaultParams || {}) });
        }
      })
      .catch((err) => setError(String(err.message || err)));

    listBacktestRuns(strategyId)
      .then(setRuns)
      .catch(() => setRuns([]));
  }, [open, strategyId, defaultEngine, defaultParams]);

  const selected = useMemo(
    () => engines.find((e) => e.id === engine) || null,
    [engines, engine]
  );

  const onEngineChange = (id: string) => {
    setEngine(id);
    const info = engines.find((e) => e.id === id);
    if (info) setParams({ ...info.defaults });
  };

  const onRun = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await runBacktest({
        strategy: engine,
        tf,
        params,
        start: localInputToIso(fromInput),
        end: localInputToIso(toInput),
      });
      setResult(res);
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setRunning(false);
    }
  };

  const onSave = async () => {
    if (!result) return;
    setSaving(true);
    setError(null);
    try {
      const row = await saveBacktestRun({
        userId,
        strategyId,
        engine,
        params,
        tf,
        start: localInputToIso(fromInput) || null,
        end: localInputToIso(toInput) || null,
        result: {
          strategy: result.strategy,
          tf: result.tf,
          params: result.params,
          initial_capital: result.initial_capital,
          final_equity: result.final_equity,
          net_pnl: result.net_pnl,
          return_pct: result.return_pct,
          total_trades: result.total_trades,
          win_rate: result.win_rate,
          profit_factor: result.profit_factor,
          max_drawdown_pct: result.max_drawdown_pct,
          trades: result.trades,
          equity_curve: result.equity_curve,
          markers: result.markers,
        },
      });
      setRuns((prev) => [row, ...prev].slice(0, 20));
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <aside className="backtest-panel" aria-label="Backtest">
      <div className="backtest-panel-head">
        <strong>Backtest</strong>
        <button type="button" className="fh-btn subtle" onClick={onClose}>
          Close
        </button>
      </div>

      <label className="backtest-field">
        Engine
        <select value={engine} onChange={(e) => onEngineChange(e.target.value)}>
          {engines.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>

      {selected &&
        Object.keys(selected.defaults).map((key) => (
          <label key={key} className="backtest-field">
            {key}
            <input
              type="number"
              value={params[key] ?? selected.defaults[key]}
              onChange={(e) =>
                setParams((p) => ({ ...p, [key]: Number(e.target.value) }))
              }
            />
          </label>
        ))}

      <p className="backtest-hint">
        Period: {fromInput && toInput ? `${fromInput} → ${toInput}` : "full recent window"}
        . Set From/To via Replay if you want a custom range.
      </p>

      {error && <div className="backtest-error">{error}</div>}

      <div className="backtest-actions">
        <button
          type="button"
          className="fh-btn primary"
          disabled={running}
          onClick={() => void onRun()}
        >
          {running ? "Running…" : "Run"}
        </button>
        <button
          type="button"
          className="fh-btn"
          disabled={!result || saving}
          onClick={() => void onSave()}
        >
          {saving ? "Saving…" : "Save run"}
        </button>
      </div>

      {result && (
        <div className="backtest-metrics">
          <div>
            <span>Return</span>
            <strong>{result.return_pct.toFixed(2)}%</strong>
          </div>
          <div>
            <span>Net PnL</span>
            <strong>{result.net_pnl.toFixed(2)}</strong>
          </div>
          <div>
            <span>Trades</span>
            <strong>{result.total_trades}</strong>
          </div>
          <div>
            <span>Win rate</span>
            <strong>{(result.win_rate * 100).toFixed(1)}%</strong>
          </div>
          <div>
            <span>Profit factor</span>
            <strong>{result.profit_factor.toFixed(2)}</strong>
          </div>
          <div>
            <span>Max DD</span>
            <strong>{result.max_drawdown_pct.toFixed(2)}%</strong>
          </div>
        </div>
      )}

      <div className="backtest-runs">
        <h4>Saved runs</h4>
        {runs.length === 0 ? (
          <p className="backtest-hint">No saved runs yet.</p>
        ) : (
          <ul>
            {runs.map((r) => {
              const metrics = r.result as {
                return_pct?: number;
                total_trades?: number;
              };
              return (
                <li key={r.id}>
                  <strong>{r.engine}</strong>
                  <span>
                    {r.tf} · {metrics.return_pct != null ? `${Number(metrics.return_pct).toFixed(2)}%` : "—"} ·{" "}
                    {metrics.total_trades ?? "—"} trades
                  </span>
                  <span>{new Date(r.created_at).toLocaleString()}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
