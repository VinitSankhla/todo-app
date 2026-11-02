import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Sandbox-only authorization test (npm run test:authz). Talks to real AWS, so it is kept out
// of `npm test` and CI. Credentials come from .env.local (git-ignored).
export default defineConfig({
  test: {
    include: ['integration/**/*.test.ts'],
    environment: 'node',
    env: loadEnv('test', process.cwd(), 'AUTHZ_'),
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
