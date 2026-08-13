import type { Drawing } from "./drawings";
import type { BacktestRunRow, Json, StrategyRow } from "./database.types";
import { supabase } from "./supabase";

export async function listStrategies(): Promise<StrategyRow[]> {
  const { data, error } = await supabase
    .from("strategies")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data || []) as StrategyRow[];
}

export async function getStrategy(id: string): Promise<StrategyRow | null> {
  const { data, error } = await supabase
    .from("strategies")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as StrategyRow | null;
}

export async function createStrategy(input: {
  userId: string;
  name: string;
  pair?: string;
  tf?: string;
  notes?: string;
  engine?: string | null;
  engine_params?: Record<string, number>;
}): Promise<StrategyRow> {
  const { data, error } = await supabase
    .from("strategies")
    .insert({
      user_id: input.userId,
      name: input.name.trim(),
      pair: input.pair || "XAUUSD",
      tf: input.tf || "1H",
      notes: input.notes || null,
      engine: input.engine ?? null,
      engine_params: input.engine_params || {},
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as StrategyRow;
}

export async function deleteStrategy(id: string): Promise<void> {
  const { error } = await supabase.from("strategies").delete().eq("id", id);
  if (error) throw error;
}

export async function updateStrategy(
  id: string,
  patch: Partial<Pick<StrategyRow, "name" | "pair" | "tf" | "notes" | "engine" | "engine_params">>
): Promise<void> {
  const { error } = await supabase.from("strategies").update(patch).eq("id", id);
  if (error) throw error;
}

export async function loadDrawings(strategyId: string): Promise<Drawing[]> {
  const { data, error } = await supabase
    .from("strategy_drawings")
    .select("payload")
    .eq("strategy_id", strategyId)
    .maybeSingle();
  if (error) throw error;
  const payload = data?.payload;
  return Array.isArray(payload) ? (payload as Drawing[]) : [];
}

export async function saveDrawings(
  strategyId: string,
  userId: string,
  drawings: Drawing[]
): Promise<void> {
  const { error } = await supabase.from("strategy_drawings").upsert(
    {
      strategy_id: strategyId,
      user_id: userId,
      payload: drawings as unknown as Json,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "strategy_id" }
  );
  if (error) throw error;
  // Touch strategy updated_at so list sorts correctly
  await supabase
    .from("strategies")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", strategyId);
}

export async function listBacktestRuns(strategyId: string): Promise<BacktestRunRow[]> {
  const { data, error } = await supabase
    .from("backtest_runs")
    .select("*")
    .eq("strategy_id", strategyId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data || []) as BacktestRunRow[];
}

export async function saveBacktestRun(input: {
  userId: string;
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

  const { data, error } = await supabase
    .from("backtest_runs")
    .insert({
      user_id: input.userId,
      strategy_id: input.strategyId,
      engine: input.engine,
      params: input.params,
      tf: input.tf,
      start_at: input.start || null,
      end_at: input.end || null,
      result,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as BacktestRunRow;
}
