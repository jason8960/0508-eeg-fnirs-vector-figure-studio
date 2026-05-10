/**
 * Python emitter for the `hrf-alignment` chart. Emits a 2-panel
 * matplotlib script comparing HbO/HbR vs EEG before and after the
 * learnable HRF alignment. Time series are inlined as numpy arrays
 * (computed by the studio's seeded RNG) so the script does not need
 * to replicate the bump generator.
 */
import { pyList, pyNum, pyStr, pythonHeader } from '../../lib/pythonExport';

export interface HrfAlignmentSignalPython {
  label: string;
  color: string;
  sign: number;
  visible: boolean;
}

export interface HrfAlignmentPythonInput {
  title: string;
  subtitleA: string;
  subtitleB: string;
  axisX: string;
  axisY: string;
  tMin: number;
  tMax: number;
  bandStart: number;
  bandEnd: number;
  showHighlight: boolean;
  showGrid: boolean;
  showLegend: boolean;
  showCorr: boolean;
  signals: ReadonlyArray<HrfAlignmentSignalPython>;
  times: ReadonlyArray<number>;
  tracesBefore: ReadonlyArray<ReadonlyArray<number>>;
  tracesAfter: ReadonlyArray<ReadonlyArray<number>>;
  corrBefore: string;
  corrAfter: string;
  noteText: string;
  showNote: boolean;
}

function deLatex(s: string): string {
  return s
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\\tau/g, 'τ')
    .replace(/\\sigma/g, 'σ')
    .replace(/\\rho/g, 'ρ')
    .replace(/_\{([^}]+)\}/g, '$1')
    .replace(/\\,/g, ' ')
    .replace(/\\\\/g, '\n')
    .replace(/[{}]/g, '')
    .replace(/\\([A-Za-z]+)/g, '$1');
}

export function emitHrfAlignmentPython(input: HrfAlignmentPythonInput): string {
  const {
    title,
    subtitleA,
    subtitleB,
    axisX,
    axisY,
    tMin,
    tMax,
    bandStart,
    bandEnd,
    showHighlight,
    showGrid,
    showLegend,
    showCorr,
    signals,
    times,
    tracesBefore,
    tracesAfter,
    corrBefore,
    corrAfter,
    noteText,
    showNote,
  } = input;

  const sigsPy = signals
    .map(
      (s) =>
        `    {"label": ${pyStr(deLatex(s.label))}, "color": ${pyStr(s.color)}, "sign": ${pyNum(s.sign)}, "visible": ${s.visible ? 'True' : 'False'}},`,
    )
    .join('\n');

  const tracesBeforePy = tracesBefore
    .map((tr) => `    np.array(${pyList(tr)}),`)
    .join('\n');
  const tracesAfterPy = tracesAfter
    .map((tr) => `    np.array(${pyList(tr)}),`)
    .join('\n');

  return `${pythonHeader({
    title,
    caption: deLatex(subtitleA) + ' / ' + deLatex(subtitleB),
    description:
      'HRF alignment before/after: HbO/HbR get pushed back into temporal phase with EEG via the learnable τ_j shift.',
  })}TITLE = ${pyStr(title)}
SUB_A = ${pyStr(deLatex(subtitleA))}
SUB_B = ${pyStr(deLatex(subtitleB))}
X_LABEL = ${pyStr(deLatex(axisX))}
Y_LABEL = ${pyStr(deLatex(axisY))}
T_MIN = ${pyNum(tMin)}
T_MAX = ${pyNum(tMax)}
BAND_START = ${pyNum(bandStart)}
BAND_END = ${pyNum(bandEnd)}
SHOW_HIGHLIGHT = ${showHighlight ? 'True' : 'False'}
SHOW_GRID = ${showGrid ? 'True' : 'False'}
SHOW_LEGEND = ${showLegend ? 'True' : 'False'}
SHOW_CORR = ${showCorr ? 'True' : 'False'}
SHOW_NOTE = ${showNote ? 'True' : 'False'}
NOTE_TEXT = ${pyStr(deLatex(noteText))}
CORR_BEFORE = ${pyStr(deLatex(corrBefore))}
CORR_AFTER = ${pyStr(deLatex(corrAfter))}

times = np.array(${pyList(times)})
SIGNALS = [
${sigsPy}
]
traces_before = [
${tracesBeforePy}
]
traces_after = [
${tracesAfterPy}
]


def render() -> None:
    fig, (axA, axB) = plt.subplots(
        2, 1, figsize=(13, 6.5), sharex=True, constrained_layout=True
    )

    for ax, traces, sub, corr in [
        (axA, traces_before, SUB_A, CORR_BEFORE),
        (axB, traces_after, SUB_B, CORR_AFTER),
    ]:
        if SHOW_HIGHLIGHT:
            ax.axvspan(BAND_START, BAND_END, color="#FFD96B", alpha=0.30)
        for sig, tr in zip(SIGNALS, traces):
            if not sig["visible"]:
                continue
            ax.plot(times, tr, color=sig["color"], linewidth=1.5, label=sig["label"])
        ax.set_ylim(-1.4, 1.4)
        ax.set_xlim(T_MIN, T_MAX)
        ax.set_ylabel(Y_LABEL)
        ax.set_title(sub, fontsize=11, loc="left")
        if SHOW_GRID:
            ax.grid(True, alpha=0.25)
        if SHOW_LEGEND:
            ax.legend(loc="upper right", fontsize=9)
        if SHOW_CORR and corr:
            ax.text(
                0.02, 0.97, corr,
                transform=ax.transAxes, ha="left", va="top",
                fontsize=9, color="#0d1117",
                bbox=dict(facecolor="#f8fafc", edgecolor="#cbd5e1", boxstyle="round,pad=0.4"),
            )

    axB.set_xlabel(X_LABEL)
    if SHOW_NOTE and NOTE_TEXT:
        fig.text(
            0.99, 0.01, NOTE_TEXT,
            ha="right", va="bottom", fontsize=9, color="#334155",
        )
    fig.suptitle(TITLE, fontsize=13, fontweight="bold")
    plt.show()


if __name__ == "__main__":
    render()
`;
}
