// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeRequest, CrList } from '../../../src/api/crs';
import { createHistoryClient } from '../../../src/api/history';
import { confirmSignedIn, onSignedOut, setCsrf, studioFetch, type SessionState } from '../../../src/api/session';
import { CrListPage } from '../../../src/cr/CrListPage';
import { CrPicker } from '../../../src/cr/CrMenus';
import { CrNotice } from '../../../src/cr/CrNotice';
import { SessionGate } from '../../../src/session/SessionGate';
import { rightsOf, useSession } from '../../../src/session/session';
import { UserMenu } from '../../../src/session/UserMenu';

const signedIn = (role: SessionState['role'], more: Partial<SessionState> = {}): SessionState => ({
  auth: 'github',
  flows: ['device', 'web'],
  repo: 'owner/notes',
  user: { login: 'alice', name: 'Alice Nguyen', avatarUrl: 'https://avatars.example/alice' },
  role,
  csrf: 'token-1',
  ...more,
});
const signedOut = (flows: SessionState['flows'] = ['device', 'web']): SessionState => ({ auth: 'github', flows, repo: 'owner/notes', user: null, role: null, csrf: null });

type Route = (init: RequestInit | undefined) => { status?: number; body: unknown };

// A fetch that answers by path, recording each request.
function stubFetch(routes: Record<string, Route>) {
  const calls: { path: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
    calls.push({ path: input, init });
    const route = routes[input.split('?')[0] ?? ''] as Route | undefined;
    const answer = route === undefined ? { status: 404, body: { error: 'no route' } } : route(init);
    return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { 'Content-Type': 'application/json' } }));
  });
  return calls;
}

function Inside() {
  const { state } = useSession();
  return <p>Studio for {state.user?.login ?? 'everyone'}</p>;
}

const cr = (slug: string, more: Partial<ChangeRequest> = {}): ChangeRequest => ({
  slug,
  name: slug,
  branch: `cr/${slug}`,
  status: 'draft',
  pushed: false,
  worktree: `/w/${slug}`,
  changedPages: 1,
  uncommitted: 0,
  updatedMs: Date.now(),
  previewUrl: null,
  pr: null,
  stale: false,
  drift: null,
  ...more,
});
const list = (crs: ChangeRequest[]): CrList => ({ enabled: true, taken: [], prError: null, fetchError: null, crs });

beforeEach(() => {
  setCsrf(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('studioFetch', () => {
  it('adds the csrf token to writes only', async () => {
    const calls = stubFetch({ '/api/x': () => ({ body: {} }) });
    setCsrf('tok');
    await studioFetch('/api/x');
    await studioFetch('/api/x', { method: 'post', headers: { 'Content-Type': 'application/json' } });
    expect(new Headers(calls[0]?.init?.headers).get('x-studio-csrf')).toBeNull();
    const write = new Headers(calls[1]?.init?.headers);
    expect(write.get('x-studio-csrf')).toBe('tok');
    expect(write.get('content-type')).toBe('application/json');
  });

  it('carries the csrf token on a page history restore (#110)', async () => {
    const calls = stubFetch({ '/cr/x/api/history/restore': () => ({ body: { path: 'content/notes/a.mdx', mtimeMs: 2 } }) });
    setCsrf('tok');
    await createHistoryClient('/cr/x').restore('content/notes/a.mdx', 'abc', 1);
    expect(new Headers(calls[0]?.init?.headers).get('x-studio-csrf')).toBe('tok');
  });

  it('tells the page when the session is gone', async () => {
    stubFetch({ '/api/x': () => ({ status: 401, body: { error: 'Sign in to use the Studio.' } }) });
    const listener = vi.fn();
    const stop = onSignedOut(listener);
    await studioFetch('/api/x');
    stop();
    await studioFetch('/api/x');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// A closed sync socket cannot show the 401 its reconnect gets (#115).
describe('confirmSignedIn', () => {
  const after = async (state: SessionState | Error) => {
    if (state instanceof Error) vi.stubGlobal('fetch', () => Promise.reject(state));
    else stubFetch({ '/api/session': () => ({ body: state }) });
    const listener = vi.fn();
    const stop = onSignedOut(listener);
    await confirmSignedIn();
    stop();
    return listener;
  };

  it('tells the page when nobody is signed in any more', async () => {
    expect(await after(signedOut())).toHaveBeenCalledTimes(1);
  });

  it('tells the page when the access was taken away', async () => {
    expect(await after(signedIn('none'))).toHaveBeenCalledTimes(1);
  });

  it('asks once for editors going offline together', async () => {
    const calls = stubFetch({ '/api/session': () => ({ body: signedOut() }) });
    const listener = vi.fn();
    const stop = onSignedOut(listener);
    await Promise.all([confirmSignedIn(), confirmSignedIn(), confirmSignedIn()]);
    stop();
    expect(calls).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stays quiet while signed in, with sign-in off, or when the server is down', async () => {
    expect(await after(signedIn('writer'))).not.toHaveBeenCalled();
    expect(await after({ ...signedOut(), auth: 'off' })).not.toHaveBeenCalled();
    expect(await after(new TypeError('Failed to fetch'))).not.toHaveBeenCalled();
  });
});

describe('the session gate', () => {
  it('shows the Studio straight away when sign-in is off', async () => {
    stubFetch({ '/api/session': () => ({ body: { auth: 'off', flows: [], repo: null, user: null, role: 'admin', csrf: null } }) });
    render(<SessionGate><Inside /></SessionGate>);
    expect(await screen.findByText('Studio for everyone')).toBeTruthy();
  });

  it('offers the configured sign-ins in their order, the first the main one', async () => {
    stubFetch({ '/api/session': () => ({ body: signedOut(['web', 'device']) }) });
    render(<SessionGate><Inside /></SessionGate>);
    expect(await screen.findByRole('heading', { name: 'Sign in to Notes Studio' })).toBeTruthy();
    expect(screen.getByText('owner/notes').tagName).toBe('B');
    const web = screen.getByRole('link', { name: 'Continue with GitHub' });
    const device = screen.getByRole('button', { name: 'Sign in with a code' });
    expect(web.getAttribute('href')).toBe('/api/session/web');
    expect(web.className).toContain('studio-button-primary');
    expect(device.className).not.toContain('studio-button-primary');
    expect(web.compareDocumentPosition(device) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('Studio for alice')).toBeNull();
  });

  it('signs in with a code: shows it, waits for GitHub, then opens the Studio with the csrf token', async () => {
    let polls = 0;
    const calls = stubFetch({
      '/api/session': () => ({ body: signedOut(['device']) }),
      '/api/session/device': () => ({ body: { flow: 'f1', userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 0 } }),
      '/api/session/device/poll': () => {
        polls += 1;
        return { body: polls < 2 ? { state: 'pending', interval: null } : { state: 'done', session: signedIn('writer') } };
      },
      '/api/x': () => ({ body: {} }),
    });
    render(<SessionGate><Inside /></SessionGate>);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in with a code' }));
    expect((await screen.findByLabelText('Sign-in code')).textContent).toBe('WDJB-MJHT');
    expect(screen.getByRole('link', { name: 'Open GitHub' }).getAttribute('href')).toBe('https://github.com/login/device');
    expect(await screen.findByText('Studio for alice')).toBeTruthy();
    expect(polls).toBe(2);
    expect(JSON.parse(calls.find((call) => call.path === '/api/session/device/poll')?.init?.body as string)).toEqual({ flow: 'f1' });
    await studioFetch('/api/x', { method: 'POST' });
    expect(new Headers(calls.at(-1)?.init?.headers).get('x-studio-csrf')).toBe('token-1');
  });

  it('selects the code and says how to copy it when the browser blocks copying (#116)', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });
    stubFetch({
      '/api/session': () => ({ body: signedOut(['device']) }),
      '/api/session/device': () => ({ body: { flow: 'f1', userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 0 } }),
      '/api/session/device/poll': () => ({ body: { state: 'pending', interval: 60 } }),
    });
    try {
      render(<SessionGate><Inside /></SessionGate>);
      await userEvent.click(await screen.findByRole('button', { name: 'Sign in with a code' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Copy code' }));
      expect((await screen.findByText(/This browser blocked copying/)).textContent).toBe('This browser blocked copying. The code is selected: copy it with Ctrl+C (⌘C on a Mac), or type it on GitHub.');
      expect(window.getSelection()?.toString()).toBe('WDJB-MJHT');
    } finally {
      Reflect.deleteProperty(document, 'execCommand');
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('copies the code through the fallback over plain http (#116)', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    stubFetch({
      '/api/session': () => ({ body: signedOut(['device']) }),
      '/api/session/device': () => ({ body: { flow: 'f1', userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 0 } }),
      '/api/session/device/poll': () => ({ body: { state: 'pending', interval: 60 } }),
    });
    try {
      render(<SessionGate><Inside /></SessionGate>);
      await userEvent.click(await screen.findByRole('button', { name: 'Sign in with a code' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Copy code' }));
      expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(screen.queryByText(/This browser blocked copying/)).toBeNull();
    } finally {
      Reflect.deleteProperty(document, 'execCommand');
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('says why a sign-in failed and lets the person start again', async () => {
    stubFetch({
      '/api/session': () => ({ body: signedOut(['device']) }),
      '/api/session/device': () => ({ body: { flow: 'f1', userCode: 'AAAA-BBBB', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 0 } }),
      '/api/session/device/poll': () => ({ status: 403, body: { error: '@bob has no access to owner/notes.' } }),
    });
    render(<SessionGate><Inside /></SessionGate>);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in with a code' }));
    expect((await screen.findByRole('alert')).textContent).toBe('@bob has no access to owner/notes.');
    expect(screen.getByRole('button', { name: 'Sign in with a code' })).toBeTruthy();
  });

  it('shows someone without access why, and lets them sign out', async () => {
    const calls = stubFetch({
      '/api/session': () => ({ body: signedIn('none') }),
      '/api/session/logout': () => ({ body: signedOut() }),
    });
    render(<SessionGate><Inside /></SessionGate>);
    expect((await screen.findByRole('alert')).textContent).toBe('@alice is signed in but has no access to owner/notes.');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with another account' }));
    expect(await screen.findByRole('heading', { name: 'Sign in to Notes Studio' })).toBeTruthy();
    expect(new Headers(calls.find((call) => call.path === '/api/session/logout')?.init?.headers).get('x-studio-csrf')).toBe('token-1');
  });

  it('asks to sign in again when a request finds the session gone', async () => {
    let state = signedIn('reader');
    stubFetch({ '/api/session': () => ({ body: state }), '/api/x': () => ({ status: 401, body: { error: 'Sign in to use the Studio.' } }) });
    render(<SessionGate><Inside /></SessionGate>);
    await screen.findByText('Studio for alice');
    state = signedOut();
    await studioFetch('/api/x');
    expect(await screen.findByRole('heading', { name: 'Sign in to Notes Studio' })).toBeTruthy();
  });
});

describe('the account menu', () => {
  it('shows who is signed in and their role, and signs out', async () => {
    stubFetch({ '/api/session': () => ({ body: signedIn('writer') }), '/api/session/logout': () => ({ body: signedOut() }) });
    render(<SessionGate><header><UserMenu /></header><Inside /></SessionGate>);
    await userEvent.click(await screen.findByRole('button', { name: 'Signed in as alice' }));
    const menu = screen.getByRole('menu', { name: 'Account' });
    expect(menu.textContent).toContain('Alice Nguyen');
    expect(menu.textContent).toContain('@alice');
    expect(within(menu).getByText('Writer').getAttribute('data-role')).toBe('writer');
    expect(menu.textContent).toContain('on owner/notes');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in to Notes Studio' })).toBeTruthy();
  });

  it('is not there when sign-in is off', () => {
    const { container } = render(<UserMenu />);
    expect(container.textContent).toBe('');
  });
});

describe('rights by role', () => {
  it('lets a writer discard only what is not on origin, an admin anything', () => {
    const local = cr('local');
    const pushed = cr('pushed', { pushed: true, status: 'previewing' });
    const merged = cr('merged', { pushed: false, status: 'merged' });
    expect(rightsOf('reader')).toMatchObject({ write: false });
    expect(rightsOf('reader').discard(local)).toBe(false);
    expect([local, pushed, merged].map(rightsOf('writer').discard)).toEqual([true, false, true]);
    expect([local, pushed, merged].map(rightsOf('admin').discard)).toEqual([true, true, true]);
    expect(rightsOf('writer').discard(cr('review', { status: 'review', pushed: true }))).toBe(false);
  });

  it('hides New and Discard from a reader in the list', () => {
    render(<CrListPage list={list([cr('a')])} error={null} current={null} onOpen={vi.fn()} onNew={null} onDiscard={null} onRefresh={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /New change request/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discard a' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
  });

  it('shows a writer why a pushed one needs an admin', async () => {
    const onDiscard = vi.fn();
    render(
      <CrListPage list={list([cr('mine'), cr('shared', { pushed: true, status: 'previewing' })])} error={null} current={null} onOpen={vi.fn()} onNew={vi.fn()} onDiscard={onDiscard} canDiscard={rightsOf('writer').discard} onRefresh={vi.fn()} />,
    );
    const shared = screen.getByRole<HTMLButtonElement>('button', { name: 'Discard shared' });
    expect(shared.disabled).toBe(true);
    expect(shared.getAttribute('title')).toBe('It is on origin: cleaning it up there needs admin access.');
    await userEvent.click(screen.getByRole('button', { name: 'Discard mine' }));
    expect(onDiscard).toHaveBeenCalledWith(expect.objectContaining({ slug: 'mine' }));
  });

  it('offers no new change request in the picker without onNew', async () => {
    render(<CrPicker list={list([cr('a')])} current={null} onSwitch={vi.fn()} onNew={null} onList={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Change request: main, read only' }));
    expect(screen.queryByRole('menuitem', { name: /New change request/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /All change requests/ })).toBeTruthy();
  });

  it('keeps Clean up for an admin when the merged branch is still on origin', () => {
    const merged = cr('done', { status: 'merged', pushed: true });
    const { rerender } = render(<CrNotice cr={merged} cleanUp="admin" onCleanUp={vi.fn()} />);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Clean up' }).disabled).toBe(true);
    rerender(<CrNotice cr={merged} cleanUp="no" onCleanUp={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Clean up' })).toBeNull();
  });
});
