/**
 * Python emitter for the EEG–fNIRS co-registration topomap.
 *
 * The JS chart computes an inverse-distance-weighted scalp field from
 * 10-20 electrode values, paints the unit head disc as a coarse pixel
 * grid, then overlays fNIRS optodes and source–detector pair lines.
 * The script repeats the IDW interpolation in numpy for a smooth field
 * (`imshow` with NaN outside the disc) and replays the same scatter +
 * pair-line overlay using matplotlib primitives.
 */
import { pyList, pyNum, pyStr, pyStrList, pythonHeader } from '../../lib/pythonExport';

export interface ElectrodePython {
  name: string;
  x: number;
  y: number;
}

export interface OptodePython {
  name: string;
  x: number;
  y: number;
  type: 'source' | 'detector';
}

export interface OptodePairPython {
  source: string;
  detector: string;
}

export interface EegFnirsTopomapPythonInput {
  title: string;
  caption: string;
  electrodes: ReadonlyArray<ElectrodePython>;
  /** Per-electrode field value (already normalised to [-1, 1]). */
  values: ReadonlyArray<number>;
  optodes: ReadonlyArray<OptodePython>;
  pairs: ReadonlyArray<OptodePairPython>;
  showEeg: boolean;
  showFnirs: boolean;
  eegOpacity: number;
  showLabels: boolean;
  resolution: number;
  colormapName: string;
  legendSource: string;
  legendDetector: string;
  legendPath: string;
}

export function emitEegFnirsTopomapPython(input: EegFnirsTopomapPythonInput): string {
  const {
    title,
    caption,
    electrodes,
    values,
    optodes,
    pairs,
    showEeg,
    showFnirs,
    eegOpacity,
    showLabels,
    resolution,
    colormapName,
    legendSource,
    legendDetector,
    legendPath,
  } = input;

  const elxs = electrodes.map((e) => e.x);
  const elys = electrodes.map((e) => e.y);
  const elnames = electrodes.map((e) => e.name);

  const optsX = optodes.map((o) => o.x);
  const optsY = optodes.map((o) => o.y);
  const optsName = optodes.map((o) => o.name);
  const optsType = optodes.map((o) => o.type);

  const pairLines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const optodeMap = new Map(optodes.map((o) => [o.name, o]));
  for (const p of pairs) {
    const s = optodeMap.get(p.source);
    const d = optodeMap.get(p.detector);
    if (!s || !d) continue;
    pairLines.push({ x1: s.x, y1: s.y, x2: d.x, y2: d.y });
  }
  const pairXs = pairLines.flatMap((p) => [p.x1, p.x2, NaN]);
  const pairYs = pairLines.flatMap((p) => [p.y1, p.y2, NaN]);

  return `${pythonHeader({
    title,
    caption,
    description:
      'EEG 10-20 scalp field with overlaid fNIRS optodes and source–detector photon paths.',
  })}from matplotlib.patches import Circle

ELECTRODE_X = np.array(${pyList(elxs)})
ELECTRODE_Y = np.array(${pyList(elys)})
ELECTRODE_NAMES = ${pyStrList(elnames)}
ELECTRODE_VALUES = np.array(${pyList(values)})

OPTODE_X = np.array(${pyList(optsX)})
OPTODE_Y = np.array(${pyList(optsY)})
OPTODE_NAMES = ${pyStrList(optsName)}
OPTODE_TYPES = ${pyStrList(optsType)}

PAIR_XS = np.array(${pyList(pairXs)})
PAIR_YS = np.array(${pyList(pairYs)})

SHOW_EEG = ${showEeg ? 'True' : 'False'}
SHOW_FNIRS = ${showFnirs ? 'True' : 'False'}
EEG_OPACITY = ${pyNum(eegOpacity)}
SHOW_LABELS = ${showLabels ? 'True' : 'False'}
RESOLUTION = ${pyNum(resolution)}
COLORMAP = ${pyStr(colormapName)}
LEGEND_SOURCE = ${pyStr(legendSource)}
LEGEND_DETECTOR = ${pyStr(legendDetector)}
LEGEND_PATH = ${pyStr(legendPath)}
TITLE = ${pyStr(title)}
CAPTION = ${pyStr(caption)}


def idw(grid_x: np.ndarray, grid_y: np.ndarray) -> np.ndarray:
    out = np.full(grid_x.shape, np.nan)
    n_pts = ELECTRODE_VALUES.shape[0]
    for i in range(grid_x.shape[0]):
        for j in range(grid_x.shape[1]):
            x, y = grid_x[i, j], grid_y[i, j]
            if x * x + y * y > 1:
                continue
            num = 0.0
            den = 0.0
            for k in range(n_pts):
                dx = x - ELECTRODE_X[k]
                dy = y - ELECTRODE_Y[k]
                d2 = dx * dx + dy * dy
                w = 1.0 / (d2 + 0.005)
                num += w * ELECTRODE_VALUES[k]
                den += w
            out[i, j] = num / den
    return out


def render() -> None:
    fig, ax = plt.subplots(figsize=(7.5, 7.5), constrained_layout=True)

    res = max(8, int(RESOLUTION))
    grid = np.linspace(-1, 1, res)
    gx, gy = np.meshgrid(grid, grid)

    if SHOW_EEG:
        field = idw(gx, gy)
        ax.imshow(
            field,
            extent=(-1, 1, -1, 1),
            origin="lower",
            cmap=COLORMAP,
            vmin=-1,
            vmax=1,
            interpolation="bilinear",
            alpha=EEG_OPACITY,
        )

    # Head outline.
    head = Circle((0, 0), 1.0, fill=False, edgecolor="#0d1117", linewidth=2)
    ax.add_patch(head)
    ax.plot([0.0, 0.0], [1.0, 1.12], color="#0d1117", linewidth=2)
    ax.plot([-0.07, 0.0, 0.07], [1.0, 1.12, 1.0], color="#0d1117", linewidth=2)
    for sx in (-1.0, 1.0):
        ax.plot(
            [sx, sx + sx * 0.06, sx + sx * 0.04, sx],
            [0.08, 0.04, -0.04, -0.08],
            color="#0d1117",
            linewidth=2,
        )

    # Electrodes.
    if SHOW_EEG:
        ax.scatter(ELECTRODE_X, ELECTRODE_Y, s=24, color="#0d1117", zorder=4)
        if SHOW_LABELS:
            for x, y, name in zip(ELECTRODE_X, ELECTRODE_Y, ELECTRODE_NAMES):
                ax.text(x, y + 0.05, name, ha="center", va="bottom", fontsize=7)

    # fNIRS pair lines + optodes.
    if SHOW_FNIRS:
        ax.plot(
            PAIR_XS,
            PAIR_YS,
            color="#a855f7",
            linewidth=1.6,
            alpha=0.65,
            label=LEGEND_PATH,
            zorder=2,
        )
        for x, y, name, t in zip(OPTODE_X, OPTODE_Y, OPTODE_NAMES, OPTODE_TYPES):
            color = "#dc2626" if t == "source" else "#1d4ed8"
            ax.scatter(x, y, s=70, marker="o", color=color, edgecolors="white", linewidths=1.2, zorder=5)
            if SHOW_LABELS:
                ax.text(x, y - 0.06, name, ha="center", va="top", fontsize=7, color=color)

        # Legend (ax-level).
        ax.scatter([], [], s=70, color="#dc2626", label=LEGEND_SOURCE)
        ax.scatter([], [], s=70, color="#1d4ed8", label=LEGEND_DETECTOR)
        ax.legend(loc="lower right", fontsize=8, framealpha=0.92)

    ax.set_xlim(-1.25, 1.25)
    ax.set_ylim(-1.25, 1.25)
    ax.set_aspect("equal")
    ax.axis("off")
    fig.suptitle(TITLE, fontsize=13, fontweight="bold")
    fig.text(0.5, 0.02, CAPTION, ha="center", fontsize=10, color="#444")
    plt.show()


if __name__ == "__main__":
    render()
`;
}
