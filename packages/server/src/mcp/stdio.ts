// The Studio's MCP server over stdio, for an agent that only starts MCP
// servers as processes (every ACP agent can; HTTP is optional in ACP). It
// holds no tool: it passes each request on to the Studio's /api/mcp.
//   STUDIO_MCP_URL    http://127.0.0.1:<port>/api/mcp
//   STUDIO_MCP_TOKEN  a run's or a person's agent token (none with sign-in off)
// Run with node: `node packages/server/src/mcp/stdio.ts`.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const url = process.env.STUDIO_MCP_URL;
if (url === undefined || url === '') {
  process.stderr.write('STUDIO_MCP_URL is not set: give the Studio\'s /api/mcp address\n');
  process.exit(2);
}
const token = process.env.STUDIO_MCP_TOKEN ?? '';

const studio = new Client({ name: 'notes-studio-stdio', version: '1.0.0' });
await studio.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: token === '' ? {} : { headers: { Authorization: `Bearer ${token}` } } }));

// The low-level server: it relays tools it does not define.
// eslint-disable-next-line @typescript-eslint/no-deprecated
const server = new Server({ name: 'notes-studio', version: '1.0.0' }, { capabilities: { tools: {} }, instructions: studio.getInstructions() });
server.setRequestHandler(ListToolsRequestSchema, (request) => studio.listTools(request.params));
server.setRequestHandler(CallToolRequestSchema, (request) => studio.callTool(request.params));
await server.connect(new StdioServerTransport());
// The agent that started it went: so does the bridge.
process.stdin.once('close', () => { process.exit(0); });
