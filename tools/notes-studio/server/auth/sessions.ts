import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { GitHubUser } from './github.ts';

// A signed-in person: who they are on GitHub and the token their writes
// must carry (csrf). No GitHub token is kept.
export type Session = { user: GitHubUser; csrf: string; expiresAt: number };

const hashOf = (id: string) => createHash('sha256').update(id).digest('hex');

// Sessions by the hash of their id, kept in a file of the Studio home (never
// in the repository or a worktree), readable by its owner only, so a restart
// keeps everyone signed in. The id itself is only in the browser's cookie.
export function createSessionStore(file: string, days: number) {
  const sessions = new Map<string, Session>();
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { sessions?: Record<string, Session> };
    for (const [hash, session] of Object.entries(saved.sessions ?? {})) sessions.set(hash, session);
  } catch {
    // No file yet, or one that cannot be read: start empty.
  }

  // Writes one at a time, the latest state each time.
  let writing = Promise.resolve();
  const save = () => {
    writing = writing.then(async () => {
      const now = Date.now();
      for (const [hash, session] of sessions) if (session.expiresAt <= now) sessions.delete(hash);
      await mkdir(dirname(file), { recursive: true });
      const temp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
      await writeFile(temp, `${JSON.stringify({ sessions: Object.fromEntries(sessions) })}\n`, { mode: 0o600 });
      await chmod(temp, 0o600);
      await rename(temp, file);
    }).catch((error: unknown) => {
      console.error(`Could not save the Studio sessions to ${file}: ${(error as Error).message}`);
    });
    return writing;
  };

  return {
    maxAgeSeconds: days * 24 * 60 * 60,
    async create(user: GitHubUser) {
      const id = randomBytes(32).toString('base64url');
      const session = { user, csrf: randomBytes(24).toString('base64url'), expiresAt: Date.now() + days * 24 * 60 * 60_000 };
      sessions.set(hashOf(id), session);
      await save();
      return { id, session };
    },
    get(id: string | null): Session | null {
      if (id === null) return null;
      const session = sessions.get(hashOf(id));
      if (session === undefined) return null;
      if (session.expiresAt > Date.now()) return session;
      sessions.delete(hashOf(id));
      return null;
    },
    async remove(id: string | null) {
      if (id !== null && sessions.delete(hashOf(id))) await save();
    },
    saved: () => writing,
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
