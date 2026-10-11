"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppData } from "@/lib/app-data";
import { formatPrice, pairLabel } from "@/lib/markets";
import { fmtPct } from "@/lib/money";
import { card, input } from "@/lib/ui";
import MarketBadge from "@/components/MarketBadge";

type Tab = "all" | "crypto" | "sim";
type Sort = "default" | "gainers" | "losers";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All markets" },
  { id: "crypto", label: "Crypto" },
  { id: "sim", label: "City markets" },
];

export default function MarketsPage() {
  const router = useRouter();
  const { markets, prices, changes, dirs, select } = useAppData();
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("default");

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = markets.filter(
      (m) => (tab === "all" || m.kind === tab) && (!q || `${m.label} ${m.base} ${m.quote} ${m.id}`.toLowerCase().includes(q)),
    );
    if (sort !== "default") {
      list = [...list].sort((a, b) => ((changes[b.id] ?? -Infinity) - (changes[a.id] ?? -Infinity)) * (sort === "gainers" ? 1 : -1));
    }
    return list;
  }, [markets, tab, query, sort, changes]);

  const open = (id: string) => {
    select(id);
    router.push("/trade");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Markets</h1>
        <p className="mt-1 text-sm text-slate-500">
          Real crypto prices and simulated city markets. Pick one to open it in the trading terminal.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-xl bg-slate-200/60 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                tab === t.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search markets..."
          className={`${input} max-w-xs`}
        />
        <div className="flex gap-1 rounded-xl bg-slate-200/60 p-1 sm:ml-auto">
          {(["default", "gainers", "losers"] as Sort[]).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold capitalize transition-colors ${
                sort === s ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {s === "default" ? "Default" : `Top ${s}`}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <p className={`${card} p-10 text-center text-sm text-slate-400`}>No markets match your search.</p>
      ) : (
        <div className="flex flex-wrap gap-4">
          {items.map((m) => {
            const ch = changes[m.id];
            const dir = dirs[m.id] ?? "flat";
            return (
              <button
                key={m.id}
                onClick={() => open(m.id)}
                className={`${card} group min-w-[240px] flex-1 basis-[270px] p-5 text-left transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md`}
              >
                <div className="flex items-center gap-3">
                  <MarketBadge market={m} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-slate-900">{pairLabel(m)}</p>
                    <p className="truncate text-xs text-slate-500">{m.kind === "crypto" ? m.label : "Simulated"}</p>
                  </div>
                  <span
                    className={`tabular rounded-full px-2.5 py-1 text-xs font-bold ${
                      ch === undefined ? "bg-slate-100 text-slate-400" : ch >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                    }`}
                  >
                    {fmtPct(ch)}
                  </span>
                </div>
                <p
                  className={`tabular mt-4 font-mono text-2xl font-bold transition-colors duration-300 ${
                    dir === "up" ? "text-emerald-600" : dir === "down" ? "text-red-600" : "text-slate-900"
                  }`}
                >
                  <span className="mr-1 text-base font-semibold text-slate-400">{m.quoteGlyph}</span>
                  {formatPrice(prices[m.id])}
                </p>
                <p className="mt-2 text-xs font-semibold text-slate-400 transition-colors group-hover:text-emerald-600">Trade →</p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
