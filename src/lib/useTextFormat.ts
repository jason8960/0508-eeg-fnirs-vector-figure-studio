/**
 * Hook bundling the per-element text-format selection state + patch/reset
 * helpers shared by all editable charts. Returns:
 *   - `selected`: the currently-selected text anchor (or null).
 *   - `handleSelectText` / `handleClearSelection`: select / deselect helpers.
 *   - `patchFormat(key, patch)`: apply a partial override.
 *   - `resetElementFormat(key)`: clear the override for one key.
 *   - `resetAllFormats()`: full wipe + deselect.
 *
 * The hook is config-shape agnostic — it operates on a `SavedConfig`-like
 * object that has an optional `formats?: FormatStore` field.
 */
import { useCallback, useState } from 'react';
import {
  clearAllFormats,
  clearFormat,
  patchFormat as libPatchFormat,
  type FormatStore,
  type TextFormat,
} from './textFormat';
import type { SelectedTextAnchor } from '../components/EditableForeignText';

export interface FormatHostConfig {
  formats?: FormatStore;
}

export interface UseTextFormatResult {
  selected: SelectedTextAnchor | null;
  handleSelectText: (anchor: SelectedTextAnchor) => void;
  handleClearSelection: () => void;
  patchFormat: (key: string, patch: Partial<TextFormat>) => void;
  resetElementFormat: (key: string) => void;
  resetAllFormats: () => void;
}

export function useTextFormat<C extends FormatHostConfig>(
  setCfg: (updater: (prev: C) => C) => void,
): UseTextFormatResult {
  const [selected, setSelected] = useState<SelectedTextAnchor | null>(null);

  const handleSelectText = useCallback((anchor: SelectedTextAnchor) => {
    setSelected(anchor);
  }, []);
  const handleClearSelection = useCallback(() => setSelected(null), []);

  const patchFormat = useCallback(
    (key: string, patch: Partial<TextFormat>) => {
      setCfg((prev) => ({
        ...prev,
        formats: libPatchFormat(prev.formats, key, patch),
      }));
    },
    [setCfg],
  );

  const resetElementFormat = useCallback(
    (key: string) => {
      setCfg((prev) => ({
        ...prev,
        formats: clearFormat(prev.formats, key),
      }));
    },
    [setCfg],
  );

  const resetAllFormats = useCallback(() => {
    setCfg((prev) => ({ ...prev, formats: clearAllFormats() }));
    setSelected(null);
  }, [setCfg]);

  return {
    selected,
    handleSelectText,
    handleClearSelection,
    patchFormat,
    resetElementFormat,
    resetAllFormats,
  };
}
