"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { apiFetch, ApiError } from "@/lib/api";
import PriceChart from "@/components/PriceChart";
import LiveTicker from "@/components/LiveTicker";
import AccountPanel from "@/components/AccountPanel";

type Currency = "points" | "kes";
type Bar = { timestamp: string; open: number; high: number; low: number; close: number; volume: number };
type Round = {
  symbol: string; seed: string; start_time: number; tick_seconds: number;
  bars: Bar[]; entry_tick_index: number; entry_time: string; entry_price: number;
  points_balance: number; payout_rate: number; server_time: number;
};
type ResolveResult = {
  correct: boolean; actual_direction: string; exit_price: number; exit_bar: Bar;
  payout: number; currency: Currency; points_balance: number; real_balance_kes: number;
  next_entry_tick_index: number; next_entry_price: number;
};
type HistoryItem = {
  id: string; symbol: string; direction: string; stake: number; currency: Currency;
  entry_price: number; exit_price: number; correct: boolean; payout: number; created_at: string;
};
type Stats = {
  points_balance: number; real_balance_kes: number;
  total_predictions: number; correct_predictions: number; payout_rate: number;
};

const SYMBOLS = [
  { id: "SIM-CALM", label: "Calm", vol: "Low volatility" },
  { id: "SIM-STEADY", label: "Steady", vol: "Medium volatility" },
  { id: "SIM-WILD", label: "Wild", vol: "High volatility" },
];

export default function GamePage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  const [symbol, setSymbol] = useState("SIM-STEADY");
  const [round, setRound] = useState<Round | null>(null);
  const [bars, setBars] = useState<Bar[]>([]);
  const [entryTickIndex, setEntryTickIndex] = useState<number | null>(null);
  const [entryPrice, setEntryPrice] = useState<number | null>(null);
  const [roundLoading, setRoundLoading] = useState(true);
  const [roundError, setRoundError] = useState<string | null>(null);

  const [stake, setStake] = useState("50");
  const [currency, setCurrency] = useState<Currency>("points");
  const [pendingDirection, setPendingDirection] = useState<"up" | "down" | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  const roundRef = useRef<Round | null>(null);
  roundRef.current = round;
  const pendingDirectionRef = useRef<"up" | "down" | null>(null);
  pendingDirectionRef.current = pendingDirection;

  const loadStats = useCallback(async () => setStats(await apiFetch("/api/predict/account")), []);
  const loadHistory = useCallback(async () => setHistory(await apiFetch("/api/predict/history")), []);

  // Single source of truth for the visible chart data - always a full, correctly
  // ordered replace from the server, never a manual splice. Both the periodic live
  // poll and "just resolved a guess" call this same function, so there is only one
  // path that can ever set `bars`, which is what fixed the out-of-order chart crash.
  //
  // When no guess is pending, it also re-syncs "current price" (entryPrice/
  // entryTickIndex) to the latest bar - otherwise that label would freeze at
  // whatever it was when the round started while the chart keeps ticking forward
  // live, and the two would visibly drift apart. While a guess IS pending, the
  // entry point must stay fixed to what was actually bet on, so it's left alone.
  const refreshBars = useCallback(async (r: Round, syncEntry: boolean) => {
    try {
      const data = await apiFetch(
        `/api/predict/live?symbol=${encodeURIComponent(r.symbol)}&seed=${r.seed}&start_time=${r.start_time}`
      );
      setBars(data.bars);
      if (syncEntry && !pendingDirectionRef.current && data.bars.length > 0) {
        const last = data.bars[data.bars.length - 1];
        setEntryTickIndex(data.latest_closed_tick_index);
        setEntryPrice(last.close);
      }
    } catch {
      // transient - next poll retries
    }
  }, []);

  const startRound = useCallback(async (nextSymbol: string) => {
    setRoundLoading(true);
    setRoundError(null);
    setResult(null);
    setPendingDirection(null);
    try {
      const data: Round = await apiFetch(`/api/predict/round?symbol=${encodeURIComponent(nextSymbol)}`);
      setRound(data);
      setBars(data.bars);
      setEntryTickIndex(data.entry_tick_index);
      setEntryPrice(data.entry_price);
    } catch (err) {
      setRoundError(err instanceof ApiError ? err.message : "Failed to start a round");
    } finally {
      setRoundLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loading && !user) return;
    if (!loading && !user) {
      router.replace("/login");
      return;
    }
    if (!user) return;
    startRound(symbol);
    loadStats();
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading]);

  // Live tick: refresh the chart every tick so it keeps advancing on its own.
  useEffect(() => {
    if (!round) return;
    const interval = setInterval(() => {
      const r = roundRef.current;
      if (r) refreshBars(r, true);
    }, round.tick_seconds * 1000);
    return () => clearInterval(interval);
  }, [round, refreshBars]);

  // Countdown display for a pending guess.
  useEffect(() => {
    if (!pendingDirection || !round || entryTickIndex === null) {
      setCountdown(0);
      return;
    }
    const targetCloseAt = round.start_time + (entryTickIndex + 2) * round.tick_seconds;
    const tick = () => setCountdown(Math.max(0, targetCloseAt - Date.now() / 1000));
    tick();
    const interval = setInterval(tick, 200);
    return () => clearInterval(interval);
  }, [pendingDirection, round, entryTickIndex]);

  const onSymbolChange = (next: string) => {
    setSymbol(next);
    startRound(next);
  };

  const placeGuess = (direction: "up" | "down") => {
    setPendingDirection(direction);
    setResultError(null);
  };

  // Attempts to resolve a pending guess; retries automatically until the tick closes.
  useEffect(() => {
    if (!pendingDirection || !round || entryTickIndex === null || entryPrice === null) return;
    let cancelled = false;

    const attempt = async () => {
      try {
        const res: ResolveResult = await apiFetch("/api/predict/resolve", {
          method: "POST",
          body: JSON.stringify({
            symbol: round.symbol,
            seed: round.seed,
            start_time: round.start_time,
            entry_tick_index: entryTickIndex,
            direction: pendingDirection,
            stake: parseFloat(stake),
            currency,
          }),
        });
        if (cancelled) return;
        setResult(res);
        setEntryTickIndex(res.next_entry_tick_index);
        setEntryPrice(res.next_entry_price);
        setPendingDirection(null);
        await Promise.all([loadStats(), loadHistory(), refreshBars(round, false)]);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 425) {
          setTimeout(attempt, 500);
        } else {
          setResultError(err instanceof ApiError ? err.message : "Failed to submit prediction");
          setPendingDirection(null);
        }
      }
    };
    attempt();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDirection]);

  const refreshAccount = useCallback(() => {
    loadStats();
    loadHistory();
  }, [loadStats, loadHistory]);

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-950 to-black px-4">
        <p className="text-slate-400">Loading...</p>
      </main>
    );
  }

  const activeBalance = stats ? (currency === "kes" ? stats.real_balance_kes : stats.points_balance) : 0;
  const insufficientBalance = stats !== null && parseFloat(stake || "0") > activeBalance;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-black">
      <header className="sticky top-0 z-10 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-sky-600 text-sm font-bold">
              FX
            </span>
            <div>
              <h1 className="text-lg font-semibold leading-none">Candle FX</h1>
              <p className="text-xs text-slate-500">Live candle prediction game</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 rounded-full bg-emerald-950/60 px-3 py-1 text-xs text-emerald-300 sm:flex">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Market live
            </span>
            {stats && (
              <span className="flex items-center gap-2 rounded-full bg-slate-800 px-3 py-1 text-sm font-medium text-slate-200">
                <span>{stats.points_balance.toFixed(0)} pts</span>
                <span className="text-slate-600">|</span>
                <span className="text-emerald-400">KES {stats.real_balance_kes.toFixed(2)}</span>
              </span>
            )}
            <span className="hidden text-xs text-slate-500 md:inline">{user.email}</span>
            <button
              onClick={logout}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {stats && (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Balance" value={`${stats.points_balance.toFixed(0)} pts`} accent="text-slate-100" />
            <StatTile label="Predictions" value={String(stats.total_predictions)} />
            <StatTile
              label="Accuracy"
              value={stats.total_predictions > 0 ? `${Math.round((stats.correct_predictions / stats.total_predictions) * 100)}%` : "-"}
            />
            <StatTile label="Payout rate" value={`+${Math.round(stats.payout_rate * 100)}%`} accent="text-emerald-400" />
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_300px]">
          <div className="space-y-6">
            <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-xl shadow-black/20 sm:p-6">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {SYMBOLS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onSymbolChange(s.id)}
                    title={s.vol}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      s.id === symbol ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
                <span className="ml-auto flex items-center gap-1 text-xs text-emerald-400">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> live
                </span>
              </div>

              <div className="min-h-[360px]">
                {roundLoading ? (
                  <p className="text-sm text-slate-500">Starting round...</p>
                ) : roundError ? (
                  <p className="rounded bg-red-950/60 p-2 text-sm text-red-300">{roundError}</p>
                ) : (
                  <PriceChart bars={bars} />
                )}
              </div>

              {round && !roundLoading && entryPrice !== null && (
                <div className="mt-4 space-y-3 border-t border-slate-800 pt-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-slate-400">
                      Current price: <span className="font-medium text-slate-200">{entryPrice}</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      Win pays <span className="text-emerald-400">+{Math.round(round.payout_rate * 100)}%</span>
                    </p>
                  </div>
                  <p className="text-sm text-slate-400">Will the next candle close higher or lower?</p>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={stake}
                      onChange={(e) => setStake(e.target.value)}
                      className={`w-full rounded-md border bg-slate-950 px-3 py-2 text-sm sm:w-28 ${
                        insufficientBalance ? "border-red-700" : "border-slate-700"
                      }`}
                      disabled={!!pendingDirection}
                    />
                    <div className="flex flex-1 gap-3">
                      <button
                        onClick={() => placeGuess("up")}
                        disabled={!!pendingDirection || insufficientBalance}
                        className="flex-1 rounded-md bg-emerald-600 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
                      >
                        ▲ Up
                      </button>
                      <button
                        onClick={() => placeGuess("down")}
                        disabled={!!pendingDirection || insufficientBalance}
                        className="flex-1 rounded-md bg-red-600 py-2 text-sm font-medium hover:bg-red-500 disabled:opacity-50"
                      >
                        ▼ Down
                      </button>
                    </div>
                  </div>
                  {insufficientBalance && (
                    <p className="text-xs text-red-400">Not enough points - add some from the wallet panel.</p>
                  )}

                  <div className="min-h-[4.5rem]">
                    {pendingDirection && (
                      <p className="text-center text-sm text-slate-400">
                        Locked in <span className="font-medium text-slate-200">{pendingDirection}</span> — revealing in {countdown.toFixed(1)}s...
                      </p>
                    )}

                    {resultError && <p className="rounded bg-red-950/60 p-2 text-sm text-red-300">{resultError}</p>}

                    {result && (
                      <div className={`rounded-md p-3 text-sm ${result.correct ? "bg-emerald-950/60 text-emerald-300" : "bg-red-950/60 text-red-300"}`}>
                        <p className="font-medium">
                          {result.correct ? "Correct!" : "Wrong."} It went {result.actual_direction} to {result.exit_price}.{" "}
                          {result.payout >= 0 ? `+${result.payout.toFixed(2)}` : result.payout.toFixed(2)} points.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-xl shadow-black/20 sm:p-6">
              <h2 className="mb-4 text-lg font-medium">History</h2>
              {history.length === 0 ? (
                <p className="text-sm text-slate-500">No predictions yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="pb-2">Time</th>
                        <th className="pb-2">Symbol</th>
                        <th className="pb-2">Guess</th>
                        <th className="pb-2">Result</th>
                        <th className="pb-2">Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h) => (
                        <tr key={h.id} className="border-t border-slate-800">
                          <td className="py-2 text-slate-500">{new Date(h.created_at).toLocaleString()}</td>
                          <td className="py-2 font-medium">{h.symbol}</td>
                          <td className="py-2 text-slate-400">{h.direction}</td>
                          <td className={`py-2 ${h.correct ? "text-emerald-400" : "text-red-400"}`}>
                            {h.correct ? "Correct" : "Wrong"}
                          </td>
                          <td className={`py-2 ${h.payout >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {h.payout >= 0 ? `+${h.payout.toFixed(2)}` : h.payout.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <div className="space-y-6">
            <LiveTicker symbols={SYMBOLS.map((s) => s.id)} />
            <AccountPanel stats={stats} onChange={refreshAccount} />
          </div>
        </div>

        <footer className="mt-10 border-t border-slate-800/60 pt-6 text-center text-xs text-slate-600">
          Candle FX uses virtual points only - no real money, deposits, or exchange account are involved anywhere in this app.
        </footer>
      </main>
    </div>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-center shadow-sm shadow-black/10">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${accent ?? "text-slate-200"}`}>{value}</p>
    </div>
  );
}
