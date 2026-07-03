import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type UTCTimestamp,
  type CandlestickData,
  type HistogramData,
  type MouseEventParams,
} from "lightweight-charts";
import { CopilotEvent } from "@workspace/api-client-react";

interface ChartPanelProps {
  event?: CopilotEvent;
  isLoading: boolean;
  isError: boolean;
}

type Bar = CopilotEvent["bars"][number];

// Lightweight-charts paints to <canvas>, so the theme tokens (HSL CSS vars) have
// to be resolved to concrete color strings here.
const C = {
  bg: "#0c1017",
  text: "hsl(215, 20.2%, 65.1%)",
  grid: "hsla(215, 32%, 17%, 0.45)",
  border: "hsl(215, 32%, 17%)",
  up: "hsl(142.1, 64%, 45%)",
  down: "hsl(0, 74%, 58%)",
  upVol: "hsla(142.1, 64%, 45%, 0.4)",
  downVol: "hsla(0, 74%, 58%, 0.4)",
  crosshair: "hsl(215, 20.2%, 65.1%)",
  vwap: "hsl(38, 92%, 50%)",
  muted: "hsl(215, 18%, 55%)",
  entry: "hsl(217.2, 91.2%, 59.8%)",
  inval: "hsl(0, 74%, 58%)",
  target: "hsl(142.1, 64%, 45%)",
} as const;

interface LevelDef {
  value: number;
  title: string;
  color: string;
  style: LineStyle;
}

function levelsFromEvent(event: CopilotEvent): LevelDef[] {
  const { snapshot, riskReward } = event;
  const out: LevelDef[] = [];
  if (snapshot.vwap != null)
    out.push({ value: snapshot.vwap, title: "VWAP", color: C.vwap, style: LineStyle.Solid });
  if (snapshot.openingRangeHigh != null)
    out.push({ value: snapshot.openingRangeHigh, title: "ORH", color: C.muted, style: LineStyle.Dashed });
  if (snapshot.openingRangeLow != null)
    out.push({ value: snapshot.openingRangeLow, title: "ORL", color: C.muted, style: LineStyle.Dashed });
  if (riskReward.entry != null)
    out.push({ value: riskReward.entry, title: "ENTRY", color: C.entry, style: LineStyle.Solid });
  if (riskReward.invalidation != null)
    out.push({ value: riskReward.invalidation, title: "INVAL", color: C.inval, style: LineStyle.Dashed });
  if (riskReward.target != null)
    out.push({ value: riskReward.target, title: "TARGET", color: C.target, style: LineStyle.Dashed });
  return out;
}

// Keep only strictly time-increasing bars: lightweight-charts throws on
// duplicate / out-of-order timestamps. We never fabricate or reorder candles.
function cleanBars(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  let lastT = -Infinity;
  for (const b of bars) {
    if (b.t > lastT) {
      out.push(b);
      lastT = b.t;
    }
  }
  return out;
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return `${Math.round(v)}`;
}

function formatBarTime(t: number): string {
  const iso = new Date(t * 1000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

interface Readout {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
}

export function ChartPanel({ event, isLoading, isError }: ChartPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const lastSymbolRef = useRef<string | null>(null);

  const [hover, setHover] = useState<Readout | null>(null);

  // Create the chart once. Series, crosshair subscription and the resize
  // observer are torn down on unmount (and re-created under StrictMode).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      autoSize: false,
      layout: {
        background: { color: C.bg },
        textColor: C.text,
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: C.grid },
        horzLines: { color: C.grid },
      },
      rightPriceScale: {
        borderColor: C.border,
        scaleMargins: { top: 0.08, bottom: 0.26 },
      },
      timeScale: {
        borderColor: C.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 3,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: C.crosshair,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: C.border,
        },
        horzLine: {
          color: C.crosshair,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: C.border,
        },
      },
    });

    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      color: C.upVol,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.84, bottom: 0 },
    });

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: C.up,
      downColor: C.down,
      borderUpColor: C.up,
      borderDownColor: C.down,
      wickUpColor: C.up,
      wickDownColor: C.down,
      priceLineVisible: true,
      priceLineColor: C.muted,
    });

    const onCrosshairMove = (param: MouseEventParams) => {
      if (param.time === undefined || !param.point) {
        setHover(null);
        return;
      }
      const c = param.seriesData.get(candle) as CandlestickData | undefined;
      if (!c) {
        setHover(null);
        return;
      }
      const vol = param.seriesData.get(volume) as HistogramData | undefined;
      setHover({
        t: param.time as number,
        o: c.open,
        h: c.high,
        l: c.low,
        c: c.close,
        v: vol?.value ?? null,
      });
    };
    chart.subscribeCrosshairMove(onCrosshairMove);

    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
    });
    ro.observe(container);

    chartRef.current = chart;
    candleRef.current = candle;
    volumeRef.current = volume;

    return () => {
      ro.disconnect();
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      priceLinesRef.current = [];
      lastSymbolRef.current = null;
    };
  }, []);

  // Push the latest event's bars + levels into the chart.
  useEffect(() => {
    const chart = chartRef.current;
    const candle = candleRef.current;
    const volume = volumeRef.current;
    if (!chart || !candle || !volume) return;

    // Always drop stale price lines first; rebuilt below only when data exists.
    for (const line of priceLinesRef.current) candle.removePriceLine(line);
    priceLinesRef.current = [];

    const bars = event ? cleanBars(event.bars) : [];
    if (!event || bars.length === 0) {
      // No usable data: blank the chart so nothing renders behind the overlay.
      candle.setData([]);
      volume.setData([]);
      return;
    }

    const candles: CandlestickData[] = bars.map((b) => ({
      time: b.t as UTCTimestamp,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
    }));
    const volumes: HistogramData[] = bars.map((b) => ({
      time: b.t as UTCTimestamp,
      value: b.v,
      color: b.c >= b.o ? C.upVol : C.downVol,
    }));
    candle.setData(candles);
    volume.setData(volumes);

    priceLinesRef.current = levelsFromEvent(event).map((lv) =>
      candle.createPriceLine({
        price: lv.value,
        color: lv.color,
        lineWidth: 1,
        lineStyle: lv.style,
        axisLabelVisible: true,
        title: lv.title,
      }),
    );

    // Frame the whole session on symbol change and as a REPLAY clip grows, so
    // it always reads cleanly; otherwise preserve any manual zoom/pan.
    if (lastSymbolRef.current !== event.symbol || event.mode === "REPLAY") {
      chart.timeScale().fitContent();
      lastSymbolRef.current = event.symbol;
    }
  }, [event]);

  const bars = event?.bars ?? [];
  const latest = bars.length > 0 ? bars[bars.length - 1] : null;
  const readout: Readout | null =
    hover ??
    (latest
      ? { t: latest.t, o: latest.o, h: latest.h, l: latest.l, c: latest.c, v: latest.v }
      : null);
  const up = readout ? readout.c >= readout.o : true;

  const overlay = isLoading
    ? "LOADING CHART..."
    : isError || !event
      ? "CHART UNAVAILABLE"
      : bars.length === 0
        ? "NO PRICE DATA"
        : null;

  return (
    <div className="relative h-full w-full" style={{ backgroundColor: C.bg }}>
      <div ref={containerRef} className="absolute inset-0" />

      {readout && !overlay && (
        <div className="absolute top-2 left-2 z-10 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] pointer-events-none">
          <span className="text-foreground font-semibold">{event?.symbol}</span>
          <span className="text-muted-foreground">{event?.mode}</span>
          <span className="text-muted-foreground">{formatBarTime(readout.t)}</span>
          <span className="text-muted-foreground">
            O <span className="text-foreground tabular-nums">{readout.o.toFixed(2)}</span>
          </span>
          <span className="text-muted-foreground">
            H <span className="text-foreground tabular-nums">{readout.h.toFixed(2)}</span>
          </span>
          <span className="text-muted-foreground">
            L <span className="text-foreground tabular-nums">{readout.l.toFixed(2)}</span>
          </span>
          <span className="text-muted-foreground">
            C{" "}
            <span
              className="tabular-nums font-semibold"
              style={{ color: up ? C.up : C.down }}
            >
              {readout.c.toFixed(2)}
            </span>
          </span>
          {readout.v != null && (
            <span className="text-muted-foreground">
              VOL{" "}
              <span className="text-foreground tabular-nums">
                {formatVolume(readout.v)}
              </span>
            </span>
          )}
        </div>
      )}

      {overlay && (
        <div
          className={`absolute inset-0 flex items-center justify-center font-mono text-sm ${
            overlay === "CHART UNAVAILABLE"
              ? "text-destructive"
              : "text-muted-foreground"
          }`}
        >
          {overlay}
        </div>
      )}
    </div>
  );
}
