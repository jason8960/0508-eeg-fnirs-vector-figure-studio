/**
 * Python emitter for the `hrf-kernel` chart. Emits a 2-panel
 * matplotlib script:
 *   (a) Gaussian soft-shift kernels g(Δ; τ, s) for several τ values
 *   (b) Reparameterisation τ_j = τ_min + (τ_max−τ_min)·σ(τ̃_j)
 */
import { pyNum, pyStr, pythonHeader } from '../../lib/pythonExport';

export interface HrfKernelCurvePython {
  tau: number;
  color: string;
  label: string;
}

export interface HrfKernelPythonInput {
  title: string;
  subtitleA: string;
  subtitleB: string;
  axisAX: string;
  axisAY: string;
  axisBX: string;
  axisBY: string;
  sigma: number;
  tauMin: number;
  tauMax: number;
  curves: ReadonlyArray<HrfKernelCurvePython>;
  showLegend: boolean;
  showGrid: boolean;
  showInfoBox: boolean;
  infoBoxText: string;
}

function deLatex(s: string): string {
  return s
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\\Delta/g, 'Δ')
    .replace(/\\tau/g, 'τ')
    .replace(/\\sigma/g, 'σ')
    .replace(/\\tilde\{([^}]+)\}/g, '$1\u0303')
    .replace(/\\min/g, 'min')
    .replace(/\\max/g, 'max')
    .replace(/_\{([^}]+)\}/g, '$1')
    .replace(/\\,/g, ' ')
    .replace(/\\\\/g, '\n')
    .replace(/[{}]/g, '')
    .replace(/\\([A-Za-z]+)/g, '$1');
}

export function emitHrfKernelPython(input: HrfKernelPythonInput): string {
  const {
    title,
    subtitleA,
    subtitleB,
    axisAX,
    axisAY,
    axisBX,
    axisBY,
    sigma,
    tauMin,
    tauMax,
    curves,
    showLegend,
    showGrid,
    showInfoBox,
    infoBoxText,
  } = input;

  const curvesPy = curves
    .map(
      (c) =>
        `    {"tau": ${pyNum(c.tau)}, "color": ${pyStr(c.color)}, "label": ${pyStr(deLatex(c.label))}},`,
    )
    .join('\n');

  return `${pythonHeader({
    title,
    caption: deLatex(subtitleA) + ' / ' + deLatex(subtitleB),
    description:
      'HRF soft-shift kernel and reparameterisation curve for the GAT-CMC-Net learnable HRF module.',
  })}TITLE = ${pyStr(title)}
SUB_A = ${pyStr(deLatex(subtitleA))}
SUB_B = ${pyStr(deLatex(subtitleB))}
X_LABEL_A = ${pyStr(deLatex(axisAX))}
Y_LABEL_A = ${pyStr(deLatex(axisAY))}
X_LABEL_B = ${pyStr(deLatex(axisBX))}
Y_LABEL_B = ${pyStr(deLatex(axisBY))}
SIGMA = ${pyNum(sigma)}
TAU_MIN = ${pyNum(tauMin)}
TAU_MAX = ${pyNum(tauMax)}
SHOW_LEGEND = ${showLegend ? 'True' : 'False'}
SHOW_GRID = ${showGrid ? 'True' : 'False'}
SHOW_INFO = ${showInfoBox ? 'True' : 'False'}
INFO_TEXT = ${pyStr(deLatex(infoBoxText))}

CURVES = [
${curvesPy}
]


def gauss_kernel(delta, tau, s):
    return np.exp(-((delta - tau) ** 2) / (2.0 * s * s))


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def render() -> None:
    fig, (axA, axB) = plt.subplots(1, 2, figsize=(13, 5), constrained_layout=True)

    delta = np.linspace(-2, 12, 600)
    for c in CURVES:
        axA.plot(
            delta,
            gauss_kernel(delta, c["tau"], SIGMA),
            color=c["color"],
            linewidth=1.6,
            label=c["label"],
        )
    axA.set_xlabel(X_LABEL_A)
    axA.set_ylabel(Y_LABEL_A)
    axA.set_title(SUB_A, fontsize=11, loc="left")
    if SHOW_GRID:
        axA.grid(True, alpha=0.25)
    if SHOW_LEGEND:
        axA.legend(loc="upper right", fontsize=9)

    t_tilde = np.linspace(-6, 6, 600)
    tau = TAU_MIN + (TAU_MAX - TAU_MIN) * sigmoid(t_tilde)
    axB.plot(t_tilde, tau, color="#0d1117", linewidth=1.8)
    axB.axhline(TAU_MIN, color="#888", linestyle="--", linewidth=1.0, alpha=0.7)
    axB.axhline(TAU_MAX, color="#888", linestyle="--", linewidth=1.0, alpha=0.7)
    axB.set_xlabel(X_LABEL_B)
    axB.set_ylabel(Y_LABEL_B)
    axB.set_title(SUB_B, fontsize=11, loc="left")
    if SHOW_GRID:
        axB.grid(True, alpha=0.25)

    if SHOW_INFO:
        axA.text(
            0.97, 0.05, INFO_TEXT,
            transform=axA.transAxes, ha="right", va="bottom",
            fontsize=9, color="#334155",
            bbox=dict(facecolor="#f8fafc", edgecolor="#cbd5e1", boxstyle="round,pad=0.4"),
        )

    fig.suptitle(TITLE, fontsize=13, fontweight="bold")
    plt.show()


if __name__ == "__main__":
    render()
`;
}
