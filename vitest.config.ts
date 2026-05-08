import { defineConfig } from 'vitest/config';

// Standalone test config so we don't have to feed vitest's plain Node
// loader the mathjax `define` block (which depends on a JSON import that
// strict ESM rejects without `with { type: 'json' }`). Tests are
// pure-function / hook unit tests that never touch MathJax, so this
// minimal config is sufficient.
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: false,
  },
});
