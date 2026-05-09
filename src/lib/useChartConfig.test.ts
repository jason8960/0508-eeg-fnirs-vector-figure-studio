/**
 * Pure-function tests for `migrateLegacyStorageKey`. The React hook
 * itself is exercised end-to-end by every chart that mounts it; we
 * focus here on the deterministic localStorage migration shim that
 * runs once per chart on first load.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { migrateLegacyStorageKey } from './useChartConfig';

const NEW = 'demo-chart-configs-v1';
const STEM = 'demo-chart';
const LEGACY_SAVED = `${STEM}-saved-configs-v1`;
const LEGACY_SLOTS = `chart:${STEM}:slots`;
const SENTINEL = `${NEW}:migrated-from`;

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
});

describe('migrateLegacyStorageKey', () => {
  test('no-op when no legacy keys exist', () => {
    migrateLegacyStorageKey(NEW);
    expect(localStorage.getItem(NEW)).toBeNull();
    expect(localStorage.getItem(SENTINEL)).toBeNull();
  });

  test('copies "<stem>-saved-configs-v1" payload + meta into new key', () => {
    const payload = JSON.stringify({ slot1: { version: 1, foo: 42 } });
    const meta = JSON.stringify({ slot1: { ts: 1234, auto: false } });
    localStorage.setItem(LEGACY_SAVED, payload);
    localStorage.setItem(`${LEGACY_SAVED}:meta`, meta);

    migrateLegacyStorageKey(NEW);

    expect(localStorage.getItem(NEW)).toBe(payload);
    expect(localStorage.getItem(`${NEW}:meta`)).toBe(meta);
    expect(localStorage.getItem(SENTINEL)).toBe(LEGACY_SAVED);
    // Legacy key is left intact (read-only) so older builds keep working.
    expect(localStorage.getItem(LEGACY_SAVED)).toBe(payload);
  });

  test('copies "chart:<stem>:slots" payload into new key', () => {
    const payload = JSON.stringify({ a: { version: 1 } });
    localStorage.setItem(LEGACY_SLOTS, payload);

    migrateLegacyStorageKey(NEW);

    expect(localStorage.getItem(NEW)).toBe(payload);
    expect(localStorage.getItem(SENTINEL)).toBe(LEGACY_SLOTS);
  });

  test('prefers "<stem>-saved-configs-v1" over "chart:<stem>:slots" when both exist', () => {
    localStorage.setItem(LEGACY_SAVED, JSON.stringify({ winner: { v: 1 } }));
    localStorage.setItem(LEGACY_SLOTS, JSON.stringify({ loser: { v: 1 } }));

    migrateLegacyStorageKey(NEW);

    const migrated = JSON.parse(localStorage.getItem(NEW) ?? '{}');
    expect(Object.keys(migrated)).toContain('winner');
    expect(Object.keys(migrated)).not.toContain('loser');
    expect(localStorage.getItem(SENTINEL)).toBe(LEGACY_SAVED);
  });

  test('skips migration when new key already has data', () => {
    const userData = JSON.stringify({ user: { v: 1 } });
    localStorage.setItem(NEW, userData);
    localStorage.setItem(LEGACY_SAVED, JSON.stringify({ legacy: { v: 1 } }));

    migrateLegacyStorageKey(NEW);

    expect(localStorage.getItem(NEW)).toBe(userData);
    expect(localStorage.getItem(SENTINEL)).toBeNull();
  });

  test('runs at most once even with multiple invocations', () => {
    localStorage.setItem(LEGACY_SAVED, JSON.stringify({ a: 1 }));
    migrateLegacyStorageKey(NEW);
    // User saves something new under the canonical key.
    const fresh = JSON.stringify({ b: 2 });
    localStorage.setItem(NEW, fresh);
    // Even if a second mount triggers migration it must not clobber.
    migrateLegacyStorageKey(NEW);
    expect(localStorage.getItem(NEW)).toBe(fresh);
  });

  test('ignores legacy keys whose payload is not a JSON object', () => {
    localStorage.setItem(LEGACY_SAVED, 'not json at all');
    migrateLegacyStorageKey(NEW);
    expect(localStorage.getItem(NEW)).toBeNull();
    expect(localStorage.getItem(SENTINEL)).toBeNull();
  });

  test('storage key without "-configs-v1" suffix only checks "chart:<stem>:slots"', () => {
    // Stem is the entire key when the suffix replace fails.
    const oddKey = 'unusual-storage-key';
    localStorage.setItem(`chart:${oddKey}:slots`, JSON.stringify({ x: 1 }));
    migrateLegacyStorageKey(oddKey);
    expect(localStorage.getItem(oddKey)).not.toBeNull();
  });
});
