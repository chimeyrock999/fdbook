import { useState } from 'react';
import { errorOf, readJson } from '../api/json';
import { studioFetch } from '../api/session';
import { useCopy } from '../clipboard';
import { useSession } from '../session/session';
import { Dialog } from '../tree/TreeDialogs';
import { CLIENTS, CODEX_TOKEN_STEP, connectCommand, type Client } from './connect-command';

function CopyRow({ id, text }: { id: string; text: string }) {
  const { copied, ref, copy } = useCopy<HTMLElement>(text);
  return (
    <span className="studio-connect-copy">
      <code id={id} ref={ref}>{text}</code>
      <button type="button" className="studio-button" onClick={copy}>{copied === true ? 'Copied' : 'Copy'}</button>
    </span>
  );
}

// How to give an agent in a terminal the Studio's tools (#85): the MCP
// address, a command per agent, and with sign-in on a token of the person's
// own (POST /api/mcp/tokens), shown once. `cr` is the change request open,
// for the tools' cr.
export function ConnectDialog({ cr, onClose }: { cr: string | null; onClose: () => void }) {
  const { state } = useSession();
  const signedIn = state.auth === 'github';
  const url = `${window.location.origin}/api/mcp`;
  const [client, setClient] = useState<Client>('claude');
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const tokens = (method: 'POST' | 'DELETE') =>
    studioFetch('/api/mcp/tokens', { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
  const mint = () => {
    setBusy(true);
    setNote(null);
    tokens('POST')
      .then(async (response) => {
        if (!response.ok) throw await errorOf(response);
        setToken((await readJson<{ token: string }>(response)).token);
      })
      .catch((reason: unknown) => { setNote((reason as Error).message); })
      .finally(() => { setBusy(false); });
  };
  const endAll = () => {
    setBusy(true);
    tokens('DELETE')
      .then(async (response) => {
        if (!response.ok) throw await errorOf(response);
        setToken(null);
        setNote('Every agent token of yours has ended.');
      })
      .catch((reason: unknown) => { setNote((reason as Error).message); })
      .finally(() => { setBusy(false); });
  };

  return (
    <Dialog title="Connect an agent" onClose={onClose} onSubmit={onClose}>
      <p className="text-[13px] text-[var(--fde-muted-foreground)]">
        Gives an agent in a terminal (Claude Code, Codex…) the Studio&apos;s tools while the Studio is open. It works in the change request it names as <code>cr</code>{cr === null ? '' : <> (this one is <code>{cr}</code>)</>}, never on main, and its edits arrive here as suggestions.
      </p>
      <div className="grid gap-1">
        <span className="studio-field-label">MCP server</span>
        <CopyRow id="studio-connect-url" text={url} />
      </div>
      {signedIn && (
        <div className="grid gap-1">
          <span className="studio-field-label">Agent token</span>
          {token === null ? (
            <span><button type="button" className="studio-button studio-button-primary" disabled={busy} onClick={mint}>Create token</button></span>
          ) : <CopyRow id="studio-connect-token" text={token} />}
          <span className="studio-cr-hint">It acts as you, with your access ({state.role ?? 'none'}), until you sign out or end it. It is shown once.</span>
        </div>
      )}
      <div className="grid gap-1">
        <span className="studio-field-label">Command</span>
        <span className="studio-connect-clients" role="group" aria-label="Agent">
          {CLIENTS.map((each) => (
            <button key={each.id} type="button" aria-pressed={client === each.id} onClick={() => { setClient(each.id); }}>{each.name}</button>
          ))}
        </span>
        {signedIn && client === 'codex' && (
          <>
            <CopyRow id="studio-connect-token-step" text={CODEX_TOKEN_STEP} />
            <span className="studio-cr-hint">Run this first, paste the token and press Enter: it is not echoed nor kept in the shell history. Codex reads it from STUDIO_MCP_TOKEN each time it starts, so keep it set in the shell you start Codex from.</span>
          </>
        )}
        <CopyRow id="studio-connect-command" text={connectCommand(client, url, signedIn ? (token ?? '<token>') : null)} />
        {signedIn && client === 'claude' && <span className="studio-cr-hint">The command holds the token: it stays in your shell history and in Claude Code&apos;s MCP settings until you end it here.</span>}
        {signedIn && client === 'stdio' && <span className="studio-cr-hint">The command holds the token: it stays in your shell history, or wherever you put the command, until you end it here.</span>}
      </div>
      {note !== null && <p role="status" className="studio-cr-hint">{note}</p>}
      <div className="flex justify-end gap-2">
        {signedIn && <button type="button" className="studio-button" data-tone="error" disabled={busy} onClick={endAll}>End all my tokens</button>}
        <button type="submit" className="studio-button studio-button-primary">Done</button>
      </div>
    </Dialog>
  );
}
