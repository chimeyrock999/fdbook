import { describe, expect, it } from 'vitest';
import { requiredRole } from '#security/access.ts';

describe('requiredRole', () => {
  it.each([
    ['GET', '/', 'none'],
    ['GET', '/src/main.tsx', 'none'],
    ['GET', '/apis', 'none'],
    ['POST', '/api/session/device', 'none'],
    ['GET', '/api/session', 'none'],
    ['GET', '/api/file', 'reader'],
    ['HEAD', '/api/file', 'reader'],
    ['GET', '/api/events', 'reader'],
    ['GET', '/cr/x/api/changes/diff', 'reader'],
    ['POST', '/api/lint', 'reader'],
    ['POST', '/cr/x/api/lint', 'reader'],
    ['GET', '/api', 'reader'],
    ['GET', '/cr/x/api/history', 'reader'],
    ['GET', '/cr/x/api/history/compare', 'reader'],
    ['POST', '/cr/x/api/history/restore', 'writer'],
    ['POST', '/api/crs', 'writer'],
    ['POST', '/api/crs/x/discard', 'writer'],
    ['PUT', '/cr/x/api/file', 'writer'],
    ['DELETE', '/cr/x/api/assets', 'writer'],
    ['POST', '/cr/x/api/changes', 'writer'],
    ['POST', '/cr/x/api/publish', 'writer'],
    ['POST', '/cr/x/api/something-new', 'writer'],
    ['PATCH', '/api/tree', 'writer'],
    // An agent runs commands as the host's user.
    ['GET', '/api/agents', 'reader'],
    ['GET', '/cr/x/api/agents/conversations', 'reader'],
    ['GET', '/cr/x/api/agents/events', 'reader'],
    ['POST', '/cr/x/api/agents/conversations', 'admin'],
    ['POST', '/cr/x/api/agents/conversations/r1/cancel', 'admin'],
    ['POST', '/cr/x/api/agents/conversations/r1/permissions/a1', 'admin'],
    ['POST', '/cr/x/api/agents/conversations/r1/messages', 'admin'],
    ['DELETE', '/cr/x/api/agents/conversations/r1', 'admin'],
    // Keeping or reverting what a turn changed is an edit.
    ['GET', '/cr/x/api/agents/conversations/r1/turns/2/changes', 'reader'],
    ['POST', '/cr/x/api/agents/conversations/r1/turns/2/changes', 'writer'],
    // The MCP server checks its own bearer token; its token API is a write.
    ['POST', '/api/mcp', 'none'],
    ['POST', '/api/mcp/tokens', 'reader'],
    ['DELETE', '/api/mcp/tokens', 'reader'],
    ['POST', '/cr/x/api/mcp', 'writer'],
    ['POST', '/cr/x/api/proposals/p1', 'writer'],
    ['GET', '/cr/x/api/proposals', 'reader'],
    // A change request's own /api/session is no sign-in endpoint.
    ['POST', '/cr/x/api/session/logout', 'writer'],
  ])('%s %s needs %s', (method, path, role) => {
    expect(requiredRole(method, path)).toBe(role);
  });
});
