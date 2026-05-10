/**
 * Python emitter for the dynamic-connectivity chord figure.
 *
 * The JS version uses d3.chord + d3.ribbon to draw a SVG-vector chord
 * diagram from an N×N attention slice. matplotlib has no built-in chord
 * primitive, so we approximate the same idiom with `Wedge` patches for
 * the outer ring (sized by per-region total connectivity) and quadratic
 * Bezier `PathPatch`s through the centre for the chords (line width
 * proportional to weight, coloured by source region).
 *
 * The slice values are inlined directly — the script does not need to
 * regenerate the synthetic attention tensor.
 */
import { pyMatrix, pyNum, pyStr, pyStrList, pythonHeader } from '../../lib/pythonExport';

export interface DynamicChordPythonInput {
  title: string;
  caption: string;
  regions: ReadonlyArray<string>;
  /** Per-region label override (already resolved). */
  regionLabels: ReadonlyArray<string>;
  /** N×N attention matrix at the active time slice. */
  slice: ReadonlyArray<ReadonlyArray<number>>;
  palette: ReadonlyArray<string>;
  padAngle: number;
  ribbonOpacity: number;
  t: number;
}

export function emitDynamicChordPython(input: DynamicChordPythonInput): string {
  const { title, caption, regions, regionLabels, slice, palette, padAngle, ribbonOpacity, t } = input;

  return `${pythonHeader({
    title,
    caption,
    description:
      'Chord-style circular diagram of an attention matrix slice. Outer-ring arc lengths encode total per-region connectivity; chord widths encode pairwise weights.',
  })}from matplotlib.patches import Wedge, PathPatch
from matplotlib.path import Path

REGIONS = ${pyStrList(regions)}
REGION_LABELS = ${pyStrList(regionLabels)}
PALETTE = ${pyStrList(palette)}
SLICE = np.array(${pyMatrix(slice)})
PAD_ANGLE = ${pyNum(padAngle)}
RIBBON_OPACITY = ${pyNum(ribbonOpacity)}
T_INDEX = ${pyNum(t)}
TITLE = ${pyStr(title)}
CAPTION = ${pyStr(caption)}


def render() -> None:
    n = len(REGIONS)
    # Per-region strength = bidirectional connectivity (row + column).
    strengths = SLICE.sum(axis=1) + SLICE.sum(axis=0)
    total = float(strengths.sum())
    if total <= 0:
        total = 1.0

    pad_total = n * PAD_ANGLE
    avail = max(1e-6, 2 * np.pi - pad_total)
    arc_starts = []
    arc_ends = []
    acc = 0.0
    for s in strengths:
        a0 = acc
        a1 = acc + (s / total) * avail
        arc_starts.append(a0)
        arc_ends.append(a1)
        acc = a1 + PAD_ANGLE

    fig, ax = plt.subplots(figsize=(8.0, 8.0))
    ax.set_xlim(-1.45, 1.45)
    ax.set_ylim(-1.45, 1.45)
    ax.set_aspect("equal")
    ax.axis("off")

    # Outer arcs.
    for i, (a0, a1) in enumerate(zip(arc_starts, arc_ends)):
        # Convert to matplotlib's Wedge convention (degrees, 0 = +x).
        # We rotate so 0 rad in our convention is at the top (-pi/2).
        d0 = np.degrees(a0 - np.pi / 2)
        d1 = np.degrees(a1 - np.pi / 2)
        wedge = Wedge(
            center=(0.0, 0.0),
            r=1.0,
            theta1=d0,
            theta2=d1,
            width=0.06,
            facecolor=PALETTE[i % len(PALETTE)],
            edgecolor="white",
            linewidth=0.6,
        )
        ax.add_patch(wedge)
        # Region label at outer edge, rotated tangent to ring.
        mid = (a0 + a1) / 2 - np.pi / 2
        lx = 1.10 * np.cos(mid)
        ly = 1.10 * np.sin(mid)
        rot = np.degrees(mid)
        ha = "left" if np.cos(mid) >= 0 else "right"
        if ha == "right":
            rot += 180
        ax.text(
            lx,
            ly,
            REGION_LABELS[i],
            rotation=rot,
            ha=ha,
            va="center",
            fontsize=10,
            color="#0d1117",
        )

    # Chord ribbons (quadratic Bezier through origin).
    flat_max = float(SLICE.max()) if SLICE.size else 1.0
    if flat_max <= 0:
        flat_max = 1.0
    for i in range(n):
        for j in range(i + 1, n):
            w = (SLICE[i][j] + SLICE[j][i]) / 2.0
            if w <= 0.05 * flat_max:
                continue
            mi = (arc_starts[i] + arc_ends[i]) / 2 - np.pi / 2
            mj = (arc_starts[j] + arc_ends[j]) / 2 - np.pi / 2
            x1, y1 = 0.94 * np.cos(mi), 0.94 * np.sin(mi)
            x2, y2 = 0.94 * np.cos(mj), 0.94 * np.sin(mj)
            verts = [(x1, y1), (0.0, 0.0), (x2, y2)]
            codes = [Path.MOVETO, Path.CURVE3, Path.CURVE3]
            path = Path(verts, codes)
            patch = PathPatch(
                path,
                edgecolor=PALETTE[i % len(PALETTE)],
                facecolor="none",
                linewidth=0.5 + 4.5 * (w / flat_max),
                alpha=RIBBON_OPACITY,
                capstyle="round",
            )
            ax.add_patch(patch)

    fig.suptitle(TITLE, fontsize=13, fontweight="bold")
    fig.text(0.5, 0.02, CAPTION, ha="center", fontsize=10, color="#444")

    plt.show()


if __name__ == "__main__":
    render()
`;
}
