import { readFrontmatter } from '../frontmatter/frontmatter';

// The title and description above the content, as the note page shows them
// (app/notes/[[...slug]]/page.tsx). They live in the frontmatter, so a click
// opens the frontmatter panel.
export function NoteHeader({ source, onOpen }: { source: string; onOpen: () => void }) {
  const read = readFrontmatter(source);
  const title = read.status === 'ok' && typeof read.data.title === 'string' ? read.data.title : '';
  const description = read.status === 'ok' && typeof read.data.description === 'string' ? read.data.description : '';
  return (
    <button type="button" className="studio-note-header" title="Edit in Frontmatter" onClick={onOpen}>
      <span className="studio-note-title">{title || 'Untitled'}</span>
      {description && <span className="studio-note-description">{description}</span>}
    </button>
  );
}
