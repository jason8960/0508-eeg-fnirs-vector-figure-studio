/**
 * Python emitter for the per-model 2×2 event-confusion-matrices figure.
 * Renders each model's interictal/ictal confusion matrix as a small
 * heatmap with the canonical TN / FP / FN / TP cell annotations.
 */
import { pyNum, pyStr, pyStrList, pythonHeader } from '../../lib/pythonExport';

export interface EventConfusionModelData {
  name: string;
  tn: number;
  fp: number;
  fn: number;
  tp: number;
}

export interface EventConfusionPythonInput {
  title: string;
  caption: string;
  models: ReadonlyArray<EventConfusionModelData>;
  normalize: boolean;
  showMetrics: boolean;
  colormapName: string;
  highlightModel: string;
}

export function emitEventConfusionPython(
  input: EventConfusionPythonInput,
): string {
  const {
    title,
    caption,
    models,
    normalize,
    showMetrics,
    colormapName,
    highlightModel,
  } = input;
  const blocks = models
    .map(
      (m) =>
        `    {"name": ${pyStr(m.name)}, "tn": ${pyNum(m.tn)}, "fp": ${pyNum(m.fp)}, "fn": ${pyNum(m.fn)}, "tp": ${pyNum(m.tp)}},`,
    )
    .join('\n');
  return `${pythonHeader({
    title,
    caption,
    description: 'Event-level confusion matrices, one per model.',
  })}

MODELS = [
${blocks}
]
NORMALIZE = ${normalize ? 'True' : 'False'}
SHOW_METRICS = ${showMetrics ? 'True' : 'False'}
COLORMAP = ${pyStr(colormapName)}
HIGHLIGHT = ${pyStr(highlightModel)}
TITLE = ${pyStr(title)}
CAPTION = ${pyStr(caption)}
LABELS = ${pyStrList(['Interictal', 'Ictal'])}


def render() -> None:
    fig, axes = plt.subplots(1, len(MODELS), figsize=(4.4 * len(MODELS), 4.4), constrained_layout=True)
    if len(MODELS) == 1:
        axes = [axes]
    for ax, m in zip(axes, MODELS):
        cm = np.array([[m["tn"], m["fp"]], [m["fn"], m["tp"]]], dtype=float)
        if NORMALIZE:
            row = cm.sum(axis=1, keepdims=True)
            disp = np.divide(cm, row, out=np.zeros_like(cm), where=row > 0)
        else:
            disp = cm
        im = ax.imshow(disp, cmap=COLORMAP, vmin=0, vmax=disp.max() if disp.max() > 0 else 1, aspect="equal")
        ax.set_xticks([0, 1])
        ax.set_yticks([0, 1])
        ax.set_xticklabels(LABELS)
        ax.set_yticklabels(LABELS)
        ax.set_xlabel("Predicted")
        ax.set_ylabel("True")
        title_str = m["name"]
        if HIGHLIGHT == m["name"]:
            title_str = "★ " + title_str
        if SHOW_METRICS:
            tot = m["tn"] + m["fp"] + m["fn"] + m["tp"]
            acc = (m["tn"] + m["tp"]) / tot if tot else 0
            sens = m["tp"] / (m["tp"] + m["fn"]) if (m["tp"] + m["fn"]) else 0
            spec = m["tn"] / (m["tn"] + m["fp"]) if (m["tn"] + m["fp"]) else 0
            title_str += f"\\nAcc={acc:.3f} Sens={sens:.3f} Spec={spec:.3f}"
        ax.set_title(title_str, fontsize=10)
        for i in range(2):
            for j in range(2):
                v = disp[i, j]
                txt = f"{v:.2f}" if NORMALIZE else f"{int(cm[i, j])}"
                ax.text(j, i, txt, ha="center", va="center", color="white" if v > disp.max() * 0.55 else "black", fontsize=12, fontweight="bold")
    fig.suptitle(TITLE, fontsize=13, fontweight="bold")
    fig.text(0.5, -0.04, CAPTION, ha="center", fontsize=10, color="#444")
    plt.show()


if __name__ == "__main__":
    render()
`;
}
