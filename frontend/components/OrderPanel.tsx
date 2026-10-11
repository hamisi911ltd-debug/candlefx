"use client";

import { useAppData } from "@/lib/app-data";
import { formatPrice, type Market } from "@/lib/markets";
import { fmtKes, fmtUsd, signed } from "@/lib/money";

const fmtClock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
import { alertError, card, input } from "@/lib/ui";

export type Currency = "points" | "kes";
export type ResolveResult = {
  correct: boolean; draw: boolean; actual_direction: string; entry_price: number; exit_price: number;
  payout: number; currency: Currency;
};

const QUICK: Record<Currency, number[]> = { points: [10, 25, 50, 100], kes: [100, 500, 1000, 5000] };

type Props = {
  market: Market | undefined;
  payoutRate: number;
  currency: Currency;
  setCurrency: (c: Currency) => void;
  stake: string;
  setStake: (s: string) => void;
  pending: { direction: "up" | "down"; entry: number | null; countdown: number; total: number } | null;
  onPlace: (d: "up" | "down") => void;
  result: ResolveResult | null;
  error: string | null;
  crypto: boolean;
};

/** Order ticket: choose wallet and stake, then call the next candle Higher or Lower. */
export default function OrderPanel(p: Props) {
  const { stats, kesToUsd } = useAppData();
  const isKes = p.currency === "kes";
  const balance = stats ? (isKes ? stats.real_balance_kes : stats.points_balance) : 0;
  const stakeNum = parseFloat(p.stake || "0");
  const valid = stakeNum > 0;
  const insufficient = !p.pending && stats !== null && stakeNum > balance;
  const win = stakeNum * p.payoutRate;
  const money = (n: number) => (isKes ? fmtKes(n) : `${n.toFixed(2)} pts`);
  const progress = p.pending && p.pending.total > 0 ? Math.min(1, Math.max(0, 1 - p.pending.countdown / p.pending.total)) : 0;
  const quote = p.market?.quoteGlyph ?? "";

  return (
    <section className={`${card} p-5`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Place your prediction</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Will the price be <span className="font-medium text-slate-700">higher or lower in 2 minutes</span> than it is now?
          </p>
        </div>
        <span className="flex-shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
          +{Math.round(p.payoutRate * 100)}%
        </span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
        {(["points", "kes"] as Currency[]).map((c) => (
          <button
            key={c}
            onClick={() => {
              p.setCurrency(c);
              p.setStake(c === "points" ? "10" : "100");
            }}
            disabled={!!p.pending}
            className={`rounded-lg px-2 py-2 text-left transition-colors disabled:opacity-60 ${
              p.currency === c ? "bg-white shadow-sm" : "hover:bg-slate-50"
            }`}
          >
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {c === "points" ? "Practice" : "Real money"}
            </span>
            <span className="tabular block text-sm font-bold text-slate-900">
              {stats ? (c === "points" ? `${stats.points_balance.toFixed(0)} pts` : fmtUsd(kesToUsd(stats.real_balance_kes))) : "-"}
            </span>
          </button>
        ))}
      </div>

      <label className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-600">
        <span>Stake {isKes ? "(KES)" : "(points)"}</span>
        {isKes && valid && <span className="tabular text-slate-400">≈ {fmtUsd(kesToUsd(stakeNum))}</span>}
      </label>
      <div className="flex items-stretch gap-2">
        <button
          onClick={() => p.setStake(String(Math.max(1, Math.floor(stakeNum / 2))))}
          disabled={!!p.pending}
          className="w-10 rounded-lg border border-slate-300 bg-white text-lg font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          aria-label="Halve stake"
        >
          −
        </button>
        <input
          type="number"
          min="1"
          step="1"
          inputMode="decimal"
          value={p.stake}
          onChange={(e) => p.setStake(e.target.value)}
          disabled={!!p.pending}
          className={`${input} tabular text-center text-base font-semibold ${insufficient ? "!border-red-400 !ring-red-200" : ""}`}
        />
        <button
          onClick={() => p.setStake(String(Math.floor(stakeNum * 2) || 1))}
          disabled={!!p.pending}
          className="w-10 rounded-lg border border-slate-300 bg-white text-lg font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          aria-label="Double stake"
        >
          +
        </button>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {QUICK[p.currency].map((amt) => (
          <button
            key={amt}
            onClick={() => p.setStake(String(amt))}
            disabled={!!p.pending}
            className={`tabular rounded-lg py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
              p.stake === String(amt) ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {amt}
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
        <div>
          <p className="text-slate-500">If you win</p>
          <p className="tabular mt-0.5 text-sm font-bold text-emerald-600">{valid ? `+${money(win)}` : "-"}</p>
          {isKes && valid && <p className="tabular text-[11px] text-slate-400">≈ {fmtUsd(kesToUsd(win))}</p>}
        </div>
        <div>
          <p className="text-slate-500">If you lose</p>
          <p className="tabular mt-0.5 text-sm font-bold text-red-600">{valid ? `−${money(stakeNum)}` : "-"}</p>
          {isKes && valid && <p className="tabular text-[11px] text-slate-400">≈ {fmtUsd(kesToUsd(stakeNum))}</p>}
        </div>
      </div>

      {insufficient && (
        <p className={`${alertError} mt-3 text-xs`}>
          {isKes ? "Not enough real balance. Top up in your wallet." : "Not enough practice points. Reset them in your wallet."}
        </p>
      )}

      {p.pending ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
                p.pending.direction === "up" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
              }`}
            >
              {p.pending.direction === "up" ? "▲ Higher" : "▼ Lower"}
            </span>
            <span className="tabular text-sm font-semibold text-slate-900">
              {fmtClock(p.pending.countdown)}
            </span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full transition-all duration-200 ${p.pending.direction === "up" ? "bg-emerald-500" : "bg-red-500"}`}
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Locked in
            {p.pending.entry !== null && (
              <>
                {" "}at <span className="tabular font-mono font-semibold text-slate-800">{quote}{formatPrice(p.pending.entry)}</span>
              </>
            )}
            . Your stake is held until the 2-minute verdict.
          </p>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            onClick={() => p.onPlace("up")}
            disabled={!valid || insufficient}
            className="group flex flex-col items-center gap-0.5 rounded-xl bg-emerald-600 py-3.5 text-white shadow-sm transition-all hover:bg-emerald-700 hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="text-lg leading-none">▲</span>
            <span className="text-sm font-bold">Higher</span>
          </button>
          <button
            onClick={() => p.onPlace("down")}
            disabled={!valid || insufficient}
            className="group flex flex-col items-center gap-0.5 rounded-xl bg-red-600 py-3.5 text-white shadow-sm transition-all hover:bg-red-700 hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="text-lg leading-none">▼</span>
            <span className="text-sm font-bold">Lower</span>
          </button>
        </div>
      )}

      {!p.pending && (
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          Your prediction locks in the moment you click. After a 2-minute countdown the price is compared with where it was
          when you clicked{p.crypto ? " (live OKX prices)" : ""}. No change means your stake is returned.
        </p>
      )}

      {p.error && <p className={`${alertError} mt-3`}>{p.error}</p>}

      {p.result && (
        <div
          className={`mt-4 rounded-xl border p-4 ${
            p.result.draw
              ? "border-slate-200 bg-slate-50"
              : p.result.correct ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"
          }`}
        >
          <p
            className={`text-base font-bold ${
              p.result.draw ? "text-slate-700" : p.result.correct ? "text-emerald-700" : "text-red-700"
            }`}
          >
            {p.result.draw ? "Draw" : p.result.correct ? "You won!" : "Not this time"}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {p.result.draw
              ? `The price didn't move (${quote}${formatPrice(p.result.exit_price)}) in 2 minutes. Your stake was returned.`
              : `Price went ${p.result.actual_direction} from ${quote}${formatPrice(p.result.entry_price)} to ${quote}${formatPrice(p.result.exit_price)} in 2 minutes.`}
          </p>
          {!p.result.draw && (
            <p className={`tabular mt-2 text-lg font-bold ${p.result.payout >= 0 ? "text-emerald-700" : "text-red-700"}`}>
              {signed(p.result.payout, (n) => (p.result!.currency === "kes" ? fmtKes(n) : `${n.toFixed(2)} pts`))}
              {p.result.currency === "kes" && (
                <span className="ml-2 text-xs font-medium text-slate-500">≈ {signed(p.result.payout, (n) => fmtUsd(kesToUsd(n)))}</span>
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
