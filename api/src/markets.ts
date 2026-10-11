/** Market registry + live data for real crypto markets (OKX public API, no key). */
import { HttpError } from "./types";
import { SYMBOL_PROFILES, type Candle, type Range } from "./synthetic";

export type Market = {
  id: string;
  label: string;
  kind: "crypto" | "sim";
  base: string; // e.g. BTC - shown as the badge
  quote: string; // e.g. USDT
  glyph: string; // currency symbol for the base asset
  quoteGlyph: string; // currency symbol prices are quoted in
  inst?: string; // OKX instrument id (crypto only)
};

const crypto = (base: string, quote: string, glyph: string, label: string): Market => ({
  id: `${base}-${quote}`,
  label,
  kind: "crypto",
  base,
  quote,
  glyph,
  quoteGlyph: QUOTE_GLYPHS[quote] ?? quote,
  inst: `${base}-${quote}`,
});

const QUOTE_GLYPHS: Record<string, string> = { USDT: "₮", USDC: "$", BTC: "₿" };

const sim = (id: string, label: string, glyph: string): Market => ({
  id, label, kind: "sim", base: id, quote: "", glyph, quoteGlyph: glyph,
});

export const MARKETS: Market[] = [
  crypto("BTC", "USDT", "₿", "Bitcoin"),
  crypto("ETH", "USDT", "Ξ", "Ethereum"),
  crypto("SOL", "USDT", "◎", "Solana"),
  crypto("BNB", "USDT", "BNB", "BNB"),
  crypto("XRP", "USDT", "XRP", "XRP"),
  crypto("DOGE", "USDT", "Ð", "Dogecoin"),
  crypto("ADA", "USDT", "₳", "Cardano"),
  crypto("LTC", "USDT", "Ł", "Litecoin"),
  crypto("TRX", "USDT", "TRX", "TRON"),
  crypto("LINK", "USDT", "LINK", "Chainlink"),
  crypto("AVAX", "USDT", "AVAX", "Avalanche"),
  crypto("DOT", "USDT", "DOT", "Polkadot"),
  crypto("SHIB", "USDT", "SHIB", "Shiba Inu"),
  crypto("BTC", "USDC", "₿", "Bitcoin / USD"),
  crypto("ETH", "BTC", "Ξ", "Ethereum / Bitcoin"),
  sim("NAIROBI", "Nairobi", "KSh"),
  sim("LONDON", "London", "£"),
  sim("NEWYORK", "New York", "$"),
  sim("TOKYO", "Tokyo", "¥"),
  sim("DUBAI", "Dubai", "AED"),
  sim("HONGKONG", "Hong Kong", "HK$"),
  sim("SINGAPORE", "Singapore", "S$"),
  sim("JOHANNESBURG", "Johannesburg", "R"),
];

const BY_ID = new Map(MARKETS.map((m) => [m.id, m]));
export const getMarket = (id: string): Market | undefined => BY_ID.get(id);
export const isSim = (id: string) => id in SYMBOL_PROFILES;

// ---- OKX ----------------------------------------------------------------------------------

// Cloudflare's shared egress IPs get rate-limited (HTTP 429) by exchanges now and then, so:
// responses are cached in memory and shared between requests, the alternate OKX hostnames are
// tried on failure, and the last good response is served for a while if every host errors.
const OKX_HOSTS = ["https://www.okx.com", "https://aws.okx.com", "https://okx.com"];
const upstream = (msg: string) => new HttpError(502, msg);

const inflight = new Map<string, Promise<any[]>>();
const STALE_TTL_S = 300;

async function okxFetch(path: string): Promise<any[]> {
  let lastErr = "";
  for (let pass = 0; pass < 3; pass++) {
    if (pass > 0) await new Promise((r) => setTimeout(r, 350 * pass)); // back off, then retry every host
    const data = await okxPass(path);
    if (typeof data !== "string") return data;
    lastErr = data;
  }
  throw upstream(`Market data unavailable (${lastErr})`);
}

/** One pass over the hosts: the data, or an error string if every host failed. */
async function okxPass(path: string): Promise<any[] | string> {
  let lastErr = "";
  for (const host of OKX_HOSTS) {
    try {
      const res = await fetch(`${host}/api/v5${path}`, { headers: { Accept: "application/json" } });
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
        continue;
      }
      const body = (await res.json()) as any;
      if (body.code !== "0") {
        lastErr = body.msg || body.code;
        if (body.code === "50011") continue; // rate limited - try the next host
        break;
      }
      return body.data as any[];
    } catch (e) {
      lastErr = String(e);
    }
  }
  return lastErr || "unknown error";
}

// Two entries per path in Cloudflare's per-data-center cache (shared by every Worker instance
// there): a short-lived "fresh" copy, and a longer-lived "stale" copy served if OKX errors.
const cacheReq = (kind: "fresh" | "stale", path: string) => new Request(`https://okx-cache.internal/${kind}${path}`);
const cachePut = (kind: "fresh" | "stale", path: string, data: any[], ttlS: number) =>
  caches.default.put(
    cacheReq(kind, path),
    new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${ttlS}` } }),
  );
async function cacheGet(kind: "fresh" | "stale", path: string): Promise<any[] | null> {
  try {
    const hit = await caches.default.match(cacheReq(kind, path));
    return hit ? ((await hit.json()) as any[]) : null;
  } catch {
    return null;
  }
}

async function okx(path: string, ttlMs = 2000): Promise<any[]> {
  const fresh = await cacheGet("fresh", path);
  if (fresh) return fresh;

  // Collapse concurrent identical requests into one upstream call.
  let p = inflight.get(path);
  if (!p) {
    p = okxFetch(path).finally(() => inflight.delete(path));
    inflight.set(path, p);
  }
  try {
    const data = await p;
    await Promise.all([cachePut("fresh", path, data, Math.max(1, Math.round(ttlMs / 1000))), cachePut("stale", path, data, STALE_TTL_S)]);
    return data;
  } catch (e) {
    const stale = await cacheGet("stale", path);
    if (stale) return stale; // better slightly stale than an error
    throw e;
  }
}

/** Last price and 24h change (%) for every crypto market, from one bulk call. */
export async function cryptoPrices(): Promise<{ prices: Record<string, number>; changes: Record<string, number> }> {
  const rows = await okx("/market/tickers?instType=SPOT", 2000);
  const byInst = new Map<string, { last: number; open: number }>();
  for (const r of rows) byInst.set(r.instId, { last: Number(r.last), open: Number(r.open24h) });
  const prices: Record<string, number> = {};
  const changes: Record<string, number> = {};
  for (const m of MARKETS) {
    if (m.kind !== "crypto") continue;
    const t = byInst.get(m.inst!);
    if (!t || !Number.isFinite(t.last) || t.last <= 0) continue;
    prices[m.id] = t.last;
    if (Number.isFinite(t.open) && t.open > 0) changes[m.id] = ((t.last - t.open) / t.open) * 100;
  }
  return { prices, changes };
}

export async function cryptoLast(market: Market): Promise<number> {
  const rows = await okx(`/market/ticker?instId=${market.inst}`, 1000);
  const p = Number(rows[0]?.last);
  if (!Number.isFinite(p) || p <= 0) throw upstream(`No live price for ${market.id}`);
  return p;
}

type Raw = { ts: number; o: number; h: number; l: number; c: number; confirmed: boolean };
const parse = (r: string[]): Raw => ({
  ts: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), confirmed: r[8] === "1",
});

/** Newest-first candles, paginating backwards when more than 300 are needed. */
async function candles(inst: string, bar: string, total: number): Promise<Raw[]> {
  const out: Raw[] = [];
  let after = "";
  while (out.length < total) {
    const page = await okx(`/market/candles?instId=${inst}&bar=${bar}&limit=${Math.min(300, total - out.length)}${after}`, 2000);
    if (!page.length) break;
    out.push(...page.map(parse));
    after = `&after=${page[page.length - 1][0]}`;
  }
  return out;
}

const fold = (asc: Raw[], n: number): Raw[] => {
  if (n === 1) return asc;
  const out: Raw[] = [];
  // Align groups to the newest candle so the forming bar is always the last one.
  for (let end = asc.length; end > 0; end -= n) {
    const g = asc.slice(Math.max(0, end - n), end);
    out.unshift({
      ts: g[0].ts, o: g[0].o, h: Math.max(...g.map((x) => x.h)), l: Math.min(...g.map((x) => x.l)),
      c: g[g.length - 1].c, confirmed: g[g.length - 1].confirmed,
    });
  }
  return out;
};

// Real data comes from 1s candles for the short scales and native bars for the long ones.
const CRYPTO_VIEWS: Record<Range, { bar: string; fetch: number; fold: number }> = {
  "3m": { bar: "1s", fetch: 180, fold: 3 }, //  60 x 3s
  "15m": { bar: "1m", fetch: 15, fold: 1 }, //  15 x 1m (1s history would need 3 paged calls)
  "1h": { bar: "1m", fetch: 60, fold: 1 }, //  60 x 1m
  "6h": { bar: "5m", fetch: 72, fold: 1 }, //  72 x 5m
  "24h": { bar: "15m", fetch: 96, fold: 1 }, //  96 x 15m
};

export async function cryptoView(market: Market, range: Range): Promise<Candle[]> {
  const v = CRYPTO_VIEWS[range];
  const asc = (await candles(market.inst!, v.bar, v.fetch)).reverse();
  return fold(asc, v.fold).map((r) => ({
    tick_index: Math.floor(r.ts / 1000),
    timestamp: new Date(r.ts).toISOString(),
    open: r.o, high: r.h, low: r.l, close: r.c, volume: 0,
  }));
}

/** The 1-second candle that opened at `tsMs` (its close is the price at the end of that second), or
 * null if it isn't final yet. */
export async function cryptoSecondCandle(market: Market, tsMs: number): Promise<Raw | null> {
  const rows = await okx(`/market/history-candles?instId=${market.inst}&bar=1s&after=${tsMs + 1000}&limit=2`, 4000);
  const hit = rows.map(parse).find((r) => r.ts === tsMs);
  return hit && hit.confirmed ? hit : null;
}
