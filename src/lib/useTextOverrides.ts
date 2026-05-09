/**
 * Generic text-style + position override store, used by evaluation
 * charts to give every visible piece of text in the preview a click-
 * to-select / drag-to-move / inspector-edit affordance — the same
 * direct-manipulation pattern that powers `gat-cmc-overall`'s panel
 * grid, but applied to evaluation-style figures (bars, radar,
 * heatmaps, lines, …) where the editable elements are titles,
 * captions, legend labels, axis labels and annotations rather than
 * full architectural panels.
 *
 * Each text element is identified by a stable string `id`. Overrides
 * are stored as a sparse `Record<id, TextOverride>`; entries with no
 * concrete fields are pruned from the map so that resetting an
 * override leaves no JSON noise behind in saved configs.
 *
 * Persistence is the caller's responsibility — the hook only exposes
 * the in-memory state and a `selectedId` cursor used by the
 * companion `<TextOverridePanel>` inspector section. Callers wire
 * the override map into their `SavedConfig` (and into `useAutoSave`)
 * just like any other piece of chart state.
 */
import { useCallback, useMemo, useState } from 'react';

/** Per-text style and position override. All fields optional — any
 *  field left undefined falls back to the call-site defaults. */
export interface TextOverride {
  /** Replace the visible text content. */
  text?: string;
  /** Override font size (px). */
  fontSize?: number;
  /** 400 / 600 / 700 etc. */
  fontWeight?: number;
  /** Italicise. */
  italic?: boolean;
  /** Hex color override. */
  color?: string;
  /** Horizontal offset relative to the baseline position (px). */
  dx?: number;
  /** Vertical offset relative to the baseline position (px). */
  dy?: number;
  /** Hide the text entirely. */
  hidden?: boolean;
}

export type TextOverrideMap = Record<string, TextOverride>;

export interface ResolvedTextStyle {
  text: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  color: string;
  dx: number;
  dy: number;
  hidden: boolean;
}

export interface TextDefaults {
  text: string;
  fontSize: number;
  fontWeight?: number;
  color?: string;
}

/**
 * Strip empty fields from an override so that resetting all controls
 * leaves an empty object that `setOverride` will then prune from the
 * map entirely.
 */
function pruneOverride(o: TextOverride): TextOverride {
  const next: TextOverride = { ...o };
  for (const k of Object.keys(next) as (keyof TextOverride)[]) {
    const v = next[k];
    if (v === undefined || v === '' || v === null) {
      delete next[k];
    }
  }
  return next;
}

export interface UseTextOverridesOptions {
  overrides: TextOverrideMap;
  setOverrides: (map: TextOverrideMap) => void;
}

export interface UseTextOverridesResult {
  overrides: TextOverrideMap;
  /** Patch the override for a single text id. Pass `null` to clear. */
  setOverride: (id: string, patch: Partial<TextOverride> | null) => void;
  /** Remove the override entirely. */
  clearOverride: (id: string) => void;
  /** Currently selected text element id, if any. */
  selectedId: string | null;
  selectText: (id: string | null) => void;
  /** Resolve a text element's effective style by merging defaults
   *  with any override. */
  resolve: (id: string, defaults: TextDefaults) => ResolvedTextStyle;
}

export function useTextOverrides(
  options: UseTextOverridesOptions,
): UseTextOverridesResult {
  const { overrides, setOverrides } = options;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const setOverride = useCallback(
    (id: string, patch: Partial<TextOverride> | null) => {
      const cur = overrides[id] ?? {};
      let next: TextOverride;
      if (patch === null) {
        next = {};
      } else {
        next = pruneOverride({ ...cur, ...patch });
      }
      const map = { ...overrides };
      if (Object.keys(next).length === 0) {
        delete map[id];
      } else {
        map[id] = next;
      }
      setOverrides(map);
    },
    [overrides, setOverrides],
  );

  const clearOverride = useCallback(
    (id: string) => {
      if (!(id in overrides)) return;
      const map = { ...overrides };
      delete map[id];
      setOverrides(map);
    },
    [overrides, setOverrides],
  );

  const selectText = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  const resolve = useCallback(
    (id: string, defaults: TextDefaults): ResolvedTextStyle => {
      const o = overrides[id] ?? {};
      return {
        text: o.text ?? defaults.text,
        fontSize: o.fontSize ?? defaults.fontSize,
        fontWeight: o.fontWeight ?? defaults.fontWeight ?? 400,
        italic: o.italic ?? false,
        color: o.color ?? defaults.color ?? 'currentColor',
        dx: o.dx ?? 0,
        dy: o.dy ?? 0,
        hidden: o.hidden ?? false,
      };
    },
    [overrides],
  );

  // Memoise so callers can rely on referential equality.
  return useMemo(
    () => ({
      overrides,
      setOverride,
      clearOverride,
      selectedId,
      selectText,
      resolve,
    }),
    [overrides, setOverride, clearOverride, selectedId, selectText, resolve],
  );
}
