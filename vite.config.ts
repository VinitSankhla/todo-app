import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// https://vite.dev/config/  and  https://vitest.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // The sandbox authorization test talks to real AWS, so it is run separately (npm run test:authz).
    exclude: ['node_modules', 'dist', 'scripts/**', '.amplify/**'],
    restoreMocks: true,
  },
});
