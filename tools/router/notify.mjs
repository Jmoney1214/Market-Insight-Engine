// Slack morning ping via the Zapier catch-hook. Opt-in (--slack). Payload is the
// FLAT shape Zapier's Catch Hook actually maps to Slack fields (text/title/source/
// project/level/timestamp) — see claude-zapier-slack.md. A nested {content:{...}}
// body renders a blank Slack message; Zapier still returns HTTP 200, so that
// failure mode is silent unless the shape matches exactly.
const WEBHOOK = "https://hooks.zapier.com/hooks/catch/23493233/urrpmdj/";

export async function sendSlack(scan) {
  const c = scan.counts;
  const ok = scan.rows.filter((r) => !r.error);
  const byProx = (a, b) => (b.metrics.pctVs20dHigh ?? -1e9) - (a.metrics.pctVs20dHigh ?? -1e9);
  const buys = ok.filter((r) => r.strategy === "TrendRider" && r.signal === "breakout").sort(byProx)
    .map((r) => `${r.sym} (+${r.metrics.pctVs20dHigh.toFixed(2)}%, ADX ${Math.round(r.metrics.adx)})`);
  const coils = ok.filter((r) => r.strategy === "TrendRider" && r.signal === "coil").sort(byProx).slice(0, 6)
    .map((r) => `${r.sym} ${r.metrics.pctVs20dHigh.toFixed(1)}% (ADX ${Math.round(r.metrics.adx)})`);

  const lines = [
    buys.length ? `🟢 LIVE BUY: ${buys.join(", ")}` : "🟢 No LIVE breakout today",
    `🟡 Coiling (watch): ${coils.join(" · ") || "—"}`,
    `Lanes → ${c.breakout} breakout · ${c.coil} coil · ${c.paper} paper · ${c.cash} cash`,
  ];

  // Premarket/both mode is the whole point of a gapper run — without this line the
  // gappers (the reason for running that mode) never show up in Slack.
  if (scan.mode === "premarket" || scan.mode === "both") {
    const gapByProx = (a, b) => (b.premarket.gapPct ?? -1e9) - (a.premarket.gapPct ?? -1e9);
    const gappers = ok.filter((r) => r.premarket && (r.premarket.lane === "Momentum" || r.premarket.lane === "JumpDay"))
      .sort(gapByProx)
      .map((r) => `${r.sym} ${r.premarket.lane} ${r.premarket.gapPct >= 0 ? "+" : ""}${r.premarket.gapPct.toFixed(1)}%`);
    if (gappers.length) lines.push(`🔵 Premarket gappers: ${gappers.join(", ")}`);
  }

  const text = lines.join("\n");

  const payload = {
    text,
    title: `Strategy Router — ${scan.date} (${scan.mode})`,
    source: "agent",
    project: "Market-Insight-Engine",
    level: buys.length ? "success" : "info",
    timestamp: new Date().toISOString(),
  };

  console.log("Slack payload →", JSON.stringify(payload)); // visibility — Zapier 200s even on shape mismatch
  const r = await fetch(WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(`Zapier webhook HTTP ${r.status} ${await r.text().catch(() => "")}`);
  return payload.title;
}
