/**
 * Python emitter for the cross-modal lead–lag matrix figure.
 *
 * The JS chart renders an N×N heatmap where cell colour encodes the
 * lead–lag in seconds between EEG and fNIRS channels, with optional
 * significance stars overlaid. The script reproduces the same heatmap
 * with matplotlib's `imshow` + per-cell text annotations.
 */
import { pyMatrix, pyNum, pyStr, pyStrList, pythonHeader } from '../../lib/pythonExport';

export interface LeadLagMatrixPythonInput {
  title: string;
  caption: string;
  /** N×N lag matrix (seconds). */
  lags: ReadonlyArray<ReadonlyArray<number>>;
  /** N×N p-value matrix in [0, 1]. */
  pvals: ReadonlyArray<ReadonlyArray<number>>;
  rowLabels: ReadonlyArray<string>;
  colLabels: ReadonlyArray<string>;
  colormapName: string;
  showStars: boolean;
  showLabels: boolean;
  /** Number of EEG rows (split point between EEG / fNIRS halves). */
  eegCount: number;
}

export function emitLeadLagMatrixPython(input: LeadLagMatrixPythonInput): string {
  const {
    title,
    caption,
    lags,
    pvals,
    rowLabels,
    colLabels,
    colormapName,
    showStars,
    showLabels,
    eegCount,
  } = input;

  return `${pythonHeader({
    title,
    caption,
    description:
      'Cross-modal lead–lag matrix as a diverging heatmap, split into EEG and fNIRS halves with optional significance markers.',
  })}LAGS = np.array(${pyMatrix(lags)})
PVALS = np.array(${pyMatrix(pvals)})
ROW_LABELS = ${pyStrList(rowLabels)}
COL_LABELS = ${pyStrList(colLabels)}
TITLE = ${pyStr(title)}
CAPTION = ${pyStr(caption)}
COLORMAP = ${pyStr(colormapName)}
SHOW_STARS = ${showStars ? 'True' : 'False'}
SHOW_LABELS = ${showLabels ? 'True' : 'False'}
EEG_COUNT = ${pyNum(eegCount)}


def stars(p: float) -> str:
    if p < 0.001:
        return "***"
    if p < 0.01:
        return "**"
    if p < 0.05:
        return "*"
    return ""


def render() -> None:
    n = LAGS.shape[0]
    vmax = float(np.max(np.abs(LAGS))) or 1.0

    fig, ax = plt.subplots(figsize=(8.6, 7.2), constrained_layout=True)
    im = ax.imshow(
        LAGS,
        cmap=COLORMAP,
        vmin=-vmax,
        vmax=vmax,
        interpolation="nearest",
        aspect="equal",
    )

    if SHOW_LABELS:
        ax.set_xticks(np.arange(n))
        ax.set_yticks(np.arange(n))
        ax.set_xticklabels(COL_LABELS, rotation=90, fontsize=8)
        ax.set_yticklabels(ROW_LABELS, fontsize=8)
    else:
        ax.set_xticks([])
        ax.set_yticks([])

    # Visual EEG / fNIRS divider.
    if 0 < EEG_COUNT < n:
        ax.axhline(EEG_COUNT - 0.5, color="white", linewidth=1.2)
        ax.axvline(EEG_COUNT - 0.5, color="white", linewidth=1.2)

    if SHOW_STARS:
        for i in range(n):
            for j in range(n):
                if i == j:
                    continue
                txt = stars(float(PVALS[i, j]))
                if not txt:
                    continue
                ax.text(j, i, txt, ha="center", va="center", color="white", fontsize=7)

    cbar = fig.colorbar(im, ax=ax, fraction=0.04, pad=0.02)
    cbar.set_label("Lead–lag $\\\\tau_{ij}$ (s)")

    fig.suptitle(TITLE, fontsize=13, fontweight="bold")
    fig.text(0.5, -0.02, CAPTION, ha="center", fontsize=10, color="#444")
    plt.show()


if __name__ == "__main__":
    render()
`;
}
