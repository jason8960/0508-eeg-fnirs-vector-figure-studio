/**
 * Python emitter for the 3-panel baseline comparison
 * (event-SE / FA-rate / detection-latency) with the "Ours" series
 * highlighted by an orange edge.
 */
import { pyList, pyStr, pyStrList, pythonHeader } from '../../lib/pythonExport';

export interface BaselineBarsPythonInput {
  title: string;
  caption: string;
  baselineNames: ReadonlyArray<string>;
  highlightFlags: ReadonlyArray<boolean>;
  seValues: ReadonlyArray<number>;
  faValues: ReadonlyArray<number>;
  latValues: ReadonlyArray<number>;
  panelTitles: ReadonlyArray<string>;
  panelYLabels: ReadonlyArray<string>;
  panelPalettes: ReadonlyArray<ReadonlyArray<string>>;
  showValues: boolean;
  showErrorBars: boolean;
  errorMagnitude: number;
}

export function emitBaselineBarsPython(input: BaselineBarsPythonInput): string {
  const {
    title,
    caption,
    baselineNames,
    highlightFlags,
    seValues,
    faValues,
    latValues,
    panelTitles,
    panelYLabels,
    panelPalettes,
    showValues,
    showErrorBars,
    errorMagnitude,
  } = input;

  const palettes = panelPalettes
    .map((p) => `    ${pyStrList(p)},`)
    .join('\n');

  return `${pythonHeader({
    title,
    caption,
    description: 'Baseline comparison — three panels (SE / FA / latency), Ours highlighted.',
  })}

NAMES = ${pyStrList(baselineNames)}
HIGHLIGHT = ${pyStrList(highlightFlags.map((b) => (b ? 'true' : 'false')))}
SE = np.array(${pyList(seValues)})
FA = np.array(${pyList(faValues)})
LAT = np.array(${pyList(latValues)})
PANEL_TITLES = ${pyStrList(panelTitles)}
Y_LABELS = ${pyStrList(panelYLabels)}
PALETTES = [
${palettes}
]
SHOW_VALUES = ${showValues ? 'True' : 'False'}
SHOW_ERR = ${showErrorBars ? 'True' : 'False'}
ERR = ${errorMagnitude}
TITLE = ${pyStr(title)}
CAPTION = ${pyStr(caption)}


def render() -> None:
    fig, axes = plt.subplots(1, 3, figsize=(13.5, 4.6), constrained_layout=True)
    series = [SE, FA, LAT]
    x = np.arange(len(NAMES))
    for ax, vals, title_, ylabel, palette in zip(axes, series, PANEL_TITLES, Y_LABELS, PALETTES):
        edges = ["#f97316" if h == "true" else "#0d1117" for h in HIGHLIGHT]
        widths = [2.0 if h == "true" else 0.6 for h in HIGHLIGHT]
        err = ERR * (vals.max() if vals.max() > 0 else 1) if SHOW_ERR else None
        ax.bar(x, vals, color=palette[: len(NAMES)], edgecolor=edges, linewidth=widths, yerr=err, capsize=3)
        if SHOW_VALUES:
            for i, v in enumerate(vals):
                ax.text(i, v + (vals.max() * 0.02), f"{v:.2f}", ha="center", fontsize=8)
        ax.set_xticks(x)
        ax.set_xticklabels(NAMES, rotation=45, ha="right")
        ax.set_ylabel(ylabel)
        ax.set_title(title_)
        ax.grid(alpha=0.2, axis="y")

    fig.suptitle(TITLE, fontsize=13, fontweight="bold")
    fig.text(0.5, -0.04, CAPTION, ha="center", fontsize=10, color="#444")
    plt.show()


if __name__ == "__main__":
    render()
`;
}
