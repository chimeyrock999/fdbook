import { useCallback, useState } from 'react';
import { useBusy } from '../actions/busy';
import type { Preview, PreviewClient } from '../api/preview';
import { plural } from '../assets/asset-changes';

// What the last push did, for the preview it was made on (`key`): a new
// commit or a push from elsewhere drops it. A failed push says why in a toast.
export type PushResult = { text: string; key: string };

export const keyOf = (preview: Preview) => `${preview.pushed?.sha ?? ''} ${preview.unpushed.join(' ')}`;

// Pushing the change request, shared by the Preview section and the
// header's Preview and Update PR, so either shows the other's push.
// `push` resolves whether it went through; one at a time.
export function usePush(client: PreviewClient, onPushed: (preview: Preview) => void) {
  const { busy, run } = useBusy();
  const [result, setResult] = useState<PushResult | null>(null);
  const push = useCallback((preview: Preview) => run(async () => {
    const count = preview.unpushed.length;
    const pr = preview.pr?.state === 'OPEN' ? preview.pr : null;
    setResult(null);
    const next = await client.push();
    const done = pr === null ? 'Cloudflare usually starts a build within a minute.' : `Pull request #${String(pr.number)} has them too.`;
    setResult({ text: `Pushed ${plural(count, 'commit')}. ${done}`, key: keyOf(next) });
    onPushed(next);
  }), [client, onPushed, run]);
  return { busy, result, push };
}

export type Pusher = ReturnType<typeof usePush>;
