"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { priceDecimals } from "@/lib/markets";

type Bar = { timestamp: string; open: number; high: number; low: number; close: number; volume: number };

export default function PriceChart({ bars, fitKey }: { bars: Bar[]; fitKey: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const fitKeyRef = useRef<string | null>(null);

  // Create the chart once. Recreating it on every data update resets zoom/scroll/crosshair
  // state each time, which is what looked like the whole screen "shifting".
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "#ffffff" }, textColor: "#475569", fontFamily: "inherit" },
      grid: { vertLines: { color: "#f1f5f9" }, horzLines: { color: "#f1f5f9" } },
      width: containerRef.current.clientWidth,
      height: 420,
      timeScale: { borderColor: "#e2e8f0", timeVisible: true, secondsVisible: true, rightOffset: 4 },
      rightPriceScale: { borderColor: "#e2e8f0", scaleMargins: { top: 0.12, bottom: 0.12 } },
      crosshair: { mode: 0, vertLine: { color: "#94a3b8", labelBackgroundColor: "#334155" }, horzLine: { color: "#94a3b8", labelBackgroundColor: "#334155" } },
    });
    chartRef.current = chart;

    seriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: "#059669",
      downColor: "#dc2626",
      borderVisible: false,
      wickUpColor: "#059669",
      wickDownColor: "#dc2626",
    });

    const onResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Feed new data into the existing chart/series - no teardown, no scroll reset.
  useEffect(() => {
    if (!seriesRef.current) return;

    // lightweight-charts requires strictly ascending, deduplicated timestamps.
    const seen = new Set<number>();
    const sorted = [...bars]
      .map((b) => ({
        time: Math.floor(new Date(b.timestamp).getTime() / 1000) as UTCTimestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number))
      .filter((b) => {
        if (seen.has(b.time as number)) return false;
        seen.add(b.time as number);
        return true;
      });

    if (sorted.length > 0) {
      const d = priceDecimals(sorted[sorted.length - 1].close);
      seriesRef.current.applyOptions({ priceFormat: { type: "price", precision: d, minMove: Math.pow(10, -d) } });
    }
    seriesRef.current.setData(sorted);

    // Re-fit only when the market or scale changes - refitting on every poll would fight
    // the user's own zoom/pan and look like the chart "jumping".
    if (sorted.length > 0 && fitKeyRef.current !== fitKey) {
      chartRef.current?.timeScale().fitContent();
      fitKeyRef.current = fitKey;
    }
  }, [bars, fitKey]);

  return <div ref={containerRef} className="w-full" />;
}
