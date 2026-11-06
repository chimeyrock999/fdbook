import { resolve } from 'node:path';
import { listenFailure, pagesProject, parseStaleDays, parseStudioHost, parseStudioPort, studioHome } from '#infra/config/config.ts';
import { installProblem } from '#infra/config/deps.ts';
import { CALLBACK_PATH } from '#services/auth/config.ts';
import { loadProject } from '#infra/config/project.ts';
import { setAreas } from '@fdbook/shared/asset-types.ts';

// Each dependency must be installed as its package-lock.json pins: a pull
// without a reinstall shows up here, before anything runs on the old packages.
const problem = installProblem();
if (problem !== null) {
  console.error(problem);
  process.exit(1);
}

// The project to edit: the folder given (`npm run studio -- <folder>`), from
// where npm was run; the areas are set before the rest of the server loads.
const project = await loadProject(resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[2] ?? '.')).catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
setAreas(project.areas);

const { startStudioServer } = await import('#app/studio-server.ts');
const { githubAuth } = await import('#services/auth/setup.ts');

try {
  const host = parseStudioHost(process.env.STUDIO_HOST);
  const port = parseStudioPort(process.env.STUDIO_PORT);
  const home = studioHome();
  const auth = githubAuth(host, port, project.repo, home);
  const studio = await startStudioServer({
    host,
    port,
    changeRequests: { repo: project.repo, home, pagesProject: pagesProject(), staleDays: parseStaleDays() },
    auth,
  });
  console.log(`Notes Studio: ${studio.url} (${project.areas.notes})`);
  console.log(`MCP server for agents: ${studio.url}api/mcp`);
  if (auth === null) console.log('Sign-in is off: anyone who can open this address can edit and publish.');
  else if (auth.config.flows.includes('web')) console.log(`GitHub sign-in: the OAuth App's callback URL must be ${studio.url}${CALLBACK_PATH.slice(1)}`);
} catch (error) {
  console.error(listenFailure(error as NodeJS.ErrnoException, process.env.STUDIO_HOST?.trim() ?? ''));
  process.exit(1);
}
