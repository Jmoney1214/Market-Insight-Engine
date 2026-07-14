import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

const apiBase = process.env["MIE_API_BASE"] ?? "";
const server = createServer({
  apiBase,
  credential: process.env["MIE_API_CREDENTIAL"] ?? null,
  fetch: globalThis.fetch,
});
const transport = new StdioServerTransport();
await server.connect(transport);
// stdio transport: stdout is the protocol channel, so log to stderr only.
console.error(
  `[mie-mcp-gateway] connected (api base: ${apiBase})`,
);
