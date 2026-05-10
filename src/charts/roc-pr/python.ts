/**
 * Python emitter for the ROC / PR curves figure. Inlines the live
 * data snapshot (per-model curves + AUC / AP / CI) and emits a
 * standalone matplotlib script. The script is fully self-contained
 * — running it produces a static rendition of the same figure with
 * the user's current title / caption / `showCi` / palette captured
 * at click time.
 */
import { pyList, pyNum, pyStr, pythonHeader } from '../../lib/pythonExport';
import type { PrCurve, RocCurve } from './metrics';

export interface PythonModel {
  spec: { name: string };
  roc: RocCurve;
  pr: PrCurve;
  ci: { lo: number; hi: number };
}

export interface RocPrPythonInput {
  title: string;
  caption: string;
  rocPanelTitle: string;
  prPanelTitle: string;
  showCi: boolean;
  palette: ReadonlyArray<string>;
  models: ReadonlyArray<PythonModel>;
  bootstrapIter: number;
  n: number;
}

export function emitRocPrPython(input: RocPrPythonInput): string {
  const {
    title,
    caption,
    rocPanelTitle,
    prPanelTitle,
    showCi,
    palette,
    models,
    bootstrapIter,
    n,
  } = input;

  const modelBlocks = models
    .map((m, i) => {
      const color = palette[i] ?? '#444';
      const rocFpr = m.roc.points.map((p) => p.fpr);
      const rocTpr = m.roc.points.map((p) => p.tpr);
      const prRecall = m.pr.points.map((p) => p.recall);
      const prPrecision = m.pr.points.map((p) => p.precision);
      return `    {\n        "name": ${pyStr(m.spec.name)},\n        "color": ${pyStr(color)},\n        "auc": ${pyNum(m.roc.auc)},\n        "ap": ${pyNum(m.pr.ap)},\n        "ci_lo": ${pyNum(m.ci.lo)},\n        "ci_hi": ${pyNum(m.ci.hi)},\n        "roc_fpr": np.array(${pyList(rocFpr)}),\n        "roc_tpr": np.array(${pyList(rocTpr)}),\n        "pr_recall": np.array(${pyList(prRecall)}),\n        "pr_precision": np.array(${pyList(prPrecision)}),\n    },`;
    })
    .join('\n');

  return `${pythonHeader({
    title,
    caption,
    description:
      'Side-by-side ROC and Precision-Recall curves with bootstrapped 95% AUC CI.',
  })}

MODELS = [
${modelBlocks}
]

SHOW_CI = ${showCi ? 'True' : 'False'}
TITLE = ${pyStr(title)}
CAPTION = ${pyStr(caption)}
ROC_TITLE = ${pyStr(rocPanelTitle)}
PR_TITLE = ${pyStr(prPanelTitle)}
N_PER_MODEL = ${n}
BOOTSTRAP_ITER = ${bootstrapIter}


def render() -> None:
    fig, axes = plt.subplots(1, 2, figsize=(11.5, 4.6), constrained_layout=True)
    ax_roc, ax_pr = axes

    ax_roc.plot([0, 1], [0, 1], color="#9ca3af", linestyle="--", linewidth=1)
    for m in MODELS:
        label = m["name"]
        if SHOW_CI:
            label = f"{label} (AUC={m['auc']:.3f}, 95% CI [{m['ci_lo']:.3f}, {m['ci_hi']:.3f}])"
        else:
            label = f"{label} (AUC={m['auc']:.3f})"
        ax_roc.plot(
            m["roc_fpr"],
            m["roc_tpr"],
            color=m["color"],
            linewidth=2,
            label=label,
        )
    ax_roc.set_xlim(0, 1)
    ax_roc.set_ylim(0, 1)
    ax_roc.set_xlabel("False positive rate")
    ax_roc.set_ylabel("True positive rate")
    ax_roc.set_title(ROC_TITLE)
    ax_roc.legend(loc="lower right", fontsize=9)
    ax_roc.grid(alpha=0.2)

    for m in MODELS:
        label = f"{m['name']} (AP={m['ap']:.3f})"
        ax_pr.plot(
            m["pr_recall"],
            m["pr_precision"],
            color=m["color"],
            linewidth=2,
            label=label,
        )
    ax_pr.set_xlim(0, 1)
    ax_pr.set_ylim(0, 1.02)
    ax_pr.set_xlabel("Recall")
    ax_pr.set_ylabel("Precision")
    ax_pr.set_title(PR_TITLE)
    ax_pr.legend(loc="lower left", fontsize=9)
    ax_pr.grid(alpha=0.2)

    fig.suptitle(TITLE, fontsize=13, fontweight="bold")
    fig.text(0.5, -0.02, CAPTION, ha="center", fontsize=10, color="#444")

    plt.show()


if __name__ == "__main__":
    render()
`;
}
