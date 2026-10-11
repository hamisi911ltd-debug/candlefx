"use client";

import { useEffect, useState } from "react";

/** Current time in ms, re-rendering the caller every `everyMs` (default 1s) for live countdowns. */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
