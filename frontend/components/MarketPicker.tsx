"use client";

import { useState } from "react";
import type { Market } from "@/lib/markets";
import MarketBadge from "@/components/MarketBadge";

const FEATURED = ["BTC-USDT", "ETH-USDT", "SOL-USDT", "XRP-USDT", "DOGE-USDT", "NAIROBI", "LONDON", "NEWYORK"];

const short = (m: Market) => (m.kind === "crypto" ? `${m.base}${m.quote !== "USDT" ? "/" + m.quote : ""}` : m.label);

/** Quick market switcher for smaller screens: featured markets, the rest one tap away. Wraps, never scrolls. */
export default function MarketPicker({
  markets,
  active,
  onSelect,
}: {
  markets: Market[];
  active: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const chip = (m: Market) => (
    <button
      key={m.id}
      onClick={() => onSelect(m.id)}
      aria-pressed={m.id === active}
      className={`flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm font-medium transition-colors ${
        m.id === active
          ? "bg-emerald-600 text-white shadow-sm"
          : "border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <MarketBadge market={m} size="sm" />
      {short(m)}
    </button>
  );

  if (!open) {
    const shown = markets.filter((m) => FEATURED.includes(m.id) || m.id === active);
    return (
      <div className="flex flex-wrap items-center gap-2">
        {shown.map(chip)}
        <button
          onClick={() => setOpen(true)}
          className="rounded-full border border-dashed border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-emerald-400 hover:text-emerald-700"
        >
          All markets ({markets.length})
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Crypto</p>
        <div className="flex flex-wrap gap-2">{markets.filter((m) => m.kind === "crypto").map(chip)}</div>
      </div>
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">City markets</p>
        <div className="flex flex-wrap gap-2">{markets.filter((m) => m.kind === "sim").map(chip)}</div>
      </div>
      <button onClick={() => setOpen(false)} className="text-sm font-medium text-slate-500 hover:text-slate-800">
        Show fewer
      </button>
    </div>
  );
}
