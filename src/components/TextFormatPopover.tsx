/**
 * Floating text-format toolbar.
 *
 * Renders inside a `<foreignObject data-export="false">` so the popover
 * is automatically stripped from the exported SVG (see
 * `lib/export.ts → svgToVectorString`). Charts are responsible for
 * placing this component near the currently-selected label and for
 * supplying the resolved style + override patcher.
 */
import { useEffect } from 'react';
import {
  resolveTextFormat,
  type ResolvedTextFormat,
  type TextAlign,
  type TextFormat,
  type TextFormatDefaults,
} from '../lib/textFormat';

export interface TextFormatPopoverProps {
  /** SVG-space anchor point. The popover renders to the right of/below this. */
  anchorX: number;
  anchorY: number;
  /** Width / height of the foreignObject that hosts the popover. */
  width?: number;
  height?: number;
  /** Currently-stored override (`formats[selectedKey]`). */
  override?: TextFormat;
  /** Type-class defaults that the override is layered on top of. */
  defaults: TextFormatDefaults;
  /** Apply a single field change. `undefined` clears that field. */
  onChange: (patch: Partial<TextFormat>) => void;
  /** Drop *all* per-element overrides for the selected key. */
  onReset: () => void;
  /** Close the popover (deselect). */
  onClose: () => void;
  /** Optional human-readable name for the selected element. */
  label?: string;
}

const ALIGN_VALUES: TextAlign[] = ['left', 'center', 'right'];

const FONT_SIZE_STEPS: number[] = [8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 42];
const LH_STEPS: number[] = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2.0];

function nearestStep(value: number, steps: number[]): number {
  let best = steps[0];
  let bestDelta = Math.abs(value - best);
  for (let i = 1; i < steps.length; i++) {
    const delta = Math.abs(value - steps[i]);
    if (delta < bestDelta) {
      best = steps[i];
      bestDelta = delta;
    }
  }
  return best;
}

function nudge(steps: number[], current: number, dir: 1 | -1): number {
  const idx = steps.indexOf(nearestStep(current, steps));
  const next = Math.max(0, Math.min(steps.length - 1, idx + dir));
  return steps[next];
}

export function TextFormatPopover(props: TextFormatPopoverProps) {
  const {
    anchorX,
    anchorY,
    width = 280,
    height = 130,
    override,
    defaults,
    onChange,
    onReset,
    onClose,
    label,
  } = props;
  const resolved: ResolvedTextFormat = resolveTextFormat(defaults, override);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <foreignObject
      x={anchorX}
      y={anchorY}
      width={width}
      height={height}
      data-export="false"
    >
      <div
        // Stop the chart-level "click outside to deselect" handler from
        // firing on every click inside the popover.
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{
          fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif',
          fontSize: 11,
          background: 'rgba(20,22,28,0.96)',
          color: '#f4f4f5',
          border: '1px solid #4b5563',
          borderRadius: 8,
          boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
          padding: '6px 8px 8px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span style={{ opacity: 0.75, fontSize: 10, letterSpacing: '0.04em' }}>
            {label ? `格式 · ${label}` : '文本格式'}
          </span>
          <button
            type="button"
            onClick={onClose}
            title="关闭 (Esc)"
            style={{
              cursor: 'pointer',
              border: '1px solid #4b5563',
              background: 'transparent',
              color: '#d1d5db',
              borderRadius: 4,
              fontSize: 11,
              padding: '0 6px',
              lineHeight: '16px',
            }}
          >
            ×
          </button>
        </div>

        {/* Row 1: font size + line-height steppers */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Stepper
            label="字号"
            value={resolved.fontSize}
            onDec={() =>
              onChange({ fontSize: nudge(FONT_SIZE_STEPS, resolved.fontSize, -1) })
            }
            onInc={() =>
              onChange({ fontSize: nudge(FONT_SIZE_STEPS, resolved.fontSize, 1) })
            }
            onReset={() => onChange({ fontSize: undefined })}
            isOverride={override?.fontSize !== undefined}
            display={`${Math.round(resolved.fontSize)}`}
          />
          <Stepper
            label="行距"
            value={resolved.lineHeight}
            onDec={() =>
              onChange({ lineHeight: nudge(LH_STEPS, resolved.lineHeight, -1) })
            }
            onInc={() =>
              onChange({ lineHeight: nudge(LH_STEPS, resolved.lineHeight, 1) })
            }
            onReset={() => onChange({ lineHeight: undefined })}
            isOverride={override?.lineHeight !== undefined}
            display={resolved.lineHeight.toFixed(1)}
          />
        </div>

        {/* Row 2: weight / italic / align */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'stretch' }}>
          <Toggle
            label="B"
            active={resolved.fontWeight >= 600}
            override={override?.fontWeight !== undefined}
            onClick={() =>
              onChange({
                fontWeight: resolved.fontWeight >= 600 ? 400 : 700,
              })
            }
            onReset={() => onChange({ fontWeight: undefined })}
            title="加粗"
            bold
          />
          <Toggle
            label="I"
            active={resolved.italic}
            override={override?.italic !== undefined}
            onClick={() => onChange({ italic: !resolved.italic })}
            onReset={() => onChange({ italic: undefined })}
            title="斜体"
            italic
          />
          <span
            style={{
              display: 'inline-block',
              width: 1,
              alignSelf: 'stretch',
              background: '#3f3f46',
              margin: '0 2px',
            }}
          />
          {ALIGN_VALUES.map((a) => (
            <Toggle
              key={a}
              label={a === 'left' ? '⯇' : a === 'center' ? '≡' : '⯈'}
              active={resolved.align === a}
              override={override?.align === a}
              onClick={() => onChange({ align: a })}
              onReset={() => onChange({ align: undefined })}
              title={
                a === 'left' ? '左对齐' : a === 'center' ? '居中' : '右对齐'
              }
            />
          ))}
        </div>

        {/* Row 3: colour + reset all */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label
            style={{
              display: 'flex',
              gap: 4,
              alignItems: 'center',
              fontSize: 10,
              opacity: 0.85,
            }}
          >
            <span>颜色</span>
            <input
              type="color"
              value={resolved.color}
              onChange={(e) => onChange({ color: e.target.value })}
              style={{
                width: 22,
                height: 18,
                border: 'none',
                background: 'transparent',
                padding: 0,
                cursor: 'pointer',
              }}
            />
            {override?.color ? (
              <button
                type="button"
                onClick={() => onChange({ color: undefined })}
                title="还原默认颜色"
                style={{
                  cursor: 'pointer',
                  border: '1px solid #4b5563',
                  background: 'transparent',
                  color: '#d1d5db',
                  borderRadius: 4,
                  padding: '0 4px',
                  fontSize: 10,
                }}
              >
                ↺
              </button>
            ) : null}
          </label>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onReset}
            title="清除该元素的全部覆盖"
            style={{
              cursor: 'pointer',
              border: '1px solid #4b5563',
              background: 'transparent',
              color: '#d1d5db',
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: 10,
            }}
          >
            重置元素
          </button>
        </div>
      </div>
    </foreignObject>
  );
}

function Stepper({
  label,
  display,
  onDec,
  onInc,
  onReset,
  isOverride,
}: {
  label: string;
  value: number;
  display: string;
  onDec: () => void;
  onInc: () => void;
  onReset: () => void;
  isOverride: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        border: '1px solid #4b5563',
        borderRadius: 4,
        padding: '1px 2px',
        background: isOverride ? 'rgba(59,130,246,0.18)' : 'transparent',
      }}
    >
      <span style={{ fontSize: 10, opacity: 0.7, padding: '0 2px' }}>{label}</span>
      <button type="button" onClick={onDec} style={btnStyle}>
        −
      </button>
      <span
        style={{
          minWidth: 26,
          textAlign: 'center',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {display}
      </span>
      <button type="button" onClick={onInc} style={btnStyle}>
        +
      </button>
      {isOverride ? (
        <button
          type="button"
          onClick={onReset}
          title="还原默认"
          style={{ ...btnStyle, fontSize: 10 }}
        >
          ↺
        </button>
      ) : null}
    </div>
  );
}

function Toggle({
  label,
  active,
  override,
  onClick,
  onReset,
  title,
  bold,
  italic,
}: {
  label: string;
  active: boolean;
  override: boolean;
  onClick: () => void;
  onReset: () => void;
  title: string;
  bold?: boolean;
  italic?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onReset();
      }}
      title={`${title}（右键还原默认）`}
      style={{
        cursor: 'pointer',
        minWidth: 22,
        padding: '1px 4px',
        border: '1px solid ' + (active ? '#60a5fa' : '#4b5563'),
        background: active ? 'rgba(59,130,246,0.25)' : 'transparent',
        color: active ? '#dbeafe' : '#d1d5db',
        borderRadius: 4,
        fontWeight: bold ? 700 : 400,
        fontStyle: italic ? 'italic' : 'normal',
        fontSize: 11,
        outline: override && !active ? '1px dashed #60a5fa' : 'none',
        outlineOffset: -2,
      }}
    >
      {label}
    </button>
  );
}

const btnStyle: React.CSSProperties = {
  cursor: 'pointer',
  border: 'none',
  background: 'transparent',
  color: '#d1d5db',
  fontSize: 12,
  lineHeight: '14px',
  padding: '0 4px',
  borderRadius: 3,
};
