import { listenFailure, pagesProject, parseStaleDays, parseStudioHost, parseStudioPort, repoRoot, studioHome } from './config.ts';
import { installProblem } from './deps.ts';
import { CALLBACK_PATH } from './auth/config.ts';

// Each dependency must be installed as its package-lock.json pins: a pull
// without a reinstall shows up here, before anything runs on the old packages.
const problem = installProblem();
if (problem !== null) {
  console.error(problem);
  process.exit(1);
}

const { startStudioServer } = await import('./studio-server.ts');
const { githubAuth } = await import('./auth/setup.ts');

try {
  const host = parseStudioHost(process.env.STUDIO_HOST);
  const port = parseStudioPort(process.env.STUDIO_PORT);
  const home = studioHome();
  const auth = githubAuth(host, port, repoRoot, home);
  const studio = await startStudioServer({
    host,
    port,
    changeRequests: { repo: repoRoot, home, pagesProject: pagesProject(), staleDays: parseStaleDays() },
    auth,
  });
  console.log(`Notes Studio: ${studio.url}`);
  console.log(`MCP server for agents: ${studio.url}api/mcp`);
  if (auth === null) console.log('Sign-in is off: anyone who can open this address can edit and publish.');
  else if (auth.config.flows.includes('web')) console.log(`GitHub sign-in: the OAuth App's callback URL must be ${studio.url}${CALLBACK_PATH.slice(1)}`);
} catch (error) {
  console.error(listenFailure(error as NodeJS.ErrnoException, process.env.STUDIO_HOST?.trim() ?? ''));
  process.exit(1);
}
