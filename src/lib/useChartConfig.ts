/**
 * Boilerplate-eliminating wrapper around the
 * `loadStoredConfigs` / `persistConfigs` / `useAutoSave` /
 * `<ConfigManager>` quartet that every chart with persistent
 * configurations replicates.
 *
 * Charts call this once per chart with:
 *   - a stable `storageKey` (`'<chart-id>-configs-v1'`)
 *   - `buildCurrentConfig` that gathers their state into a JSON-able
 *     `SavedConfig`
 *   - `applyConfig` that pushes a `SavedConfig` back into their state
 *
 * In return they get back a fully wired-up `<ConfigManager>` props
 * bundle — ready to spread into the inspector — plus the
 * `useAutoSave` hook is fired internally so the 5-min auto-save loop
 * runs without further wiring.
 */
import { useCallback, useState } from 'react';
import { touchSlot, useAutoSave } from './useAutoSave';

export interface UseChartConfigOptions<T> {
  /** Stable id, e.g. `'method-radar-configs-v1'`. */
  storageKey: string;
  /** Latest snapshot of chart state. Recomputed every render. */
  buildCurrentConfig: () => T;
  /** Apply a snapshot back to chart state. */
  applyConfig: (cfg: T) => void;
  /** Auto-save interval (ms). Defaults to 5 minutes. */
  intervalMs?: number;
  /** Auto-load latest slot on mount. Defaults to true. */
  autoLoadLatest?: boolean;
}

export interface UseChartConfigResult<T> {
  savedConfigs: Record<string, T>;
  /** Bundle of props ready to spread into `<ConfigManager>`. */
  configManagerProps: {
    savedConfigs: Record<string, T>;
    buildCurrentConfig: () => T;
    applyConfig: (cfg: T) => void;
    saveConfigToSlot: (name: string) => void;
    deleteConfigSlot: (name: string) => void;
  };
}

function loadStoredConfigs<T>(storageKey: string): Record<string, T> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, T>;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function persistConfigs<T>(storageKey: string, slots: Record<string, T>) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(slots));
  } catch {
    // quota / unavailable
  }
}

export function useChartConfig<T>(
  options: UseChartConfigOptions<T>,
): UseChartConfigResult<T> {
  const { storageKey, buildCurrentConfig, applyConfig, intervalMs, autoLoadLatest } =
    options;

  const [savedConfigs, setSavedConfigs] = useState<Record<string, T>>(() =>
    loadStoredConfigs<T>(storageKey),
  );

  const persistAndSet = useCallback(
    (next: Record<string, T>) => {
      setSavedConfigs(next);
      persistConfigs<T>(storageKey, next);
    },
    [storageKey],
  );

  const saveConfigToSlot = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const cfg = buildCurrentConfig();
      setSavedConfigs((prev) => {
        const next = { ...prev, [trimmed]: cfg };
        persistConfigs<T>(storageKey, next);
        return next;
      });
      touchSlot(storageKey, trimmed);
    },
    [buildCurrentConfig, storageKey],
  );

  const deleteConfigSlot = useCallback(
    (name: string) => {
      setSavedConfigs((prev) => {
        if (!(name in prev)) return prev;
        const rest = { ...prev };
        delete rest[name];
        persistConfigs<T>(storageKey, rest);
        return rest;
      });
    },
    [storageKey],
  );

  // Drive the 5-min auto-save loop.
  useAutoSave<T>({
    storageKey,
    current: buildCurrentConfig(),
    slots: savedConfigs,
    onPersistSlots: persistAndSet,
    applyConfig,
    intervalMs,
    autoLoadLatest,
  });

  return {
    savedConfigs,
    configManagerProps: {
      savedConfigs,
      buildCurrentConfig,
      applyConfig,
      saveConfigToSlot,
      deleteConfigSlot,
    },
  };
}
