import { defineConfig } from 'vitest/config';

/**
 * Unit tests only — nothing here touches Postgres, MySQL or Redis.
 *
 * The migration engine's decision logic (table status, resume, validation) is
 * deliberately kept in pure modules so it can be tested without infrastructure.
 * Integration tests that need real databases are a separate, opt-in concern.
 */
export default defineConfig({
  test: {
    // src is included for PURE frontend logic only — reducers and helpers with
    // no DOM. Component tests would need jsdom and a different environment;
    // that is why the pipeline animation rule lives in a plain module rather
    // than inside the component that renders it.
    include: ['scripts/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
