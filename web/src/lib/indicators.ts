import type { Candle } from "../api";

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
    fastE[i] != null && slowE[i] != null ? (fastE[i] as number) - (slowE[i] as number) : null
  );
  const macdVals = macdLine.map((v) => v ?? 0);
  // EMA on macd only where defined — approximate with full series after first valid
  const first = macdLine.findIndex((v) => v != null);
  const signal = ema(macdVals, signalPeriod);
  const hist: (number | null)[] = macdLine.map((m, i) =>
    m != null && signal[i] != null && i >= first + signalPeriod - 1
      ? m - (signal[i] as number)
      : null
  );
  return {
    macd: toLine(candles, macdLine),
    signal: toLine(candles, signal.map((v, i) => (macdLine[i] == null ? null : v))),
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

export type IndicatorId =
  | "volume"
  | "sma20"
  | "sma50"
  | "sma200"
  | "ema21"
  | "bbands"
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
  { id: "vwap", label: "VWAP", pane: "main" },
  { id: "rsi", label: "RSI 14", pane: "rsi" },
  { id: "macd", label: "MACD", pane: "macd" },
];
