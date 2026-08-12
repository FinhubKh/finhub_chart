import { useEffect, useRef } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { Candle } from "../api";
import { pointToScreen, screenToPoint, timeForCrosshair } from "../lib/coords";
import {
  applyEdit,
  cursorForHandle,
  hitTestDrawing,
  type Handle,
  type Hit,
} from "../lib/drawingEdit";
import {
  DEFAULT_POSITION_WIDTH,
  FIB_EXT_LEVELS,
  FIB_LEVELS,
  isNavTool,
  positionWidthLogical,
  type Drawing,
  type Point,
  type ToolId,
  uid,
} from "../lib/drawings";

type Props = {
  chart: IChartApi | null;
  series: ISeriesApi<"Candlestick"> | null;
  candles: Candle[];
  tool: ToolId;
  drawings: Drawing[];
  onChange: (next: Drawing[] | ((prev: Drawing[]) => Drawing[])) => void;
  color: string;
  magnet: boolean;
  stayInDraw: boolean;
  locked: boolean;
  hidden: boolean;
  onTool: (t: ToolId) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

type Session =
  | {
      /** Click A → rubber-band follows cursor → click B */
      mode: "anchor";
      tool: ToolId;
      a: Point;
      pointerId: number;
    }
  | {
      mode: "brush";
      points: Point[];
      startX: number;
      startY: number;
    }
  | {
      /** TV Long/Short: click entry → SL follows cursor, TP = 2R → click to place */
      mode: "position";
      tool: "long" | "short";
      entry: Point;
      stop: number;
      take: number;
      pointerId: number;
    }
  | {
      mode: "path";
      points: Point[];
    }
  | {
      /** Drag an existing drawing (handles or whole body) */
      mode: "edit";
      id: string;
      handle: Handle;
      startPtr: Point;
      original: Drawing;
      pointerId: number;
    }
  | null;

const DEFAULT_RR = 2;

const TWO_POINT: ToolId[] = [
  "trend",
  "ray",
  "extended",
  "info_line",
  "measure",
  "price_range",
  "date_range",
  "arrow_mark",
  "rect",
  "ellipse",
  "triangle",
  "fib",
  "fib_ext",
];

function hexAlpha(color: string, a: number) {
  if (color.startsWith("#") && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  return `rgba(41,98,255,${a})`;
}

function distPx(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(ax - bx, ay - by);
}

export default function DrawingOverlay({
  chart,
  series,
  candles,
  tool,
  drawings,
  onChange,
  color,
  magnet,
  stayInDraw,
  locked,
  hidden,
  onTool,
  selectedId,
  onSelect,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<Session>(null);
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const selectedIdRef = useRef<string | null>(selectedId);
  const onSelectRef = useRef(onSelect);
  const drawingsRef = useRef(drawings);
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const magnetRef = useRef(magnet);
  const stayRef = useRef(stayInDraw);
  const lockedRef = useRef(locked);
  const hiddenRef = useRef(hidden);
  const candlesRef = useRef(candles);
  const chartRef = useRef(chart);
  const seriesRef = useRef(series);
  const paintLatest = useRef(() => {});
  const schedulePaintRef = useRef(() => {});

  drawingsRef.current = drawings;
  toolRef.current = tool;
  colorRef.current = color;
  magnetRef.current = magnet;
  stayRef.current = stayInDraw;
  lockedRef.current = locked;
  hiddenRef.current = hidden;
  candlesRef.current = candles;
  chartRef.current = chart;
  seriesRef.current = series;
  selectedIdRef.current = selectedId;
  onSelectRef.current = onSelect;

  const selectDrawing = (id: string | null) => {
    selectedIdRef.current = id;
    onSelectRef.current(id);
    schedulePaintRef.current();
  };

  // Drop selection if drawing was removed
  useEffect(() => {
    if (selectedId && !drawings.some((d) => d.id === selectedId)) {
      onSelect(null);
    }
  }, [drawings, selectedId, onSelect]);

  const finishOrStay = () => {
    if (!stayRef.current && !isNavTool(toolRef.current) && toolRef.current !== "eraser") {
      onTool("cursor");
    }
  };

  const toPoint = (x: number, y: number, useMagnet = magnetRef.current) => {
    const c = chartRef.current;
    const s = seriesRef.current;
    if (!c || !s) return null;
    return screenToPoint(c, s, candlesRef.current, x, y, useMagnet);
  };

  const toXY = (p: Point) => {
    const c = chartRef.current;
    const s = seriesRef.current;
    if (!c || !s) return null;
    return pointToScreen(c, s, candlesRef.current, p);
  };

  const findHit = (x: number, y: number): Hit | null => {
    const canvas = canvasRef.current;
    const s = seriesRef.current;
    if (!canvas || !s) return null;
    return hitTestDrawing(
      drawingsRef.current,
      x,
      y,
      toXY,
      (price) => s.priceToCoordinate(price),
      canvas.clientWidth || canvas.width
    );
  };

  /** Cursor/pan: pass events through unless over a drawing or actively editing. */
  const syncPointerMode = (x?: number, y?: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (lockedRef.current) {
      canvas.classList.remove("interactive");
      canvas.classList.add("passthrough");
      canvas.style.cursor = "";
      return;
    }
    const sess = sessionRef.current;
    const editing = sess?.mode === "edit";
    const drawingTool = !isNavTool(toolRef.current);
    let over = false;
    let hit: Hit | null = null;
    if (x != null && y != null) {
      hit = findHit(x, y);
      over = !!hit;
    }
    // Keep capturing while any session runs; otherwise only when over a drawing
    // so empty-chart pan/zoom still reaches Lightweight Charts.
    const active = drawingTool || sess != null || over;
    canvas.classList.toggle("interactive", active);
    canvas.classList.toggle("passthrough", !active);
    if (editing && sess?.mode === "edit") {
      canvas.style.cursor = cursorForHandle(sess.handle);
    } else if (hit) {
      canvas.style.cursor = cursorForHandle(hit.handle);
    } else if (drawingTool) {
      canvas.style.cursor = "crosshair";
    } else {
      canvas.style.cursor = "";
    }
  };

  const drawHandle = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color = "#007c90"
  ) => {
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.25;
    ctx.stroke();
  };

  const paintSelectionHandles = (
    ctx: CanvasRenderingContext2D,
    d: Drawing,
    w: number
  ) => {
    const s = seriesRef.current;
    if (!s) return;

    if (d.type === "long" || d.type === "short") {
      const entry = toXY(d.entry);
      const stopY = s.priceToCoordinate(d.stop);
      const takeY = s.priceToCoordinate(d.take);
      if (!entry || stopY == null || takeY == null) return;
      const end = toXY({
        logical: d.entry.logical + positionWidthLogical(d),
        price: d.entry.price,
      });
      const x0 = Math.min(entry.x, end?.x ?? entry.x + 80);
      const x1 = Math.max(entry.x, end?.x ?? entry.x + 80);
      const midX = (x0 + x1) / 2;
      const midY = (Math.min(entry.y, stopY, takeY) + Math.max(entry.y, stopY, takeY)) / 2;
      drawHandle(ctx, midX, entry.y, "#007c90");
      drawHandle(ctx, midX, stopY, "#f23645");
      drawHandle(ctx, midX, takeY, "#089981");
      // Right-edge width handle
      drawHandle(ctx, x1, midY, "#007c90");
      return;
    }

    if (d.type === "hline" || d.type === "hray") {
      const y = s.priceToCoordinate(d.price);
      if (y == null) return;
      drawHandle(ctx, w * 0.5, y, d.color);
      return;
    }

    if (d.type === "vline" || d.type === "cross_line") {
      const xy = toXY({
        logical: d.logical,
        price: d.price ?? candlesRef.current.at(-1)?.close ?? 0,
      });
      if (!xy) return;
      drawHandle(ctx, xy.x, xy.y, d.color);
      return;
    }

    if (d.type === "text" || d.type === "callout" || d.type === "price_label") {
      const p = toXY(d.at);
      if (p) drawHandle(ctx, p.x, p.y, d.color);
      return;
    }

    if ("a" in d && "b" in d) {
      const pa = toXY(d.a);
      const pb = toXY(d.b);
      if (pa) drawHandle(ctx, pa.x, pa.y, d.color);
      if (pb) drawHandle(ctx, pb.x, pb.y, d.color);
    }
  };

  const paint = () => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    const c = chartRef.current;
    const s = seriesRef.current;
    if (!canvas || !parent || !c || !s) return;

    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w < 2 || h < 2) return;

    const dpr = window.devicePixelRatio || 1;
    const pw = Math.floor(w * dpr);
    const ph = Math.floor(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const g = ctx;
    const seriesApi = s;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (hiddenRef.current) return;

    const strokeLine = (
      a: Point,
      b: Point,
      stroke: string,
      width = 1.6,
      dash?: number[]
    ) => {
      const pa = toXY(a);
      const pb = toXY(b);
      if (!pa || !pb) return null;
      ctx.beginPath();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.setLineDash(dash || []);
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
      ctx.setLineDash([]);
      return { pa, pb };
    };

    const extendLine = (a: Point, b: Point, stroke: string, mode: "ray" | "extended") => {
      const pa = toXY(a);
      const pb = toXY(b);
      if (!pa || !pb) return;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;
      let x1 = pa.x;
      let y1 = pa.y;
      let x2 = pb.x;
      let y2 = pb.y;
      if (Math.abs(dx) >= Math.abs(dy)) {
        const tR = (w + 80 - pa.x) / (dx || 0.0001);
        const tL = (-80 - pa.x) / (dx || 0.0001);
        if (mode === "ray") {
          const t = dx >= 0 ? Math.max(tR, 1) : Math.min(tL, 1);
          x2 = pa.x + dx * t;
          y2 = pa.y + dy * t;
        } else {
          x1 = pa.x + dx * tL;
          y1 = pa.y + dy * tL;
          x2 = pa.x + dx * tR;
          y2 = pa.y + dy * tR;
        }
      } else {
        const tB = (h + 80 - pa.y) / (dy || 0.0001);
        const tT = (-80 - pa.y) / (dy || 0.0001);
        if (mode === "ray") {
          const t = dy >= 0 ? Math.max(tB, 1) : Math.min(tT, 1);
          x2 = pa.x + dx * t;
          y2 = pa.y + dy * t;
        } else {
          x1 = pa.x + dx * tT;
          y1 = pa.y + dy * tT;
          x2 = pa.x + dx * tB;
          y2 = pa.y + dy * tB;
        }
      }
      ctx.beginPath();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.6;
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };

    const drawOne = (d: Drawing) => {
      if (
        d.type === "trend" ||
        d.type === "measure" ||
        d.type === "info_line" ||
        d.type === "price_range" ||
        d.type === "date_range" ||
        d.type === "arrow_mark"
      ) {
        const pts = strokeLine(
          d.a,
          d.b,
          d.color,
          1.6,
          d.type === "measure" ? [5, 4] : undefined
        );
        if (!pts) return;
        if (d.type === "arrow_mark") {
          const ang = Math.atan2(pts.pb.y - pts.pa.y, pts.pb.x - pts.pa.x);
          ctx.beginPath();
          ctx.fillStyle = d.color;
          ctx.moveTo(pts.pb.x, pts.pb.y);
          ctx.lineTo(
            pts.pb.x - 10 * Math.cos(ang - 0.4),
            pts.pb.y - 10 * Math.sin(ang - 0.4)
          );
          ctx.lineTo(
            pts.pb.x - 10 * Math.cos(ang + 0.4),
            pts.pb.y - 10 * Math.sin(ang + 0.4)
          );
          ctx.closePath();
          ctx.fill();
        }
        if (
          d.type === "measure" ||
          d.type === "info_line" ||
          d.type === "price_range" ||
          d.type === "date_range"
        ) {
          const midX = (pts.pa.x + pts.pb.x) / 2;
          const midY = (pts.pa.y + pts.pb.y) / 2;
          const priceDiff = d.b.price - d.a.price;
          const pct = d.a.price ? (priceDiff / d.a.price) * 100 : 0;
          ctx.fillStyle = "rgba(19,23,34,0.92)";
          ctx.fillRect(midX - 58, midY - 30, 116, 40);
          ctx.strokeStyle = "#363a45";
          ctx.strokeRect(midX - 58, midY - 30, 116, 40);
          ctx.fillStyle = "#d1d4dc";
          ctx.font = "11px Trebuchet MS, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(
            `${priceDiff >= 0 ? "+" : ""}${priceDiff.toFixed(2)} (${pct.toFixed(2)}%)`,
            midX,
            midY - 10
          );
            ctx.fillText(
              `${Math.abs(d.b.logical - d.a.logical).toFixed(1)} bars`,
              midX,
              midY + 8
            );
          ctx.textAlign = "start";
        }
      } else if (d.type === "ray") {
        extendLine(d.a, d.b, d.color, "ray");
      } else if (d.type === "extended") {
        extendLine(d.a, d.b, d.color, "extended");
      } else if (d.type === "hline" || d.type === "hray") {
          const y = s.priceToCoordinate(d.price);
          if (y == null) return;
          let x0 = 0;
          if (d.type === "hray" && d.logical != null) {
            const xy = toXY({ logical: d.logical, price: d.price });
            if (xy) x0 = xy.x;
          }
          ctx.beginPath();
          ctx.strokeStyle = d.color;
          ctx.lineWidth = 1.4;
          ctx.setLineDash(d.type === "hline" ? [8, 5] : []);
          ctx.moveTo(x0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = d.color;
          ctx.font = "11px Trebuchet MS, sans-serif";
          ctx.fillText(d.label || d.price.toFixed(2), Math.max(8, x0 + 8), y - 4);
      } else if (d.type === "vline" || d.type === "cross_line") {
        const xy = toXY({
          logical: d.logical,
          price: d.price ?? candlesRef.current.at(-1)?.close ?? 0,
        });
        if (!xy) return;
        ctx.beginPath();
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.moveTo(xy.x, 0);
        ctx.lineTo(xy.x, h);
        ctx.stroke();
        if (d.type === "cross_line" && d.price != null) {
          const y = s.priceToCoordinate(d.price);
          if (y != null) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
          }
        }
        ctx.setLineDash([]);
      } else if (d.type === "rect" || d.type === "ellipse" || d.type === "triangle") {
        const pa = toXY(d.a);
        const pb = toXY(d.b);
        if (!pa || !pb) return;
        ctx.fillStyle = hexAlpha(d.color, 0.12);
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 1.3;
        if (d.type === "rect") {
          const x = Math.min(pa.x, pb.x);
          const y = Math.min(pa.y, pb.y);
          const rw = Math.abs(pb.x - pa.x);
          const rh = Math.abs(pb.y - pa.y);
          ctx.fillRect(x, y, rw, rh);
          ctx.strokeRect(x, y, rw, rh);
        } else if (d.type === "ellipse") {
          const cx = (pa.x + pb.x) / 2;
          const cy = (pa.y + pb.y) / 2;
          const rx = Math.max(1, Math.abs(pb.x - pa.x) / 2);
          const ry = Math.max(1, Math.abs(pb.y - pa.y) / 2);
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          const midX = (pa.x + pb.x) / 2;
          ctx.beginPath();
          ctx.moveTo(midX, Math.min(pa.y, pb.y));
          ctx.lineTo(Math.max(pa.x, pb.x), Math.max(pa.y, pb.y));
          ctx.lineTo(Math.min(pa.x, pb.x), Math.max(pa.y, pb.y));
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      } else if (d.type === "fib" || d.type === "fib_ext") {
        const pa = toXY(d.a);
        const pb = toXY(d.b);
        if (!pa || !pb) return;
        
        // Draw dashed diagonal trend line connecting the two anchor points
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = hexAlpha(d.color, 0.6);
        ctx.lineWidth = 1;
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
        ctx.setLineDash([]); // reset dash

        const levels = d.type === "fib" ? FIB_LEVELS : FIB_EXT_LEVELS;
        const left = Math.min(pa.x, pb.x);
        const right = Math.max(pa.x, pb.x);
        for (const lvl of levels) {
          const y = pa.y + (pb.y - pa.y) * lvl;
          const price = d.a.price + (d.b.price - d.a.price) * lvl;
          
          // Draw horizontal level line
          ctx.beginPath();
          ctx.strokeStyle = hexAlpha(d.color, 0.9);
          ctx.lineWidth = 1;
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
          ctx.stroke();

          // Draw label: "0.236 (4,404.050)" placed to the left of the horizontal line
          ctx.fillStyle = d.color;
          ctx.font = "12px Trebuchet MS, sans-serif";
          ctx.textAlign = "right";
          ctx.textBaseline = "middle";
          const lvlStr = lvl.toFixed(3).replace(/\.?0+$/, '');
          const priceStr = price.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
          ctx.fillText(`${lvlStr} (${priceStr})`, left - 6, y);
        }
        
        // Restore defaults for other drawings
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
      } else if (d.type === "path" || d.type === "brush") {
        if (d.points.length < 2) return;
        ctx.beginPath();
        ctx.strokeStyle = d.color;
        ctx.lineWidth = d.type === "brush" ? 2.4 : 1.6;
        let started = false;
        for (const pt of d.points) {
          const xy = toXY(pt);
          if (!xy) continue;
          if (!started) {
            ctx.moveTo(xy.x, xy.y);
            started = true;
          } else ctx.lineTo(xy.x, xy.y);
        }
        if (started) ctx.stroke();
      } else if (d.type === "long" || d.type === "short") {
        drawPosition(d);
      } else if (d.type === "text" || d.type === "callout" || d.type === "price_label") {
        const p = toXY(d.at);
        if (!p) return;
        if (d.type === "callout") {
          const tw = Math.max(60, d.text.length * 7);
          ctx.fillStyle = "rgba(19,23,34,0.92)";
          ctx.strokeStyle = d.color;
          ctx.fillRect(p.x, p.y - 22, tw, 28);
          ctx.strokeRect(p.x, p.y - 22, tw, 28);
          ctx.fillStyle = d.color;
          ctx.font = "13px Trebuchet MS, sans-serif";
          ctx.fillText(d.text, p.x + 8, p.y);
        } else if (d.type === "price_label") {
          ctx.fillStyle = d.color;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + 10, p.y - 8);
          ctx.lineTo(p.x + 70, p.y - 8);
          ctx.lineTo(p.x + 70, p.y + 8);
          ctx.lineTo(p.x + 10, p.y + 8);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.font = "11px Trebuchet MS, sans-serif";
          ctx.fillText(d.text, p.x + 14, p.y + 4);
        } else {
          ctx.fillStyle = d.color;
          ctx.font = "13px Trebuchet MS, sans-serif";
          ctx.fillText(d.text, p.x, p.y);
        }
      }
    };

    function drawPosition(d: {
      type: "long" | "short";
      entry: Point;
      stop: number;
      take: number;
      widthLogical?: number;
    }) {
      const entry = toXY(d.entry);
      const stopY = seriesApi.priceToCoordinate(d.stop);
      const takeY = seriesApi.priceToCoordinate(d.take);
      if (!entry || stopY == null || takeY == null) return;
      const end = toXY({
        logical: d.entry.logical + positionWidthLogical(d),
        price: d.entry.price,
      });
      const x0 = Math.min(entry.x, end?.x ?? entry.x + 80);
      const x1 = Math.max(entry.x, end?.x ?? entry.x + 80);
      const boxW = Math.max(4, x1 - x0);
      const riskTop = Math.min(entry.y, stopY);
      const riskH = Math.abs(stopY - entry.y);
      const rewardTop = Math.min(entry.y, takeY);
      const rewardH = Math.abs(takeY - entry.y);

      g.fillStyle = "rgba(242,54,69,0.22)";
      g.fillRect(x0, riskTop, boxW, riskH || 1);
      g.fillStyle = "rgba(8,153,129,0.22)";
      g.fillRect(x0, rewardTop, boxW, rewardH || 1);

      g.setLineDash([5, 3]);
      g.lineWidth = 1.5;
      g.strokeStyle = "#f23645";
      g.beginPath();
      g.moveTo(x0, stopY);
      g.lineTo(x1, stopY);
      g.stroke();
      g.strokeStyle = "#089981";
      g.beginPath();
      g.moveTo(x0, takeY);
      g.lineTo(x1, takeY);
      g.stroke();
      g.setLineDash([]);
      g.strokeStyle = "#007c90";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x0, entry.y);
      g.lineTo(x1, entry.y);
      g.stroke();

      const risk = Math.abs(d.entry.price - d.stop);
      const reward = Math.abs(d.take - d.entry.price);
      const rr = risk > 0 ? reward / risk : 0;
      const tag = d.type === "long" ? "LONG" : "SHORT";
      const tagColor = d.type === "long" ? "#089981" : "#f23645";

      g.fillStyle = tagColor;
      g.fillRect(x0, Math.min(riskTop, rewardTop) - 22, 52, 18);
      g.fillStyle = "#fff";
      g.font = "bold 11px Trebuchet MS, sans-serif";
      g.fillText(tag, x0 + 8, Math.min(riskTop, rewardTop) - 9);

      g.fillStyle = "#d1d4dc";
      g.font = "11px Trebuchet MS, sans-serif";
      g.fillText(
        `E ${d.entry.price.toFixed(2)}   SL ${d.stop.toFixed(2)}   TP ${d.take.toFixed(2)}   R:R ${rr.toFixed(2)}`,
        x0 + 58,
        Math.min(riskTop, rewardTop) - 9
      );

      g.font = "10px Trebuchet MS, sans-serif";
      g.fillStyle = "#089981";
      g.fillText("TP", x1 + 4, takeY + 3);
      g.fillStyle = "#007c90";
      g.fillText("Entry", x1 + 4, entry.y + 3);
      g.fillStyle = "#f23645";
      g.fillText("SL", x1 + 4, stopY + 3);
    }

    for (const d of drawingsRef.current) drawOne(d);

    const selected = drawingsRef.current.find((d) => d.id === selectedIdRef.current);
    if (selected) paintSelectionHandles(ctx, selected, w);

    // live preview
    const sess = sessionRef.current;
    const hover = hoverRef.current;

    // Live preview for two-point tools — match the active tool (not always a trendline)
    if (sess?.mode === "anchor" && hover) {
      const draftB = toPoint(hover.x, hover.y, false);
      if (draftB) {
        drawOne({
          id: "draft",
          type: sess.tool as Drawing["type"],
          a: sess.a,
          b: draftB,
          color: colorRef.current,
        } as Drawing);

        const pa = toXY(sess.a);
        if (pa) {
          for (const pt of [pa, { x: hover.x, y: hover.y }]) {
            ctx.beginPath();
            ctx.fillStyle = colorRef.current;
            ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 1.25;
            ctx.stroke();
          }
        }
      }
    } else if (sess?.mode === "brush" && sess.points.length > 1) {
      drawOne({
        id: "draft",
        type: "brush",
        points: sess.points,
        color: colorRef.current,
      });
    } else if (sess?.mode === "position") {
      drawPosition({
        type: sess.tool,
        entry: sess.entry,
        stop: sess.stop,
        take: sess.take,
        widthLogical: DEFAULT_POSITION_WIDTH,
      });
      const ey = toXY(sess.entry);
      if (ey) {
        ctx.fillStyle = "#d1d4dc";
        ctx.font = "12px Trebuchet MS, sans-serif";
        ctx.fillText(
          "Move to set Stop Loss · click to place",
          ey.x + 8,
          ey.y + 24
        );
      }
    } else if (sess?.mode === "path") {
      const pts = [...sess.points];
      // Rubber-band to cursor
      if (hover) {
        const tip = toPoint(hover.x, hover.y, false);
        if (tip) pts.push(tip);
      }
      if (pts.length >= 2) {
        drawOne({
          id: "draft",
          type: "path",
          points: pts,
          color: colorRef.current,
        });
      } else if (pts.length === 1) {
        const a = toXY(pts[0]);
        if (a) {
          ctx.beginPath();
          ctx.fillStyle = colorRef.current;
          ctx.arc(a.x, a.y, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.25;
          ctx.stroke();
        }
      }
      // Hint
      const last = pts[pts.length - 1];
      const lastXY = last ? toXY(last) : null;
      if (lastXY) {
        ctx.fillStyle = "#d1d4dc";
        ctx.font = "12px Trebuchet MS, sans-serif";
        ctx.fillText("Click to add · double-click or Enter to finish", lastXY.x + 8, lastXY.y - 10);
      }
    }
  };

  paintLatest.current = paint;

  // Paint on demand (pan/zoom/pointer/data) — not a perpetual RAF loop
  useEffect(() => {
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

    return () => {
      if (raf) cancelAnimationFrame(raf);
      chart?.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
    };
  }, [chart, series]);

  useEffect(() => {
    schedulePaintRef.current();
  }, [drawings, hidden, candles, tool]);

  // Window-level move so we can "wake" the overlay when hovering a drawing
  // even while pointer-events is none (passthrough for chart pan).
  useEffect(() => {
    const onMove = (ev: PointerEvent) => {
      if (sessionRef.current) return;
      if (!isNavTool(toolRef.current) || lockedRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
        syncPointerMode();
        return;
      }
      syncPointerMode(x, y);
      schedulePaintRef.current();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Empty chart click (passthrough) clears selection
  useEffect(() => {
    if (!chart) return;
    const onClick = () => {
      if (sessionRef.current) return;
      if (!isNavTool(toolRef.current)) return;
      selectDrawing(null);
    };
    chart.subscribeClick(onClick);
    return () => {
      chart.unsubscribeClick(onClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart]);

  // Delete / Backspace removes the selected drawing only
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (lockedRef.current) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      // Don't steal Backspace while drawing a path (Escape cancels path)
      if (sessionRef.current?.mode === "path") return;
      const id = selectedIdRef.current;
      if (!id) return;
      e.preventDefault();
      onChange((prev) => prev.filter((d) => d.id !== id));
      selectDrawing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange]);

  useEffect(() => {
    sessionRef.current = null;
    hoverRef.current = null;
    syncPointerMode();
  }, [tool]);

  const localXY = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const beginEdit = (hit: Hit, p: Point, pointerId: number, target: HTMLElement) => {
    const original = drawingsRef.current[hit.index];
    if (!original) return;
    selectDrawing(hit.id);
    try {
      target.setPointerCapture(pointerId);
    } catch {
      /* ignore */
    }
    sessionRef.current = {
      mode: "edit",
      id: hit.id,
      handle: hit.handle,
      startPtr: p,
      original: structuredClone(original),
      pointerId,
    };
    syncPointerMode();
    schedulePaintRef.current();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!chartRef.current || !seriesRef.current || lockedRef.current) return;
    const { x, y } = localXY(e);
    const toolNow = toolRef.current;

    const hit = findHit(x, y);

    // Cursor tools: select + drag existing drawings
    if (isNavTool(toolNow)) {
      const p = toPoint(x, y, false);
      if (hit && p) {
        beginEdit(hit, p, e.pointerId, e.target as HTMLElement);
      } else {
        selectDrawing(null);
        syncPointerMode(x, y);
      }
      return;
    }

    // Respect magnet toggle — do NOT force-snap to bars
    const p = toPoint(x, y, magnetRef.current);
    if (!p) return;

    if (toolNow === "eraser") {
      if (hit) {
        onChange((prev) => prev.filter((d) => d.id !== hit.id));
        if (selectedIdRef.current === hit.id) selectDrawing(null);
        schedulePaintRef.current();
      }
      return;
    }

    if (toolNow === "hline") {
      onChange((prev) => [
        ...prev,
        {
          id: uid(),
          type: "hline",
          price: p.price,
          color: colorRef.current,
          label: p.price.toFixed(2),
        },
      ]);
      finishOrStay();
      return;
    }

    if (toolNow === "hray") {
      onChange((prev) => [
        ...prev,
        {
          id: uid(),
          type: "hray",
          price: p.price,
          logical: p.logical,
          color: colorRef.current,
          label: p.price.toFixed(2),
        },
      ]);
      finishOrStay();
      return;
    }

    if (toolNow === "vline") {
      onChange((prev) => [
        ...prev,
        {
          id: uid(),
          type: "vline",
          logical: p.logical,
          color: colorRef.current,
        },
      ]);
      finishOrStay();
      return;
    }

    if (toolNow === "cross_line") {
      onChange((prev) => [
        ...prev,
        {
          id: uid(),
          type: "cross_line",
          logical: p.logical,
          price: p.price,
          color: colorRef.current,
        },
      ]);
      finishOrStay();
      return;
    }

    if (toolNow === "text" || toolNow === "callout") {
      const text = window.prompt("Text", "Text");
      if (!text) return;
      onChange((prev) => [
        ...prev,
        {
          id: uid(),
          type: toolNow,
          at: p,
          text,
          color: colorRef.current,
        },
      ]);
      finishOrStay();
      return;
    }

    if (toolNow === "price_label") {
      onChange((prev) => [
        ...prev,
        {
          id: uid(),
          type: "price_label",
          at: p,
          text: p.price.toFixed(2),
          color: colorRef.current,
        },
      ]);
      finishOrStay();
      return;
    }

    if (toolNow === "path") {
      const sess = sessionRef.current;
      // pointerdown `detail` is unreliable for double-click finish — use onDoubleClick
      if (sess?.mode === "path") {
        // Ignore ultra-close duplicate clicks (same vertex)
        const last = sess.points[sess.points.length - 1];
        const lastXY = last ? toXY(last) : null;
        if (lastXY && distPx(x, y, lastXY.x, lastXY.y) < 4) {
          schedulePaintRef.current();
          return;
        }
        sessionRef.current = {
          mode: "path",
          points: [...sess.points, p],
        };
      } else {
        sessionRef.current = { mode: "path", points: [p] };
      }
      schedulePaintRef.current();
      return;
    }

    // TradingView Long / Short Position
    if (toolNow === "long" || toolNow === "short") {
      const sess = sessionRef.current;
      if (sess?.mode === "position" && sess.tool === toolNow) {
        const position: Drawing = {
          id: uid(),
          type: toolNow,
          entry: sess.entry,
          stop: sess.stop,
          take: sess.take,
          widthLogical: DEFAULT_POSITION_WIDTH,
        };
        onChange((prev) => [...prev, position]);
        selectDrawing(position.id);
        sessionRef.current = null;
        try {
          (e.target as HTMLElement).releasePointerCapture(sess.pointerId);
        } catch {
          /* ignore */
        }
        finishOrStay();
        return;
      }

      // First click = entry. Default SL ~0.35%, TP at 2R (follows mouse after).
      const risk = Math.max(p.price * 0.0035, 0.5);
      const stop = toolNow === "long" ? p.price - risk : p.price + risk;
      const take =
        toolNow === "long"
          ? p.price + risk * DEFAULT_RR
          : p.price - risk * DEFAULT_RR;
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* ignore — still allow click→move→click without capture */
      }
      sessionRef.current = {
        mode: "position",
        tool: toolNow,
        entry: p,
        stop,
        take,
        pointerId: e.pointerId,
      };
      return;
    }

    // Trend / fib / rect — click A, rubber-band follows cursor, click B
    if (TWO_POINT.includes(toolNow)) {
      const sess = sessionRef.current;
      if (sess?.mode === "anchor" && sess.tool === toolNow) {
        // Use sess.tool so the saved type matches what the user started drawing
        const drawing = {
          id: uid(),
          type: sess.tool,
          a: sess.a,
          b: p,
          color: colorRef.current,
        } as Drawing;
        onChange((prev) => [...prev, drawing]);
        selectDrawing(drawing.id);
        sessionRef.current = null;
        try {
          (e.target as HTMLElement).releasePointerCapture(sess.pointerId);
        } catch {
          /* ignore */
        }
        finishOrStay();
      } else {
        try {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        sessionRef.current = {
          mode: "anchor",
          tool: toolNow,
          a: p,
          pointerId: e.pointerId,
        };
      }
      return;
    }

    if (toolNow === "brush") {
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      sessionRef.current = {
        mode: "brush",
        points: [p],
        startX: x,
        startY: y,
      };
    }
  };

  const syncChartCrosshair = (x: number, y: number) => {
    const c = chartRef.current;
    const s = seriesRef.current;
    if (!c || !s) return;
    // Free-follow cursor (no magnet) for crosshair sync
    const p = screenToPoint(c, s, candlesRef.current, x, y, false);
    if (!p) {
      c.clearCrosshairPosition();
      return;
    }
    const t = timeForCrosshair(candlesRef.current, p);
    if (t == null) {
      c.clearCrosshairPosition();
      return;
    }
    c.setCrosshairPosition(p.price, t, s);
  };

  const updatePositionFromCursor = (price: number, tool: "long" | "short", entry: Point) => {
    // SL follows cursor on the risk side; TP locks to DEFAULT_RR
    let stop = price;
    if (tool === "long") {
      // SL must be below entry
      if (stop >= entry.price) stop = entry.price - Math.max(entry.price * 0.001, 0.5);
      const risk = entry.price - stop;
      return { stop, take: entry.price + risk * DEFAULT_RR };
    }
    // short — SL must be above entry
    if (stop <= entry.price) stop = entry.price + Math.max(entry.price * 0.001, 0.5);
    const risk = stop - entry.price;
    return { stop, take: entry.price - risk * DEFAULT_RR };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y } = localXY(e);
    hoverRef.current = { x, y };

    // Overlay sits on top of the chart — keep LWC crosshair glued to the cursor
    syncChartCrosshair(x, y);

    const sess = sessionRef.current;

    if (sess?.mode === "edit") {
      const p = toPoint(x, y, magnetRef.current);
      if (!p) return;
      const next = applyEdit(sess.original, sess.handle, sess.startPtr, p);
      onChange((prev) => prev.map((d) => (d.id === sess.id ? next : d)));
      syncPointerMode(x, y);
      schedulePaintRef.current();
      return;
    }

    if (!sess) {
      syncPointerMode(x, y);
      schedulePaintRef.current();
      return;
    }

    if (sess.mode === "position") {
      const p = toPoint(x, y, false);
      if (!p) return;
      const { stop, take } = updatePositionFromCursor(p.price, sess.tool, sess.entry);
      sessionRef.current = { ...sess, stop, take };
      schedulePaintRef.current();
      return;
    }

    if (sess.mode === "anchor" || sess.mode === "path") {
      schedulePaintRef.current();
      return;
    }

    if (sess.mode !== "brush") return;

    const p = toPoint(x, y, false);
    if (!p) return;
    const last = sess.points[sess.points.length - 1];
    const lastXY = last ? toXY(last) : null;
    if (!lastXY || distPx(x, y, lastXY.x, lastXY.y) > 2) {
      sess.points = [...sess.points, p];
      sessionRef.current = { ...sess };
    }
    schedulePaintRef.current();
  };

  const finishPathRef = useRef(() => {});
  finishPathRef.current = () => {
    const sess = sessionRef.current;
    if (!sess || sess.mode !== "path") return;
    if (sess.points.length >= 2) {
      const drawing: Drawing = {
        id: uid(),
        type: "path",
        points: sess.points,
        color: colorRef.current,
      };
      onChange((prev) => [...prev, drawing]);
      selectDrawing(drawing.id);
    }
    sessionRef.current = null;
    finishOrStay();
    schedulePaintRef.current();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const sess = sessionRef.current;
    if (sess?.mode === "edit") {
      try {
        (e.target as HTMLElement).releasePointerCapture(sess.pointerId);
      } catch {
        /* ignore */
      }
      sessionRef.current = null;
      const { x, y } = localXY(e);
      syncPointerMode(x, y);
      schedulePaintRef.current();
      return;
    }

    if (!sess || sess.mode !== "brush") return;

    if (sess.points.length >= 2) {
      onChange((prev) => [
        ...prev,
        {
          id: uid(),
          type: "brush",
          points: sess.points,
          color: colorRef.current,
        },
      ]);
      finishOrStay();
    }
    sessionRef.current = null;
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (toolRef.current !== "path") return;
    // Drop the accidental extra vertex from the second click of the double-click
    const sess = sessionRef.current;
    if (sess?.mode === "path" && sess.points.length >= 2) {
      const { x, y } = localXY(e);
      const last = sess.points[sess.points.length - 1];
      const lastXY = last ? toXY(last) : null;
      if (lastXY && distPx(x, y, lastXY.x, lastXY.y) < 16) {
        sessionRef.current = {
          mode: "path",
          points: sess.points.slice(0, -1),
        };
      }
    }
    finishPathRef.current();
  };

  // Enter finishes path; Escape cancels
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (toolRef.current !== "path") return;
      const sess = sessionRef.current;
      if (!sess || sess.mode !== "path") return;
      if (e.key === "Enter") {
        e.preventDefault();
        finishPathRef.current();
      } else if (e.key === "Escape") {
        e.preventDefault();
        sessionRef.current = null;
        schedulePaintRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const interactive = (!isNavTool(tool) || !!selectedIdRef.current) && !locked;

  return (
    <canvas
      ref={canvasRef}
      className={`draw-overlay ${interactive ? "interactive" : "passthrough"}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      onPointerCancel={() => {
        sessionRef.current = null;
      }}
      onPointerLeave={() => {
        // Keep rubber-band / edit alive while a session is active
        if (!sessionRef.current) {
          hoverRef.current = null;
          chartRef.current?.clearCrosshairPosition();
          syncPointerMode();
        }
      }}
    />
  );
}
