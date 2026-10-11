"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import AuthShell from "@/components/AuthShell";
import { alertError, btnPrimary, card, input, label } from "@/lib/ui";

export default function RegisterPage() {
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register(email, password, phone);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      headline="Trade candle predictions across global markets."
      sub="Call the next candle up or down on live crypto and simulated city markets. Practice free, or play with real M-Pesa money."
    >
      <form onSubmit={onSubmit} className={`${card} space-y-5 p-7`}>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Create your account</h1>
          <p className="mt-1 text-sm text-slate-500">Includes a free 100-point practice wallet.</p>
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
          <label className={label} htmlFor="phone">
            M-Pesa phone <span className="font-normal text-slate-400">(optional, for deposits)</span>
          </label>
          <input
            id="phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0712345678"
            className={input}
          />
        </div>
        <div>
          <label className={label} htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={input}
          />
          <p className="mt-1.5 text-xs text-slate-500">At least 10 characters, with a letter and a digit.</p>
        </div>
        <button type="submit" disabled={submitting} className={`${btnPrimary} w-full py-2.5`}>
          {submitting ? "Creating account..." : "Create account"}
        </button>
        <p className="text-center text-sm text-slate-500">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-emerald-600 hover:text-emerald-700 hover:underline">
            Log in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
