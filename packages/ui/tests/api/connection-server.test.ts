import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { refusalOf } from '#api/connection.ts';
import { startTestStudio, type TestStudio } from '@fdbook/testing/studio.ts';

// The probe of a refused stream against a real Studio: what each stream
// answers there, and a Studio that stopped.
describe('refusalOf on a real Studio', () => {
  let studio: TestStudio;
  beforeAll(async () => { studio = await startTestStudio(); });
  afterAll(async () => { await studio.close(); });

  it('answers null for a stream that opens, without waiting for its events', async () => {
    expect(await refusalOf(`${studio.url}api/events`)).toBeNull();
  });

  it('reads a stream refused for want of a change request (409) as cr-closed', async () => {
    expect(await refusalOf(`${studio.url}api/proposals/events`)).toEqual({ reason: 'cr-closed' });
    expect(await refusalOf(`${studio.url}api/agents/events`)).toEqual({ reason: 'cr-closed' });
  });

  it('reads a change request that is gone (404) as cr-closed', async () => {
    expect(await refusalOf(`${studio.origin}/cr/no-such-cr/api/events`)).toEqual({ reason: 'cr-closed' });
  });

  it('reads a Studio that stopped as unreachable', async () => {
    const stopped = await startTestStudio();
    const url = `${stopped.url}api/events`;
    await stopped.close();
    expect(await refusalOf(url)).toEqual({ reason: 'unreachable' });
  });
});
