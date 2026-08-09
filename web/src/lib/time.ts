/** Unix seconds → `datetime-local` value in local timezone. */
export function unixToLocalInput(unix: number): string {
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `datetime-local` → unix seconds. */
export function localInputToUnix(value: string): number {
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return 0;
  return Math.floor(ms / 1000);
}

/** Find first index with time >= target (or 0). */
export function indexAtOrAfter(
  candles: { time: number }[],
  target: number
): number {
  if (!candles.length) return 0;
  let lo = 0;
  let hi = candles.length - 1;
  let ans = candles.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time >= target) {
      ans = mid;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  return ans;
}

/** Find last index with time <= target (or last). */
export function indexAtOrBefore(
  candles: { time: number }[],
  target: number
): number {
  if (!candles.length) return 0;
  let lo = 0;
  let hi = candles.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time <= target) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export function formatBarClock(unix: number): string {
  return new Date(unix * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
