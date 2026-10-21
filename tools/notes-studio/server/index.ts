import { parseStudioPort, repoRoot, studioRoot } from './config.ts';
import { driftedPackages } from './deps.ts';

// Studio deps live in this package; shared @site code resolves zod and
// fumadocs-core from the repo root. Each must be installed as its
// package-lock.json pins: a pull without a reinstall shows up here, before
// anything runs on the old packages.
const problems = [
  { dir: repoRoot, command: 'npm install' },
  { dir: studioRoot, command: 'npm run studio:install' },
].flatMap(({ dir, command }) => {
  const drifted = driftedPackages(dir);
  return drifted.length > 0 ? [{ drifted, command }] : [];
});

if (problems.length > 0) {
  const commands = problems.map(({ command }) => `\`${command}\``).join(' and ');
  const packages = problems.flatMap(({ drifted }) => drifted).join(', ');
  console.error(`Notes Studio dependencies do not match the lockfiles: ${packages}. Run ${commands} from the repo root.`);
  process.exit(1);
}

const { startStudioServer } = await import('./studio-server.ts');

try {
  const studio = await startStudioServer({ port: parseStudioPort(process.env.STUDIO_PORT) });
  console.log(`Notes Studio: ${studio.url}`);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error('The Notes Studio port is already in use. Stop the other process or set STUDIO_PORT.');
  } else {
    console.error((error as Error).message);
  }
  process.exit(1);
}
