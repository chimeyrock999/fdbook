import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import { run } from '../cr/git.ts';
import { NOTES_DIR } from '../security/paths.ts';
import { AGENT_NAMES, type AgentId, type AgentInfo, type AgentRole } from './shared.ts';

// How the Studio starts one agent over ACP. Each agent keeps its own login
// (claude, codex, omp and hermes each sign in on their own): the Studio
// holds no key and passes none.
export type AgentProfile = {
  id: AgentId;
  name: string;
  // Whether a reviewer's own tools are held to reading (AgentInfo).
  fencesReviewer: boolean;
  // The process to start, its cwd being the change request's worktree.
  command: (role: AgentRole) => { command: string; args: string[]; env?: Record<string, string> };
  // Sent with session/new: what the agent's adapter reads to fence it in.
  sessionMeta?: (role: AgentRole) => Record<string, unknown>;
  // The session mode to start in (session/set_mode), whatever the person's
  // own settings make the default.
  mode?: string;
  // Whether it can run here, and why not.
  check: () => Promise<Omit<AgentInfo, 'id' | 'name' | 'fencesReviewer'>>;
};

const CHECK_TIMEOUT_MS = 15_000;
const require = createRequire(import.meta.url);

// The script an npm package runs as `bin`, resolved from the Studio's own
// node_modules, so the version is the one package-lock.json pins.
function binOf(name: string, bin: string) {
  const manifest = require.resolve(`${name}/package.json`);
  const { bin: bins, version } = require(manifest) as { bin: Record<string, string | undefined>; version: string };
  const script = bins[bin];
  if (script === undefined) throw new Error(`${name} has no ${bin} command`);
  return { script: join(dirname(manifest), script), version };
}

function packaged(name: string, bin: string) {
  return () => {
    try {
      return Promise.resolve({ available: true, reason: null, note: null, version: binOf(name, bin).version });
    } catch {
      return Promise.resolve({ available: false, reason: `${name} is not installed: run npm run studio:install`, note: null, version: null });
    }
  };
}

// The version a CLI prints (`omp/18.5.1`, `hermes 0.4.0`), or its first line.
export function versionOf(output: string): string | null {
  const first = output.trim().split('\n')[0] ?? '';
  return /\d+\.\d+(?:\.\d+)?[\w.-]*/.exec(first)?.[0] ?? (first === '' ? null : first);
}

// A CLI the person installs: there when `<command> <args>` answers.
function installed(command: string, args: string[], install: string) {
  return async () => {
    try {
      const output = await run(command, args, homedir(), { timeoutMs: CHECK_TIMEOUT_MS });
      return { available: true, reason: null, note: null, version: versionOf(output) };
    } catch {
      return { available: false, reason: `${command} is not installed: ${install}`, note: null, version: null };
    }
  };
}

// Commands an author must not run: what reaches GitHub is a person's click.
// Best effort: `git -C . push` or `sh -c "git push"` do not match, so the
// question in the chat is the fence; these only spare it the obvious asks.
// Notes are not edited in place either: an author proposes (the Studio's
// propose_edit), and a person accepts. An Edit rule covers every file tool
// (Edit, MultiEdit, Write); the path is the worktree's, the session's cwd.
const CLAUDE_AUTHOR_DENY = ['Bash(git push:*)', 'Bash(gh:*)', `Edit(${NOTES_DIR}/**/*.mdx)`];
// A reviewer reads: no edits, and no shell that could make one.
const CLAUDE_REVIEWER_DENY = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash'];

const claude: AgentProfile = {
  id: 'claude',
  name: AGENT_NAMES.claude,
  fencesReviewer: true,
  command: () => ({ command: process.execPath, args: [binOf('@agentclientprotocol/claude-agent-acp', 'claude-agent-acp').script] }),
  sessionMeta: (role) => ({
    claudeCode: {
      options: {
        disallowedTools: role === 'author' ? CLAUDE_AUTHOR_DENY : CLAUDE_REVIEWER_DENY,
        // Every tool call the settings do not allow asks the Studio.
        allowDangerouslySkipPermissions: false,
      },
    },
  }),
  // Asks before edits and commands, even when the person's settings
  // default to acceptEdits or auto.
  mode: 'default',
  check: packaged('@agentclientprotocol/claude-agent-acp', 'claude-agent-acp'),
};

const codex: AgentProfile = {
  id: 'codex',
  name: AGENT_NAMES.codex,
  fencesReviewer: true,
  // workspace-write keeps the shell in the worktree with no network, so a
  // push asks first; read-only for a reviewer.
  command: (role) => ({
    command: process.execPath,
    args: [binOf('@agentclientprotocol/codex-acp', 'codex-acp').script],
    env: { INITIAL_AGENT_MODE: role === 'author' ? 'workspace-write' : 'read-only' },
  }),
  check: packaged('@agentclientprotocol/codex-acp', 'codex-acp'),
};

const omp: AgentProfile = {
  id: 'omp',
  name: AGENT_NAMES.omp,
  // omp acp takes no flag to turn its edit and shell tools off.
  fencesReviewer: false,
  command: () => ({ command: 'omp', args: ['acp'] }),
  check: installed('omp', ['--version'], 'install omp and sign in with it once'),
};

// The toolsets Hermes runs a shell with. Its ACP config lives in the
// person's ~/.hermes/config.yaml, which the Studio reads and never writes.
const HERMES_SHELLS = ['terminal', 'code_execution'];

export function hermesShellNote(config: unknown): string | null {
  const record = (value: unknown) => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : null);
  const acp = list(record(record(config).platform_toolsets).acp);
  const disabled = list(record(record(config).agent).disabled_toolsets) ?? [];
  // Without its own list, ACP runs the hermes-acp toolset, shell included.
  const on = HERMES_SHELLS.filter((name) => !disabled.includes(name) && (acp === null || acp.includes(name)));
  if (on.length === 0) return null;
  return `Hermes can run a shell (${on.join(', ')}): add them to agent.disabled_toolsets in ~/.hermes/config.yaml to keep it to file edits.`;
}

const hermesCheck = installed('hermes', ['acp', '--version'], 'install Hermes Agent with its [acp] extra');

const hermes: AgentProfile = {
  id: 'hermes',
  name: AGENT_NAMES.hermes,
  // Its toolsets are set in the person's config, for every ACP session.
  fencesReviewer: false,
  command: () => ({ command: 'hermes', args: ['acp'] }),
  async check() {
    const found = await hermesCheck();
    if (!found.available) return found;
    const config = await readFile(join(homedir(), '.hermes', 'config.yaml'), 'utf8').then((text) => parse(text) as unknown, () => null);
    return { ...found, note: hermesShellNote(config) };
  },
};

export const PROFILES: AgentProfile[] = [claude, codex, omp, hermes];

// The environment an agent starts with: the Studio's own, less what signs
// the Studio in to GitHub. The agent keeps the variables its own login reads.
const PRIVATE_ENV = /^(STUDIO_|GH_|GITHUB_)/;

export function agentEnv(base: NodeJS.ProcessEnv, extra: Record<string, string> = {}) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) if (value !== undefined && !PRIVATE_ENV.test(key)) env[key] = value;
  return { ...env, ...extra };
}

const INFO_MS = 60_000;

// What each profile says about itself, read again after a minute: an agent
// installed while the Studio runs shows up without a restart.
export function createAgentInfo(profiles: AgentProfile[]) {
  let cached: { at: number; agents: Promise<AgentInfo[]> } | null = null;
  return () => {
    if (cached === null || Date.now() - cached.at > INFO_MS) {
      const agents = Promise.all(profiles.map(async (profile) => ({ id: profile.id, name: profile.name, fencesReviewer: profile.fencesReviewer, ...(await profile.check()) })));
      cached = { at: Date.now(), agents };
    }
    return cached.agents;
  };
}
