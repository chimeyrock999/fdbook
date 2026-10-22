import { listenFailure, pagesProject, parseStaleDays, parseStudioHost, parseStudioPort, repoRoot, studioHome } from './config.ts';
import { installProblem } from './deps.ts';

// Each dependency must be installed as its package-lock.json pins: a pull
// without a reinstall shows up here, before anything runs on the old packages.
const problem = installProblem();
if (problem !== null) {
  console.error(problem);
  process.exit(1);
}

const { startStudioServer } = await import('./studio-server.ts');

try {
  const studio = await startStudioServer({
    host: parseStudioHost(process.env.STUDIO_HOST),
    port: parseStudioPort(process.env.STUDIO_PORT),
    changeRequests: { repo: repoRoot, home: studioHome(), pagesProject: pagesProject(), staleDays: parseStaleDays() },
  });
  console.log(`Notes Studio: ${studio.url}`);
} catch (error) {
  console.error(listenFailure(error as NodeJS.ErrnoException, process.env.STUDIO_HOST?.trim() ?? ''));
  process.exit(1);
}
