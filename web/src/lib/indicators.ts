import type { Candle } from "./api";

export type LinePoint = { time: number; value: number };

function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (!values.length) return out;
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue;
    if (prev === null) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += values[j];
      prev = sum / period;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

/** Linear Weighted MA (LWMA / WMA) — used by BBMA Oma Ally. */
function lwma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (period <= 0) return out;
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += values[i - period + 1 + j] * (j + 1);
    }
    out[i] = sum / denom;
  }
  return out;
}

function toLine(candles: Candle[], values: (number | null)[]): LinePoint[] {
  const pts: LinePoint[] = [];
  for (let i = 0; i < candles.length; i++) {
    const v = values[i];
    if (v == null || Number.isNaN(v)) continue;
    pts.push({ time: candles[i].time, value: v });
  }
  return pts;
}

export function calcSma(candles: Candle[], period: number) {
  return toLine(
    candles,
    sma(
      candles.map((c) => c.close),
      period
    )
  );
}

export function calcEma(candles: Candle[], period: number) {
  return toLine(
    candles,
    ema(
      candles.map((c) => c.close),
      period
    )
  );
}

export function calcLwma(
  candles: Candle[],
  period: number,
  source: "close" | "high" | "low" = "close"
) {
  return toLine(
    candles,
    lwma(
      candles.map((c) => c[source]),
      period
    )
  );
}

export function calcBollinger(candles: Candle[], period = 20, mult = 2) {
  const closes = candles.map((c) => c.close);
  const mid = sma(closes, period);
  const upper: (number | null)[] = Array(closes.length).fill(null);
  const lower: (number | null)[] = Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const m = mid[i];
    if (m == null) continue;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = closes[j] - m;
      variance += d * d;
    }
    const sd = Math.sqrt(variance / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return {
    middle: toLine(candles, mid),
    upper: toLine(candles, upper),
    lower: toLine(candles, lower),
  };
}

/**
 * BBMA Oma Ally pack:
 * BB(20,2) + LWMA5/10 High + LWMA5/10 Low + EMA50.
 */
export function calcBbma(candles: Candle[]) {
  const bb = calcBollinger(candles, 20, 2);
  return {
    bbMiddle: bb.middle,
    bbUpper: bb.upper,
    bbLower: bb.lower,
    lwma5High: calcLwma(candles, 5, "high"),
    lwma10High: calcLwma(candles, 10, "high"),
    lwma5Low: calcLwma(candles, 5, "low"),
    lwma10Low: calcLwma(candles, 10, "low"),
    ema50: calcEma(candles, 50),
  };
}

export function calcRsi(candles: Candle[], period = 14) {
  const closes = candles.map((c) => c.close);
  const out: (number | null)[] = Array(closes.length).fill(null);
  if (closes.length <= period) return toLine(candles, out);

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) avgGain += d;
    else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return toLine(candles, out);
}

export function calcMacd(
  candles: Candle[],
  fast = 12,
  slow = 26,
  signalPeriod = 9
) {
  const closes = candles.map((c) => c.close);
  const fastE = ema(closes, fast);
  const slowE = ema(closes, slow);
  const macdLine: (number | null)[] = closes.map((_, i) =>
    fastE[i] != null && slowE[i] != null
      ? (fastE[i] as number) - (slowE[i] as number)
      : null
  );
  const macdVals = macdLine.map((v) => v ?? 0);
  const first = macdLine.findIndex((v) => v != null);
  const signal = ema(macdVals, signalPeriod);
  const hist: (number | null)[] = macdLine.map((m, i) =>
    m != null && signal[i] != null && i >= first + signalPeriod - 1
      ? m - (signal[i] as number)
      : null
  );
  return {
    macd: toLine(candles, macdLine),
    signal: toLine(
      candles,
      signal.map((v, i) => (macdLine[i] == null ? null : v))
    ),
    histogram: toLine(candles, hist),
  };
}

export function calcVwap(candles: Candle[]) {
  let cumPv = 0;
  let cumVol = 0;
  const values: (number | null)[] = [];
  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3;
    const vol = c.volume || 0;
    cumPv += typical * vol;
    cumVol += vol;
    values.push(cumVol > 0 ? cumPv / cumVol : null);
  }
  return toLine(candles, values);
}

export type StructureSegment = {
  /** Pivot origin time */
  startTime: number;
  /** Break time (close crossover / crossunder) */
  endTime: number;
  price: number;
  label: "BOS" | "CHoCH";
  /** Bull = #089981, bear = #F23645 (LuxAlgo defaults) */
  bias: "bull" | "bear";
  /** Swing = solid, internal = dashed */
  level: "swing" | "internal";
};

const BULLISH_LEG = 1;
const BEARISH_LEG = 0;
const BULLISH = 1;
const BEARISH = -1;

type LuxPivot = {
  currentLevel: number;
  crossed: boolean;
  barTime: number;
  barIndex: number;
};

/**
 * LuxAlgo Smart Money Concepts — structure engine.
 * Ports `leg()` / `getCurrentStructure()` / `displayStructure()` from
 * "Smart Money Concepts [LuxAlgo]" (CC BY-NC-SA 4.0 © LuxAlgo).
 *
 * Defaults match Pine: internal size = 5, swing size = 50.
 * Breaks use close crossover / crossunder of the *current* pivot only.
 */
export function calcMarketStructure(
  candles: Candle[],
  opts?: { internalSize?: number; swingSize?: number }
): StructureSegment[] {
  const internalSize = opts?.internalSize ?? 5;
  const swingSize = opts?.swingSize ?? 50;
  if (candles.length < Math.max(internalSize, swingSize) + 2) return [];

  const n = candles.length;
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const times = candles.map((c) => c.time);

  // Precompute rolling highest/lowest of last `size` bars ending at i (Pine ta.highest/lowest)
  const rollHigh = (size: number): Float64Array => {
    const out = new Float64Array(n);
    out.fill(Number.NaN);
    for (let i = size - 1; i < n; i++) {
      let mx = -Infinity;
      for (let k = 0; k < size; k++) {
        const v = highs[i - k];
        if (v > mx) mx = v;
      }
      out[i] = mx;
    }
    return out;
  };
  const rollLow = (size: number): Float64Array => {
    const out = new Float64Array(n);
    out.fill(Number.NaN);
    for (let i = size - 1; i < n; i++) {
      let mn = Infinity;
      for (let k = 0; k < size; k++) {
        const v = lows[i - k];
        if (v < mn) mn = v;
      }
      out[i] = mn;
    }
    return out;
  };

  // leg(size): BEARISH_LEG when high[size] > ta.highest(size), else BULLISH_LEG on new low
  const computeLegs = (size: number): Int8Array => {
    const legs = new Int8Array(n);
    const rh = rollHigh(size);
    const rl = rollLow(size);
    let leg = 0;
    for (let i = 0; i < n; i++) {
      if (i < size || Number.isNaN(rh[i])) {
        legs[i] = leg as 0 | 1;
        continue;
      }
      const pivotHigh = highs[i - size] > rh[i];
      const pivotLow = lows[i - size] < rl[i];
      if (pivotHigh) leg = BEARISH_LEG;
      else if (pivotLow) leg = BULLISH_LEG;
      legs[i] = leg as 0 | 1;
    }
    return legs;
  };

  const swingLegs = computeLegs(swingSize);
  const internalLegs = computeLegs(internalSize);

  const emptyPivot = (): LuxPivot => ({
    currentLevel: Number.NaN,
    crossed: false,
    barTime: 0,
    barIndex: -1,
  });

  const swingHigh = emptyPivot();
  const swingLow = emptyPivot();
  const internalHigh = emptyPivot();
  const internalLow = emptyPivot();

  const segments: StructureSegment[] = [];
  const swingBiasRef = { value: 0 };
  const internalBiasRef = { value: 0 };

  const updateStructure = (
    i: number,
    size: number,
    legs: Int8Array,
    highPivot: LuxPivot,
    lowPivot: LuxPivot
  ) => {
    if (i < size) return;
    const prevLeg = i > 0 ? legs[i - 1] : legs[i];
    const leg = legs[i];
    if (leg === prevLeg) return;

    const pivotIdx = i - size;
    if (leg === BULLISH_LEG) {
      // startOfBullishLeg → new pivot low
      lowPivot.currentLevel = lows[pivotIdx];
      lowPivot.crossed = false;
      lowPivot.barTime = times[pivotIdx];
      lowPivot.barIndex = pivotIdx;
    } else {
      // startOfBearishLeg → new pivot high
      highPivot.currentLevel = highs[pivotIdx];
      highPivot.crossed = false;
      highPivot.barTime = times[pivotIdx];
      highPivot.barIndex = pivotIdx;
    }
  };

  const tryBreak = (
    i: number,
    highPivot: LuxPivot,
    lowPivot: LuxPivot,
    biasRef: { value: number },
    level: "swing" | "internal",
    /** LuxAlgo: skip internal break if level equals swing pivot */
    skipHighIfSameAs?: LuxPivot,
    skipLowIfSameAs?: LuxPivot
  ) => {
    if (i < 1) return;
    const prevClose = closes[i - 1];
    const close = closes[i];

    // Bullish: ta.crossover(close, pivot.currentLevel)
    if (
      Number.isFinite(highPivot.currentLevel) &&
      !highPivot.crossed &&
      prevClose <= highPivot.currentLevel &&
      close > highPivot.currentLevel
    ) {
      const sameAsSwing =
        skipHighIfSameAs &&
        Number.isFinite(skipHighIfSameAs.currentLevel) &&
        highPivot.currentLevel === skipHighIfSameAs.currentLevel;
      if (!sameAsSwing) {
        const tag: "BOS" | "CHoCH" =
          biasRef.value === BEARISH ? "CHoCH" : "BOS";
        segments.push({
          startTime: highPivot.barTime,
          endTime: times[i],
          price: highPivot.currentLevel,
          label: tag,
          bias: "bull",
          level,
        });
        highPivot.crossed = true;
        biasRef.value = BULLISH;
      }
    }

    // Bearish: ta.crossunder(close, pivot.currentLevel)
    if (
      Number.isFinite(lowPivot.currentLevel) &&
      !lowPivot.crossed &&
      prevClose >= lowPivot.currentLevel &&
      close < lowPivot.currentLevel
    ) {
      const sameAsSwing =
        skipLowIfSameAs &&
        Number.isFinite(skipLowIfSameAs.currentLevel) &&
        lowPivot.currentLevel === skipLowIfSameAs.currentLevel;
      if (!sameAsSwing) {
        const tag: "BOS" | "CHoCH" =
          biasRef.value === BULLISH ? "CHoCH" : "BOS";
        segments.push({
          startTime: lowPivot.barTime,
          endTime: times[i],
          price: lowPivot.currentLevel,
          label: tag,
          bias: "bear",
          level,
        });
        lowPivot.crossed = true;
        biasRef.value = BEARISH;
      }
    }
  };

  for (let i = 0; i < n; i++) {
    // Match Pine execution order: getCurrentStructure(swing), getCurrentStructure(internal),
    // then displayStructure(internal), displayStructure(swing)
    updateStructure(i, swingSize, swingLegs, swingHigh, swingLow);
    updateStructure(i, internalSize, internalLegs, internalHigh, internalLow);

    tryBreak(
      i,
      internalHigh,
      internalLow,
      internalBiasRef,
      "internal",
      swingHigh,
      swingLow
    );
    tryBreak(i, swingHigh, swingLow, swingBiasRef, "swing");
  }

  // Keep full history (LuxAlgo Historical mode). Overlay culls off-screen draws.
  return segments;
}

export type IndicatorId =
  | "volume"
  | "sma20"
  | "sma50"
  | "sma200"
  | "ema21"
  | "bbands"
  | "bbma"
  | "structure"
  | "vwap"
  | "rsi"
  | "macd";

export type IndicatorDef = {
  id: IndicatorId;
  label: string;
  pane: "main" | "rsi" | "macd";
  defaultOn?: boolean;
};

export const INDICATOR_CATALOG: IndicatorDef[] = [
  { id: "volume", label: "Volume", pane: "main" },
  { id: "sma20", label: "SMA 20", pane: "main" },
  { id: "sma50", label: "SMA 50", pane: "main" },
  { id: "sma200", label: "SMA 200", pane: "main" },
  { id: "ema21", label: "EMA 21", pane: "main" },
  { id: "bbands", label: "Bollinger Bands", pane: "main" },
  { id: "bbma", label: "BBMA (Oma Ally)", pane: "main" },
  { id: "structure", label: "Market Structure", pane: "main" },
  { id: "vwap", label: "VWAP", pane: "main" },
  { id: "rsi", label: "RSI 14", pane: "rsi" },
  { id: "macd", label: "MACD", pane: "macd" },
];
