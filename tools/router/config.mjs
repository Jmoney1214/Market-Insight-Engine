// Strategy Router — universe, thresholds, and the LANES table.
// LANES carry validation status: real orders only ever come from status:"LIVE".

export const UNIVERSE = [
  "NVDA","AMD","SMCI","INTC","MU","MRVL","AVGO","TSM","QCOM","TXN","AMAT","LRCX","KLAC","ON",
  "DELL","ANET","MCHP","ADI","ASML","NXPI","MPWR","WDC","STX","AAPL","MSFT","GOOGL","AMZN","META",
  "NFLX","ORCL","ADBE","CRM","CSCO","IBM","INTU","NOW","PLTR","NET","DDOG","SNOW","CRWD","PANW",
  "ZS","MDB","ROKU","SHOP","PYPL","AFRM","UPST","SOFI","COIN","DKNG","MSTR","MARA","RIOT","TSLA",
  "GM","F","BABA","PDD","JD","MRNA","PFE","LLY","UBER","ABNB","CVNA","LULU","NKE","SBUX","CMG",
  "DIS","GME","SNAP","OXY","CCJ","FSLR","ENPH","DAL","AAL","CCL","JPM","BAC","GS","MS","C","SCHW",
];

export const THRESH = {
  // lengths
  donchN: 20, emaTrend: 50, smaRegime: 200, momN: 63, hi52N: 252, atrN: 14, adxN: 14, volN: 20,
  // gates
  minDollarVolM: 50,   // avg 20d $-volume, $M
  minPrice: 10,        // $
  coilBandPct: 5,      // within this % below the 20d high == coiling
  adxTrend: 25,        // ADX at/above this confirms a trend (reported)
  adxRange: 20,        // ADX below this + near-MA == range candidate (MeanRev, paper)
  // premarket (Phase 3)
  gapMomentum: 3,      // gap% >= this -> Momentum lane (long continuation)
  gapJump: 5,          // |gap%| >= this -> JumpDay lane
  volSurgeMin: 1.2,    // day volume / 20d avg -> conviction flag
  // mean-reversion validation (Phase 4 validate --lane=meanrev, Connors RSI2 proxy)
  mrRsiEntry: 10,      // RSI(mrRsiPeriod) < this -> oversold entry trigger
  mrRsiPeriod: 2,      // Wilder RSI length (classic Connors RSI2)
  mrExitSma: 5,        // exit when close reverts back above SMA(mrExitSma)
  mrMaxHold: 10,       // time-stop, trading days, if the SMA exit never fires
  mrRegimeSMA: 200,     // broad-market (SPY) SMA length for the regime filter — dip-buy only when SPY.close > SPY.SMA(mrRegimeSMA)
  mrMaxConcurrent: 10,  // position cap — at most this many MeanRev names in-cap per scan, ranked by RSI2 ascending (most oversold first)
  mrEarningsBlackoutDays: 7, // skip a dip-buy entry if the symbol reports earnings within this many calendar days of the entry date (entryDate <= E <= entryDate+N) — motivated by the 2026-07-20 week TXN loss (bought 7/21 oversold, reported 7/22, gapped -5.7%)
};

// character -> strategy -> validation status. `pine` names the exact twin to run.
export const LANES = {
  TrendRider: { code: 1, pine: "Trend_Rider.pine",                    status: "LIVE"  },
  MeanRev:    { code: 2, pine: "morning_scan_largecap_scalper.pine",  status: "PAPER" },
  Momentum:   { code: 3, pine: "morning_scan_strategy.pine (ORB/3-Phase)", status: "PAPER" },
  JumpDay:    { code: 4, pine: "morning_scan_jumpday_long.pine",      status: "PAPER" },
  Cash:       { code: 0, pine: null,                                  status: "LIVE"  },
};

// Portfolio engine (tools/router/portfolio.mjs) — institutional risk-based sizing,
// concurrent/sector/exposure caps, for the multi-position book simulation. Distinct
// from THRESH's mrMaxConcurrent (a MeanRev-lane-only cap used by scan.mjs's board) —
// maxConcurrent here caps the WHOLE portfolio across every lane at once.
export const PORTFOLIO = {
  startEquity: 100000,      // $ starting capital
  riskPctPerTrade: 0.01,    // 1% of current equity risked per trade (stop-distance based)
  maxConcurrent: 10,        // max open positions, all lanes combined
  maxPerSector: 3,          // max open positions sharing one SECTOR bucket
  maxNotionalPct: 0.25,     // no single position > 25% of equity notional
  maxGrossExposure: 1.0,    // sum of open notional <= 100% of equity (no leverage)
  trendStopAtr: 22, trendStopMult: 3.5,   // TrendRider: chandelier stopDist = 3.5 * ATR(22) — sizing AND the daily trailing stop
  meanrevStopAtr: 14, meanrevStopMult: 2.5, // MeanRev: sizing stop AND fixed hard stop = 2.5 * ATR(14), set once at entry (not trailing)
};

// Static sector map for every UNIVERSE name — hand-classified, used only for
// PORTFOLIO.maxPerSector concentration caps. Not a GICS feed; grouped for
// correlation (e.g. COIN/MSTR/MARA/RIOT bucketed together as "Crypto" since all
// four move with BTC regardless of official industry classification).
export const SECTOR = {
  NVDA: "Semis", AMD: "Semis", SMCI: "Hardware", INTC: "Semis", MU: "Semis",
  MRVL: "Semis", AVGO: "Semis", TSM: "Semis", QCOM: "Semis", TXN: "Semis",
  AMAT: "SemiEquip", LRCX: "SemiEquip", KLAC: "SemiEquip", ON: "Semis",
  DELL: "Hardware", ANET: "Networking", MCHP: "Semis", ADI: "Semis",
  ASML: "SemiEquip", NXPI: "Semis", MPWR: "Semis", WDC: "Storage", STX: "Storage",
  AAPL: "Hardware", MSFT: "Software", GOOGL: "Internet", AMZN: "Internet", META: "Internet",
  NFLX: "Media", ORCL: "Software", ADBE: "Software", CRM: "Software", CSCO: "Networking",
  IBM: "ITServices", INTU: "Software", NOW: "Software", PLTR: "Software", NET: "Software",
  DDOG: "Software", SNOW: "Software", CRWD: "Software", PANW: "Software",
  ZS: "Software", MDB: "Software", ROKU: "Media", SHOP: "Internet", PYPL: "Fintech",
  AFRM: "Fintech", UPST: "Fintech", SOFI: "Fintech", COIN: "Crypto", DKNG: "Gaming",
  MSTR: "Crypto", MARA: "Crypto", RIOT: "Crypto", TSLA: "Auto",
  GM: "Auto", F: "Auto", BABA: "Internet", PDD: "Internet", JD: "Internet",
  MRNA: "Health", PFE: "Health", LLY: "Health", UBER: "Internet", ABNB: "Internet",
  CVNA: "Auto", LULU: "Consumer", NKE: "Consumer", SBUX: "Consumer", CMG: "Consumer",
  DIS: "Media", GME: "Consumer", SNAP: "Internet", OXY: "Energy", CCJ: "Materials",
  FSLR: "Energy", ENPH: "Energy", DAL: "Airline", AAL: "Airline", CCL: "Travel",
  JPM: "Bank", BAC: "Bank", GS: "Bank", MS: "Bank", C: "Bank", SCHW: "Bank",
};
