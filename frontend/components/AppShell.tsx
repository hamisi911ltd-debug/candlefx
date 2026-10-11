"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useAppData } from "@/lib/app-data";
import { fmtUsd } from "@/lib/money";

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <path d={d} />
  </svg>
);

const NAV = [
  { href: "/trade", label: "Trade", icon: icon("M3 17l6-6 4 4 8-8M15 7h6v6") },
  { href: "/markets", label: "Markets", icon: icon("M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z") },
  { href: "/wallet", label: "Wallet", icon: icon("M3 7h16a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7zm0 0V6a2 2 0 012-2h11M16 14h2") },
  { href: "/history", label: "History", icon: icon("M12 7v5l3 2M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5") },
  { href: "/account", label: "Account", icon: icon("M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0") },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const { user, logout } = useAuth();
  const { stats, kesToUsd } = useAppData();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1760px] items-center gap-6 px-4 sm:px-6">
          <Link href="/trade" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-sm font-extrabold text-white shadow-sm">
              FX
            </span>
            <span className="hidden text-lg font-bold tracking-tight text-slate-900 sm:block">Candle FX</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV.slice(0, 4).map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                  isActive(n.href) ? "bg-emerald-50 text-emerald-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {stats && (
              <Link
                href="/wallet"
                className="hidden items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 transition-colors hover:border-emerald-300 sm:flex"
              >
                <span className="text-right leading-tight">
                  <span className="block text-[10px] font-medium uppercase tracking-wide text-slate-400">Real</span>
                  <span className="tabular text-sm font-semibold text-slate-900">{fmtUsd(kesToUsd(stats.real_balance_kes))}</span>
                </span>
                <span className="h-7 w-px bg-slate-200" />
                <span className="text-right leading-tight">
                  <span className="block text-[10px] font-medium uppercase tracking-wide text-slate-400">Practice</span>
                  <span className="tabular text-sm font-semibold text-slate-900">{stats.points_balance.toFixed(0)} pts</span>
                </span>
              </Link>
            )}
            {stats && (
              <Link href="/wallet" className="tabular rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-900 sm:hidden">
                {fmtUsd(kesToUsd(stats.real_balance_kes))} · {stats.points_balance.toFixed(0)}p
              </Link>
            )}
            <Link
              href="/wallet"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
            >
              Deposit
            </Link>
            <Link
              href="/account"
              title={user?.email}
              className="hidden h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold uppercase text-white md:flex"
            >
              {user?.email?.[0] ?? "?"}
            </Link>
            <button
              onClick={logout}
              className="hidden rounded-lg px-2 py-2 text-sm font-medium text-slate-500 hover:text-slate-900 lg:block"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[1760px] flex-col px-4 pb-24 pt-6 sm:px-6 md:pb-8">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white/95 backdrop-blur md:hidden">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${
              isActive(n.href) ? "text-emerald-600" : "text-slate-500"
            }`}
          >
            {n.icon}
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
