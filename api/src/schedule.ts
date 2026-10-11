/** Withdrawal payout schedule: a payout runs on every 3rd working day (Mon-Fri), Nairobi time.
 *
 * Working days are counted from a fixed anchor (Mon 28 Sep 2026 = working day 1), so payouts
 * fall on working days 3, 6, 9, ... - e.g. Wed 30 Sep, Mon 5 Oct, Thu 8 Oct, Tue 13 Oct.
 * Requests made before the 09:00 cut-off on a payout day join that day's 12:00 payout;
 * later requests wait for the next one. Fixed-date Kenyan public holidays are skipped. */

export const TIMEZONE = "Africa/Nairobi";
export const PAYOUT_EVERY_WORKING_DAYS = 3;
export const CUTOFF_HOUR = 9; // local time
export const PAYOUT_HOUR = 12; // local time

const DAY = 86_400_000;
const HOUR = 3_600_000;
const EAT_OFFSET = 3 * HOUR; // UTC+3, no daylight saving
const ANCHOR_DAY = Date.UTC(2026, 8, 28); // Monday, working day #1
// Fixed-date public holidays (MM-DD). Movable ones (Easter, Eid) are not included.
const HOLIDAYS = new Set(["01-01", "05-01", "06-01", "10-20", "12-12", "12-25", "12-26"]);

/** Midnight (as a UTC-ms "calendar day" value) of the Nairobi calendar day containing `ms`. */
const eatDay = (ms: number) => Math.floor((ms + EAT_OFFSET) / DAY) * DAY;

function isWorkingDay(day: number): boolean {
  const d = new Date(day);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const mmdd = `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return !HOLIDAYS.has(mmdd);
}

/** 1-based working-day number counted from the anchor, or 0 for non-working days / before the anchor. */
function workingDayNumber(day: number): number {
  if (day < ANCHOR_DAY || !isWorkingDay(day)) return 0;
  let n = 0;
  for (let d = ANCHOR_DAY; d <= day; d += DAY) if (isWorkingDay(d)) n++;
  return n;
}

const isPayoutDay = (day: number) => {
  const n = workingDayNumber(day);
  return n > 0 && n % PAYOUT_EVERY_WORKING_DAYS === 0;
};

const instant = (day: number, hour: number) => day + hour * HOUR - EAT_OFFSET;

export type Payout = { payout_at: string; cutoff_at: string; day: string };

const toPayout = (day: number): Payout => ({
  payout_at: new Date(instant(day, PAYOUT_HOUR)).toISOString(),
  cutoff_at: new Date(instant(day, CUTOFF_HOUR)).toISOString(),
  day: new Date(day).toISOString().slice(0, 10),
});

/** The batch a request made at `nowMs` will be paid in (first payout whose cut-off is still ahead). */
export function nextPayout(nowMs = Date.now()): Payout {
  for (let day = eatDay(nowMs), i = 0; i < 60; i++, day += DAY) {
    if (isPayoutDay(day) && nowMs < instant(day, CUTOFF_HOUR)) return toPayout(day);
  }
  throw new Error("No payout day found");
}

/** The next `count` payout dates whose payout time has not yet passed. */
export function upcomingPayouts(count = 5, nowMs = Date.now()): Payout[] {
  const out: Payout[] = [];
  for (let day = eatDay(nowMs), i = 0; out.length < count && i < 120; i++, day += DAY) {
    if (isPayoutDay(day) && nowMs < instant(day, PAYOUT_HOUR)) out.push(toPayout(day));
  }
  return out;
}
