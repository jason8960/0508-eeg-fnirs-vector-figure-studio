/**
 * Click-to-select + drag-to-move SVG <text> wrapper.
 *
 * Used by evaluation charts to make every visible piece of text in
 * the preview directly editable. Mirrors the GAT-CMC body-line
 * affordance: clicking a label selects it (so the inspector's
 * `<TextOverridePanel>` can edit its size/weight/color/text), while
 * dragging it commits a `dx` / `dy` offset back to the override map.
 *
 * The selection ring + drag handle are tagged with
 * `data-export="false"` so they never appear in exported SVG / PNG
 * — only in the live preview.
 */
import {
  useCallback,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import type { ResolvedTextStyle } from '../lib/useTextOverrides';

const CLICK_THRESHOLD = 3;

export interface EditableSvgTextProps {
  /** Stable identifier — keys into the override map. */
  id: string;
  /** Anchor X in the parent <g>'s coordinate system (without dx). */
  x: number;
  /** Anchor Y (without dy). */
  y: number;
  /** Resolved style after merging defaults with overrides. */
  style: ResolvedTextStyle;
  textAnchor?: 'start' | 'middle' | 'end';
  dominantBaseline?:
    | 'alphabetic'
    | 'central'
    | 'middle'
    | 'hanging'
    | 'text-after-edge'
    | 'text-before-edge';
  /** Optional rotation around (x+dx, y+dy). */
  rotate?: number;
  /** When true, draws a subtle selection ring around the text. */
  selected?: boolean;
  /** Selection handler. */
  onSelect?: (id: string) => void;
  /** Called continuously during a drag with the new (dx, dy). */
  onMove?: (id: string, dx: number, dy: number) => void;
  /** Called once on pointer-up after a real (>3 px) drag. */
  onCommit?: (id: string, dx: number, dy: number) => void;
  /** SVG element ref so we can map screen → SVG coordinates. */
  svgRef: RefObject<SVGSVGElement | null>;
  /** Disable interactions (e.g. for static export-only render). */
  disabled?: boolean;
  /** Override font family (defaults to chart-wide Inter / Noto). */
  fontFamily?: string;
}

/** Map a client (mouse) point to local SVG coordinates. */
function clientToSvg(
  svg: SVGSVGElement | null,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  if (!svg) return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: pt.x, y: pt.y };
}

export function EditableSvgText(props: EditableSvgTextProps) {
  const {
    id,
    x,
    y,
    style,
    textAnchor = 'start',
    dominantBaseline,
    rotate,
    selected,
    onSelect,
    onMove,
    onCommit,
    svgRef,
    disabled,
    fontFamily,
  } = props;

  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseDx: number;
    baseDy: number;
    moved: boolean;
    target: Element | null;
  } | null>(null);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<Element>) => {
      if (disabled) return;
      if (e.button !== 0) return;
      const pt = clientToSvg(svgRef.current, e.clientX, e.clientY);
      if (!pt) return;
      e.stopPropagation();
      dragRef.current = {
        pointerId: e.pointerId,
        startX: pt.x,
        startY: pt.y,
        baseDx: style.dx,
        baseDy: style.dy,
        moved: false,
        target: null,
      };
    },
    [disabled, style.dx, style.dy, svgRef],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<Element>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const pt = clientToSvg(svgRef.current, e.clientX, e.clientY);
      if (!pt) return;
      const dx = pt.x - drag.startX;
      const dy = pt.y - drag.startY;
      const total = Math.hypot(dx, dy);
      if (!drag.moved && total < CLICK_THRESHOLD) return;
      if (!drag.moved) {
        drag.moved = true;
        try {
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          drag.target = e.currentTarget as Element;
        } catch {
          /* ignore capture errors */
        }
      }
      onMove?.(id, drag.baseDx + dx, drag.baseDy + dy);
    },
    [id, onMove, svgRef],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<Element>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const pt = clientToSvg(svgRef.current, e.clientX, e.clientY);
      const moved = drag.moved;
      try {
        drag.target?.releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore release errors */
      }
      dragRef.current = null;
      if (moved && pt) {
        const dx = pt.x - drag.startX;
        const dy = pt.y - drag.startY;
        onCommit?.(id, drag.baseDx + dx, drag.baseDy + dy);
      } else if (!moved && onSelect) {
        onSelect(id);
      }
    },
    [id, onCommit, onSelect, svgRef],
  );

  if (style.hidden) return null;

  const cx = x + style.dx;
  const cy = y + style.dy;
  const transform = rotate ? `rotate(${rotate} ${cx} ${cy})` : undefined;

  const cursor: CSSProperties['cursor'] = disabled
    ? undefined
    : selected
    ? 'move'
    : 'pointer';

  return (
    <g
      transform={transform}
      style={{
        cursor,
        touchAction: disabled ? undefined : 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {selected ? (
        <SelectionMarker
          x={cx}
          y={cy}
          fontSize={style.fontSize}
          textAnchor={textAnchor}
          textLength={style.text.length}
        />
      ) : null}
      <text
        x={cx}
        y={cy}
        fontSize={style.fontSize}
        fontWeight={style.fontWeight}
        fontStyle={style.italic ? 'italic' : undefined}
        fill={style.color}
        textAnchor={textAnchor}
        dominantBaseline={dominantBaseline}
        style={{
          fontFamily:
            fontFamily ?? 'Inter, "Noto Sans SC", system-ui, sans-serif',
          userSelect: 'none',
          pointerEvents: 'auto',
        }}
      >
        {style.text}
      </text>
    </g>
  );
}

function SelectionMarker({
  x,
  y,
  fontSize,
  textAnchor,
  textLength,
}: {
  x: number;
  y: number;
  fontSize: number;
  textAnchor: 'start' | 'middle' | 'end';
  textLength: number;
}) {
  // Approximate text bbox using a 0.6em-per-char heuristic; just for
  // the live-preview selection ring, never exported.
  const approxW = Math.max(20, textLength * fontSize * 0.6);
  const padX = 4;
  const padY = 2;
  const rectX =
    textAnchor === 'start'
      ? x - padX
      : textAnchor === 'end'
      ? x - approxW - padX
      : x - approxW / 2 - padX;
  const rectY = y - fontSize - padY;
  const rectW = approxW + padX * 2;
  const rectH = fontSize + padY * 2 + 2;
  return (
    <rect
      data-export="false"
      x={rectX}
      y={rectY}
      width={rectW}
      height={rectH}
      rx={3}
      ry={3}
      fill="rgba(91,141,239,0.10)"
      stroke="#5b8def"
      strokeWidth={1}
      strokeDasharray="3 3"
      pointerEvents="none"
    />
  );
}
