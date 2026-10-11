import type { ReactNode } from "react";

const POINTS = [
  { glyph: "₿", title: "Real crypto markets", text: "Bitcoin, Ethereum, Solana and more against USDT, USDC and BTC." },
  { glyph: "£", title: "City markets", text: "Nairobi, London, New York, Tokyo and more, ticking every few seconds." },
  { glyph: "100", title: "Free practice wallet", text: "Start with 100 virtual points. No risk, no card needed." },
  { glyph: "KSh", title: "Real M-Pesa wallet", text: "Top up with M-Pesa and trade with real money when you're ready." },
];

/** Split layout shared by login and register: brand panel on the left, form card on the right. */
export default function AuthShell({ headline, sub, children }: { headline: string; sub: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="relative hidden flex-1 overflow-hidden bg-gradient-to-br from-emerald-600 via-emerald-600 to-sky-700 lg:flex lg:flex-col lg:justify-center lg:px-16">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-black/10" />
        <div className="relative max-w-lg">
          <span className="mb-8 flex h-12 w-12 items-center justify-center rounded-xl bg-white text-lg font-extrabold text-emerald-700 shadow-lg">
            FX
          </span>
          <h1 className="text-4xl font-bold leading-tight text-white">{headline}</h1>
          <p className="mt-4 text-lg text-emerald-50/90">{sub}</p>
          <ul className="mt-10 space-y-5">
            {POINTS.map((p) => (
              <li key={p.title} className="flex items-start gap-4">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-bold text-white ring-1 ring-white/25">
                  {p.glyph}
                </span>
                <div>
                  <p className="font-semibold text-white">{p.title}</p>
                  <p className="text-sm text-emerald-50/80">{p.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-sm font-extrabold text-white">
              FX
            </span>
            <span className="text-lg font-semibold text-slate-900">Candle FX</span>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
