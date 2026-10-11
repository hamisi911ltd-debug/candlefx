export type Market = {
  id: string;
  label: string;
  kind: "crypto" | "sim";
  base: string;
  quote: string;
  glyph: string; // currency symbol of the base asset
  quoteGlyph: string; // currency symbol prices are quoted in
};

export const RANGES = [
  { id: "3m", label: "3m" },
  { id: "15m", label: "15m" },
  { id: "1h", label: "1h" },
  { id: "6h", label: "6h" },
  { id: "24h", label: "24h" },
] as const;
export type RangeId = (typeof RANGES)[number]["id"];

/** Decimal places that keep a price readable whether it is 83,000 or 0.0000057. */
export function priceDecimals(p: number): number {
  const a = Math.abs(p);
  if (a >= 1000) return 2;
  if (a >= 10) return 3;
  if (a >= 1) return 4;
  if (a >= 0.01) return 5;
  return 8;
}

export function formatPrice(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "-";
  const d = priceDecimals(p);
  return p.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function pairLabel(m: Market): string {
  return m.kind === "crypto" ? `${m.base}/${m.quote}` : m.label;
}
