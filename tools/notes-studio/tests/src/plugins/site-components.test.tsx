// @vitest-environment jsdom
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getCalloutVariables } from '@site/components/notes-callout';
import { keywordClassName, tagClassName } from '@site/components/graph-objects';
import type { RefObject } from 'react';
import { decorationsPlugin, useEditorPlugin } from '../../../src/editor/decorations';
import { editorConfig } from '../../../src/plugins';
import { defined } from '../../support/editor-state';
import { mountVisual, stubLayout } from '../../support/visual-editor';

// A note through the live editor draws the site's components with the
// site's own classes and variables, so styles/notes-prose.css and
// components/*.tsx style them in the Studio as on the page.

beforeAll(stubLayout);
afterAll(() => { vi.unstubAllGlobals(); });
afterEach(cleanup);

// The decorations NoteEditor adds over the editor.
const plugin = decorationsPlugin(editorConfig.decorators);
function Decorations({ container }: { container: RefObject<HTMLElement | null> }) {
  useEditorPlugin(container, plugin);
  return null;
}

const NOTE = [
  ':::warn[Mind the gap]',
  'Body text.',
  ':::',
  '',
  'A <Keyword id="grain" displayName="Grain">grain</Keyword> and a <Tag id="fact" displayName="Fact">fact</Tag>.',
  '',
  '<SectionTitle as="h4" id="facts" displayName="Facts">Facts</SectionTitle>',
  '',
].join('\n');

describe('site components in the editor', () => {
  it('draws a callout with the classes and variables of components/notes-callout.tsx', async () => {
    const { prose } = await mountVisual(NOTE);
    const callout = defined(prose.querySelector<HTMLElement>('.notes-callout'));
    for (const [name, value] of Object.entries(getCalloutVariables('warning'))) expect(callout.style.getPropertyValue(name)).toBe(value);
    expect(callout.querySelectorAll('.notes-callout-head')).toHaveLength(2);
    expect(callout.querySelector('.notes-callout-icon svg')).not.toBeNull();
    expect(callout.querySelector('.notes-callout-title')?.textContent).toBe('Mind the gap');
    expect(callout.querySelector('.notes-callout-body')?.textContent).toBe('Body text.');
  });

  it('draws keywords and tags with the classes of components/graph-objects.tsx', async () => {
    const { prose } = await mountVisual(NOTE, { extra: (container) => <Decorations container={container} /> });
    await vi.waitFor(() => { expect(prose.querySelectorAll('.studio-keyword')).toHaveLength(2); });
    const [keyword, tag] = [...prose.querySelectorAll<HTMLElement>('.studio-keyword')];
    for (const name of keywordClassName.split(' ')) expect(keyword.classList.contains(name), name).toBe(true);
    for (const name of tagClassName.split(' ')) expect(tag.classList.contains(name), name).toBe(true);
  });

  it('draws a section title as the heading it names, which the prose sizes', async () => {
    const { prose } = await mountVisual(NOTE);
    const title = defined(prose.querySelector('.studio-section-title'));
    expect(title.tagName).toBe('H4');
    expect(title.textContent).toBe('Facts');
  });
});
