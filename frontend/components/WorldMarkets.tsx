"use client";

import { useAppData } from "@/lib/app-data";
import { useNow } from "@/lib/useNow";
import { card } from "@/lib/ui";
import MarketBadge from "@/components/MarketBadge";

type Exchange = { id: string; exchange: string; tz: string; sessions: [number, number][] };

const m = (h: number, min = 0) => h * 60 + min;

// Regular trading hours in each exchange's local time (public holidays are not modelled).
const EXCHANGES: Exchange[] = [
  { id: "NAIROBI", exchange: "NSE", tz: "Africa/Nairobi", sessions: [[m(9), m(15)]] },
  { id: "LONDON", exchange: "LSE", tz: "Europe/London", sessions: [[m(8), m(16, 30)]] },
  { id: "NEWYORK", exchange: "NYSE", tz: "America/New_York", sessions: [[m(9, 30), m(16)]] },
  { id: "TOKYO", exchange: "TSE", tz: "Asia/Tokyo", sessions: [[m(9), m(11, 30)], [m(12, 30), m(15)]] },
  { id: "DUBAI", exchange: "DFM", tz: "Asia/Dubai", sessions: [[m(10), m(14)]] },
  { id: "HONGKONG", exchange: "HKEX", tz: "Asia/Hong_Kong", sessions: [[m(9, 30), m(12)], [m(13), m(16)]] },
  { id: "SINGAPORE", exchange: "SGX", tz: "Asia/Singapore", sessions: [[m(9), m(17)]] },
  { id: "JOHANNESBURG", exchange: "JSE", tz: "Africa/Johannesburg", sessions: [[m(9), m(17)]] },
];

function localTime(tz: string, now: number) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date(now));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const hour = Number(get("hour")) % 24;
  return { weekday: get("weekday"), hour, minute: Number(get("minute")), second: Number(get("second")), text: `${String(hour).padStart(2, "0")}:${get("minute")}:${get("second")}` };
}

const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

type Status = { label: string; tone: "open" | "break" | "closed" };

function status(ex: Exchange, t: ReturnType<typeof localTime>): Status {
  if (t.weekday === "Sat" || t.weekday === "Sun") return { label: "Weekend", tone: "closed" };
  const mins = t.hour * 60 + t.minute;
  for (const [a, z] of ex.sessions) if (mins >= a && mins < z) return { label: "Open", tone: "open" };
  const first = ex.sessions[0][0], last = ex.sessions[ex.sessions.length - 1][1];
  if (mins >= first && mins < last) return { label: "Lunch break", tone: "break" };
  if (mins < first) return { label: `Opens ${hhmm(first)}`, tone: "closed" };
  return { label: "Closed", tone: "closed" };
}

const PILL = {
  open: "bg-emerald-50 text-emerald-700",
  break: "bg-amber-50 text-amber-700",
  closed: "bg-slate-100 text-slate-500",
} as const;

/** Live world-markets board: local time and exchange status for every city market. Tap one to trade it. */
export default function WorldMarkets({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
  const { markets, changes } = useAppData();
  const now = useNow();
  const rows = EXCHANGES.map((ex) => {
    const t = localTime(ex.tz, now);
    return { ex, t, s: status(ex, t), market: markets.find((x) => x.id === ex.id) };
  });
  const openCount = rows.filter((r) => r.s.tone === "open").length;

  return (
    <section className={`${card} flex h-full flex-col p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">World markets</h2>
          <p className="text-xs text-slate-500">Live local time and exchange hours</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          {openCount} of {EXCHANGES.length} open
        </span>
      </div>

      <ul className="mt-3 flex flex-1 flex-col divide-y divide-slate-100">
        <li className="flex min-h-[46px] flex-1 items-center gap-3">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-orange-100 text-sm font-bold text-orange-600">₿</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">Crypto</p>
            <p className="text-[11px] text-slate-400">Global · never closes</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">24/7</span>
        </li>

        {rows.map(({ ex, t, s, market }) => {
          const isActive = ex.id === active;
          const ch = changes[ex.id];
          return (
            <li key={ex.id} className="flex min-h-[46px] flex-1">
              <button
                onClick={() => onSelect(ex.id)}
                className={`-mx-2 flex w-full items-center gap-3 rounded-lg px-2 text-left transition-colors ${
                  isActive ? "bg-emerald-50 ring-1 ring-emerald-200" : "hover:bg-slate-50"
                }`}
              >
                {market && <MarketBadge market={market} size="md" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {market?.label ?? ex.id} <span className="text-[11px] font-medium text-slate-400">{ex.exchange}</span>
                  </p>
                  <p className={`tabular text-[11px] ${ch === undefined ? "text-slate-400" : ch >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {ch === undefined ? "-" : `${ch >= 0 ? "+" : ""}${ch.toFixed(2)}% 24h`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="tabular font-mono text-xs font-semibold text-slate-800">{t.text}</p>
                  <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${PILL[s.tone]}`}>{s.label}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
        Exchange hours are for reference. City markets here trade around the clock. Every bet is judged 2 minutes after you
        place it.
      </p>
    </section>
  );
}
