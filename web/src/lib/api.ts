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

const API_BASE = import.meta.env.DEV
  ? ""
  : (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "";

function apiUrl(path: string) {
  if (!API_BASE) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(url), init);
  } catch {
    throw new Error(
      import.meta.env.DEV
        ? "Failed to reach the local API. Keep `npm run dev` (port 8000) running alongside the web app."
        : "Failed to reach the API. Check VITE_API_URL."
    );
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || res.statusText);
  }
  return res.json();
}

export function fetchTimeframes() {
  return json<{
    timeframes: string[];
    files: TimeframeFile[];
  }>("/api/timeframes");
}

export function fetchStrategies() {
  return json<{ strategies: StrategyInfo[] }>("/api/strategies");
}

/** Load candles. Pass `limit` for a fast recent window, or start/end for a period.
 *  Pass `before` + `limit` to load older history when the user pans left. */
export function fetchCandles(
  tf: string,
  opts?: {
    limit?: number;
    start?: string;
    end?: string;
    before?: string;
    lookback?: number;
  }
) {
  const q = new URLSearchParams({ tf });
  if (opts?.limit != null) q.set("limit", String(opts.limit));
  if (opts?.start) q.set("start", opts.start);
  if (opts?.end) q.set("end", opts.end);
  if (opts?.before) q.set("before", opts.before);
  if (opts?.lookback != null && opts.lookback > 0) {
    q.set("lookback", String(opts.lookback));
  }
  return json<{
    tf: string;
    count: number;
    candles: Candle[];
    total_available?: number;
    replay_from_index?: number;
    has_more?: boolean;
  }>(`/api/candles?${q}`);
}

/** Full history bounds for the replay period picker. */
export function fetchRange(tf: string) {
  const q = new URLSearchParams({ tf });
  return json<{
    tf: string;
    count: number;
    start: string | null;
    end: string | null;
    start_unix: number | null;
    end_unix: number | null;
  }>(`/api/range?${q}`);
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
