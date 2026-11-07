import { defineConfig } from 'vitest/config';

// One project per package, each run from its own folder. Every run first
// checks the install (@fdbook/testing's global setup); the UI's tests add
// the jsdom setup, and the packages that render React use the UI's Vite
// config (React, Tailwind, one copy of React).
const setup = { globalSetup: ['../testing/src/global-setup.ts'] };
const ui = './packages/ui/vite.config.ts';

export default defineConfig({
  test: {
    projects: [
      { extends: ui, root: './packages/ui', test: { name: 'ui', ...setup, setupFiles: ['./tests/setup/jsdom.ts'] } },
      { extends: ui, root: './packages/server', test: { name: 'server', ...setup } },
      { root: './packages/diagram', test: { name: 'diagram', ...setup } },
      { root: './packages/shared', test: { name: 'shared', ...setup } },
    ],
  },
});
