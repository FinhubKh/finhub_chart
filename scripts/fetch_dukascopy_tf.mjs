#!/usr/bin/env node
/**
 * Fetch one XAUUSD timeframe from Dukascopy into an output directory.
 *
 * Usage:
 *   node scripts/fetch_dukascopy_tf.mjs --tf h1 --out data/xauusd_free --from 2016-01-01 --to 2026-08-10
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getHistoricalRates } from "dukascopy-node";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const TF_MAP = {
  m1: "XAUUSD_1M.csv",
  m5: "XAUUSD_5M.csv",
  m15: "XAUUSD_15M.csv",
  h1: "XAUUSD_1H.csv",
  h4: "XAUUSD_4H.csv",
  d1: "XAUUSD_1D.csv",
  mn1: "XAUUSD_1MN.csv",
};

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
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
    return [dt, r.open, r.high, r.low, r.close, r.volume ?? 0].join(",");
  });
  return [header, ...lines].join("\n") + "\n";
}

async function main() {
  const tf = arg("tf");
  const outDir = path.resolve(ROOT, arg("out", "data/xauusd_free"));
  const from = arg("from");
  const to = arg("to", today());

  if (!tf || !TF_MAP[tf]) {
    console.error(`Unknown or missing --tf. Use one of: ${Object.keys(TF_MAP).join(", ")}`);
    process.exit(2);
  }
  if (!from) {
    console.error("Missing --from YYYY-MM-DD");
    process.exit(2);
  }

  await mkdir(outDir, { recursive: true });
  console.log(`[${tf}] downloading ${from} → ${to} → ${outDir}`);

  const data = await getHistoricalRates({
    instrument: "xauusd",
    dates: { from: new Date(from), to: new Date(to) },
    timeframe: tf,
    format: "json",
    priceType: "bid",
  });

  if (!Array.isArray(data) || data.length === 0) {
    console.error(`[${tf}] no rows returned`);
    process.exit(1);
  }

  const outPath = path.join(outDir, TF_MAP[tf]);
  await writeFile(outPath, toCsv(data), "utf8");
  console.log(`[${tf}] wrote ${data.length} bars → ${outPath}`);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
