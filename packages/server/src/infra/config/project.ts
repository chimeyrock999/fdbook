import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_AREAS, type Areas } from '@fdbook/shared/asset-types.ts';

// fdbook.config.ts, next to a project's content: where it keeps its notes,
// their files and its diagrams. The names follow @fumadocs-editor/studio's
// StudioConfig where they mean the same thing; every path is relative to the
// config file.
export type FdbookConfig = {
  // The notes. Default: content/docs, else content when only that exists.
  root?: string;
  // Where the Studio saves the files a page shows, inside public/ (which the
  // site serves at /). Default: public/docs.
  media?: string;
  // The diagrams <Diagram src> draws. Default: diagrams.
  diagrams?: string;
  // The URL the site gives the notes, which links between them resolve
  // against. Default: /docs.
  baseUrl?: string;
};

export const defineConfig = (config: FdbookConfig) => config;

export const CONFIG_FILE = 'fdbook.config.ts';

// A project the Studio edits: its folder, the git repository it is in (change
// requests branch the whole repository), and its areas as paths in there.
export type Project = { dir: string; repo: string; areas: Areas };

export async function loadProject(folder: string): Promise<Project> {
  if (!existsSync(folder)) throw new Error(`There is no folder ${folder} to open.`);
  const dir = realpathSync(folder);
  const file = join(dir, CONFIG_FILE);
  const config = existsSync(file) ? (((await import(pathToFileURL(file).href)) as { default?: FdbookConfig }).default ?? {}) : {};
  const repo = repositoryOf(dir);
  const at = (name: string, path: string) => {
    const inRepo = relative(repo, resolve(dir, path)).split(sep).join('/');
    if (inRepo === '' || inRepo.startsWith('..')) throw new Error(`${CONFIG_FILE}: \`${name}\` must be a folder inside ${repo}, got "${path}".`);
    return inRepo;
  };
  const root = config.root ?? (!existsSync(join(dir, 'content/docs')) && existsSync(join(dir, 'content')) ? 'content' : 'content/docs');
  const areas: Areas = {
    notes: at('root', root),
    assets: at('media', config.media ?? 'public/docs'),
    publicDir: at('public', 'public'),
    diagrams: at('diagrams', config.diagrams ?? DEFAULT_AREAS.diagrams),
    baseUrl: `/${(config.baseUrl ?? DEFAULT_AREAS.baseUrl).replace(/^\/+|\/+$/g, '')}`,
  };
  return { dir, repo, areas };
}

function repositoryOf(dir: string) {
  try {
    return realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {
    throw new Error(`${dir} is not in a git repository: the Studio keeps each change request on a branch.`);
  }
}
