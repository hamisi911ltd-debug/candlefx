"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAppData } from "@/lib/app-data";
import { MIN_DEPOSIT_KES, fmtKes, fmtPayoutDate, fmtUsd } from "@/lib/money";
import { alertError, btnGhost, btnPrimary, card, input, label } from "@/lib/ui";

const STEPS = [
  <>Pick a market and call whether the price will be <b className="text-slate-900">Higher</b> or <b className="text-slate-900">Lower</b> in 2 minutes.</>,
  <>Your prediction and stake are locked in the moment we receive them. A win pays <b className="text-slate-900">+85%</b> of your stake, a loss forfeits it, and if the price doesn&apos;t move your stake is returned.</>,
  <>After a 2-minute countdown the price is compared with where it was when you clicked. Crypto markets use real live prices; city markets are simulated.</>,
  <>Practice with 100 free points, or deposit from <b className="text-slate-900">KES 1,000</b> with M-Pesa to trade real money. All amounts are shown in US dollars.</>,
];

export default function AccountPage() {
  const { user, logout, refreshUser } = useAuth();
  const { stats, kesToUsd } = useAppData();
  const [schedule, setSchedule] = useState<{ min_kes: number; max_kes: number; next: { payout_at: string; cutoff_at: string } } | null>(null);
  useEffect(() => {
    apiFetch("/api/wallet/schedule").then(setSchedule).catch(() => {});
  }, []);
  const [phone, setPhone] = useState(user?.phone_number ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPhone(user?.phone_number ?? "");
  }, [user?.phone_number]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    setError(null);
    try {
      await apiFetch("/api/auth/me", { method: "PATCH", body: JSON.stringify({ phone_number: phone.trim() || null }) });
      await refreshUser();
      setMsg("Phone number saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const winRate = stats && stats.total_predictions > 0 ? `${Math.round((stats.correct_predictions / stats.total_predictions) * 100)}%` : "-";
  const tiles: [string, string][] = [
    ["Trades", stats ? String(stats.total_predictions) : "-"],
    ["Win rate", winRate],
    ["Practice", stats ? `${stats.points_balance.toFixed(0)} pts` : "-"],
    ["Real", stats ? fmtUsd(kesToUsd(stats.real_balance_kes)) : "-"],
  ];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Account</h1>
        <p className="mt-1 text-sm text-slate-500">Your profile and how the game works.</p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className={`${card} flex flex-col p-6`}>
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-slate-900 text-xl font-bold uppercase text-white">
              {user?.email?.[0] ?? "?"}
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-900">{user?.email}</p>
              <p className="text-sm text-slate-500">Candle FX trader</p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tiles.map(([k, v]) => (
              <div key={k} className="rounded-xl bg-slate-50 p-3 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{k}</p>
                <p className="tabular mt-1 text-base font-bold text-slate-900">{v}</p>
              </div>
            ))}
          </div>

          <form onSubmit={save} className="mt-6 flex flex-1 flex-col border-t border-slate-100 pt-6">
            <label className={label} htmlFor="phone">M-Pesa phone number</label>
            <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712345678" className={input} />
            <p className="mt-1.5 text-xs text-slate-500">Used to prefill your deposits.</p>
            {error && <p className={`${alertError} mt-4`}>{error}</p>}
            {msg && <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</p>}
            <div className="mt-auto flex gap-3 pt-6">
              <button type="submit" disabled={saving} className={btnPrimary}>
                {saving ? "Saving..." : "Save changes"}
              </button>
              <button type="button" onClick={logout} className={`${btnGhost} px-4 py-2 text-sm`}>
                Log out
              </button>
            </div>
          </form>
        </section>

        <section className={`${card} flex flex-col p-6`}>
          <h2 className="text-lg font-bold text-slate-900">How it works</h2>
          <ol className="mt-4 space-y-4 text-sm leading-relaxed text-slate-600">
            {STEPS.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xs font-bold text-emerald-700">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-auto rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-800">
            <b>Risk warning:</b> predicting short-term price moves is high risk and you can lose your whole stake. Only trade
            money you can afford to lose.
          </p>
        </section>
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {[
          {
            title: "Deposits",
            badge: "Instant",
            tone: "bg-emerald-50 text-emerald-700",
            rows: [
              ["Method", "M-Pesa (STK push)"],
              ["Minimum", `${fmtKes(MIN_DEPOSIT_KES).replace(".00", "")} · ${fmtUsd(kesToUsd(MIN_DEPOSIT_KES))}`],
              ["Maximum", schedule ? fmtKes(schedule.max_kes).replace(".00", "") : "-"],
              ["Credited", "As soon as M-Pesa confirms"],
            ],
          },
          {
            title: "Withdrawals",
            badge: "Every 3 working days",
            tone: "bg-sky-50 text-sky-700",
            rows: [
              ["Schedule", "Mon-Fri, Nairobi time"],
              ["Minimum", schedule ? `${fmtKes(schedule.min_kes).replace(".00", "")} · ${fmtUsd(kesToUsd(schedule.min_kes))}` : "-"],
              ["Next payout", schedule ? fmtPayoutDate(schedule.next.payout_at) : "-"],
              ["Request cut-off", schedule ? fmtPayoutDate(schedule.next.cutoff_at) : "-"],
            ],
          },
          {
            title: "Fair play",
            badge: "Verified",
            tone: "bg-amber-50 text-amber-700",
            rows: [
              ["Bets", "Locked when we receive them"],
              ["Stake", "Held until the 2-minute verdict"],
              ["Crypto prices", "Real OKX market data"],
              ["City markets", "Keyed, unpredictable feeds"],
            ],
          },
        ].map((c) => (
          <section key={c.title} className={`${card} p-5`}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900">{c.title}</h2>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${c.tone}`}>{c.badge}</span>
            </div>
            <dl className="mt-3 divide-y divide-slate-100 text-sm">
              {c.rows.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="tabular text-right font-semibold text-slate-900">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
