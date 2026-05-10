/**
 * Python emitter for the `event-decoding` chart. Emits a 3-panel
 * matplotlib script: posterior trace + threshold, binary mask after
 * morphological closing, and final event windows. The posterior is
 * inlined as a numpy array (already noisy from the seeded RNG) so the
 * script does not need to replicate the RNG.
 */
import { pyList, pyNum, pyStr, pythonHeader } from '../../lib/pythonExport';

export interface EventWindowPython {
  start: number;
  end: number;
}

export interface EventDecodingPythonInput {
  title: string;
  subtitleA: string;
  subtitleB: string;
  subtitleC: string;
  axisX: string;
  axisYa: string;
  axisYb: string;
  axisYc: string;
  tMin: number;
  tMax: number;
  theta: number;
  showThresholdLine: boolean;
  showGrid: boolean;
  times: ReadonlyArray<number>;
  posterior: ReadonlyArray<number>;
  closedMask: ReadonlyArray<number>;
  finalWindows: ReadonlyArray<EventWindowPython>;
  noteText: string;
  showNote: boolean;
}

function deLatex(s: string): string {
  return s
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\\theta_d/g, 'θd')
    .replace(/\\theta/g, 'θ')
    .replace(/\\hat\{y\}_\{?\(?t\)?\}?/g, 'ŷ(t)')
    .replace(/\\hat\{([^}]+)\}/g, '$1\u0302')
    .replace(/W_\{?\\min\}?/g, 'Wmin')
    .replace(/_\{([^}]+)\}/g, '$1')
    .replace(/\\,/g, ' ')
    .replace(/\\\\/g, '\n')
    .replace(/[{}]/g, '')
    .replace(/\\([A-Za-z]+)/g, '$1');
}

export function emitEventDecodingPython(
  input: EventDecodingPythonInput,
): string {
  const {
    title,
    subtitleA,
    subtitleB,
    subtitleC,
    axisX,
    axisYa,
    axisYb,
    axisYc,
    tMin,
    tMax,
    theta,
    showThresholdLine,
    showGrid,
    times,
    posterior,
    closedMask,
    finalWindows,
    noteText,
    showNote,
  } = input;

  const windowsLit = `[${finalWindows.map((w) => `(${pyNum(w.start)}, ${pyNum(w.end)})`).join(', ')}]`;

  return `${pythonHeader({
    title,
    caption: showNote ? deLatex(noteText) : '',
    description:
      'Event decoding pipeline: thresholded posterior → binary mask → morphological closing → final event windows.',
  })}TITLE = ${pyStr(title)}
SUB_A = ${pyStr(deLatex(subtitleA))}
SUB_B = ${pyStr(deLatex(subtitleB))}
SUB_C = ${pyStr(deLatex(subtitleC))}
X_LABEL = ${pyStr(deLatex(axisX))}
Y_LABEL_A = ${pyStr(deLatex(axisYa))}
Y_LABEL_B = ${pyStr(deLatex(axisYb))}
Y_LABEL_C = ${pyStr(deLatex(axisYc))}
T_MIN = ${pyNum(tMin)}
T_MAX = ${pyNum(tMax)}
THETA = ${pyNum(theta)}
SHOW_THRESHOLD = ${showThresholdLine ? 'True' : 'False'}
SHOW_GRID = ${showGrid ? 'True' : 'False'}

times = np.array(${pyList(times)})
posterior = np.array(${pyList(posterior)})
closed_mask = np.array(${pyList(closedMask)}, dtype=int)
final_windows = ${windowsLit}


def render() -> None:
    fig, (axA, axB, axC) = plt.subplots(
        3, 1, figsize=(12, 7), sharex=True, constrained_layout=True
    )

    axA.plot(times, posterior, color="#1F77B4", linewidth=1.4)
    axA.fill_between(
        times, 0, posterior,
        where=posterior >= THETA, color="#1F77B4", alpha=0.18,
    )
    if SHOW_THRESHOLD:
        axA.axhline(THETA, color="#D62728", linestyle="--", linewidth=1.2,
                    label=f"θ = {THETA:.2f}")
        axA.legend(loc="upper right")
    axA.set_ylim(0, 1.05)
    axA.set_ylabel(Y_LABEL_A)
    axA.set_title(SUB_A, fontsize=11, loc="left")
    if SHOW_GRID:
        axA.grid(True, alpha=0.25)

    axB.fill_between(times, 0, closed_mask, step="mid", color="#444", alpha=0.45)
    axB.plot(times, closed_mask, color="#0d1117", linewidth=1.0, drawstyle="steps-mid")
    axB.set_ylim(-0.1, 1.2)
    axB.set_yticks([0, 1])
    axB.set_ylabel(Y_LABEL_B)
    axB.set_title(SUB_B, fontsize=11, loc="left")
    if SHOW_GRID:
        axB.grid(True, alpha=0.25)

    for (s, e) in final_windows:
        axC.axvspan(s, e, color="#FF7F0E", alpha=0.55)
        axC.text((s + e) / 2, 0.55, f"{s:.0f}–{e:.0f}s",
                 ha="center", va="center", fontsize=9, color="#0d1117")
    axC.set_yticks([])
    axC.set_ylim(0, 1)
    axC.set_xlim(T_MIN, T_MAX)
    axC.set_xlabel(X_LABEL)
    axC.set_ylabel(Y_LABEL_C)
    axC.set_title(SUB_C, fontsize=11, loc="left")

    fig.suptitle(TITLE, fontsize=13, fontweight="bold")
    plt.show()


if __name__ == "__main__":
    render()
`;
}
