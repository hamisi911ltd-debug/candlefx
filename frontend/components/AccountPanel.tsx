"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";

type Stats = { points_balance: number; total_predictions: number; correct_predictions: number; payout_rate: number };

const QUICK_AMOUNTS = [100, 500, 1000];

export default function AccountPanel({ stats, onChange }: { stats: Stats | null; onChange: () => void }) {
  const [depositAmount, setDepositAmount] = useState("500");
  const [depositing, setDepositing] = useState(false);
  const [depositMsg, setDepositMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  const doDeposit = async (amount: number) => {
    setDepositing(true);
    setError(null);
    setDepositMsg(null);
    try {
      await apiFetch("/api/predict/deposit", { method: "POST", body: JSON.stringify({ amount }) });
      setDepositMsg(`+${amount} points added`);
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add points");
    } finally {
      setDepositing(false);
    }
  };

  const doReset = async () => {
    setResetting(true);
    setError(null);
    try {
      await apiFetch("/api/predict/reset", { method: "POST" });
      setConfirming(false);
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to reset");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-900/60 shadow-lg shadow-black/20">
      <div className="border-b border-slate-800 bg-slate-950/40 p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">Virtual wallet</p>
        <p className="mt-1 text-3xl font-bold text-slate-100">
          {stats ? stats.points_balance.toFixed(0) : "-"} <span className="text-base font-normal text-slate-500">pts</span>
        </p>
        {stats && (
          <p className="mt-1 text-xs text-slate-500">
            Win pays <span className="text-emerald-400">+{Math.round(stats.payout_rate * 100)}%</span> of stake · Lose forfeits stake
          </p>
        )}
      </div>

      <div className="space-y-4 p-4">
        {stats && (
          <div className="grid grid-cols-2 gap-3 text-center text-sm">
            <div className="rounded-lg bg-slate-950/50 p-2">
              <p className="text-slate-500">Predictions</p>
              <p className="font-semibold text-slate-200">{stats.total_predictions}</p>
            </div>
            <div className="rounded-lg bg-slate-950/50 p-2">
              <p className="text-slate-500">Accuracy</p>
              <p className="font-semibold text-slate-200">
                {stats.total_predictions > 0 ? `${Math.round((stats.correct_predictions / stats.total_predictions) * 100)}%` : "-"}
              </p>
            </div>
          </div>
        )}

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Add points (virtual, no real money)</p>
          <div className="flex gap-2">
            {QUICK_AMOUNTS.map((amt) => (
              <button
                key={amt}
                onClick={() => doDeposit(amt)}
                disabled={depositing}
                className="flex-1 rounded-md bg-emerald-600/90 py-1.5 text-xs font-medium hover:bg-emerald-500 disabled:opacity-50"
              >
                +{amt}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              type="number"
              min="1"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm"
            />
            <button
              onClick={() => doDeposit(parseFloat(depositAmount))}
              disabled={depositing}
              className="whitespace-nowrap rounded-md bg-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-600 disabled:opacity-50"
            >
              Add
            </button>
          </div>
          {depositMsg && <p className="mt-1 text-xs text-emerald-400">{depositMsg}</p>}
        </div>

        {error && <p className="rounded bg-red-950/60 p-2 text-xs text-red-300">{error}</p>}

        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            className="w-full rounded-md border border-red-900 py-1.5 text-xs text-red-300 hover:bg-red-950/50"
          >
            Reset progress
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-slate-400">Clears history and resets points to 1000. Sure?</p>
            <div className="flex gap-2">
              <button
                onClick={doReset}
                disabled={resetting}
                className="flex-1 rounded-md bg-red-600 py-1.5 text-xs font-medium hover:bg-red-500 disabled:opacity-50"
              >
                {resetting ? "Resetting..." : "Yes, reset"}
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 rounded-md bg-slate-700 py-1.5 text-xs font-medium hover:bg-slate-600"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
