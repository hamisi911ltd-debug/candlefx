import type { Market } from "@/lib/markets";

// Real logos served from public CDNs. Each asset has a fallback source; if every one fails
// the badge falls back to the currency symbol.
const coincap = (s: string) => `https://assets.coincap.io/assets/icons/${s.toLowerCase()}@2x.png`;
const spothq = (s: string) => `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/${s.toLowerCase()}.png`;
const flag = (cc: string) => `https://flagcdn.com/w80/${cc}.png`;

// City markets trade in their local currency, so they show that country's flag.
const CITY_FLAGS: Record<string, string> = {
  NAIROBI: "ke", LONDON: "gb", NEWYORK: "us", TOKYO: "jp",
  DUBAI: "ae", HONGKONG: "hk", SINGAPORE: "sg", JOHANNESBURG: "za",
};

export const coinLogos = (symbol: string): string[] => [coincap(symbol), spothq(symbol)];

export function marketLogos(m: Market): string[] {
  if (m.kind === "crypto") return coinLogos(m.base);
  const cc = CITY_FLAGS[m.id];
  return cc ? [flag(cc)] : [];
}
