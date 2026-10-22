import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * NestJS needs decorator metadata, which esbuild does not emit, so test files
 * are compiled with SWC. Unit tests live next to the code (src/**\/*.spec.ts);
 * end-to-end tests are in test/ and run against a real PostgreSQL database.
 */
const swcPlugin = swc.vite({
  module: { type: 'es6' },
  jsc: {
    target: 'es2022',
    parser: { syntax: 'typescript', decorators: true },
    transform: { legacyDecorator: true, decoratorMetadata: true },
  },
});

export default defineConfig({
  plugins: [swcPlugin],
  test: {
    globals: true,
    environment: 'node',
    projects: [
      {
        plugins: [swcPlugin],
        test: { name: 'unit', globals: true, include: ['src/**/*.spec.ts'] },
      },
      {
        plugins: [swcPlugin],
        test: {
          name: 'e2e',
          globals: true,
          include: ['test/**/*.e2e-spec.ts'],
          setupFiles: ['test/env.ts'],
          globalSetup: ['test/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
          // Test files share one database, so run them one at a time.
          fileParallelism: false,
        },
      },
    ],
  },
});
