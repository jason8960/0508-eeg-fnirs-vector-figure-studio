/**
 * Inspector subsection that edits the override of whichever text
 * element is currently selected in the preview.
 *
 * Renders nothing when no element is selected — charts can include
 * this inside a `ControlGroup` and it stays invisible until the user
 * clicks on a label / title in the figure.
 */
import { useId } from 'react';
import { NumberSlider, Toggle } from './Controls';
import type {
  ResolvedTextStyle,
  TextOverride,
} from '../lib/useTextOverrides';

export interface TextOverridePanelProps {
  /** Stable id of the text being edited; null when nothing selected. */
  selectedId: string | null;
  /** Human-readable label for the panel header (e.g. "标题"). */
  selectedLabel?: string | null;
  /** Resolved style for the selected element (defaults merged with
   *  any existing override) — used as the slider/toggle default. */
  resolved: ResolvedTextStyle | null;
  /** Apply a partial override to the selected id. Pass `null` to
   *  clear the entire override (revert to defaults). */
  setOverride: (patch: Partial<TextOverride> | null) => void;
  /** Clear selection (deselect). */
  onDeselect: () => void;
  /** Allow per-line text content editing. Some text elements
   *  (e.g. legend swatches that always read the data) may want to
   *  hide the text input. Defaults to true. */
  allowTextEdit?: boolean;
  /** Optional min/max for the font-size slider. Defaults to 8 / 28. */
  fontSizeRange?: { min: number; max: number };
  /** Optional min/max for the dx/dy sliders. Defaults to ±200. */
  positionRange?: { min: number; max: number };
}

export function TextOverridePanel({
  selectedId,
  selectedLabel,
  resolved,
  setOverride,
  onDeselect,
  allowTextEdit = true,
  fontSizeRange = { min: 8, max: 28 },
  positionRange = { min: -200, max: 200 },
}: TextOverridePanelProps) {
  const inputId = useId();
  if (!selectedId || !resolved) {
    return (
      <p className="text-[11px] text-ink-300">
        点击预览图中的标题、图例、坐标标签或注释文字进行选中并编辑。
      </p>
    );
  }
  return (
    <div className="space-y-2 rounded border border-ink-700 bg-ink-800/40 p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] uppercase tracking-wider text-accent">
            正在编辑：{selectedLabel ?? selectedId}
          </p>
          <p className="truncate text-[10px] text-ink-400">id: {selectedId}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => setOverride(null)}
            className="rounded border border-ink-600 px-1.5 py-0.5 text-[10px] text-ink-200 hover:bg-ink-800"
          >
            重置
          </button>
          <button
            type="button"
            onClick={onDeselect}
            className="rounded border border-ink-600 px-1.5 py-0.5 text-[10px] text-ink-200 hover:bg-ink-800"
          >
            取消选中
          </button>
        </div>
      </div>

      {allowTextEdit ? (
        <label
          htmlFor={inputId}
          className="flex flex-col gap-1 text-xs text-ink-200"
        >
          <span>文字内容</span>
          <input
            id={inputId}
            type="text"
            value={resolved.text}
            onChange={(e) => setOverride({ text: e.target.value })}
            className="rounded border border-ink-600 bg-ink-800 px-2 py-1 text-ink-50 focus:border-accent focus:outline-none"
          />
        </label>
      ) : null}

      <NumberSlider
        label="字号 (px)"
        value={resolved.fontSize}
        min={fontSizeRange.min}
        max={fontSizeRange.max}
        step={0.5}
        onChange={(v) => setOverride({ fontSize: v })}
      />
      <NumberSlider
        label="字重"
        value={resolved.fontWeight}
        min={300}
        max={800}
        step={100}
        onChange={(v) => setOverride({ fontWeight: v })}
      />
      <Toggle
        label="斜体"
        checked={resolved.italic}
        onChange={(v) => setOverride({ italic: v })}
      />
      <ColorRow
        value={resolved.color}
        onChange={(v) => setOverride({ color: v })}
      />
      <NumberSlider
        label="水平偏移 dx"
        value={resolved.dx}
        min={positionRange.min}
        max={positionRange.max}
        step={1}
        onChange={(v) => setOverride({ dx: v })}
      />
      <NumberSlider
        label="垂直偏移 dy"
        value={resolved.dy}
        min={positionRange.min}
        max={positionRange.max}
        step={1}
        onChange={(v) => setOverride({ dy: v })}
      />
      <Toggle
        label="隐藏此文字"
        checked={resolved.hidden}
        onChange={(v) => setOverride({ hidden: v })}
      />
    </div>
  );
}

function ColorRow({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  // Normalise common non-hex values so the <input type="color"> picker
  // shows something reasonable (it requires #rrggbb).
  const colorVal =
    value && value.startsWith('#') && value.length >= 4 ? value : '#1c1c1c';
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-ink-200">
      <span>颜色</span>
      <div className="flex items-center gap-1">
        <input
          type="color"
          value={colorVal}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 w-8 cursor-pointer rounded border border-ink-600 bg-ink-800 p-0.5"
          aria-label="颜色选择器"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-24 rounded border border-ink-600 bg-ink-800 px-2 py-1 font-mono text-[10px] text-ink-50 focus:border-accent focus:outline-none"
          aria-label="颜色十六进制值"
        />
      </div>
    </div>
  );
}
