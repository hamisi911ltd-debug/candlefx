import { seededChoice, seededGaussian } from "./rng";

/** Regime-switching random walk: every REGIME_TICKS ticks, a new hidden drift
 * (trend direction/strength, or flat) is drawn and held constant until the next
 * switch, with independent Gaussian noise added every tick. Pure trend-following
 * and pure contrarian guessing both break whenever the hidden regime flips - there
 * is no fixed exploitable pattern. Everything here is a pure function of
 * (seed, symbol, tick_index); only `currentTickIndex` depends on real time. */

export const TICK_SECONDS = 5;
export const REGIME_TICKS = 8; // ~40s per regime at 5s/tick
const LOOKBACK_WINDOW = 200;
const DRIFT_CHOICES = [-1.0, -0.6, -0.3, 0.0, 0.3, 0.6, 1.0];

export interface SymbolProfile {
  basePrice: number;
  driftScale: number;
  volatility: number;
}

export const SYMBOL_PROFILES: Record<string, SymbolProfile> = {
  "SIM-CALM": { basePrice: 100.0, driftScale: 0.0015, volatility: 0.004 },
  "SIM-STEADY": { basePrice: 250.0, driftScale: 0.0025, volatility: 0.007 },
  "SIM-WILD": { basePrice: 50.0, driftScale: 0.004, volatility: 0.014 },
};

export interface Candle {
  tickIndex: number;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function currentTickIndex(startTime: number): number {
  return Math.floor((Date.now() / 1000 - startTime) / TICK_SECONDS);
}

export function tickIsClosed(startTime: number, tickIndex: number): boolean {
  return Date.now() / 1000 >= startTime + (tickIndex + 1) * TICK_SECONDS;
}

export function secondsUntilClosed(startTime: number, tickIndex: number): number {
  return Math.max(0, startTime + (tickIndex + 1) * TICK_SECONDS - Date.now() / 1000);
}

export function tickTimestamp(startTime: number, tickIndex: number): string {
  return new Date((startTime + tickIndex * TICK_SECONDS) * 1000).toISOString();
}

function regimeDrift(seed: string, symbol: string, regimeIndex: number, driftScale: number): number {
  return seededChoice(DRIFT_CHOICES, seed, symbol, "regime", regimeIndex) * driftScale;
}

function tickLogReturn(seed: string, symbol: string, tickIndex: number, profile: SymbolProfile): number {
  const regimeIndex = Math.floor(tickIndex / REGIME_TICKS);
  const drift = regimeDrift(seed, symbol, regimeIndex, profile.driftScale);
  const noise = seededGaussian(profile.volatility, seed, symbol, "tick", tickIndex);
  return drift + noise;
}

export function getCandles(
  seed: string,
  symbol: string,
  startTime: number,
  count: number,
  endTickIndex: number
): Candle[] {
  const profile = SYMBOL_PROFILES[symbol];
  if (!profile) throw new Error(`Unknown symbol '${symbol}'`);

  const window = Math.max(count + 5, LOOKBACK_WINDOW);
  const pathStart = endTickIndex - window + 1;

  let price = profile.basePrice;
  const candles: Candle[] = [];
  for (let idx = pathStart; idx <= endTickIndex; idx++) {
    const ret = tickLogReturn(seed, symbol, idx, profile);
    const openPrice = price;
    const closePrice = price * Math.exp(ret);
    const wiggle = seededGaussian(profile.volatility / 2, seed, symbol, "wiggle", idx);
    const high = Math.max(openPrice, closePrice) * (1 + Math.abs(wiggle));
    const low = Math.min(openPrice, closePrice) * (1 - Math.abs(wiggle));
    candles.push({
      tickIndex: idx,
      timestamp: tickTimestamp(startTime, idx),
      open: round4(openPrice),
      high: round4(high),
      low: round4(low),
      close: round4(closePrice),
      volume: 0,
    });
    price = closePrice;
  }

  return candles.slice(-count);
}

export function getCandle(seed: string, symbol: string, startTime: number, tickIndex: number): Candle {
  return getCandles(seed, symbol, startTime, 1, tickIndex)[0];
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
