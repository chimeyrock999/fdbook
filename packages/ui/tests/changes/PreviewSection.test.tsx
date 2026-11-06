// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Build, Preview, PreviewClient } from '#api/preview.ts';
import { ToastStack } from '#components/ToastStack.tsx';
import { PreviewSection } from '#changes/PreviewSection.tsx';
import { usePreview } from '#changes/usePreview.ts';
import { usePush } from '#changes/usePush.ts';
import { OpenPreview } from '#app/OpenPreview.tsx';
import { siteRoute } from '#app/route.ts';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const SHA = '9c1ab88000000000000000000000000000000000';
const URL = 'https://cr-sinks.chimeyrock.pages.dev';
const LOG = 'https://dash.cloudflare.com/log';
const build = (state: Build['state'], fields: Partial<Build> = {}): Build => ({ state, logUrl: LOG, deploymentUrl: null, aliasUrl: URL, at: null, error: null, ...fields });
const fresh: Preview = { branch: 'cr/sinks', blocked: null, pushed: null, unpushed: ['a1', 'b2', 'c3'], uncommitted: 0, url: null, build: null, pr: null, prError: null };
const pushed = (state: Build['state'], fields: Partial<Preview> = {}, buildFields: Partial<Build> = {}): Preview =>
  ({ ...fresh, pushed: { sha: SHA }, unpushed: [], url: URL, build: build(state, buildFields), ...fields });

function setup(preview: Preview, { unsaved = null, error = null, push = vi.fn(() => Promise.resolve(pushed('waiting'))) }: { unsaved?: string | null; error?: string | null; push?: PreviewClient['push'] } = {}) {
  const onPushed = vi.fn();
  const client = { push } as unknown as PreviewClient;
  // As the App holds it: the push in usePush, shared with the header.
  function Section({ next, nextUnsaved }: { next: Preview; nextUnsaved: string | null }) {
    const pusher = usePush(client, onPushed);
    return <PreviewSection pusher={pusher} preview={next} error={error} unsaved={nextUnsaved} route="/docs/streaming/sinks" />;
  }
  const view = (next: Preview, nextUnsaved: string | null = unsaved) => <Section next={next} nextUnsaved={nextUnsaved} />;
  const { rerender } = render(view(preview));
  return { push, onPushed, rerender: (next: Preview, nextUnsaved?: string | null) => { rerender(view(next, nextUnsaved)); } };
}
const chip = () => screen.getByTestId('preview-state').textContent;
const pushButton = () => screen.getByRole<HTMLButtonElement>('button', { name: /^(Preview|Push \d+ commits?|Pushing…)$/ });

describe('PreviewSection', () => {
  it('offers to push a change request that is not on origin yet', () => {
    setup(fresh);
    expect(chip()).toBe('Not pushed');
    expect(screen.getByText(/Not on origin yet/)).toBeTruthy();
    expect(pushButton().textContent).toBe('Preview');
    expect(pushButton().disabled).toBe(false);
    expect(screen.getByText('Pushes 3 commits to origin; Cloudflare builds the preview. No pull request is opened.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open preview' })).toBeNull();
  });

  it('pushes, then shows what the server answers', async () => {
    const { push, onPushed, rerender } = setup(fresh);
    await userEvent.click(pushButton());
    expect(push).toHaveBeenCalledTimes(1);
    expect(onPushed).toHaveBeenCalledWith(pushed('waiting'));
    rerender(pushed('waiting'));
    expect(screen.getByRole('status').textContent).toBe('Pushed 3 commits. Cloudflare usually starts a build within a minute.');
  });

  it('says why a push failed in a toast, and goes on saying what a push would do', async () => {
    render(<ToastStack />);
    setup(fresh, { push: vi.fn(() => Promise.reject(new Error('The remote has commits this change request does not: rejected'))) });
    await userEvent.click(pushButton());
    expect((await screen.findByRole('alert')).textContent).toContain('The remote has commits this change request does not: rejected');
    expect(screen.getByRole('status').textContent).toBe('Pushes 3 commits to origin; Cloudflare builds the preview. No pull request is opened.');
    expect(pushButton().disabled).toBe(false);
  });

  it('says when the preview could not be read again, over the last one read', () => {
    setup(pushed('building'), { error: 'HTTP 500' });
    expect(screen.getByRole('alert').textContent).toBe('Could not read the preview: HTTP 500');
    expect(chip()).toBe('Building');
  });

  it('waits for the open note to save, and for something to push', () => {
    setup(fresh, { unsaved: 'streaming/sinks.mdx' });
    expect(pushButton().disabled).toBe(true);
    expect(screen.getByText('Saving streaming/sinks.mdx…')).toBeTruthy();
    cleanup();
    setup({ ...fresh, unpushed: [] });
    expect(pushButton().disabled).toBe(true);
    expect(screen.getByText('Commit a change to preview it.')).toBeTruthy();
    cleanup();
    setup(pushed('ready'));
    expect(pushButton().disabled).toBe(true);
    expect(screen.getByText('Everything committed is pushed.')).toBeTruthy();
  });

  it.each([
    ['waiting', 'Waiting for Cloudflare'],
    ['building', 'Building'],
    ['ready', 'Ready'],
    ['failed', 'Failed'],
    ['none', 'No build'],
    ['unknown', 'Status unknown'],
  ] as const)('names the %s state', (state, label) => {
    setup(pushed(state));
    expect(chip()).toBe(label);
    expect(screen.getByTestId('preview-state').dataset.build).toBe(state);
  });

  it('opens the preview on the page being edited, with the build log', () => {
    setup(pushed('ready', {}, { at: new Date().toISOString() }));
    const open = screen.getByRole('link', { name: 'Open preview' });
    expect(open.getAttribute('href')).toBe(`${URL}/notes/streaming/sinks`);
    expect(open.getAttribute('target')).toBe('_blank');
    expect(screen.getByRole('link', { name: 'View log' }).getAttribute('href')).toBe(LOG);
    expect(screen.getByText('cr-sinks.chimeyrock.pages.dev')).toBeTruthy();
    expect(screen.getByText((_, element) => element?.tagName === 'SMALL' && /^Built 9c1ab88 · just now$/.test(element.textContent))).toBeTruthy();
  });

  it('says the preview is behind, and pushes only the new commits', () => {
    setup(pushed('ready', { unpushed: ['d4', 'e5'], uncommitted: 1 }));
    expect(screen.getByText('The preview is behind: 2 commits not pushed.')).toBeTruthy();
    expect(screen.getByText('1 file not committed: it will not be in the preview.')).toBeTruthy();
    expect(pushButton().textContent).toBe('Push 2 commits');
  });

  it('explains a failed build, a skipped one, one that never came and a build it cannot read', () => {
    setup(pushed('failed'));
    expect(screen.getByText(/The build failed\. The preview still shows the last successful build/)).toBeTruthy();
    cleanup();
    // A check run that finished neither way: it exists, so it is not "no build".
    setup(pushed('skipped'));
    expect(screen.getByText(/finished this push without building it/)).toBeTruthy();
    expect(screen.queryByText(/after 3 minutes/)).toBeNull();
    expect(screen.getByRole('link', { name: 'View log' })).toBeTruthy();
    cleanup();
    setup(pushed('none', {}, { logUrl: null }));
    expect(screen.getByText(/has not built this push after 3 minutes/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'View log' })).toBeNull();
    cleanup();
    setup(pushed('unknown', {}, { logUrl: null, error: 'gh: not logged in' }));
    expect(screen.getByText(/Could not read the build \(gh: not logged in\)/)).toBeTruthy();
  });

  it('says why a worktree has no preview', () => {
    setup({ ...fresh, branch: 'main', blocked: 'Only change requests (cr/…) get a preview.' });
    expect(screen.getByText('Only change requests (cr/…) get a preview.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('OpenPreview', () => {
  it('opens the pushed preview on the page shown, marked with its build', () => {
    render(<OpenPreview preview={pushed('building')} route="/docs/database" />);
    const link = screen.getByRole('link', { name: 'Open preview (Building)' });
    expect(link.getAttribute('href')).toBe(`${URL}/notes/database`);
    expect(link.dataset.build).toBe('building');
  });

  it('shows nothing before the branch is pushed', () => {
    const { container } = render(<OpenPreview preview={fresh} route="/docs" />);
    expect(container.textContent).toBe('');
  });
});

describe('siteRoute', () => {
  it("is the page of a note, the file of an asset, and the notes' home otherwise", () => {
    expect(siteRoute('content/docs/database/index.mdx')).toBe('/docs/database');
    expect(siteRoute('public/docs/guide/a b.png')).toBe('/docs/guide/a%20b.png');
    expect(siteRoute(null)).toBe('/docs');
  });
});

describe('usePreview', () => {
  it('asks again every 5 seconds while the build runs, and stops once it is done', async () => {
    vi.useFakeTimers();
    const answers = [pushed('waiting'), pushed('building'), pushed('ready')];
    const load = vi.fn(() => Promise.resolve(answers.shift() ?? pushed('ready')));
    const client = { load } as unknown as PreviewClient;
    const { result } = renderHook(() => usePreview(client, true));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.preview?.build?.state).toBe('waiting');
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(result.current.preview?.build?.state).toBe('building');
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(result.current.preview?.build?.state).toBe('ready');
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('puts the answer of a push after a load already running', async () => {
    let finish: (preview: Preview) => void = () => undefined;
    const load = vi.fn(() => new Promise<Preview>((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => usePreview({ load } as unknown as PreviewClient, true));
    // The load is running: the push answers before it does.
    await act(() => Promise.resolve());
    expect(load).toHaveBeenCalledTimes(1);
    act(() => { result.current.set(pushed('waiting')); });
    await act(async () => {
      finish(fresh);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(result.current.preview?.build?.state).toBe('waiting');
  });

  it('loads nothing when off (main)', async () => {
    const load = vi.fn(() => Promise.resolve(fresh));
    const { result } = renderHook(() => usePreview({ load } as unknown as PreviewClient, false));
    await act(() => Promise.resolve());
    expect(load).not.toHaveBeenCalled();
    expect(result.current.preview).toBeNull();
  });
});
