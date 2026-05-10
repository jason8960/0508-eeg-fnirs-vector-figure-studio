/**
 * Python emitter for the reliability-diagram (calibration) figure.
 * Plots one line per model + the perfect-calibration diagonal,
 * annotated with each model's ECE.
 */
import { pyList, pyNum, pyStr, pythonHeader } from '../../lib/pythonExport';

export interface CalibrationCurveModel {
  name: string;
  meanScore: ReadonlyArray<number>;
  fractionPositive: ReadonlyArray<number>;
  ece: number;
  color: string;
}

export interface CalibrationCurvePythonInput {
  title: string;
  caption: string;
  models: ReadonlyArray<CalibrationCurveModel>;
  bins: number;
  n: number;
}

export function emitCalibrationCurvePython(
  input: CalibrationCurvePythonInput,
): string {
  const { title, caption, models, bins, n } = input;
  const blocks = models
    .map(
      (m) =>
        `    {\n        "name": ${pyStr(m.name)},\n        "color": ${pyStr(m.color)},\n        "ece": ${pyNum(m.ece)},\n        "x": np.array(${pyList(m.meanScore)}),\n        "y": np.array(${pyList(m.fractionPositive)}),\n    },`,
    )
    .join('\n');
  return `${pythonHeader({
    title,
    caption,
    description: 'Reliability diagram (calibration) per model.',
  })}

MODELS = [
${blocks}
]
BINS = ${bins}
N_PER_MODEL = ${n}
TITLE = ${pyStr(title)}
CAPTION = ${pyStr(caption)}


def render() -> None:
    fig, ax = plt.subplots(figsize=(6.4, 5.2), constrained_layout=True)
    ax.plot([0, 1], [0, 1], color="#9ca3af", linestyle="--", linewidth=1, label="Perfect calibration")
    for m in MODELS:
        ax.plot(m["x"], m["y"], color=m["color"], linewidth=2, marker="o", label=f"{m['name']} (ECE={m['ece']:.3f})")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_xlabel("Mean predicted probability")
    ax.set_ylabel("Fraction positive")
    ax.legend(loc="upper left", fontsize=9)
    ax.grid(alpha=0.2)
    fig.suptitle(TITLE, fontsize=13, fontweight="bold")
    fig.text(0.5, -0.04, CAPTION, ha="center", fontsize=10, color="#444")
    plt.show()


if __name__ == "__main__":
    render()
`;
}
