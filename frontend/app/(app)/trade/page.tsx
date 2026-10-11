"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import { useAppData } from "@/lib/app-data";
import { RANGES, formatPrice, pairLabel, type RangeId } from "@/lib/markets";
import { fmtKes, fmtPct, signed } from "@/lib/money";
import { card } from "@/lib/ui";
import PriceChart from "@/components/PriceChart";
import MarketList from "@/components/MarketList";
import MarketPicker from "@/components/MarketPicker";
import MarketBadge from "@/components/MarketBadge";
import WorldMarkets from "@/components/WorldMarkets";
import OrderPanel, { type Currency, type ResolveResult } from "@/components/OrderPanel";

type Bar = { timestamp: string; open: number; high: number; low: number; close: number; volume: number };
type Pending = { direction: "up" | "down"; stake: number; currency: Currency; entry_price: number; seconds_remaining: number };
type Round = {
  symbol: string; kind: "crypto" | "sim"; tick_seconds: number; bet_seconds: number;
  bars: Bar[]; entry_price: number; payout_rate: number; pending: Pending | null;
};
type HistoryItem = {
  id: string; symbol: string; direction: string; stake: number; currency: Currency;
  correct: boolean; draw?: boolean; payout: number; created_at: string;
};

const CANDLE_LABEL: Record<"sim" | "crypto", Record<RangeId, string>> = {
  sim: { "3m": "3s", "15m": "15s", "1h": "1m", "6h": "5m", "24h": "15m" },
  crypto: { "3m": "3s", "15m": "1m", "1h": "1m", "6h": "5m", "24h": "15m" },
};

export default function TradePage() {
  const { markets, prices, changes, selected: symbol, select, refreshStats } = useAppData();
  const market = markets.find((m) => m.id === symbol);

  const [range, setRange] = useState<RangeId>("3m");
  const [round, setRound] = useState<Round | null>(null);
  const [bars, setBars] = useState<Bar[]>([]);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [roundLoading, setRoundLoading] = useState(true);
  const [roundError, setRoundError] = useState<string | null>(null);

  const [stake, setStake] = useState("10");
  const [currency, setCurrency] = useState<Currency>("points");
  const [pendingDirection, setPendingDirection] = useState<"up" | "down" | null>(null);
  const [lockedEntry, setLockedEntry] = useState<number | null>(null);
  const [revealAt, setRevealAt] = useState<number | null>(null);
  const [waitTotal, setWaitTotal] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const roundRef = useRef<Round | null>(null);
  roundRef.current = round;
  const roundReqRef = useRef(0); // only the newest startRound() may apply its response
  const rangeRef = useRef<RangeId>(range);
  rangeRef.current = range;
  const pendingRef = useRef<"up" | "down" | null>(null);
  pendingRef.current = pendingDirection;

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await apiFetch("/api/predict/history?limit=8"));
    } catch {
      // non-critical
    }
  }, []);

  // One path sets the chart data: a full, ordered replace from the server. Responses for a
  // market/scale the user has already left are dropped.
  const refreshBars = useCallback(async (syncPrice: boolean) => {
    const r = roundRef.current;
    if (!r) return;
    const askedRange = rangeRef.current;
    try {
      const data = await apiFetch(`/api/predict/live?symbol=${encodeURIComponent(r.symbol)}&range=${askedRange}`);
      if (roundRef.current?.symbol !== r.symbol || rangeRef.current !== askedRange) return;
      setBars(data.bars);
      if (syncPrice && data.bars.length > 0) setLastPrice(data.bars[data.bars.length - 1].close);
    } catch {
      // transient - next poll retries
    }
  }, []);

  const startRound = useCallback(async (nextSymbol: string) => {
    const reqId = ++roundReqRef.current;
    setRoundLoading(true);
    setRoundError(null);
    setResult(null);
    setResultError(null);
    setPendingDirection(null);
    setRevealAt(null);
    setLockedEntry(null);
    setBars([]);
    try {
      const data: Round = await apiFetch(`/api/predict/round?symbol=${encodeURIComponent(nextSymbol)}`);
      if (roundReqRef.current !== reqId) return; // user already moved on to another market
      setRound(data);
      roundRef.current = data;
      setLastPrice(data.entry_price);
      setBars(data.bars);
      if (rangeRef.current !== "3m") refreshBars(false);
      // A bet locked earlier (reload / market switch) is still live on the server: resume it.
      if (data.pending) {
        setStake(String(data.pending.stake));
        setCurrency(data.pending.currency);
        setLockedEntry(data.pending.entry_price);
        setWaitTotal(Math.max(1, data.pending.seconds_remaining));
        setRevealAt(Date.now() + data.pending.seconds_remaining * 1000);
        setPendingDirection(data.pending.direction);
      }
    } catch (err) {
      if (roundReqRef.current !== reqId) return;
      setRoundError(err instanceof ApiError ? err.message : "Failed to load this market");
    } finally {
      if (roundReqRef.current === reqId) setRoundLoading(false);
    }
  }, [refreshBars]);

  useEffect(() => {
    startRound(symbol);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Live refresh so the chart keeps advancing on its own.
  useEffect(() => {
    if (!round) return;
    const interval = setInterval(() => refreshBars(true), round.tick_seconds * 1000);
    return () => clearInterval(interval);
  }, [round, refreshBars]);

  useEffect(() => {
    if (round) refreshBars(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  useEffect(() => {
    if (!pendingDirection || revealAt === null) {
      setCountdown(0);
      return;
    }
    const tick = () => setCountdown(Math.max(0, (revealAt - Date.now()) / 1000));
    tick();
    const interval = setInterval(tick, 200);
    return () => clearInterval(interval);
  }, [pendingDirection, revealAt]);

  const placeGuess = (direction: "up" | "down") => {
    setPendingDirection(direction);
    setResultError(null);
    setResult(null);
    setWaitTotal(0);
  };

  // Submits the guess; the server locks it on first receipt, then we poll until it is final.
  useEffect(() => {
    if (!pendingDirection || !round) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const attempt = async () => {
      try {
        const res: ResolveResult = await apiFetch("/api/predict/resolve", {
          method: "POST",
          body: JSON.stringify({ symbol: round.symbol, direction: pendingDirection, stake: parseFloat(stake), currency }),
        });
        if (cancelled) return;
        setResult(res);
        setPendingDirection(null);
        setRevealAt(null);
        setLockedEntry(null);
        await Promise.all([refreshStats(), loadHistory(), refreshBars(false)]);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 425) {
          let remaining = 1;
          try {
            const info = JSON.parse(err.message);
            remaining = Number(info.seconds_remaining) || 1;
            if (typeof info.entry_price === "number") setLockedEntry(info.entry_price);
          } catch {
            // keep default
          }
          setWaitTotal((t) => Math.max(t, remaining));
          setRevealAt(Date.now() + remaining * 1000);
          refreshStats(); // the stake is held in escrow, so the balance just dropped
          const delay = remaining > 6 ? 3000 : Math.min(600, Math.max(150, remaining * 1000 + 120));
          timer = setTimeout(attempt, delay);
        } else {
          setResultError(err instanceof ApiError ? err.message : "Failed to submit prediction");
          setPendingDirection(null);
          setRevealAt(null);
        }
      }
    };
    attempt();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDirection]);

  const displayPrice = lastPrice ?? prices[symbol] ?? null;
  const change = changes[symbol];

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[270px_minmax(0,1fr)_360px]">
      <div className="hidden xl:block">
        <MarketList active={symbol} onSelect={select} />
      </div>

      {/* Centre column on desktop. On small screens the wrappers vanish (contents) and `order`
          puts the pieces in reading order: chart, order ticket, recent trades, market info. */}
      <div className="contents min-w-0 lg:flex lg:flex-col lg:gap-5">
        <div className="xl:hidden">
          <MarketPicker markets={markets} active={symbol} onSelect={select} />
        </div>

        <section className={`${card} order-1 p-4 sm:p-5 lg:order-none`}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {market && <MarketBadge market={market} size="lg" />}
              <div>
                <h1 className="text-xl font-bold leading-tight text-slate-900">{market ? pairLabel(market) : symbol}</h1>
                <p className="text-xs text-slate-500">
                  {market?.kind === "crypto" ? `${market.label} · real market` : "Simulated city market"}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="tabular font-mono text-3xl font-bold tracking-tight text-slate-900">
                <span className="mr-1 text-xl font-semibold text-slate-400">{market?.quoteGlyph}</span>
                {formatPrice(displayPrice)}
              </p>
              <p className={`tabular text-sm font-semibold ${change === undefined ? "text-slate-400" : change >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {fmtPct(change)} <span className="font-normal text-slate-400">24h</span>
              </p>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRange(r.id)}
                  className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                    range === r.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <span className="text-xs text-slate-400">Each candle = {CANDLE_LABEL[market?.kind ?? "sim"][range]}</span>
          </div>

          <div className="min-h-[420px] overflow-hidden rounded-xl border border-slate-100">
            {roundError ? (
              <p className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{roundError}</p>
            ) : roundLoading || bars.length === 0 ? (
              <div className="flex h-[420px] items-center justify-center gap-3 text-sm text-slate-400">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-emerald-600" />
                Loading market...
              </div>
            ) : (
              <PriceChart bars={bars} fitKey={`${symbol}|${range}`} />
            )}
          </div>
        </section>

        <div className="order-3 lg:order-none lg:flex-1">
          <section className={`${card} flex h-full flex-col p-4 sm:p-5`}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">Recent trades</h2>
              <Link href="/history" className="text-xs font-semibold text-emerald-600 hover:text-emerald-700">
                View all
              </Link>
            </div>
            {history.length === 0 ? (
              <div className="flex flex-1 items-center justify-center py-8 text-center text-sm text-slate-400">
                No trades yet. Place your first prediction.
              </div>
            ) : (
              <ul className="flex-1 divide-y divide-slate-100">
                {history.map((h) => {
                  const hm = markets.find((m) => m.id === h.symbol);
                  return (
                    <li key={h.id} className="flex items-center gap-3 py-2.5">
                      {hm && <MarketBadge market={hm} size="sm" />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">{hm ? pairLabel(hm) : h.symbol}</p>
                        <p className="text-[11px] text-slate-400">
                          {h.direction === "up" ? "▲ Higher" : "▼ Lower"} · {new Date(h.created_at).toLocaleTimeString()}
                        </p>
                      </div>
                      <span
                        className={`tabular text-sm font-semibold ${
                          h.draw ? "text-slate-500" : h.payout > 0 ? "text-emerald-600" : "text-red-600"
                        }`}
                      >
                        {h.draw ? "Draw" : signed(h.payout, (n) => (h.currency === "kes" ? fmtKes(n) : `${n.toFixed(2)} pts`))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* Right column on desktop: order ticket on top, market info filling the rest. */}
      <div className="contents lg:flex lg:flex-col lg:gap-5">
        <div className="order-2 lg:order-none">
          <OrderPanel
            market={market}
            payoutRate={round?.payout_rate ?? 0.85}
            currency={currency}
            setCurrency={setCurrency}
            stake={stake}
            setStake={setStake}
            pending={pendingDirection ? { direction: pendingDirection, entry: lockedEntry, countdown, total: waitTotal } : null}
            onPlace={placeGuess}
            result={result}
            error={resultError}
            crypto={round?.kind === "crypto"}
          />
        </div>
        <div className="order-4 lg:order-none lg:flex-1">
          <WorldMarkets active={symbol} onSelect={select} />
        </div>
      </div>
    </div>
  );
}
