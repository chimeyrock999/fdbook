// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// src/prose.css hands what the editor draws itself back to the
// editor's look; the note's content, and the Studio's own components, keep
// the site's prose. The rule's own selector, run against editor-like DOM.

// The Studio's root: jsdom tests cannot read server/infra/config's file URLs.
const studioProse = readFileSync(join(import.meta.dirname, '../src/prose.css'), 'utf8');

function scopeSelector() {
  const css = studioProse.replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = /([^{}]+)\{\s*all: revert-layer;\s*\}/.exec(css);
  if (!rule) throw new Error('no revert-layer scope rule');
  // The first selector of the list; the second is its li::before.
  return rule[1].split(/,\s*\n/)[0].trim();
}

function editor(inner: string) {
  document.body.innerHTML = `<div class="studio-prose prose"><div class="ProseMirror" contenteditable="true">${inner}</div></div>`;
  return (selector: string) => document.querySelector(selector);
}

describe('the editor prose scope', () => {
  it('reverts what the editor draws without letting you edit it', () => {
    const selector = scopeSelector();
    const find = editor('<div contenteditable="false"><svg><foreignObject><p id="label">A</p></foreignObject></svg></div>');
    expect(find('#label')?.matches(selector)).toBe(true);
  });

  it('keeps the note content and the Studio components', () => {
    const selector = scopeSelector();
    const find = editor([
      '<ul><li id="content">text</li></ul>',
      '<div contenteditable="false"><div contenteditable="true"><ul><li id="nested">body</li></ul></div></div>',
      '<div class="studio-accordions" contenteditable="false"><code id="studio">x</code></div>',
    ].join(''));
    for (const id of ['content', 'nested', 'studio']) expect(find(`#${id}`)?.matches(selector), id).toBe(false);
  });
});
