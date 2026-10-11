/** USD <-> KES exchange rate, used to quote every amount in US dollars. */
const FALLBACK_KES_PER_USD = 129;

export type Fx = { kes_per_usd: number; usd_per_kes: number; source: "live" | "fallback" };

const cacheReq = (kind: "fresh" | "stale") => new Request(`https://fx-cache.internal/${kind}`);

async function cached(kind: "fresh" | "stale"): Promise<number | null> {
  try {
    const hit = await caches.default.match(cacheReq(kind));
    const n = hit ? Number(await hit.text()) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

const store = (kind: "fresh" | "stale", rate: number, ttlS: number) =>
  caches.default.put(cacheReq(kind), new Response(String(rate), { headers: { "Cache-Control": `max-age=${ttlS}` } }));

const build = (kesPerUsd: number, source: Fx["source"]): Fx => ({
  kes_per_usd: kesPerUsd,
  usd_per_kes: 1 / kesPerUsd,
  source,
});

export async function getFx(): Promise<Fx> {
  const fresh = await cached("fresh");
  if (fresh) return build(fresh, "live");
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const body = (await res.json()) as any;
    const rate = Number(body?.rates?.KES);
    if (res.ok && Number.isFinite(rate) && rate > 50 && rate < 400) {
      await Promise.all([store("fresh", rate, 3600), store("stale", rate, 7 * 86400)]);
      return build(rate, "live");
    }
  } catch {
    // fall through to stale / fallback
  }
  const stale = await cached("stale");
  return stale ? build(stale, "live") : build(FALLBACK_KES_PER_USD, "fallback");
}
