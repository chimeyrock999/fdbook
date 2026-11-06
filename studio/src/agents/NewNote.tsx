import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NOTES_DIR } from '../../server/security/asset-types';
import type { MessageContext } from '../api/agents';
import { slugify } from '../slug';
import { draftPrompt } from './actions';
import { Composer, type ContextClient } from './Composer';
import { cleanFolder, shortPath } from './context-labels';
import { useEditorPlace } from './editor-place';

// The folder a new note goes to by default: the open note's.
const folderOf = (note: string | undefined) => (note === undefined ? '' : shortPath(note).split('/').slice(0, -1).join('/'));

// How long typing pauses before the path is looked up.
const LOOKUP_MS = 250;

// A new note drafted by an author agent from an outline and sources (#86):
// where it goes and what it holds, then the composer below for anything
// else, mentions and attached documents. The draft starts a new chat; the
// note arrives on that turn's Keep/Revert list.
export function NewNote({ client, onDraft, onClose }: {
  client: ContextClient;
  onDraft: (prompt: string, context: MessageContext | null) => Promise<boolean>;
  onClose: () => void;
}) {
  const place = useEditorPlace();
  const [folder, setFolder] = useState(() => folderOf(place?.note));
  const [title, setTitle] = useState('');
  const [outline, setOutline] = useState('');
  const [urls, setUrls] = useState('');
  const slug = slugify(title);
  const inside = cleanFolder(folder);
  const path = `${NOTES_DIR}/${[inside ?? '', `${slug}.mdx`].filter((part) => part !== '').join('/')}`;
  // The path last looked up and whether a note is already there (the
  // agent would propose to replace it): Send waits for the path shown. A
  // lookup that fails lets it go; the message tells the agent to stop then.
  const [checked, setChecked] = useState<{ path: string; taken: boolean } | null>(null);
  useEffect(() => {
    if (slug === '' || inside === null) return undefined;
    let current = true;
    const timer = setTimeout(() => {
      client.mentions(path).then(
        (found) => { if (current) setChecked({ path, taken: found.some((each) => each.path === path) }); },
        () => { if (current) setChecked({ path, taken: false }); },
      );
    }, LOOKUP_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [client, path, slug, inside]);
  const exists = checked?.path === path && checked.taken;
  const ready = slug !== '' && inside !== null && checked?.path === path && !checked.taken;

  return (
    <>
      <div className="studio-agent-newnote" role="group" aria-label="New note">
        <div className="studio-agent-newnote-head">
          <strong>New note from an outline or sources</strong>
          <button type="button" className="studio-agent-composer-tool" aria-label="Close the new note" title="Close" onClick={onClose}><X size={14} aria-hidden /></button>
        </div>
        <div className="studio-agent-newnote-row">
          <label>Folder<input value={folder} placeholder={NOTES_DIR} onChange={(event) => { setFolder(event.target.value); }} /></label>
          <label>Title<input value={title} placeholder="What the note is about" onChange={(event) => { setTitle(event.target.value); }} /></label>
        </div>
        <span className="studio-agent-newnote-path" aria-label="Path">{inside === null ? 'The folder cannot hold . or ..' : slug === '' ? 'Give it a title' : path}</span>
        {exists && <span role="alert" className="studio-agent-newnote-taken">A note is already there: pick another title or folder.</span>}
        <label>Outline<textarea value={outline} rows={3} placeholder="Headings or points, one per line (optional)" onChange={(event) => { setOutline(event.target.value); }} /></label>
        <label>Links to read<textarea value={urls} rows={2} placeholder="One URL per line (optional)" onChange={(event) => { setUrls(event.target.value); }} /></label>
        <span className="studio-agent-meta">Mention notes or repo files with @ and attach documents below. The note arrives on the turn's Keep/Revert list.</span>
      </div>
      <Composer
        placeholder="Anything else the agent should know…"
        busy={!ready}
        sendEmpty
        client={client}
        onSend={(text, context) => onDraft(
          [draftPrompt({ path, title: title.trim(), outline, urls: urls.split('\n').map((url) => url.trim()).filter((url) => url !== '') }), text.trim()].filter((part) => part !== '').join('\n\n'),
          context,
        ).then((sent) => {
          if (sent) onClose();
          return sent;
        })}
      >
        <span className="studio-agent-who">Draft it</span>
      </Composer>
    </>
  );
}
