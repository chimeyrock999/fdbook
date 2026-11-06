import { describe, expect, it, vi } from 'vitest';
import { createHandoff } from '#mcp/handoff.ts';

describe('create_cr from main', () => {
  const setup = (start: () => { id: string }) => {
    const handedOff = vi.fn();
    const create = vi.fn((name: unknown) => Promise.resolve({ slug: 'fix-intro', name: name as string, branch: 'cr/fix-intro' }));
    const handoff = createHandoff({
      crs: { create } as never,
      main: { turnOf: () => ({ index: 1, agent: 'claude', by: 'octocat' }), handedOff },
      open: () => Promise.resolve({ start } as never),
      link: (slug, chat) => `/?cr=${slug}${chat === null ? '' : `&chat=${chat}`}`,
    });
    return { handoff, handedOff, create };
  };

  it('links the change request on main even when its chat cannot start, and opens no second one for the message', async () => {
    const { handoff, handedOff, create } = setup(() => { throw new Error('3 agents are already working here'); });
    await expect(handoff('m1', { name: 'Fix intro', brief: 'Fix it.' })).rejects.toThrow(/fix-intro was opened \(\/\?cr=fix-intro\), but its author chat could not start: 3 agents/);
    expect(handedOff).toHaveBeenCalledWith('m1', { slug: 'fix-intro', name: 'Fix intro', branch: 'cr/fix-intro', url: '/?cr=fix-intro', chat: null });
    await expect(handoff('m1', { name: 'Again', brief: 'Fix it.' })).rejects.toThrow(/one per message/);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('lets the message try again when the change request itself could not be made', async () => {
    const { handoff, create } = setup(() => ({ id: 'c9' }));
    create.mockRejectedValueOnce(new Error('Could not fetch origin/main'));
    await expect(handoff('m1', { name: 'Fix intro', brief: 'Fix it.' })).rejects.toThrow(/Could not fetch/);
    await expect(handoff('m1', { name: 'Fix intro', brief: 'Fix it.' })).resolves.toMatchObject({ slug: 'fix-intro', conversationId: 'c9', url: '/?cr=fix-intro&chat=c9' });
  });
});
