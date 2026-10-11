/** Simulated city markets - not real market data.
 *
 * Each market is ONE global series shared by every user (like a real exchange), so the chart,
 * the ticker and bet settlement always agree. It is built to be as hard to predict as possible:
 *  - there is NO hidden trend: every tick return is symmetric around zero, so the next move is
 *    up or down with equal odds whatever the chart has just done;
 *  - volatility itself wanders (calm stretches, bursts) and rare jumps hit, so the chart looks
 *    alive without ever revealing direction;
 *  - price at tick t = base * exp(sum of the last LOOKBACK_WINDOW tick returns). The memory is
 *    so long that the price level tells you almost nothing about the next move, yet each tick's
 *    price depends only on its own trailing window, so overlapping requests return identical
 *    candles and the chart never shifts between refreshes;
 *  - all randomness comes from SHA-256 keyed with a server secret, so the future cannot be
 *    reconstructed from observed prices.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";

export const TICK_SECONDS = 3;
export const LOOKBACK_WINDOW = 20000; // ~17 hours of memory
const VOL_REGIME_TICKS = 25; // how long a volatility mood lasts
const JUMP_CHANCE = 0.03;
const JUMP_SIZE = 3;

export type SymbolProfile = { basePrice: number; volatility: number };

const profile = (basePrice: number, volatility: number): SymbolProfile => ({ basePrice, volatility });

export const SYMBOL_PROFILES: Record<string, SymbolProfile> = {
  NAIROBI: profile(120, 0.00016),
  LONDON: profile(340, 0.00014),
  NEWYORK: profile(410, 0.0002),
  TOKYO: profile(275, 0.00019),
  DUBAI: profile(190, 0.00026),
  HONGKONG: profile(305, 0.00029),
  SINGAPORE: profile(230, 0.00018),
  JOHANNESBURG: profile(95, 0.00036),
};

export type Candle = {
  tick_index: number;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

// --- keyed randomness -------------------------------------------------------------------

const enc = new TextEncoder();
const keyCache = new Map<string, Uint8Array>();

/** Per-market 32-byte key = HMAC-SHA256(server secret, "market:<symbol>"). */
export function marketKey(secret: string, symbol: string): Uint8Array {
  const id = `${secret.length}:${symbol}`;
  let key = keyCache.get(id);
  if (!key) {
    key = hmac(sha256, enc.encode(secret), enc.encode(`market:${symbol}`));
    keyCache.set(id, key);
  }
  return key;
}

const TAG_REGIME = 1, TAG_TICK = 2;

class Stream {
  private buf = new Uint8Array(41);
  private view = new DataView(this.buf.buffer);
  constructor(key: Uint8Array) {
    this.buf.set(key, 0);
  }
  /** Six uniforms in (0,1) for (tag, index). */
  draw(tag: number, idx: number): [number, number, number, number, number, number] {
    this.buf[32] = tag;
    this.view.setInt32(33, idx | 0, true);
    this.view.setInt32(37, Math.floor(idx / 4294967296) | 0, true);
    const d = sha256(this.buf);
    const v = new DataView(d.buffer, d.byteOffset, 32);
    const u = (i: number) => (v.getUint32(i * 4, true) + 0.5) / 4294967296;
    return [u(0), u(1), u(2), u(3), u(4), u(5)];
  }
}

const gauss = (u1: number, u2: number) => Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

// --- timing (one global clock; tick 0 = Unix epoch) -------------------------------------

export const currentTickIndex = () => Math.floor(Date.now() / 1000 / TICK_SECONDS);
export const latestClosedTick = () => currentTickIndex() - 1;
export const tickEndMs = (tick: number) => (tick + 1) * TICK_SECONDS * 1000;
export const tickIsClosed = (tick: number) => Date.now() >= tickEndMs(tick);
export const secondsUntilClosed = (tick: number) => Math.max(0, (tickEndMs(tick) - Date.now()) / 1000);
const tickTimestamp = (tick: number) => new Date(tick * TICK_SECONDS * 1000).toISOString();

// --- series ---------------------------------------------------------------------------

type Ticks = { open: Float64Array; high: Float64Array; low: Float64Array; close: Float64Array };

/** Fills r[0..to-from] with the tick returns of ticks [from, to] (and wig with their intrabar wiggle). */
function fillReturns(stream: Stream, p: SymbolProfile, from: number, to: number, r: Float64Array, wig?: Float64Array) {
  let lastRegime = NaN, volMult = 1;
  for (let i = from; i <= to; i++) {
    const regime = Math.floor(i / VOL_REGIME_TICKS);
    if (regime !== lastRegime) {
      const [a, b] = stream.draw(TAG_REGIME, regime);
      volMult = Math.exp(0.55 * gauss(a, b)); // volatility mood: calm or stormy
      lastRegime = regime;
    }
    const [u1, u2, u3, u4, u5] = stream.draw(TAG_TICK, i);
    const jump = u5 < JUMP_CHANCE ? JUMP_SIZE : 1;
    r[i - from] = p.volatility * volMult * jump * gauss(u1, u2); // symmetric around zero: no drift, ever
    if (wig) wig[i - from] = Math.abs((p.volatility / 2) * volMult * gauss(u3, u4));
  }
}

// Sums of returns over fixed blocks of ticks are immutable, so they are cached and shared: the
// long lookback window then costs a few hundred hashes per request instead of tens of thousands.
const BLOCK = 250;
const blockCache = new Map<string, number>();

function blockSum(stream: Stream, p: SymbolProfile, id: string, b: number): number {
  const k = `${id}|${b}`;
  let v = blockCache.get(k);
  if (v === undefined) {
    const buf = new Float64Array(BLOCK);
    fillReturns(stream, p, b * BLOCK, (b + 1) * BLOCK - 1, buf);
    v = 0;
    for (let j = 0; j < BLOCK; j++) v += buf[j];
    if (blockCache.size > 6000) blockCache.clear();
    blockCache.set(k, v);
  }
  return v;
}

/** Sum of the returns of ticks [lo, hi]. */
function rangeSum(stream: Stream, p: SymbolProfile, id: string, lo: number, hi: number): number {
  const firstBlock = Math.ceil(lo / BLOCK), lastBlock = Math.floor((hi + 1) / BLOCK) - 1;
  let total = 0;
  const direct = (a: number, z: number) => {
    if (z < a) return;
    const buf = new Float64Array(z - a + 1);
    fillReturns(stream, p, a, z, buf);
    for (let j = 0; j < buf.length; j++) total += buf[j];
  };
  if (lastBlock < firstBlock) {
    direct(lo, hi);
  } else {
    direct(lo, firstBlock * BLOCK - 1);
    for (let b = firstBlock; b <= lastBlock; b++) total += blockSum(stream, p, id, b);
    direct((lastBlock + 1) * BLOCK, hi);
  }
  return total;
}

/** Raw (unrounded) OHLC for every tick in [from, to]. */
function computeTicks(key: Uint8Array, symbol: string, from: number, to: number): Ticks {
  const p = SYMBOL_PROFILES[symbol];
  if (!p) throw new Error(`Unknown symbol '${symbol}'`);
  const stream = new Stream(key);
  const W = LOOKBACK_WINDOW;
  const len = to - from + 1;
  const id = symbol + ":" + key[0] + key[1] + key[2] + key[3];

  const rNew = new Float64Array(len); // returns entering the window
  const wig = new Float64Array(len);
  fillReturns(stream, p, from, to, rNew, wig);
  const rOld = new Float64Array(len); // returns leaving it: the ticks W earlier
  fillReturns(stream, p, from - W, to - W, rOld);

  // S(t) = sum of returns over ticks (t-W, t]; start at S(from-1), then slide forward.
  let s = rangeSum(stream, p, id, from - W, from - 1);
  let prev = p.basePrice * Math.exp(s);

  const out: Ticks = {
    open: new Float64Array(len), high: new Float64Array(len), low: new Float64Array(len), close: new Float64Array(len),
  };
  for (let k = 0; k < len; k++) {
    s += rNew[k] - rOld[k];
    const close = p.basePrice * Math.exp(s);
    out.open[k] = prev;
    out.close[k] = close;
    out.high[k] = Math.max(prev, close) * (1 + wig[k]);
    out.low[k] = Math.min(prev, close) * (1 - wig[k]);
    prev = close;
  }
  return out;
}

const round4 = (x: number) => Math.round(x * 10000) / 10000;

/** Chart scales: how many ticks fold into one bar, and how many bars are shown. */
export const RANGES = {
  "3m": { ticksPerBar: 1, bars: 60 }, // 60 x 3s   = 3 minutes
  "15m": { ticksPerBar: 5, bars: 60 }, // 60 x 15s  = 15 minutes
  "1h": { ticksPerBar: 20, bars: 60 }, // 60 x 1m   = 1 hour
  "6h": { ticksPerBar: 100, bars: 72 }, // 72 x 5m   = 6 hours
  "24h": { ticksPerBar: 300, bars: 96 }, // 96 x 15m  = 24 hours
} as const;
export type Range = keyof typeof RANGES;
export const isRange = (v: string): v is Range => v in RANGES;

/** `bars` candles ending at the bar containing `latestTick` (the last may still be forming). */
export function getBars(
  key: Uint8Array, symbol: string, latestTick: number, ticksPerBar: number, bars: number,
): Candle[] {
  const lastBar = Math.floor(latestTick / ticksPerBar);
  const firstTick = (lastBar - bars + 1) * ticksPerBar;
  const t = computeTicks(key, symbol, firstTick, latestTick);

  const candles: Candle[] = [];
  for (let b = lastBar - bars + 1; b <= lastBar; b++) {
    const a = b * ticksPerBar - firstTick;
    const z = Math.min((b + 1) * ticksPerBar - 1 - firstTick, latestTick - firstTick);
    let high = -Infinity, low = Infinity;
    for (let k = a; k <= z; k++) {
      if (t.high[k] > high) high = t.high[k];
      if (t.low[k] < low) low = t.low[k];
    }
    candles.push({
      tick_index: b * ticksPerBar,
      timestamp: tickTimestamp(b * ticksPerBar),
      open: round4(t.open[a]),
      high: round4(high),
      low: round4(low),
      close: round4(t.close[z]),
      volume: 0,
    });
  }
  return candles;
}

export const getView = (key: Uint8Array, symbol: string, latestTick: number, range: Range) =>
  getBars(key, symbol, latestTick, RANGES[range].ticksPerBar, RANGES[range].bars);

export const getCandle = (key: Uint8Array, symbol: string, tick: number) => getBars(key, symbol, tick, 1, 1)[0];

let pricesMemo: { tick: number; secret: string; value: { prices: Record<string, number>; changes: Record<string, number> } } | null = null;

/** Latest closed-tick price and 24h change (%) for every city market, for the ticker. Computed once
 * per tick and shared by every caller. */
export function latestPrices(secret: string): { prices: Record<string, number>; changes: Record<string, number> } {
  const tick = latestClosedTick();
  if (pricesMemo && pricesMemo.tick === tick && pricesMemo.secret === secret) return pricesMemo.value;
  const dayAgo = tick - Math.round(86400 / TICK_SECONDS);
  const prices: Record<string, number> = {};
  const changes: Record<string, number> = {};
  for (const symbol of Object.keys(SYMBOL_PROFILES)) {
    const key = marketKey(secret, symbol);
    const now = getCandle(key, symbol, tick).close;
    const then = getCandle(key, symbol, dayAgo).close;
    prices[symbol] = now;
    changes[symbol] = ((now - then) / then) * 100;
  }
  pricesMemo = { tick, secret, value: { prices, changes } };
  return pricesMemo.value;
}
