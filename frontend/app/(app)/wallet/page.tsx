"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAppData } from "@/lib/app-data";
import { MIN_DEPOSIT_KES, fmtCountdown, fmtKes, fmtPayoutDate, fmtUsd, timeAgo } from "@/lib/money";
import { useNow } from "@/lib/useNow";
import { alertError, btnGhost, btnPrimary, card, input } from "@/lib/ui";
import ActivityList, { type Activity } from "@/components/ActivityList";
import WithdrawalCard, { type Withdrawal } from "@/components/WithdrawalCard";

type Deposit = {
  id: string; external_reference: string; amount: number;
  status: "pending" | "success" | "failed"; mpesa_receipt_number: string | null; created_at: string;
};
type Payout = { payout_at: string; cutoff_at: string; day: string };
type Schedule = { every_working_days: number; min_kes: number; max_kes: number; next: Payout; upcoming: Payout[] };

const QUICK_DEPOSIT = [1000, 2000, 5000, 10000];
const DEP_PILL = { success: "bg-emerald-50 text-emerald-700", pending: "bg-amber-50 text-amber-700", failed: "bg-red-50 text-red-700" };
type Tab = "activity" | "withdrawals" | "deposits";

const Empty = ({ icon, title, text }: { icon: string; title: string; text: string }) => (
  <div className="flex min-h-[220px] flex-col items-center justify-center px-6 py-10 text-center">
    <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-xl">{icon}</span>
    <p className="text-sm font-semibold text-slate-700">{title}</p>
    <p className="mt-1 max-w-xs text-xs text-slate-400">{text}</p>
  </div>
);

export default function WalletPage() {
  const { user } = useAuth();
  const { stats, refreshStats, fx, kesToUsd } = useAppData();
  const now = useNow();

  const [phone, setPhone] = useState(user?.phone_number ?? "");
  useEffect(() => {
    if (user?.phone_number) setPhone((p) => p || user.phone_number!);
  }, [user?.phone_number]);

  // ---- live data, refreshed every few seconds ----
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [tab, setTab] = useState<Tab>("activity");

  const load = useCallback(async () => {
    const [s, w, d, a] = await Promise.allSettled([
      apiFetch("/api/wallet/schedule"),
      apiFetch("/api/wallet/withdrawals"),
      apiFetch("/api/payhero/deposits"),
      apiFetch("/api/wallet/activity?limit=40"),
    ]);
    if (s.status === "fulfilled") setSchedule(s.value);
    if (w.status === "fulfilled") setWithdrawals(w.value);
    if (d.status === "fulfilled") setDeposits(d.value);
    if (a.status === "fulfilled") setActivity(a.value);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      load();
      refreshStats();
    }, 5000);
    return () => clearInterval(t);
  }, [load, refreshStats]);

  // ---- deposit ----
  const [kesAmount, setKesAmount] = useState("1000");
  const [dep, setDep] = useState<{ submitting: boolean; polling: boolean; message: string | null; error: string | null }>({
    submitting: false, polling: false, message: null, error: null,
  });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);
  const depositNum = parseInt(kesAmount || "0", 10);
  const belowMin = !(depositNum >= MIN_DEPOSIT_KES);

  const startDeposit = async () => {
    setDep({ submitting: true, polling: false, message: null, error: null });
    try {
      const res = await apiFetch("/api/payhero/deposit", { method: "POST", body: JSON.stringify({ amount: depositNum, phone_number: phone }) });
      setDep({ submitting: false, polling: true, message: "Check your phone for the M-Pesa prompt and enter your PIN.", error: null });
      load();
      const ref = res.external_reference as string;
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts += 1;
        try {
          const status = await apiFetch(`/api/payhero/deposit/${encodeURIComponent(ref)}`);
          if (status.status === "success") {
            if (pollRef.current) clearInterval(pollRef.current);
            setDep({ submitting: false, polling: false, message: `Deposit confirmed: +${fmtKes(status.amount)}`, error: null });
            refreshStats(); load();
          } else if (status.status === "failed") {
            if (pollRef.current) clearInterval(pollRef.current);
            setDep({ submitting: false, polling: false, message: null, error: status.result_desc || "Payment failed or was cancelled" });
            load();
          } else if (attempts >= 20) {
            if (pollRef.current) clearInterval(pollRef.current);
            setDep({ submitting: false, polling: false, message: null, error: "Still pending - check back later, it may still confirm." });
          }
        } catch {
          // transient - next poll retries
        }
      }, 3000);
    } catch (err) {
      setDep({ submitting: false, polling: false, message: null, error: err instanceof ApiError ? err.message : "Failed to start deposit" });
    }
  };

  // ---- withdraw ----
  const realKes = stats?.real_balance_kes ?? 0;
  const minWd = schedule?.min_kes ?? 500;
  const [wdAmount, setWdAmount] = useState("");
  const [wd, setWd] = useState<{ submitting: boolean; message: string | null; error: string | null }>({ submitting: false, message: null, error: null });
  const [cancelling, setCancelling] = useState(false);
  const wdNum = parseInt(wdAmount || "0", 10);
  const wdInvalid = !(wdNum >= minWd) || wdNum > realKes || !phone;

  const requestWithdrawal = async () => {
    setWd({ submitting: true, message: null, error: null });
    try {
      const w: Withdrawal = await apiFetch("/api/wallet/withdraw", { method: "POST", body: JSON.stringify({ amount: wdNum, phone_number: phone }) });
      setWd({ submitting: false, message: `Requested. It will be paid ${fmtPayoutDate(w.scheduled_for)}.`, error: null });
      setWdAmount("");
      setTab("withdrawals");
      refreshStats(); load();
    } catch (err) {
      setWd({ submitting: false, message: null, error: err instanceof ApiError ? err.message : "Could not request withdrawal" });
    }
  };

  const cancelWithdrawal = async (id: string) => {
    setCancelling(true);
    try {
      await apiFetch(`/api/wallet/withdrawals/${id}/cancel`, { method: "POST" });
      refreshStats(); await load();
    } catch (err) {
      setWd({ submitting: false, message: null, error: err instanceof ApiError ? err.message : "Could not cancel" });
    } finally {
      setCancelling(false);
    }
  };

  // ---- practice reset ----
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const doReset = async () => {
    setResetting(true);
    setResetError(null);
    try {
      await apiFetch("/api/predict/reset", { method: "POST" });
      setConfirming(false);
      refreshStats();
    } catch (err) {
      setResetError(err instanceof ApiError ? err.message : "Failed to reset");
    } finally {
      setResetting(false);
    }
  };

  const next = schedule?.next;
  const untilPayout = next ? Date.parse(next.payout_at) - now : 0;
  const untilCutoff = next ? Date.parse(next.cutoff_at) - now : 0;
  const activeWithdrawals = withdrawals.filter((w) => w.status === "scheduled" || w.status === "processing");
  const inFlightKes = activeWithdrawals.reduce((s, w) => s + w.amount, 0);

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: "activity", label: "Activity" },
    { id: "withdrawals", label: "Withdrawals", count: activeWithdrawals.length },
    { id: "deposits", label: "Deposits" },
  ];

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Wallet</h1>
          <p className="mt-1 text-sm text-slate-500">Balances are quoted in US dollars.</p>
        </div>
        {fx && (
          <span className="rounded-full bg-white px-3 py-1.5 text-xs text-slate-500 ring-1 ring-slate-200">
            1 USD = <b className="tabular text-slate-800">{fx.kes_per_usd.toFixed(2)} KES</b> · {fx.source === "live" ? "live rate" : "indicative"}
          </span>
        )}
      </div>

      {/* ---- balances + payout clock ---- */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section className={`${card} flex flex-col overflow-hidden`}>
          <div className="flex-1 bg-gradient-to-br from-emerald-600 to-emerald-700 p-6 text-white">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-100">Real balance</p>
            <p className="tabular mt-2 text-4xl font-bold">{stats ? fmtUsd(kesToUsd(realKes)) : "-"}</p>
            <p className="tabular mt-1 text-sm text-emerald-100">{stats ? fmtKes(realKes) : ""}</p>
            {inFlightKes > 0 && (
              <p className="tabular mt-3 inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-medium">
                {fmtKes(inFlightKes)} pending withdrawal
              </p>
            )}
          </div>
          <div className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 text-center">
            {[
              ["Trades", stats ? String(stats.total_predictions) : "-"],
              ["Win rate", stats && stats.total_predictions > 0 ? `${Math.round((stats.correct_predictions / stats.total_predictions) * 100)}%` : "-"],
              ["Payout", `+${Math.round((stats?.payout_rate ?? 0.85) * 100)}%`],
            ].map(([k, v]) => (
              <div key={k} className="p-3">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">{k}</p>
                <p className="tabular mt-0.5 text-base font-bold text-slate-900">{v}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={`${card} flex flex-col p-6`}>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Practice wallet</p>
          <p className="tabular mt-2 text-4xl font-bold text-slate-900">
            {stats ? stats.points_balance.toFixed(0) : "-"} <span className="text-lg font-semibold text-slate-400">pts</span>
          </p>
          <p className="mt-2 text-sm text-slate-500">Free virtual points. You start with 100 and can reset any time.</p>
          {resetError && <p className={`${alertError} mt-3 text-xs`}>{resetError}</p>}
          <div className="mt-auto pt-5">
            {!confirming ? (
              <button onClick={() => setConfirming(true)} className={`${btnGhost} w-full`}>
                Reset to 100 points
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-slate-600">This clears your practice history. Your real balance is never affected.</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={doReset} disabled={resetting} className="rounded-lg bg-red-600 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                    {resetting ? "Resetting..." : "Yes, reset"}
                  </button>
                  <button onClick={() => setConfirming(false)} className={btnGhost}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className={`${card} flex flex-col p-6`}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Next payout</p>
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Live
            </span>
          </div>
          {next ? (
            <>
              <p className="tabular mt-2 text-4xl font-bold text-slate-900">{fmtCountdown(untilPayout)}</p>
              <p className="mt-1 text-sm font-medium text-slate-700">{fmtPayoutDate(next.payout_at)} <span className="text-slate-400">EAT</span></p>
              <p className="mt-3 text-xs text-slate-500">
                {untilCutoff > 0 ? (
                  <>Request within <b className="tabular text-slate-800">{fmtCountdown(untilCutoff)}</b> to join this payout.</>
                ) : (
                  <>Cut-off passed: new requests join the next payout.</>
                )}
              </p>
              <div className="mt-auto flex flex-wrap gap-1.5 pt-4">
                {schedule!.upcoming.slice(0, 4).map((p, i) => (
                  <span key={p.payout_at} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${i === 0 ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                    {new Date(p.payout_at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Nairobi" })}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Loading schedule...</div>
          )}
        </section>
      </div>

      {/* ---- deposit + withdraw ---- */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className={`${card} flex flex-col p-6`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Deposit with M-Pesa</h2>
              <p className="mt-1 text-sm text-slate-500">
                Minimum {fmtKes(MIN_DEPOSIT_KES).replace(".00", "")}
                {fx && <> (about {fmtUsd(kesToUsd(MIN_DEPOSIT_KES))})</>}.
              </p>
            </div>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">Instant</span>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {QUICK_DEPOSIT.map((amt) => (
              <button
                key={amt}
                onClick={() => setKesAmount(String(amt))}
                className={`rounded-xl border px-2 py-2.5 text-center transition-colors ${
                  kesAmount === String(amt) ? "border-emerald-500 bg-emerald-50" : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <span className="tabular block text-sm font-bold text-slate-900">{amt.toLocaleString("en-US")}</span>
                <span className="tabular block text-[11px] text-slate-400">≈ {fmtUsd(kesToUsd(amt))}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <label className="mb-1.5 flex items-center justify-between text-sm font-medium text-slate-700">
                <span>Amount (KES)</span>
                {depositNum > 0 && <span className="tabular text-xs font-normal text-slate-400">≈ {fmtUsd(kesToUsd(depositNum))} USD</span>}
              </label>
              <input type="number" min={MIN_DEPOSIT_KES} value={kesAmount} onChange={(e) => setKesAmount(e.target.value)} className={`${input} tabular ${kesAmount && belowMin ? "!border-red-400" : ""}`} />
              {kesAmount && belowMin && <p className="mt-1.5 text-xs text-red-600">Minimum deposit is KES {MIN_DEPOSIT_KES.toLocaleString("en-US")}.</p>}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">M-Pesa phone number</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712345678" className={input} />
            </div>
          </div>

          <button onClick={startDeposit} disabled={dep.submitting || dep.polling || !phone || belowMin} className={`${btnPrimary} mt-auto w-full py-3`}>
            {dep.submitting ? "Sending prompt..." : dep.polling ? "Waiting for confirmation..." : `Deposit ${fmtKes(depositNum || 0).replace(".00", "")}${depositNum > 0 ? ` (≈ ${fmtUsd(kesToUsd(depositNum))})` : ""}`}
          </button>
          {dep.message && <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{dep.message}</p>}
          {dep.error && <p className={`${alertError} mt-3`}>{dep.error}</p>}
        </section>

        <section className={`${card} flex flex-col p-6`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Withdraw to M-Pesa</h2>
              <p className="mt-1 text-sm text-slate-500">
                Paid out every {schedule?.every_working_days ?? 3} working days · minimum {fmtKes(minWd).replace(".00", "")} (about {fmtUsd(kesToUsd(minWd))}).
              </p>
            </div>
            <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-700">Scheduled</span>
          </div>

          <div className="mt-5 grid grid-cols-4 gap-2">
            {[25, 50, 75, 100].map((pct) => {
              const amt = Math.floor((realKes * pct) / 100);
              return (
                <button
                  key={pct}
                  onClick={() => setWdAmount(String(amt))}
                  disabled={amt < minWd}
                  className="rounded-xl border border-slate-200 bg-white px-2 py-2.5 text-center transition-colors hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="block text-sm font-bold text-slate-900">{pct === 100 ? "Max" : `${pct}%`}</span>
                  <span className="tabular block text-[11px] text-slate-400">{amt > 0 ? `≈ ${fmtUsd(kesToUsd(amt))}` : "-"}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <label className="mb-1.5 flex items-center justify-between text-sm font-medium text-slate-700">
                <span>Amount (KES)</span>
                {wdNum > 0 && <span className="tabular text-xs font-normal text-slate-400">≈ {fmtUsd(kesToUsd(wdNum))} USD</span>}
              </label>
              <input type="number" min={minWd} value={wdAmount} onChange={(e) => setWdAmount(e.target.value)} placeholder={`From ${minWd}`} className={`${input} tabular ${wdNum > realKes ? "!border-red-400" : ""}`} />
              {wdNum > realKes && <p className="mt-1.5 text-xs text-red-600">That's more than your real balance ({fmtKes(realKes)}).</p>}
              {realKes < minWd && !wdAmount && <p className="mt-1.5 text-xs text-slate-400">Your real balance needs to be at least {fmtKes(minWd).replace(".00", "")} to withdraw.</p>}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Send to M-Pesa number</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712345678" className={input} />
            </div>
          </div>

          {next && (
            <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
              A request made now is paid <b className="text-slate-900">{fmtPayoutDate(next.payout_at)}</b>. You can cancel until the cut-off.
            </p>
          )}

          <button onClick={requestWithdrawal} disabled={wd.submitting || wdInvalid} className={`${btnPrimary} mt-auto w-full py-3`}>
            {wd.submitting ? "Requesting..." : `Request withdrawal${wdNum >= minWd ? ` (≈ ${fmtUsd(kesToUsd(wdNum))})` : ""}`}
          </button>
          {wd.message && <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{wd.message}</p>}
          {wd.error && <p className={`${alertError} mt-3`}>{wd.error}</p>}
        </section>
      </div>

      {/* ---- live tracking ---- */}
      <section className={`${card} flex flex-col`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
                  tab === t.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {t.label}
                {!!t.count && <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-bold text-amber-700">{t.count}</span>}
              </button>
            ))}
          </div>
          <span className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Updates live
          </span>
        </div>

        <div className="flex flex-1 flex-col px-5 py-2">
          {tab === "activity" &&
            (activity.length === 0 ? (
              <Empty icon="⚡" title="No activity yet" text="Deposits, withdrawals and real-money trades show up here the moment they happen." />
            ) : (
              <ActivityList items={activity} />
            ))}

          {tab === "withdrawals" &&
            (withdrawals.length === 0 ? (
              <Empty icon="🗓️" title="No withdrawals yet" text="Request one above and follow it here from queued to paid, step by step." />
            ) : (
              <ul className="space-y-3 py-3">
                {withdrawals.map((w) => (
                  <WithdrawalCard key={w.id} w={w} onCancel={cancelWithdrawal} busy={cancelling} />
                ))}
              </ul>
            ))}

          {tab === "deposits" &&
            (deposits.length === 0 ? (
              <Empty icon="💳" title="No deposits yet" text="Your M-Pesa deposits will appear here as soon as you make your first one." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {deposits.slice(0, 20).map((d) => (
                  <li key={d.id} className="flex items-center gap-3 py-3">
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">↓</span>
                    <div className="min-w-0 flex-1">
                      <p className="tabular text-sm font-semibold text-slate-900">
                        {fmtKes(d.amount)} <span className="font-normal text-slate-400">· ≈ {fmtUsd(kesToUsd(d.amount))}</span>
                      </p>
                      <p className="truncate text-[11px] text-slate-400">
                        {timeAgo(d.created_at, now)}
                        {d.mpesa_receipt_number ? ` · ${d.mpesa_receipt_number}` : ""}
                      </p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${DEP_PILL[d.status]}`}>{d.status}</span>
                  </li>
                ))}
              </ul>
            ))}
        </div>
      </section>
    </div>
  );
}
