#!/usr/bin/env node
/**
 * Download XAUUSD OHLC history from Dukascopy into data/xauusd/.
 *
 * Env vars:
 *   FROM=YYYY-MM-DD   start date (default: 3 years ago)
 *   TO=YYYY-MM-DD     end date (default: today)
 *   TFS=m1,m5,...     comma-separated dukascopy timeframes
 */
import { mkdir, writeFile } from "node:fs/promises";
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
  d.setFullYear(d.getFullYear() - 3);
  return d.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function toCsv(rows) {
  const header = "datetime,open,high,low,close,volume";
  const lines = rows.map((r) => {
    const dt =
      typeof r.timestamp === "number"
        ? new Date(r.timestamp).toISOString().replace("T", " ").replace("Z", "")
        : String(r.timestamp).replace("T", " ").replace("Z", "");
    return [
      dt,
      r.open,
      r.high,
      r.low,
      r.close,
      r.volume ?? 0,
    ].join(",");
  });
  return [header, ...lines].join("\n") + "\n";
}

async function downloadTf(tf, from, to) {
  const filename = TF_MAP[tf];
  if (!filename) throw new Error(`Unknown timeframe: ${tf}`);

  console.log(`[${tf}] downloading ${from} → ${to} ...`);
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

  if (!Array.isArray(data) || data.length === 0) {
    console.warn(`[${tf}] no rows returned`);
    return;
  }

  // dukascopy-node json format: { timestamp, open, high, low, close, volume }
  const outPath = path.join(OUT_DIR, filename);
  await writeFile(outPath, toCsv(data), "utf8");
  console.log(`[${tf}] wrote ${data.length.toLocaleString()} bars → ${outPath}`);
}

async function main() {
  const from = process.env.FROM || defaultFrom();
  const to = process.env.TO || today();
  const tfs = (process.env.TFS || "m1,m5,m15,h1,h4,d1,mn1")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Output: ${OUT_DIR}`);
  console.log(`Range:  ${from} → ${to}`);
  console.log(`TFs:    ${tfs.join(", ")}`);

  for (const tf of tfs) {
    try {
      await downloadTf(tf, from, to);
    } catch (err) {
      console.error(`[${tf}] FAILED:`, err?.message || err);
    }
  }

  console.log("Done. Run `npm run resample:weekly` to build XAUUSD_1W.csv from daily.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
