import { useState } from 'react';
import type { DiffSide } from '#api/changes.ts';
import { formatSize } from '#assets/asset-facts.ts';

// One side of an image comparison, on a checker: its size and, once it
// loaded, its pixel box. `place` says which side it is, for the styles.
export function ImageSide({ label, side, url, empty, place }: { label: string; side: DiffSide | null; url: string; empty: string; place: 'before' | 'after' }) {
  const [box, setBox] = useState<string | null>(null);
  return (
    <figure className="studio-diff-image" data-side={place}>
      <figcaption>
        <b>{label}</b>
        <span>{side === null ? '—' : [formatSize(side.size), box].filter(Boolean).join(' · ')}</span>
      </figcaption>
      {side === null ? (
        <p className="studio-diff-note">{empty}</p>
      ) : (
        <div className="studio-diff-checker">
          <img src={url} alt={`${label} version`} onLoad={(event) => { setBox(`${String(event.currentTarget.naturalWidth)} × ${String(event.currentTarget.naturalHeight)} px`); }} />
        </div>
      )}
    </figure>
  );
}
