import { FileCode } from 'lucide-react';
import { extensionOf } from '@fdbook/shared/asset-types.ts';
import { useAssetUrl } from '#api/asset-versions.ts';
import type { DiffSide } from '#api/changes.ts';
import { NOW, type Comparison, type HistoryClient, type VersionRef } from '#api/history.ts';
import { formatSize, isImage } from '#features/assets/asset-facts.ts';
import { ImageSide } from '#features/diff/ImageSide.tsx';
import { RenderedDiff } from '#features/diff/RenderedDiff.tsx';
import { SourceDiff } from '#features/diff/SourceDiff.tsx';
import { isAsset, type Mode } from './modes';
import { shortVersion } from './versions';

const textOf = (side: DiffSide | null) => (side?.kind === 'text' ? side.text : null);

// The version's image: the file API's URL for the asset on disk (kept up to
// date as it changes), else the blob of its commit.
function VersionImage({ client, version, side, place, empty }: { client: HistoryClient; version: VersionRef | null; side: DiffSide | null; place: 'before' | 'after'; empty: string }) {
  const now = useAssetUrl(version?.path ?? '');
  const label = version === null ? 'Before' : shortVersion(version.version);
  const url = version === null ? '' : version.version === NOW ? now : client.versionUrl(version.path, version.version);
  return <ImageSide label={label} place={place} side={side} url={url} empty={empty} />;
}

// Two versions of an asset side by side: images as they look, other files
// by their size.
function AssetSides({ client, comparison }: { client: HistoryClient; comparison: Comparison }) {
  const size = (side: DiffSide | null, missing: string) => (side === null ? missing : formatSize(side.size));
  if (!isImage(comparison.path)) {
    return (
      <div className="studio-diff-images">
        <p className="studio-asset-noview">
          <FileCode size={28} aria-hidden />
          The Studio has no preview for .{extensionOf(comparison.path)} files.
          {' '}{size(comparison.before, 'Nothing')} → {size(comparison.after, 'nothing')}
        </p>
      </div>
    );
  }
  return (
    <div className="studio-diff-images">
      <VersionImage client={client} version={comparison.from} side={comparison.before} place="before" empty="Nothing before: the asset starts here." />
      <VersionImage client={client} version={comparison.to} side={comparison.after} place="after" empty="Not on disk." />
    </div>
  );
}

// The comparison of two versions: the version `from` on the left (or
// nothing), the selected one on the right. A note renders as the editor
// shows it or shows its source; an asset previews, or shows its source.
export function ComparisonBody({ client, comparison, mode, onUnparsed }: { client: HistoryClient; comparison: Comparison; mode: Mode; onUnparsed: () => void }) {
  const [before, after] = [textOf(comparison.before), textOf(comparison.after)];
  const asset = isAsset(comparison.path);
  if (!asset && [comparison.before, comparison.after].some((side) => side?.kind === 'binary')) {
    return <p className="studio-diff-note">Too large to compare here.</p>;
  }
  if (comparison.after === null) return <p className="studio-diff-note">{asset ? 'The asset' : 'The page'} is not on disk.</p>;
  const binary = [comparison.before, comparison.after].some((side) => side?.kind === 'binary');
  if (comparison.from !== null && !binary && before === after) {
    return <p className="studio-diff-note">Same content as {shortVersion(comparison.from.version)}.</p>;
  }
  if (mode === 'source' && !binary) return <SourceDiff path={comparison.to.path} before={before ?? ''} after={after ?? ''} />;
  if (asset) return <AssetSides client={client} comparison={comparison} />;
  return <RenderedDiff before={before} after={after} onUnparsed={onUnparsed} />;
}
