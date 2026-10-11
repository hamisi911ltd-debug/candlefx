"use client";

import { useState } from "react";
import { useAppData } from "@/lib/app-data";
import { formatPrice, pairLabel } from "@/lib/markets";
import { fmtPct } from "@/lib/money";
import MarketBadge from "@/components/MarketBadge";
import { card } from "@/lib/ui";

type Tab = "crypto" | "sim" | "all";
const TABS: { id: Tab; label: string }[] = [
  { id: "crypto", label: "Crypto" },
  { id: "sim", label: "Cities" },
  { id: "all", label: "All" },
];

/** Compact market watchlist for the trading terminal's left rail. */
export default function MarketList({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
  const { markets, prices, changes, dirs } = useAppData();
  const [tab, setTab] = useState<Tab>("crypto");
  const items = markets.filter((m) => tab === "all" || m.kind === tab);

  return (
    <section className={`${card} flex h-full flex-col p-3`}>
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-slate-900">Markets</h2>
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Live
        </span>
      </div>
      <div className="mb-2 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md py-1 text-xs font-semibold transition-colors ${
              tab === t.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <ul className="flex flex-1 flex-col">
        {items.map((m) => {
          const isActive = m.id === active;
          const dir = dirs[m.id] ?? "flat";
          const ch = changes[m.id];
          return (
            <li key={m.id} className="flex flex-1">
              <button
                onClick={() => onSelect(m.id)}
                className={`flex w-full min-h-[46px] items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                  isActive ? "bg-emerald-50 ring-1 ring-emerald-200" : "hover:bg-slate-50"
                }`}
              >
                <MarketBadge market={m} size="md" />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${isActive ? "font-semibold text-slate-900" : "font-medium text-slate-800"}`}>
                    {pairLabel(m)}
                  </span>
                  <span className={`tabular block text-[11px] ${ch === undefined ? "text-slate-400" : ch >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {fmtPct(ch)}
                  </span>
                </span>
                <span
                  className={`tabular font-mono text-xs font-semibold transition-colors duration-300 ${
                    dir === "up" ? "text-emerald-600" : dir === "down" ? "text-red-600" : "text-slate-800"
                  }`}
                >
                  {formatPrice(prices[m.id])}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
