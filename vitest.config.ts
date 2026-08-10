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
    include: ['scripts/**/*.test.ts'],
    environment: 'node',
  },
});
