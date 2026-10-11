"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { useAppData } from "@/lib/app-data";
import { formatPrice, pairLabel } from "@/lib/markets";
import { fmtKes, fmtUsd, signed } from "@/lib/money";
import { card } from "@/lib/ui";
import MarketBadge from "@/components/MarketBadge";

type Item = {
  id: string; symbol: string; direction: string; stake: number; currency: "points" | "kes";
  entry_price: number; exit_price: number; correct: boolean; draw?: boolean; payout: number; created_at: string;
};
type Filter = "all" | "points" | "kes";

export default function HistoryPage() {
  const { markets, kesToUsd } = useAppData();
  const [items, setItems] = useState<Item[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    apiFetch("/api/predict/history?limit=200").then(setItems).catch(() => setItems([]));
  }, []);

  const marketLabel = (id: string) => { const m = markets.find((x) => x.id === id); return m ? pairLabel(m) : id; };
  const shown = useMemo(() => (items ?? []).filter((i) => filter === "all" || i.currency === filter), [items, filter]);
  const summary = useMemo(() => {
    const decided = shown.filter((i) => !i.draw);
    const wins = decided.filter((i) => i.correct).length;
    const net = (c: "points" | "kes") => shown.filter((i) => i.currency === c).reduce((s, i) => s + i.payout, 0);
    const chrono = [...decided].reverse(); // oldest -> newest
    let best = 0, run = 0;
    for (const t of chrono) { run = t.correct ? run + 1 : 0; best = Math.max(best, run); }
    let current = 0;
    for (let i = chrono.length - 1; i >= 0 && chrono[i].correct; i--) current++;
    const counts = new Map<string, number>();
    for (const t of shown) counts.set(t.symbol, (counts.get(t.symbol) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const stakedPoints = shown.filter((i) => i.currency === "points").reduce((x, i) => x + i.stake, 0);
    const stakedKes = shown.filter((i) => i.currency === "kes").reduce((x, i) => x + i.stake, 0);
    return {
      trades: shown.length, winRate: decided.length ? (wins / decided.length) * 100 : null, netPoints: net("points"), netKes: net("kes"),
      wins, losses: decided.length - wins, draws: shown.length - decided.length, best, current, top, stakedPoints, stakedKes,
      form: shown.slice(0, 24).reverse(),
    };
  }, [shown]);

  const tile = (labelText: string, value: string, tone = "text-slate-900", sub?: string) => (
    <div className={`${card} p-5`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{labelText}</p>
      <p className={`tabular mt-2 text-2xl font-bold ${tone}`}>{value}</p>
      {sub && <p className="tabular mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Trade history</h1>
          <p className="mt-1 text-sm text-slate-500">Your last 200 settled predictions.</p>
        </div>
        <div className="flex gap-1 rounded-xl bg-slate-200/60 p-1">
          {([["all", "All"], ["points", "Practice"], ["kes", "Real money"]] as [Filter, string][]).map(([id, text]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                filter === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {text}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tile("Trades", String(summary.trades))}
        {tile("Win rate", summary.winRate === null ? "-" : `${summary.winRate.toFixed(0)}%`)}
        {tile(
          "Practice P&L",
          signed(summary.netPoints, (n) => `${n.toFixed(2)} pts`),
          summary.netPoints >= 0 ? "text-emerald-600" : "text-red-600",
        )}
        {tile(
          "Real P&L",
          signed(summary.netKes, (n) => fmtUsd(kesToUsd(n))),
          summary.netKes >= 0 ? "text-emerald-600" : "text-red-600",
          fmtKes(summary.netKes),
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className={`${card} flex flex-col overflow-hidden`}>
        <div className="hidden grid-cols-[1.6fr_0.8fr_1.4fr_0.9fr_1fr] gap-4 border-b border-slate-100 bg-slate-50 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400 md:grid">
          <span>Market</span>
          <span>Side</span>
          <span>Entry → Exit</span>
          <span>Stake</span>
          <span className="text-right">Result</span>
        </div>
        {items === null ? (
          <div className="flex flex-1 items-center justify-center py-16 text-sm text-slate-400">Loading...</div>
        ) : shown.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
            <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-2xl">📈</span>
            <p className="text-base font-bold text-slate-900">No trades here yet</p>
            <p className="mt-1 max-w-sm text-sm text-slate-500">Every settled prediction shows up here with its entry, exit and result.</p>
            <Link href="/trade" className="mt-5 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700">
              Start trading
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((h) => {
              const m = markets.find((x) => x.id === h.symbol);
              const isKes = h.currency === "kes";
              const tone = h.draw ? "text-slate-500" : h.payout > 0 ? "text-emerald-600" : "text-red-600";
              return (
                <li key={h.id} className="grid grid-cols-[1fr_auto] items-center gap-3 px-5 py-3.5 md:grid-cols-[1.6fr_0.8fr_1.4fr_0.9fr_1fr] md:gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    {m && <MarketBadge market={m} size="md" />}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {m ? pairLabel(m) : h.symbol}
                        {isKes && <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">REAL</span>}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {new Date(h.created_at).toLocaleString()}
                        <span className="md:hidden"> · {h.direction === "up" ? "▲ Higher" : "▼ Lower"}</span>
                      </p>
                    </div>
                  </div>
                  <span className={`hidden text-sm font-semibold md:block ${h.direction === "up" ? "text-emerald-600" : "text-red-600"}`}>
                    {h.direction === "up" ? "▲ Higher" : "▼ Lower"}
                  </span>
                  <span className="tabular hidden font-mono text-xs text-slate-600 md:block">
                    {formatPrice(h.entry_price)} → {formatPrice(h.exit_price)}
                  </span>
                  <span className="tabular hidden text-sm text-slate-700 md:block">
                    {isKes ? fmtKes(h.stake) : `${h.stake} pts`}
                  </span>
                  <div className="text-right">
                    <p className={`tabular text-sm font-bold ${tone}`}>
                      {h.draw ? "Draw" : signed(h.payout, (n) => (isKes ? fmtKes(n) : `${n.toFixed(2)} pts`))}
                    </p>
                    {isKes && !h.draw && <p className="tabular text-[11px] text-slate-400">≈ {signed(h.payout, (n) => fmtUsd(kesToUsd(n)))}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={`${card} flex flex-col p-5`}>
        <h2 className="text-sm font-bold text-slate-900">Performance</h2>
        <p className="mt-0.5 text-xs text-slate-500">Recent form, oldest to newest</p>
        <div className="mt-3 flex h-10 items-end gap-1">
          {summary.form.length === 0 ? (
            <span className="text-xs text-slate-400">Your results will appear here.</span>
          ) : (
            summary.form.map((t) => (
              <span
                key={t.id}
                title={t.draw ? "Draw" : t.correct ? "Win" : "Loss"}
                className={`w-full max-w-[14px] rounded-sm ${t.draw ? "h-3 bg-slate-300" : t.correct ? "h-10 bg-emerald-500" : "h-6 bg-red-400"}`}
              />
            ))
          )}
        </div>

        <dl className="mt-5 divide-y divide-slate-100 text-sm">
          {[
            ["Wins / losses / draws", `${summary.wins} / ${summary.losses} / ${summary.draws}`],
            ["Best win streak", String(summary.best)],
            ["Current win streak", String(summary.current)],
            ["Most traded", summary.top ? `${marketLabel(summary.top[0])} (${summary.top[1]})` : "-"],
            ["Total staked (practice)", `${summary.stakedPoints.toFixed(0)} pts`],
            ["Total staked (real)", summary.stakedKes ? `${fmtUsd(kesToUsd(summary.stakedKes))}` : "-"],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3 py-2.5">
              <dt className="text-slate-500">{k}</dt>
              <dd className="tabular text-right font-semibold text-slate-900">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-auto pt-4 text-[11px] leading-relaxed text-slate-400">
          Streaks ignore draws. Real-money figures are shown in US dollars at the live rate.
        </p>
      </section>
      </div>
    </div>
  );
}
