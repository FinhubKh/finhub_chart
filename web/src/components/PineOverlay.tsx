import { useEffect, useRef } from "react";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import type { PineFill, PineShape } from "../lib/pine";

type Props = {
  chart: IChartApi | null;
  series: ISeriesApi<"Candlestick"> | null;
  fills: PineFill[];
  shapes: PineShape[];
};

type PackedFill = {
  color: string;
  times: number[];
  va: number[];
  vb: number[];
};

function lowerBoundTimes(times: number[], t: number) {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function lowerBoundShapes(shapes: PineShape[], t: number) {
  let lo = 0;
  let hi = shapes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (shapes[mid].time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function packFills(fills: PineFill[]): PackedFill[] {
  return fills.map((fill) => {
    const bMap = new Map(fill.b.map((p) => [p.time, p.value]));
    const times: number[] = [];
    const va: number[] = [];
    const vb: number[] = [];
    for (const p of fill.a) {
      const b = bMap.get(p.time);
      if (b == null) continue;
      times.push(p.time);
      va.push(p.value);
      vb.push(b);
    }
    return { color: fill.color, times, va, vb };
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export default function PineOverlay({ chart, series, fills, shapes }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const packedRef = useRef<PackedFill[]>([]);
  const shapesRef = useRef<PineShape[]>(shapes);
  const paintLatest = useRef(() => {});
  const scheduleRef = useRef(() => {});

  useEffect(() => {
    packedRef.current = packFills(fills);
    shapesRef.current = shapes;
    scheduleRef.current();
  }, [fills, shapes]);

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

      const ts = chart.timeScale();
      const fromT = ts.coordinateToTime(-80);
      const toT = ts.coordinateToTime(w + 80);
      const tMin =
        fromT == null || toT == null
          ? -Infinity
          : Math.min(fromT as number, toT as number);
      const tMax =
        fromT == null || toT == null
          ? Infinity
          : Math.max(fromT as number, toT as number);

      for (const fill of packedRef.current) {
        const { times, va, vb } = fill;
        if (times.length < 2) continue;
        const i0 = tMin === -Infinity ? 0 : Math.max(0, lowerBoundTimes(times, tMin) - 1);
        const i1 =
          tMax === Infinity
            ? times.length
            : Math.min(times.length, lowerBoundTimes(times, tMax) + 1);
        if (i1 - i0 < 2) continue;
        const step = Math.max(1, Math.ceil((i1 - i0) / Math.max(240, w)));
        const xs: number[] = [];
        const y1s: number[] = [];
        const y2s: number[] = [];
        for (let i = i0; i < i1; i += step) {
          const x = ts.timeToCoordinate(times[i] as UTCTimestamp);
          const y1 = series.priceToCoordinate(va[i]);
          const y2 = series.priceToCoordinate(vb[i]);
          if (x == null || y1 == null || y2 == null) continue;
          xs.push(x);
          y1s.push(y1);
          y2s.push(y2);
        }
        if (xs.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(xs[0], y1s[0]);
        for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i], y1s[i]);
        for (let i = xs.length - 1; i >= 0; i--) ctx.lineTo(xs[i], y2s[i]);
        ctx.closePath();
        ctx.fillStyle = fill.color;
        ctx.fill();
      }

      const labels = shapesRef.current;
      if (!labels.length) return;
      const i0 = tMin === -Infinity ? 0 : lowerBoundShapes(labels, tMin);
      const i1 = tMax === Infinity ? labels.length : lowerBoundShapes(labels, tMax);
      const visible = Math.max(0, i1 - i0);
      const step = Math.max(1, Math.ceil(visible / 80));
      ctx.font = '700 10px "IBM Plex Sans", "Segoe UI", sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let i = i0; i < i1; i += step) {
        const s = labels[i];
        const x = ts.timeToCoordinate(s.time as UTCTimestamp);
        const y = series.priceToCoordinate(s.price);
        if (x == null || y == null) continue;
        const text = s.text || (s.position === "aboveBar" ? "SELL" : "BUY");
        const tw = ctx.measureText(text).width;
        const bw = tw + 12;
        const bh = 16;
        const bx = x - bw / 2;
        const by = s.position === "aboveBar" ? y - 10 - bh : y + 10;
        roundRect(ctx, bx, by, bw, bh, 3);
        ctx.fillStyle = s.color;
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillText(text, x, by + bh / 2 + 0.5);
      }
    };

    paintLatest.current = paint;
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        paintLatest.current();
      });
    };
    scheduleRef.current = schedule;
    schedule();

    chart?.timeScale().subscribeVisibleLogicalRangeChange(schedule);
    window.addEventListener("resize", schedule);
    const ro = new ResizeObserver(schedule);
    if (canvasRef.current?.parentElement) ro.observe(canvasRef.current.parentElement);

    return () => {
      try {
        chart?.timeScale().unsubscribeVisibleLogicalRangeChange(schedule);
      } catch {
        /* ignore */
      }
      window.removeEventListener("resize", schedule);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [chart, series]);

  return <canvas className="pine-overlay" ref={canvasRef} aria-hidden />;
}
