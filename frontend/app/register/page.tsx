"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";

export default function RegisterPage() {
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-950 to-black px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl shadow-black/20">
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-sky-600 text-sm font-bold">FX</span>
          <h1 className="text-xl font-semibold">Create your account</h1>
        </div>
        {error && <p className="rounded bg-red-950/60 p-2 text-sm text-red-300">{error}</p>}
        <div>
          <label className="mb-1 block text-sm text-slate-400">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-400">Password</label>
          <input
            type="password"
            required
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-slate-500">At least 10 characters, with a letter and a digit.</p>
        </div>
        <p className="rounded-lg border border-amber-700/50 bg-amber-950/40 p-3 text-xs text-amber-200">
          Your own private wallet on Candle FX uses virtual points only - no real money is involved.
        </p>
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-emerald-600 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
        >
          {submitting ? "Creating account..." : "Create account"}
        </button>
        <p className="text-center text-sm text-slate-500">
          Already have an account? <Link href="/login" className="text-emerald-400 hover:underline">Log in</Link>
        </p>
      </form>
    </main>
  );
}
