/**
 * Pure-function unit tests for the helpers exported from useAutoSave.
 *
 * The React hook itself is exercised end-to-end by every chart that
 * mounts it, so we focus here on the deterministic, side-effect-free
 * primitives — the pieces most likely to silently regress as we evolve
 * the slot persistence model.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  evictOldestAutoSlots,
  findLatestSlot,
  touchSlot,
  type SlotMetaMap,
} from './useAutoSave';

const KEY = 'unit-test-key';

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
});

describe('findLatestSlot', () => {
  test('returns null when no slots exist', () => {
    expect(findLatestSlot(KEY, {})).toBeNull();
  });

  test('returns a non-null name when meta is missing', () => {
    // Without metadata we can't truly know "latest", but we should
    // still hand back *something* rather than throwing or returning
    // null. The exact key chosen is implementation-defined (currently
    // the first key encountered, since all ts default to 0), so we
    // only assert membership — not identity.
    const slots: Record<string, number> = { a: 1, b: 2 };
    const result = findLatestSlot(KEY, slots);
    expect(result).not.toBeNull();
    expect(Object.keys(slots)).toContain(result);
  });

  test('honours meta timestamps', () => {
    touchSlot(KEY, 'older');
    // touchSlot uses Date.now(), so wait a tick before stamping the
    // newer slot to guarantee a strictly larger timestamp.
    const meta: SlotMetaMap = JSON.parse(
      localStorage.getItem(KEY + ':meta') ?? '{}',
    );
    meta['newer'] = { ts: (meta['older']?.ts ?? 0) + 1000, auto: true };
    localStorage.setItem(KEY + ':meta', JSON.stringify(meta));
    expect(findLatestSlot(KEY, { older: 1, newer: 2 })).toBe('newer');
  });

  test('ignores meta entries that no longer have a slot', () => {
    touchSlot(KEY, 'orphan');
    expect(findLatestSlot(KEY, { kept: 1 })).toBe('kept');
  });
});

describe('touchSlot', () => {
  test('writes meta with a fresh timestamp and the auto flag', () => {
    const before = Date.now();
    touchSlot(KEY, 'auto-#1', { auto: true });
    const after = Date.now();
    const raw = localStorage.getItem(KEY + ':meta');
    expect(raw).not.toBeNull();
    const meta = JSON.parse(raw!) as SlotMetaMap;
    expect(meta['auto-#1']).toBeDefined();
    expect(meta['auto-#1'].auto).toBe(true);
    expect(meta['auto-#1'].ts).toBeGreaterThanOrEqual(before);
    expect(meta['auto-#1'].ts).toBeLessThanOrEqual(after);
  });

  test('does not nuke unrelated slot metadata', () => {
    touchSlot(KEY, 'manual-A');
    touchSlot(KEY, 'manual-B');
    const meta = JSON.parse(
      localStorage.getItem(KEY + ':meta')!,
    ) as SlotMetaMap;
    expect(Object.keys(meta).sort()).toEqual(['manual-A', 'manual-B']);
  });
});

describe('evictOldestAutoSlots', () => {
  test('returns identity when under the cap', () => {
    const slots = { 'auto-#1': 'a', 'auto-#2': 'b', manual: 'c' };
    const meta: SlotMetaMap = {
      'auto-#1': { ts: 100, auto: true },
      'auto-#2': { ts: 200, auto: true },
      manual: { ts: 50 },
    };
    const out = evictOldestAutoSlots(slots, meta, 5);
    expect(out.evicted).toEqual([]);
    expect(out.slots).toBe(slots);
    expect(out.meta).toBe(meta);
  });

  test('drops the oldest auto slots first', () => {
    const slots = {
      'auto-#1': 'a',
      'auto-#2': 'b',
      'auto-#3': 'c',
      'auto-#4': 'd',
    };
    const meta: SlotMetaMap = {
      'auto-#1': { ts: 100, auto: true },
      'auto-#2': { ts: 200, auto: true },
      'auto-#3': { ts: 300, auto: true },
      'auto-#4': { ts: 400, auto: true },
    };
    const out = evictOldestAutoSlots(slots, meta, 2);
    expect(out.evicted.sort()).toEqual(['auto-#1', 'auto-#2']);
    expect(Object.keys(out.slots).sort()).toEqual(['auto-#3', 'auto-#4']);
    expect(out.meta['auto-#1']).toBeUndefined();
    expect(out.meta['auto-#4']).toEqual({ ts: 400, auto: true });
  });

  test('never evicts manual slots, even if they outnumber max', () => {
    const slots = {
      'manual-A': 'a',
      'manual-B': 'b',
      'manual-C': 'c',
      'auto-#1': 'd',
      'auto-#2': 'e',
    };
    const meta: SlotMetaMap = {
      'auto-#1': { ts: 100, auto: true },
      'auto-#2': { ts: 200, auto: true },
    };
    const out = evictOldestAutoSlots(slots, meta, 1);
    expect(out.evicted).toEqual(['auto-#1']);
    expect(Object.keys(out.slots).sort()).toEqual([
      'auto-#2',
      'manual-A',
      'manual-B',
      'manual-C',
    ]);
  });

  test('falls back to numeric auto-# index when meta ts is missing', () => {
    // Charts saved before this hook landed have slots but no meta.
    // We still need a deterministic eviction order.
    const slots = {
      'auto-#1': 'a',
      'auto-#5': 'b',
      'auto-#10': 'c',
    };
    const meta: SlotMetaMap = {};
    const out = evictOldestAutoSlots(slots, meta, 1);
    expect(out.evicted.sort()).toEqual(['auto-#1', 'auto-#5']);
    expect(Object.keys(out.slots)).toEqual(['auto-#10']);
  });

  test('mixes timestamped and orphan slots: timestamped are older', () => {
    const slots = {
      'auto-#1': 'a',
      'auto-#2': 'b',
      'auto-#3': 'c',
    };
    const meta: SlotMetaMap = {
      // Only #1 has a timestamp — it should sort as oldest, then the
      // orphans by their numeric index.
      'auto-#1': { ts: 9999, auto: true },
    };
    const out = evictOldestAutoSlots(slots, meta, 2);
    expect(out.evicted).toEqual(['auto-#1']);
    expect(Object.keys(out.slots).sort()).toEqual(['auto-#2', 'auto-#3']);
  });
});
