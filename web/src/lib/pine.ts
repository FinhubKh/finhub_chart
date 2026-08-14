import type { Candle } from "./api";

export type PinePoint = { time: number; value: number };

export type PinePlot = {
  id: string;
  title: string;
  color: string;
  lineWidth?: number;
  data: PinePoint[];
};

export type PineShape = {
  time: number;
  price: number;
  position: "aboveBar" | "belowBar";
  color: string;
  text: string;
  shape: "arrowUp" | "arrowDown" | "circle";
};

export type PineFill = {
  a: PinePoint[];
  b: PinePoint[];
  color: string;
};

export type PineCompileResult = {
  name: string;
  plots: PinePlot[];
  shapes: PineShape[];
  fills: PineFill[];
  error: string | null;
  warnings: string[];
};

export const DEFAULT_PINE_SOURCE = `//@version=5
indicator("SMA", overlay=true)
length = input.int(20, "Length")
plot(ta.sma(close, length), title="SMA", color=color.teal)
`;

const COLORS: Record<string, string> = {
  "color.blue": "#2962ff",
  "color.red": "#f23645",
  "color.green": "#089981",
  "color.teal": "#007c90",
  "color.orange": "#ff9800",
  "color.yellow": "#fbbf24",
  "color.purple": "#a78bfa",
  "color.white": "#d1d4dc",
  "color.gray": "#787b86",
  "color.grey": "#787b86",
  "color.black": "#131722",
  "color.aqua": "#26c6da",
  "color.lime": "#00e676",
  "color.navy": "#1565c0",
  "color.fuchsia": "#e040fb",
  "color.silver": "#b2b5be",
};

type Tok = { k: string; v: string };
type Val = number | number[] | string;

function tokenize(src: string): Tok[] {
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, "");
  const out: Tok[] = [];
  let i = 0;
  const isId = (c: string) => /[A-Za-z_]/.test(c);
  const isId2 = (c: string) => /[A-Za-z0-9_.]/.test(c);
  while (i < stripped.length) {
    const c = stripped[i];
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      out.push({ k: "nl", v: "\n" });
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      i++;
      let s = "";
      while (i < stripped.length && stripped[i] !== q) {
        if (stripped[i] === "\\") i++;
        s += stripped[i++];
      }
      i++;
      out.push({ k: "str", v: s });
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(stripped[i + 1] || ""))) {
      let s = "";
      while (i < stripped.length && /[0-9.]/.test(stripped[i])) s += stripped[i++];
      out.push({ k: "num", v: s });
      continue;
    }
    if (isId(c)) {
      let s = "";
      while (i < stripped.length && isId2(stripped[i])) s += stripped[i++];
      out.push({ k: "id", v: s });
      continue;
    }
    const two = stripped.slice(i, i + 2);
    if (["==", "!=", ">=", "<=", "=>", ":="].includes(two)) {
      out.push({ k: "op", v: two });
      i += 2;
      continue;
    }
    out.push({ k: "op", v: c });
    i++;
  }
  out.push({ k: "eof", v: "" });
  return out;
}

function sma(src: number[], len: number): number[] {
  const n = Math.max(1, Math.floor(len));
  const out = Array(src.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    sum += x;
    if (i >= n) sum -= src[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

function ema(src: number[], len: number): number[] {
  const n = Math.max(1, Math.floor(len));
  const out = Array(src.length).fill(NaN);
  const k = 2 / (n + 1);
  let prev: number | null = null;
  for (let i = 0; i < src.length; i++) {
    if (i < n - 1) continue;
    if (prev == null) {
      let s = 0;
      for (let j = i - n + 1; j <= i; j++) s += src[j];
      prev = s / n;
    } else {
      prev = src[i] * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

function rsi(src: number[], len: number): number[] {
  const n = Math.max(1, Math.floor(len));
  const out = Array(src.length).fill(NaN);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < src.length; i++) {
    const ch = src[i] - src[i - 1];
    const g = Math.max(ch, 0);
    const l = Math.max(-ch, 0);
    if (i <= n) {
      gain += g;
      loss += l;
      if (i === n) {
        gain /= n;
        loss /= n;
        const rs = loss === 0 ? 100 : gain / loss;
        out[i] = 100 - 100 / (1 + rs);
      }
    } else {
      gain = (gain * (n - 1) + g) / n;
      loss = (loss * (n - 1) + l) / n;
      const rs = loss === 0 ? 100 : gain / loss;
      out[i] = 100 - 100 / (1 + rs);
    }
  }
  return out;
}

function rolling(src: number[], len: number, pick: (w: number[]) => number): number[] {
  const n = Math.max(1, Math.floor(len));
  const out = Array(src.length).fill(NaN);
  for (let i = n - 1; i < src.length; i++) {
    out[i] = pick(src.slice(i - n + 1, i + 1));
  }
  return out;
}

function wma(src: number[], len: number): number[] {
  const n = Math.max(1, Math.floor(len));
  const out = Array(src.length).fill(NaN);
  const denom = (n * (n + 1)) / 2;
  for (let i = n - 1; i < src.length; i++) {
    let s = 0;
    for (let k = 0; k < n; k++) s += src[i - n + 1 + k] * (k + 1);
    out[i] = s / denom;
  }
  return out;
}

function stdev(src: number[], len: number, biased = true): number[] {
  const n = Math.max(1, Math.floor(len));
  const out = Array(src.length).fill(NaN);
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    sum += x;
    sumSq += x * x;
    if (i >= n) {
      const old = src[i - n];
      sum -= old;
      sumSq -= old * old;
    }
    if (i >= n - 1) {
      const mean = sum / n;
      const v = biased
        ? sumSq / n - mean * mean
        : (sumSq - (sum * sum) / n) / Math.max(1, n - 1);
      out[i] = Math.sqrt(Math.max(0, v));
    }
  }
  return out;
}

function asSeries(v: Val, n: number): number[] {
  if (typeof v === "string") return Array(n).fill(NaN);
  return Array.isArray(v) ? v : Array(n).fill(v);
}

function num(v: Val): number {
  if (typeof v === "string") return NaN;
  return Array.isArray(v) ? Number(v[v.length - 1]) : Number(v);
}

function bin(a: Val, b: Val, n: number, op: (x: number, y: number) => number): Val {
  if (!Array.isArray(a) && !Array.isArray(b)) return op(Number(a), Number(b));
  const A = asSeries(a, n);
  const B = asSeries(b, n);
  return A.map((x, i) => op(x, B[i]));
}

function historyRef(src: Val, offset: Val, n: number): number[] {
  const series = asSeries(src, n);
  const offs = asSeries(offset, n);
  const out = Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const k = Math.floor(Number(offs[i]));
    if (!Number.isFinite(k) || k < 0) continue;
    const j = i - k;
    if (j >= 0 && j < n) out[i] = series[j];
  }
  return out;
}

function crossover(a: Val, b: Val, n: number): number[] {
  const A = asSeries(a, n);
  const B = asSeries(b, n);
  const out = Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    if (A[i] > B[i] && A[i - 1] <= B[i - 1]) out[i] = 1;
  }
  return out;
}

function crossunder(a: Val, b: Val, n: number): number[] {
  const A = asSeries(a, n);
  const B = asSeries(b, n);
  const out = Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    if (A[i] < B[i] && A[i - 1] >= B[i - 1]) out[i] = 1;
  }
  return out;
}

function rma(src: number[], len: number): number[] {
  const n = Math.max(1, Math.floor(len));
  const out = Array(src.length).fill(NaN);
  let prev: number | null = null;
  for (let i = 0; i < src.length; i++) {
    if (i < n - 1) continue;
    if (prev == null) {
      let s = 0;
      for (let j = i - n + 1; j <= i; j++) s += src[j];
      prev = s / n;
    } else {
      prev = (prev * (n - 1) + src[i]) / n;
    }
    out[i] = prev;
  }
  return out;
}

function where(cond: Val, a: Val, b: Val, n: number): Val {
  const C = asSeries(cond, n);
  const A = asSeries(a, n);
  const B = asSeries(b, n);
  return C.map((c, i) => (c ? A[i] : B[i]));
}

function cmp(a: Val, b: Val, n: number, op: (x: number, y: number) => boolean): number[] {
  const A = asSeries(a, n);
  const B = asSeries(b, n);
  return A.map((x, i) => (op(x, B[i]) ? 1 : 0));
}

function parseColor(raw: string): string | null {
  const key = raw.trim();
  if (COLORS[key]) return COLORS[key];
  if (/^#[0-9a-fA-F]{6}$/.test(key)) return key;
  if (/^rgba?\(/i.test(key)) return key;
  return null;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return `rgba(0,124,144,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function resolveColor(v: Val | string | undefined, fallback: string): string {
  if (typeof v !== "string" || !v) return fallback;
  const parsed = parseColor(v);
  if (parsed) return parsed;
  if (/^rgba?\(/i.test(v)) return v;
  return fallback;
}

function colorNew(colorVal: Val, transp: Val): string {
  const raw = typeof colorVal === "string" ? colorVal : "";
  const hex = parseColor(raw) || "#007c90";
  const t = Number.isFinite(num(transp)) ? num(transp) : 0;
  const a = Math.max(0, Math.min(1, 1 - t / 100));
  if (a >= 0.999) return hex.startsWith("#") ? hex : hex;
  return hexToRgba(hex.startsWith("#") ? hex : parseColor(hex) || "#007c90", a);
}

function isBoolSeries(data: number[]): boolean {
  let seen = false;
  for (const v of data) {
    if (v == null || Number.isNaN(v)) continue;
    seen = true;
    if (v !== 0 && v !== 1) return false;
  }
  return seen;
}

function toPoints(candles: Candle[], series: number[]): PinePoint[] {
  const pts: PinePoint[] = [];
  for (let i = 0; i < candles.length; i++) {
    const v = series[i];
    if (v == null || Number.isNaN(v)) continue;
    pts.push({ time: candles[i].time, value: v });
  }
  return uniqueSortedPoints(pts);
}

function uniqueSortedPoints(pts: PinePoint[]): PinePoint[] {
  if (pts.length < 2) return pts;
  const byTime = new Map<number, number>();
  for (const p of pts) byTime.set(p.time, p.value);
  return Array.from(byTime, ([time, value]) => ({ time, value })).sort((a, b) => a.time - b.time);
}

export function uniqueSortedShapes(shapes: PineShape[]): PineShape[] {
  if (shapes.length < 2) return shapes;
  const byTime = new Map<number, PineShape>();
  for (const s of shapes) {
    const prev = byTime.get(s.time);
    if (!prev) {
      byTime.set(s.time, s);
      continue;
    }
    byTime.set(s.time, {
      ...s,
      text:
        prev.text && s.text && prev.text !== s.text
          ? `${prev.text} ${s.text}`
          : s.text || prev.text,
    });
  }
  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

class Parser {
  i = 0;
  warnings: string[] = [];
  lastTuple: Val[] | null = null;
  plotHandle = 0;
  plotIndex = 0;
  plotMap = new Map<number, { points: PinePoint[]; color: string }>();

  constructor(
    public toks: Tok[],
    public n: number,
    public env: Record<string, Val>,
    public candles: Candle[],
    public scriptId: string,
    public plots: PinePlot[],
    public shapes: PineShape[],
    public fills: PineFill[]
  ) {}

  peek() {
    return this.toks[this.i] || { k: "eof", v: "" };
  }
  eat(k?: string, v?: string) {
    const t = this.peek();
    if (k && t.k !== k) return null;
    if (v != null && t.v !== v) return null;
    this.i++;
    return t;
  }
  skipNl() {
    while (this.peek().k === "nl") this.i++;
  }

  parseArgs(): { pos: Val[]; named: Record<string, Val | string> } {
    const pos: Val[] = [];
    const named: Record<string, Val | string> = {};
    this.eat("op", "(");
    this.skipNl();
    if (this.peek().v === ")") {
      this.eat("op", ")");
      return { pos, named };
    }
    while (true) {
      this.skipNl();
      const id = this.peek();
      const next = this.toks[this.i + 1];
      if (id.k === "id" && next?.v === "=") {
        this.eat("id");
        this.eat("op", "=");
        this.skipNl();
        if (this.peek().k === "str") named[id.v] = this.eat("str")!.v;
        else if (
          this.peek().k === "id" &&
          this.peek().v.startsWith("color.") &&
          this.toks[this.i + 1]?.v !== "("
        ) {
          named[id.v] = this.eat("id")!.v;
        } else named[id.v] = this.parseExpr();
      } else {
        pos.push(this.parseExpr());
      }
      this.skipNl();
      if (this.eat("op", ",")) continue;
      break;
    }
    this.skipNl();
    this.eat("op", ")");
    return { pos, named };
  }

  addPlot(series: Val, named: Record<string, Val | string>, titleFallback: string): number {
    const data = asSeries(series, this.n);
    const handle = ++this.plotHandle;
    if (typeof named.display === "string" && named.display.includes("none")) {
      this.plotMap.set(handle, { points: [], color: "#000" });
      return handle;
    }
    if (isBoolSeries(data)) {
      this.plotMap.set(handle, { points: [], color: "#000" });
      return handle;
    }
    const color = resolveColor(named.color as Val, "#007c90");
    const title = typeof named.title === "string" ? named.title : titleFallback;
    const lw = Math.max(1, Math.min(4, Math.round(num((named.linewidth as Val) ?? 2))));
    this.plotIndex += 1;
    const id = `pine:${this.scriptId}:${this.plotIndex}`;
    const points = toPoints(this.candles, data);
    this.plots.push({ id, title, color, lineWidth: lw, data: points });
    this.plotMap.set(handle, { points, color });
    return handle;
  }

  addShape(cond: Val, named: Record<string, Val | string>): number {
    const C = asSeries(cond, this.n);
    const loc = String(named.location || "location.belowbar");
    const position: PineShape["position"] = loc.includes("above") ? "aboveBar" : "belowBar";
    const style = String(named.style || "");
    const shape: PineShape["shape"] =
      style.includes("down") || style.includes("labeldown") || style.includes("triangledown")
        ? "arrowDown"
        : style.includes("circle")
          ? "circle"
          : "arrowUp";
    const color = resolveColor(
      named.color as Val,
      position === "aboveBar" ? "#f23645" : "#089981"
    );
    const text = typeof named.text === "string" ? named.text : "";
    for (let i = 0; i < this.n; i++) {
      if (!C[i]) continue;
      this.shapes.push({
        time: this.candles[i].time,
        price: position === "aboveBar" ? this.candles[i].high : this.candles[i].low,
        position,
        color,
        text,
        shape,
      });
    }
    return 0;
  }

  addFill(a: Val, b: Val, named: Record<string, Val | string>): number {
    const pa = this.plotMap.get(num(a));
    const pb = this.plotMap.get(num(b));
    if (!pa?.points.length || !pb?.points.length) return 0;
    const color = resolveColor(named.color as Val, "rgba(120,123,134,0.12)");
    this.fills.push({ a: pa.points, b: pb.points, color });
    return 0;
  }

  parseCall(name: string): Val {
    const { pos, named } = this.parseArgs();
    const n = this.n;
    const arg0 = pos[0];
    const arg1 = pos[1];
    if (name === "input.int" || name === "input.float") return num(arg0 ?? 0);
    if (name === "input.bool") return num(arg0 ?? 1);
    if (name === "input.source") return asSeries(arg0 ?? this.env.close ?? 0, n);
    if (name === "input.string") return 0;
    if (name === "input.color") return typeof arg0 === "string" ? arg0 : "color.teal";
    if (name === "iff") return where(arg0 ?? 0, arg1 ?? 0, pos[2] ?? 0, n);
    if (name === "plot") return this.addPlot(arg0 ?? NaN, named, "Plot");
    if (name === "plotshape" || name === "plotchar" || name === "plotarrow") {
      return this.addShape(arg0 ?? 0, named);
    }
    if (name === "fill") return this.addFill(arg0 ?? 0, arg1 ?? 0, named);
    if (name === "color.new") return colorNew(arg0 ?? "color.teal", arg1 ?? 0);
    if (
      name === "table.new" ||
      name.startsWith("table.") ||
      name.startsWith("log.") ||
      name.startsWith("label.") ||
      name.startsWith("line.") ||
      name.startsWith("box.") ||
      name === "alert" ||
      name === "alertcondition" ||
      name === "bgcolor" ||
      name === "barcolor" ||
      name === "hline"
    ) {
      return 0;
    }
    if (name === "nz") {
      const a = asSeries(arg0 ?? 0, n);
      const b = asSeries(arg1 ?? 0, n);
      return a.map((x, i) => (Number.isNaN(x) ? b[i] : x));
    }
    if (name === "math.abs") {
      const a = asSeries(arg0 ?? 0, n);
      return a.map(Math.abs);
    }
    if (name === "math.max") return bin(arg0 ?? 0, arg1 ?? 0, n, Math.max);
    if (name === "math.min") return bin(arg0 ?? 0, arg1 ?? 0, n, Math.min);
    if (name === "stdev" || name === "ta.stdev") {
      const src = asSeries(arg0 ?? 0, n);
      return stdev(src, num(arg1 ?? 14), true);
    }
    if (name === "sma") return sma(asSeries(arg0 ?? 0, n), num(arg1 ?? 14));
    if (name === "ema") return ema(asSeries(arg0 ?? 0, n), num(arg1 ?? 14));
    if (name === "wma") return wma(asSeries(arg0 ?? 0, n), num(arg1 ?? 14));
    if (name === "rsi") return rsi(asSeries(arg0 ?? 0, n), num(arg1 ?? 14));
    if (name === "crossover") return crossover(arg0 ?? 0, arg1 ?? 0, n);
    if (name === "crossunder") return crossunder(arg0 ?? 0, arg1 ?? 0, n);
    if (name.startsWith("ta.")) {
      const src = asSeries(arg0 ?? 0, n);
      const len = num(arg1 ?? 14);
      if (name === "ta.vwap") {
        const tp = asSeries(arg0 ?? this.env.hlc3 ?? 0, n);
        const vol = asSeries(this.env.volume ?? 0, n);
        let pv = 0;
        let vv = 0;
        return tp.map((price, i) => {
          pv += price * vol[i];
          vv += vol[i];
          return vv ? pv / vv : NaN;
        });
      }
      if (name === "ta.sma") return sma(src, len);
      if (name === "ta.ema") return ema(src, len);
      if (name === "ta.wma") return wma(src, len);
      if (name === "ta.rma") return rma(src, len);
      if (name === "ta.rsi") return rsi(src, len);
      if (name === "ta.stdev") return stdev(src, len, true);
      if (name === "ta.bb") {
        const length = num(arg1 ?? 20);
        const mult = num(pos[2] ?? 2);
        const mid = sma(src, length);
        const sd = stdev(src, length, true);
        const upper = mid.map((m, i) => m + sd[i] * mult);
        const lower = mid.map((m, i) => m - sd[i] * mult);
        this.lastTuple = [mid, upper, lower];
        return mid;
      }
      if (name === "ta.highest") return rolling(src, len, (w) => Math.max(...w));
      if (name === "ta.lowest") return rolling(src, len, (w) => Math.min(...w));
      if (name === "ta.change") {
        const off = Math.max(1, Math.floor(num(arg1 ?? 1)));
        return src.map((x, i) => (i < off ? NaN : x - src[i - off]));
      }
      if (name === "ta.crossover") return crossover(arg0 ?? 0, arg1 ?? 0, n);
      if (name === "ta.crossunder") return crossunder(arg0 ?? 0, arg1 ?? 0, n);
      if (name === "ta.cross") {
        const up = crossover(arg0 ?? 0, arg1 ?? 0, n);
        const dn = crossunder(arg0 ?? 0, arg1 ?? 0, n);
        return up.map((x, i) => (x || dn[i] ? 1 : 0));
      }
      if (name === "ta.atr") {
        const high = asSeries(this.env.high ?? 0, n);
        const low = asSeries(this.env.low ?? 0, n);
        const close = asSeries(this.env.close ?? 0, n);
        const tr = high.map((h, i) => {
          if (i === 0) return h - low[i];
          return Math.max(h - low[i], Math.abs(h - close[i - 1]), Math.abs(low[i] - close[i - 1]));
        });
        return rma(tr, num(arg0 ?? 14));
      }
      if (name === "ta.vwap") {
        this.warnings.push("ta.vwap uses typical price in this subset");
        return sma(
          src.map((_, i) => {
            /* filled by caller env vwap if used as ta.vwap() with no src */
            return src[i];
          }),
          1
        );
      }
    }
    this.warnings.push(`Unsupported function ${name} — skipped`);
    void named;
    return Array(n).fill(NaN);
  }

  parseAtom(): Val {
    this.skipNl();
    const t = this.peek();
    if (t.k === "num") {
      this.eat("num");
      return Number(t.v);
    }
    if (t.k === "str") {
      this.eat("str");
      return 0;
    }
    if (t.v === "(") {
      this.eat("op", "(");
      const v = this.parseExpr();
      this.skipNl();
      this.eat("op", ")");
      return v;
    }
    if (t.v === "[") {
      this.eat("op", "[");
      this.skipNl();
      const items: Val[] = [];
      if (this.peek().v !== "]") {
        while (true) {
          this.skipNl();
          items.push(this.parseExpr());
          this.skipNl();
          if (this.eat("op", ",")) continue;
          break;
        }
      }
      this.eat("op", "]");
      this.warnings.push("Array literals are limited in this Pine subset — using the first value");
      return items[0] ?? NaN;
    }
    if (t.k === "id") {
      this.eat("id");
      if (t.v === "true") return 1;
      if (t.v === "false") return 0;
      if (t.v === "na") return Array(this.n).fill(NaN);
      if (this.peek().v === "(") return this.parseCall(t.v);
      if (/^(color|shape|location|size|display|position|line)\./.test(t.v)) {
        return t.v.startsWith("color.") ? t.v : t.v;
      }
      if (t.v in this.env) return this.env[t.v];
      this.warnings.push(`Unknown name “${t.v}”`);
      return Array(this.n).fill(NaN);
    }
    throw new Error(`Unexpected “${t.v}”`);
  }

  parsePostfix(): Val {
    let v = this.parseAtom();
    while (this.peek().v === "[") {
      this.eat("op", "[");
      this.skipNl();
      const off = this.parseExpr();
      this.skipNl();
      if (!this.eat("op", "]")) throw new Error("Expected “]” after history offset");
      v = historyRef(v, off, this.n);
    }
    return v;
  }

  parseUnary(): Val {
    if (this.eat("op", "-")) {
      const v = this.parseUnary();
      if (Array.isArray(v)) return v.map((x) => -x);
      return -Number(v);
    }
    if (this.peek().k === "id" && this.peek().v === "not") {
      this.eat("id");
      const v = this.parseUnary();
      const a = asSeries(v, this.n);
      return a.map((x) => (x ? 0 : 1));
    }
    return this.parsePostfix();
  }

  parseMul(): Val {
    let v = this.parseUnary();
    while (this.peek().v === "*" || this.peek().v === "/" || this.peek().v === "%") {
      const op = this.eat("op")!.v;
      const r = this.parseUnary();
      v = bin(
        v,
        r,
        this.n,
        op === "*" ? (a, b) => a * b : op === "/" ? (a, b) => a / b : (a, b) => a % b
      );
    }
    return v;
  }

  parseAdd(): Val {
    let v = this.parseMul();
    while (this.peek().v === "+" || this.peek().v === "-") {
      const op = this.eat("op")!.v;
      const r = this.parseMul();
      v = bin(v, r, this.n, op === "+" ? (a, b) => a + b : (a, b) => a - b);
    }
    return v;
  }

  parseCmp(): Val {
    let v = this.parseAdd();
    const t = this.peek();
    if (t.v === ">" || t.v === "<" || t.v === ">=" || t.v === "<=" || t.v === "==" || t.v === "!=") {
      const op = this.eat("op")!.v;
      const r = this.parseAdd();
      const fn =
        op === ">"
          ? (a: number, b: number) => a > b
          : op === "<"
            ? (a: number, b: number) => a < b
            : op === ">="
              ? (a: number, b: number) => a >= b
              : op === "<="
                ? (a: number, b: number) => a <= b
                : op === "=="
                  ? (a: number, b: number) => a === b
                  : (a: number, b: number) => a !== b;
      return cmp(v, r, this.n, fn);
    }
    return v;
  }

  parseAnd(): Val {
    let v = this.parseCmp();
    while (this.peek().k === "id" && this.peek().v === "and") {
      this.eat("id");
      const r = this.parseCmp();
      const A = asSeries(v, this.n);
      const B = asSeries(r, this.n);
      v = A.map((x, i) => (x && B[i] ? 1 : 0));
    }
    return v;
  }

  parseOr(): Val {
    let v = this.parseAnd();
    while (this.peek().k === "id" && this.peek().v === "or") {
      this.eat("id");
      const r = this.parseAnd();
      const A = asSeries(v, this.n);
      const B = asSeries(r, this.n);
      v = A.map((x, i) => (x || B[i] ? 1 : 0));
    }
    return v;
  }

  parseExpr(): Val {
    const c = this.parseOr();
    if (this.peek().v === "?") {
      this.eat("op", "?");
      this.skipNl();
      const a = this.parseExpr();
      this.skipNl();
      this.eat("op", ":");
      this.skipNl();
      const b = this.parseExpr();
      return where(c, a, b, this.n);
    }
    return c;
  }
}

const TYPE_PREFIX = new Set([
  "var",
  "varip",
  "const",
  "float",
  "int",
  "bool",
  "color",
  "string",
  "series",
  "simple",
  "export",
]);

export function compilePine(source: string, candles: Candle[], scriptId = "local"): PineCompileResult {
  const warnings: string[] = [];
  let name = "Pine script";
  const plots: PinePlot[] = [];
  const shapes: PineShape[] = [];
  const fills: PineFill[] = [];
  if (!source.trim()) {
    return { name, plots, shapes, fills, error: null, warnings };
  }

  const n = candles.length;
  const close = candles.map((c) => c.close);
  const open = candles.map((c) => c.open);
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  const volume = candles.map((c) => c.volume);
  const hl2 = candles.map((c) => (c.high + c.low) / 2);
  const hlc3 = candles.map((c) => (c.high + c.low + c.close) / 3);
  const ohlc4 = candles.map((c) => (c.open + c.high + c.low + c.close) / 4);
  const env: Record<string, Val> = {
    close,
    open,
    high,
    low,
    volume,
    hl2,
    hlc3,
    ohlc4,
    bar_index: candles.map((_, i) => i),
    time: candles.map((c) => c.time),
    "barstate.isconfirmed": 1,
    "barstate.ishistory": 1,
    "barstate.isrealtime": 0,
    "barstate.isnew": 1,
    "barstate.islast": candles.map((_, i) => (i === n - 1 ? 1 : 0)),
    "barstate.isfirst": candles.map((_, i) => (i === 0 ? 1 : 0)),
  };

  try {
    const toks = tokenize(source);
    const p = new Parser(toks, n, env, candles, scriptId, plots, shapes, fills);
    p.warnings = warnings;
    p.skipNl();
    while (p.peek().k !== "eof") {
      p.skipNl();
      if (p.peek().k === "eof") break;

      while (
        p.peek().k === "id" &&
        TYPE_PREFIX.has(p.peek().v) &&
        toks[p.i + 1]?.v !== "(" &&
        toks[p.i + 1]?.v !== "="
      ) {
        p.eat("id");
        if (p.peek().v === "[") {
          p.eat("op", "[");
          p.skipNl();
          p.eat("op", "]");
        }
      }

      if (p.peek().v === "[") {
        p.eat("op", "[");
        const names: string[] = [];
        while (p.peek().v !== "]" && p.peek().k !== "eof") {
          p.skipNl();
          if (p.peek().k === "id") names.push(p.eat("id")!.v);
          p.skipNl();
          if (p.eat("op", ",")) continue;
          break;
        }
        p.eat("op", "]");
        p.skipNl();
        p.eat("op", "=");
        const v = p.parseExpr();
        const tuple = p.lastTuple;
        names.forEach((nm, i) => {
          env[nm] = tuple && tuple[i] !== undefined ? tuple[i] : v;
        });
        p.lastTuple = null;
        p.skipNl();
        continue;
      }

      const id = p.peek();
      if (id.k !== "id") {
        while (p.peek().k !== "nl" && p.peek().k !== "eof") p.i++;
        p.skipNl();
        continue;
      }

      const next = toks[p.i + 1];
      if (id.v === "indicator" || id.v === "strategy") {
        p.eat("id");
        p.parseArgs();
        const titleTok =
          source.match(/indicator\s*\(\s*"([^"]+)"/) || source.match(/strategy\s*\(\s*"([^"]+)"/);
        if (titleTok) name = titleTok[1];
        p.skipNl();
        continue;
      }
      if (id.v === "if" || id.v === "for" || id.v === "while" || id.v === "switch" || id.v === "else") {
        while (p.peek().k !== "nl" && p.peek().k !== "eof") p.i++;
        p.skipNl();
        continue;
      }
      if (next?.v === "=" || next?.v === ":=") {
        p.eat("id");
        p.eat("op");
        env[id.v] = p.parseExpr();
        p.skipNl();
        continue;
      }
      if (next?.v === "(") {
        p.eat("id");
        p.parseCall(id.v);
        p.skipNl();
        continue;
      }
      while (p.peek().k !== "nl" && p.peek().k !== "eof") p.i++;
      p.skipNl();
    }
    warnings.push(...p.warnings);
  } catch (err) {
    return {
      name,
      plots,
      shapes: uniqueSortedShapes(shapes),
      fills,
      error: String((err as Error).message || err),
      warnings,
    };
  }

  return {
    name,
    plots,
    shapes: uniqueSortedShapes(shapes),
    fills,
    error: null,
    warnings: [...new Set(warnings)],
  };
}
