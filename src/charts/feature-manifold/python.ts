/**
 * Python emitter for the feature-manifold scatter plot. Each
 * cluster gets its own colour + 95% confidence ellipse.
 */
import { pyList, pyNum, pyStr, pyStrList, pythonHeader } from '../../lib/pythonExport';

export interface FeatureManifoldPythonInput {
  title: string;
  caption: string;
  classLabels: ReadonlyArray<string>;
  palette: ReadonlyArray<string>;
  xs: ReadonlyArray<number>;
  ys: ReadonlyArray<number>;
  classIds: ReadonlyArray<number>;
  showEllipses: boolean;
  ellipses: ReadonlyArray<{
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    angle: number;
  }>;
  pointRadius: number;
  embedding: string;
}

export function emitFeatureManifoldPython(
  input: FeatureManifoldPythonInput,
): string {
  const {
    title,
    caption,
    classLabels,
    palette,
    xs,
    ys,
    classIds,
    showEllipses,
    ellipses,
    pointRadius,
    embedding,
  } = input;
  const ellipseBlock = ellipses
    .map(
      (e) =>
        `    {"cx": ${pyNum(e.cx)}, "cy": ${pyNum(e.cy)}, "rx": ${pyNum(e.rx)}, "ry": ${pyNum(e.ry)}, "angle_deg": ${pyNum(e.angle)}},`,
    )
    .join('\n');
  return `${pythonHeader({
    title,
    caption,
    description:
      'Synthetic feature manifold (UMAP / t-SNE-style scatter) with per-class 95% ellipses.',
  })}
from matplotlib.patches import Ellipse

LABELS = ${pyStrList(classLabels)}
PALETTE = ${pyStrList(palette)}
XS = np.array(${pyList(xs)})
YS = np.array(${pyList(ys)})
CLASS_IDS = np.array(${pyList(classIds.map((x) => Math.floor(x)))}, dtype=int)
SHOW_ELLIPSES = ${showEllipses ? 'True' : 'False'}
ELLIPSES = [
${ellipseBlock}
]
POINT_RADIUS = ${pyNum(pointRadius)}
EMBEDDING = ${pyStr(embedding)}
TITLE = ${pyStr(title)}
CAPTION = ${pyStr(caption)}


def render() -> None:
    fig, ax = plt.subplots(figsize=(7.5, 5.6), constrained_layout=True)
    for c, lab in enumerate(LABELS):
        m = CLASS_IDS == c
        ax.scatter(XS[m], YS[m], s=POINT_RADIUS ** 2 * 4, color=PALETTE[c], alpha=0.7, label=lab, edgecolors="white", linewidths=0.3)
    if SHOW_ELLIPSES:
        for c, e in enumerate(ELLIPSES):
            ell = Ellipse((e["cx"], e["cy"]), 2 * e["rx"], 2 * e["ry"], angle=e["angle_deg"], fill=False, edgecolor=PALETTE[c], linewidth=1.6)
            ax.add_patch(ell)
    ax.set_xlabel(f"{EMBEDDING} dim 1")
    ax.set_ylabel(f"{EMBEDDING} dim 2")
    ax.legend(loc="upper right", fontsize=9, frameon=True)
    ax.grid(alpha=0.15)
    fig.suptitle(TITLE, fontsize=13, fontweight="bold")
    fig.text(0.5, -0.04, CAPTION, ha="center", fontsize=10, color="#444")
    plt.show()


if __name__ == "__main__":
    render()
`;
}
