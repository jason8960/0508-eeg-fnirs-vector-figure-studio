/**
 * Python emitter for the cross-dataset generalization figure.
 * Three side-by-side heatmaps (one per model) showing
 * train-dataset → test-dataset accuracy with the diagonal
 * highlighted as the in-distribution baseline.
 */
import { pyMatrix, pyStr, pyStrList, pythonHeader } from '../../lib/pythonExport';

export interface CrossDatasetPythonInput {
  title: string;
  caption: string;
  modelNames: ReadonlyArray<string>;
  datasets: ReadonlyArray<string>;
  /** matrices[m][i][j] = accuracy when model m trained on i, tested on j. */
  matrices: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>;
  showValues: boolean;
  highlightDiagonal: boolean;
  minValue: number;
  maxValue: number;
  colormapName: string;
}

export function emitCrossDatasetPython(
  input: CrossDatasetPythonInput,
): string {
  const {
    title,
    caption,
    modelNames,
    datasets,
    matrices,
    showValues,
    highlightDiagonal,
    minValue,
    maxValue,
    colormapName,
  } = input;
  const matBlocks = matrices
    .map((m) => `    np.array(${pyMatrix(m.map((r) => Array.from(r)))}),`)
    .join('\n');
  return `${pythonHeader({
    title,
    caption,
    description:
      'Cross-dataset generalization: 3 train→test heatmaps, one per model.',
  })}

MODEL_NAMES = ${pyStrList(modelNames)}
DATASETS = ${pyStrList(datasets)}
MATRICES = [
${matBlocks}
]
SHOW_VALUES = ${showValues ? 'True' : 'False'}
HIGHLIGHT_DIAG = ${highlightDiagonal ? 'True' : 'False'}
VMIN = ${minValue}
VMAX = ${maxValue}
COLORMAP = ${pyStr(colormapName)}
TITLE = ${pyStr(title)}
CAPTION = ${pyStr(caption)}


def render() -> None:
    fig, axes = plt.subplots(1, 3, figsize=(13.5, 4.6), constrained_layout=True)
    for ax, name, mat in zip(axes, MODEL_NAMES, MATRICES):
        im = ax.imshow(mat, cmap=COLORMAP, vmin=VMIN, vmax=VMAX, aspect="equal")
        k = len(DATASETS)
        ax.set_xticks(range(k))
        ax.set_yticks(range(k))
        ax.set_xticklabels(DATASETS, rotation=20)
        ax.set_yticklabels(DATASETS)
        ax.set_xlabel("Test")
        ax.set_ylabel("Train")
        ax.set_title(name)
        if SHOW_VALUES:
            for i in range(k):
                for j in range(k):
                    ax.text(j, i, f"{mat[i, j]:.2f}", ha="center", va="center", fontsize=9, color="white" if mat[i, j] > (VMIN + VMAX) / 2 else "black")
        if HIGHLIGHT_DIAG:
            for i in range(k):
                ax.add_patch(plt.Rectangle((i - 0.5, i - 0.5), 1, 1, fill=False, edgecolor="#f97316", linewidth=2))
    fig.colorbar(im, ax=axes, fraction=0.04)
    fig.suptitle(TITLE, fontsize=13, fontweight="bold")
    fig.text(0.5, -0.04, CAPTION, ha="center", fontsize=10, color="#444")
    plt.show()


if __name__ == "__main__":
    render()
`;
}
