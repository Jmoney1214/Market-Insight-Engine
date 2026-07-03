import { useEffect, useRef, memo } from "react";

/**
 * TradingView embeddable widgets (paid-plan data displayed client-side).
 * TradingView has no server data API, so charts / fundamentals / technicals are
 * rendered as official embed widgets in the browser rather than fetched server-side.
 * Each widget injects TradingView's script into a container ref.
 */
type WidgetProps = {
  scriptSrc: string;
  config: Record<string, unknown>;
  height?: number;
  testId?: string;
};

function TradingViewWidgetBase({ scriptSrc, config, height = 400, testId }: WidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";
    container.appendChild(widget);

    const script = document.createElement("script");
    script.src = scriptSrc;
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify(config);
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
    };
    // Re-inject when the symbol (or any config) changes.
  }, [scriptSrc, JSON.stringify(config)]);

  return (
    <div
      className="tradingview-widget-container rounded-md overflow-hidden border border-border"
      ref={containerRef}
      style={{ height }}
      data-testid={testId}
    />
  );
}

const TradingViewWidget = memo(TradingViewWidgetBase);

const COMMON = { colorTheme: "dark", isTransparent: true, locale: "en" } as const;

export function TradingViewChart({ symbol }: { symbol: string }) {
  return (
    <TradingViewWidget
      testId="tv-chart"
      height={460}
      scriptSrc="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js"
      config={{
        ...COMMON,
        symbol,
        interval: "D",
        timezone: "Etc/UTC",
        style: "1",
        allow_symbol_change: false,
        hide_side_toolbar: true,
        withdateranges: true,
        autosize: true,
      }}
    />
  );
}

export function TradingViewTechnicals({ symbol }: { symbol: string }) {
  return (
    <TradingViewWidget
      testId="tv-technicals"
      height={420}
      scriptSrc="https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js"
      config={{
        ...COMMON,
        symbol,
        interval: "1D",
        width: "100%",
        height: "100%",
        showIntervalTabs: true,
      }}
    />
  );
}

export function TradingViewFundamentals({ symbol }: { symbol: string }) {
  return (
    <TradingViewWidget
      testId="tv-fundamentals"
      height={490}
      scriptSrc="https://s3.tradingview.com/external-embedding/embed-widget-financials.js"
      config={{
        ...COMMON,
        symbol,
        displayMode: "regular",
        width: "100%",
        height: "100%",
        largeChartUrl: "",
      }}
    />
  );
}
