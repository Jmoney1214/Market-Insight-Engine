// Premarket data adapters (Phase 3). Alpaca SIP snapshots give latest trade + today's
// and prior daily bar per symbol — enough for the overnight gap and a rough volume
// surge. NOT cached: premarket state is live. Chunked at 100.
const AH = { "APCA-API-KEY-ID": process.env.ALPACA_API_KEY_ID, "APCA-API-SECRET-KEY": process.env.ALPACA_API_SECRET_KEY };

export async function snapshots(symbols) {
  const out = new Map();
  for (let i = 0; i < symbols.length; i += 100) {
    const chunk = symbols.slice(i, i + 100);
    const u = new URL("https://data.alpaca.markets/v2/stocks/snapshots");
    u.searchParams.set("symbols", chunk.join(","));
    u.searchParams.set("feed", "sip");
    const r = await fetch(u, { headers: AH });
    if (!r.ok) throw new Error(`Alpaca snapshots HTTP ${r.status} ${await r.text().catch(() => "")}`);
    const j = await r.json();
    const snaps = j.snapshots ?? j; // some responses wrap in {snapshots}
    for (const [sym, s] of Object.entries(snaps)) {
      const prevC = s?.prevDailyBar?.c;
      if (!prevC) { out.set(sym, null); continue; }
      const day = s.dailyBar;
      const price = s.latestTrade?.p ?? day?.c ?? prevC;
      out.set(sym, {
        price,
        prevClose: prevC,
        gapPct: (price - prevC) / prevC * 100,
        openGapPct: day?.o ? (day.o - prevC) / prevC * 100 : null,
        dayVol: day?.v ?? 0,
        dayDate: day?.t?.slice(0, 10) ?? null,
      });
    }
  }
  return out;
}
