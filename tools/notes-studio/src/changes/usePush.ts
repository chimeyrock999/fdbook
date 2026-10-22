import { useCallback, useState } from 'react';
import type { Preview, PreviewClient } from '../api/preview';
import { plural } from '../assets/asset-changes';

// What the last push did, for the preview it was made on (`key`): a new
// commit or a push from elsewhere drops it.
export type PushResult = { text: string; error: boolean; key: string };

export const keyOf = (preview: Preview) => `${preview.pushed?.sha ?? ''} ${preview.unpushed.join(' ')}`;

// Pushing the change request, shared by the Preview section and the
// header's Preview and Update PR, so either shows the other's push.
// `push` resolves whether it went through.
export function usePush(client: PreviewClient, onPushed: (preview: Preview) => void) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PushResult | null>(null);
  const push = useCallback((preview: Preview) => {
    const count = preview.unpushed.length;
    const pr = preview.pr?.state === 'OPEN' ? preview.pr : null;
    setBusy(true);
    setResult(null);
    return client.push().then(
      (next) => {
        const done = pr === null ? 'Cloudflare usually starts a build within a minute.' : `Pull request #${String(pr.number)} has them too.`;
        setResult({ text: `Pushed ${plural(count, 'commit')}. ${done}`, error: false, key: keyOf(next) });
        onPushed(next);
        return true;
      },
      (reason: unknown) => {
        setResult({ text: reason instanceof Error ? reason.message : String(reason), error: true, key: keyOf(preview) });
        return false;
      },
    ).finally(() => { setBusy(false); });
  }, [client, onPushed]);
  return { busy, result, push };
}

export type Pusher = ReturnType<typeof usePush>;
