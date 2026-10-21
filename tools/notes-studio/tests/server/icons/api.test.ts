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
  // Loaded under Node from lib/, so the names follow the site's lucide-react
  // even when the Studio pins another version.
  it("lists the site's lucide names", async () => {
    const response = await rawRequest(`${studio.url}api/icons`);
    expect(response.status).toBe(200);
    const { names } = json(response) as { names: string[] };
    expect(names).toEqual(NOTE_ICON_NAMES);
    expect(names).toContain('Brain');
  });

  it('refuses other methods', async () => {
    expect((await rawRequest(`${studio.url}api/icons`, { method: 'POST' })).status).toBe(405);
  });
});
