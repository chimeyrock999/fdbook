export type Client = 'claude' | 'codex' | 'stdio';
export const CLIENTS: { id: Client; name: string }[] = [{ id: 'claude', name: 'Claude Code' }, { id: 'codex', name: 'Codex' }, { id: 'stdio', name: 'Other (stdio)' }];

// The command that adds the Studio's MCP server to an agent in a terminal,
// with `token` when sign-in is on.
export function connectCommand(client: Client, url: string, token: string | null) {
  if (client === 'claude') return `claude mcp add --transport http notes-studio ${url}${token === null ? '' : ` --header "Authorization: Bearer ${token}"`}`;
  // Codex reads the token from a variable each time it starts: the command
  // names the variable only, and the token stays out of it (CODEX_TOKEN_STEP).
  if (client === 'codex') return `codex mcp add notes-studio --url ${url}${token === null ? '' : ' --bearer-token-env-var STUDIO_MCP_TOKEN'}`;
  return `STUDIO_MCP_URL=${url}${token === null ? '' : ` STUDIO_MCP_TOKEN=${token}`} node packages/server/src/routes/mcp/stdio.ts`;
}

// Sets STUDIO_MCP_TOKEN for Codex from a paste, without echoing it or
// putting it in the shell history.
export const CODEX_TOKEN_STEP = 'read -rs STUDIO_MCP_TOKEN && export STUDIO_MCP_TOKEN';
