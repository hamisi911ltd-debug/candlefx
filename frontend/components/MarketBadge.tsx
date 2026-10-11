"use client";

import { useState } from "react";
import type { Market } from "@/lib/markets";
import { coinLogos, marketLogos } from "@/lib/logos";

const SIZES = {
  sm: { box: "h-6 w-6", text: "text-[10px]", quote: "h-3 w-3 -bottom-0.5 -right-0.5" },
  md: { box: "h-8 w-8", text: "text-xs", quote: "h-3.5 w-3.5 -bottom-0.5 -right-0.5" },
  lg: { box: "h-11 w-11", text: "text-base", quote: "h-5 w-5 -bottom-1 -right-1" },
} as const;

/** An <img> that walks through fallback sources, then renders `fallback` if all of them fail. */
function Logo({ srcs, alt, className, fallback }: { srcs: string[]; alt: string; className: string; fallback: React.ReactNode }) {
  const [idx, setIdx] = useState(0);
  if (idx >= srcs.length) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={srcs[idx]}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setIdx((i) => i + 1)}
    />
  );
}

/** Round market logo: the real coin logo / country flag, with the quote currency as a small overlay. */
export default function MarketBadge({ market, size = "md" }: { market: Market; size?: keyof typeof SIZES }) {
  const s = SIZES[size];
  const glyphFallback = (
    <span
      className={`flex h-full w-full items-center justify-center rounded-full bg-slate-100 font-bold leading-none text-slate-600 ${s.text}`}
    >
      {market.glyph.length > 3 ? market.glyph.slice(0, 3) : market.glyph}
    </span>
  );

  return (
    <span className={`relative inline-flex flex-shrink-0 ${s.box}`} aria-hidden>
      <span className="h-full w-full overflow-hidden rounded-full bg-white ring-1 ring-slate-200">
        <Logo
          srcs={marketLogos(market)}
          alt=""
          className="h-full w-full object-cover"
          fallback={glyphFallback}
        />
      </span>
      {market.kind === "crypto" && size !== "sm" && (
        <span className={`absolute overflow-hidden rounded-full bg-white ring-2 ring-white ${s.quote}`}>
          <Logo srcs={coinLogos(market.quote)} alt="" className="h-full w-full object-cover" fallback={<span className="block h-full w-full bg-slate-300" />} />
        </span>
      )}
    </span>
  );
}
