/**
 * Generic auto-save / auto-load helper for chart configurations.
 *
 * Behaviour:
 *   - Every `intervalMs` (default 5 min), the current state is compared
 *     against the last persisted snapshot. If different, a new slot is
 *     created with an auto-generated name like `auto-#3 (2026-04-28 02:02)`
 *     and persisted alongside any user-defined slots.
 *   - On chart mount, if `autoLoadLatest` is enabled and `slots` already
 *     contains entries, the most recently saved slot (auto or manual) is
 *     applied via `applyConfig`.
 *   - When the number of `auto-#…` slots exceeds `maxAutoSlots` (default
 *     20), the oldest auto slot is evicted to keep localStorage from
 *     growing unbounded. Manual (non-`auto-#`) slots are never evicted.
 *
 * Slots are stored as a `Record<slotName, ConfigT>` in localStorage under
 * `storageKey`. A small companion record `<storageKey>:meta` tracks per-
 * slot timestamps used for "latest" resolution.
 */

import { useEffect, useRef } from 'react';

export interface SlotMeta {
  /** Epoch ms when this slot was last saved or loaded. */
  ts: number;
  /** True when slot was created by the auto-save loop. */
  auto?: boolean;
}

export type SlotMetaMap = Record<string, SlotMeta>;

export interface UseAutoSaveOptions<ConfigT> {
  /** Stable id for this chart, used to namespace metadata. */
  storageKey: string;
  /** Current config snapshot — must be JSON-serialisable. */
  current: ConfigT;
  /** Existing slot map (managed by the chart). */
  slots: Record<string, ConfigT>;
  /** Setter that persists a new slot map (manual + auto entries). */
  onPersistSlots: (next: Record<string, ConfigT>) => void;
  /** Apply a config snapshot to chart state. Used for auto-load. */
  applyConfig: (cfg: ConfigT) => void;
  /** Auto-save interval in ms; default 5 minutes. */
  intervalMs?: number;
  /** Auto-load the latest slot on mount. Default true. */
  autoLoadLatest?: boolean;
  /** Disable the entire hook (handy for tests / SSR). */
  enabled?: boolean;
  /**
   * Maximum number of `auto-#…` slots to retain. Once exceeded, the
   * oldest auto slot (by meta timestamp, falling back to lexicographic
   * ordering of the slot name) is evicted. Manual slots are never
   * touched. Defaults to 20.
   */
  maxAutoSlots?: number;
}

const META_SUFFIX = ':meta';
const DEFAULT_MAX_AUTO_SLOTS = 20;
/** Pattern that identifies auto-generated slot names. */
const AUTO_SLOT_RE = /^auto-#(\d+)/;

function readMeta(storageKey: string): SlotMetaMap {
  try {
    const raw = localStorage.getItem(storageKey + META_SUFFIX);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SlotMetaMap;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function writeMeta(storageKey: string, meta: SlotMetaMap) {
  try {
    localStorage.setItem(storageKey + META_SUFFIX, JSON.stringify(meta));
  } catch {
    // quota / unavailable — silent no-op
  }
}

function pad(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

function formatTimestamp(d: Date): string {
  const Y = d.getFullYear();
  const M = pad(d.getMonth() + 1);
  const D = pad(d.getDate());
  const h = pad(d.getHours());
  const m = pad(d.getMinutes());
  return `${Y}-${M}-${D} ${h}:${m}`;
}

function nextAutoIndex(slots: Record<string, unknown>): number {
  let maxIdx = 0;
  for (const name of Object.keys(slots)) {
    const m = name.match(AUTO_SLOT_RE);
    if (m) {
      const n = Number(m[1]);
      if (n > maxIdx) maxIdx = n;
    }
  }
  return maxIdx + 1;
}

/**
 * Drop the oldest `auto-#…` slots so at most `max` remain. Returns a
 * (possibly identical) slots map and meta map. Ordering uses the meta
 * timestamp first, then falls back to sorting auto slot names by their
 * `#N` index so meta-less environments still behave deterministically.
 * Manual slots (those not matching `AUTO_SLOT_RE`) are preserved in
 * place even when they outnumber `max`.
 */
export function evictOldestAutoSlots<ConfigT>(
  slots: Record<string, ConfigT>,
  meta: SlotMetaMap,
  max: number,
): { slots: Record<string, ConfigT>; meta: SlotMetaMap; evicted: string[] } {
  const autoNames = Object.keys(slots).filter((n) => AUTO_SLOT_RE.test(n));
  if (autoNames.length <= max) {
    return { slots, meta, evicted: [] };
  }
  // Sort oldest → newest. Smaller ts = older. When ts is missing
  // (legacy slot), treat the auto-# index as a proxy for age.
  autoNames.sort((a, b) => {
    const ta = meta[a]?.ts;
    const tb = meta[b]?.ts;
    if (typeof ta === 'number' && typeof tb === 'number') return ta - tb;
    if (typeof ta === 'number') return -1; // a older than b
    if (typeof tb === 'number') return 1;
    const ai = Number(a.match(AUTO_SLOT_RE)?.[1] ?? 0);
    const bi = Number(b.match(AUTO_SLOT_RE)?.[1] ?? 0);
    return ai - bi;
  });
  const dropCount = autoNames.length - max;
  const toDrop = autoNames.slice(0, dropCount);
  if (toDrop.length === 0) {
    return { slots, meta, evicted: [] };
  }
  const nextSlots: Record<string, ConfigT> = { ...slots };
  const nextMeta: SlotMetaMap = { ...meta };
  for (const name of toDrop) {
    delete nextSlots[name];
    delete nextMeta[name];
  }
  return { slots: nextSlots, meta: nextMeta, evicted: toDrop };
}

/** Stable JSON stringify that ignores key order for top-level objects. */
function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map(
        (k) =>
          JSON.stringify(k) +
          ':' +
          stableStringify((obj as Record<string, unknown>)[k]),
      )
      .join(',') +
    '}'
  );
}

/**
 * Find the most recent slot using the meta table. Falls back to the most
 * recently-listed key in `slots` if no metadata exists (for back-compat
 * with charts that pre-date this hook).
 */
export function findLatestSlot<ConfigT>(
  storageKey: string,
  slots: Record<string, ConfigT>,
): string | null {
  const names = Object.keys(slots);
  if (names.length === 0) return null;
  const meta = readMeta(storageKey);
  let bestName: string | null = null;
  let bestTs = -1;
  for (const name of names) {
    const ts = meta[name]?.ts ?? 0;
    if (ts > bestTs) {
      bestTs = ts;
      bestName = name;
    }
  }
  return bestName ?? names[names.length - 1];
}

/** Touch the timestamp on a slot so it counts as "most recent". */
export function touchSlot(
  storageKey: string,
  name: string,
  opts?: { auto?: boolean },
) {
  const meta = readMeta(storageKey);
  meta[name] = { ts: Date.now(), auto: opts?.auto };
  writeMeta(storageKey, meta);
}

export function useAutoSave<ConfigT>(opts: UseAutoSaveOptions<ConfigT>) {
  const {
    storageKey,
    current,
    slots,
    onPersistSlots,
    applyConfig,
    intervalMs = 5 * 60 * 1000,
    autoLoadLatest = true,
    enabled = true,
    maxAutoSlots = DEFAULT_MAX_AUTO_SLOTS,
  } = opts;

  // Refs keep the loop in sync with the latest state without retriggering
  // on every keystroke.
  const currentRef = useRef(current);
  const slotsRef = useRef(slots);
  const onPersistRef = useRef(onPersistSlots);
  const lastSavedSnapshotRef = useRef<string | null>(null);
  const didAutoLoadRef = useRef(false);

  useEffect(() => {
    currentRef.current = current;
  }, [current]);
  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);
  useEffect(() => {
    onPersistRef.current = onPersistSlots;
  }, [onPersistSlots]);

  // Auto-load latest slot once on mount.
  useEffect(() => {
    if (!enabled || !autoLoadLatest || didAutoLoadRef.current) return;
    didAutoLoadRef.current = true;
    const latest = findLatestSlot(storageKey, slotsRef.current);
    if (latest && slotsRef.current[latest]) {
      applyConfig(slotsRef.current[latest]);
      // Don't bump timestamp here — auto-load shouldn't promote a slot
      // ahead of a slot the user just saved.
      // Snapshot *after* apply settles (next tick) so we don't immediately
      // re-save what we just loaded.
      Promise.resolve().then(() => {
        lastSavedSnapshotRef.current = stableStringify(currentRef.current);
      });
    } else {
      lastSavedSnapshotRef.current = stableStringify(currentRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, autoLoadLatest, storageKey]);

  // Periodic diff-and-save loop.
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      const snap = stableStringify(currentRef.current);
      if (snap === lastSavedSnapshotRef.current) return;
      const idx = nextAutoIndex(slotsRef.current);
      const ts = formatTimestamp(new Date());
      const name = `auto-#${idx} (${ts})`;
      // Stamp the new slot's metadata first so eviction sees it as the
      // newest entry (and never accidentally drops it on the same tick).
      touchSlot(storageKey, name, { auto: true });
      const proposed = { ...slotsRef.current, [name]: currentRef.current };
      const meta = readMeta(storageKey);
      const { slots: pruned, meta: prunedMeta } = evictOldestAutoSlots(
        proposed,
        meta,
        maxAutoSlots,
      );
      writeMeta(storageKey, prunedMeta);
      onPersistRef.current(pruned);
      lastSavedSnapshotRef.current = snap;
    };
    const handle = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(handle);
  }, [enabled, intervalMs, storageKey, maxAutoSlots]);
}
