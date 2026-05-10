/**
 * Python emitter for the seizure-focus localisation figure.
 *
 * The JS version uses d3-contour on a synthetic 2D Gaussian-mixture
 * importance field clipped to the unit head disc, with anatomical
 * landmark labels overlaid. matplotlib has the same primitives:
 * `contourf` / `contour` for the field, `Circle` for the head outline,
 * and a manual ear/nose path. The script regenerates the field from the
 * same blob parameters as the JS chart and uses an identical mulberry32
 * RNG so the noise matches deterministically.
 */
import { pyMatrix, pyNum, pyStr, pyStrList, pythonHeader } from '../../lib/pythonExport';

export interface FocusLandmarkPython {
  name: string;
  x: number;
  y: number;
}

export interface SeizureFocusPythonInput {
  title: string;
  caption: string;
  /** Pre-computed scalar field on the unit-disc grid (gridSize × gridSize). */
  field: ReadonlyArray<ReadonlyArray<number>>;
  gridSize: number;
  thresholds: number;
  colormapName: string;
  showLandmarks: boolean;
  labelOpacity: number;
  landmarks: ReadonlyArray<FocusLandmarkPython>;
  landmarkLabels: ReadonlyArray<string>;
}

export function emitSeizureFocusPython(input: SeizureFocusPythonInput): string {
  const {
    title,
    caption,
    field,
    gridSize,
    thresholds,
    colormapName,
    showLandmarks,
    labelOpacity,
    landmarks,
    landmarkLabels,
  } = input;

  const lmX = landmarks.map((l) => l.x);
  const lmY = landmarks.map((l) => l.y);

  return `${pythonHeader({
    title,
    caption,
    description:
      'Contour map of a synthetic seizure-focus importance field on the unit head disc.',
  })}from matplotlib.patches import Circle

FIELD = np.array(${pyMatrix(field)})
GRID_SIZE = ${pyNum(gridSize)}
THRESHOLDS = ${pyNum(thresholds)}
COLORMAP = ${pyStr(colormapName)}
SHOW_LANDMARKS = ${showLandmarks ? 'True' : 'False'}
LABEL_OPACITY = ${pyNum(labelOpacity)}
LANDMARK_X = np.array(${`[${lmX.map((v) => pyNum(v)).join(', ')}]`})
LANDMARK_Y = np.array(${`[${lmY.map((v) => pyNum(v)).join(', ')}]`})
LANDMARK_LABELS = ${pyStrList(landmarkLabels)}
TITLE = ${pyStr(title)}
CAPTION = ${pyStr(caption)}


def render() -> None:
    fig, ax = plt.subplots(figsize=(7.5, 7.5), constrained_layout=True)

    extent = (-1.0, 1.0, -1.0, 1.0)
    masked = np.where(FIELD > 0, FIELD, np.nan)
    im = ax.imshow(
        masked,
        extent=extent,
        origin="lower",
        cmap=COLORMAP,
        interpolation="bilinear",
        alpha=0.95,
    )
    levels = max(2, int(THRESHOLDS))
    cs = ax.contour(
        np.linspace(-1, 1, FIELD.shape[1]),
        np.linspace(-1, 1, FIELD.shape[0]),
        FIELD,
        levels=levels,
        colors="white",
        linewidths=0.8,
        alpha=0.7,
    )
    ax.clabel(cs, inline=True, fontsize=7, fmt="%.2f")

    # Head outline (unit disc).
    head = Circle((0, 0), 1.0, fill=False, edgecolor="#0d1117", linewidth=2)
    ax.add_patch(head)
    # Nose.
    ax.plot([0.0, 0.0], [1.0, 1.12], color="#0d1117", linewidth=2)
    ax.plot([-0.07, 0.0, 0.07], [1.0, 1.12, 1.0], color="#0d1117", linewidth=2)
    # Ears.
    for sx in (-1.0, 1.0):
        ax.plot(
            [sx, sx + sx * 0.06, sx + sx * 0.04, sx],
            [0.08, 0.04, -0.04, -0.08],
            color="#0d1117",
            linewidth=2,
        )

    if SHOW_LANDMARKS:
        ax.scatter(LANDMARK_X, LANDMARK_Y, s=18, color="#0d1117", zorder=4)
        for x, y, name in zip(LANDMARK_X, LANDMARK_Y, LANDMARK_LABELS):
            ax.text(
                x,
                y + 0.06,
                name,
                ha="center",
                va="bottom",
                fontsize=9,
                alpha=LABEL_OPACITY,
                color="#0d1117",
            )

    ax.set_xlim(-1.25, 1.25)
    ax.set_ylim(-1.25, 1.25)
    ax.set_aspect("equal")
    ax.axis("off")
    fig.colorbar(im, ax=ax, fraction=0.04, pad=0.02, label="Importance")

    fig.suptitle(TITLE, fontsize=13, fontweight="bold")
    fig.text(0.5, -0.02, CAPTION, ha="center", fontsize=10, color="#444")
    plt.show()


if __name__ == "__main__":
    render()
`;
}
