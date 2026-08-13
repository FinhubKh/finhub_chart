import { useEffect, useRef } from "react";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import type { Candle } from "../lib/api";
import {
  calcMarketStructure,
  type StructureSegment,
} from "../lib/indicators";

type Props = {
  chart: IChartApi | null;
  series: ISeriesApi<"Candlestick"> | null;
  candles: Candle[];
  enabled: boolean;
};

/** LuxAlgo default structure colors */
const BULL = "#089981";
const BEAR = "#F23645";

function colorFor(seg: StructureSegment) {
  return seg.bias === "bull" ? BULL : BEAR;
}

/**
 * Canvas overlay: LuxAlgo SMC BOS / CHoCH lines.
 * Recomputes on the full loaded candle window so pan-left history keeps labels.
 * Only paints segments that intersect the current viewport.
 */
export default function StructureOverlay({
  chart,
  series,
  candles,
  enabled,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const segmentsRef = useRef<StructureSegment[]>([]);
  const calcGenRef = useRef(0);
  const paintLatest = useRef(() => {});
  const schedulePaintRef = useRef(() => {});

  useEffect(() => {
    if (!enabled || !candles.length) {
      calcGenRef.current += 1;
      segmentsRef.current = [];
      schedulePaintRef.current();
      return;
    }

    const gen = ++calcGenRef.current;
    // Defer heavy calc so scroll/pan stays responsive; always use latest candles
    const handle = window.setTimeout(() => {
      if (gen !== calcGenRef.current) return;
      segmentsRef.current = calcMarketStructure(candles);
      schedulePaintRef.current();
    }, 0);

    return () => window.clearTimeout(handle);
  }, [candles, enabled]);

  useEffect(() => {
    const paint = () => {
      const canvas = canvasRef.current;
      if (!canvas || !chart || !series) return;
      const parent = canvas.parentElement;
      if (!parent) return;

      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (w <= 0 || h <= 0) return;

      const dpr = window.devicePixelRatio || 1;
      if (
        canvas.width !== Math.floor(w * dpr) ||
        canvas.height !== Math.floor(h * dpr)
      ) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      if (!enabled) return;

      const ts = chart.timeScale();
      const logical = ts.getVisibleLogicalRange();
      // Rough time window for culling (with padding)
      let tMin = -Infinity;
      let tMax = Infinity;
      if (logical) {
        const fromT = ts.coordinateToTime(0);
        const toT = ts.coordinateToTime(w);
        if (fromT != null && toT != null) {
          const a = fromT as number;
          const b = toT as number;
          tMin = Math.min(a, b);
          tMax = Math.max(a, b);
        }
      }

      for (const seg of segmentsRef.current) {
        // Skip segments fully outside the visible time span
        if (seg.endTime < tMin || seg.startTime > tMax) continue;

        const x1 = ts.timeToCoordinate(seg.startTime as UTCTimestamp);
        const x2 = ts.timeToCoordinate(seg.endTime as UTCTimestamp);
        const y = series.priceToCoordinate(seg.price);
        if (x1 == null || x2 == null || y == null) continue;

        const left = Math.min(x1, x2);
        const right = Math.max(x1, x2);
        if (right < -20 || left > w + 20 || y < -20 || y > h + 20) continue;

        const color = colorFor(seg);
        const isSwing = seg.level === "swing";
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = isSwing ? 1.5 : 1;
        ctx.setLineDash(isSwing ? [] : [4, 3]);
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        ctx.setLineDash([]);

        const label = seg.label;
        const fontSize = isSwing ? 11 : 9;
        ctx.font = `600 ${fontSize}px "IBM Plex Sans", "Segoe UI", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        const tw = ctx.measureText(label).width;
        const midX = (left + right) / 2;
        const ly = seg.bias === "bull" ? y - 4 : y + fontSize + 2;
        let lx = midX;
        if (lx - tw / 2 < left) lx = left + tw / 2;
        if (lx + tw / 2 > right) lx = right - tw / 2;

        ctx.lineWidth = 2.5;
        ctx.strokeStyle = "rgba(255,255,255,0.92)";
        ctx.lineJoin = "round";
        ctx.strokeText(label, lx, ly);
        ctx.fillStyle = color;
        ctx.fillText(label, lx, ly);
        ctx.restore();
      }
    };

    paintLatest.current = paint;

    let raf = 0;
    const schedulePaint = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        paintLatest.current();
      });
    };
    schedulePaintRef.current = schedulePaint;
    schedulePaint();

    const onRange = () => schedulePaint();
    chart?.timeScale().subscribeVisibleLogicalRangeChange(onRange);

    const ro = new ResizeObserver(() => schedulePaint());
    if (canvasRef.current?.parentElement) {
      ro.observe(canvasRef.current.parentElement);
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      try {
        chart?.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      } catch {
        /* ignore */
      }
      ro.disconnect();
    };
  }, [chart, series, enabled]);

  useEffect(() => {
    schedulePaintRef.current();
  }, [candles, enabled]);

  return (
    <canvas ref={canvasRef} className="structure-overlay" aria-hidden />
  );
}
