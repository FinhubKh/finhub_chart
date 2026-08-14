import { useEffect, useMemo, useState } from "react";
import type { PineScriptRow } from "../lib/database.types";
import { compilePine, DEFAULT_PINE_SOURCE } from "../lib/pine";
import {
  createPineScript,
  deletePineScript,
  listPineScripts,
  updatePineScript,
} from "../lib/pineApi";
import "../styles/components/pine-panel.css";

type Props = {
  open: boolean;
  onClose: () => void;
  userId: string;
  candlesLen: number;
  onChartIds: string[];
  onToggleChart: (script: PineScriptRow) => void;
  onSaved?: (row: PineScriptRow) => void;
  onDeleted?: (id: string) => void;
};

export default function PinePanel({
  open,
  onClose,
  userId,
  candlesLen,
  onChartIds,
  onToggleChart,
  onSaved,
  onDeleted,
}: Props) {
  const [items, setItems] = useState<PineScriptRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [name, setName] = useState("SMA");
  const [source, setSource] = useState(DEFAULT_PINE_SOURCE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [hint, setHint] = useState(
    "Pine v5 subset: plot/plotshape/fill, close[1], ta.sma/ema/stdev/bb/vwap/atr."
  );

  const active = items.find((s) => s.id === activeId) || null;
  const dirty = active ? active.name !== name || active.source !== source : source !== DEFAULT_PINE_SOURCE;

  const preview = useMemo(() => compilePine(source, [], activeId || "draft"), [source, activeId]);

  const refresh = async () => {
    try {
      const rows = await listPineScripts();
      setItems(rows);
      setError(null);
    } catch (err) {
      const msg = String((err as Error).message || err);
      setError(
        msg.includes("schema cache") || msg.includes("does not exist")
          ? "Run supabase/migrations/002_pine_scripts.sql in the Supabase SQL editor, then refresh."
          : msg
      );
    }
  };

  useEffect(() => {
    if (open) void refresh();
    else setPendingDelete(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pendingDelete) setPendingDelete(false);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pendingDelete, onClose]);

  const loadRow = (row: PineScriptRow) => {
    setActiveId(row.id);
    setName(row.name);
    setSource(row.source);
  };

  const onNew = () => {
    setActiveId(null);
    setName("Untitled script");
    setSource(DEFAULT_PINE_SOURCE);
  };

  const onSave = async () => {
    setBusy(true);
    setError(null);
    try {
      const title = name.trim() || preview.name || "Untitled script";
      if (activeId) {
        await updatePineScript(activeId, { name: title, source });
        setItems((prev) =>
          prev.map((s) => (s.id === activeId ? { ...s, name: title, source } : s))
        );
        onSaved?.({ ...active!, name: title, source });
        setHint("Saved.");
      } else {
        const row = await createPineScript({ userId, name: title, source });
        setItems((prev) => [row, ...prev]);
        setActiveId(row.id);
        setName(row.name);
        onSaved?.(row);
        setHint("Saved to your library.");
      }
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!activeId) return;
    setBusy(true);
    setError(null);
    try {
      await deletePineScript(activeId);
      setItems((prev) => prev.filter((s) => s.id !== activeId));
      onDeleted?.(activeId);
      setPendingDelete(false);
      onNew();
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const onChart = Boolean(activeId && onChartIds.includes(activeId));
  const status = error || preview.error;
  const statusText = status
    ? status
    : `${hint}${preview.warnings.length ? " · " + preview.warnings[0] : ""}${
        candlesLen ? ` · ${candlesLen.toLocaleString()} bars` : ""
      }`;

  return (
    <aside className="pine-panel" aria-label="Pine editor">
      <div className="pine-list">
        <div className="pine-list-head">
          <span>Scripts</span>
          <button type="button" className="fh-btn subtle" onClick={onNew}>
            New
          </button>
        </div>
        <div className="pine-list-items">
          {items.length === 0 ? (
            <p className="pine-empty">No saved scripts yet. Write one and hit Save.</p>
          ) : (
            items.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`pine-list-item${s.id === activeId ? " on" : ""}`}
                onClick={() => loadRow(s)}
              >
                <span className={`pine-dot${onChartIds.includes(s.id) ? " on" : ""}`} />
                <strong>{s.name}</strong>
              </button>
            ))
          )}
        </div>
      </div>
      <div className="pine-editor">
        <div className="pine-editor-head">
          <input
            className="pine-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Script name"
          />
          <div className="pine-editor-actions">
            <button type="button" className="fh-btn" disabled={busy} onClick={() => void onSave()}>
              {busy ? "Saving…" : dirty ? "Save" : "Saved"}
            </button>
            <button
              type="button"
              className={`fh-btn ${onChart ? "primary" : ""}`}
              disabled={!activeId}
              onClick={() => active && onToggleChart(active)}
              title={activeId ? undefined : "Save the script first"}
            >
              {onChart ? "Remove" : "Add to chart"}
            </button>
            <button
              type="button"
              className="fh-btn danger-ghost"
              disabled={!activeId || busy}
              onClick={() => setPendingDelete(true)}
            >
              Delete
            </button>
            <button type="button" className="fh-btn subtle" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <textarea
          className="pine-source"
          spellCheck={false}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          aria-label="Pine source"
        />
        <div className={`pine-status${status ? " error" : ""}`}>{statusText}</div>
      </div>
      {pendingDelete && activeId ? (
        <div
          className="fh-modal-backdrop"
          role="presentation"
          onClick={() => setPendingDelete(false)}
        >
          <div
            className="fh-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-pine-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="fh-modal-head">
              <h2 id="delete-pine-title">Delete script</h2>
              <button
                type="button"
                className="fh-btn subtle"
                onClick={() => setPendingDelete(false)}
                aria-label="Close"
                disabled={busy}
              >
                Esc
              </button>
            </div>
            <p className="fh-modal-copy">
              Delete <strong>{name || "this script"}</strong> from your library? It
              will also come off any charts it is on. This cannot be undone.
            </p>
            <div className="fh-modal-actions">
              <button
                type="button"
                className="fh-btn"
                onClick={() => setPendingDelete(false)}
                disabled={busy}
                autoFocus
              >
                Cancel
              </button>
              <button
                type="button"
                className="fh-btn danger"
                disabled={busy}
                onClick={() => void onDelete()}
              >
                {busy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
