import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: true,
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/modules/auth/**',
        'src/modules/teams/**',
        'src/middleware/**',
        'src/lib/errors.ts',
        'src/lib/logger.ts',
      ],
      reporter: ['text', 'json', 'html'],
      thresholds: { lines: 85, functions: 85, statements: 85, branches: 80 },
    },
  },
  resolve: {
    alias: {
      '@pulse/shared-types': path.resolve(__dirname, '../../packages/shared-types/src/index.ts'),
    },
  },
});