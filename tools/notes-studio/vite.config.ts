import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const studioRoot = fileURLToPath(new URL('./', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Shared code from the site (e.g. lib/notes-schema.ts). Its own imports
    // (zod, fumadocs-core) resolve from the repo root node_modules, and `@/`
    // is the site's own alias for the repo root (components/*.tsx use it).
    alias: { '@site': repoRoot, '@/': repoRoot },
    // Keep one React, and one lucide-react on it, even when shared code
    // (components/*.tsx) resolves them from the repo root.
    dedupe: ['react', 'react-dom', 'lucide-react'],
  },
  server: {
    // Only what the Studio needs; the rest of the repo stays unreachable.
    fs: { allow: [studioRoot, `${repoRoot}lib`, `${repoRoot}components`, `${repoRoot}styles`, `${repoRoot}node_modules`] },
  },
});
