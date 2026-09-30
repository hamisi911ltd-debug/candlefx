"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

type TickerState = {
  symbol: string;
  price: number | null;
  direction: "up" | "down" | "flat";
};

type RoundSeed = { symbol: string; seed: string; start_time: number; tick_seconds: number };

export default function LiveTicker({ symbols }: { symbols: string[] }) {
  const [tickers, setTickers] = useState<TickerState[]>(symbols.map((s) => ({ symbol: s, price: null, direction: "flat" })));
  const seedsRef = useRef<Map<string, RoundSeed>>(new Map());
  const lastPriceRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    let cancelled = false;

    const initSeeds = async () => {
      for (const symbol of symbols) {
        try {
          const round = await apiFetch(`/api/predict/round?symbol=${encodeURIComponent(symbol)}`);
          if (cancelled) return;
          seedsRef.current.set(symbol, {
            symbol,
            seed: round.seed,
            start_time: round.start_time,
            tick_seconds: round.tick_seconds,
          });
          lastPriceRef.current.set(symbol, round.entry_price);
          setTickers((prev) => prev.map((t) => (t.symbol === symbol ? { ...t, price: round.entry_price } : t)));
        } catch {
          // will just show "-" for this symbol
        }
      }
    };
    initSeeds();

    const poll = setInterval(async () => {
      for (const symbol of symbols) {
        const seedInfo = seedsRef.current.get(symbol);
        if (!seedInfo) continue;
        try {
          const data = await apiFetch(
            `/api/predict/live?symbol=${encodeURIComponent(symbol)}&seed=${seedInfo.seed}&start_time=${seedInfo.start_time}`
          );
          const latestBar = data.bars[data.bars.length - 1];
          if (!latestBar) continue;
          const prevPrice = lastPriceRef.current.get(symbol);
          const direction: TickerState["direction"] =
            prevPrice === undefined || latestBar.close === prevPrice ? "flat" : latestBar.close > prevPrice ? "up" : "down";
          lastPriceRef.current.set(symbol, latestBar.close);
          setTickers((prev) => prev.map((t) => (t.symbol === symbol ? { symbol, price: latestBar.close, direction } : t)));
        } catch {
          // transient - next poll retries
        }
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <h2 className="mb-3 text-sm font-medium text-slate-400">Live prices</h2>
      <ul className="space-y-2">
        {tickers.map((t) => (
          <li key={t.symbol} className="flex items-center justify-between text-sm">
            <span className="text-slate-300">{t.symbol}</span>
            <span
              className={`font-mono font-medium transition-colors duration-300 ${
                t.direction === "up" ? "text-blue-400" : t.direction === "down" ? "text-red-400" : "text-slate-400"
              }`}
            >
              {t.price !== null ? t.price.toFixed(2) : "-"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
