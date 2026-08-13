import { useEffect, useMemo, useRef, useState } from "react";
import "../styles/components/indicator-panel.css";
import { INDICATOR_CATALOG, type IndicatorId } from "../lib/indicators";

type Props = {
  active: Set<IndicatorId>;
  onToggle: (id: IndicatorId) => void;
};

export default function IndicatorPanel({ active, onToggle }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return INDICATOR_CATALOG;
    return INDICATOR_CATALOG.filter(
      (ind) =>
        ind.label.toLowerCase().includes(q) ||
        ind.id.toLowerCase().includes(q) ||
        ind.pane.toLowerCase().includes(q)
    );
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    // Focus search when opened
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = active.size;

  return (
    <div className={`ind-menu ${open ? "open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className={`ind-menu-btn ${open || count > 0 ? "active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="ind-menu-label-full">Indicators</span>
        <span className="ind-menu-label-short">Ind</span>
        {count > 0 && <em className="ind-count">{count}</em>}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M2 3.5L5 7l3-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>

      {open && (
        <div className="ind-dropdown" role="listbox">
          <div className="ind-search-wrap">
            <input
              ref={searchRef}
              className="ind-search"
              type="search"
              placeholder="Search indicators…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="ind-dropdown-list">
            {filtered.length === 0 && (
              <div className="ind-empty">No matches</div>
            )}
            {filtered.map((ind) => {
              const on = active.has(ind.id);
              return (
                <button
                  key={ind.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={`ind-option ${on ? "on" : ""}`}
                  onClick={() => onToggle(ind.id)}
                >
                  <span className={`ind-check ${on ? "on" : ""}`} aria-hidden>
                    {on ? "✓" : ""}
                  </span>
                  <span className="ind-option-label">{ind.label}</span>
                  <em>{ind.pane === "main" ? "overlay" : ind.pane}</em>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
