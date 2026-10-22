// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentControl } from '../../../src/agents/AgentControl';
import { AgentPanel } from '../../../src/agents/AgentPanel';
import { PermissionDialog } from '../../../src/agents/PermissionDialog';
import { useAgents } from '../../../src/agents/useAgents';
import type { AgentInfo, AgentsClient, RunSummary, StreamEvent } from '../../../src/api/agents';

const AGENTS: AgentInfo[] = [
  { id: 'claude', name: 'Claude Code', fencesReviewer: true, available: true, reason: null, note: null, version: '0.88.0' },
  { id: 'codex', name: 'Codex', fencesReviewer: true, available: true, reason: null, note: null, version: '2.2.2' },
  { id: 'omp', name: 'omp', fencesReviewer: false, available: true, reason: null, note: null, version: '18.5.1' },
  { id: 'hermes', name: 'Hermes Agent', fencesReviewer: false, available: false, reason: 'hermes is not installed: install Hermes Agent with its [acp] extra', note: null, version: null },
];

const summary = (change: Partial<RunSummary> = {}): RunSummary => ({
  id: 'r1', agent: 'claude', agentName: 'Claude Code', role: 'author', prompt: 'Tighten the intro', model: 'Opus 5.5', status: 'running', error: null,
  startedMs: Date.now(), endedMs: null, cost: null, usage: null, writes: [], by: 'octocat', ...change,
});

function fakeClient(runs: RunSummary[] = []) {
  let listener: ((event: StreamEvent) => void) | null = null;
  let opened: () => void = () => undefined;
  const client = {
    agents: vi.fn(() => Promise.resolve(AGENTS)),
    totals: vi.fn(() => Promise.resolve({})),
    runs: vi.fn(() => Promise.resolve(runs)),
    start: vi.fn((agent: string, role: string, prompt: string) => Promise.resolve(summary({ id: 'new', agent: agent as RunSummary['agent'], role: role as RunSummary['role'], prompt }))),
    read: vi.fn((id: string) => Promise.resolve({ run: summary({ id }), events: [] })),
    cancel: vi.fn(() => Promise.resolve()),
    answer: vi.fn(() => Promise.resolve()),
    subscribe: vi.fn((next: (event: StreamEvent) => void, onOpen: () => void = () => undefined) => {
      listener = next;
      opened = onOpen;
      onOpen();
      return () => { listener = null; };
    }),
  } satisfies AgentsClient;
  const emit = (event: StreamEvent) => { act(() => { listener?.(event); }); };
  // The stream connects again, after missing what happened meanwhile.
  const reconnect = () => { act(() => { opened(); }); };
  return { client, emit, reconnect };
}

function Harness({ client, inCr = true, canRun = true, onOpenDiff = () => undefined }: { client: AgentsClient; inCr?: boolean; canRun?: boolean; onOpenDiff?: (path: string) => void }) {
  const agents = useAgents(client, inCr);
  const live = agents.runs.filter((run) => run.status === 'running').length;
  return (
    <>
      <AgentControl agents={agents} live={live} />
      {agents.open && <AgentPanel agents={agents} inCr={inCr} canRun={canRun} onOpenDiff={onOpenDiff} />}
    </>
  );
}

beforeEach(() => { localStorage.clear(); });
afterEach(cleanup);

describe('agent picker', () => {
  it('picks an agent per role with its logo, greys out one that cannot run, and keeps the choice', async () => {
    const { client } = fakeClient();
    const user = userEvent.setup();
    const { unmount } = render(<Harness client={client} />);
    const picker = await screen.findByRole('button', { name: 'Agents: Claude Code writes, Codex reviews' });
    expect(picker.querySelector('[data-agent="claude"] svg')).not.toBeNull();
    await user.click(picker);
    const menu = screen.getByRole('menu', { name: 'Agents' });
    const reviewer = within(within(menu).getByRole('group', { name: 'Reviewer' }));
    expect(reviewer.getByRole<HTMLButtonElement>('menuitemradio', { name: /Hermes Agent/ }).disabled).toBe(true);
    expect(reviewer.getByText(/hermes is not installed/)).toBeTruthy();
    await user.click(reviewer.getByRole('menuitemradio', { name: /omp/ }));
    expect(screen.getByRole('button', { name: 'Agents: Claude Code writes, omp reviews' })).toBeTruthy();
    unmount();
    render(<Harness client={fakeClient().client} />);
    expect(await screen.findByRole('button', { name: 'Agents: Claude Code writes, omp reviews' })).toBeTruthy();
  });

  it('shows and hides the panel, remembered, with the number of runs going on', async () => {
    const { client, emit } = fakeClient();
    const user = userEvent.setup();
    render(<Harness client={client} />);
    await user.click(screen.getByRole('button', { name: 'Show the agent panel' }));
    expect(screen.getByRole('complementary', { name: 'Agent' })).toBeTruthy();
    expect(localStorage.getItem('notes-studio:agent-panel')).toBe('true');
    emit({ type: 'start', at: 0, run: summary(), runId: 'r1' });
    expect(screen.getByLabelText('1 running')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close the agent panel' }));
    expect(screen.queryByRole('complementary', { name: 'Agent' })).toBeNull();
  });
});

describe('agent panel', () => {
  beforeEach(() => { localStorage.setItem('notes-studio:agent-panel', 'true'); });

  it('starts a run with the agent picked for the role, and follows what it does', async () => {
    const { client, emit } = fakeClient();
    const onOpenDiff = vi.fn();
    const user = userEvent.setup();
    render(<Harness client={client} onOpenDiff={onOpenDiff} />);
    await screen.findByText('Claude Code', { selector: '.studio-agent-who' });
    await user.click(screen.getByRole('button', { name: 'Reviewer' }));
    expect(screen.getByText('A reviewer reads only: it cannot change files.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Author' }));
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Tighten the intro');
    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(client.start).toHaveBeenCalledWith('claude', 'author', 'Tighten the intro');

    const run = summary({ id: 'new' });
    emit({ type: 'start', at: 0, run, runId: 'new' });
    emit({ type: 'update', at: 1, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Shortened it.' } }, runId: 'new' });
    emit({ type: 'write', at: 2, path: 'content/notes/intro.mdx', bytes: 40, runId: 'new' });
    const view = within(screen.getByRole('region', { name: 'Run of Claude Code' }));
    expect(view.getByText('Shortened it.')).toBeTruthy();
    expect(view.getByText('Opus 5.5')).toBeTruthy();
    await user.click(view.getByRole('button', { name: 'View diff' }));
    expect(onOpenDiff).toHaveBeenCalledWith('content/notes/intro.mdx');
    await user.click(view.getByRole('button', { name: 'Cancel' }));
    expect(client.cancel).toHaveBeenCalledWith('new');
    emit({ type: 'end', at: 3, run: { ...run, status: 'cancelled', endedMs: Date.now(), cost: { amount: 0.31, currency: 'USD' } }, runId: 'new' });
    expect(view.getByText('Cancelled')).toBeTruthy();
    expect(view.getByText('$0.31')).toBeTruthy();
  });

  it('reads the runs again when the event stream connects again, so a run that ended meanwhile ends here too', async () => {
    const { client, emit, reconnect } = fakeClient();
    render(<Harness client={client} />);
    await screen.findByRole('region', { name: 'Runs in this change request' });
    emit({ type: 'start', at: 0, run: summary(), runId: 'r1' });
    expect(screen.getByLabelText('1 running')).toBeTruthy();
    client.runs.mockResolvedValueOnce([summary({ status: 'done', endedMs: Date.now() })]);
    reconnect();
    await waitFor(() => { expect(screen.queryByLabelText('1 running')).toBeNull(); });
  });

  it('says what a reviewer that cannot be held to reading may still do', async () => {
    localStorage.setItem('notes-studio:agents', JSON.stringify({ author: 'claude', reviewer: 'omp' }));
    const user = userEvent.setup();
    render(<Harness client={fakeClient().client} />);
    await screen.findByText('Claude Code', { selector: '.studio-agent-who' });
    await user.click(screen.getByRole('button', { name: 'Reviewer' }));
    expect(screen.getByText(/omp cannot be held to reading/)).toBeTruthy();
  });

  it('lists earlier runs and opens one, reading its transcript', async () => {
    const old = summary({ id: 'old', status: 'done', prompt: 'Review the links', agent: 'codex', agentName: 'Codex', role: 'reviewer', endedMs: Date.now() });
    const { client } = fakeClient([old]);
    const user = userEvent.setup();
    render(<Harness client={client} />);
    const history = within(await screen.findByRole('region', { name: 'Runs in this change request' }));
    await user.click(await history.findByRole('button', { name: /Review the links/ }));
    expect(client.read).toHaveBeenCalledWith('old');
    expect(screen.getByRole('region', { name: 'Run of Codex' })).toBeTruthy();
  });

  it('offers no run on main, and none to someone who is not an admin', async () => {
    const { client } = fakeClient();
    const { unmount } = render(<Harness client={client} inCr={false} />);
    expect(await screen.findByText(/Agents run in a change request, never on main/)).toBeTruthy();
    expect(client.subscribe).not.toHaveBeenCalled();
    unmount();
    render(<Harness client={client} canRun={false} />);
    await screen.findByRole('region', { name: 'Runs in this change request' });
    expect(screen.queryByRole('textbox', { name: 'Prompt' })).toBeNull();
    expect(screen.getByText(/Starting an agent needs admin access/)).toBeTruthy();
  });
});

describe('permission dialog', () => {
  const ask = {
    id: 'a1',
    toolCall: { toolCallId: 't1', title: 'Run npm test', kind: 'execute' as const, rawInput: { command: 'npm test' } },
    options: [
      { optionId: 'once', name: 'Allow once', kind: 'allow_once' as const },
      { optionId: 'no', name: 'Reject', kind: 'reject_once' as const },
    ],
  };

  it('shows the command and the agent\'s options, and answers with the one picked', async () => {
    const onAnswer = vi.fn();
    const user = userEvent.setup();
    render(<PermissionDialog run={summary()} ask={ask} at={Date.now()} onAnswer={onAnswer} />);
    const dialog = screen.getByRole('dialog', { name: 'Claude Code asks: Run npm test' });
    expect(within(dialog).getByText('npm test')).toBeTruthy();
    expect(within(dialog).getByText(/Rejected in 5:00|Rejected in 4:59/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Allow once' }));
    expect(onAnswer).toHaveBeenLastCalledWith('once');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(onAnswer).toHaveBeenLastCalledWith('no');
  });

  it('rejects when closed', () => {
    const onAnswer = vi.fn();
    render(<PermissionDialog run={summary()} ask={ask} at={Date.now()} onAnswer={onAnswer} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onAnswer).toHaveBeenCalledWith(null);
  });
});
