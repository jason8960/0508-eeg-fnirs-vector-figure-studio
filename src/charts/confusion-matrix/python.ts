/**
 * Python emitter for the multi-class confusion matrix heatmap.
 * Renders the matrix as `imshow` with cell-text annotations and a
 * matching colorbar; honours the user's normalize / colormap pick.
 */
import { pyMatrix, pyStr, pyStrList, pythonHeader } from '../../lib/pythonExport';

export interface ConfusionMatrixPythonInput {
  title: string;
  caption: string;
  trueLabel: string;
  predictedLabel: string;
  labels: ReadonlyArray<string>;
  cm: ReadonlyArray<ReadonlyArray<number>>;
  normalize: boolean;
  colormapName: string;
  separation: number;
  n: number;
}

export function emitConfusionMatrixPython(
  input: ConfusionMatrixPythonInput,
): string {
  const {
    title,
    caption,
    trueLabel,
    predictedLabel,
    labels,
    cm,
    normalize,
    colormapName,
    separation,
    n,
  } = input;
  return `${pythonHeader({
    title,
    caption,
    description: 'Confusion matrix heatmap with per-cell counts / row-normalised probabilities.',
  })}

LABELS = ${pyStrList(labels)}
CM = np.array(${pyMatrix(cm.map((r) => Array.from(r)))})
NORMALIZE = ${normalize ? 'True' : 'False'}
COLORMAP = ${pyStr(colormapName)}
SEP = ${separation}
N = ${n}
TITLE = ${pyStr(title)}
CAPTION = ${pyStr(caption)}
TRUE_LABEL = ${pyStr(trueLabel)}
PRED_LABEL = ${pyStr(predictedLabel)}


def render() -> None:
    fig, ax = plt.subplots(figsize=(7.0, 6.0), constrained_layout=True)
    matrix = CM.astype(float)
    if NORMALIZE:
        rs = matrix.sum(axis=1, keepdims=True)
        matrix = np.divide(matrix, rs, out=np.zeros_like(matrix), where=rs > 0)
    im = ax.imshow(matrix, cmap=COLORMAP, aspect="equal")
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    k = len(LABELS)
    ax.set_xticks(np.arange(k))
    ax.set_yticks(np.arange(k))
    ax.set_xticklabels(LABELS, rotation=20)
    ax.set_yticklabels(LABELS)
    ax.set_xlabel(PRED_LABEL)
    ax.set_ylabel(TRUE_LABEL)
    for i in range(k):
        for j in range(k):
            v = matrix[i, j]
            label_text = f"{v:.2f}" if NORMALIZE else f"{int(CM[i, j])}"
            ax.text(j, i, label_text, ha="center", va="center", fontsize=10, color="white" if v > matrix.max() * 0.55 else "black")
    fig.suptitle(TITLE, fontsize=13, fontweight="bold")
    fig.text(0.5, -0.04, CAPTION, ha="center", fontsize=10, color="#444")
    plt.show()


if __name__ == "__main__":
    render()
`;
}
