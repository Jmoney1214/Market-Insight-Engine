import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
// stdio transport: stdout is the protocol channel, so log to stderr only.
console.error(
  `[mie-mcp-gateway] connected (api base: ${process.env["MIE_API_BASE"] ?? "http://127.0.0.1:8080"})`,
);
