import { pagesProject, parseStudioPort, repoRoot, studioHome } from './config.ts';
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
    port: parseStudioPort(process.env.STUDIO_PORT),
    changeRequests: { repo: repoRoot, home: studioHome(), pagesProject: pagesProject() },
  });
  console.log(`Notes Studio: ${studio.url}`);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error('The Notes Studio port is already in use. Stop the other process or set STUDIO_PORT.');
  } else {
    console.error((error as Error).message);
  }
  process.exit(1);
}
