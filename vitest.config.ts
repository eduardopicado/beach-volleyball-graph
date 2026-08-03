import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['ingest/**/*.test.ts', 'web/src/**/*.test.ts'],
    environment: 'node',
  },
});
