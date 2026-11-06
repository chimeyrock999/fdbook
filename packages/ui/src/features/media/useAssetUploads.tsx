import { useEffect, useMemo, useState } from 'react';
import type { createFilesClient } from '#api/files.ts';
import { createAssetMedia, type UploadNotice } from './asset-media';
import { AssetNameDialog } from './AssetNameDialog';
import { createNameQueue, type Asking } from './name-queue';

const ERROR_SHOWN_MS = 8000;

// The open note's media provider, plus what it shows: the name dialog (one
// image at a time, in the order they came) and a notice for the toolbar.
export function useAssetUploads(files: ReturnType<typeof createFilesClient>, notePath: string, assets: readonly string[]) {
  const [notice, setNotice] = useState<UploadNotice | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [names] = useState(() => createNameQueue(setAsking));
  const media = useMemo(
    () =>
      createAssetMedia({
        files,
        notePath,
        askName: names.ask,
        notify: (next, replacing) => {
          setNotice((current) => (replacing === undefined || current === replacing ? next : current));
        },
      }),
    [files, notePath, names],
  );

  // A closed note cancels the image being named and those waiting, so
  // their uploads end.
  useEffect(() => {
    names.reopen();
    return () => { names.close(); };
  }, [names]);

  useEffect(() => {
    if (notice?.kind !== 'error') return;
    const timer = setTimeout(() => { setNotice(null); }, ERROR_SHOWN_MS);
    return () => { clearTimeout(timer); };
  }, [notice]);

  const dialog = asking && <AssetNameDialog key={asking.id} request={asking} assets={assets} onDone={names.answer} />;

  return { media, notice, dismissNotice: () => { setNotice(null); }, dialog };
}
