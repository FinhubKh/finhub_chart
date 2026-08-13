import { useEffect, useRef, useState } from "react";
import "../styles/components/replay-bar.css";

type PeriodProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  replayOn: boolean;
  from: string;
  to: string;
  min: string;
  max: string;
  historyLabel?: string;
  disabled?: boolean;
  loading?: boolean;
  onStart: (from: string, to: string) => void | Promise<void>;
  onExit: () => void;
};

/** Top-bar Replay control with a period picker popover. */
export function ReplayPeriodPop({
  open,
  onOpenChange,
  replayOn,
  from,
  to,
  min,
  max,
  historyLabel,
  disabled,
  loading,
  onStart,
  onExit,
}: PeriodProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraftFrom(from || min);
    setDraftTo(to || max);
  }, [open, from, to, min, max]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  const canApply =
    !busy &&
    !loading &&
    !!draftFrom &&
    !!draftTo &&
    draftFrom <= draftTo &&
    (!min || draftFrom >= min) &&
    (!max || draftTo <= max);

  return (
    <div className={`replay-menu ${open ? "open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className={`replay-toggle ${replayOn || open ? "on" : ""}`}
        disabled={disabled}
        title="Bar replay — choose any period in FinHub history"
        onClick={() => onOpenChange(!open)}
      >
        Replay
      </button>

      {open && (
        <div className="replay-pop" role="dialog" aria-label="Replay period">
          <div className="replay-pop-title">Replay period</div>
          {historyLabel && (
            <div className="replay-pop-meta">{historyLabel}</div>
          )}
          <label className="replay-field stack">
            <span>From</span>
            <input
              type="datetime-local"
              value={draftFrom}
              min={min || undefined}
              max={draftTo || max || undefined}
              onChange={(e) => setDraftFrom(e.target.value)}
            />
          </label>
          <label className="replay-field stack">
            <span>To</span>
            <input
              type="datetime-local"
              value={draftTo}
              min={draftFrom || min || undefined}
              max={max || undefined}
              onChange={(e) => setDraftTo(e.target.value)}
            />
          </label>
          <div className="replay-pop-actions">
            {replayOn && (
              <button
                type="button"
                className="replay-btn"
                disabled={busy || loading}
                onClick={() => {
                  onExit();
                  onOpenChange(false);
                }}
              >
                Exit
              </button>
            )}
            <button
              type="button"
              className="replay-btn play"
              disabled={!canApply}
              onClick={async () => {
                if (!canApply) return;
                setBusy(true);
                try {
                  await onStart(draftFrom, draftTo);
                  onOpenChange(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy || loading ? "Loading…" : replayOn ? "Apply" : "Start"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const SPEEDS = [1, 2, 5, 10, 20] as const;

type TransportProps = {
  playing: boolean;
  onPlayPause: () => void;
  onStep: (dir: -1 | 1) => void;
  speed: number;
  onSpeed: (s: number) => void;
  progressLabel: string;
  onEditPeriod: () => void;
};

/** Compact replay transport for the top bar. */
export default function ReplayBar({
  playing,
  onPlayPause,
  onStep,
  speed,
  onSpeed,
  progressLabel,
  onEditPeriod,
}: TransportProps) {
  return (
    <div className="replay-bar topbar-replay">
      <button
        type="button"
        className="replay-btn"
        onClick={onEditPeriod}
        title="Change replay period"
        disabled={playing}
      >
        Period
      </button>

      <div className="replay-transport">
        <button
          type="button"
          className="replay-btn"
          onClick={() => onStep(-1)}
          title="Step back one bar"
          disabled={playing}
        >
          ‹
        </button>
        <button
          type="button"
          className="replay-btn play"
          onClick={onPlayPause}
          title={playing ? "Pause" : "Play"}
        >
          <span className="replay-play-full">{playing ? "Pause" : "Play"}</span>
          <span className="replay-play-short" aria-hidden>
            {playing ? "❚❚" : "▶"}
          </span>
        </button>
        <button
          type="button"
          className="replay-btn"
          onClick={() => onStep(1)}
          title="Step forward one bar"
          disabled={playing}
        >
          ›
        </button>
      </div>

      <label className="replay-field speed">
        <span>Speed</span>
        <select
          value={speed}
          onChange={(e) => onSpeed(Number(e.target.value))}
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
      </label>

      {progressLabel && (
        <div className="replay-progress">{progressLabel}</div>
      )}
    </div>
  );
}
