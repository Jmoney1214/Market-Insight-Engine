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
};

// character -> strategy -> validation status. `pine` names the exact twin to run.
export const LANES = {
  TrendRider: { code: 1, pine: "Trend_Rider.pine",                    status: "LIVE"  },
  MeanRev:    { code: 2, pine: "morning_scan_largecap_scalper.pine",  status: "PAPER" },
  Momentum:   { code: 3, pine: "morning_scan_strategy.pine (ORB/3-Phase)", status: "PAPER" },
  JumpDay:    { code: 4, pine: "morning_scan_jumpday_long.pine",      status: "PAPER" },
  Cash:       { code: 0, pine: null,                                  status: "LIVE"  },
};
