import { openai } from "@workspace/integrations-openai-ai-server";
import { z } from "zod/v4";
import type { MarketData } from "./marketData.js";

export class AiReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiReportError";
  }
}

const thesisCase = z.object({
  targetPrice: z.number(),
  probability: z.number(),
  summary: z.string(),
  points: z.array(z.string()),
});

const aiOutputSchema = z.object({
  companyName: z.string(),
  sector: z.string(),
  industry: z.string(),
  overallRating: z.enum(["BUY", "HOLD", "SELL", "WATCH"]),
  snapshot: z.object({
    description: z.string(),
    marketCap: z.string(),
    peRatio: z.number().nullable(),
    eps: z.number().nullable(),
    revenue: z.string(),
    employees: z.string(),
    headquarters: z.string(),
    founded: z.string(),
  }),
  catalysts: z.object({
    positive: z.array(z.string()),
    negative: z.array(z.string()),
    upcoming: z.array(z.string()),
  }),
  news: z.object({
    sentiment: z.string(),
    headlines: z.array(
      z.object({
        title: z.string(),
        source: z.string(),
        date: z.string(),
        sentiment: z.string(),
      }),
    ),
  }),
  filings: z.object({
    lastForm10K: z.string(),
    lastForm10Q: z.string(),
    keyHighlights: z.array(z.string()),
  }),
  financials: z.object({
    revenueGrowthYoY: z.number().nullable(),
    grossMargin: z.number().nullable(),
    operatingMargin: z.number().nullable(),
    netMargin: z.number().nullable(),
    debtToEquity: z.number().nullable(),
    currentRatio: z.number().nullable(),
    freeCashFlow: z.string(),
    revenueHistory: z.array(z.object({ period: z.string(), revenue: z.number() })),
  }),
  valuation: z.object({
    intrinsicValueLow: z.number(),
    intrinsicValueHigh: z.number(),
    peComparison: z.string(),
    evEbitda: z.number().nullable(),
    priceToBook: z.number().nullable(),
    priceToSales: z.number().nullable(),
    dcfNotes: z.string(),
    comparables: z.array(
      z.object({
        ticker: z.string(),
        pe: z.number().nullable(),
        evEbitda: z.number().nullable(),
      }),
    ),
  }),
  technical: z.object({
    macd: z.string(),
    notes: z.string(),
  }),
  risks: z.object({
    items: z.array(
      z.object({
        category: z.string(),
        description: z.string(),
        severity: z.enum(["High", "Medium", "Low"]),
      }),
    ),
  }),
  thesis: z.object({ bull: thesisCase, base: thesisCase, bear: thesisCase }),
  actionPlan: z.object({
    rationale: z.string(),
    positionSizing: z.string(),
    entryZone: z.string(),
    stopLoss: z.string(),
    profitTarget: z.string(),
    timeHorizon: z.string(),
    keyMonitors: z.array(z.string()),
  }),
});

export type AiReportOutput = z.infer<typeof aiOutputSchema>;

function buildPrompt(ticker: string, market: MarketData): string {
  const t = market.technical;
  return [
    `You are FinDesk AI, a sell-side equity research analyst. Produce a rigorous, balanced research report for the stock ticker ${ticker}.`,
    "",
    "LIVE MARKET DATA (already sourced — do NOT contradict these numbers; build your analysis around them):",
    `- Last price: ${market.price} ${market.currency ?? "USD"}`,
    `- 1-day change: ${market.change1d}%`,
    `- 52-week change: ${market.change52w}%`,
    market.fiftyTwoWeekHigh != null ? `- 52-week high: ${market.fiftyTwoWeekHigh}` : "",
    market.fiftyTwoWeekLow != null ? `- 52-week low: ${market.fiftyTwoWeekLow}` : "",
    t.ma50 != null ? `- 50-day moving average: ${t.ma50}` : "",
    t.ma200 != null ? `- 200-day moving average: ${t.ma200}` : "",
    t.rsi != null ? `- RSI(14): ${t.rsi}` : "",
    t.supportLevel != null ? `- Recent support: ${t.supportLevel}` : "",
    t.resistanceLevel != null ? `- Recent resistance: ${t.resistanceLevel}` : "",
    `- Computed primary trend: ${t.trend}`,
    `- Golden cross (50dma > 200dma): ${t.goldenCross}`,
    market.companyName ? `- Company name (from exchange): ${market.companyName}` : "",
    "",
    "Use your knowledge of this company's fundamentals (sector, business model, financials, competitive position) to write the qualitative analysis. Be specific and grounded; if you are uncertain about a precise figure, give a reasonable estimate and keep the analysis honest. Price targets in your scenarios should be sensible relative to the live price above.",
    "",
    "Return ONLY a JSON object (no markdown, no prose) with EXACTLY these keys:",
    JSON.stringify(
      {
        companyName: "string",
        sector: "string",
        industry: "string",
        overallRating: "one of BUY | HOLD | SELL | WATCH",
        snapshot: {
          description: "2-3 sentence business overview",
          marketCap: "e.g. $2.9T",
          peRatio: "number or null",
          eps: "number or null",
          revenue: "TTM revenue string e.g. $383.3B",
          employees: "e.g. 164,000",
          headquarters: "e.g. Cupertino, CA",
          founded: "e.g. 1976",
        },
        catalysts: { positive: ["string"], negative: ["string"], upcoming: ["string"] },
        news: {
          sentiment: "Bullish | Neutral | Bearish",
          headlines: [
            { title: "string", source: "string", date: "YYYY-MM-DD", sentiment: "Bullish | Neutral | Bearish" },
          ],
        },
        filings: { lastForm10K: "YYYY-MM-DD", lastForm10Q: "YYYY-MM-DD", keyHighlights: ["string"] },
        financials: {
          revenueGrowthYoY: "number (percent) or null",
          grossMargin: "number (percent) or null",
          operatingMargin: "number (percent) or null",
          netMargin: "number (percent) or null",
          debtToEquity: "number or null",
          currentRatio: "number or null",
          freeCashFlow: "e.g. $99.6B",
          revenueHistory: [{ period: "FY2021", revenue: "number in billions" }],
        },
        valuation: {
          intrinsicValueLow: "number",
          intrinsicValueHigh: "number",
          peComparison: "string",
          evEbitda: "number or null",
          priceToBook: "number or null",
          priceToSales: "number or null",
          dcfNotes: "string",
          comparables: [{ ticker: "string", pe: "number or null", evEbitda: "number or null" }],
        },
        technical: { macd: "short status string", notes: "1-3 sentence interpretation of the trend/RSI/MAs above" },
        risks: { items: [{ category: "string", description: "string", severity: "High | Medium | Low" }] },
        thesis: {
          bull: { targetPrice: "number", probability: "integer 0-100", summary: "string", points: ["string"] },
          base: { targetPrice: "number", probability: "integer 0-100", summary: "string", points: ["string"] },
          bear: { targetPrice: "number", probability: "integer 0-100", summary: "string", points: ["string"] },
        },
        actionPlan: {
          rationale: "string",
          positionSizing: "string",
          entryZone: "string",
          stopLoss: "string",
          profitTarget: "string",
          timeHorizon: "string",
          keyMonitors: ["string"],
        },
      },
      null,
      2,
    ),
    "",
    "Rules: thesis probabilities should sum to roughly 100. revenueHistory should have 4-5 periods with the latest labelled as estimate (e.g. FY2025E). Provide 3-6 items per list. overallRating and the actionPlan must be internally consistent.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function requestCompletion(prompt: string): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 8192,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a meticulous equity research analyst. You respond with a single valid JSON object and nothing else.",
      },
      { role: "user", content: prompt },
    ],
  });
  return completion.choices[0]?.message?.content ?? "";
}

/**
 * Generates the qualitative/fundamental portion of an analyst report using an LLM,
 * grounded in the supplied live market data. Throws AiReportError on failure.
 */
export async function generateAiReport(ticker: string, market: MarketData): Promise<AiReportOutput> {
  const prompt = buildPrompt(ticker, market);

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw: string;
    try {
      raw = await requestCompletion(prompt);
    } catch (err) {
      lastError = err;
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      lastError = err;
      continue;
    }

    const validated = aiOutputSchema.safeParse(parsed);
    if (validated.success) {
      return validated.data;
    }
    lastError = validated.error;
  }

  throw new AiReportError(
    `AI analysis could not be generated: ${
      lastError instanceof Error ? lastError.message : "unknown error"
    }`,
  );
}
