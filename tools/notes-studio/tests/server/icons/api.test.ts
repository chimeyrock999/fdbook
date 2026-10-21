import { icons } from 'lucide-react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOTE_ICON_NAMES } from '../../../../../lib/notes-icons.ts';
import { json, rawRequest } from '../../support/http';
import { startTestStudio, type TestStudio } from '../../support/studio';

let studio: TestStudio;

beforeAll(async () => {
  studio = await startTestStudio();
});

afterAll(async () => {
  await studio.close();
});

describe('GET /api/icons', () => {
  it("lists the site's lucide names, not the Studio's", async () => {
    const response = await rawRequest(`${studio.url}api/icons`);
    expect(response.status).toBe(200);
    const { names } = json(response) as { names: string[] };
    expect(names).toEqual(NOTE_ICON_NAMES);
    expect(names).toContain('Brain');
    // The two lucide-react versions differ; the list follows the site's.
    expect(names).not.toEqual(Object.keys(icons));
  });

  it('refuses other methods', async () => {
    expect((await rawRequest(`${studio.url}api/icons`, { method: 'POST' })).status).toBe(405);
  });
});
