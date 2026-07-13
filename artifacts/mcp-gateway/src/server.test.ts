import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./server.js";

const EXPECTED_TOOLS = [
  "desk_health",
  "get_premarket_scan",
  "get_scan_scorecard",
  "get_universe_snapshot",
  "get_copilot_event",
  "explain_event",
  "get_copilot_history",
  "get_journal",
  "get_edge_scoreboard",
  "get_validation_state",
  "get_strategy_registry",
  "get_replay_session",
  "get_replay_event",
  "list_reports",
  "get_report",
  "get_watchlist",
];

async function connectedClient() {
  const server = createServer();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("mcp gateway", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers exactly the read-only tool surface", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("exposes no tool that can mutate desk state", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    // Guardrail: mutation verbs must not appear in the tool surface until
    // per-agent tokens/scopes exist (buildout plan §9). If this fails, a write
    // tool was added without the auth prerequisite.
    const mutating = tools.filter((t) =>
      /^(add|create|post|put|delete|update|write|set|analyze|submit)_/i.test(t.name),
    );
    expect(mutating).toEqual([]);
  });

  it("reports unreachable API as a tool error, not a crash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("unreachable test API")),
    );
    const client = await connectedClient();
    const result = await client.callTool({ name: "get_watchlist", arguments: {} });
    expect(result.isError).toBe(true);
  });

  it("does not accept fixture source or historical mode on ordinary live tools", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = await connectedClient();

    const fixture = await client.callTool({
      name: "get_copilot_event",
      arguments: { symbol: "AAPL", source: "fixture" },
    });
    const replayMode = await client.callTool({
      name: "get_copilot_event",
      arguments: { symbol: "AAPL", mode: "REPLAY" },
    });

    expect(fixture.isError).toBe(true);
    expect(replayMode.isError).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls the mounted copilot replay routes with required date and step", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      urls.push(String(input));
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }));
    const client = await connectedClient();

    await client.callTool({
      name: "get_replay_session",
      arguments: { symbol: "AAPL", date: "2024-06-03" },
    });
    await client.callTool({
      name: "get_replay_event",
      arguments: { symbol: "AAPL", date: "2024-06-03", step: 4 },
    });

    expect(urls).toEqual([
      "http://127.0.0.1:8080/api/copilot/replay/session?symbol=AAPL&date=2024-06-03",
      "http://127.0.0.1:8080/api/copilot/replay/event?symbol=AAPL&date=2024-06-03&step=4",
    ]);
  });

  it("rejects a replay request with no date before making an API call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = await connectedClient();

    const result = await client.callTool({
      name: "get_replay_event",
      arguments: { symbol: "AAPL", step: 1 },
    });

    expect(result.isError).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
