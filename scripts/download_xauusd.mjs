#!/usr/bin/env node
/**
 * Download XAUUSD OHLC history from Dukascopy into data/xauusd/.
 *
 * Env vars:
 *   FROM=YYYY-MM-DD   start date (default: 10 years ago)
 *   TO=YYYY-MM-DD     end date (default: today)
 *   TFS=m1,m5,...     comma-separated dukascopy timeframes
 *   CHUNK=year|none   download in yearly chunks (default: year)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getHistoricalRates } from "dukascopy-node";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "data", "xauusd");

const TF_MAP = {
  m1: "XAUUSD_1M.csv",
  m5: "XAUUSD_5M.csv",
  m15: "XAUUSD_15M.csv",
  h1: "XAUUSD_1H.csv",
  h4: "XAUUSD_4H.csv",
  d1: "XAUUSD_1D.csv",
  mn1: "XAUUSD_1MN.csv",
};

function defaultFrom() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 10);
  return d.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function parseYmd(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatYmd(d) {
  return d.toISOString().slice(0, 10);
}

/** Split [from, to] into calendar-year or calendar-month chunks (inclusive). */
function rangeChunks(fromStr, toStr, mode) {
  const from = parseYmd(fromStr);
  const to = parseYmd(toStr);
  if (from > to) throw new Error(`FROM (${fromStr}) is after TO (${toStr})`);

  if (mode === "none") return [{ from: fromStr, to: toStr }];

  const chunks = [];
  let cursor = new Date(from);
  while (cursor <= to) {
    let end;
    if (mode === "month") {
      end = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)
      );
    } else {
      end = new Date(Date.UTC(cursor.getUTCFullYear(), 11, 31));
    }
    if (end > to) end = to;
    chunks.push({ from: formatYmd(cursor), to: formatYmd(end) });
    cursor = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }
  return chunks;
}

function rowLine(r) {
  const dt =
    typeof r.timestamp === "number"
      ? new Date(r.timestamp).toISOString().replace("T", " ").replace("Z", "")
      : String(r.timestamp).replace("T", " ").replace("Z", "");
  return [dt, r.open, r.high, r.low, r.close, r.volume ?? 0].join(",");
}

async function writeCsv(outPath, rows) {
  const stream = createWriteStream(outPath, { encoding: "utf8" });
  stream.write("datetime,open,high,low,close,volume\n");
  for (const r of rows) {
    if (!stream.write(rowLine(r) + "\n")) {
      await new Promise((resolve) => stream.once("drain", resolve));
    }
  }
  stream.end();
  await finished(stream);
}

function dedupeSort(rows) {
  const byTs = new Map();
  for (const r of rows) {
    const ts =
      typeof r.timestamp === "number"
        ? r.timestamp
        : new Date(r.timestamp).getTime();
    if (!Number.isFinite(ts)) continue;
    byTs.set(ts, { ...r, timestamp: ts });
  }
  return [...byTs.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => row);
}

async function fetchChunk(tf, from, to, attempt = 1) {
  try {
    const data = await getHistoricalRates({
      instrument: "xauusd",
      dates: {
        from: new Date(from),
        to: new Date(to),
      },
      timeframe: tf,
      format: "json",
      priceType: "bid",
    });
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (attempt >= 3) throw err;
    const wait = attempt * 4000;
    console.warn(
      `[${tf}] chunk ${from}→${to} failed (try ${attempt}): ${err?.message || err}; retry in ${wait}ms`
    );
    await new Promise((r) => setTimeout(r, wait));
    return fetchChunk(tf, from, to, attempt + 1);
  }
}

async function downloadTf(tf, from, to, chunkMode) {
  const filename = TF_MAP[tf];
  if (!filename) throw new Error(`Unknown timeframe: ${tf}`);

  // m1 yearly chunks are huge — default them to monthly unless CHUNK overrides
  const chunks =
    chunkMode === "none"
      ? [{ from, to }]
      : rangeChunks(
          from,
          to,
          chunkMode === "month" || tf === "m1" ? "month" : "year"
        );

  console.log(
    `[${tf}] downloading ${from} → ${to} (${chunks.length} chunk${chunks.length === 1 ? "" : "s"}) ...`
  );

  const all = [];
  for (const c of chunks) {
    process.stdout.write(`  [${tf}] ${c.from} → ${c.to} ... `);
    const rows = await fetchChunk(tf, c.from, c.to);
    console.log(`${rows.length.toLocaleString()} bars`);
    // Avoid `all.push(...rows)` — spreads of 300k+ blow the call stack
    for (const row of rows) all.push(row);
    // be polite to Dukascopy between chunks
    await new Promise((r) => setTimeout(r, 750));
  }

  const merged = dedupeSort(all);
  if (merged.length === 0) {
    console.warn(`[${tf}] no rows returned`);
    return;
  }

  const outPath = path.join(OUT_DIR, filename);
  await writeCsv(outPath, merged);
  console.log(`[${tf}] wrote ${merged.length.toLocaleString()} bars → ${outPath}`);
}

async function main() {
  const from = process.env.FROM || defaultFrom();
  const to = process.env.TO || today();
  const chunkMode = (process.env.CHUNK || "year").toLowerCase();
  // Higher TFs first so something useful lands even if m1 is slow
  const tfs = (process.env.TFS || "mn1,d1,h4,h1,m15,m5,m1")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Output: ${OUT_DIR}`);
  console.log(`Range:  ${from} → ${to}`);
  console.log(`TFs:    ${tfs.join(", ")}`);
  console.log(`Chunk:  ${chunkMode}`);

  const failed = [];
  for (const tf of tfs) {
    try {
      await downloadTf(tf, from, to, chunkMode);
    } catch (err) {
      console.error(`[${tf}] FAILED:`, err?.message || err);
      failed.push(tf);
    }
  }

  console.log(
    "Done. Run `npm run resample:weekly` to build XAUUSD_1W.csv from daily."
  );
  if (failed.length) {
    console.error(`Failed timeframes: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
