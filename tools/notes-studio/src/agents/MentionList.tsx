import { FileCode, FileText, Image } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { composing } from '../keyboard';
import type { Mention, MentionKind } from '../api/agents';
import type { ContextClient } from './Composer';
import { shortPath } from './context-labels';

// How long typing pauses before the list is asked for.
const LOOKUP_MS = 120;
const GROUPS: { kind: MentionKind; label: string; icon: typeof FileText }[] = [
  { kind: 'note', label: 'Notes', icon: FileText },
  { kind: 'asset', label: 'Assets', icon: Image },
  { kind: 'file', label: 'Repo files', icon: FileCode },
];

// The notes, assets and files matching `query`, over the composer, in
// groups. The arrows move, Enter or Tab picks, Escape closes: the keys are
// taken from `input` before the composer sees them (an IME's Enter is not).
export function MentionList({ client, query, input, onPick, onClose }: {
  client: ContextClient;
  query: string;
  input: RefObject<HTMLTextAreaElement | null>;
  onPick: (mention: Mention) => void;
  onClose: () => void;
}) {
  const [found, setFound] = useState<{ query: string; mentions: Mention[] } | null>(null);
  const [active, setActive] = useState(0);
  // In the order shown.
  const ordered = useMemo(() => GROUPS.flatMap((group) => (found?.mentions ?? []).filter((mention) => mention.kind === group.kind)), [found]);
  // The list is for an earlier @word until the lookup answers: Enter waits.
  const current = found?.query === query;

  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      client.mentions(query).then(
        (list) => { if (current) { setFound({ query, mentions: list }); setActive(0); } },
        () => { if (current) setFound({ query, mentions: [] }); },
      );
    }, LOOKUP_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [client, query]);

  // What the key listener reads, bound once: the list changes with each keystroke.
  const latest = useRef({ ordered, current, active, onPick, onClose });
  useLayoutEffect(() => {
    latest.current = { ordered, current, active, onPick, onClose };
  });

  useEffect(() => {
    const area = input.current;
    if (area === null) return undefined;
    const keys = (event: KeyboardEvent) => {
      const now = latest.current;
      if (event.key === 'Escape') {
        event.preventDefault();
        now.onClose();
        return;
      }
      if (now.ordered.length === 0) return;
      if (!now.current) {
        if (event.key === 'Enter' || event.key === 'Tab') event.preventDefault();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((before) => (before + (event.key === 'ArrowDown' ? 1 : now.ordered.length - 1)) % now.ordered.length);
      } else if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && !composing(event)) {
        event.preventDefault();
        now.onPick(now.ordered[Math.min(now.active, now.ordered.length - 1)]);
      }
    };
    area.addEventListener('keydown', keys);
    return () => { area.removeEventListener('keydown', keys); };
  }, [input]);

  if (found === null) return null;
  return (
    <div className="studio-agent-mentions" role="listbox" aria-label="Mention">
      {ordered.length === 0 && <p className="studio-agent-menu-note">Nothing matches @{query}</p>}
      {GROUPS.map((group) => {
        const items = ordered.filter((mention) => mention.kind === group.kind);
        if (items.length === 0) return null;
        const Icon = group.icon;
        return (
          <div key={group.kind} role="group" aria-label={group.label}>
            <p className="studio-agent-menu-head"><span>{group.label}</span></p>
            {items.map((mention) => {
              const index = ordered.indexOf(mention);
              return (
                <button
                  key={mention.path}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  className="studio-agent-mention"
                  title={mention.path}
                  // Keeps the focus in the message box.
                  onMouseDown={(event) => { event.preventDefault(); }}
                  onClick={() => { onPick(mention); }}
                  onMouseEnter={() => { setActive(index); }}
                >
                  <Icon size={13} aria-hidden />
                  <span>{mention.kind === 'note' ? shortPath(mention.path) : mention.path}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
