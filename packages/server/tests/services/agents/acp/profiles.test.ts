import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { modelOf, resumeWay, turnOptions } from '#services/agents/acp/connection.ts';
import { agentEnv, hermesShellNote, PROFILES, versionOf } from '#services/agents/acp/profiles.ts';

const profile = (id: string) => {
  const found = PROFILES.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no profile ${id}`);
  return found;
};

describe('agent profiles', () => {
  it('has Claude Code, Codex, omp and Hermes Agent, in that order', () => {
    expect(PROFILES.map((candidate) => [candidate.id, candidate.name])).toEqual([
      ['claude', 'Claude Code'],
      ['codex', 'Codex'],
      ['omp', 'omp'],
      ['hermes', 'Hermes Agent'],
    ]);
  });

  it('runs the Claude and Codex adapters the lockfile pins, with node', async () => {
    for (const id of ['claude', 'codex']) {
      const { command, args } = profile(id).command('author');
      expect(command).toBe(process.execPath);
      expect(existsSync(args[0] ?? '')).toBe(true);
      expect(await profile(id).check()).toMatchObject({ available: true, reason: null });
    }
  });

  it('keeps a Claude author off git push and gh, and a Claude reviewer off edits and the shell', () => {
    const options = (role: 'author' | 'reviewer') => (profile('claude').sessionMeta?.(role) as { claudeCode: { options: { disallowedTools: string[]; allowDangerouslySkipPermissions: boolean } } }).claudeCode.options;
    expect(options('author')).toEqual({ disallowedTools: ['Bash(git push:*)', 'Bash(gh:*)', 'Edit(content/docs/**/*.mdx)'], allowDangerouslySkipPermissions: false });
    expect(options('reviewer').disallowedTools).toEqual(expect.arrayContaining(['Edit', 'Write', 'Bash']));
  });

  it('starts Codex sandboxed to the worktree for an author and read only for a reviewer', () => {
    expect(profile('codex').command('author').env).toEqual({ INITIAL_AGENT_MODE: 'workspace-write' });
    expect(profile('codex').command('reviewer').env).toEqual({ INITIAL_AGENT_MODE: 'read-only' });
  });

  it('starts omp and Hermes through their own ACP commands', () => {
    expect(profile('omp').command('author')).toEqual({ command: 'omp', args: ['acp'] });
    expect(profile('hermes').command('author')).toEqual({ command: 'hermes', args: ['acp'] });
  });

  it('says why an agent that is not installed cannot run', async () => {
    const saved = process.env.PATH;
    process.env.PATH = '/nonexistent';
    try {
      // execFile looks commands up on the PATH it is given.
      expect(await profile('omp').check()).toMatchObject({ available: false, reason: expect.stringMatching(/^omp is not installed/) as unknown });
    } finally {
      process.env.PATH = saved;
    }
  });

  it('reads the version a CLI prints', () => {
    expect(versionOf('omp/18.5.1\n')).toBe('18.5.1');
    expect(versionOf('hermes 0.4.0-beta.1 (acp)')).toBe('0.4.0-beta.1');
    expect(versionOf('nightly\n')).toBe('nightly');
    expect(versionOf('')).toBeNull();
  });

  it('warns when Hermes can still run a shell', () => {
    expect(hermesShellNote(null)).toMatch(/terminal, code_execution/);
    expect(hermesShellNote({ agent: { disabled_toolsets: ['terminal'] } })).toMatch(/\(code_execution\)/);
    expect(hermesShellNote({ agent: { disabled_toolsets: ['terminal', 'code_execution'] } })).toBeNull();
    expect(hermesShellNote({ platform_toolsets: { acp: ['file', 'web'] } })).toBeNull();
    expect(hermesShellNote({ platform_toolsets: { acp: ['file', 'terminal'] } })).toMatch(/\(terminal\)/);
  });

  it('passes the agent its own environment, without the Studio\'s GitHub and sign-in secrets', () => {
    const env = agentEnv({ PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'a', GH_TOKEN: 'g', GITHUB_TOKEN: 'g', STUDIO_SESSION_SECRET: 's', UNSET: undefined }, { INITIAL_AGENT_MODE: 'read-only' });
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'a', INITIAL_AGENT_MODE: 'read-only' });
  });

  it('names the model from the session\'s model option, grouped or not', () => {
    expect(modelOf(null)).toBeNull();
    expect(modelOf([{ id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: 'ask', options: [] }])).toBeNull();
    expect(modelOf([{ id: 'm', name: 'Model', category: 'model', type: 'select', currentValue: 'opus', options: [{ value: 'opus', name: 'Opus 5.5' }] }])).toBe('Opus 5.5');
    expect(modelOf([{ id: 'm', name: 'Model', category: 'model', type: 'select', currentValue: 'b', options: [{ group: 'g', name: 'G', options: [{ value: 'b', name: 'Bee' }] }] }])).toBe('Bee');
    expect(modelOf([{ id: 'm', name: 'Model', category: 'model', type: 'select', currentValue: 'raw-id', options: [] }])).toBe('raw-id');
  });

  it('names the model a "default" choice stands for, or none, never "Default (recommended)"', () => {
    const choose = (description?: string) => modelOf([
      { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'default', options: [{ value: 'default', name: 'Default (recommended)', description }, { value: 'opus', name: 'Opus' }] },
    ]);
    expect(choose('Opus 4.7 (1M context)')).toBe('Opus 4.7 (1M context)');
    expect(choose(undefined)).toBeNull();
    expect(choose('  ')).toBeNull();
  });

  it('takes a session up again by resume first, then load, else not at all', () => {
    expect(resumeWay({ loadSession: true, sessionCapabilities: { resume: {} } })).toBe('resume');
    expect(resumeWay({ loadSession: true })).toBe('load');
    expect(resumeWay({ loadSession: false, sessionCapabilities: {} })).toBeNull();
    expect(resumeWay(undefined)).toBeNull();
  });

  it('drops "always" options, which would outlive the conversation', () => {
    expect(turnOptions([
      { optionId: 'a', name: 'Allow', kind: 'allow_once' },
      { optionId: 'b', name: 'Always', kind: 'allow_always' },
      { optionId: 'c', name: 'Reject', kind: 'reject_once' },
      { optionId: 'd', name: 'Never', kind: 'reject_always' },
    ]).map((option) => option.optionId)).toEqual(['a', 'c', 'd']);
  });
});
