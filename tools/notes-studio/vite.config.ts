import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const studioRoot = fileURLToPath(new URL('./', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Where "Open on site" points (src/notes/OpenOnSite.tsx); empty means the
  // site's dev server on localhost:3000.
  define: { 'import.meta.env.STUDIO_SITE_URL': JSON.stringify(process.env.STUDIO_SITE_URL ?? '') },
  resolve: {
    // Shared code from the site (e.g. lib/notes-schema.ts). Its own imports
    // (zod, fumadocs-core) resolve from the repo root node_modules.
    alias: { '@site': repoRoot },
    // Keep one React even when shared code resolves it from the repo root.
    dedupe: ['react', 'react-dom'],
  },
  server: {
    // Only what the Studio needs; the rest of the repo stays unreachable.
    fs: { allow: [studioRoot, `${repoRoot}lib`, `${repoRoot}node_modules`] },
  },
});
