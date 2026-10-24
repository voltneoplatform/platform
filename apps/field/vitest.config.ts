import { defineConfig } from 'vitest/config';

// Plain TypeScript modules only (wording, formatting, the API client); screens
// are checked by the type checker and the walkthrough.
export default defineConfig({ test: { include: ['src/**/*.test.ts'], environment: 'node' } });
