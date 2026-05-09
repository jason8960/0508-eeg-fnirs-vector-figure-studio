import { forwardRef, useEffect, useMemo, useRef } from 'react';
import { renderInlineLatex } from '../lib/latex';
import type {
  ResolvedTextStyle,
  TextOverride,
} from '../lib/useTextOverrides';

interface FigureFrameProps {
  title?: string;
  caption?: string;
  width: number;
  height: number;
  /** Padding around the inner figure for title/caption. */
  framePadding?: { top: number; bottom: number };
  children: React.ReactNode;
  /**
   * Optional editable-title support. When provided, the title is
   * rendered as an HTML overlay that responds to click (selects via
   * `onSelectTitle`) and applies the resolved override (font size,
   * weight, color, italic, dx/dy, hidden). Falls back to the static
   * KaTeX render when not provided.
   */
  titleOverride?: TextOverride;
  titleSelected?: boolean;
  onSelectTitle?: () => void;
  /** Same shape as titleOverride for the caption. */
  captionOverride?: TextOverride;
  captionSelected?: boolean;
  onSelectCaption?: () => void;
}

const TITLE_DEFAULT_SIZE = 14;
const TITLE_DEFAULT_WEIGHT = 600;
const CAPTION_DEFAULT_SIZE = 12;
const CAPTION_DEFAULT_WEIGHT = 400;

function resolve(
  defaults: { text: string; fontSize: number; fontWeight: number },
  o?: TextOverride,
): ResolvedTextStyle & { dxN: number; dyN: number } {
  return {
    text: o?.text ?? defaults.text,
    fontSize: o?.fontSize ?? defaults.fontSize,
    fontWeight: o?.fontWeight ?? defaults.fontWeight,
    italic: o?.italic ?? false,
    color: o?.color ?? 'currentColor',
    dx: o?.dx ?? 0,
    dy: o?.dy ?? 0,
    hidden: o?.hidden ?? false,
    dxN: o?.dx ?? 0,
    dyN: o?.dy ?? 0,
  };
}

/**
 * A thin SVG wrapper that renders a figure title and caption with
 * KaTeX-rendered LaTeX (via `<foreignObject>`) and a clip region for
 * the chart body. Charts mount as children of this frame.
 *
 * When `titleOverride` / `captionOverride` props are supplied the
 * frame applies per-text overrides (font size / weight / italic /
 * color / dx / dy / hidden) and dispatches `onSelectTitle` /
 * `onSelectCaption` on click — callers wire this into a
 * `useTextOverrides` store so the inspector's `<TextOverridePanel>`
 * can edit the same fields.
 */
export const FigureFrame = forwardRef<SVGSVGElement, FigureFrameProps>(
  function FigureFrame(
    {
      title,
      caption,
      width,
      height,
      framePadding,
      children,
      titleOverride,
      titleSelected,
      onSelectTitle,
      captionOverride,
      captionSelected,
      onSelectCaption,
    },
    ref,
  ) {
    const titleRef = useRef<HTMLDivElement>(null);
    const captionRef = useRef<HTMLDivElement>(null);

    const padTop = framePadding?.top ?? (title ? 28 : 0);
    const padBottom = framePadding?.bottom ?? (caption ? 32 : 0);

    const titleStyle = useMemo(
      () =>
        title !== undefined
          ? resolve(
              {
                text: title,
                fontSize: TITLE_DEFAULT_SIZE,
                fontWeight: TITLE_DEFAULT_WEIGHT,
              },
              titleOverride,
            )
          : null,
      [title, titleOverride],
    );

    const captionStyle = useMemo(
      () =>
        caption !== undefined
          ? resolve(
              {
                text: caption,
                fontSize: CAPTION_DEFAULT_SIZE,
                fontWeight: CAPTION_DEFAULT_WEIGHT,
              },
              captionOverride,
            )
          : null,
      [caption, captionOverride],
    );

    useEffect(() => {
      if (titleRef.current && titleStyle) {
        titleRef.current.innerHTML = renderInlineLatex(titleStyle.text);
      }
      if (captionRef.current && captionStyle) {
        captionRef.current.innerHTML = renderInlineLatex(captionStyle.text);
      }
    }, [titleStyle, captionStyle]);

    return (
      <svg
        ref={ref}
        className="figure-svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        {titleStyle && !titleStyle.hidden ? (
          <foreignObject
            x={titleStyle.dxN}
            y={4 + titleStyle.dyN}
            width={width}
            height={padTop}
            data-latex={titleStyle.text}
            data-latex-font-size={titleStyle.fontSize}
            data-latex-font-weight={titleStyle.fontWeight}
            data-latex-font-style={titleStyle.italic ? 'italic' : undefined}
            data-latex-color={
              titleStyle.color === 'currentColor' ? undefined : titleStyle.color
            }
          >
            <div
              ref={titleRef}
              onClick={
                onSelectTitle
                  ? (ev) => {
                      ev.stopPropagation();
                      onSelectTitle();
                    }
                  : undefined
              }
              style={{
                fontFamily:
                  'Inter, "Noto Sans SC", system-ui, sans-serif',
                fontSize: titleStyle.fontSize,
                fontWeight: titleStyle.fontWeight,
                fontStyle: titleStyle.italic ? 'italic' : undefined,
                color:
                  titleStyle.color === 'currentColor'
                    ? 'currentColor'
                    : titleStyle.color,
                textAlign: 'center',
                cursor: onSelectTitle ? 'pointer' : undefined,
                outline:
                  titleSelected && onSelectTitle
                    ? '1px dashed #5b8def'
                    : undefined,
                outlineOffset: titleSelected ? 2 : undefined,
                borderRadius: 3,
              }}
            />
          </foreignObject>
        ) : null}

        <g transform={`translate(0, ${padTop})`}>{children}</g>

        {captionStyle && !captionStyle.hidden ? (
          <foreignObject
            x={captionStyle.dxN}
            y={height - padBottom + captionStyle.dyN}
            width={width}
            height={padBottom}
            data-latex={captionStyle.text}
            data-latex-font-size={captionStyle.fontSize}
            data-latex-font-style={captionStyle.italic ? 'italic' : undefined}
            data-latex-font-weight={captionStyle.fontWeight}
            data-latex-color={
              captionStyle.color === 'currentColor'
                ? undefined
                : captionStyle.color
            }
          >
            <div
              ref={captionRef}
              onClick={
                onSelectCaption
                  ? (ev) => {
                      ev.stopPropagation();
                      onSelectCaption();
                    }
                  : undefined
              }
              style={{
                fontFamily:
                  '"Crimson Pro", "Noto Serif SC", "Times New Roman", serif',
                fontSize: captionStyle.fontSize,
                fontStyle: captionStyle.italic ? 'italic' : undefined,
                fontWeight: captionStyle.fontWeight,
                color:
                  captionStyle.color === 'currentColor'
                    ? 'currentColor'
                    : captionStyle.color,
                opacity: 0.85,
                textAlign: 'center',
                paddingTop: 8,
                cursor: onSelectCaption ? 'pointer' : undefined,
                outline:
                  captionSelected && onSelectCaption
                    ? '1px dashed #5b8def'
                    : undefined,
                outlineOffset: captionSelected ? 2 : undefined,
                borderRadius: 3,
              }}
            />
          </foreignObject>
        ) : null}
      </svg>
    );
  },
);
