import { useEffect, useRef, useState } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "../api";
import {
  calcBbma,
  calcBollinger,
  calcEma,
  calcMacd,
  calcRsi,
  calcSma,
  calcVwap,
  type IndicatorId,
} from "../lib/indicators";
import StructureOverlay from "./StructureOverlay";
import { isNavTool, type Drawing, type ToolId } from "../lib/drawings";
import {
  chartThemeOptions,
  isCompactChartUi,
  type ColorScheme,
} from "../lib/theme";
import type { ChartSettings } from "../lib/settings";

/** Bars visible on first paint for phone — fitContent on 4k+ bars is unusable. */
const MOBILE_VISIBLE_BARS = 120;
import DrawingOverlay from "./DrawingOverlay";

type Props = {
  candles: Candle[];
  tool: ToolId;
  color: string;
  drawings: Drawing[];
  onDrawingsChange: (d: Drawing[] | ((prev: Drawing[]) => Drawing[])) => void;
  onTool: (t: ToolId) => void;
  activeIndicators: Set<IndicatorId>;
  magnet: boolean;
  stayInDraw: boolean;
  locked: boolean;
  hidden: boolean;
  /** When true, growing series follows the latest bar (bar replay). */
  followLatest?: boolean;
  selectedId: string | null;
  onSelectDrawing: (id: string | null) => void;
  colorScheme: ColorScheme;
  /** True when older history exists beyond the leftmost loaded bar. */
  canLoadOlder?: boolean;
  /** Called when the user pans near the left edge — parent should prepend bars. */
  onNeedOlderBars?: () => void;
  settings: ChartSettings;
};

type LineSeries = ISeriesApi<"Line">;
type HistSeries = ISeriesApi<"Histogram">;

export default function ChartPane({
  candles,
  tool,
  color,
  drawings,
  onDrawingsChange,
  onTool,
  activeIndicators,
  magnet,
  stayInDraw,
  locked,
  hidden,
  followLatest = false,
  selectedId,
  onSelectDrawing,
  colorScheme,
  canLoadOlder = false,
  onNeedOlderBars,
  settings,
}: Props) {
  const mainRef = useRef<HTMLDivElement>(null);
  const rsiRef = useRef<HTMLDivElement>(null);
  const macdRef = useRef<HTMLDivElement>(null);

  const mainChart = useRef<IChartApi | null>(null);
  const rsiChart = useRef<IChartApi | null>(null);
  const macdChart = useRef<IChartApi | null>(null);

  const candleSeries = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeries = useRef<ISeriesApi<"Histogram"> | null>(null);
  const overlaySeries = useRef<Map<string, LineSeries>>(new Map());

  const rsiSeries = useRef<LineSeries | null>(null);
  const macdLine = useRef<LineSeries | null>(null);
  const macdSignal = useRef<LineSeries | null>(null);
  const macdHist = useRef<HistSeries | null>(null);

  const [chartApi, setChartApi] = useState<IChartApi | null>(null);
  const [seriesApi, setSeriesApi] = useState<ISeriesApi<"Candlestick"> | null>(
    null
  );
  const prevCandleCount = useRef(0);
  const prevFirstTime = useRef<number | null>(null);
  const followDetached = useRef(false);
  const applyingFollow = useRef(false);

  const showRsi = activeIndicators.has("rsi");
  const showMacd = activeIndicators.has("macd");

  useEffect(() => {
    if (!mainRef.current) return;

    const m = createChart(mainRef.current, {
      ...chartThemeOptions(colorScheme, settings, isCompactChartUi()),
      width: mainRef.current.clientWidth,
      height: mainRef.current.clientHeight,
    });
    const c = m.addCandlestickSeries({
      upColor: settings.upColor,
      downColor: settings.downColor,
      borderVisible: false,
      wickUpColor: settings.upColor,
      wickDownColor: settings.downColor,
    });

    mainChart.current = m;
    candleSeries.current = c;
    volumeSeries.current = null;
    setChartApi(m);
    setSeriesApi(c);

    const syncSize = () => {
      if (mainRef.current && mainChart.current) {
        const { clientWidth: w, clientHeight: h } = mainRef.current;
        if (w > 0 && h > 0) {
          mainChart.current.applyOptions({ width: w, height: h });
        }
      }
      if (rsiRef.current && rsiChart.current) {
        rsiChart.current.applyOptions({
          width: rsiRef.current.clientWidth,
          height: rsiRef.current.clientHeight,
        });
      }
      if (macdRef.current && macdChart.current) {
        macdChart.current.applyOptions({
          width: macdRef.current.clientWidth,
          height: macdRef.current.clientHeight,
        });
      }
    };
    const ro = new ResizeObserver(syncSize);
    ro.observe(mainRef.current);
    window.addEventListener("resize", syncSize);
    // next frame — grid layout may not have final size on mount
    requestAnimationFrame(syncSize);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", syncSize);
      for (const s of overlaySeries.current.values()) {
        try {
          m.removeSeries(s);
        } catch {
          /* ignore */
        }
      }
      overlaySeries.current.clear();
      m.remove();
      mainChart.current = null;
      candleSeries.current = null;
      volumeSeries.current = null;
      setChartApi(null);
      setSeriesApi(null);
    };
    // Mount once — theme updates via applyOptions below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep chart chrome in sync with light/dark / compact without remounting
  useEffect(() => {
    const apply = () => {
      const opts = chartThemeOptions(colorScheme, settings, isCompactChartUi());
      mainChart.current?.applyOptions(opts);
      rsiChart.current?.applyOptions(opts);
      macdChart.current?.applyOptions(opts);
      candleSeries.current?.applyOptions({
        upColor: settings.upColor,
        downColor: settings.downColor,
        wickUpColor: settings.upColor,
        wickDownColor: settings.downColor,
      });
    };
    apply();
    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = () => apply();
    mq.addEventListener?.("change", onChange);
    window.addEventListener("orientationchange", onChange);
    return () => {
      mq.removeEventListener?.("change", onChange);
      window.removeEventListener("orientationchange", onChange);
    };
  }, [colorScheme, settings]);

  useEffect(() => {
    if (!showRsi) {
      if (rsiChart.current) {
        rsiChart.current.remove();
        rsiChart.current = null;
        rsiSeries.current = null;
      }
      return;
    }
    if (!rsiRef.current || rsiChart.current) return;
    const chart = createChart(rsiRef.current, {
      ...chartThemeOptions(colorScheme, settings, isCompactChartUi()),
      width: rsiRef.current.clientWidth,
      height: rsiRef.current.clientHeight,
    });
    const series = chart.addLineSeries({
      color: "#c084fc",
      lineWidth: 2,
      priceLineVisible: false,
    });
    chart.priceScale("right").applyOptions({
      scaleMargins: { top: 0.1, bottom: 0.1 },
    });
    rsiChart.current = chart;
    rsiSeries.current = series;
    return () => {
      chart.remove();
      rsiChart.current = null;
      rsiSeries.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRsi]);

  useEffect(() => {
    if (!showMacd) {
      if (macdChart.current) {
        macdChart.current.remove();
        macdChart.current = null;
        macdLine.current = null;
        macdSignal.current = null;
        macdHist.current = null;
      }
      return;
    }
    if (!macdRef.current || macdChart.current) return;
    const chart = createChart(macdRef.current, {
      ...chartThemeOptions(colorScheme, settings, isCompactChartUi()),
      width: macdRef.current.clientWidth,
      height: macdRef.current.clientHeight,
    });
    const hist = chart.addHistogramSeries({ priceLineVisible: false });
    const line = chart.addLineSeries({
      color: "#60a5fa",
      lineWidth: 2,
      priceLineVisible: false,
    });
    const signal = chart.addLineSeries({
      color: "#f59e0b",
      lineWidth: 2,
      priceLineVisible: false,
    });
    macdChart.current = chart;
    macdHist.current = hist;
    macdLine.current = line;
    macdSignal.current = signal;
    return () => {
      chart.remove();
      macdChart.current = null;
      macdLine.current = null;
      macdSignal.current = null;
      macdHist.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMacd]);

  // Sync time scales (subscribe once per pane layout; always unsubscribe)
  useEffect(() => {
    const main = mainChart.current;
    if (!main) return;

    const handlers: Array<{
      source: IChartApi;
      fn: (range: { from: number; to: number } | null) => void;
    }> = [];

    const sync = (source: IChartApi, targets: (IChartApi | null)[]) => {
      const fn = (range: { from: number; to: number } | null) => {
        if (!range) return;
        for (const t of targets) {
          t?.timeScale().setVisibleLogicalRange(range);
        }
      };
      source.timeScale().subscribeVisibleLogicalRangeChange(fn);
      handlers.push({ source, fn });
    };

    sync(main, [rsiChart.current, macdChart.current]);
    if (rsiChart.current) sync(rsiChart.current, [main, macdChart.current]);
    if (macdChart.current) sync(macdChart.current, [main, rsiChart.current]);

    return () => {
      for (const { source, fn } of handlers) {
        try {
          source.timeScale().unsubscribeVisibleLogicalRangeChange(fn);
        } catch {
          /* chart may already be removed */
        }
      }
    };
  }, [showRsi, showMacd, chartApi]);

  const ensureLine = (
    key: string,
    opts: {
      color: string;
      lineWidth?: number;
      lastValueVisible?: boolean;
      lineStyle?: number;
    }
  ) => {
    if (!mainChart.current) return null;
    let s = overlaySeries.current.get(key);
    if (!s) {
      s = mainChart.current.addLineSeries({
        color: opts.color,
        lineWidth: (opts.lineWidth ?? 2) as 1 | 2 | 3 | 4,
        priceLineVisible: false,
        lastValueVisible: opts.lastValueVisible ?? false,
        lineStyle: opts.lineStyle,
      });
      overlaySeries.current.set(key, s);
    }
    return s;
  };

  const removeLine = (key: string) => {
    const s = overlaySeries.current.get(key);
    if (s && mainChart.current) {
      mainChart.current.removeSeries(s);
      overlaySeries.current.delete(key);
    }
  };

  // If the user pans/zooms while replay is auto-following, let them take over
  useEffect(() => {
    const main = mainChart.current;
    if (!main || !followLatest) {
      followDetached.current = false;
      return;
    }
    followDetached.current = false;
    const onRange = () => {
      if (applyingFollow.current) return;
      followDetached.current = true;
    };
    main.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    return () => {
      try {
        main.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      } catch {
        /* ignore */
      }
    };
  }, [followLatest, chartApi]);

  // Lazy-load older history when the user pans near the left edge
  const canLoadOlderRef = useRef(canLoadOlder);
  const onNeedOlderRef = useRef(onNeedOlderBars);
  const userPannedRef = useRef(false);
  const lastRangeFromRef = useRef<number | null>(null);
  canLoadOlderRef.current = canLoadOlder;
  onNeedOlderRef.current = onNeedOlderBars;

  // Reset pan intent on a fresh series (TF change / reload), not on prepend
  const seriesOriginRef = useRef<number | null>(null);
  useEffect(() => {
    const first = candles[0]?.time ?? null;
    if (first == null) {
      userPannedRef.current = false;
      seriesOriginRef.current = null;
      lastRangeFromRef.current = null;
      return;
    }
    const prev = seriesOriginRef.current;
    if (prev != null && first < prev) {
      // History prepended — keep scroll-load intent
      seriesOriginRef.current = first;
      return;
    }
    if (prev !== first) {
      userPannedRef.current = false;
      seriesOriginRef.current = first;
      lastRangeFromRef.current = null;
    }
  }, [candles]);

  useEffect(() => {
    // Listen on the wrap so DrawingOverlay / canvas still count as user pan
    const el = mainRef.current?.parentElement ?? mainRef.current;
    if (!el) return;
    const mark = () => {
      userPannedRef.current = true;
    };
    el.addEventListener("wheel", mark, { passive: true });
    el.addEventListener("pointerdown", mark);
    el.addEventListener("touchstart", mark, { passive: true });
    return () => {
      el.removeEventListener("wheel", mark);
      el.removeEventListener("pointerdown", mark);
      el.removeEventListener("touchstart", mark);
    };
  }, [chartApi]);

  useEffect(() => {
    const main = mainChart.current;
    if (!main) return;

    let lastFire = 0;
    const maybeLoad = () => {
      if (!canLoadOlderRef.current || !onNeedOlderRef.current) return;
      const range = main.timeScale().getVisibleLogicalRange();
      if (!range) return;

      const prevFrom = lastRangeFromRef.current;
      if (prevFrom != null && range.from < prevFrom - 1) {
        // Visible window moved left → treat as user pan
        userPannedRef.current = true;
      }
      lastRangeFromRef.current = range.from;

      if (!userPannedRef.current) return;
      // Near left edge of loaded series (logical index ~0)
      if (range.from > 120) return;
      const now = Date.now();
      if (now - lastFire < 350) return;
      lastFire = now;
      onNeedOlderRef.current();
    };

    main.timeScale().subscribeVisibleLogicalRangeChange(maybeLoad);
    return () => {
      try {
        main.timeScale().unsubscribeVisibleLogicalRangeChange(maybeLoad);
      } catch {
        /* ignore */
      }
    };
  }, [chartApi]);

  // Keep chaining chunks while still parked on the left after a prepend
  useEffect(() => {
    if (!userPannedRef.current) return;
    if (!canLoadOlder || !onNeedOlderBars || !chartApi) return;
    const range = chartApi.timeScale().getVisibleLogicalRange();
    if (range && range.from <= 120) {
      onNeedOlderBars();
    }
  }, [candles.length, canLoadOlder, onNeedOlderBars, chartApi]);

  // Candles — fit on reset; preserve viewport on history prepend / replay steps
  useEffect(() => {
    if (!candleSeries.current) return;

    const prev = prevCandleCount.current;
    const next = candles.length;
    const firstTime = candles[0]?.time ?? null;
    const prevFirst = prevFirstTime.current;

    const prepended =
      prev > 0 &&
      next > prev &&
      firstTime != null &&
      prevFirst != null &&
      firstTime < prevFirst;
    const sameSeries =
      prev > 0 &&
      firstTime != null &&
      prevFirst != null &&
      firstTime === prevFirst;

    const range =
      prepended || sameSeries
        ? mainChart.current?.timeScale().getVisibleLogicalRange()
        : null;

    candleSeries.current.setData(
      candles.map((bar) => ({
        time: bar.time as UTCTimestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      }))
    );

    const shouldFollow =
      followLatest && sameSeries && next > 0 && !followDetached.current;

    if (shouldFollow) {
      const width = range ? Math.max(30, range.to - range.from) : 120;
      applyingFollow.current = true;
      mainChart.current?.timeScale().setVisibleLogicalRange({
        from: next - width,
        to: next + 2,
      });
      requestAnimationFrame(() => {
        applyingFollow.current = false;
      });
    } else if (prepended && range) {
      const shift = next - prev;
      mainChart.current?.timeScale().setVisibleLogicalRange({
        from: range.from + shift,
        to: range.to + shift,
      });
    } else if (sameSeries) {
      // Keep the user's pan/zoom — do not fitContent on replay step/pause
    } else if (next > 0) {
      if (isCompactChartUi()) {
        const width = Math.min(MOBILE_VISIBLE_BARS, next);
        mainChart.current?.timeScale().setVisibleLogicalRange({
          from: Math.max(-2, next - width),
          to: next + 2,
        });
      } else {
        mainChart.current?.timeScale().fitContent();
      }
    }

    prevCandleCount.current = next;
    prevFirstTime.current = firstTime;
  }, [candles, followLatest]);

  // Indicators — update series without resetting the viewport
  useEffect(() => {
    if (!candleSeries.current || !mainChart.current) return;

    // Volume as optional indicator (off by default)
    const showVolume = activeIndicators.has("volume");
    if (showVolume) {
      if (!volumeSeries.current) {
        const v = mainChart.current.addHistogramSeries({
          priceFormat: { type: "volume" },
          priceScaleId: "vol",
        });
        mainChart.current.priceScale("vol").applyOptions({
          scaleMargins: { top: 0.82, bottom: 0 },
        });
        volumeSeries.current = v;
      }
      volumeSeries.current.setData(
        candles.map((bar) => ({
          time: bar.time as UTCTimestamp,
          value: bar.volume,
          color:
            bar.close >= bar.open
              ? "rgba(8,153,129,0.45)"
              : "rgba(242,54,69,0.45)",
        }))
      );
    } else if (volumeSeries.current) {
      mainChart.current.removeSeries(volumeSeries.current);
      volumeSeries.current = null;
    }

    const setOverlay = (
      key: string,
      enabled: boolean,
      data: { time: number; value: number }[],
      lineColor: string,
      opts?: { lineWidth?: number; lastValueVisible?: boolean; lineStyle?: number }
    ) => {
      if (!enabled) {
        removeLine(key);
        return;
      }
      const s = ensureLine(key, {
        color: lineColor,
        lineWidth: opts?.lineWidth,
        lastValueVisible: opts?.lastValueVisible,
        lineStyle: opts?.lineStyle,
      });
      s?.setData(
        data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
      );
    };

    setOverlay("sma20", activeIndicators.has("sma20"), calcSma(candles, 20), "#fbbf24", {
      lastValueVisible: true,
    });
    setOverlay("sma50", activeIndicators.has("sma50"), calcSma(candles, 50), "#38bdf8", {
      lastValueVisible: true,
    });
    setOverlay(
      "sma200",
      activeIndicators.has("sma200"),
      calcSma(candles, 200),
      "#f472b6",
      { lastValueVisible: true }
    );
    setOverlay("ema21", activeIndicators.has("ema21"), calcEma(candles, 21), "#a78bfa", {
      lastValueVisible: true,
    });
    setOverlay("vwap", activeIndicators.has("vwap"), calcVwap(candles), "#34d399", {
      lastValueVisible: true,
    });

    if (activeIndicators.has("bbands") && !activeIndicators.has("bbma")) {
      const bb = calcBollinger(candles, 20, 2);
      setOverlay("bb_mid", true, bb.middle, "#94a3b8");
      setOverlay("bb_up", true, bb.upper, "#64748b");
      setOverlay("bb_lo", true, bb.lower, "#64748b");
    } else if (!activeIndicators.has("bbma")) {
      removeLine("bb_mid");
      removeLine("bb_up");
      removeLine("bb_lo");
    }

    // BBMA Oma Ally: BB + LWMA 5/10 High-Low + EMA 50
    if (activeIndicators.has("bbma")) {
      const pack = calcBbma(candles);
      setOverlay("bbma_bb_mid", true, pack.bbMiddle, "#94a3b8", { lineWidth: 1 });
      setOverlay("bbma_bb_up", true, pack.bbUpper, "#64748b", { lineWidth: 1 });
      setOverlay("bbma_bb_lo", true, pack.bbLower, "#64748b", { lineWidth: 1 });
      setOverlay("bbma_h5", true, pack.lwma5High, "#fb7185", { lineWidth: 2 });
      setOverlay("bbma_h10", true, pack.lwma10High, "#f43f5e", { lineWidth: 1 });
      setOverlay("bbma_l5", true, pack.lwma5Low, "#4ade80", { lineWidth: 2 });
      setOverlay("bbma_l10", true, pack.lwma10Low, "#22c55e", { lineWidth: 1 });
      setOverlay("bbma_ema50", true, pack.ema50, "#22d3ee", {
        lineWidth: 2,
        lastValueVisible: true,
      });
    } else {
      for (const key of [
        "bbma_bb_mid",
        "bbma_bb_up",
        "bbma_bb_lo",
        "bbma_h5",
        "bbma_h10",
        "bbma_l5",
        "bbma_l10",
        "bbma_ema50",
      ]) {
        removeLine(key);
      }
    }

    // Market structure drawn on StructureOverlay canvas (BOS / CHoCH lines)

    if (showRsi && rsiSeries.current) {
      rsiSeries.current.setData(
        calcRsi(candles, 14).map((p) => ({
          time: p.time as UTCTimestamp,
          value: p.value,
        }))
      );
    }

    if (showMacd && macdLine.current && macdSignal.current && macdHist.current) {
      const macd = calcMacd(candles);
      macdLine.current.setData(
        macd.macd.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
      );
      macdSignal.current.setData(
        macd.signal.map((p) => ({
          time: p.time as UTCTimestamp,
          value: p.value,
        }))
      );
      macdHist.current.setData(
        macd.histogram.map((p) => ({
          time: p.time as UTCTimestamp,
          value: p.value,
          color:
            p.value >= 0 ? "rgba(8,153,129,0.65)" : "rgba(242,54,69,0.65)",
        }))
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, activeIndicators, showRsi, showMacd]);

  useEffect(() => {
    const nav = isNavTool(tool);
    const scrollOn = nav && tool !== "crosshair";
    mainChart.current?.applyOptions({
      handleScroll: scrollOn
        ? {
            mouseWheel: true,
            pressedMouseMove: true,
            horzTouchDrag: true,
            vertTouchDrag: true,
          }
        : false,
      handleScale: nav
        ? {
            axisPressedMouseMove: true,
            axisDoubleClickReset: true,
            mouseWheel: true,
            pinch: true,
          }
        : false,
      crosshair: {
        // 0 Normal = follows cursor exactly; 1 Magnet snaps to OHLC; 2 Hidden
        mode: tool === "dot" ? 2 : magnet ? 1 : 0,
      },
    });
  }, [tool, magnet]);

  const paneClass = [
    "chart-stack",
    showRsi ? "with-rsi" : "",
    showMacd ? "with-macd" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={paneClass}>
      <div className="chart-main-wrap">
        <div className="chart-main" ref={mainRef} />
        <DrawingOverlay
          chart={chartApi}
          series={seriesApi}
          candles={candles}
          tool={tool}
          drawings={drawings}
          onChange={onDrawingsChange}
          color={color}
          magnet={magnet}
          stayInDraw={stayInDraw}
          locked={locked}
          hidden={hidden}
          onTool={onTool}
          selectedId={selectedId}
          onSelect={onSelectDrawing}
        />
        <StructureOverlay
          chart={chartApi}
          series={seriesApi}
          candles={candles}
          enabled={activeIndicators.has("structure")}
        />
      </div>
      {showRsi && (
        <div className="subpane">
          <div className="subpane-label">RSI 14</div>
          <div className="chart-sub" ref={rsiRef} />
        </div>
      )}
      {showMacd && (
        <div className="subpane">
          <div className="subpane-label">MACD</div>
          <div className="chart-sub" ref={macdRef} />
        </div>
      )}
    </div>
  );
}
