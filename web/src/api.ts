export type DataSource = "local" | "free";

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type TimeframeFile = {
  tf: string;
  filename: string;
  exists: boolean;
  cached?: boolean;
  rows: number;
  start: string | null;
  end: string | null;
  size_bytes: number;
  source?: string;
};

export type StrategyInfo = {
  id: string;
  name: string;
  defaults: Record<string, number>;
};

export type BacktestResult = {
  strategy: string;
  tf: string;
  params: Record<string, number>;
  initial_capital: number;
  final_equity: number;
  net_pnl: number;
  return_pct: number;
  total_trades: number;
  win_rate: number;
  profit_factor: number;
  max_drawdown_pct: number;
  trades: Array<{
    entry_time: string;
    exit_time: string;
    side: "long" | "short";
    entry_price: number;
    exit_price: number;
    pnl: number;
    pnl_pct: number;
    bars_held: number;
  }>;
  equity_curve: Array<{ time: number; equity: number }>;
  markers: Array<{
    time: number;
    position: "aboveBar" | "belowBar";
    color: string;
    shape: string;
    text: string;
  }>;
};

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || res.statusText);
  }
  return res.json();
}

export function fetchTimeframes(source: DataSource = "local") {
  const q = new URLSearchParams({ source });
  return json<{
    timeframes: string[];
    files: TimeframeFile[];
    sources?: string[];
    source?: string;
  }>(`/api/timeframes?${q}`);
}

export function fetchStrategies() {
  return json<{ strategies: StrategyInfo[] }>("/api/strategies");
}

/** Load candles. Pass `limit` for a fast recent window. `source`: local FinHub or free Dukascopy. */
export function fetchCandles(tf: string, limit?: number, source: DataSource = "local") {
  const q = new URLSearchParams({ tf, source });
  if (limit != null) q.set("limit", String(limit));
  return json<{
    tf: string;
    count: number;
    candles: Candle[];
    total_available?: number;
    source?: string;
  }>(`/api/candles?${q}`);
}

export function runBacktest(body: {
  strategy: string;
  tf: string;
  params?: Record<string, number>;
  start?: string;
  end?: string;
  initial_capital?: number;
  stop_loss_pct?: number | null;
  take_profit_pct?: number | null;
}) {
  return json<BacktestResult>("/api/backtest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
