/**
 * Shared `<foreignObject>`-backed text label that:
 *   - resolves per-element format overrides on top of the chart-supplied
 *     type-class defaults (font-size / weight / italic / line-height /
 *     align / colour);
 *   - emits MathJax-friendly `data-latex-*` attributes used by the SVG
 *     export pipeline so the exported figure preserves the resolved
 *     style;
 *   - when a `kid` is supplied, becomes click-selectable: clicking the
 *     transparent overlay calls `onSelect` so the host chart can render
 *     a `<TextFormatPopover>` next to it. Both the click-catcher and the
 *     blue dashed selection outline are stamped with `data-export="false"`
 *     so they are stripped by `lib/export.ts`.
 */
import type { CSSProperties } from 'react';
import { renderInlineLatex } from '../lib/latex';
import {
  resolveTextFormat,
  type ResolvedTextFormat,
  type TextAlign,
  type TextFormat,
  type TextFormatDefaults,
} from '../lib/textFormat';

export interface SelectedTextAnchor {
  /** Stable formatKey of the selected element (e.g. `"title"`, `"subtitleA"`). */
  key: string;
  /** SVG-space rectangle that wraps the foreignObject (used by host to position popover). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Defaults the host's `TextFormatPopover` should layer the override on top of. */
  defaults: TextFormatDefaults;
  /** Optional human-readable label shown in the popover header. */
  label?: string;
}

export interface EditableForeignTextProps {
  x: number;
  y: number;
  width: number;
  height: number;
  value: string;
  fontSize: number;
  fontWeight?: number;
  italic?: boolean;
  lineHeight?: number;
  align?: TextAlign;
  color?: string;
  /** Stable formatKey. When set together with `onSelect`, the text is click-selectable. */
  kid?: string;
  /** Current per-element override (looked up by host as `formats[kid]`). */
  format?: TextFormat;
  /** Whether this element is the host's currently-selected text. */
  selected?: boolean;
  /** Click → notify the host so it can mount a `TextFormatPopover`. */
  onSelect?: (anchor: SelectedTextAnchor) => void;
  /** Optional label fed into the popover header for human readability. */
  label?: string;
  /**
   * Non-interactive base font family for the rendered DIV. Defaults to a
   * sans-serif stack matched against the existing charts' typography.
   */
  fontFamily?: string;
  /** Extra inline styles applied to the rendered `<div>`. */
  style?: CSSProperties;
}

const DEFAULT_FONT_FAMILY =
  'Inter, "Noto Sans SC", system-ui, sans-serif';

export function EditableForeignText(props: EditableForeignTextProps) {
  const {
    x,
    y,
    width,
    height,
    value,
    fontSize,
    fontWeight,
    italic,
    lineHeight,
    align = 'left',
    color,
    kid,
    format,
    selected,
    onSelect,
    label,
    fontFamily = DEFAULT_FONT_FAMILY,
    style,
  } = props;

  const defaults: TextFormatDefaults = {
    fontSize,
    fontWeight,
    italic,
    lineHeight,
    align,
    color,
  };
  const resolved: ResolvedTextFormat = resolveTextFormat(defaults, format);
  const lines = value.split('\n');
  const justify =
    resolved.align === 'center'
      ? 'center'
      : resolved.align === 'right'
      ? 'flex-end'
      : 'flex-start';
  const renderHeight = Math.max(
    height,
    lines.length * (resolved.fontSize * resolved.lineHeight + 2),
  );

  const interactive = !!kid && !!onSelect;
  const handleSelect = (e: React.MouseEvent) => {
    if (!interactive) return;
    e.stopPropagation();
    onSelect!({
      key: kid!,
      x,
      y,
      w: width,
      h: renderHeight,
      defaults,
      label,
    });
  };

  return (
    <g>
      <foreignObject
        x={x}
        y={y}
        width={width}
        height={renderHeight}
        data-latex={value}
        data-latex-font-size={resolved.fontSize}
        data-latex-font-weight={resolved.fontWeight}
        data-latex-font-style={resolved.italic ? 'italic' : 'normal'}
        data-latex-color={resolved.color}
        data-latex-align={resolved.align}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: justify,
            textAlign: resolved.align,
            fontFamily,
            fontSize: resolved.fontSize,
            fontWeight: resolved.fontWeight,
            fontStyle: resolved.italic ? 'italic' : 'normal',
            color: resolved.color,
            lineHeight: resolved.lineHeight,
            ...style,
          }}
          dangerouslySetInnerHTML={{
            __html: lines
              .map((l) => `<div>${l ? renderInlineLatex(l) : '&nbsp;'}</div>`)
              .join(''),
          }}
        />
      </foreignObject>
      {interactive ? (
        <rect
          x={x}
          y={y}
          width={width}
          height={renderHeight}
          fill="transparent"
          style={{ cursor: 'pointer' }}
          onMouseDown={handleSelect}
          data-export="false"
        />
      ) : null}
      {selected ? (
        <rect
          x={x - 2}
          y={y - 2}
          width={width + 4}
          height={renderHeight + 4}
          fill="none"
          stroke="#3B82F6"
          strokeWidth={1.2}
          strokeDasharray="4 3"
          pointerEvents="none"
          data-export="false"
        />
      ) : null}
    </g>
  );
}
