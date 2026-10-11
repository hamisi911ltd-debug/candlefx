"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import AuthShell from "@/components/AuthShell";
import { alertError, btnPrimary, card, input, label } from "@/lib/ui";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell headline="Welcome back to Candle FX." sub="The markets are ticking. Log in to pick up where you left off.">
      <form onSubmit={onSubmit} className={`${card} space-y-5 p-7`}>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Log in</h1>
          <p className="mt-1 text-sm text-slate-500">Enter your details to continue.</p>
        </div>
        {error && <p className={alertError}>{error}</p>}
        <div>
          <label className={label} htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={input}
          />
        </div>
        <div>
          <label className={label} htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={input}
          />
        </div>
        <button type="submit" disabled={submitting} className={`${btnPrimary} w-full py-2.5`}>
          {submitting ? "Logging in..." : "Log in"}
        </button>
        <p className="text-center text-sm text-slate-500">
          No account?{" "}
          <Link href="/register" className="font-semibold text-emerald-600 hover:text-emerald-700 hover:underline">
            Create one
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
