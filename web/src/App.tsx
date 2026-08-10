import { useEffect, useMemo, useState } from "react";
import ChartPane from "./components/ChartPane";
import IndicatorPanel from "./components/IndicatorPanel";
import ReplayBar, { ReplayPeriodPop } from "./components/ReplayBar";
import Toolbar from "./components/Toolbar";
import { fetchCandles, fetchRange, fetchTimeframes, type Candle, type TimeframeFile } from "./api";
import type { Drawing, ToolId } from "./lib/drawings";
import type { IndicatorId } from "./lib/indicators";
import {
  applyDocumentTheme,
  loadTheme,
  saveTheme,
  type ColorScheme,
} from "./lib/theme";
import {
  formatBarClock,
  indexAtOrAfter,
  indexAtOrBefore,
  localInputToUnix,
  unixToLocalInput,
} from "./lib/time";

const TFS = ["1M", "5M", "15M", "1H", "4H", "1D", "1W", "1MN"];

/** First paint: recent window only. More history hydrates in the background. */
const INITIAL_BARS = 4_000;
/** Cap chart payload so 1M/5M never dump 900k bars into the browser at once. */
const HYDRATE_CAP = 50_000;
/** Extra bars before replay From — keeps indicators warm. */
const REPLAY_LOOKBACK = 500;

/** Base interval between bars at 1x speed. */
const REPLAY_TICK_MS = 400;

/** datetime-local → ISO UTC for the API. */
function localInputToIso(value: string): string {
  return new Date(value).toISOString();
}

export default function App() {
  const [tf, setTf] = useState("1H");
  const [files, setFiles] = useState<TimeframeFile[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolId>("cursor");
  const [color, setColor] = useState("#2962ff");
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [stayInDraw, setStayInDraw] = useState(false);
  const [locked, setLocked] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [activeIndicators, setActiveIndicators] = useState<Set<IndicatorId>>(
    () => new Set()
  );
  const [colorScheme, setColorScheme] = useState<ColorScheme>(() => loadTheme());

  useEffect(() => {
    applyDocumentTheme(colorScheme);
    saveTheme(colorScheme);
  }, [colorScheme]);

  // Keep app height aligned with the real visible viewport (iOS Safari chrome).
  useEffect(() => {
    const sync = () => {
      const h = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--app-height", `${Math.round(h)}px`);
    };
    sync();
    window.visualViewport?.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      window.visualViewport?.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
    };
  }, []);

  // —— Bar replay ——
  const [replayOn, setReplayOn] = useState(false);
  const [replayPopOpen, setReplayPopOpen] = useState(false);
  const [replayLoading, setReplayLoading] = useState(false);
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  /** Full dataset bounds for the period picker (not just the loaded window). */
  const [historyMin, setHistoryMin] = useState("");
  const [historyMax, setHistoryMax] = useState("");
  const [historyCount, setHistoryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchTimeframes()
      .then((res) => {
        if (!cancelled) setFiles(res.files);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err.message || err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setHydrating(false);
    setError(null);
    setCandles([]);
    setReplayOn(false);
    setPlaying(false);
    setReplayPopOpen(false);
    setReplayLoading(false);
    setFromInput("");
    setToInput("");
    setHistoryMin("");
    setHistoryMax("");
    setHistoryCount(0);

    fetchCandles(tf, { limit: INITIAL_BARS })
      .then((res) => {
        if (cancelled) return;
        setCandles(res.candles);
        setLoading(false);

        const total = res.total_available ?? res.count;
        const target = Math.min(total, HYDRATE_CAP);
        if (target <= res.count) return;

        setHydrating(true);
        return fetchCandles(tf, { limit: target }).then((full) => {
          if (cancelled) return;
          setCandles(full.candles);
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setCandles([]);
          setError(String(err.message || err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setHydrating(false);
        }
      });

    // Full history bounds for replay (may load TF into API RAM once)
    fetchRange(tf)
      .then((range) => {
        if (cancelled) return;
        if (range.start_unix != null) setHistoryMin(unixToLocalInput(range.start_unix));
        if (range.end_unix != null) setHistoryMax(unixToLocalInput(range.end_unix));
        setHistoryCount(range.count || 0);
      })
      .catch(() => {
        /* picker falls back to loaded candles */
      });

    return () => {
      cancelled = true;
    };
  }, [tf]);

  const dataMin = historyMin || (candles[0] ? unixToLocalInput(candles[0].time) : "");
  const dataMax =
    historyMax ||
    (candles.length ? unixToLocalInput(candles[candles.length - 1].time) : "");

  const defaultFromTo = useMemo(() => {
    if (!candles.length) return { from: "", to: "" };
    const last = candles.length - 1;
    const start = Math.max(0, last - 499);
    return {
      from: unixToLocalInput(candles[start].time),
      to: unixToLocalInput(candles[last].time),
    };
  }, [candles]);

  const fromIdx = useMemo(() => {
    if (!candles.length || !fromInput) return 0;
    return indexAtOrAfter(candles, localInputToUnix(fromInput));
  }, [candles, fromInput]);

  const toIdx = useMemo(() => {
    if (!candles.length || !toInput) return Math.max(0, candles.length - 1);
    return indexAtOrBefore(candles, localInputToUnix(toInput));
  }, [candles, toInput]);

  const endIdx = Math.max(fromIdx, toIdx);

  const visibleCandles = useMemo(() => {
    if (!replayOn || !candles.length) return candles;
    const end = Math.min(Math.max(playhead, fromIdx), endIdx);
    // Keep history before From so indicators have lookback
    return candles.slice(0, end + 1);
  }, [replayOn, candles, playhead, fromIdx, endIdx]);

  // Auto-play tick
  useEffect(() => {
    if (!replayOn || !playing) return;
    const ms = Math.max(20, REPLAY_TICK_MS / speed);
    const id = window.setInterval(() => {
      setPlayhead((i) => {
        if (i >= endIdx) {
          setPlaying(false);
          return endIdx;
        }
        return i + 1;
      });
    }, ms);
    return () => clearInterval(id);
  }, [replayOn, playing, speed, endIdx]);

  const defaultPeriod = () => defaultFromTo;

  const reloadRecentChart = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchCandles(tf, { limit: INITIAL_BARS });
      setCandles(res.candles);
      const total = res.total_available ?? res.count;
      const target = Math.min(total, HYDRATE_CAP);
      if (target > res.count) {
        setHydrating(true);
        const full = await fetchCandles(tf, { limit: target });
        setCandles(full.candles);
      }
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setLoading(false);
      setHydrating(false);
    }
  };

  const startReplay = async (from: string, to: string) => {
    setPlaying(false);
    setReplayLoading(true);
    setError(null);
    try {
      const res = await fetchCandles(tf, {
        start: localInputToIso(from),
        end: localInputToIso(to),
        lookback: REPLAY_LOOKBACK,
      });
      if (!res.candles.length) {
        throw new Error("No candles in that period");
      }
      const fromI =
        res.replay_from_index ??
        indexAtOrAfter(res.candles, localInputToUnix(from));
      const toI = indexAtOrBefore(res.candles, localInputToUnix(to));
      const start = Math.min(fromI, toI);
      setCandles(res.candles);
      setFromInput(from);
      setToInput(to);
      setPlayhead(start);
      setReplayOn(true);
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setReplayLoading(false);
    }
  };

  const stopReplay = () => {
    setPlaying(false);
    setReplayOn(false);
    setFromInput("");
    setToInput("");
    void reloadRecentChart();
  };

  const step = (dir: -1 | 1) => {
    setPlaying(false);
    setPlayhead((i) => {
      const next = i + dir;
      return Math.min(endIdx, Math.max(fromIdx, next));
    });
  };

  const openReplayPop = (open: boolean) => {
    if (open && !fromInput && !toInput) {
      const d = defaultPeriod();
      // Prefer a recent slice inside full history when available
      if (d.from && d.to) {
        setFromInput(d.from);
        setToInput(d.to);
      } else if (historyMax) {
        setToInput(historyMax);
        setFromInput(historyMin || historyMax);
      }
    }
    setReplayPopOpen(open);
  };

  const fileMap = Object.fromEntries(files.map((f) => [f.tf, f]));

  const toggleIndicator = (id: IndicatorId) => {
    setActiveIndicators((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const chartBusy = loading || hydrating || replayLoading;
  const chartBusyMsg = replayLoading
    ? "Loading replay period…"
    : loading
      ? `Loading ${tf}…`
      : `Loading more ${tf} history…`;

  const barLabel = chartBusy
    ? `FinHub · ${tf}`
    : replayOn
      ? `Replay · ${visibleCandles.length.toLocaleString()} / ${candles.length.toLocaleString()}`
      : historyCount > 0
        ? `${candles.length.toLocaleString()} bars · ${tf} · ${historyCount.toLocaleString()} total`
        : `${candles.length.toLocaleString()} bars · ${tf}`;

  const progressLabel =
    replayOn && candles[playhead]
      ? `${formatBarClock(candles[playhead].time)} · bar ${playhead - fromIdx + 1}/${endIdx - fromIdx + 1}`
      : "";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>FINHUBKH</strong>
          <span>XAUUSD · FinHub</span>
        </div>

        <div className="topbar-center">
          <div className="tf-row" role="toolbar" aria-label="Timeframes">
            {TFS.map((item) => {
              const meta = fileMap[item];
              const missing = meta ? !meta.exists : false;
              return (
                <button
                  key={item}
                  className={`tf-btn ${tf === item ? "active" : ""}`}
                  disabled={missing}
                  onClick={() => setTf(item)}
                  title={missing ? "Data missing on FinHub/R2" : meta?.filename}
                >
                  {item}
                </button>
              );
            })}
          </div>
        </div>

        <div className="topbar-actions">
          <IndicatorPanel
            active={activeIndicators}
            onToggle={toggleIndicator}
          />
          <ReplayPeriodPop
            open={replayPopOpen}
            onOpenChange={openReplayPop}
            replayOn={replayOn}
            from={fromInput || defaultFromTo.from}
            to={toInput || defaultFromTo.to}
            min={dataMin}
            max={dataMax}
            historyLabel={
              historyCount > 0
                ? `${historyCount.toLocaleString()} bars available`
                : undefined
            }
            disabled={loading || replayLoading || (!candles.length && !historyMax)}
            loading={replayLoading}
            onStart={startReplay}
            onExit={stopReplay}
          />
          <button
            type="button"
            className="theme-toggle"
            title={
              colorScheme === "dark"
                ? "Switch to light mode"
                : "Switch to dark mode"
            }
            aria-label={
              colorScheme === "dark"
                ? "Switch to light mode"
                : "Switch to dark mode"
            }
            onClick={() =>
              setColorScheme((s) => (s === "dark" ? "light" : "dark"))
            }
          >
            {colorScheme === "dark" ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z" />
              </svg>
            )}
          </button>
        </div>

        <div className="topbar-right">
          {replayOn && (
            <ReplayBar
              playing={playing}
              onPlayPause={() => {
                if (playing) {
                  setPlaying(false);
                  return;
                }
                if (playhead >= endIdx) setPlayhead(fromIdx);
                setPlaying(true);
              }}
              onStep={step}
              speed={speed}
              onSpeed={setSpeed}
              progressLabel={progressLabel}
              onEditPeriod={() => openReplayPop(true)}
            />
          )}
          <div className={`top-meta ${error ? "error" : ""}`}>
            {error || `${barLabel} · drawings ${drawings.length}`}
          </div>
        </div>
      </header>

      <div className="layout chart-only">
        <Toolbar
          tool={tool}
          color={color}
          stayInDraw={stayInDraw}
          locked={locked}
          hidden={hidden}
          onTool={setTool}
          onColor={setColor}
          onStay={() => setStayInDraw((v) => !v)}
          onLock={() => setLocked((v) => !v)}
          onHide={() => setHidden((v) => !v)}
          hasSelection={!!selectedDrawingId}
          onClear={() => {
            if (selectedDrawingId) {
              setDrawings((d) => d.filter((x) => x.id !== selectedDrawingId));
              setSelectedDrawingId(null);
            } else {
              setDrawings([]);
            }
          }}
          onUndo={() => {
            setDrawings((d) => d.slice(0, -1));
            setSelectedDrawingId(null);
          }}
        />

        <div className="chart-column">
          {chartBusy && (
            <div className="chart-loading-overlay" role="status" aria-live="polite">
              <div className="chart-loading-pop">
                <span className="chart-loading-spinner" aria-hidden />
                <p>{chartBusyMsg}</p>
              </div>
            </div>
          )}
          <ChartPane
            candles={visibleCandles}
            tool={tool}
            color={color}
            drawings={drawings}
            onDrawingsChange={setDrawings}
            onTool={setTool}
            activeIndicators={activeIndicators}
            magnet={false}
            stayInDraw={stayInDraw}
            locked={locked}
            hidden={hidden}
            followLatest={replayOn && playing}
            selectedId={selectedDrawingId}
            onSelectDrawing={setSelectedDrawingId}
            colorScheme={colorScheme}
          />
        </div>
      </div>
    </div>
  );
}
