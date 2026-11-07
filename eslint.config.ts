import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  // note-text.ts needs @mdx-js/mdx and fumadocs-mdx, which only a site
  // installs, so tsconfig leaves it out and typed rules cannot read it.
  globalIgnores(['**/dist/**', '**/node_modules/**', '.claude/**', 'packages/diagram/src/site/note-text.ts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Object types are written as `type` across the repo.
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
    },
  },
  {
    files: ['packages/ui/src/**/*.tsx'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['packages/{server,testing,diagram}/**/*.ts', 'packages/*/tests/**/*.ts', '**/*.config.ts'],
    languageOptions: { globals: globals.node },
  },
]);
