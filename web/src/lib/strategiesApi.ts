// Strategies, drawings, and backtest runs now live behind the Cloud Run
// `/api/user/...` routes (see `api/app/user_routes.py`). The server derives
// the owning user from the Firebase Bearer token, so callers never pass a
// `userId` here.

import { ApiError, authFetch, authJson } from "./apiAuth";
import type { Drawing } from "./drawings";
import type { BacktestRunRow, StrategyRow } from "./database.types";

export async function listStrategies(): Promise<StrategyRow[]> {
  const data = await authJson<{ strategies: StrategyRow[] }>("/api/user/strategies");
  return data.strategies || [];
}

export async function getStrategy(id: string): Promise<StrategyRow | null> {
  // The strategies router doesn't expose a single-item GET; an empty PATCH
  // body is a no-op update that returns the current row (see
  // `update_user_strategy` in `user_routes.py`).
  try {
    const data = await authJson<{ strategy: StrategyRow }>(
      `/api/user/strategies/${id}`,
      { method: "PATCH", body: JSON.stringify({}) }
    );
    return data.strategy;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function createStrategy(input: {
  name: string;
  pair?: string;
  tf?: string;
  notes?: string | null;
  engine?: string | null;
  engine_params?: Record<string, number>;
}): Promise<StrategyRow> {
  const data = await authJson<{ strategy: StrategyRow }>("/api/user/strategies", {
    method: "POST",
    body: JSON.stringify({
      name: input.name.trim(),
      pair: input.pair || "XAUUSD",
      tf: input.tf || "1H",
      notes: input.notes ?? null,
      engine: input.engine ?? null,
      engine_params: input.engine_params || {},
    }),
  });
  return data.strategy;
}

export async function deleteStrategy(id: string): Promise<void> {
  await authFetch(`/api/user/strategies/${id}`, { method: "DELETE" });
}

export async function updateStrategy(
  id: string,
  patch: Partial<Pick<StrategyRow, "name" | "pair" | "tf" | "notes" | "engine" | "engine_params">>
): Promise<void> {
  await authFetch(`/api/user/strategies/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function loadDrawings(strategyId: string): Promise<Drawing[]> {
  const data = await authJson<{ drawings: Drawing[] }>(
    `/api/user/strategies/${strategyId}/drawings`
  );
  return Array.isArray(data.drawings) ? data.drawings : [];
}

export async function saveDrawings(strategyId: string, drawings: Drawing[]): Promise<void> {
  await authFetch(`/api/user/strategies/${strategyId}/drawings`, {
    method: "PUT",
    body: JSON.stringify({ drawings }),
  });
}

export async function listBacktestRuns(strategyId: string): Promise<BacktestRunRow[]> {
  const data = await authJson<{ runs: BacktestRunRow[] }>(
    `/api/user/strategies/${strategyId}/backtest-runs`
  );
  return data.runs || [];
}

export async function saveBacktestRun(input: {
  strategyId: string;
  engine: string;
  params: Record<string, number>;
  tf: string;
  start?: string | null;
  end?: string | null;
  result: Record<string, unknown>;
}): Promise<BacktestRunRow> {
  // Trim bulky arrays for storage
  const result = { ...input.result };
  if (Array.isArray(result.equity_curve) && result.equity_curve.length > 500) {
    result.equity_curve = (result.equity_curve as unknown[]).slice(-500);
  }
  if (Array.isArray(result.markers) && result.markers.length > 200) {
    result.markers = (result.markers as unknown[]).slice(0, 200);
  }

  const data = await authJson<{ run: BacktestRunRow }>(
    `/api/user/strategies/${input.strategyId}/backtest-runs`,
    {
      method: "POST",
      body: JSON.stringify({
        engine: input.engine,
        params: input.params,
        tf: input.tf,
        start_at: input.start || null,
        end_at: input.end || null,
        result,
      }),
    }
  );
  return data.run;
}
