import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(viteConfig, defineConfig({ test: { globalSetup: ['./tests/global-setup.ts'], setupFiles: ['./tests/setup/jsdom.ts'] } }));
