/**
 * Python emitter for the LOSO ablation grouped-bars + FA/h figure.
 * Inlines per-condition CHB/TUSZ sensitivities + FA-rate, the
 * resolved palette, and any user-edited title / caption.
 */
import { pyList, pyStr, pyStrList, pythonHeader } from '../../lib/pythonExport';

export interface AblationBarsPythonInput {
  title: string;
  caption: string;
  conditionIds: ReadonlyArray<string>;
  conditionDetails: ReadonlyArray<string>;
  fullIndex: number;
  seCHB: ReadonlyArray<number>;
  seTUSZ: ReadonlyArray<number>;
  faCHB: ReadonlyArray<number>;
  showValues: boolean;
  highlightFull: boolean;
  showErrorBars: boolean;
  errorMagnitude: number;
  palette: ReadonlyArray<string>;
}

export function emitAblationBarsPython(
  input: AblationBarsPythonInput,
): string {
  const {
    title,
    caption,
    conditionIds,
    conditionDetails,
    fullIndex,
    seCHB,
    seTUSZ,
    faCHB,
    showValues,
    highlightFull,
    showErrorBars,
    errorMagnitude,
    palette,
  } = input;

  return `${pythonHeader({
    title,
    caption,
    description:
      'Ablation study under LOSO patient-independent splits. Two-panel grouped bars.',
  })}

CONDITIONS = ${pyStrList(conditionIds)}
DETAILS = ${pyStrList(conditionDetails)}
FULL_INDEX = ${fullIndex}
SE_CHB = np.array(${pyList(seCHB)})
SE_TUSZ = np.array(${pyList(seTUSZ)})
FA_CHB = np.array(${pyList(faCHB)})
PALETTE = ${pyStrList(palette)}
SHOW_VALUES = ${showValues ? 'True' : 'False'}
HIGHLIGHT_FULL = ${highlightFull ? 'True' : 'False'}
SHOW_ERROR_BARS = ${showErrorBars ? 'True' : 'False'}
ERROR_MAG = ${errorMagnitude}
TITLE = ${pyStr(title)}
CAPTION = ${pyStr(caption)}


def render() -> None:
    fig, axes = plt.subplots(1, 2, figsize=(11.5, 4.6), constrained_layout=True)
    ax_se, ax_fa = axes
    x = np.arange(len(CONDITIONS))
    w = 0.38

    err = ERROR_MAG if SHOW_ERROR_BARS else None
    ax_se.bar(
        x - w / 2,
        SE_CHB,
        w,
        color="#1f77b4",
        label="CHB-MIT",
        yerr=err,
        capsize=3,
        edgecolor="black" if HIGHLIGHT_FULL else None,
        linewidth=[1.5 if i == FULL_INDEX and HIGHLIGHT_FULL else 0 for i in x],
    )
    ax_se.bar(
        x + w / 2,
        SE_TUSZ,
        w,
        color="#ff7f0e",
        label="TUSZ",
        yerr=err,
        capsize=3,
    )
    if SHOW_VALUES:
        for i, (a, b) in enumerate(zip(SE_CHB, SE_TUSZ)):
            ax_se.text(i - w / 2, a + 0.01, f"{a:.2f}", ha="center", fontsize=8)
            ax_se.text(i + w / 2, b + 0.01, f"{b:.2f}", ha="center", fontsize=8)
    ax_se.set_xticks(x)
    ax_se.set_xticklabels(CONDITIONS)
    ax_se.set_ylabel("Event sensitivity")
    ax_se.set_title("(a) Event SE — CHB-MIT vs. TUSZ")
    ax_se.set_ylim(0, 1.05)
    ax_se.legend(loc="lower left")
    ax_se.grid(alpha=0.2, axis="y")

    ax_fa.bar(x, FA_CHB, color=PALETTE[: len(CONDITIONS)])
    if SHOW_VALUES:
        for i, v in enumerate(FA_CHB):
            ax_fa.text(i, v + 0.02, f"{v:.2f}", ha="center", fontsize=8)
    ax_fa.set_xticks(x)
    ax_fa.set_xticklabels(CONDITIONS)
    ax_fa.set_ylabel("False alarms / hour")
    ax_fa.set_title("(b) FA/h — CHB-MIT")
    ax_fa.grid(alpha=0.2, axis="y")

    fig.suptitle(TITLE, fontsize=13, fontweight="bold")
    fig.text(0.5, -0.02, CAPTION, ha="center", fontsize=10, color="#444")
    plt.show()


if __name__ == "__main__":
    render()
`;
}
