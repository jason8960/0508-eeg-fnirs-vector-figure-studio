/**
 * Python emitter for the HRF τ recovery figure: scatter of learned
 * vs. ground-truth lag with linear fit + ideal line, plus a noise-vs-
 * error curve comparing baselines.
 */
import { pyList, pyNum, pyStr, pythonHeader } from '../../lib/pythonExport';

export interface HrfTauPythonInput {
  title: string;
  caption: string;
  groundTruth: ReadonlyArray<number>;
  learned: ReadonlyArray<number>;
  noiseLevels: ReadonlyArray<number>;
  oursError: ReadonlyArray<number>;
  baselineError: ReadonlyArray<number>;
  showIdeal: boolean;
  showFit: boolean;
  showOurs: boolean;
  showBaseline: boolean;
  metricsR: number;
  metricsMae: number;
  metricsSlope: number;
  metricsIntercept: number;
}

export function emitHrfTauPython(input: HrfTauPythonInput): string {
  const {
    title,
    caption,
    groundTruth,
    learned,
    noiseLevels,
    oursError,
    baselineError,
    showIdeal,
    showFit,
    showOurs,
    showBaseline,
    metricsR,
    metricsMae,
    metricsSlope,
    metricsIntercept,
  } = input;
  return `${pythonHeader({
    title,
    caption,
    description: 'HRF τ recovery: scatter + noise robustness curves.',
  })}

GT = np.array(${pyList(groundTruth)})
LEARNED = np.array(${pyList(learned)})
NOISE = np.array(${pyList(noiseLevels)})
OURS = np.array(${pyList(oursError)})
BASE = np.array(${pyList(baselineError)})
SHOW_IDEAL = ${showIdeal ? 'True' : 'False'}
SHOW_FIT = ${showFit ? 'True' : 'False'}
SHOW_OURS = ${showOurs ? 'True' : 'False'}
SHOW_BASE = ${showBaseline ? 'True' : 'False'}
SLOPE = ${pyNum(metricsSlope)}
INTERCEPT = ${pyNum(metricsIntercept)}
R = ${pyNum(metricsR)}
MAE = ${pyNum(metricsMae)}
TITLE = ${pyStr(title)}
CAPTION = ${pyStr(caption)}


def render() -> None:
    fig, axes = plt.subplots(1, 2, figsize=(11.5, 4.8), constrained_layout=True)
    ax_s, ax_n = axes
    if SHOW_IDEAL:
        lim = [min(GT.min(), LEARNED.min()), max(GT.max(), LEARNED.max())]
        ax_s.plot(lim, lim, color="#9ca3af", linestyle="--", label="Ideal y=x")
    if SHOW_FIT:
        xx = np.linspace(GT.min(), GT.max(), 100)
        ax_s.plot(xx, SLOPE * xx + INTERCEPT, color="#f97316", linewidth=2, label=f"Fit (r={R:.3f})")
    ax_s.scatter(GT, LEARNED, s=42, color="#1f77b4", edgecolor="white", linewidth=0.5)
    ax_s.set_xlabel("Ground-truth τ (s)")
    ax_s.set_ylabel("Learned τ (s)")
    ax_s.set_title(f"τ recovery (r={R:.3f}, MAE={MAE:.2f})")
    ax_s.legend(loc="upper left", fontsize=9)
    ax_s.grid(alpha=0.2)

    if SHOW_OURS:
        ax_n.plot(NOISE, OURS, color="#1f77b4", linewidth=2, marker="o", label="Ours")
    if SHOW_BASE:
        ax_n.plot(NOISE, BASE, color="#9ca3af", linewidth=2, marker="s", linestyle="--", label="Baseline")
    ax_n.set_xlabel("Noise level σ")
    ax_n.set_ylabel("τ recovery error (s)")
    ax_n.set_title("Robustness to noise")
    ax_n.legend(loc="upper left", fontsize=9)
    ax_n.grid(alpha=0.2)

    fig.suptitle(TITLE, fontsize=13, fontweight="bold")
    fig.text(0.5, -0.04, CAPTION, ha="center", fontsize=10, color="#444")
    plt.show()


if __name__ == "__main__":
    render()
`;
}
