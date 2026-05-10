/**
 * Shared helpers for emitting matplotlib scripts that reproduce the
 * **architecture-category** schematic diagrams. Architecture charts are
 * not data plots; they are schematic figures composed of rectangles,
 * arrows, and labels. Rather than rebuild each diagram's geometry in
 * Python, each chart's emitter captures the live SVG primitives at
 * click time and feeds them through the shared `renderArchPrimitives`
 * function, which produces a Python script that re-draws the same
 * primitives with `matplotlib.patches`.
 *
 * The Y axis convention follows the SVG world (Y grows downward); the
 * generated Python flips it via `ax.invert_yaxis()` so coordinates can
 * be inlined unchanged.
 */
import { pyNum, pyStr, pythonHeader } from './pythonExport';

/** Optional fill / stroke colour. `null` ⇒ "none". */
export type MaybeColor = string | null;

export interface ArchRect {
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: MaybeColor;
  stroke?: MaybeColor;
  strokeWidth?: number;
  rx?: number;
  opacity?: number;
}

export interface ArchPolygon {
  kind: 'polygon';
  points: ReadonlyArray<readonly [number, number]>;
  fill?: MaybeColor;
  stroke?: MaybeColor;
  strokeWidth?: number;
  opacity?: number;
  closed?: boolean;
}

export interface ArchLine {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke?: MaybeColor;
  strokeWidth?: number;
  /** SVG-style dasharray, e.g. "4 3"; pass undefined for solid. */
  dasharray?: string;
  /** Render with an arrowhead at (x2, y2). */
  arrowEnd?: boolean;
}

export interface ArchPath {
  kind: 'path';
  /** Series of (x, y) points; rendered as a poly-line. */
  points: ReadonlyArray<readonly [number, number]>;
  stroke?: MaybeColor;
  strokeWidth?: number;
  fill?: MaybeColor;
  dasharray?: string;
  arrowEnd?: boolean;
}

export interface ArchText {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  fontSize?: number;
  fontWeight?: number | 'normal' | 'bold';
  color?: string;
  /** Horizontal alignment. */
  ha?: 'left' | 'center' | 'right';
  /** Vertical alignment. */
  va?: 'top' | 'middle' | 'bottom';
  /** Rotation in degrees. */
  rotation?: number;
  italic?: boolean;
}

export interface ArchCircle {
  kind: 'circle';
  cx: number;
  cy: number;
  r: number;
  fill?: MaybeColor;
  stroke?: MaybeColor;
  strokeWidth?: number;
  opacity?: number;
}

export type ArchPrimitive =
  | ArchRect
  | ArchPolygon
  | ArchLine
  | ArchPath
  | ArchText
  | ArchCircle;

export interface ArchPythonInput {
  title: string;
  caption: string;
  /** Width / height of the SVG world the primitives live in (px). */
  width: number;
  height: number;
  primitives: ReadonlyArray<ArchPrimitive>;
  /** Description rendered inside the docstring. */
  description?: string;
  /** Background colour for the whole figure. */
  background?: MaybeColor;
}

function pyColor(c: MaybeColor | undefined): string {
  if (c === undefined || c === null || c === '') return 'None';
  return pyStr(c);
}

function pyBool(b: boolean | undefined, fallback = false): string {
  return b ?? fallback ? 'True' : 'False';
}

function pyKwargs(record: Record<string, string | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(record)) {
    if (v === undefined) continue;
    parts.push(`${k}=${v}`);
  }
  return parts.join(', ');
}

function emitRect(p: ArchRect): string {
  const kwargs = pyKwargs({
    facecolor: pyColor(p.fill ?? '#ffffff'),
    edgecolor: pyColor(p.stroke ?? '#0d1117'),
    linewidth: pyNum(p.strokeWidth ?? 1),
    alpha: p.opacity !== undefined ? pyNum(p.opacity) : undefined,
  });
  const rx = p.rx ?? 0;
  if (rx > 0) {
    return `    ax.add_patch(FancyBboxPatch(\n        (${pyNum(p.x)}, ${pyNum(p.y)}),\n        ${pyNum(p.w)},\n        ${pyNum(p.h)},\n        boxstyle="round,pad=0,rounding_size=${pyNum(rx)}",\n        ${kwargs},\n    ))`;
  }
  return `    ax.add_patch(Rectangle(\n        (${pyNum(p.x)}, ${pyNum(p.y)}),\n        ${pyNum(p.w)},\n        ${pyNum(p.h)},\n        ${kwargs},\n    ))`;
}

function emitPolygon(p: ArchPolygon): string {
  const pts = p.points
    .map((pt) => `(${pyNum(pt[0])}, ${pyNum(pt[1])})`)
    .join(', ');
  const kwargs = pyKwargs({
    facecolor: pyColor(p.fill ?? '#ffffff'),
    edgecolor: pyColor(p.stroke ?? '#0d1117'),
    linewidth: pyNum(p.strokeWidth ?? 1),
    alpha: p.opacity !== undefined ? pyNum(p.opacity) : undefined,
    closed: p.closed === false ? 'False' : 'True',
  });
  return `    ax.add_patch(Polygon([${pts}], ${kwargs}))`;
}

function emitLine(p: ArchLine): string {
  const stroke = pyColor(p.stroke ?? '#0d1117');
  const lw = pyNum(p.strokeWidth ?? 1);
  const dash = p.dasharray
    ? `, linestyle=(0, (${p.dasharray.split(/[, ]+/).map((s) => pyNum(Number(s))).join(', ')}))`
    : '';
  if (p.arrowEnd) {
    return `    ax.annotate(\n        "",\n        xy=(${pyNum(p.x2)}, ${pyNum(p.y2)}),\n        xytext=(${pyNum(p.x1)}, ${pyNum(p.y1)}),\n        arrowprops=dict(arrowstyle="->", color=${stroke}, linewidth=${lw}),\n    )`;
  }
  return `    ax.plot([${pyNum(p.x1)}, ${pyNum(p.x2)}], [${pyNum(p.y1)}, ${pyNum(p.y2)}], color=${stroke}, linewidth=${lw}${dash})`;
}

function emitPath(p: ArchPath): string {
  const xs = p.points.map((pt) => pyNum(pt[0])).join(', ');
  const ys = p.points.map((pt) => pyNum(pt[1])).join(', ');
  const stroke = pyColor(p.stroke ?? '#0d1117');
  const lw = pyNum(p.strokeWidth ?? 1);
  const dash = p.dasharray
    ? `, linestyle=(0, (${p.dasharray.split(/[, ]+/).map((s) => pyNum(Number(s))).join(', ')}))`
    : '';
  if (p.fill) {
    const fill = pyColor(p.fill);
    return `    ax.fill([${xs}], [${ys}], facecolor=${fill}, edgecolor=${stroke}, linewidth=${lw}${dash})`;
  }
  const lines = `    ax.plot([${xs}], [${ys}], color=${stroke}, linewidth=${lw}${dash})`;
  if (p.arrowEnd && p.points.length >= 2) {
    const last = p.points[p.points.length - 1];
    const prev = p.points[p.points.length - 2];
    return `${lines}\n    ax.annotate(\n        "",\n        xy=(${pyNum(last[0])}, ${pyNum(last[1])}),\n        xytext=(${pyNum(prev[0])}, ${pyNum(prev[1])}),\n        arrowprops=dict(arrowstyle="->", color=${stroke}, linewidth=${lw}),\n    )`;
  }
  return lines;
}

function emitText(p: ArchText): string {
  const ha = p.ha ?? 'left';
  const va: 'top' | 'middle' | 'bottom' =
    p.va === 'middle' ? 'middle' : (p.va ?? 'bottom');
  const va_kw = va === 'middle' ? 'center' : va;
  const kwargs = pyKwargs({
    fontsize: pyNum(p.fontSize ?? 11),
    color: pyStr(p.color ?? '#0d1117'),
    ha: pyStr(ha),
    va: pyStr(va_kw),
    rotation: p.rotation !== undefined ? pyNum(p.rotation) : undefined,
    fontweight:
      typeof p.fontWeight === 'number'
        ? pyNum(p.fontWeight)
        : p.fontWeight !== undefined
          ? pyStr(p.fontWeight)
          : undefined,
    fontstyle: p.italic ? pyStr('italic') : undefined,
  });
  return `    ax.text(${pyNum(p.x)}, ${pyNum(p.y)}, ${pyStr(p.text)}, ${kwargs})`;
}

function emitCircle(p: ArchCircle): string {
  const kwargs = pyKwargs({
    facecolor: pyColor(p.fill ?? '#ffffff'),
    edgecolor: pyColor(p.stroke ?? '#0d1117'),
    linewidth: pyNum(p.strokeWidth ?? 1),
    alpha: p.opacity !== undefined ? pyNum(p.opacity) : undefined,
  });
  return `    ax.add_patch(Circle((${pyNum(p.cx)}, ${pyNum(p.cy)}), ${pyNum(p.r)}, ${kwargs}))`;
}

function emitPrimitive(p: ArchPrimitive): string {
  switch (p.kind) {
    case 'rect':
      return emitRect(p);
    case 'polygon':
      return emitPolygon(p);
    case 'line':
      return emitLine(p);
    case 'path':
      return emitPath(p);
    case 'text':
      return emitText(p);
    case 'circle':
      return emitCircle(p);
  }
  // Exhaustiveness — should be unreachable.
  void pyBool;
  throw new Error('Unknown architecture primitive');
}

/**
 * Render a complete matplotlib script that re-draws the supplied list
 * of primitives. The script produces a single `Axes` filling the
 * entire figure; the SVG world (Y down) is preserved by inverting the
 * Y axis after layout.
 */
export function renderArchPrimitives(input: ArchPythonInput): string {
  const {
    title,
    caption,
    width,
    height,
    primitives,
    description,
    background,
  } = input;

  const aspect = Math.max(0.4, Math.min(2.5, width / Math.max(1, height)));
  const figW = 10.0;
  const figH = +(figW / aspect).toFixed(2);

  const body = primitives.map(emitPrimitive).join('\n');

  return `${pythonHeader({
    title,
    caption,
    description:
      description ??
      'Architecture schematic re-drawn from captured SVG primitives.',
  })}from matplotlib.patches import (
    Rectangle,
    FancyBboxPatch,
    Polygon,
    Circle,
)

TITLE = ${pyStr(title)}
CAPTION = ${pyStr(caption)}
WIDTH = ${pyNum(width)}
HEIGHT = ${pyNum(height)}


def render() -> None:
    fig, ax = plt.subplots(figsize=(${pyNum(figW)}, ${pyNum(figH)}), constrained_layout=True)
${background ? `    fig.patch.set_facecolor(${pyStr(background)})\n    ax.set_facecolor(${pyStr(background)})\n` : ''}    ax.set_xlim(0, WIDTH)
    ax.set_ylim(0, HEIGHT)
    ax.invert_yaxis()
    ax.set_aspect("equal")
    ax.axis("off")

${body}

    fig.suptitle(TITLE, fontsize=13, fontweight="bold")
    fig.text(0.5, 0.005, CAPTION, ha="center", fontsize=10, color="#444")
    plt.show()


if __name__ == "__main__":
    render()
`;
}
