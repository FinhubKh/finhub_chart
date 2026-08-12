import { useEffect, useRef, useState } from "react";

const PAIRS = ["XAUUSD"];

type Props = {
  value: string;
  onChange: (val: string) => void;
};

export default function PairDropdown({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="pair-menu" ref={rootRef}>
      <button
        type="button"
        className={`pair-menu-btn ${open ? "active" : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{value}</span>
        <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden>
          <path d="M2 3.5L5 7l3-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>

      {open && (
        <div className="pair-dropdown">
          {PAIRS.map((p) => (
            <button
              key={p}
              className={`pair-option ${value === p ? "on" : ""}`}
              onClick={() => {
                onChange(p);
                setOpen(false);
              }}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
