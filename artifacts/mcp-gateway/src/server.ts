/**
 * Read-only MCP gateway over the Market-Insight desk API.
 *
 * Every tool is a thin HTTP proxy to the running api-server — the gateway
 * imports no server internals and holds no database access. Write endpoints
 * (POST /analyze, POST /journal, POST /watchlist) are deliberately NOT
 * exposed: mutations stay human-only until per-agent tokens and scopes exist
 * (see docs/plans/research-layer-buildout.md §9, ADR 0001 boundaries).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const API_BASE = process.env["MIE_API_BASE"] ?? "http://127.0.0.1:8080";
/** Optional bearer token, forwarded so the server can enforce it once auth lands. */
const API_TOKEN = process.env["MIE_API_TOKEN"];

const SYMBOL = z
  .string()
  .regex(/^[A-Za-z0-9.\-=^]{1,12}$/, "invalid symbol")
  .describe("Ticker symbol, e.g. AAPL or BRK-B");
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

async function apiGet(path: string, params?: Record<string, string | undefined>) {
  const url = new URL(`/api${path}`, API_BASE);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = { accept: "application/json" };
  if (API_TOKEN) headers["authorization"] = `Bearer ${API_TOKEN}`;
  const res = await fetch(url, { headers });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`GET ${url.pathname}${url.search} -> ${res.status}: ${body.slice(0, 500)}`);
  }
  return body;
}

/** Wrap an API call as an MCP tool result, reporting errors as tool errors. */
async function proxy(path: string, params?: Record<string, string | undefined>) {
  try {
    const body = await apiGet(path, params);
    return { content: [{ type: "text" as const, text: body }] };
  } catch (err) {
    return {
      content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
      isError: true,
    };
  }
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "market-insight-desk", version: "0.1.0" });

  server.registerTool(
    "desk_health",
    {
      title: "Desk health",
      description: "Health of the desk API server and the copilot subsystem.",
      inputSchema: {},
    },
    async () => {
      const [api, copilot] = await Promise.all([
        apiGet("/healthz").catch((e: Error) => JSON.stringify({ error: e.message })),
        apiGet("/copilot/healthz").catch((e: Error) => JSON.stringify({ error: e.message })),
      ]);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ api: JSON.parse(api), copilot: JSON.parse(copilot) }) }],
      };
    },
  );

  server.registerTool(
    "get_premarket_scan",
    {
      title: "Morning scan",
      description:
        "The premarket Morning Scan board: gap/relative-volume candidates with scores and lists. Set refresh=true to force a re-scan (spends provider quota).",
      inputSchema: { refresh: z.boolean().optional().describe("Force a fresh scan instead of the cached board") },
    },
    ({ refresh }) => proxy("/scan/premarket", { refresh: refresh ? "true" : undefined }),
  );

  server.registerTool(
    "get_scan_scorecard",
    {
      title: "Scan scorecard",
      description: "How past Morning Scan candidates actually played out (graded hits/misses).",
      inputSchema: {},
    },
    () => proxy("/scan/scorecard"),
  );

  server.registerTool(
    "get_universe_snapshot",
    {
      title: "Universe snapshot",
      description: "The tradeable-universe snapshot for a given date (survivorship-bias-safe daily freeze).",
      inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD; omit for latest") },
    },
    ({ date }) => proxy("/scan/universe-snapshot", { date }),
  );

  server.registerTool(
    "get_copilot_event",
    {
      title: "Copilot event",
      description:
        "Build the deterministic read-only LIVE CopilotEvent for a symbol from Alpaca SIP data.",
      inputSchema: {
        symbol: SYMBOL,
        source: z.literal("alpaca_live").optional().describe("Live source; defaults to Alpaca SIP"),
        mode: z.literal("LIVE").optional().describe("Read-only live research mode"),
      },
    },
    ({ symbol, source, mode }) => proxy("/copilot/event", { symbol, source, mode }),
  );

  server.registerTool(
    "explain_event",
    {
      title: "Explain event (committee)",
      description:
        "Run the analyst committee over a symbol's CopilotEvent and return the structured explanation. Uncached calls take ~12s and spend LLM budget.",
      inputSchema: {
        symbol: SYMBOL,
        source: z.literal("alpaca_live").optional(),
      },
    },
    ({ symbol, source }) => proxy("/copilot/explain", { symbol, source }),
  );

  server.registerTool(
    "get_copilot_history",
    {
      title: "Copilot history",
      description: "Recent CopilotEvent timeline entries (the desk's event log).",
      inputSchema: {},
    },
    () => proxy("/copilot/history"),
  );

  server.registerTool(
    "get_journal",
    {
      title: "Trading journal (read)",
      description: "Journal entries: manual trade outcomes attached to events. Read-only — journaling stays human-only.",
      inputSchema: {},
    },
    () => proxy("/copilot/journal"),
  );

  server.registerTool(
    "get_edge_scoreboard",
    {
      title: "Edge scoreboard",
      description: "Measured-edge scoreboard derived from journaled outcomes (validated vs unproven hypotheses).",
      inputSchema: {},
    },
    () => proxy("/copilot/scoreboard"),
  );

  server.registerTool(
    "get_validation_state",
    {
      title: "Validation state",
      description: "Per-strategy validation status and sample counts.",
      inputSchema: {},
    },
    () => proxy("/copilot/validation"),
  );

  server.registerTool(
    "get_strategy_registry",
    {
      title: "Strategy registry",
      description: "Registered strategy hypotheses with definitions and minimum sample counts.",
      inputSchema: {},
    },
    () => proxy("/copilot/strategies"),
  );

  server.registerTool(
    "get_replay_session",
    {
      title: "Replay session",
      description: "Canonical historical replay session metadata (requires verified brain authorization).",
      inputSchema: { symbol: SYMBOL, date: DATE },
    },
    ({ symbol, date }) => proxy("/copilot/replay/session", { symbol, date }),
  );

  server.registerTool(
    "get_replay_event",
    {
      title: "Replay event",
      description: "A single replay step's CopilotEvent for a symbol.",
      inputSchema: {
        symbol: SYMBOL,
        date: DATE,
        step: z.number().int().min(0).describe("Replay step index"),
      },
    },
    ({ symbol, date, step }) => proxy("/copilot/replay/event", { symbol, date, step: String(step) }),
  );

  server.registerTool(
    "list_reports",
    {
      title: "List analyst reports",
      description:
        "List persisted analyst reports (ticker, rating, generated time, and recorded source provenance).",
      inputSchema: {},
    },
    () => proxy("/reports"),
  );

  server.registerTool(
    "get_report",
    {
      title: "Get analyst report",
      description: "Fetch one persisted analyst report by id.",
      inputSchema: { id: z.number().int().positive() },
    },
    ({ id }) => proxy(`/reports/${id}`),
  );

  server.registerTool(
    "get_watchlist",
    {
      title: "Watchlist (read)",
      description: "Current watchlist. Read-only — additions stay human-only.",
      inputSchema: {},
    },
    () => proxy("/watchlist"),
  );

  return server;
}
