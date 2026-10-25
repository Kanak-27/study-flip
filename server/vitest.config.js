import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false, // tests share one in-memory Mongo per file
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
