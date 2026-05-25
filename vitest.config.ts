import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/browser/**'],
    testTimeout: 10_000,
    // Expose vi as global `jest` for jest-mock-vscode compatibility
    globals: true,
    setupFiles: ['test/setup.ts'],
  },
});
