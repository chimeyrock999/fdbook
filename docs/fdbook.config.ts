import { defineConfig } from '@fdbook/studio/config';

// FdBook's own docs, which the Studio's tests also run on.
export default defineConfig({
  root: 'content/docs',
  media: 'public/docs',
  diagrams: 'diagrams',
  baseUrl: '/docs',
});
