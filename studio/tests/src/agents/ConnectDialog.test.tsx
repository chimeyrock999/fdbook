// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectDialog } from '../../../src/agents/ConnectDialog';
import { connectCommand } from '../../../src/agents/connect-command';
import { SESSION_OFF, type SessionState } from '../../../server/auth/shared';
import { SessionContext } from '../../../src/session/session';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SIGNED_IN: SessionState = { auth: 'github', flows: ['device'], repo: 'o/r', user: { login: 'writer', name: null, avatarUrl: '' }, role: 'writer', csrf: 'csrf' };

function show(state: SessionState, onClose: () => void = () => undefined) {
  return render(
    <SessionContext.Provider value={{ state, refresh: () => Promise.resolve() } as never}>
      <ConnectDialog cr="tighten" onClose={onClose} />
    </SessionContext.Provider>,
  );
}

describe('Connect an agent', () => {
  it('builds the command for each agent, with a token only when there is one', () => {
    expect(connectCommand('claude', 'http://h/api/mcp', null)).toBe('claude mcp add --transport http notes-studio http://h/api/mcp');
    expect(connectCommand('claude', 'http://h/api/mcp', 't')).toBe('claude mcp add --transport http notes-studio http://h/api/mcp --header "Authorization: Bearer t"');
    // Codex names the variable only: the token never goes on its command line.
    expect(connectCommand('codex', 'http://h/api/mcp', 't')).toBe('codex mcp add notes-studio --url http://h/api/mcp --bearer-token-env-var STUDIO_MCP_TOKEN');
    expect(connectCommand('codex', 'http://h/api/mcp', null)).toBe('codex mcp add notes-studio --url http://h/api/mcp');
    expect(connectCommand('stdio', 'http://h/api/mcp', null)).toBe('STUDIO_MCP_URL=http://h/api/mcp node studio/server/mcp/stdio.ts');
  });

  it('asks for no token with sign-in off', async () => {
    const user = userEvent.setup();
    show(SESSION_OFF);
    expect(screen.queryByRole('button', { name: 'Create token' })).toBeNull();
    expect(screen.getByText(/claude mcp add --transport http notes-studio http:\/\/localhost(:\d+)?\/api\/mcp$/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Codex' }));
    expect(screen.getByText(/^codex mcp add notes-studio --url/)).toBeTruthy();
  });

  it('makes a token for the signed-in person and puts it in the command', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => Promise.resolve(new Response(JSON.stringify(init?.method === 'POST' ? { token: 'studio-agent-abc' } : { ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    show(SIGNED_IN);
    expect(screen.getByText(/--header "Authorization: Bearer <token>"/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Create token' }));
    expect(await screen.findByText('studio-agent-abc')).toBeTruthy();
    expect(screen.getByText(/Bearer studio-agent-abc"$/)).toBeTruthy();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/mcp/tokens');
    expect(screen.getByText(/stays in your shell history and in Claude Code's MCP settings/)).toBeTruthy();
    // For Codex the token is set without echo, apart from the command.
    await user.click(screen.getByRole('button', { name: 'Codex' }));
    expect(screen.getByText('read -rs STUDIO_MCP_TOKEN && export STUDIO_MCP_TOKEN')).toBeTruthy();
    expect(screen.getByText(/^codex mcp add notes-studio --url .* --bearer-token-env-var STUDIO_MCP_TOKEN$/)).toBeTruthy();
    expect(screen.queryByText(/studio-agent-abc.*codex|codex.*studio-agent-abc/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'End all my tokens' }));
    expect(await screen.findByText(/Every agent token of yours has ended/)).toBeTruthy();
  });

  it('does not close while a token is being made: the token is shown once, there', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    const onClose = vi.fn();
    show(SIGNED_IN, onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    if (dialog.parentElement) fireEvent.mouseDown(dialog.parentElement);
    const done = screen.getByRole<HTMLButtonElement>('button', { name: 'Done' });
    expect(done.disabled).toBe(true);
    fireEvent.click(done);
    fireEvent.submit(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });
});
