import type { IChartApi, ISeriesApi, Logical, UTCTimestamp } from "lightweight-charts";
import type { Candle } from "../api";
import type { Point } from "./drawings";

function clampIndex(i: number, len: number) {
  return Math.max(0, Math.min(len - 1, i));
}

/** Snap price to nearest OHLC of a candle. */
function snapPrice(candle: Candle, price: number): number {
  const prices = [candle.open, candle.high, candle.low, candle.close];
  let best = prices[0];
  let bestD = Math.abs(prices[0] - price);
  for (let i = 1; i < prices.length; i++) {
    const d = Math.abs(prices[i] - price);
    if (d < bestD) {
      bestD = d;
      best = prices[i];
    }
  }
  return best;
}

/**
 * Screen → free chart point using fractional logical index.
 * This is what lets drawings follow the cursor between bars (TradingView-style).
 * Magnet (optional) snaps logical to bar index + price to OHLC.
 */
export function screenToPoint(
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  candles: Candle[],
  x: number,
  y: number,
  magnet: boolean
): Point | null {
  const price = series.coordinateToPrice(y);
  const logical = chart.timeScale().coordinateToLogical(x);
  if (price == null || logical == null || !Number.isFinite(price) || !Number.isFinite(logical)) {
    return null;
  }

  if (!magnet || !candles.length) {
    return { logical, price };
  }

  const idx = clampIndex(Math.round(logical), candles.length);
  return {
    logical: idx,
    price: snapPrice(candles[idx], price),
  };
}

/**
 * Chart point → screen via logicalToCoordinate (supports fractional logical).
 */
export function pointToScreen(
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  _candles: Candle[],
  p: Point
): { x: number; y: number } | null {
  const y = series.priceToCoordinate(p.price);
  const x = chart.timeScale().logicalToCoordinate(p.logical as Logical);
  if (x == null || y == null) return null;
  return { x, y };
}

/** Nearest bar unix time for crosshair sync / labels. */
export function logicalToTime(candles: Candle[], logical: number): number | null {
  if (!candles.length) return null;
  const idx = clampIndex(Math.round(logical), candles.length);
  return candles[idx].time;
}

export function timeForCrosshair(
  candles: Candle[],
  p: Point
): UTCTimestamp | null {
  const t = logicalToTime(candles, p.logical);
  return t == null ? null : (t as UTCTimestamp);
}
