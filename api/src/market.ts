import { HttpError } from "./types";

// Binance's public market-data mirror: same REST API, no key, and not geo-blocked
// from Cloudflare's edge the way api.binance.com can be.
const BINANCE = "https://data-api.binance.vision/api/v3";
const FRANKFURTER = "https://api.frankfurter.dev/v1";

export const FOREX_PAIRS = new Set(["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CHF", "USD/CAD", "NZD/USD", "EUR/GBP"]);
export const ALLOWED_TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"];

export type Bar = { timestamp: string; open: number; high: number; low: number; close: number; volume: number };

const upstream = (msg: string) => new HttpError(502, msg);

export const isForex = (symbol: string) => FOREX_PAIRS.has(symbol.toUpperCase());

async function getJson(url: string, what: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" }, cf: { cacheTtl: 5, cacheEverything: true } });
  } catch (e) {
    throw upstream(`Could not fetch ${what}: ${e}`);
  }
  if (!res.ok) throw upstream(`Could not fetch ${what} (HTTP ${res.status})`);
  return res.json();
}

const BINANCE_HOSTS = [BINANCE, "https://api.binance.com/api/v3", "https://api1.binance.com/api/v3", "https://api-gcp.binance.com/api/v3"];
const OKX_BAR: Record<string, string> = { "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D" };

async function tryFetch(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, cf: { cacheTtl: 5, cacheEverything: true } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// Exchanges geo-block some Cloudflare egress IPs, so try several public sources in turn.
async function cryptoOhlcv(symbol: string, timeframe: string, limit: number): Promise<Bar[]> {
  const pair = symbol.replace("/", "");
  for (const host of BINANCE_HOSTS) {
    const raw = await tryFetch(`${host}/klines?symbol=${pair}&interval=${timeframe}&limit=${limit}`);
    if (Array.isArray(raw)) {
      return raw.map((k: any[]) => ({
        timestamp: new Date(k[0]).toISOString(),
        open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]),
      }));
    }
  }
  // OKX: newest-first [ts, o, h, l, c, vol, ...], max 300 per request.
  const okx = await tryFetch(
    `https://www.okx.com/api/v5/market/candles?instId=${symbol.replace("/", "-")}&bar=${OKX_BAR[timeframe]}&limit=${Math.min(limit, 300)}`,
  );
  if (okx?.code === "0" && Array.isArray(okx.data) && okx.data.length) {
    return okx.data
      .slice()
      .reverse()
      .map((k: string[]) => ({
        timestamp: new Date(Number(k[0])).toISOString(),
        open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]),
      }));
  }
  throw upstream(`Could not fetch market data for ${symbol}`);
}

async function forexOhlcv(symbol: string, limit: number): Promise<Bar[]> {
  const [base, quote] = symbol.split("/");
  const end = new Date();
  // Frankfurter is business-days-only; pad the window so `limit` bars come back.
  const start = new Date(end.getTime() - (Math.floor(limit * 1.6) + 5) * 86400_000);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const data = await getJson(`${FRANKFURTER}/${d(start)}..${d(end)}?from=${base}&to=${quote}`, `forex history for ${symbol}`);
  const rates: Record<string, Record<string, number>> = data.rates ?? {};
  const bars: Bar[] = [];
  for (const date of Object.keys(rates).sort().slice(-limit)) {
    const rate = rates[date][quote];
    if (rate == null) continue;
    bars.push({ timestamp: new Date(`${date}T00:00:00Z`).toISOString(), open: rate, high: rate, low: rate, close: rate, volume: 0 });
  }
  if (!bars.length) throw upstream(`No historical rates available for ${symbol}`);
  return bars;
}

export function fetchOhlcv(symbol: string, timeframe: string, limit: number): Promise<Bar[]> {
  return isForex(symbol) ? forexOhlcv(symbol, limit) : cryptoOhlcv(symbol, timeframe, limit);
}
