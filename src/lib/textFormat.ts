/**
 * Per-element text formatting overrides.
 *
 * Each chart can stamp every editable label with a stable `formatKey`.
 * The chart's `SavedConfig` then carries an optional
 * `formats: Record<formatKey, TextFormat>` table that overrides the
 * default font-size / weight / italic / line-height / alignment / colour
 * for that individual label, on top of the global "type-class" sizes
 * (titleSize, axisLabelSize, …) the chart already exposes.
 *
 * Resolution order, lowest to highest:
 *   1. hard-coded fallback (1.3 lh, 400 weight, 'left' align, '#1c1c1c').
 *   2. the chart-supplied default for that text's type-class.
 *   3. the per-element override stored in `formats[formatKey]`.
 */

export type TextAlign = 'left' | 'center' | 'right';

export interface TextFormat {
  /** Absolute font size in user-space px. Overrides the type-class default. */
  fontSize?: number;
  /** 100, 200, … 900. 700 = bold. */
  fontWeight?: number;
  /** Italic style. */
  italic?: boolean;
  /** Unitless line-height multiplier (1.0 — 2.0). */
  lineHeight?: number;
  /** Horizontal alignment of multi-line text. */
  align?: TextAlign;
  /** Hex colour (`#rrggbb`). */
  color?: string;
}

/** Map from formatKey → override. Always carries plain JSON. */
export type FormatStore = Record<string, TextFormat>;

export interface ResolvedTextFormat {
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  lineHeight: number;
  align: TextAlign;
  color: string;
}

export interface TextFormatDefaults {
  fontSize: number;
  fontWeight?: number;
  italic?: boolean;
  lineHeight?: number;
  align?: TextAlign;
  color?: string;
}

export function resolveTextFormat(
  defaults: TextFormatDefaults,
  override?: TextFormat,
): ResolvedTextFormat {
  return {
    fontSize: override?.fontSize ?? defaults.fontSize,
    fontWeight: override?.fontWeight ?? defaults.fontWeight ?? 400,
    italic: override?.italic ?? defaults.italic ?? false,
    lineHeight: override?.lineHeight ?? defaults.lineHeight ?? 1.3,
    align: override?.align ?? defaults.align ?? 'left',
    color: override?.color ?? defaults.color ?? '#1c1c1c',
  };
}

/**
 * Apply a partial override to `formats[key]`, returning a new store.
 * Drops the key entirely if every field has been cleared.
 */
export function patchFormat(
  store: FormatStore | undefined,
  key: string,
  patch: Partial<TextFormat>,
): FormatStore {
  const next: FormatStore = { ...(store ?? {}) };
  const current: TextFormat = { ...(next[key] ?? {}) };
  for (const k of Object.keys(patch) as (keyof TextFormat)[]) {
    const v = patch[k];
    if (v === undefined) {
      delete (current as Record<string, unknown>)[k];
    } else {
      // The cast is safe — TextFormat fields are unioned scalar types.
      (current as Record<string, unknown>)[k] = v;
    }
  }
  if (Object.keys(current).length === 0) {
    delete next[key];
  } else {
    next[key] = current;
  }
  return next;
}

/** Drop every override for `key`. */
export function clearFormat(
  store: FormatStore | undefined,
  key: string,
): FormatStore {
  if (!store || !(key in store)) return store ?? {};
  const next = { ...store };
  delete next[key];
  return next;
}

/** Reset every override (full wipe). */
export function clearAllFormats(): FormatStore {
  return {};
}
