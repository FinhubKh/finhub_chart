// Pine scripts and strategy overlays now live behind the Cloud Run
// `/api/user/...` routes (see `api/app/user_routes.py`). The server derives
// the owning user from the Firebase Bearer token, so callers never pass a
// `userId` here.

import { authFetch, authJson } from "./apiAuth";
import type { PineScriptRow } from "./database.types";

export async function listPineScripts(): Promise<PineScriptRow[]> {
  const data = await authJson<{ scripts: PineScriptRow[] }>("/api/user/pine-scripts");
  return data.scripts || [];
}

export async function createPineScript(input: {
  name: string;
  source: string;
}): Promise<PineScriptRow> {
  const data = await authJson<{ script: PineScriptRow }>("/api/user/pine-scripts", {
    method: "POST",
    body: JSON.stringify({
      name: input.name.trim() || "Untitled script",
      source: input.source,
    }),
  });
  return data.script;
}

export async function updatePineScript(
  id: string,
  patch: Partial<Pick<PineScriptRow, "name" | "source">>
): Promise<void> {
  await authFetch(`/api/user/pine-scripts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deletePineScript(id: string): Promise<void> {
  await authFetch(`/api/user/pine-scripts/${id}`, { method: "DELETE" });
}

export async function listStrategyPineOverlays(strategyId: string): Promise<string[]> {
  const data = await authJson<{ script_ids: string[] }>(
    `/api/user/strategies/${strategyId}/pine-overlays`
  );
  return data.script_ids || [];
}

export async function addStrategyPineOverlay(input: {
  strategyId: string;
  scriptId: string;
}): Promise<void> {
  await authFetch(`/api/user/strategies/${input.strategyId}/pine-overlays`, {
    method: "POST",
    body: JSON.stringify({ script_id: input.scriptId }),
  });
}

export async function removeStrategyPineOverlay(
  strategyId: string,
  scriptId: string
): Promise<void> {
  await authFetch(`/api/user/strategies/${strategyId}/pine-overlays/${scriptId}`, {
    method: "DELETE",
  });
}
