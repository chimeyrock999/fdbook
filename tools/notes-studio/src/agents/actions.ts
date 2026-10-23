// The agent panel's one-click actions (#86): a message written for the
// person, sent with the editor's context like any other (Composer). Every
// result comes back as a suggestion: edits through propose_edit, a new
// note or diagram on the turn's Keep/Revert list.

export type AgentAction = { id: string; label: string; prompt: string };

const PROPOSE = 'Propose the change with propose_edit; do not write the note yourself.';

// On the lines selected in the editor.
export const SELECTION_ACTIONS: AgentAction[] = [
  { id: 'rewrite', label: 'Rewrite', prompt: `Rewrite the selected lines: clearer, same meaning, same voice and language. ${PROPOSE}` },
  { id: 'tighten', label: 'Tighten', prompt: `Tighten the selected lines: the same meaning in fewer words. Keep every fact, link and code. ${PROPOSE}` },
  { id: 'expand', label: 'Expand', prompt: `Expand the selected lines with what a reader new to this needs: the terms explained, a short example where it helps. Keep the note's voice and language. ${PROPOSE}` },
  { id: 'translate', label: 'VI ↔ EN', prompt: `Translate the selected lines: Vietnamese to English, or English to Vietnamese. Keep MDX, code, links and names as they are. ${PROPOSE}` },
  { id: 'callout', label: 'Callout', prompt: `Turn the selected lines into a callout, as the notes write them (:::note, :::info, :::warn or :::caution, closed by :::); pick the kind that fits. ${PROPOSE}` },
  { id: 'table', label: 'Table', prompt: `Turn the selected lines into a Markdown table, if they hold items that share fields; keep every value. ${PROPOSE}` },
];

// On the note open in the editor.
export const NOTE_ACTIONS: AgentAction[] = [
  { id: 'frontmatter', label: 'Fill frontmatter', prompt: `Fill the frontmatter of the open note: description (one sentence on what the reader gets), tags and keywords. Read the note, then call note_vocabulary and reuse its tags and keywords before making up new ones. Change the frontmatter only. ${PROPOSE}` },
  { id: 'links', label: 'Suggest links', prompt: `Suggest links to related notes in the open note: call related_notes, and where a related note helps the reader, link to it in the text with its href. Skip the notes it already links to; do not add a list of links at the end. ${PROPOSE}` },
  { id: 'diagram', label: 'Diagram', prompt: 'Draw a diagram for the open note (of the selected lines, if any) with the diagram tools: diagram_create, then nodes, edges and diagram_layout, and check it with diagram_validate. Then embed it in the note where it helps the reader, with propose_edit.' },
];

// The message for a new note drafted from an outline and sources: the
// Composer adds the mentions and attachments as context.
export function draftPrompt({ path, title, outline, urls }: { path: string; title: string; outline: string; urls: string[] }) {
  const parts = [
    `Draft a new note at ${path}, titled "${title}", in this change request.`,
    outline.trim() === '' ? 'Work out its outline from the sources.' : `Follow this outline:\n${outline.trim()}`,
  ];
  if (urls.length > 0) parts.push(`Read these sources:\n${urls.map((url) => `- ${url}`).join('\n')}`);
  parts.push('Use the mentioned files and attached documents as sources too, if any. If a note is already at that path, stop and say so instead of replacing it. Write it as the other notes are written (read one or two near it first), with its frontmatter (title, description, tags from note_vocabulary). Create it with propose_edit (content), and list it in its folder\'s meta.yaml.');
  return parts.join('\n\n');
}
