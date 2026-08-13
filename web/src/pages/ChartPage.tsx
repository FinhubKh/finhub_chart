import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import ChartPane from "../components/ChartPane";
import IndicatorPanel from "../components/IndicatorPanel";
import ReplayBar, { ReplayPeriodPop } from "../components/ReplayBar";
import Toolbar from "../components/Toolbar";
import PairDropdown from "../components/PairDropdown";
import BacktestPanel from "../components/BacktestPanel";
import {
  fetchCandles,
  fetchRange,
  fetchTimeframes,
  type Candle,
  type TimeframeFile,
} from "../lib/api";
import type { Drawing, ToolId } from "../lib/drawings";
import type { IndicatorId } from "../lib/indicators";
import {
  applyDocumentTheme,
  loadTheme,
  saveTheme,
  type ColorScheme,
} from "../lib/theme";
import { loadSettings, saveSettings, type ChartSettings } from "../lib/settings";
import SettingsModal from "../components/SettingsModal";
import {
  formatBarClock,
  indexAtOrAfter,
  indexAtOrBefore,
  localInputToUnix,
  unixToLocalInput,
} from "../lib/time";
import { useAuth } from "../lib/auth";
import type { StrategyRow } from "../lib/database.types";
import {
  createStrategy,
  getStrategy,
  loadDrawings,
  saveDrawings,
  updateStrategy,
} from "../lib/strategiesApi";

const TFS = ["1M", "5M", "15M", "1H", "4H", "1D", "1W", "1MN"];
const INITIAL_BARS = 1_000;
const OLDER_CHUNK = 4_000;
const CLIENT_MAX_BARS = 200_000;
const REPLAY_LOOKBACK = 500;
const REPLAY_TICK_MS = 400;
const DRAW_SAVE_DEBOUNCE_MS = 800;

function localInputToIso(value: string): string {
  return new Date(value).toISOString();
}

export default function ChartPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const strategyId = searchParams.get("strategyId");

  const [pair, setPair] = useState("XAUUSD");
  const [tf, setTf] = useState("1H");
  const [files, setFiles] = useState<TimeframeFile[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolId>("cursor");
  const [color, setColor] = useState("#007c90");
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [stayInDraw, setStayInDraw] = useState(false);
  const [locked, setLocked] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [activeIndicators, setActiveIndicators] = useState<Set<IndicatorId>>(
    () => new Set()
  );
  const [colorScheme, setColorScheme] = useState<ColorScheme>(() => loadTheme());
  const [settings, setSettings] = useState<ChartSettings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [strategy, setStrategy] = useState<StrategyRow | null>(null);
  const [strategyLoading, setStrategyLoading] = useState(Boolean(strategyId));
  const [drawSaveState, setDrawSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [backtestOpen, setBacktestOpen] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const [saveAsBusy, setSaveAsBusy] = useState(false);

  const drawingsHydratedRef = useRef(false);
  const skipNextDrawSaveRef = useRef(false);

  useEffect(() => {
    applyDocumentTheme(colorScheme);
    saveTheme(colorScheme);
    const bg = colorScheme === "dark" ? settings.bgDark : settings.bgLight;
    document.documentElement.style.setProperty("--bg", bg);
    document.documentElement.style.setProperty("--bg-panel", bg);
  }, [colorScheme, settings]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

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

  // Load strategy + drawings when strategyId present
  useEffect(() => {
    let cancelled = false;
    drawingsHydratedRef.current = false;

    if (!strategyId) {
      setStrategy(null);
      setStrategyLoading(false);
      setDrawings([]);
      setBacktestOpen(false);
      return;
    }

    setStrategyLoading(true);
    setError(null);

    (async () => {
      try {
        const row = await getStrategy(strategyId);
        if (cancelled) return;
        if (!row) {
          setError("Strategy not found");
          setStrategy(null);
          setDrawings([]);
          return;
        }
        setStrategy(row);
        setPair(row.pair || "XAUUSD");
        setTf(row.tf || "1H");
        const payload = await loadDrawings(strategyId);
        if (cancelled) return;
        skipNextDrawSaveRef.current = true;
        setDrawings(payload);
        drawingsHydratedRef.current = true;
      } catch (err) {
        if (!cancelled) {
          setError(String((err as Error).message || err));
          setStrategy(null);
        }
      } finally {
        if (!cancelled) setStrategyLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [strategyId]);

  // Debounced drawings autosave
  useEffect(() => {
    if (!strategyId || !user || !drawingsHydratedRef.current) return;
    if (skipNextDrawSaveRef.current) {
      skipNextDrawSaveRef.current = false;
      return;
    }

    setDrawSaveState("saving");
    const timer = window.setTimeout(() => {
      void saveDrawings(strategyId, user.id, drawings)
        .then(() => setDrawSaveState("saved"))
        .catch(() => setDrawSaveState("error"));
    }, DRAW_SAVE_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [drawings, strategyId, user]);

  // Persist TF/pair back to strategy workspace
  useEffect(() => {
    if (!strategyId || !strategy) return;
    if (strategy.tf === tf && strategy.pair === pair) return;
    const timer = window.setTimeout(() => {
      void updateStrategy(strategyId, { tf, pair }).then(() => {
        setStrategy((s) => (s ? { ...s, tf, pair } : s));
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [tf, pair, strategyId, strategy]);

  const [replayOn, setReplayOn] = useState(false);
  const [replayPopOpen, setReplayPopOpen] = useState(false);
  const [replayLoading, setReplayLoading] = useState(false);
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [historyMin, setHistoryMin] = useState("");
  const [historyMax, setHistoryMax] = useState("");
  const [historyCount, setHistoryCount] = useState(0);
  const [historyStartUnix, setHistoryStartUnix] = useState<number | null>(null);
  const [serverHasMore, setServerHasMore] = useState(false);

  const loadingOlderRef = useRef(false);
  const candlesRef = useRef<Candle[]>([]);
  const tfRef = useRef(tf);
  candlesRef.current = candles;
  tfRef.current = tf;

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
    setHistoryStartUnix(null);
    setServerHasMore(false);
    loadingOlderRef.current = false;

    fetchCandles(tf, { limit: INITIAL_BARS })
      .then((res) => {
        if (cancelled) return;
        setCandles(res.candles);
        setServerHasMore(Boolean(res.has_more));
        if (typeof res.total_available === "number" && res.total_available > 0) {
          setHistoryCount(res.total_available);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setCandles([]);
          setError(String(err.message || err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    fetchRange(tf)
      .then((range) => {
        if (cancelled) return;
        if (range.start_unix != null) {
          setHistoryMin(unixToLocalInput(range.start_unix));
          setHistoryStartUnix(range.start_unix);
        }
        if (range.end_unix != null) setHistoryMax(unixToLocalInput(range.end_unix));
        if (range.count) setHistoryCount(range.count);
      })
      .catch(() => {});

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
    return candles.slice(0, end + 1);
  }, [replayOn, candles, playhead, fromIdx, endIdx]);

  const canLoadOlder =
    !replayOn &&
    !loading &&
    candles.length > 0 &&
    candles.length < CLIENT_MAX_BARS &&
    (serverHasMore ||
      (historyStartUnix != null && candles[0].time > historyStartUnix));

  const loadOlderBars = useCallback(async () => {
    if (replayOn || loadingOlderRef.current) return;
    const current = candlesRef.current;
    if (!current.length) return;
    if (historyStartUnix != null && current[0].time <= historyStartUnix) return;
    if (current.length >= CLIENT_MAX_BARS) return;

    loadingOlderRef.current = true;
    const beforeIso = new Date(current[0].time * 1000).toISOString();
    const requestTf = tfRef.current;
    try {
      const res = await fetchCandles(requestTf, {
        before: beforeIso,
        limit: OLDER_CHUNK,
      });
      if (!res.candles.length) {
        setServerHasMore(false);
        return;
      }
      if (requestTf !== tfRef.current) return;
      setCandles((prev) => {
        if (!prev.length) return prev;
        if (prev[0].time !== current[0].time) return prev;
        const cutoff = prev[0].time;
        const older = res.candles.filter((c) => c.time < cutoff);
        if (!older.length) return prev;
        return older.concat(prev);
      });
      setServerHasMore(Boolean(res.has_more));
      if (typeof res.total_available === "number" && res.total_available > 0) {
        setHistoryCount(res.total_available);
      }
    } catch {
      /* retry on next pan */
    } finally {
      loadingOlderRef.current = false;
    }
  }, [replayOn, historyStartUnix]);

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

  const reloadRecentChart = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchCandles(tf, { limit: INITIAL_BARS });
      setCandles(res.candles);
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setLoading(false);
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
      if (!res.candles.length) throw new Error("No candles in that period");
      const fromI =
        res.replay_from_index ?? indexAtOrAfter(res.candles, localInputToUnix(from));
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
    setPlayhead((i) => Math.min(endIdx, Math.max(fromIdx, i + dir)));
  };

  const openReplayPop = (open: boolean) => {
    if (open && !fromInput && !toInput) {
      const d = defaultFromTo;
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

  const chartBusy = loading || replayLoading || strategyLoading;
  const chartBusyMsg = strategyLoading
    ? "Loading strategy…"
    : replayLoading
      ? "Loading replay period…"
      : "Loading…";

  const progressLabel =
    replayOn && candles[playhead]
      ? `${formatBarClock(candles[playhead].time)} · bar ${playhead - fromIdx + 1}/${endIdx - fromIdx + 1}`
      : "";

  const onSaveAsStrategy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !saveAsName.trim()) return;
    setSaveAsBusy(true);
    setError(null);
    try {
      const row = await createStrategy({
        userId: user.id,
        name: saveAsName.trim(),
        pair,
        tf,
      });
      await saveDrawings(row.id, user.id, drawings);
      setSaveAsOpen(false);
      setSaveAsName("");
      setSearchParams({ strategyId: row.id });
      navigate(`/chart?strategyId=${row.id}`, { replace: true });
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setSaveAsBusy(false);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Link to="/strategies" className="brand-link" title="Back to strategies">
            <img src="/logo.png" alt="FinHubKh Logo" className="brand-logo" />
          </Link>
          <div className="brand-text">
            <strong>FINHUBKH</strong>
            {strategy ? (
              <span className="strategy-badge" title={strategy.name}>
                <strong>{strategy.name}</strong>
                <span
                  className={`save-dot ${
                    drawSaveState === "saving"
                      ? "saving"
                      : drawSaveState === "saved"
                        ? "saved"
                        : drawSaveState === "error"
                          ? "error"
                          : ""
                  }`}
                  title={
                    drawSaveState === "saving"
                      ? "Saving drawings…"
                      : drawSaveState === "saved"
                        ? "Drawings saved"
                        : drawSaveState === "error"
                          ? "Save failed"
                          : "Ready"
                  }
                />
              </span>
            ) : (
              <span className="strategy-badge">Scratch chart</span>
            )}
          </div>
        </div>

        <div className="topbar-center">
          <PairDropdown value={pair} onChange={setPair} />
          <div
            style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }}
          />
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
          <Link className="fh-btn subtle" to="/strategies" title="Strategies">
            Strategies
          </Link>
          {strategyId ? (
            <button
              type="button"
              className={`fh-btn ${backtestOpen ? "primary" : "subtle"}`}
              title="Backtest"
              onClick={() => setBacktestOpen((v) => !v)}
            >
              Backtest
            </button>
          ) : drawings.length > 0 ? (
            <button
              type="button"
              className="fh-btn subtle"
              title="Save drawings as a strategy"
              onClick={() => {
                setSaveAsName("");
                setSaveAsOpen(true);
              }}
            >
              Save as strategy
            </button>
          ) : null}
          <IndicatorPanel active={activeIndicators} onToggle={toggleIndicator} />
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
              colorScheme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
            aria-label={
              colorScheme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
            onClick={() => setColorScheme((s) => (s === "dark" ? "light" : "dark"))}
          >
            {colorScheme === "dark" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="theme-toggle"
            title="Settings"
            aria-label="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
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
          {error && <div className="top-meta error">{error}</div>}
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
            canLoadOlder={canLoadOlder}
            onNeedOlderBars={loadOlderBars}
            settings={settings}
          />
          {strategyId && user && (
            <BacktestPanel
              open={backtestOpen}
              onClose={() => setBacktestOpen(false)}
              strategyId={strategyId}
              userId={user.id}
              tf={tf}
              defaultEngine={strategy?.engine}
              defaultParams={strategy?.engine_params}
              fromInput={fromInput || defaultFromTo.from}
              toInput={toInput || defaultFromTo.to}
            />
          )}
        </div>
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={setSettings}
      />

      {saveAsOpen && (
        <div
          className="fh-modal-backdrop"
          role="presentation"
          onClick={() => setSaveAsOpen(false)}
        >
          <div
            className="fh-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="fh-modal-head">
              <h2>Save as strategy</h2>
            </div>
            <form className="fh-form" onSubmit={(e) => void onSaveAsStrategy(e)}>
              <label>
                <span>Name</span>
                <input
                  value={saveAsName}
                  onChange={(e) => setSaveAsName(e.target.value)}
                  placeholder="My workspace"
                  required
                  autoFocus
                />
              </label>
              <div className="fh-modal-actions">
                <button type="button" className="fh-btn" onClick={() => setSaveAsOpen(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="fh-btn primary"
                  disabled={saveAsBusy || !saveAsName.trim()}
                >
                  {saveAsBusy ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
