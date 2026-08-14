import type { PineScriptRow } from "./database.types";
import { supabase } from "./supabase";

export async function listPineScripts(): Promise<PineScriptRow[]> {
  const { data, error } = await supabase
    .from("pine_scripts")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data || []) as PineScriptRow[];
}

export async function createPineScript(input: {
  userId: string;
  name: string;
  source: string;
}): Promise<PineScriptRow> {
  const { data, error } = await supabase
    .from("pine_scripts")
    .insert({
      user_id: input.userId,
      name: input.name.trim() || "Untitled script",
      source: input.source,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as PineScriptRow;
}

export async function updatePineScript(
  id: string,
  patch: Partial<Pick<PineScriptRow, "name" | "source">>
): Promise<void> {
  const { error } = await supabase.from("pine_scripts").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deletePineScript(id: string): Promise<void> {
  const { error } = await supabase.from("pine_scripts").delete().eq("id", id);
  if (error) throw error;
}

export async function listStrategyPineOverlays(strategyId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("strategy_pine_overlays")
    .select("script_id")
    .eq("strategy_id", strategyId);
  if (error) throw error;
  return (data || []).map((r: { script_id: string }) => r.script_id);
}

export async function addStrategyPineOverlay(input: {
  strategyId: string;
  scriptId: string;
  userId: string;
}): Promise<void> {
  const { error } = await supabase.from("strategy_pine_overlays").upsert(
    {
      strategy_id: input.strategyId,
      script_id: input.scriptId,
      user_id: input.userId,
    },
    { onConflict: "strategy_id,script_id" }
  );
  if (error) throw error;
}

export async function removeStrategyPineOverlay(
  strategyId: string,
  scriptId: string
): Promise<void> {
  const { error } = await supabase
    .from("strategy_pine_overlays")
    .delete()
    .eq("strategy_id", strategyId)
    .eq("script_id", scriptId);
  if (error) throw error;
}
