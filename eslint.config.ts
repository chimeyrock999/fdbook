import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['**/dist/**', '**/node_modules/**', '.claude/**']),
  {
    files: ['packages/{server,ui,shared,testing}/**/*.{ts,tsx}', '*.config.ts'],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Object types are written as `type` across the repo.
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
    },
  },
  // The code that came from the chimeyrock site, under that site's lighter
  // rules until it is brought up to the Studio's.
  {
    files: ['packages/{diagram,mdx}/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
    },
  },
  {
    files: ['packages/ui/src/**/*.tsx'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['packages/server/**/*.ts', 'packages/testing/**/*.ts', 'packages/*/tests/**/*.ts', '**/*.config.ts'],
    languageOptions: { globals: globals.node },
  },
]);
