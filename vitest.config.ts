import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['ingest/**/*.test.ts', 'web/src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      include: ['ingest/**/*.ts', 'web/src/**/*.ts', 'web/src/**/*.tsx'],
      exclude: ['**/*.test.ts', 'web/src/main.tsx'],
      reporter: ['text', 'html'],
    },
  },
});
