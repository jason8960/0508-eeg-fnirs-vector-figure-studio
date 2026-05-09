/**
 * Higher-level helper that bundles together the auto-save loop, the
 * persisted config slot map, and a `useTextOverrides` text-style
 * store for the evaluation-category charts.
 *
 * Returns a single `ctx` object plus a pre-rendered
 * `<TextEditingSection>` component that can be dropped into the
 * inspector's `ControlGroup label="文字编辑">`. Charts only need to:
 *
 *   1. Define their own `SavedConfig` type that includes
 *      `textOverrides?: TextOverrideMap`.
 *   2. Implement `buildBaseConfig()` (without textOverrides) and
 *      `applyBaseConfig(cfg)`.
 *   3. Pass `selectedTextLabels` describing each editable text id.
 *   4. Render their `<FigureFrame>` with `titleOverride` /
 *      `captionOverride` / `onSelectTitle` / `onSelectCaption` /
 *      `titleSelected` / `captionSelected` from `ctx`.
 *
 * Auto-save runs at 5-minute intervals out of the box; only-on-
 * change is enforced by the underlying `useAutoSave` (it diffs the
 * stringified snapshot against the latest persisted slot).
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ConfigManager } from '../components/ConfigManager';
import { ControlGroup } from '../components/Controls';
import { TextOverridePanel } from '../components/TextOverridePanel';
import { useChartConfig } from './useChartConfig';
import {
  useTextOverrides,
  type TextOverride,
  type TextOverrideMap,
  type UseTextOverridesResult,
} from './useTextOverrides';

export interface EvalConfigBase {
  textOverrides?: TextOverrideMap;
}

export interface UseEvalChartConfigOptions<TBase> {
  storageKey: string;
  /** Build the chart's config WITHOUT `textOverrides` (we splice it
   *  in from the override store automatically). */
  buildBaseConfig: () => TBase;
  /** Apply a config to chart state (excluding textOverrides). */
  applyBaseConfig: (cfg: TBase) => void;
  /** Stable filename used for the JSON download / import. */
  filename: string;
}

export interface EvalChartTextRef {
  id: string;
  label: string;
  defaultText: string;
  defaultFontSize?: number;
  defaultFontWeight?: number;
  defaultColor?: string;
}

export interface UseEvalChartConfigResult {
  /** The full text-overrides hook result (resolve / setOverride / …). */
  textOverrides: UseTextOverridesResult;
  /** Render-prop for the inspector subsection that contains both the
   *  text-editing panel and the config manager. */
  renderInspectorSections: (
    refs: ReadonlyArray<EvalChartTextRef>,
  ) => ReactNode;
}

export function useEvalChartConfig<TBase extends EvalConfigBase>(
  options: UseEvalChartConfigOptions<TBase>,
): UseEvalChartConfigResult {
  const { storageKey, buildBaseConfig, applyBaseConfig, filename } = options;

  const [overrides, setOverridesState] = useState<TextOverrideMap>({});
  const setOverridesMap = useCallback((m: TextOverrideMap) => {
    setOverridesState(m);
  }, []);
  const overridesHook = useTextOverrides({
    overrides,
    setOverrides: setOverridesMap,
  });

  const buildCurrentConfig = useCallback((): TBase => {
    const base = buildBaseConfig();
    return { ...base, textOverrides: overrides };
  }, [buildBaseConfig, overrides]);

  const applyConfig = useCallback(
    (cfg: TBase) => {
      applyBaseConfig(cfg);
      setOverridesState(cfg.textOverrides ?? {});
    },
    [applyBaseConfig],
  );

  const { configManagerProps } = useChartConfig<TBase>({
    storageKey,
    buildCurrentConfig,
    applyConfig,
  });

  const renderInspectorSections = useCallback(
    (refs: ReadonlyArray<EvalChartTextRef>) => {
      const selectedRef =
        refs.find((r) => r.id === overridesHook.selectedId) ?? null;
      const resolved =
        selectedRef !== null
          ? overridesHook.resolve(selectedRef.id, {
              text: selectedRef.defaultText,
              fontSize: selectedRef.defaultFontSize ?? 12,
              fontWeight: selectedRef.defaultFontWeight,
              color: selectedRef.defaultColor,
            })
          : null;
      return (
        <>
          <ControlGroup
            label="文字编辑"
            description="点击预览图中的标题、图例、轴或注释文字进行选中并编辑。"
          >
            <TextOverridePanel
              selectedId={overridesHook.selectedId}
              selectedLabel={selectedRef?.label ?? null}
              resolved={resolved}
              setOverride={(patch: Partial<TextOverride> | null) =>
                overridesHook.selectedId
                  ? overridesHook.setOverride(overridesHook.selectedId, patch)
                  : undefined
              }
              onDeselect={() => overridesHook.selectText(null)}
            />
          </ControlGroup>
          <ControlGroup
            label="配置管理"
            description="保存、加载、导入/导出当前配置；每 5 分钟自动保存一次（仅在有改动时）。"
          >
            <ConfigManager filename={filename} {...configManagerProps} />
          </ControlGroup>
        </>
      );
    },
    [overridesHook, configManagerProps, filename],
  );

  return useMemo(
    () => ({
      textOverrides: overridesHook,
      renderInspectorSections,
    }),
    [overridesHook, renderInspectorSections],
  );
}
