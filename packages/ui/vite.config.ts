import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The UI's root, and the repository root: the workspace packages the UI
// imports (@fdbook/shared, diagram, mdx) and node_modules live under it.
const uiRoot = fileURLToPath(new URL('./', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
  root: uiRoot,
  plugins: [react(), tailwindcss()],
  resolve: {
    // Keep one React, and one lucide-react on it, even when a package
    // (@fdbook/mdx's components) resolves them from the repo root.
    dedupe: ['react', 'react-dom', 'lucide-react'],
  },
  server: {
    // Only what the Studio needs; the rest of the repo stays unreachable.
    fs: { allow: [uiRoot, `${repoRoot}packages/shared`, `${repoRoot}packages/diagram`, `${repoRoot}packages/mdx`, `${repoRoot}node_modules`] },
  },
});
