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

type Bar = { timestamp: string; open: number; high: number; low: number; close: number; volume: number };

export default function PriceChart({ bars }: { bars: Bar[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const hasFitOnceRef = useRef(false);

  // Create the chart once. Recreating it on every data update (the previous bug
  // here) resets zoom/scroll/crosshair state each time, which is what looked like
  // the whole screen "shifting" whenever new candles arrived.
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "#0b0f14" }, textColor: "#94a3b8" },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      width: containerRef.current.clientWidth,
      height: 360,
      timeScale: { timeVisible: true, secondsVisible: true },
    });
    chartRef.current = chart;

    seriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
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

  // Just feed new data into the existing chart/series - no teardown, no scroll reset.
  useEffect(() => {
    if (!seriesRef.current) return;

    // Defensive: lightweight-charts requires strictly ascending, deduplicated
    // timestamps. Sort and drop duplicates here rather than trusting every caller
    // to hand back a perfectly clean, monotonic array.
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

    seriesRef.current.setData(sorted);
    // Only auto-fit the view the first time data arrives - repeating this on every
    // poll would fight the user's own zoom/pan and look like the chart "jumping".
    if (!hasFitOnceRef.current && sorted.length > 0) {
      chartRef.current?.timeScale().fitContent();
      hasFitOnceRef.current = true;
    }
  }, [bars]);

  return <div ref={containerRef} className="w-full" />;
}
