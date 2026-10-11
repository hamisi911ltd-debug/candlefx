"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Old bookmark: the trading terminal now lives at /trade.
export default function DashboardRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/trade");
  }, [router]);
  return null;
}
