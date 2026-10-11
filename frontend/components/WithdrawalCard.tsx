"use client";

import { useAppData } from "@/lib/app-data";
import { fmtCountdown, fmtKes, fmtPayoutDate, fmtUsd, timeAgo } from "@/lib/money";
import { useNow } from "@/lib/useNow";

export type Withdrawal = {
  id: string; amount: number; phone_number: string; status: "scheduled" | "processing" | "paid" | "rejected" | "cancelled";
  cutoff_at: string; scheduled_for: string; payout_reference: string | null; created_at: string;
  events: { status: string; note: string | null; at: string }[];
};

const STEPS = [
  { key: "requested", label: "Requested" },
  { key: "scheduled", label: "Queued" },
  { key: "processing", label: "Processing" },
  { key: "paid", label: "Paid" },
] as const;

const PILL: Record<Withdrawal["status"], string> = {
  scheduled: "bg-amber-50 text-amber-700",
  processing: "bg-sky-50 text-sky-700",
  paid: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
  cancelled: "bg-slate-100 text-slate-600",
};

/** One withdrawal with a live status timeline: requested, queued, processing, paid. */
export default function WithdrawalCard({ w, onCancel, busy }: { w: Withdrawal; onCancel: (id: string) => void; busy: boolean }) {
  const { kesToUsd } = useAppData();
  const now = useNow();
  const closed = w.status === "rejected" || w.status === "cancelled";
  const reached = new Map(w.events.map((e) => [e.status, e]));
  // Index of the step the withdrawal is currently on (a finished "paid" counts as complete).
  const current = w.status === "paid" ? 3 : w.status === "processing" ? 2 : w.status === "scheduled" ? 1 : 0;
  const payoutIn = Date.parse(w.scheduled_for) - now;
  const canCancel = w.status === "scheduled" && now < Date.parse(w.cutoff_at);
  const last = w.events[w.events.length - 1];

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="tabular text-lg font-bold text-slate-900">
            {fmtKes(w.amount)} <span className="text-sm font-medium text-slate-400">≈ {fmtUsd(kesToUsd(w.amount))}</span>
          </p>
          <p className="text-xs text-slate-500">
            To M-Pesa {w.phone_number} · requested {timeAgo(w.created_at, now)}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${PILL[w.status]}`}>{w.status}</span>
      </div>

      {closed ? (
        <p className={`mt-4 rounded-lg px-3 py-2 text-sm ${w.status === "rejected" ? "bg-red-50 text-red-700" : "bg-slate-50 text-slate-600"}`}>
          {last?.note ?? (w.status === "rejected" ? "Rejected" : "Cancelled")}
        </p>
      ) : (
        <ol className="mt-5 grid grid-cols-4">
          {STEPS.map((step, i) => {
            const done = i < current || (i === current && w.status === "paid");
            const active = i === current && w.status !== "paid";
            const ev = reached.get(step.key);
            return (
              <li key={step.key} className="relative flex flex-col items-center text-center">
                {i > 0 && (
                  <span className={`absolute right-1/2 top-3 h-0.5 w-full ${i <= current ? "bg-emerald-500" : "bg-slate-200"}`} />
                )}
                <span
                  className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                    done ? "bg-emerald-500 text-white" : active ? "bg-white text-emerald-600 ring-2 ring-emerald-500" : "bg-slate-200 text-slate-400"
                  }`}
                >
                  {done ? "✓" : active ? <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> : i + 1}
                </span>
                <span className={`mt-2 text-[11px] font-semibold ${done || active ? "text-slate-900" : "text-slate-400"}`}>{step.label}</span>
                <span className="text-[10px] text-slate-400">{ev ? timeAgo(ev.at, now) : " "}</span>
              </li>
            );
          })}
        </ol>
      )}

      {w.status === "scheduled" && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5 text-xs">
          <span className="text-slate-600">
            Payout <b className="text-slate-900">{fmtPayoutDate(w.scheduled_for)}</b> · in{" "}
            <b className="tabular text-emerald-700">{fmtCountdown(payoutIn)}</b>
          </span>
          {canCancel ? (
            <button
              onClick={() => onCancel(w.id)}
              disabled={busy}
              className="font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
            >
              Cancel request
            </button>
          ) : (
            <span className="text-slate-400">Cut-off passed</span>
          )}
        </div>
      )}
      {w.status === "processing" && (
        <p className="mt-4 rounded-lg bg-sky-50 px-3 py-2.5 text-xs text-sky-700">
          Your payout batch is being sent to M-Pesa now. You&apos;ll see it here the moment it&apos;s paid.
        </p>
      )}
      {w.status === "paid" && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700">
          Sent to M-Pesa{w.payout_reference ? ` · reference ${w.payout_reference}` : ""}.
        </p>
      )}
    </li>
  );
}
