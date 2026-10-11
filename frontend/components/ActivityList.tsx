"use client";

import { useAppData } from "@/lib/app-data";
import { pairLabel } from "@/lib/markets";
import { fmtKes, fmtUsd, signed, timeAgo } from "@/lib/money";
import { useNow } from "@/lib/useNow";
import MarketBadge from "@/components/MarketBadge";

export type Activity = {
  id: string; type: "deposit" | "withdrawal" | "trade"; amount_kes: number; status: string;
  created_at: string; ref: string | null; detail: string | null;
};

const PILL: Record<string, string> = {
  success: "bg-emerald-50 text-emerald-700", paid: "bg-emerald-50 text-emerald-700", won: "bg-emerald-50 text-emerald-700",
  pending: "bg-amber-50 text-amber-700", scheduled: "bg-amber-50 text-amber-700", open: "bg-amber-50 text-amber-700",
  processing: "bg-sky-50 text-sky-700",
  failed: "bg-red-50 text-red-700", lost: "bg-red-50 text-red-700", rejected: "bg-red-50 text-red-700",
  cancelled: "bg-slate-100 text-slate-600", draw: "bg-slate-100 text-slate-600",
};

const ICON: Record<Activity["type"], { glyph: string; tone: string }> = {
  deposit: { glyph: "↓", tone: "bg-emerald-100 text-emerald-700" },
  withdrawal: { glyph: "↑", tone: "bg-sky-100 text-sky-700" },
  trade: { glyph: "⇄", tone: "bg-slate-100 text-slate-600" },
};

/** Live ledger of every real-money movement: deposits, withdrawals and real-money trades. */
export default function ActivityList({ items }: { items: Activity[] }) {
  const { markets, kesToUsd } = useAppData();
  const now = useNow(5000);

  return (
    <ul className="divide-y divide-slate-100">
      {items.map((a) => {
        const m = a.type === "trade" ? markets.find((x) => x.id === a.ref) : undefined;
        const title =
          a.type === "deposit" ? "M-Pesa deposit"
          : a.type === "withdrawal" ? `Withdrawal to ${a.ref ?? "M-Pesa"}`
          : `${m ? pairLabel(m) : a.ref} · ${a.detail === "up" ? "▲ Higher" : "▼ Lower"}`;
        const sub =
          a.type === "withdrawal" && a.detail && a.status === "scheduled"
            ? `Payout ${new Date(a.detail).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Nairobi" })}`
            : a.type === "deposit" ? a.ref ?? "" : a.type === "trade" && a.status === "open" ? "Stake held until the candle closes" : "";
        const tone = a.amount_kes > 0 ? "text-emerald-600" : a.amount_kes < 0 ? "text-red-600" : "text-slate-500";
        return (
          <li key={`${a.type}-${a.id}`} className="flex items-center gap-3 py-3">
            {m ? (
              <MarketBadge market={m} size="md" />
            ) : (
              <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${ICON[a.type].tone}`}>
                {ICON[a.type].glyph}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
              <p className="truncate text-[11px] text-slate-400">
                {timeAgo(a.created_at, now)}
                {sub ? ` · ${sub}` : ""}
              </p>
            </div>
            <span className={`hidden rounded-full px-2.5 py-1 text-[11px] font-bold capitalize sm:inline ${PILL[a.status] ?? "bg-slate-100 text-slate-600"}`}>
              {a.status}
            </span>
            <div className="w-28 text-right sm:w-36">
              <p className={`tabular text-sm font-bold ${tone}`}>{a.amount_kes === 0 ? fmtKes(0) : signed(a.amount_kes, fmtKes)}</p>
              <p className="tabular text-[11px] text-slate-400">≈ {a.amount_kes === 0 ? fmtUsd(0) : signed(a.amount_kes, (n) => fmtUsd(kesToUsd(n)))}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
