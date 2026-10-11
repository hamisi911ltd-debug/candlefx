"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import type { Market } from "@/lib/markets";

export type Stats = {
  points_balance: number;
  real_balance_kes: number;
  total_predictions: number;
  correct_predictions: number;
  payout_rate: number;
};
export type Fx = { kes_per_usd: number; usd_per_kes: number; source: "live" | "fallback" };
type Dir = "up" | "down" | "flat";

type AppData = {
  markets: Market[];
  prices: Record<string, number>;
  changes: Record<string, number>; // 24h change, %
  dirs: Record<string, Dir>; // last tick direction, for flashing prices
  stats: Stats | null;
  refreshStats: () => Promise<void>;
  fx: Fx | null;
  kesToUsd: (kes: number) => number;
  selected: string;
  select: (id: string) => void;
};

const Ctx = createContext<AppData | null>(null);
const STORAGE_KEY = "cfx.market";
const DEFAULT_MARKET = "BTC-USDT";

/** Everything the signed-in pages share: markets, live prices, balances and the USD rate. */
export function AppDataProvider({ children }: { children: ReactNode }) {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [changes, setChanges] = useState<Record<string, number>>({});
  const [dirs, setDirs] = useState<Record<string, Dir>>({});
  const [stats, setStats] = useState<Stats | null>(null);
  const [fx, setFx] = useState<Fx | null>(null);
  const [selected, setSelected] = useState(DEFAULT_MARKET);
  const lastRef = useRef<Record<string, number>>({});

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setSelected(saved);
    } catch {
      // storage unavailable - keep default
    }
  }, []);

  const select = useCallback((id: string) => {
    setSelected(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // ignore
    }
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      setStats(await apiFetch("/api/predict/account"));
    } catch {
      // keep last known stats
    }
  }, []);

  useEffect(() => {
    apiFetch("/api/predict/markets").then(setMarkets).catch(() => {});
    refreshStats();
    const loadFx = () => apiFetch("/api/predict/fx").then(setFx).catch(() => {});
    loadFx();
    const fxTimer = setInterval(loadFx, 30 * 60 * 1000);
    return () => clearInterval(fxTimer);
  }, [refreshStats]);

  // One shared price poll for the whole app.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await apiFetch("/api/predict/prices");
        if (cancelled) return;
        const next: Record<string, number> = data.prices;
        const d: Record<string, Dir> = {};
        for (const [id, p] of Object.entries(next)) {
          const prev = lastRef.current[id];
          if (prev !== undefined && prev !== p) d[id] = p > prev ? "up" : "down";
        }
        lastRef.current = next;
        setPrices(next);
        setChanges(data.changes ?? {});
        setDirs((old) => ({ ...old, ...d }));
      } catch {
        // transient - next poll retries
      }
    };
    tick();
    const poll = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, []);

  const kesToUsd = useCallback((kes: number) => kes * (fx?.usd_per_kes ?? 1 / 129), [fx]);

  const value = useMemo(
    () => ({ markets, prices, changes, dirs, stats, refreshStats, fx, kesToUsd, selected, select }),
    [markets, prices, changes, dirs, stats, refreshStats, fx, kesToUsd, selected, select],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppData(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppData must be used within AppDataProvider");
  return v;
}
