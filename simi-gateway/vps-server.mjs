/**
 * Plain Node gateway for Render / VPS production.
 *
 *   cd gateway
 *   npm install
 *   npm run vps
 *
 * EA:
 *   InpLlmUrl     = https://YOUR-SERVICE.onrender.com/regime
 *   InpGatewayKey = GATEWAY_SECRET
 *
 * MT5 allow WebRequest: https://YOUR-SERVICE.onrender.com  and  https://api.telegram.org
 */
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = resolve(__dirname, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i);
    const v = t.slice(i + 1);
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnv();

const PORT = Number(process.env.PORT || 8000);
const API_KEY = process.env.SEALION_API_KEY || process.env.OPENAI_API_KEY || "";
const BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.sea-lion.ai/v1").replace(/\/$/, "");
const MODEL = process.env.LLM_MODEL || "aisingapore/Qwen-SEA-LION-v4.5-27B-IT";
const SECRET = process.env.GATEWAY_SECRET || "";
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TG_CHAT = process.env.TELEGRAM_CHANNEL_ID || "";

const SYSTEM_PROMPT = `You are a market REGIME classifier for a grid+martingale Expert Advisor.

You do NOT pick entries. You only decide whether this mechanical grid is allowed to run.

Grid+martingale makes money only in a mean-reverting RANGE:
- price oscillating in a box
- low/moderate ADX (usually under ~22-25)
- RSI not pinned at extremes for long
- ATR not expanding vs its recent average
- no impulsive one-way candle sequence

It gets destroyed in:
- a real trend (rising ADX, HH/HL or LH/LL, EMA50 sloping hard)
- volatility expansion / breakout (ATR ratio spike)
- news / session open spikes
- wide spread
- when the EA already has many martingale levels and price keeps going

Rules:
1. When unsure, PAUSE. Never give the grid the benefit of the doubt.
2. action=run only if regime is ranging AND confidence >= 65 AND the box still looks intact.
3. action=pause: no new grid levels; existing basket may still hit basket TP.
4. action=flatten: close everything. Use this if a trend/breakout has started AND the basket is on the wrong side, or volatility exploded, or drawdown is accelerating.
5. bias:
   - neutral: range with no edge → both sides ok
   - bullish: only buy-side grid (buy dips)
   - bearish: only sell-side grid (sell rallies)
6. If buy_levels or sell_levels are already high (>=3) and price is still moving against that basket, prefer pause or flatten. Do not keep feeding martingale into a trend.
7. valid_minutes: 10-20 in calm range, 5-10 if conditions are changing.
8. reason: one short sentence, no markdown.

Return ONLY JSON with keys:
allow_new_entries (bool),
action (run|pause|flatten),
regime (ranging|trending|volatile|uncertain),
bias (neutral|bullish|bearish),
confidence (0-100 integer),
reason (string),
valid_minutes (integer)`;

function failClosed(reason) {
  return {
    allow_new_entries: false,
    action: "pause",
    regime: "uncertain",
    bias: "neutral",
    confidence: 0,
    reason,
    valid_minutes: 10,
  };
}

function sanitize(dec) {
  const next = { ...dec };
  if (["trending", "volatile", "uncertain"].includes(next.regime)) {
    next.allow_new_entries = false;
    if (next.action === "run") next.action = "pause";
  }
  if (next.action === "pause" || next.action === "flatten") next.allow_new_entries = false;
  if (next.action === "run" && Number(next.confidence) < 65) {
    next.allow_new_entries = false;
    next.action = "pause";
    next.reason = `confidence ${next.confidence} < 65 | ${next.reason}`;
  }
  if (next.action === "run") {
    next.allow_new_entries = true;
    next.regime = "ranging";
  }
  next.reason = String(next.reason || "").slice(0, 240);
  next.confidence = Math.max(0, Math.min(100, Number(next.confidence) || 0));
  next.valid_minutes = Math.max(5, Math.min(60, Number(next.valid_minutes) || 15));
  return next;
}

function extractJson(text) {
  let raw = String(text || "").trim();
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
  return JSON.parse(raw);
}

function authorized(req) {
  if (!SECRET) return true;
  const header =
    req.headers["x-gateway-key"] ||
    req.headers["x-simi-key"] ||
    req.headers["authorization"] ||
    "";
  const token = String(header).replace(/^Bearer\s+/i, "").trim();
  return token === SECRET;
}

async function askLlm(snapshot) {
  if (!API_KEY) return failClosed("SEALION_API_KEY missing on gateway");

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Classify the regime for this grid+martingale EA. Be conservative.\n\n${JSON.stringify(snapshot)}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return failClosed(`SeaLion HTTP ${res.status}: ${errText.slice(0, 120)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "{}";
  try {
    return sanitize(extractJson(text));
  } catch (err) {
    return failClosed(`bad LLM JSON: ${err instanceof Error ? err.message : "parse error"}`);
  }
}

async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT) return { ok: false, error: "telegram env missing" };
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHAT, text, disable_web_page_preview: true }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) return { ok: false, error: data.description || `telegram HTTP ${res.status}` };
  return { ok: true };
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  const text = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  const path = (req.url || "/").split("?")[0];
  try {
    if (path === "/health" || path === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        mode: "production",
        model: MODEL,
        base_url: BASE_URL,
        key_loaded: Boolean(API_KEY),
        secret_required: Boolean(SECRET),
      });
    }

    const body = await readBody(req);
    if (!authorized(req)) return sendJson(res, 401, failClosed("unauthorized gateway key"));

    if (path === "/regime" || path === "/api/regime") {
      let snapshot = {};
      try {
        snapshot = body.length ? JSON.parse(body.toString("utf8")) : {};
      } catch {
        return sendJson(res, 200, failClosed("invalid JSON body"));
      }
      return sendJson(res, 200, await askLlm(snapshot));
    }

    if (path === "/notify" || path === "/api/notify") {
      let payload = {};
      try {
        payload = body.length ? JSON.parse(body.toString("utf8")) : {};
      } catch {
        return sendJson(res, 400, { ok: false, error: "invalid JSON" });
      }
      const text = String(payload.text || "").trim();
      if (!text) return sendJson(res, 400, { ok: false, error: "text required" });
      const result = await sendTelegram(text);
      return sendJson(res, result.ok ? 200 : 502, result);
    }

    return sendJson(res, 404, { ok: false, error: "not found" });
  } catch (err) {
    return sendJson(res, 200, failClosed(err instanceof Error ? err.message : "server error"));
  }
});

const HOST = process.env.HOST || "0.0.0.0";
server.listen(PORT, HOST, () => {
  console.log(`Simi gateway listening on http://${HOST}:${PORT}`);
  console.log(`Model: ${MODEL} | SeaLion key: ${Boolean(API_KEY)}`);
});
