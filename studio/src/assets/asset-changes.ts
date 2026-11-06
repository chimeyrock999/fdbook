import { useEffect, useState } from 'react';
import { messageOf } from '../actions/toasts';
import type { AssetAnswer, AssetChange, AssetRequest, AssetsClient } from '../api/assets';
import { nameOf } from './asset-tree';

// The parts of an asset change the view, the page and the dialogs share.

const PREVIEW_MS = 200;

// What the server would write for `request`, asked again as it changes.
export function usePreview(client: AssetsClient, request: AssetRequest | null) {
  const [preview, setPreview] = useState<{ changes: AssetChange[]; error: string | null } | null>(null);
  const key = JSON.stringify(request);
  useEffect(() => {
    if (request === null) return;
    let current = true;
    const timer = setTimeout(() => {
      client.change(request, true).then(
        (answer) => { if (current) setPreview({ changes: answer.changes, error: null }); },
        (reason: unknown) => { if (current) setPreview({ changes: [], error: messageOf(reason) }); },
      );
    }, PREVIEW_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // `key` stands for `request`, which is a new object on every render.
  }, [client, key]);
  return request === null ? null : preview;
}

export const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? '' : 's'}`;

// What a change did, for the status line under the view or the page.
export function said(answer: AssetAnswer) {
  const first = answer.changes.at(0);
  const notes = answer.changes.filter((change) => change.type === 'change').length;
  const updated = notes === 0 ? '' : `; updated ${plural(answer.usages.length, 'reference')} in ${plural(notes, 'note')}`;
  if (first?.type === 'move') return `Renamed to ${nameOf(first.to)}${updated}.`;
  if (first?.type === 'replace') return first.to === first.path ? `Replaced ${nameOf(first.path)}.` : `Replaced ${nameOf(first.path)} with ${nameOf(first.to)}${updated}.`;
  return `Deleted ${first?.path ?? 'the file'}.`;
}

// Where a change took the asset: its new path, or null when it stayed or went.
export function movedTo(answer: AssetAnswer) {
  const first = answer.changes.at(0);
  return (first?.type === 'move' || first?.type === 'replace') && first.to !== first.path ? first.to : null;
}
