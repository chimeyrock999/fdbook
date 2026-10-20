import { existsSync } from 'node:fs';

// Studio deps live in this package; shared @site code resolves zod and
// fumadocs-core from the repo root.
const missing = [
  ['../node_modules/vite', 'npm run studio:install'],
  ['../../../node_modules/zod', 'npm install'],
].filter(([path]) => !existsSync(new URL(path, import.meta.url)));

if (missing.length > 0) {
  const commands = missing.map(([, command]) => `\`${command}\``).join(' and ');
  console.error(`Notes Studio dependencies are not installed. Run ${commands} from the repo root.`);
  process.exit(1);
}

const { parseStudioPort } = await import('./config.ts');
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
