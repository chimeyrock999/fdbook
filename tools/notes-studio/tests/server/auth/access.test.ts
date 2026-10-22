import { describe, expect, it } from 'vitest';
import { requiredRole } from '../../../server/security/access';

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
    ['GET', '/cr/x/api/agents/runs', 'reader'],
    ['GET', '/cr/x/api/agents/events', 'reader'],
    ['POST', '/cr/x/api/agents/runs', 'admin'],
    ['POST', '/cr/x/api/agents/runs/r1/cancel', 'admin'],
    ['POST', '/cr/x/api/agents/runs/r1/permissions/a1', 'admin'],
    // A change request's own /api/session is no sign-in endpoint.
    ['POST', '/cr/x/api/session/logout', 'writer'],
  ])('%s %s needs %s', (method, path, role) => {
    expect(requiredRole(method, path)).toBe(role);
  });
});
